/**
 * The weather where the Owner is. A private fact for Owner-private passes.
 * Fetched lazily, cached in memory. No place name is read or kept.
 */

export const WEATHER_CACHE_MS = 30 * 60 * 1000;
export const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;
export const WEATHER_TIMEOUT_MS = 5_000;

export const SKY_WORDS = ["clear", "cloudy", "fog", "drizzle", "rain", "snow", "thunder", "unknown"] as const;
export type SkyWord = (typeof SKY_WORDS)[number];

export type OwnerWeather = {
  sky: SkyWord;
  tempC: number;
  isDay: boolean;
  observedAtMs: number;
};

type MemoryCache = {
  attemptedAtMs: number;
  value: OwnerWeather | null;
};

let memoryCache: MemoryCache | null = null;

export function resetOwnerWeatherCache(): void {
  memoryCache = null;
}

export function weatherSwitchOn(env: NodeJS.ProcessEnv): boolean {
  const raw = env.ASHLEY_WEATHER_SWITCH?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

/** WMO weather code to one sky word. Anything outside the known groups is unknown. */
export function skyFromWmo(code: number): SkyWord {
  if (code >= 0 && code <= 1) return "clear";
  if (code >= 2 && code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return "unknown";
}

function coordinatesReady(env: NodeJS.ProcessEnv): boolean {
  const latitude = env.ASHLEY_WEATHER_LAT?.trim() ?? "";
  const longitude = env.ASHLEY_WEATHER_LON?.trim() ?? "";
  return latitude.length > 0
    && longitude.length > 0
    && Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude));
}

function stillFresh(value: OwnerWeather, nowMs: number): boolean {
  return nowMs >= value.observedAtMs && nowMs - value.observedAtMs <= WEATHER_STALE_MS;
}

function cachedValue(nowMs: number): OwnerWeather | undefined {
  const value = memoryCache?.value;
  if (!value || !stillFresh(value, nowMs)) return undefined;
  return { ...value };
}

type CurrentWeather = {
  weather_code?: unknown;
  temperature_2m?: unknown;
  is_day?: unknown;
};

function readCurrent(body: unknown): OwnerWeather | null {
  if (typeof body !== "object" || body === null) return null;
  const current = (body as { current?: CurrentWeather }).current;
  if (!current) return null;
  const code = current.weather_code;
  const temperature = current.temperature_2m;
  const day = current.is_day;
  if (typeof code !== "number" || !Number.isFinite(code)) return null;
  if (typeof temperature !== "number" || !Number.isFinite(temperature)) return null;
  const isDay = day === true || day === 1 ? true : day === false || day === 0 ? false : null;
  if (isDay === null) return null;
  return { sky: skyFromWmo(code), tempC: Math.round(temperature), isDay, observedAtMs: 0 };
}

async function fetchCurrent(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<OwnerWeather | null> {
  const latitude = env.ASHLEY_WEATHER_LAT?.trim() ?? "";
  const longitude = env.ASHLEY_WEATHER_LON?.trim() ?? "";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current", "weather_code,temperature_2m,is_day");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
  if (!response.ok) return null;
  const parsed = readCurrent(await response.json());
  if (!parsed) return null;
  return { ...parsed, observedAtMs: nowMs };
}

/**
 * Current weather for a pass that needs it. No timer: the caller asks.
 * At most one fetch every 30 minutes. A failure keeps the last value for 3 hours.
 * Returns undefined when the switch is off, the position is unset, or nothing usable remains.
 */
export async function ownerWeatherForPass(input: {
  nowMs: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<OwnerWeather | undefined> {
  const env = input.env ?? process.env;
  if (!weatherSwitchOn(env) || !coordinatesReady(env)) return undefined;
  const nowMs = input.nowMs;
  if (memoryCache && nowMs >= memoryCache.attemptedAtMs && nowMs - memoryCache.attemptedAtMs < WEATHER_CACHE_MS) {
    return cachedValue(nowMs);
  }
  try {
    const fetched = await fetchCurrent(env, input.fetchImpl ?? fetch, nowMs);
    if (!fetched) throw new Error("weather_unavailable");
    memoryCache = { attemptedAtMs: nowMs, value: fetched };
    return { ...fetched };
  } catch {
    const kept = memoryCache?.value && stillFresh(memoryCache.value, nowMs) ? memoryCache.value : null;
    memoryCache = { attemptedAtMs: nowMs, value: kept };
    return kept ? { ...kept } : undefined;
  }
}
