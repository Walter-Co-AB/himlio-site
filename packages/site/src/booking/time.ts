// Wall-clock time in the site's time zone (Europe/Stockholm) and instants (UTC), across daylight
// saving changes, with nothing but Intl (Workers have the full time zone database).
//
// A local date is "YYYY-MM-DD", a local time "HH:MM". Instants are epoch milliseconds.

export const TIME_ZONE = 'Europe/Stockholm';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weekday: number; // 0 = Monday … 6 = Sunday
}

function parts(instant: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant)))
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** The zone's offset from UTC at an instant, in milliseconds (Stockholm: +1 h or +2 h). */
export function offsetAt(instant: number, timeZone = TIME_ZONE): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local date, time and weekday of an instant. */
export function toLocal(instant: number, timeZone = TIME_ZONE): LocalParts {
  const p = parts(instant, timeZone);
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return { date, time: `${pad(p.hour)}:${pad(p.minute)}`, weekday: weekdayOf(date) };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export function isDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return (
    d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
  );
}

export const isTime = (value: string): boolean => TIME.test(value);

/** Minutes after midnight of "HH:MM" ("24:00" is 1440). */
export function minutesOf(time: string): number {
  if (!isTime(time)) throw new RangeError(`not a time: ${time}`);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** The date `days` after a local date. */
export function addDays(date: string, days: number): string {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`not a date: ${date}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + days)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`not a date: ${date}`);
  return (new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay() + 6) % 7;
}

/** Days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/**
 * The instant of a local wall-clock time. In the spring gap (02:00–03:00 doesn't exist) the
 * time is moved forward by the gap; in the autumn overlap (02:00–03:00 happens twice) it is
 * the first one.
 */
export function fromLocal(date: string, time: string, timeZone = TIME_ZONE): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`not a date: ${date}`);
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) + minutesOf(time) * MINUTE;
  // The offset is one of the two around asUtc; try the earlier one first (first occurrence).
  const before = offsetAt(asUtc - DAY / 2, timeZone);
  const after = offsetAt(asUtc + DAY / 2, timeZone);
  for (const offset of before >= after ? [before, after] : [after, before]) {
    const instant = asUtc - offset;
    if (offsetAt(instant, timeZone) === offset) return instant;
  }
  // In the gap: neither offset gives back this wall time. Use the offset before the change,
  // which lands after the gap.
  return asUtc - before;
}

export const MINUTE_MS = MINUTE;
export const DAY_MS = DAY;
