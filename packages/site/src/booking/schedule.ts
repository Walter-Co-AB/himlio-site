// The booking rules a site sets (opening hours, exceptions, notice, how far ahead) and the free
// start times they leave, given what is already busy. Pure functions: no storage, no clock.

import {
  addDays,
  DAY_MS,
  fromLocal,
  isDate,
  isTime,
  MINUTE_MS,
  minutesOf,
  TIME_ZONE,
  toLocal,
  weekdayOf,
} from './time.js';

/** Every length, buffer and step is a whole number of these minutes (the lock grid). */
export const GRID_MINUTES = 5;

export interface TimeRange {
  start: string; // HH:MM
  end: string; // HH:MM, after start ("24:00" for midnight)
}

/** Opening hours per weekday, Monday first. An empty list is closed. */
export type WeekHours = [
  TimeRange[],
  TimeRange[],
  TimeRange[],
  TimeRange[],
  TimeRange[],
  TimeRange[],
  TimeRange[],
];

/** A date with other hours than usual: closed (no ranges) or the ranges given. */
export interface DateException {
  date: string; // YYYY-MM-DD
  hours: TimeRange[];
  note?: string;
}

export interface Schedule {
  hours: WeekHours;
  exceptions: DateException[];
  /** Minutes between possible start times. */
  stepMinutes: number;
  /** The earliest start is this many minutes from now. */
  minNoticeMinutes: number;
  /** The latest start is on the local date this many days from today. */
  maxDaysAhead: number;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  /** Free time kept after each booking of this service (preparation, travel). */
  bufferMinutes: number;
  active: boolean;
  /** Order in lists, lowest first. */
  position?: number;
  /** Shown to visitors: a fixed price, a starting price, or none (on request). In whole kronor. */
  price?: { kind: 'fixed' | 'from'; amount: number };
  /** instant: booked when confirmed. request: the business approves or declines each booking. */
  mode?: 'instant' | 'request';
  /** Visitors can cancel or move a booking until this many hours before its start (0: until it starts). */
  cancelHours?: number;
  /** Extra questions in the booking form (placement, size, hair length...). */
  questions?: Question[];
}

export interface Question {
  id: string;
  label: string;
  required?: boolean;
  /** A text area instead of one line. */
  long?: boolean;
}

/**
 * Who or what is booked: a person (stylist, tattoo artist), a chair or a room. Each has its own
 * hours (or the site's), time off, services and lengths. A site without resources has one
 * implicit resource with the site's hours (DEFAULT_RESOURCE_ID), so it works as before.
 */
export interface Resource {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  position?: number;
  /** Own weekly hours; absent: the site's opening hours. */
  hours?: WeekHours;
  /** Own dates with other hours (time off: an empty list). */
  exceptions?: DateException[];
  /** The services it offers; absent or empty: all. */
  serviceIds?: string[];
  /** Its own length of a service, in minutes, where it differs. */
  durations?: Record<string, number>;
}

export const DEFAULT_RESOURCE_ID = 'default';

/** A half-open interval of instants [start, end), epoch ms. */
export interface Interval {
  start: number;
  end: number;
}

export const DEFAULT_SCHEDULE: Schedule = {
  hours: [
    [{ start: '09:00', end: '17:00' }],
    [{ start: '09:00', end: '17:00' }],
    [{ start: '09:00', end: '17:00' }],
    [{ start: '09:00', end: '17:00' }],
    [{ start: '09:00', end: '17:00' }],
    [],
    [],
  ],
  exceptions: [],
  stepMinutes: 30,
  minNoticeMinutes: 120,
  maxDaysAhead: 60,
};

export const LIMITS = {
  durationMinutes: [GRID_MINUTES, 12 * 60],
  bufferMinutes: [0, 4 * 60],
  stepMinutes: [GRID_MINUTES, 4 * 60],
  minNoticeMinutes: [0, 30 * 24 * 60],
  maxDaysAhead: [1, 365],
  rangesPerDay: 6,
  exceptions: 400,
} as const;

/** Problems with a schedule, in English for the admin and connectors; empty when it is valid. */
export function scheduleProblems(schedule: Schedule): string[] {
  const problems: string[] = [];
  const whole = (name: keyof typeof LIMITS, value: number, grid = false) => {
    const [min, max] = LIMITS[name] as readonly [number, number];
    if (!Number.isInteger(value) || value < min || value > max)
      problems.push(`${name} must be a whole number from ${min} to ${max}`);
    else if (grid && value % GRID_MINUTES !== 0)
      problems.push(`${name} must be a multiple of ${GRID_MINUTES}`);
  };
  whole('stepMinutes', schedule.stepMinutes, true);
  whole('minNoticeMinutes', schedule.minNoticeMinutes);
  whole('maxDaysAhead', schedule.maxDaysAhead);
  if (!Array.isArray(schedule.hours) || schedule.hours.length !== 7)
    problems.push('hours must have 7 days, Monday first');
  else schedule.hours.forEach((day, i) => problems.push(...rangeProblems(day, `hours[${i}]`)));
  if (schedule.exceptions.length > LIMITS.exceptions)
    problems.push(`at most ${LIMITS.exceptions} exceptions`);
  const seen = new Set<string>();
  for (const e of schedule.exceptions) {
    if (!isDate(e.date)) problems.push(`exception date ${e.date} is not YYYY-MM-DD`);
    else if (seen.has(e.date)) problems.push(`exception date ${e.date} appears twice`);
    seen.add(e.date);
    problems.push(...rangeProblems(e.hours, `exception ${e.date}`));
  }
  return problems;
}

