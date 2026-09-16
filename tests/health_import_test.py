import importlib.util
import io
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
spec = importlib.util.spec_from_file_location("health_import", Path(__file__).resolve().parents[1]/"scripts/import-health.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HealthImportTests(unittest.TestCase):
    def parse(self, xml):
        return module.parse_export(io.BytesIO(xml.encode()), ZoneInfo("America/Chicago"), datetime(2026,9,15,20,tzinfo=ZoneInfo("America/Chicago")))
    def test_watch_preference_deduplication_missing_metrics_and_sleep_union(self):
        xml = '''<HealthData>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="3000" startDate="2026-09-15 08:00:00 -0500" endDate="2026-09-15 09:00:00 -0500" />
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" value="1000" startDate="2026-09-15 08:00:00 -0500" endDate="2026-09-15 09:00:00 -0500" />
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" value="1000" startDate="2026-09-15 08:00:00 -0500" endDate="2026-09-15 09:00:00 -0500" />
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisInBed" startDate="2026-09-14 22:00:00 -0500" endDate="2026-09-15 08:00:00 -0500" />
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-14 23:00:00 -0500" endDate="2026-09-15 04:00:00 -0500" />
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-09-15 03:00:00 -0500" endDate="2026-09-15 07:00:00 -0500" />
</HealthData>'''
        data = self.parse(xml)["days"][-1]
        self.assertEqual(data["steps"],1000)
        self.assertEqual(data["sleepMinutes"],480)
        self.assertIsNone(data["activityPercent"])
        self.assertIsNone(data["stepGoal"])
        self.assertIsNone(data["exerciseMinutes"])
    def test_summary_uses_actual_watch_goals(self):
        data = self.parse('<HealthData><ActivitySummary dateComponents="2026-09-15" activeEnergyBurned="300" activeEnergyBurnedGoal="600" appleExerciseTime="25" appleExerciseTimeGoal="30" appleStandHours="8" appleStandHoursGoal="12" /></HealthData>')["days"][-1]
        self.assertEqual(data["activityPercent"],50)
        self.assertEqual(data["standGoal"],12)
        self.assertIsNone(data["steps"])
    def test_old_or_wrong_export_rejected(self):
        with self.assertRaises(ValueError): self.parse('<HealthData><Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" value="1000" startDate="2020-09-15 08:00:00 -0500" endDate="2020-09-15 09:00:00 -0500" /></HealthData>')
        with self.assertRaises(ValueError): self.parse('<Other />')

if __name__ == "__main__": unittest.main()
