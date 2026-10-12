"use client";
import { memo, useEffect, useState } from "react";
import type { DisplayConfig } from "@/domains/models";

export const Clock = memo(function Clock({
  display,
  initialTime,
}: {
  display: DisplayConfig;
  initialTime: string;
}) {
  const [now, setNow] = useState(() => new Date(initialTime));
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const formatted = now
    ? new Intl.DateTimeFormat(display.locale, {
        timeZone: display.timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).formatToParts(now)
    : [];
  return (
    <div className="clock-block">
      <div className="clock">
        <span>
          {now
            ? formatted
                .filter((p) => p.type !== "dayPeriod")
                .map((p) => p.value)
                .join("")
                .trim()
            : "—:—"}
        </span>
        <small>
          {formatted.find((p) => p.type === "dayPeriod")?.value || " "}
        </small>
      </div>
      <div className="date">
        {now
          ? new Intl.DateTimeFormat(display.locale, {
              timeZone: display.timezone,
              weekday: "long",
              month: "short",
              day: "numeric",
            })
              .format(now)
              .toUpperCase()
          : "LIFEDASH / LOCAL TIME"}
      </div>
    </div>
  );
});
