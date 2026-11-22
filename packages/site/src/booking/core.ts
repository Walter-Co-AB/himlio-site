// Booking operations: what the plugin's routes, MCP tools and cron do, against injected storage,
// KV, clock and email (so tests run them in Node with fakes).
//
// A booking is made by a visitor (pending, holding its time), confirmed through a signed link in
// an email, and then counts. Overlaps are impossible: every 5-minute cell a booking keeps busy
// (length + buffer) is stored with create-if-absent, so of two requests for overlapping times
// only one gets all its cells.

import { busyIntervals, merge } from './ical-busy.js';
import { calendar, type IcsEvent } from './ics.js';
import {
  cancelledMail,
  cancelledNoticeMail,
  confirmedMail,
  confirmRequestMail,
  newBookingMail,
  reminderMail,
  type Mail,
} from './messages.js';
import {
  DEFAULT_SCHEDULE,
  freeStarts,
  isFreeStart,
  lockCells,
  occupied,
  overlaps,
  scheduleProblems,
  serviceProblems,
  type Interval,
  type Schedule,
  type Service,
} from './schedule.js';
import {
  all,
  BOOKING_PLUGIN_ID,
  KV,
  type Block,
  type Booking,
  type BookingSettings,
  type CalendarConnection,
  type Kv,
  type Storage,
} from './store.js';
import { addDays, DAY_MS, isDate, MINUTE_MS, toLocal } from './time.js';
import { newSecret, sign, verify } from './tokens.js';