function rangeProblems(ranges: TimeRange[], where: string): string[] {
  if (!Array.isArray(ranges)) return [`${where} must be a list`];
  if (ranges.length > LIMITS.rangesPerDay)
    return [`${where}: at most ${LIMITS.rangesPerDay} ranges`];
  const problems: string[] = [];
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : 1));
  let lastEnd = -1;
  for (const r of sorted) {
    if (!isTime(r.start) || !isTime(r.end) || r.start === '24:00') {
      problems.push(`${where}: ${r.start}–${r.end} is not HH:MM–HH:MM`);
      continue;
    }
    const s = minutesOf(r.start);
    const e = minutesOf(r.end);
    if (e <= s) problems.push(`${where}: ${r.start}–${r.end} ends before it starts`);
    if (s % GRID_MINUTES || e % GRID_MINUTES)
      problems.push(`${where}: times must be on whole ${GRID_MINUTES} minutes`);
    if (s < lastEnd) problems.push(`${where}: ranges overlap`);
    lastEnd = Math.max(lastEnd, e);
  }
  return problems;
}

export function serviceProblems(
  service: Pick<Service, 'durationMinutes' | 'bufferMinutes' | 'name'>
): string[] {
  const problems: string[] = [];
  if (typeof service.name !== 'string' || !service.name.trim()) problems.push('name is required');
  for (const key of ['durationMinutes', 'bufferMinutes'] as const) {
    const [min, max] = LIMITS[key];
    const v = service[key];
    if (!Number.isInteger(v) || v < min || v > max)
      problems.push(`${key} must be a whole number from ${min} to ${max}`);
    else if (v % GRID_MINUTES) problems.push(`${key} must be a multiple of ${GRID_MINUTES}`);
  }
  return problems;
}

/** The opening ranges of a local date: its exception if it has one, else its weekday's. */
export function hoursOn(schedule: Schedule, date: string): TimeRange[] {
  const exception = schedule.exceptions.find((e) => e.date === date);
  return exception ? exception.hours : (schedule.hours[weekdayOf(date)] ?? []);
}

/** The parts of `a` that are also in `b` (both sorted, non-overlapping lists of ranges). */
export function intersect(a: TimeRange[], b: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const x of a)
    for (const y of b) {
      const start = x.start > y.start ? x.start : y.start;
      const end = x.end < y.end ? x.end : y.end;
      if (start < end) out.push({ start, end });
    }
  return out.sort((p, q) => (p.start < q.start ? -1 : 1));
}

/**
 * A resource's hours on a date: its own date exception, else its own weekday hours (or the
 * site's), always within the site's exception for that date (a holiday closes everyone).
 */
export function resourceHoursOn(
  schedule: Schedule,
  resource: Pick<Resource, 'hours' | 'exceptions'> | undefined,
  date: string
): TimeRange[] {
  if (!resource || (!resource.hours && !resource.exceptions?.length))
    return hoursOn(schedule, date);
  const own = resource.exceptions?.find((e) => e.date === date);
  const base = own ? own.hours : ((resource.hours ?? schedule.hours)[weekdayOf(date)] ?? []);
  const site = schedule.exceptions.find((e) => e.date === date);
  return site ? intersect(base, site.hours) : base;
}

/** The time a booking of `service` starting at `start` keeps busy: its length and buffer. */
export function occupied(
  service: Pick<Service, 'durationMinutes' | 'bufferMinutes'>,
  start: number
): Interval {
  return {
    start,
    end: start + (service.durationMinutes + service.bufferMinutes) * MINUTE_MS,
  };
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** The local dates people can book on now: today through today + maxDaysAhead. */
export function bookableDates(schedule: Schedule, now: number): string[] {
  const today = toLocal(now, TIME_ZONE).date;
  return Array.from({ length: schedule.maxDaysAhead + 1 }, (_, i) => addDays(today, i));
}

/**
 * Free start times (epoch ms, ascending) of `service` on the local dates from `from` to `to`
 * (inclusive). A start is free when the service, without its buffer, fits in an opening range,
 * it is at least minNotice from now and on a bookable date, and the service with its buffer
 * overlaps nothing in `busy`.
 */
export function freeStarts(
  schedule: Schedule,
  service: Pick<Service, 'durationMinutes' | 'bufferMinutes'>,
  busy: readonly Interval[],
  now: number,
  from: string,
  to: string,
  hoursFor: (date: string) => TimeRange[] = (date) => hoursOn(schedule, date)
): number[] {
  const dates = bookableDates(schedule, now);
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const earliest = now + schedule.minNoticeMinutes * MINUTE_MS;
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start);
  const out: number[] = [];
  for (
    let date = from < first ? first : from;
    date <= to && date <= last;
    date = addDays(date, 1)
  ) {
    for (const range of hoursFor(date)) {
      const open = fromLocal(date, range.start);
      const close =
        range.end === '24:00' ? fromLocal(addDays(date, 1), '00:00') : fromLocal(date, range.end);
      for (
        let start = open;
        start + service.durationMinutes * MINUTE_MS <= close;
        start += schedule.stepMinutes * MINUTE_MS
      ) {
        if (start < earliest) continue;
        const need = occupied(service, start);
        if (!sortedBusy.some((b) => overlaps(b, need))) out.push(start);
      }
    }
  }
  return out;
}

