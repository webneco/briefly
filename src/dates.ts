import type { DateWindow } from './types.ts';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How far back a brief looks. */
export const WINDOW_DAYS = 30;

/** Turns any date string a search result might carry into YYYY-MM-DD, or null when it is not a date. */
export function toDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Today's date on this machine's clock, not in UTC, so "today" matches the user's calendar. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The window a brief covers: the 30 days up to today. A brief is prepared before the meeting,
 * so the window ends on the day it is written, or on the meeting day if that is already past.
 */
export function windowFor(meetingAt: string, now?: string): DateWindow {
  const today = toDay(now) ?? localToday();
  const meeting = toDay(meetingAt);
  const end = meeting && meeting < today ? meeting : today;
  return { start: addDays(end, -WINDOW_DAYS), end };
}

export function inWindow(day: string | null, w: DateWindow): boolean {
  return day !== null && day >= w.start && day <= w.end;
}

/** 2026-11-04 becomes "4 Nov 2026". */
export function pretty(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "4 Nov" when the year is the same as the reference day, otherwise the full date. */
export function prettyShort(day: string, reference: string): string {
  return day.slice(0, 4) === reference.slice(0, 4) ? pretty(day).replace(/ \d{4}$/, '') : pretty(day);
}
