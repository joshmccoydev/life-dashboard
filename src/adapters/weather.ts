import type { Adapter, WeatherState } from "@/domains/models";
import { config } from "@/config";
type OpenMeteo = {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    is_day: number;
  };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
};
export function weatherCondition(code: number) {
  if (code === 0) return "Clear skies";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Unknown conditions";
}
export function normalizeWeather(payload: unknown): WeatherState {
  const data = payload as OpenMeteo;
  const values = [
    data?.current?.temperature_2m,
    data?.current?.apparent_temperature,
    data?.current?.weather_code,
    data?.daily?.temperature_2m_max?.[0],
    data?.daily?.temperature_2m_min?.[0],
  ];
  if (!values.every((n) => typeof n === "number" && Number.isFinite(n)))
    throw new Error("Weather response missing required observations");
  return {
    temperature: Math.round(values[0]),
    feelsLike: Math.round(values[1]),
    condition: weatherCondition(values[2]),
    code: values[2],
    unit: config.weatherUnit,
    high: Math.round(values[3]),
    low: Math.round(values[4]),
    location: config.location,
    isDay: data.current.is_day === 1,
  };
}
export const weatherAdapter: Adapter<WeatherState> = {
  provider: "Open-Meteo",
  source: "real",
  async fetch() {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(config.latitude),
      longitude: String(config.longitude),
      current: "temperature_2m,apparent_temperature,weather_code,is_day",
      daily: "temperature_2m_max,temperature_2m_min",
      temperature_unit: config.weatherUnit === "F" ? "fahrenheit" : "celsius",
      timezone: config.display.timezone,
      forecast_days: "1",
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    return normalizeWeather(await response.json());
  },
};