/** Whether `start` is one of the free starts (the check before a booking is stored). */
export function isFreeStart(
  schedule: Schedule,
  service: Pick<Service, 'durationMinutes' | 'bufferMinutes'>,
  busy: readonly Interval[],
  now: number,
  start: number,
  hoursFor?: (date: string) => TimeRange[]
): boolean {
  const date = toLocal(start).date;
  return freeStarts(schedule, service, busy, now, date, date, hoursFor).includes(start);
}

/**
 * Lock cells for an interval: the GRID_MINUTES cells it covers, as ids. Two bookings overlap
 * exactly when they share a cell (all times are on the grid), so storing every cell with
 * create-if-absent makes double booking impossible, whatever the request order.
 */
export function lockCells(interval: Interval, resourceId = DEFAULT_RESOURCE_ID): string[] {
  const grid = GRID_MINUTES * MINUTE_MS;
  const first = Math.floor(interval.start / grid);
  const end = Math.ceil(interval.end / grid);
  // The implicit resource keeps the ids from before resources existed.
  const prefix = resourceId === DEFAULT_RESOURCE_ID ? 'cell:' : `cell:${resourceId}:`;
  return Array.from({ length: Math.max(0, end - first) }, (_, i) => `${prefix}${first + i}`);
}

/** Problems with a service's booking fields (price, mode, deadline, questions); empty when valid. */
export function serviceExtrasProblems(
  service: Pick<Service, 'price' | 'mode' | 'cancelHours' | 'questions'>
): string[] {
  const problems: string[] = [];
  if (service.price !== undefined) {
    const { kind, amount } = service.price;
    if (kind !== 'fixed' && kind !== 'from') problems.push('price.kind must be fixed or from');
    if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000)
      problems.push('price.amount must be whole kronor from 0 to 1000000');
  }
  if (service.mode !== undefined && service.mode !== 'instant' && service.mode !== 'request')
    problems.push('mode must be instant or request');
  if (
    service.cancelHours !== undefined &&
    (!Number.isInteger(service.cancelHours) || service.cancelHours < 0 || service.cancelHours > 720)
  )
    problems.push('cancelHours must be a whole number of hours from 0 to 720');
  const qs = service.questions ?? [];
  if (qs.length > 5) problems.push('at most 5 questions');
  const ids = new Set<string>();
  for (const q of qs) {
    if (!q.label?.trim() || q.label.length > 200)
      problems.push('a question needs a label (at most 200 characters)');
    if (!/^[a-z0-9_-]{1,40}$/.test(q.id ?? ''))
      problems.push(`question id ${q.id} must be a-z, 0-9, _ or -`);
    if (ids.has(q.id)) problems.push(`question id ${q.id} appears twice`);
    ids.add(q.id);
  }
  return problems;
}

/** Problems with a resource's hours; empty when valid. */
export function resourceProblems(resource: Resource): string[] {
  const problems: string[] = [];
  if (!resource.name?.trim()) problems.push('name is required');
  if (resource.hours) {
    if (!Array.isArray(resource.hours) || resource.hours.length !== 7)
      problems.push('hours must have 7 days, Monday first');
    else resource.hours.forEach((day, i) => problems.push(...rangeProblems(day, `hours[${i}]`)));
  }
  const seen = new Set<string>();
  for (const e of resource.exceptions ?? []) {
    if (!isDate(e.date)) problems.push(`exception date ${e.date} is not YYYY-MM-DD`);
    else if (seen.has(e.date)) problems.push(`exception date ${e.date} appears twice`);
    seen.add(e.date);
    problems.push(...rangeProblems(e.hours, `exception ${e.date}`));
  }
  if ((resource.exceptions?.length ?? 0) > LIMITS.exceptions)
    problems.push(`at most ${LIMITS.exceptions} exceptions`);
  for (const [id, minutes] of Object.entries(resource.durations ?? {})) {
    const [min, max] = LIMITS.durationMinutes;
    if (!Number.isInteger(minutes) || minutes < min || minutes > max || minutes % GRID_MINUTES)
      problems.push(`durations.${id} must be a multiple of ${GRID_MINUTES} from ${min} to ${max}`);
  }
  return problems;
}

export { DAY_MS, MINUTE_MS };
