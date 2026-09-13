import { observerError } from "./errors.js";
import type { FieldDayWindow } from "./types.js";

export const OBSERVATION_TIMEZONE = "Europe/Istanbul" as const;
export const OBSERVATION_BOUNDARY = "04:00" as const;

type CivilParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const civilFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: OBSERVATION_TIMEZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsFor(date: Date): CivilParts {
  const parts = Object.fromEntries(
    civilFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function dateOnlyParts(fieldDay: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fieldDay)) {
    throw observerError("field_day_invalid", `field_day_invalid:${fieldDay}`);
  }
  const [year, month, day] = fieldDay.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw observerError("field_day_invalid", `field_day_invalid:${fieldDay}`);
  }
  return { year, month, day };
}

function nextDate(fieldDay: string): string {
  const { year, month, day } = dateOnlyParts(fieldDay);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    next.getUTCFullYear().toString().padStart(4, "0"),
    (next.getUTCMonth() + 1).toString().padStart(2, "0"),
    next.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function localBoundaryToUtc(fieldDay: string): Date {
  const { year, month, day } = dateOnlyParts(fieldDay);
  const wantedLocal = Date.UTC(year, month - 1, day, 4, 0, 0, 0);
  let candidate = wantedLocal;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const actual = partsFor(new Date(candidate));
    const actualLocal = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    const delta = wantedLocal - actualLocal;
    if (delta === 0) return new Date(candidate);
    candidate += delta;
  }
  throw observerError("field_day_timezone_resolution_invalid");
}

export function fieldDayWindow(fieldDay: string): FieldDayWindow {
  const start = localBoundaryToUtc(fieldDay);
  const end = localBoundaryToUtc(nextDate(fieldDay));
  return {
    fieldDay,
    timezone: OBSERVATION_TIMEZONE,
    boundary: OBSERVATION_BOUNDARY,
    start,
    end,
  };
}

export function fieldDayForInstant(input: Date | string | number): string {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw observerError("instant_invalid");
  }
  const parts = partsFor(date);
  const localDate = [
    parts.year.toString().padStart(4, "0"),
    parts.month.toString().padStart(2, "0"),
    parts.day.toString().padStart(2, "0"),
  ].join("-");
  if (parts.hour < 4) {
    const { year, month, day } = dateOnlyParts(localDate);
    const previous = new Date(Date.UTC(year, month - 1, day - 1));
    return [
      previous.getUTCFullYear().toString().padStart(4, "0"),
      (previous.getUTCMonth() + 1).toString().padStart(2, "0"),
      previous.getUTCDate().toString().padStart(2, "0"),
    ].join("-");
  }
  return localDate;
}
