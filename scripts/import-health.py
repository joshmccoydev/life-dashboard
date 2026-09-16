#!/usr/bin/env python3
"""Read an Apple Health XML/ZIP locally; persist only recent dashboard metrics."""
import argparse
import json
import math
import os
import re
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone, time
from pathlib import Path
from zoneinfo import ZoneInfo

TYPES = {"HKQuantityTypeIdentifierStepCount", "HKQuantityTypeIdentifierAppleExerciseTime", "HKCategoryTypeIdentifierAppleStandHour", "HKCategoryTypeIdentifierSleepAnalysis"}
LIMIT = 2 * 1024 ** 3

def stamp(value):
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")

def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value >= 0 else None
    except (ValueError, TypeError):
        return None

def merge_minutes(intervals):
    end = None
    seconds = 0
    for start, finish in sorted(set(intervals)):
        if finish <= start:
            continue
        seconds += max(0, (finish - max(start, end or start)).total_seconds())
        end = max(end or finish, finish)
    return round(seconds / 60)

class LimitedReader:
    def __init__(self, stream):
        self.stream, self.size = stream, 0
    def read(self, size=-1):
        data = self.stream.read(size)
        self.size += len(data)
        if self.size > LIMIT:
            raise ValueError("Export exceeds the 2 GB XML limit")
        return data

def parse_export(stream, zone, now=None):
    now = now or datetime.now(zone)
    cutoff = now - timedelta(days=15)
    records, summaries, workouts = [], {}, []
    root = None
    for event, element in ET.iterparse(LimitedReader(stream), events=("start", "end")):
        if root is None:
            root = element
            if root.tag != "HealthData":
                raise ValueError("Expected an Apple Health HealthData export")
        if event != "end":
            continue
        tag, attrs = element.tag, dict(element.attrib)
        if tag in ("Record", "Workout"):
            try:
                start, end = stamp(attrs["startDate"]), stamp(attrs["endDate"])
                relevant = end >= cutoff and start <= now + timedelta(days=1) and end >= start
                if relevant and tag == "Record" and attrs.get("type") in TYPES:
                    attrs.update(start=start, end=end, watch="watch" in (attrs.get("sourceName", "") + attrs.get("device", "")).lower())
                    records.append(attrs)
                elif relevant and tag == "Workout":
                    duration = (end-start).total_seconds()/60
                    title = re.sub(r"(?<!^)(?=[A-Z])", " ", attrs.get("workoutActivityType", "Workout").replace("HKWorkoutActivityType", ""))
                    workouts.append((end.astimezone(zone).date().isoformat(), title, round(duration)))
            except (KeyError, ValueError):
                pass
        elif tag == "ActivitySummary":
            day = attrs.get("dateComponents", "")
            if cutoff.date().isoformat() <= day <= now.date().isoformat():
                summaries[day] = attrs
        if tag in ("Record", "Workout", "ActivitySummary", "Me", "ExportDate"):
            element.clear()
            root.clear()
        if len(records) > 1_000_000:
            raise ValueError("Too many recent records")
    days = sorted({r["end"].astimezone(zone).date().isoformat() for r in records} | set(summaries))
    if not days:
        raise ValueError("No supported Health records from the last 15 days. Export a fresh file after Watch sync.")
    result = []
    for day in days:
        day_date = datetime.fromisoformat(day).date()
        daily = [r for r in records if r["end"].astimezone(zone).date() == day_date]
        def samples(kind):
            values = [r for r in daily if r["type"] == kind]
            watch = [r for r in values if r["watch"]]
            values = watch or values
            unique = {}
            for r in values:
                unique[(r["start"],r["end"],r.get("value"))] = r
            return list(unique.values())
        steps = samples("HKQuantityTypeIdentifierStepCount")
        step_values = [number(r.get("value")) for r in steps if r.get("unit") == "count"]
        exercise = samples("HKQuantityTypeIdentifierAppleExerciseTime")
        exercise_values = [number(r.get("value")) * (1/60 if r.get("unit") == "s" else 1) for r in exercise if r.get("unit") in ("min", "s") and number(r.get("value")) is not None]
        stood = samples("HKCategoryTypeIdentifierAppleStandHour")
        stood_hours = {r["start"].astimezone(zone).strftime("%Y-%m-%d %H %z") for r in stood if r.get("value") == "HKCategoryValueAppleStandHourStood"}
        sleep = [r for r in records if r["type"] == "HKCategoryTypeIdentifierSleepAnalysis" and r.get("value", "").startswith("HKCategoryValueSleepAnalysisAsleep")]
        left = datetime.combine(day_date-timedelta(days=1), time(18), zone)
        right = datetime.combine(day_date, time(12), zone)
        sleep = [r for r in sleep if r["end"] > left and r["start"] < right]
        sleep_watch = [r for r in sleep if r["watch"]]
        intervals = [(max(r["start"], left), min(r["end"], right)) for r in sleep_watch or sleep]
        summary = summaries.get(day, {})
        energy, energy_goal = number(summary.get("activeEnergyBurned")), number(summary.get("activeEnergyBurnedGoal"))
        latest = max((r["end"] for r in daily), default=datetime.combine(day_date,time(23,59),zone))
        day_workouts = [w for w in workouts if w[0] == day]
        result.append({"date":day,"sampledAt":min(latest,now).astimezone(timezone.utc).isoformat(),"steps":round(sum(v for v in step_values if v is not None)) if any(v is not None for v in step_values) else None,"stepGoal":None,"sleepMinutes":merge_minutes(intervals) if intervals else None,"activityPercent":round(energy/energy_goal*100) if energy is not None and energy_goal else None,"exerciseMinutes":number(summary.get("appleExerciseTime")) if number(summary.get("appleExerciseTime")) is not None else round(sum(exercise_values)) if exercise_values else None,"exerciseGoal":number(summary.get("appleExerciseTimeGoal")),"standHours":number(summary.get("appleStandHours")) if number(summary.get("appleStandHours")) is not None else len(stood_hours) if stood else None,"standGoal":number(summary.get("appleStandHoursGoal")),"workout":f"{day_workouts[-1][1]} · {day_workouts[-1][2]} min" if day_workouts else None,"stepSource":"Apple Watch" if any(r["watch"] for r in steps) else "Health export"})
    return {"version":1,"importedAt":now.astimezone(timezone.utc).isoformat(),"timezone":str(zone),"days":result}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--timezone", default="America/Chicago")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]/".lifedash/health-import.json")
    args = parser.parse_args()
    try:
        zone = ZoneInfo(args.timezone)
        if zipfile.is_zipfile(args.file):
            with zipfile.ZipFile(args.file) as archive:
                matches = [entry for entry in archive.infolist() if entry.filename.rsplit("/",1)[-1] == "export.xml"]
                if len(matches) != 1 or matches[0].file_size > LIMIT:
                    raise ValueError("ZIP must contain one export.xml smaller than 2 GB")
                with archive.open(matches[0]) as stream:
                    snapshot = parse_export(stream,zone)
        else:
            with args.file.open("rb") as stream:
                snapshot = parse_export(stream,zone)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w",dir=args.output.parent,delete=False) as temp:
            json.dump(snapshot,temp,separators=(",",":")); temp_path = temp.name
        os.chmod(temp_path,0o600)
        os.replace(temp_path,args.output)
        print(f"Imported {len(snapshot['days'])} days. Latest: {snapshot['days'][-1]['date']}. Only dashboard summaries were saved locally.")
    except (ValueError, OSError, ET.ParseError, zipfile.BadZipFile) as error:
        sys.exit(f"Health import failed: {error}")

if __name__ == "__main__":
    main()
