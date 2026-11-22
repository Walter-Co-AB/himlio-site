// iCalendar in: the busy times in the customer's own calendar (its secret iCal address), so
// visitors can't book when the customer is busy. Only start and end of busy events are kept,
// never what they are.
//
// Recurring events (RRULE, RDATE, EXDATE, moved or cancelled occurrences) are expanded by
// ical.js. Events marked free (TRANSP:TRANSPARENT, e.g. Google's all-day events by default) and
// cancelled ones are skipped. Time zones: a TZID the runtime knows (IANA names) is used as is;
// otherwise the feed's VTIMEZONE; floating times and all-day dates are Stockholm time.

import ICAL from 'ical.js';
import { addDays, fromLocal, TIME_ZONE } from './time.js';
import type { Interval } from './schedule.js';

type Time = InstanceType<typeof ICAL.Time>;
type Event = InstanceType<typeof ICAL.Event>;
type Component = InstanceType<typeof ICAL.Component>;

/** Occurrences per event at most, counting from its first (stops runaway rules). */
export const MAX_OCCURRENCES = 20_000;
/** Busy intervals kept at most (the rest of the window is dropped). */
export const MAX_INTERVALS = 5_000;

const knownZones = new Map<string, boolean>();
function isKnownZone(tzid: string): boolean {
  let known = knownZones.get(tzid);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tzid });
      known = true;
    } catch {
      known = false;
    }
    knownZones.set(tzid, known);
  }
  return known;
}

const pad = (n: number) => String(n).padStart(2, '0');

function instant(time: Time, tzid: string | undefined): number {
  const date = `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  if (time.isDate) return fromLocal(date, '00:00', TIME_ZONE);
  const clock = `${pad(time.hour)}:${pad(time.minute)}`;
  const seconds = time.second * 1000;
  if (time.zone?.tzid === 'UTC') {
    return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  }
  if (tzid && isKnownZone(tzid)) return fromLocal(date, clock, tzid) + seconds;
  if (time.zone && time.zone.tzid !== 'floating' && time.zone.component)
    return time.toUnixTime() * 1000;
  return fromLocal(date, clock, TIME_ZONE) + seconds;
}

function tzidOf(component: Component, property: string): string | undefined {
  const tzid = component.getFirstProperty(property)?.getParameter('tzid');
  return typeof tzid === 'string' ? tzid : undefined;
}

function isBusy(component: Component): boolean {
  const transp = String(component.getFirstPropertyValue('transp') ?? '').toUpperCase();
  const status = String(component.getFirstPropertyValue('status') ?? '').toUpperCase();
  return transp !== 'TRANSPARENT' && status !== 'CANCELLED';
}

function interval(event: Event, start: Time, end: Time): Interval {
  const startZone = tzidOf(event.component, 'dtstart');
  const endZone = tzidOf(event.component, 'dtend') ?? startZone;
  const s = instant(start, startZone);
  let e = instant(end, endZone);
  if (start.isDate && end.isDate && e <= s) {
    // An all-day event without DTEND lasts the day.
    const date = `${start.year}-${pad(start.month)}-${pad(start.day)}`;
    e = fromLocal(addDays(date, 1), '00:00', TIME_ZONE);
  }
  return { start: s, end: Math.max(e, s) };
}

/**
 * The busy intervals of an iCalendar text that overlap [from, to), sorted and merged. Throws if
 * the text isn't iCalendar.
 */
export function busyIntervals(
  text: string,
  from: number,
  to: number,
  ignoreUid?: (uid: string) => boolean
): Interval[] {
  const root = new ICAL.Component(ICAL.parse(text));
  const calendar = root.name === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar');
  if (!calendar) throw new Error('not an iCalendar file (no VCALENDAR)');

  const vevents = calendar.getAllSubcomponents('vevent');
  const masters = new Map<string, Event>();
  const exceptions: Event[] = [];
  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    if (event.uid && ignoreUid?.(event.uid)) continue;
    if (event.isRecurrenceException()) exceptions.push(event);
    else if (event.uid) masters.set(event.uid, event);
    else exceptions.push(event); // no UID: a lone event
  }
  const lone: Event[] = [];
  for (const exception of exceptions) {
    const master = exception.uid ? masters.get(exception.uid) : undefined;
    if (master && exception.isRecurrenceException()) master.relateException(exception);
    else lone.push(exception);
  }

  const out: Interval[] = [];
  const add = (i: Interval) => {
    if (i.end > from && i.start < to && i.end > i.start) out.push(i);
  };

  for (const event of [...masters.values(), ...lone]) {
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      if (isBusy(event.component)) add(interval(event, event.startDate, event.endDate));
      continue;
    }
    const iterator = event.iterator();
    for (
      let n = 0, next = iterator.next();
      next && n < MAX_OCCURRENCES;
      n++, next = iterator.next()
    ) {
      const details = event.getOccurrenceDetails(next);
      const item = details.item as Event;
      const occurrence = interval(item, details.startDate, details.endDate);
      if (occurrence.start >= to && instant(next, tzidOf(event.component, 'dtstart')) >= to) break;
      if (isBusy(item.component)) add(occurrence);
    }
  }
  return merge(out).slice(0, MAX_INTERVALS);
}

/** Sorted, with overlapping and touching intervals joined. */
export function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}