export const HOLD_MINUTES = 30;
/** Where the confirm and cancel links go (runtime/booking-pages.ts renders the page). */
export const LINK_PATH = '/_booking';
/** Bookings are personal data: deleted this long after the appointment (like form submissions). */
export const RETENTION_DAYS = 365;
/** Unconfirmed bookings are deleted sooner. */
export const EXPIRED_RETENTION_DAYS = 30;
export const LIMITS = {
  perIpPerHour: 5,
  /** Unconfirmed bookings made in the last hour, site-wide (caps email to unproven addresses). */
  pendingPerHour: 30,
  perEmailPerDay: 5,
  activePerEmail: 3,
  name: 100,
  email: 254,
  phone: 40,
  message: 1000,
  blockDays: 366,
  note: 200,
  services: 50,
} as const;
const MAX_SERVICE_MINUTES = 16 * 60; // longest length + buffer (schedule.ts LIMITS)
const MAINTENANCE_EVERY = 5 * MINUTE_MS;
const CALENDAR_EVERY = 5 * MINUTE_MS;
const CALENDAR_MAX_BYTES = 5_000_000;
const UID_DOMAIN = 'himlio-booking';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Log {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface Deps {
  storage: Storage;
  kv: Kv;
  now(): number;
  send(mail: Mail): Promise<void>;
  /** The site's name and public origin (links in emails). */
  site: { name: string; url: string; replyTo?: string };
  /** Recipients from himlio.json when the admin has set none. */
  platformNotify: readonly string[];
  /** Reads a calendar address (https). */
  fetchCalendar(url: string): Promise<string>;
  log: Log;
}

/** A refusal meant for the caller: message in Swedish for visitors, English for the admin. */
export class BookingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const routeUrl = (deps: Deps, route: string, params: Record<string, string>) =>
  `${deps.site.url.replace(/\/$/, '')}/_emdash/api/plugins/${BOOKING_PLUGIN_ID}/${route}?${new URLSearchParams(params)}`;
const adminUrl = (deps: Deps) =>
  `${deps.site.url.replace(/\/$/, '')}/_emdash/admin/plugins/${BOOKING_PLUGIN_ID}/`;

// --- Settings ---

export async function getSchedule(deps: Pick<Deps, 'kv'>): Promise<Schedule> {
  return (await deps.kv.get<Schedule>(KV.schedule)) ?? DEFAULT_SCHEDULE;
}

export async function setSchedule(
  deps: Pick<Deps, 'kv'>,
  input: Partial<Schedule>
): Promise<Schedule> {
  const schedule = { ...(await getSchedule(deps)), ...input };
  schedule.exceptions = [...schedule.exceptions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const problems = scheduleProblems(schedule);
  if (problems.length) throw new BookingError('INVALID_SCHEDULE', problems.join('; '));
  await deps.kv.set(KV.schedule, schedule);
  return schedule;
}

export async function getSettings(deps: Pick<Deps, 'kv'>): Promise<BookingSettings> {
  return (await deps.kv.get<BookingSettings>(KV.settings)) ?? { notifyEmails: [] };
}

export async function setSettings(
  deps: Pick<Deps, 'kv'>,
  input: Partial<BookingSettings>
): Promise<BookingSettings> {
  const settings = { ...(await getSettings(deps)), ...input };
  settings.notifyEmails = [...new Set(settings.notifyEmails.map((e) => e.trim()).filter(Boolean))];
  if (settings.notifyEmails.length > 10) throw new BookingError('INVALID', 'At most 10 addresses');
  for (const e of settings.notifyEmails)
    if (!EMAIL.test(e) || e.length > LIMITS.email)
      throw new BookingError('INVALID', `Not an email address: ${e}`);
  if (settings.location !== undefined) {
    settings.location = settings.location.trim().slice(0, 200) || undefined;
  }
  await deps.kv.set(KV.settings, settings);
  return settings;
}

async function recipients(deps: Deps): Promise<string[]> {
  const own = (await getSettings(deps)).notifyEmails;
  return own.length ? own : [...deps.platformNotify];
}

/** The per-site signing key, created on first use. */
export async function secret(deps: Pick<Deps, 'kv'>): Promise<string> {
  const existing = await deps.kv.get<string>(KV.secret);
  if (existing) return existing;
  await deps.kv.compareAndSet(KV.secret, null, newSecret());
  const stored = await deps.kv.get<string>(KV.secret);
  if (!stored) throw new Error('booking secret could not be stored');
  return stored;
}

// --- Services ---

export async function listServices(deps: Pick<Deps, 'storage'>, activeOnly = false) {
  const items = await all(deps.storage.services, activeOnly ? { active: true } : {});
  return items
    .map(({ id, data }) => ({ ...data, id }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, 'sv'));
}

export interface ServiceInput {
  id?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes?: number;
  active?: boolean;
  position?: number;
}

export async function saveService(
  deps: Pick<Deps, 'storage'>,
  input: ServiceInput
): Promise<Service> {
  const existing = input.id ? await deps.storage.services.get(input.id) : null;
  if (input.id && !existing) throw new BookingError('NOT_FOUND', `No service ${input.id}`, 404);
  if (!existing && (await deps.storage.services.count()) >= LIMITS.services)
    throw new BookingError('INVALID', `At most ${LIMITS.services} services`);
  const service: Service = {
    ...(existing ?? { active: true, bufferMinutes: 0 }),
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    id: input.id ?? crypto.randomUUID(),
  } as Service;
  service.name = String(service.name ?? '')
    .trim()
    .slice(0, 100);
  if (service.description !== undefined)
    service.description = service.description.trim().slice(0, 500);
  const problems = serviceProblems(service);
  if (problems.length) throw new BookingError('INVALID_SERVICE', problems.join('; '));
  await deps.storage.services.put(service.id, service);
  return service;
}

export async function deleteService(deps: Pick<Deps, 'storage'>, id: string): Promise<boolean> {
  return deps.storage.services.delete(id);
}

async function activeService(deps: Deps, id: string): Promise<Service> {
  const service = await deps.storage.services.get(id);
  if (!service || !service.active)
    throw new BookingError('NO_SERVICE', 'Tjänsten finns inte.', 404);
  return { ...service, id };
}

// --- Busy time and free times ---

const isActive = (b: Booking, now: number) =>
  b.status === 'confirmed' ||
  (b.status === 'pending' && !!b.holdUntil && Date.parse(b.holdUntil) > now);

/** Busy intervals in [from, to): active bookings (with buffers), blocks and the customer's calendar. */
export async function busyBetween(
  deps: Pick<Deps, 'storage' | 'kv' | 'now'>,
  from: number,
  to: number,
  exceptBooking?: string
): Promise<Interval[]> {
  const now = deps.now();
  const bookings = await all(deps.storage.bookings, {
    status: { in: ['pending', 'confirmed'] },
    start: { gte: iso(from - MAX_SERVICE_MINUTES * MINUTE_MS), lt: iso(to) },
  });
  const busy: Interval[] = bookings
    .filter(({ id, data }) => id !== exceptBooking && isActive(data, now))
    .map(({ data }) => ({ start: Date.parse(data.start), end: Date.parse(data.busyEnd) }));
  const blocks = await all(deps.storage.blocks, { end: { gt: iso(from) } });
  for (const { data } of blocks)
    busy.push({ start: Date.parse(data.start), end: Date.parse(data.end) });
  const cal = await deps.kv.get<CalendarConnection>(KV.calendar);
  if (cal) busy.push(...cal.busy);
  return merge(busy.filter((b) => b.end > from && b.start < to));
}

export interface DaySlots {
  date: string;
  /** Free starts as ISO instants, and as local "HH:MM" for display. */
  starts: { start: string; time: string }[];
}

/** Free starts of a service per local date, `days` dates from `from` (today if not given). */
export async function slots(
  deps: Deps,
  serviceId: string,
  from?: string,
  days = 14
): Promise<{ service: Service; days: DaySlots[]; firstDate: string; lastDate: string }> {
  const service = await activeService(deps, serviceId);
  const schedule = await getSchedule(deps);
  const now = deps.now();
  const today = toLocal(now).date;
  const lastDate = addDays(today, schedule.maxDaysAhead);
  const first = from && isDate(from) && from > today ? from : today;
  const last = addDays(first, Math.min(Math.max(days, 1), 62) - 1);
  const busy = await busyBetween(deps, now, Date.parse(`${addDays(last, 2)}T00:00:00Z`));
  const starts = freeStarts(schedule, service, busy, now, first, last);
  const byDate = new Map<string, DaySlots>();
  for (let d = first; d <= last && d <= lastDate; d = addDays(d, 1))
    byDate.set(d, { date: d, starts: [] });
  for (const s of starts) {
    const l = toLocal(s);
    byDate.get(l.date)?.starts.push({ start: iso(s), time: l.time });
  }
  return { service, days: [...byDate.values()], firstDate: today, lastDate };
}

// --- Locks ---

async function acquireLocks(deps: Deps, bookingId: string, interval: Interval): Promise<boolean> {
  const now = deps.now();
  const taken: string[] = [];
  const lock = { bookingId, until: iso(interval.end) };
  for (const cell of lockCells(interval)) {
    let ok = (await deps.storage.locks.compareAndSet(cell, null, lock)).applied;
    if (!ok) {
      // A lock left by a booking that no longer holds its time (expired hold, cancelled, gone)
      // is taken over.
      const existing = await deps.storage.locks.get(cell);
      const owner = existing && (await deps.storage.bookings.get(existing.bookingId));
      if (existing && existing.bookingId === bookingId) ok = true;
      else if (!owner || !isActive(owner, now)) {
        await deps.storage.locks.delete(cell);
        ok = (await deps.storage.locks.compareAndSet(cell, null, lock)).applied;
      }
    }
    if (!ok) {
      if (taken.length) await deps.storage.locks.deleteMany(taken);
      return false;
    }
    taken.push(cell);
  }
  return true;
}

async function releaseLocks(deps: Pick<Deps, 'storage'>, bookingId: string): Promise<void> {
  const locks = await all(deps.storage.locks, { bookingId });
  if (locks.length) await deps.storage.locks.deleteMany(locks.map((l) => l.id));
}

// --- Links ---

export async function signedLink(deps: Deps, action: 'confirm' | 'cancel', bookingId: string) {
  const s = await sign(await secret(deps), action, bookingId);
  return `${deps.site.url.replace(/\/$/, '')}${LINK_PATH}?${new URLSearchParams({ a: action, b: bookingId, s })}`;
}

export async function verifyLink(deps: Deps, action: string, bookingId: string, signature: string) {
  if (action !== 'confirm' && action !== 'cancel') return false;
  return verify(await secret(deps), action, bookingId, signature);
}

async function feedKey(deps: Deps): Promise<string> {
  const version = (await deps.kv.get<number>(KV.feedVersion)) ?? 1;
  return `${version}.${await sign(await secret(deps), 'feed', String(version))}`;
}

export async function feedUrl(deps: Deps): Promise<string> {
  return routeUrl(deps, 'feed', { k: await feedKey(deps) });
}

/** A new feed address; the old one stops working. */
export async function rotateFeed(deps: Deps): Promise<string> {
  const version = (await deps.kv.get<number>(KV.feedVersion)) ?? 1;
  await deps.kv.set(KV.feedVersion, version + 1);
  return feedUrl(deps);
}

// --- Booking ---

export interface BookInput {
  serviceId: string;
  start: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  /** Honeypot: people leave it empty. */
  website?: string;
}

async function ipHash(deps: Deps, ip: string | null): Promise<string | undefined> {
  if (!ip) return undefined;
  const data = new TextEncoder().encode(`${await secret(deps)}:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A visitor's booking: stored as pending, its time held, and a confirmation link emailed. */
export async function book(
  deps: Deps,
  input: BookInput,
  ip: string | null
): Promise<{ status: 'pending'; holdMinutes: number }> {
  const ok = { status: 'pending' as const, holdMinutes: HOLD_MINUTES };
  if (input.website) return ok; // a bot: answer as if booked, store nothing

  const name = text(input.name, LIMITS.name);
  const email = text(input.email, LIMITS.email).toLowerCase();
  const phone = text(input.phone, LIMITS.phone) || undefined;
  const message =
    typeof input.message === 'string'
      ? input.message.trim().slice(0, LIMITS.message) || undefined
      : undefined;
  if (!name) throw new BookingError('INVALID', 'Fyll i ditt namn.');
  if (!EMAIL.test(email)) throw new BookingError('INVALID', 'Fyll i en giltig e-postadress.');

  const service = await activeService(deps, input.serviceId);
  const start = Date.parse(input.start);
  if (!Number.isFinite(start)) throw new BookingError('INVALID', 'Välj en tid.');

  const now = deps.now();
  const hash = await ipHash(deps, ip);
  if (hash) {
    const recent = await deps.storage.bookings.count({
      ipHash: hash,
      createdAt: { gt: iso(now - 3_600_000) },
    });
    if (recent >= LIMITS.perIpPerHour)
      throw new BookingError(
        'RATE_LIMITED',
        'För många bokningar på kort tid. Försök igen senare.',
        429
      );
  }
  const lastHour = await deps.storage.bookings.count({
    status: 'pending',
    createdAt: { gt: iso(now - 3_600_000) },
  });
  if (lastHour >= LIMITS.pendingPerHour)
    throw new BookingError(
      'RATE_LIMITED',
      'Det går inte att boka just nu. Försök igen om en stund.',
      429
    );
  const today = await deps.storage.bookings.count({ email, createdAt: { gt: iso(now - DAY_MS) } });
  if (today >= LIMITS.perEmailPerDay)
    throw new BookingError(
      'RATE_LIMITED',
      'För många bokningar på kort tid. Försök igen senare.',
      429
    );
  const upcoming = (
    await all(deps.storage.bookings, { email, createdAt: { gt: iso(now - 400 * DAY_MS) } })
  ).filter(({ data }) => isActive(data, now) && Date.parse(data.start) > now);
  if (upcoming.length >= LIMITS.activePerEmail)
    throw new BookingError(
      'TOO_MANY',
      `Du har redan ${upcoming.length} kommande bokningar. Avboka någon av dem först.`,
      409
    );

  const schedule = await getSchedule(deps);
  const need = occupied(service, start);
  const busy = await busyBetween(deps, start - DAY_MS, need.end + DAY_MS);
  if (!isFreeStart(schedule, service, busy, now, start))
    throw new BookingError('TAKEN', 'Tiden är inte längre ledig. Välj en annan tid.', 409);

  const id = crypto.randomUUID();
  if (!(await acquireLocks(deps, id, need)))
    throw new BookingError('TAKEN', 'Tiden är inte längre ledig. Välj en annan tid.', 409);

  const end = start + service.durationMinutes * MINUTE_MS;
  const booking: Booking = {
    serviceId: service.id,
    serviceName: service.name,
    start: iso(start),
    end: iso(end),
    busyEnd: iso(need.end),
    status: 'pending',
    name,
    email,
    ...(phone ? { phone } : {}),
    ...(message ? { message } : {}),
    createdAt: iso(now),
    holdUntil: iso(now + HOLD_MINUTES * MINUTE_MS),
    ...(hash ? { ipHash: hash } : {}),
    sequence: 0,
    deleteAfter: iso(now + EXPIRED_RETENTION_DAYS * DAY_MS),
  };
  await deps.storage.bookings.put(id, booking);
  try {
    await deps.send(
      confirmRequestMail(deps.site, booking, await signedLink(deps, 'confirm', id), HOLD_MINUTES)
    );
  } catch (error) {
    deps.log.error('booking: the confirmation email failed', { error: String(error) });
    await releaseLocks(deps, id);
    await deps.storage.bookings.delete(id);
    throw new BookingError(
      'EMAIL_FAILED',
      'Bekräftelsemejlet kunde inte skickas. Försök igen senare.',
      502
    );
  }
  return ok;
}

function icsEvent(deps: Deps, id: string, b: Booking, location?: string): IcsEvent {
  return {
    uid: `${id}@${UID_DOMAIN}`,
    start: Date.parse(b.start),
    end: Date.parse(b.end),
    summary: `${b.serviceName} – ${deps.site.name}`,
    ...(location ? { location } : {}),
    sequence: b.sequence,
    cancelled: b.status === 'cancelled',
  };
}

export type ConfirmResult = 'confirmed' | 'already' | 'gone' | 'cancelled' | 'past';

/** The visitor confirms by the link: the booking counts, and both sides get it by email. */
export async function confirm(deps: Deps, id: string): Promise<ConfirmResult> {
  const booking = await deps.storage.bookings.get(id);
  if (!booking) return 'gone';
  if (booking.status === 'confirmed') return 'already';
  if (booking.status === 'cancelled') return 'cancelled';
  const now = deps.now();
  const start = Date.parse(booking.start);
  if (start <= now) return 'past';
  if (!isActive(booking, now)) {
    // The hold ran out: confirm anyway if the time is still free.
    const need = { start, end: Date.parse(booking.busyEnd) };
    const busy = await busyBetween(deps, need.start, need.end, id);
    if (busy.some((b) => overlaps(b, need)) || !(await acquireLocks(deps, id, need))) {
      if (booking.status === 'pending')
        await deps.storage.bookings.put(id, { ...booking, status: 'expired' });
      return 'gone';
    }
  }
  const { holdUntil: _hold, ...rest } = booking;
  const confirmed: Booking = {
    ...rest,
    status: 'confirmed',
    confirmedAt: iso(now),
    sequence: booking.sequence + 1,
    deleteAfter: iso(Date.parse(booking.end) + RETENTION_DAYS * DAY_MS),
  };
  await deps.storage.bookings.put(id, confirmed);

  const { location } = await getSettings(deps);
  const ics = calendar([icsEvent(deps, id, confirmed, location)], { method: 'PUBLISH', now });
  await deps
    .send(confirmedMail(deps.site, confirmed, await signedLink(deps, 'cancel', id), ics, location))
    .catch((error) =>
      deps.log.error('booking: confirmation to the visitor failed', { error: String(error) })
    );
  for (const to of await recipients(deps))
    await deps
      .send(newBookingMail(deps.site, to, confirmed, ics, adminUrl(deps)))
      .catch((error) =>
        deps.log.error('booking: notification failed', { error: String(error), to })
      );
  return 'confirmed';
}

export type CancelResult = 'cancelled' | 'already' | 'gone' | 'past';

/** Cancels a booking (by the visitor's link, or staff). Its time is free again. */
export async function cancel(
  deps: Deps,
  id: string,
  by: 'visitor' | 'staff',
  options: { notifyVisitor?: boolean } = {}
): Promise<CancelResult> {
  const booking = await deps.storage.bookings.get(id);
  if (!booking) return 'gone';
  if (booking.status === 'cancelled') return 'already';
  if (booking.status === 'expired') return 'gone';
  const now = deps.now();
  if (by === 'visitor' && Date.parse(booking.start) <= now) return 'past';
  const wasConfirmed = booking.status === 'confirmed';
  const { holdUntil: _hold, ...rest } = booking;
  const cancelled: Booking = {
    ...rest,
    status: 'cancelled',
    cancelledAt: iso(now),
    cancelledBy: by,
    sequence: booking.sequence + 1,
    deleteAfter: wasConfirmed ? booking.deleteAfter : iso(now + EXPIRED_RETENTION_DAYS * DAY_MS),
  };
  await deps.storage.bookings.put(id, cancelled);
  await releaseLocks(deps, id);
  if (!wasConfirmed) return 'cancelled';

  const { location } = await getSettings(deps);
  const ics = calendar([icsEvent(deps, id, cancelled, location)], { method: 'CANCEL', now });
  if (by === 'visitor' || options.notifyVisitor !== false)
    await deps
      .send(cancelledMail(deps.site, cancelled, ics, by === 'staff'))
      .catch((error) =>
        deps.log.error('booking: cancellation to the visitor failed', { error: String(error) })
      );
  for (const to of await recipients(deps))
    await deps
      .send(cancelledNoticeMail(deps.site, to, cancelled, ics, adminUrl(deps)))
      .catch((error) =>
        deps.log.error('booking: cancellation notice failed', { error: String(error), to })
      );
  return 'cancelled';
}

// --- Admin lists ---

export async function listBookings(
  deps: Pick<Deps, 'storage'>,
  options: { from?: string; to?: string; status?: Booking['status'][] } = {}
) {
  const where: Record<string, unknown> = {};
  if (options.status?.length) where.status = { in: options.status };
  const range: Record<string, string> = {};
  if (options.from) range.gte = options.from;
  if (options.to) range.lt = options.to;
  if (Object.keys(range).length) where.start = range;
  const items = await all(deps.storage.bookings, where as never, { start: 'asc' }, 1000);
  return items.map(({ id, data }) => {
    const { ipHash: _ip, ...rest } = data;
    return { id, ...rest };
  });
}

export async function getBooking(deps: Pick<Deps, 'storage'>, id: string) {
  const data = await deps.storage.bookings.get(id);
  if (!data) return null;
  const { ipHash: _ip, ...rest } = data;
  return { id, ...rest };
}

export async function listBlocks(deps: Pick<Deps, 'storage' | 'now'>, from?: string) {
  const items = await all(deps.storage.blocks, { end: { gt: from ?? iso(deps.now() - DAY_MS) } });
  return items
    .map(({ id, data }) => ({ id, ...data }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export async function createBlock(
  deps: Pick<Deps, 'storage' | 'now'>,
  input: { start: string; end: string; note?: string }
) {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new BookingError('INVALID', 'start and end must be ISO times, end after start');
  if (end - start > LIMITS.blockDays * DAY_MS)
    throw new BookingError('INVALID', `A block is at most ${LIMITS.blockDays} days`);
  const id = crypto.randomUUID();
  const block: Block = {
    start: iso(start),
    end: iso(end),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, LIMITS.note) } : {}),
    createdAt: iso(deps.now()),
  };
  await deps.storage.blocks.put(id, block);
  const overlapping = (
    await listBookings(deps, {
      from: iso(start - MAX_SERVICE_MINUTES * MINUTE_MS),
      to: iso(end),
      status: ['confirmed', 'pending'],
    })
  ).filter((b) => Date.parse(b.busyEnd) > start).length;
  return { id, ...block, overlappingBookings: overlapping };
}

export async function deleteBlock(deps: Pick<Deps, 'storage'>, id: string) {
  return deps.storage.blocks.delete(id);
}

// --- The customer's calendar (iCal in) ---

export async function getCalendar(deps: Pick<Deps, 'kv'>) {
  const cal = await deps.kv.get<CalendarConnection>(KV.calendar);
  if (!cal) return null;
  const { busy: _busy, ...status } = cal;
  return { ...status, url: maskUrl(cal.url) };
}

/** Shows where the address points without showing its secret part. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '…';
  }
}

export function normaliseCalendarUrl(input: string): string {
  const raw = input.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BookingError('INVALID', 'Not a web address');
  }
  if (url.protocol !== 'https:')
    throw new BookingError('INVALID', 'The address must start with https:// or webcal://');
  return url.toString();
}

/** Sets (and reads straight away) or removes the customer's calendar address. */
export async function setCalendar(deps: Deps, url: string | null) {
  if (url === null || url.trim() === '') {
    await deps.kv.delete(KV.calendar);
    return null;
  }
  const normalised = normaliseCalendarUrl(url);
  await deps.kv.set(KV.calendar, { url: normalised, busy: [] } satisfies CalendarConnection);
  await refreshCalendar(deps);
  return getCalendar(deps);
}

export async function refreshCalendar(deps: Deps): Promise<void> {
  const cal = await deps.kv.get<CalendarConnection>(KV.calendar);
  if (!cal) return;
  const now = deps.now();
  const schedule = await getSchedule(deps);
  try {
    const text = await deps.fetchCalendar(cal.url);
    if (text.length > CALENDAR_MAX_BYTES) throw new Error('the calendar is larger than 5 MB');
    const busy = busyIntervals(
      text,
      now - DAY_MS,
      now + (schedule.maxDaysAhead + 2) * DAY_MS,
      (uid) => uid.endsWith(`@${UID_DOMAIN}`)
    );
    await deps.kv.set(KV.calendar, {
      url: cal.url,
      busy,
      checkedAt: iso(now),
      okAt: iso(now),
      events: busy.length,
    } satisfies CalendarConnection);
  } catch (error) {
    // Keep the last good busy times; show the error in the admin.
    const message = error instanceof Error ? error.message : String(error);
    await deps.kv.set(KV.calendar, { ...cal, checkedAt: iso(now), error: message.slice(0, 300) });
    deps.log.warn('booking: reading the calendar failed', { error: message });
  }
}

// --- Feed (iCal out) ---

/** The feed's text if the key is right, else null. */
export async function feed(deps: Deps, key: string): Promise<string | null> {
  const expected = await feedKey(deps);
  if (key.length !== expected.length || !(await verifyFeedKey(deps, key))) return null;
  const now = deps.now();
  const bookings = await all(
    deps.storage.bookings,
    { status: { in: ['confirmed', 'cancelled'] }, start: { gte: iso(now - 60 * DAY_MS) } },
    { start: 'asc' },
    2000
  );
  const { location } = await getSettings(deps);
  const events = bookings
    .filter(({ data }) => data.status === 'confirmed' || data.confirmedAt)
    .map(({ id, data }) => ({
      ...icsEvent(deps, id, data, location),
      summary: `${data.serviceName}: ${data.name}`,
      description: [data.email, data.phone, data.message].filter(Boolean).join('\n'),
      updated: Date.parse(data.cancelledAt ?? data.confirmedAt ?? data.createdAt),
    }));
  return calendar(events, { name: `Bokningar – ${deps.site.name}`, now });
}

async function verifyFeedKey(deps: Deps, key: string): Promise<boolean> {
  const [version, signature] = key.split('.', 2);
  const current = (await deps.kv.get<number>(KV.feedVersion)) ?? 1;
  if (version !== String(current) || !signature) return false;
  return verify(await secret(deps), 'feed', version, signature);
}

// --- Cron ---

/**
 * Every 5 minutes (from the platform's minute cron): expire unconfirmed holds, send reminders,
 * delete what is past retention, read the customer's calendar.
 */
export async function maintenance(deps: Deps, force = false): Promise<Record<string, number>> {
  const now = deps.now();
  const last = await deps.kv.get<number>(KV.maintenance);
  if (!force && last && now - last < MAINTENANCE_EVERY - 5000) return {};
  await deps.kv.set(KV.maintenance, now);
  const done = { expired: 0, reminded: 0, deleted: 0, locks: 0 };

  for (const { id, data } of await all(deps.storage.bookings, {
    status: 'pending',
    holdUntil: { lt: iso(now) },
  })) {
    await deps.storage.bookings.put(id, { ...data, status: 'expired' });
    await releaseLocks(deps, id);
    done.expired++;
  }

  const upcoming = await all(deps.storage.bookings, {
    status: 'confirmed',
    start: { gt: iso(now), lte: iso(now + DAY_MS) },
  });
  const { location } = await getSettings(deps);
  for (const { id, data } of upcoming) {
    if (data.reminderSentAt) continue;
    // No reminder for a booking made less than a day and a half before.
    if (Date.parse(data.start) - Date.parse(data.confirmedAt ?? data.createdAt) < 36 * 3_600_000)
      continue;
    try {
      await deps.send(
        reminderMail(deps.site, data, await signedLink(deps, 'cancel', id), location)
      );
      await deps.storage.bookings.put(id, { ...data, reminderSentAt: iso(now) });
      done.reminded++;
    } catch (error) {
      deps.log.error('booking: reminder failed', { error: String(error) });
    }
  }

  const old = await all(deps.storage.bookings, { deleteAfter: { lt: iso(now) } });
  for (const { id } of old) await releaseLocks(deps, id);
  if (old.length) done.deleted = await deps.storage.bookings.deleteMany(old.map((o) => o.id));

  const staleLocks = await all(deps.storage.locks, { until: { lt: iso(now - DAY_MS) } });
  if (staleLocks.length)
    done.locks = await deps.storage.locks.deleteMany(staleLocks.map((l) => l.id));
  const oldBlocks = await all(deps.storage.blocks, {
    end: { lt: iso(now - RETENTION_DAYS * DAY_MS) },
  });
  if (oldBlocks.length) await deps.storage.blocks.deleteMany(oldBlocks.map((b) => b.id));

  const cal = await deps.kv.get<CalendarConnection>(KV.calendar);
  if (cal && (force || !cal.checkedAt || now - Date.parse(cal.checkedAt) >= CALENDAR_EVERY - 5000))
    await refreshCalendar(deps);

  if (done.expired || done.reminded || done.deleted) deps.log.info('booking: maintenance', done);
  return done;
}
