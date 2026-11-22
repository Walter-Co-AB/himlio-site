// iCalendar (RFC 5545) out: a single event for emails (.ics attachment) and the feed of bookings
// the customer subscribes to. Times are written in UTC, which every calendar app converts.

export interface IcsEvent {
  uid: string;
  start: number; // epoch ms
  end: number;
  summary: string;
  description?: string;
  location?: string;
  /** Cancelled events are kept in a feed with STATUS:CANCELLED so apps remove them. */
  cancelled?: boolean;
  /** Bumped on every change, so apps replace their copy. */
  sequence?: number;
  updated?: number;
  organizer?: { name: string; email: string };
}

const utc = (ms: number) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/[-:]/g, '').replace('.000', '');

/** TEXT value escaping (RFC 5545 3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets, never inside a UTF-8 character. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

function eventLines(event: IcsEvent, now: number): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utc(event.updated ?? now)}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.organizer)
    lines.push(`ORGANIZER;CN=${quoteParam(event.organizer.name)}:mailto:${event.organizer.email}`);
  lines.push(`SEQUENCE:${event.sequence ?? 0}`);
  lines.push(`STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines;
}

function quoteParam(value: string): string {
  return `"${value.replace(/["\r\n]/g, '')}"`;
}

export interface CalendarOptions {
  name?: string;
  /** PUBLISH for feeds and the visitor's copy; CANCEL for a cancellation email. */
  method?: 'PUBLISH' | 'CANCEL' | 'REQUEST';
  now?: number;
}

/** A VCALENDAR with the events, CRLF line ends, lines folded. */
export function calendar(events: IcsEvent[], options: CalendarOptions = {}): string {
  const now = options.now ?? Date.now();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Himlio//Booking//SV',
    'CALSCALE:GREGORIAN',
    `METHOD:${options.method ?? 'PUBLISH'}`,
  ];
  if (options.name) {
    lines.push(`X-WR-CALNAME:${escapeText(options.name)}`);
    lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT15M');
    lines.push('X-PUBLISHED-TTL:PT15M');
  }
  for (const e of events) lines.push(...eventLines(e, now));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
