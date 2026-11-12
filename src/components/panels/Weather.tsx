import { Cloud, CloudRain, CloudSnow, Moon, Sun, Wind } from "lucide-react";
import type { DashboardData } from "@/domains/models";
import { Feed } from "@/components/shared/feed";

const BANNED_WEATHER_LOCATIONS = /\bchicago\b/i;

/** Do not show a banned or default city. Do not invent a station in this pass. */
function displayWeatherLocation(location: string | undefined | null): string | null {
  if (!location || !location.trim()) return null;
  if (BANNED_WEATHER_LOCATIONS.test(location)) return null;
  return location;
}

export function Weather({ data, now }: { data: DashboardData; now: Date }) {
  const weather = data.weather.data;
  if (!weather)
    return (
      <div className="weather">
        <div className="weather-main">
          <Cloud aria-hidden="true" />
          <span>—</span>
          <div>
            <strong>No data</strong>
            <p>Weather unavailable</p>
          </div>
        </div>
        <div className="weather-feed">
          <Feed state={data.weather} now={now} />
          <span>Feels like —</span>
        </div>
      </div>
    );
  const Icon =
    weather.code >= 95
      ? Wind
      : (weather.code >= 71 && weather.code <= 77) ||
          weather.code === 85 ||
          weather.code === 86
        ? CloudSnow
        : weather.code >= 51
          ? CloudRain
          : weather.code >= 1
            ? Cloud
            : weather.isDay
              ? Sun
              : Moon;
  return (
    <div className="weather">
      <div className="weather-main">
        <Icon />
        <span>
          {weather.temperature}°<small>{weather.unit}</small>
        </span>
        <div>
          <strong>{weather.condition}</strong>
          <p>
            {displayWeatherLocation(weather.location) ? (
              <>
                {displayWeatherLocation(weather.location)} <span>·</span>{" "}
              </>
            ) : null}
            H {weather.high}° / L {weather.low}°
          </p>
        </div>
      </div>
      <div className="weather-feed">
        <Feed state={data.weather} now={now} />
        <span>Feels like {weather.feelsLike}°</span>
      </div>
    </div>
  );
}
