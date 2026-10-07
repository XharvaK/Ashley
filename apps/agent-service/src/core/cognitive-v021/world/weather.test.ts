import { afterEach, describe, expect, it } from "vitest";
import {
  WEATHER_CACHE_MS,
  WEATHER_STALE_MS,
  ownerWeatherForPass,
  resetOwnerWeatherCache,
  skyFromWmo,
} from "./weather.js";

const T0 = 1_700_000_000_000;
const ON = {
  ASHLEY_WEATHER_SWITCH: "1",
  ASHLEY_WEATHER_LAT: "0",
  ASHLEY_WEATHER_LON: "0",
};

function body(code: number, temperature: number, isDay: number): string {
  return JSON.stringify({ current: { weather_code: code, temperature_2m: temperature, is_day: isDay } });
}

describe("sky words", () => {
  it("maps WMO codes onto one sky word", () => {
    expect(skyFromWmo(0)).toBe("clear");
    expect(skyFromWmo(1)).toBe("clear");
    expect(skyFromWmo(2)).toBe("cloudy");
    expect(skyFromWmo(3)).toBe("cloudy");
    expect(skyFromWmo(45)).toBe("fog");
    expect(skyFromWmo(48)).toBe("fog");
    expect(skyFromWmo(51)).toBe("drizzle");
    expect(skyFromWmo(57)).toBe("drizzle");
    expect(skyFromWmo(61)).toBe("rain");
    expect(skyFromWmo(67)).toBe("rain");
    expect(skyFromWmo(80)).toBe("rain");
    expect(skyFromWmo(82)).toBe("rain");
    expect(skyFromWmo(71)).toBe("snow");
    expect(skyFromWmo(77)).toBe("snow");
    expect(skyFromWmo(85)).toBe("snow");
    expect(skyFromWmo(86)).toBe("snow");
    expect(skyFromWmo(95)).toBe("thunder");
    expect(skyFromWmo(99)).toBe("thunder");
    expect(skyFromWmo(4)).toBe("unknown");
    expect(skyFromWmo(50)).toBe("unknown");
    expect(skyFromWmo(70)).toBe("unknown");
  });
});

describe("owner weather cache", () => {
  afterEach(() => {
    resetOwnerWeatherCache();
  });

  it("does not fetch or return a section when the switch is off", async () => {
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return new Response(body(0, 1, 1));
    };
    const off = await ownerWeatherForPass({
      nowMs: T0,
      env: { ...ON, ASHLEY_WEATHER_SWITCH: "" },
      fetchImpl,
    });
    const unset = await ownerWeatherForPass({
      nowMs: T0,
      env: { ASHLEY_WEATHER_LAT: "0", ASHLEY_WEATHER_LON: "0" },
      fetchImpl,
    });
    expect(off).toBeUndefined();
    expect(unset).toBeUndefined();
    expect(fetches).toBe(0);
  });

  it("fetches at most every 30 minutes and rounds the temperature", async () => {
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return new Response(body(61, 12.4, 1));
    };
    const first = await ownerWeatherForPass({ nowMs: T0, env: ON, fetchImpl });
    const cached = await ownerWeatherForPass({ nowMs: T0 + WEATHER_CACHE_MS - 1, env: ON, fetchImpl });
    expect(first).toEqual({ sky: "rain", tempC: 12, isDay: true, observedAtMs: T0 });
    expect(cached).toEqual(first);
    expect(fetches).toBe(1);
    const again = await ownerWeatherForPass({ nowMs: T0 + WEATHER_CACHE_MS, env: ON, fetchImpl });
    expect(again?.observedAtMs).toBe(T0 + WEATHER_CACHE_MS);
    expect(fetches).toBe(2);
  });

  it("keeps the last value after a failure, then drops it after 3 hours", async () => {
    let fail = false;
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      if (fail) throw new Error("weather_unavailable");
      return new Response(body(0, 3.2, 0));
    };
    const first = await ownerWeatherForPass({ nowMs: T0, env: ON, fetchImpl });
    expect(first).toEqual({ sky: "clear", tempC: 3, isDay: false, observedAtMs: T0 });
    fail = true;
    const kept = await ownerWeatherForPass({ nowMs: T0 + WEATHER_CACHE_MS, env: ON, fetchImpl });
    expect(kept).toEqual(first);
    expect(fetches).toBe(2);
    const still = await ownerWeatherForPass({ nowMs: T0 + WEATHER_CACHE_MS + 1_000, env: ON, fetchImpl });
    expect(still).toEqual(first);
    expect(fetches).toBe(2);
    const expired = await ownerWeatherForPass({
      nowMs: T0 + WEATHER_STALE_MS + 1,
      env: ON,
      fetchImpl,
    });
    expect(expired).toBeUndefined();
    expect(fetches).toBe(3);
  });
});
