// Booking operations: what the plugin's routes, MCP tools and cron do, against injected storage,
// KV, clock and email (so tests run them in Node with fakes).
//
// Who or what is booked is a resource (a person, a chair, a room), each with its own hours,
// services, lengths, time off and calendar. A site without resources has one implicit resource
// with the site's opening hours, so it works as before resources existed.
//
// A booking is made by a visitor and holds its time. It counts once the visitor is known to be a
// person: through Cloudflare Turnstile at once, or else through a signed link in an email. A
// service in request mode then waits for the business to approve or decline. Overlaps are
// impossible: every 5-minute cell a booking keeps busy (length + buffer) is stored per resource
// with create-if-absent, so of two requests for overlapping times only one gets all its cells.

import { busyIntervals, merge } from './ical-busy.js';
import { calendar, type IcsEvent } from './ics.js';
import {
  cancelledMail,
  cancelledNoticeMail,
  changedNoticeMail,
  confirmedMail,
  confirmRequestMail,
  declinedMail,
  newBookingMail,
  newRequestMail,
  reminderMail,
  requestReceivedMail,
  type Mail,
  type VisitorLinks,
} from './messages.js';
import {
  DEFAULT_RESOURCE_ID,
  DEFAULT_SCHEDULE,
  freeStarts,
  isFreeStart,
  lockCells,
  occupied,
  overlaps,
  resourceHoursOn,
  resourceProblems,
  scheduleProblems,
  serviceExtrasProblems,
  serviceProblems,
  type Interval,
  type Question,
  type Resource,
  type Schedule,
  type Service,
  type TimeRange,
} from './schedule.js';
import {
  all,
  BOOKING_PLUGIN_ID,
  KV,
  type Block,
  type Booking,
  type BookingSettings,
  type BookingStatus,
  type CalendarConnection,
  type Kv,
  type Storage,
} from './store.js';
import type { BookingText } from './strings.js';
import { addDays, DAY_MS, isDate, MINUTE_MS, toLocal } from './time.js';
import { newSecret, sign, verify } from './tokens.js';

export const HOLD_MINUTES = 30;
/** A request holds its time this long (or until shortly before the start) for the business to answer. */
export const REQUEST_HOLD_HOURS = 72;
/** Where the confirm, cancel and rebook links go (runtime/booking-pages.ts renders the page). */
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
  answer: 200,
  longAnswer: 1000,
  blockDays: 366,
  note: 200,
  reason: 500,
  services: 50,
  resources: 30,
  moves: 3,
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
  /** The site's name, public origin (links in emails) and visitor texts in its language. */
  site: { name: string; url: string; replyTo?: string; text: BookingText };
  /** Recipients from himlio.json when the admin has set none. */
  platformNotify: readonly string[];
  /** Reads a calendar address (https). */
  fetchCalendar(url: string): Promise<string>;
  /** Checks a Turnstile token; absent when the site has no Turnstile (email confirmation then). */
  verifyHuman?(token: string): Promise<boolean>;
  /** Turnstile's public site key for the booking form, with verifyHuman. */
  turnstileSiteKey?: string;
  log: Log;
}

/** A refusal meant for the caller: message in the site's language for visitors, English for the admin. */
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
const base = (deps: Deps) => deps.site.url.replace(/\/$/, '');
const routeUrl = (deps: Deps, route: string, params: Record<string, string>) =>
  `${base(deps)}/_emdash/api/plugins/${BOOKING_PLUGIN_ID}/${route}?${new URLSearchParams(params)}`;
const adminUrl = (deps: Deps) => `${base(deps)}/_emdash/admin/plugins/${BOOKING_PLUGIN_ID}/`;
const taken = (deps: Deps) => new BookingError('TAKEN', deps.site.text.errors.taken, 409);

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

async function notifyBusiness(deps: Deps, mail: (to: string) => Mail, what: string) {
  for (const to of await recipients(deps))
    await deps
      .send(mail(to))
      .catch((error) => deps.log.error(`booking: ${what} failed`, { error: String(error), to }));
}

async function notifyVisitor(deps: Deps, mail: Mail, what: string) {
  await deps
    .send(mail)
    .catch((error) => deps.log.error(`booking: ${what} failed`, { error: String(error) }));
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

const byPosition = <T extends { position?: number; name: string }>(a: T, b: T) =>
  (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, 'sv');

export async function listServices(deps: Pick<Deps, 'storage'>, activeOnly = false) {
  const items = await all(deps.storage.services, activeOnly ? { active: true } : {});
  return items.map(({ id, data }) => ({ ...data, id })).sort(byPosition);
}

export interface ServiceInput {
  id?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes?: number;
  active?: boolean;
  position?: number;
  price?: Service['price'] | null;
  mode?: Service['mode'];
  cancelHours?: number;
  questions?: Question[];
}

export async function saveService(
  deps: Pick<Deps, 'storage'>,
  input: ServiceInput
): Promise<Service> {
  const existing = input.id ? await deps.storage.services.get(input.id) : null;
  if (input.id && !existing) throw new BookingError('NOT_FOUND', `No service ${input.id}`, 404);
  if (!existing && (await deps.storage.services.count()) >= LIMITS.services)
    throw new BookingError('INVALID', `At most ${LIMITS.services} services`);
  const service = {
    ...(existing ?? { active: true, bufferMinutes: 0 }),
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    id: input.id ?? crypto.randomUUID(),
  } as Service & { price?: Service['price'] | null };
  if (service.price === null) delete service.price; // null removes the price
  service.name = String(service.name ?? '')
    .trim()
    .slice(0, 100);
  if (service.description !== undefined)
    service.description = service.description.trim().slice(0, 500);
  if (service.questions)
    service.questions = service.questions.map((q) => ({
      id: q.id,
      label: String(q.label ?? '').trim(),
      ...(q.required ? { required: true } : {}),
      ...(q.long ? { long: true } : {}),
    }));
  const problems = [...serviceProblems(service), ...serviceExtrasProblems(service)];
  if (problems.length) throw new BookingError('INVALID_SERVICE', problems.join('; '));
  await deps.storage.services.put(service.id, service as Service);
  return service as Service;
}

export async function deleteService(deps: Pick<Deps, 'storage'>, id: string): Promise<boolean> {
  return deps.storage.services.delete(id);
}

async function activeService(deps: Deps, id: string): Promise<Service> {
  const service = await deps.storage.services.get(id);
  if (!service || !service.active)
    throw new BookingError('NO_SERVICE', deps.site.text.errors.noService, 404);
  return { ...service, id };
}

// --- Resources ---

export async function listResources(deps: Pick<Deps, 'storage'>, activeOnly = false) {
  const items = await all(deps.storage.resources, activeOnly ? { active: true } : {});
  return items.map(({ id, data }) => ({ ...data, id })).sort(byPosition);
}

export type ResourceInput = Partial<Omit<Resource, 'id'>> & { id?: string; name?: string };

export async function saveResource(
  deps: Pick<Deps, 'storage'>,
  input: ResourceInput
): Promise<Resource> {
  const existing = input.id ? await deps.storage.resources.get(input.id) : null;
  if (input.id && !existing) throw new BookingError('NOT_FOUND', `No resource ${input.id}`, 404);
  if (!existing && (await deps.storage.resources.count()) >= LIMITS.resources)
    throw new BookingError('INVALID', `At most ${LIMITS.resources} resources`);
  const id = input.id ?? crypto.randomUUID();
  if (id === DEFAULT_RESOURCE_ID) throw new BookingError('INVALID', 'That id is reserved');
  const resource = {
    ...(existing ?? { active: true }),
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    id,
  } as Resource & { hours?: Resource['hours'] | null };
  if (resource.hours === null) delete resource.hours; // null: the site's hours again
  resource.name = String(resource.name ?? '')
    .trim()
    .slice(0, 100);
  if (resource.description !== undefined)
    resource.description = resource.description.trim().slice(0, 500);
  if (resource.exceptions)
    resource.exceptions = [...resource.exceptions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const problems = resourceProblems(resource);
  if (problems.length) throw new BookingError('INVALID_RESOURCE', problems.join('; '));
  await deps.storage.resources.put(id, resource);
  return resource;
}

/** Deletes a resource with no upcoming bookings (move or cancel them first). */
export async function deleteResource(deps: Deps, id: string): Promise<boolean> {
  const upcoming = (
    await all(deps.storage.bookings, {
      resourceId: id,
      start: { gt: iso(deps.now()) },
    })
  ).filter(({ data }) => isActive(data, deps.now()));
  if (upcoming.length)
    throw new BookingError(
      'HAS_BOOKINGS',
      `It has ${upcoming.length} upcoming booking(s); cancel them or hide it (active: false) instead.`,
      409
    );
  await deps.kv.delete(calendarKey(id));
  return deps.storage.resources.delete(id);
}

const implicitResource = (): Resource => ({ id: DEFAULT_RESOURCE_ID, name: '', active: true });

/**
 * The resources that can take a service, in order: the one asked for, or all that offer it
 * (`any`). Without stored resources, the implicit one.
 */
async function resourcesFor(deps: Deps, service: Service, wanted?: string): Promise<Resource[]> {
  const stored = await listResources(deps, true);
  if (stored.length === 0)
    return !wanted || wanted === 'any' || wanted === DEFAULT_RESOURCE_ID
      ? [implicitResource()]
      : [];
  const offering = stored.filter((r) => !r.serviceIds?.length || r.serviceIds.includes(service.id));
  return !wanted || wanted === 'any' ? offering : offering.filter((r) => r.id === wanted);
}

/** The service as this resource does it (its own length, where set). */
const asDoneBy = (service: Service, resource: Resource) => ({
  ...service,
  durationMinutes: resource.durations?.[service.id] ?? service.durationMinutes,
});

const hoursFor =
  (schedule: Schedule, resource: Resource) =>
  (date: string): TimeRange[] =>
    resourceHoursOn(schedule, resource.id === DEFAULT_RESOURCE_ID ? undefined : resource, date);

// --- Busy time and free times ---

const holding = new Set<BookingStatus>(['pending', 'requested']);
const isActive = (b: Booking, now: number) =>
  b.status === 'confirmed' ||
  (holding.has(b.status) && !!b.holdUntil && Date.parse(b.holdUntil) > now);

const resourceOf = (b: Pick<Booking, 'resourceId'>) => b.resourceId ?? DEFAULT_RESOURCE_ID;

/**
 * Busy intervals of a resource in [from, to): its active bookings (with buffers) and those of the
 * implicit resource (bookings from before resources count for everyone), blocks for it or for
 * everyone, and the site's and the resource's own calendars.
 */
export async function busyBetween(
  deps: Pick<Deps, 'storage' | 'kv' | 'now'>,
  from: number,
  to: number,
  exceptBooking?: string,
  resourceId: string = DEFAULT_RESOURCE_ID
): Promise<Interval[]> {
  const now = deps.now();
  const bookings = await all(deps.storage.bookings, {
    status: { in: ['pending', 'requested', 'confirmed'] },
    start: { gte: iso(from - MAX_SERVICE_MINUTES * MINUTE_MS), lt: iso(to) },
  });
  const counts = (b: Booking) =>
    resourceId === DEFAULT_RESOURCE_ID ||
    resourceOf(b) === resourceId ||
    resourceOf(b) === DEFAULT_RESOURCE_ID;
  const busy: Interval[] = bookings
    .filter(({ id, data }) => id !== exceptBooking && isActive(data, now) && counts(data))
    .map(({ data }) => ({ start: Date.parse(data.start), end: Date.parse(data.busyEnd) }));
  const blocks = await all(deps.storage.blocks, { end: { gt: iso(from) } });
  for (const { data } of blocks)
    if (!data.resourceId || data.resourceId === resourceId)
      busy.push({ start: Date.parse(data.start), end: Date.parse(data.end) });
  for (const key of new Set([KV.calendar, calendarKey(resourceId)])) {
    const cal = await deps.kv.get<CalendarConnection>(key);
    if (cal) busy.push(...cal.busy);
  }
  return merge(busy.filter((b) => b.end > from && b.start < to));
}

export interface DaySlots {
  date: string;
  /** Free starts as ISO instants, local "HH:MM" for display, and who is free then. */
  starts: { start: string; time: string; resources: string[] }[];
}

interface PublicResource {
  id: string;
  name: string;
  description?: string;
}

const publicResource = (r: Resource): PublicResource => ({
  id: r.id,
  name: r.name,
  ...(r.description ? { description: r.description } : {}),
});

/**
 * Free starts of a service per local date, `days` dates from `from` (today if not given), for
 * one resource or any that offers it.
 */
export async function slots(
  deps: Deps,
  serviceId: string,
  from?: string,
  days = 14,
  resourceId?: string,
  exceptBooking?: string
): Promise<{
  service: Service;
  resources: PublicResource[];
  days: DaySlots[];
  firstDate: string;
  lastDate: string;
}> {
  const service = await activeService(deps, serviceId);
  const schedule = await getSchedule(deps);
  const now = deps.now();
  const today = toLocal(now).date;
  const lastDate = addDays(today, schedule.maxDaysAhead);
  const first = from && isDate(from) && from > today ? from : today;
  const last = addDays(first, Math.min(Math.max(days, 1), 62) - 1);
  const all = await resourcesFor(deps, service);
  const chosen = resourceId && resourceId !== 'any' ? all.filter((r) => r.id === resourceId) : all;
  const byDate = new Map<string, DaySlots>();
  for (let d = first; d <= last && d <= lastDate; d = addDays(d, 1))
    byDate.set(d, { date: d, starts: [] });
  const byStart = new Map<number, string[]>();
  for (const resource of chosen) {
    const busy = await busyBetween(
      deps,
      now,
      Date.parse(`${addDays(last, 2)}T00:00:00Z`),
      exceptBooking,
      resource.id
    );
    for (const s of freeStarts(
      schedule,
      asDoneBy(service, resource),
      busy,
      now,
      first,
      last,
      hoursFor(schedule, resource)
    ))
      byStart.set(s, [...(byStart.get(s) ?? []), resource.id]);
  }
  for (const [s, resources] of [...byStart].sort((a, b) => a[0] - b[0])) {
    const l = toLocal(s);
    byDate.get(l.date)?.starts.push({ start: iso(s), time: l.time, resources });
  }
  return {
    service,
    resources: all.filter((r) => r.id !== DEFAULT_RESOURCE_ID).map(publicResource),
    days: [...byDate.values()],
    firstDate: today,
    lastDate,
  };
}

// --- Locks ---

async function acquireLocks(
  deps: Deps,
  bookingId: string,
  interval: Interval,
  resourceId: string
): Promise<string[] | null> {
  const now = deps.now();
  const got: string[] = [];
  const fresh: string[] = [];
  const lock = { bookingId, until: iso(interval.end) };
  for (const cell of lockCells(interval, resourceId)) {
    let ok = (await deps.storage.locks.compareAndSet(cell, null, lock)).applied;
    if (ok) fresh.push(cell);
    else {
      // Its own cell (moving a booking), or one left by a booking that no longer holds its
      // time (expired hold, cancelled, gone), which is taken over.
      const existing = await deps.storage.locks.get(cell);
      const owner = existing && (await deps.storage.bookings.get(existing.bookingId));
      if (existing && existing.bookingId === bookingId) ok = true;
      else if (!owner || !isActive(owner, now)) {
        await deps.storage.locks.delete(cell);
        ok = (await deps.storage.locks.compareAndSet(cell, null, lock)).applied;
        if (ok) fresh.push(cell);
      }
    }
    if (!ok) {
      if (fresh.length) await deps.storage.locks.deleteMany(fresh);
      return null;
    }
    got.push(cell);
  }
  return got;
}

async function releaseLocks(
  deps: Pick<Deps, 'storage'>,
  bookingId: string,
  keep: ReadonlySet<string> = new Set()
): Promise<void> {
  const locks = (await all(deps.storage.locks, { bookingId })).filter((l) => !keep.has(l.id));
  if (locks.length) await deps.storage.locks.deleteMany(locks.map((l) => l.id));
}

// --- Links ---

export type LinkAction = 'confirm' | 'cancel' | 'rebook';

export async function signedLink(deps: Deps, action: LinkAction, bookingId: string) {
  const s = await sign(await secret(deps), action, bookingId);
  return `${base(deps)}${LINK_PATH}?${new URLSearchParams({ a: action, b: bookingId, s })}`;
}

export async function verifyLink(deps: Deps, action: string, bookingId: string, signature: string) {
  if (action !== 'confirm' && action !== 'cancel' && action !== 'rebook') return false;
  return verify(await secret(deps), action, bookingId, signature);
}

async function visitorLinks(deps: Deps, id: string): Promise<VisitorLinks> {
  return {
    cancel: await signedLink(deps, 'cancel', id),
    rebook: await signedLink(deps, 'rebook', id),
  };
}

async function feedKey(deps: Deps, resourceId?: string): Promise<string> {
  const version = (await deps.kv.get<number>(KV.feedVersion)) ?? 1;
  const value = resourceId ? `${version}:${resourceId}` : String(version);
  return `${version}.${await sign(await secret(deps), 'feed', value)}`;
}

/** The secret feed of all bookings, or of one resource's. */
export async function feedUrl(deps: Deps, resourceId?: string): Promise<string> {
  return routeUrl(deps, 'feed', {
    k: await feedKey(deps, resourceId),
    ...(resourceId ? { r: resourceId } : {}),
  });
}

/** New feed addresses (all of them); the old ones stop working. */
export async function rotateFeed(deps: Deps): Promise<string> {
  const version = (await deps.kv.get<number>(KV.feedVersion)) ?? 1;
  await deps.kv.set(KV.feedVersion, version + 1);
  return feedUrl(deps);
}

// --- Booking ---

export interface BookInput {
  serviceId: string;
  /** A resource's id, or `any` (or absent) for whoever is free. */
  resourceId?: string;
  start: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  /** Answers to the service's questions, by question id. */
  answers?: Record<string, string>;
  /** Honeypot: people leave it empty. */
  website?: string;
  /** Cloudflare Turnstile's token, when the site has Turnstile. */
  turnstileToken?: string;
}

export interface BookResult {
  /** pending: confirm by email; requested: waiting for the business; confirmed: done. */
  status: 'pending' | 'requested' | 'confirmed';
  holdMinutes?: number;
  resourceName?: string;
}

async function ipHash(deps: Deps, ip: string | null): Promise<string | undefined> {
  if (!ip) return undefined;
  const data = new TextEncoder().encode(`${await secret(deps)}:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const longText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

function answersFor(deps: Deps, service: Service, input: Record<string, string> | undefined) {
  const out: { label: string; value: string }[] = [];
  for (const q of service.questions ?? []) {
    const raw = input?.[q.id];
    const value = q.long ? longText(raw, LIMITS.longAnswer) : text(raw, LIMITS.answer);
    if (!value && q.required)
      throw new BookingError('INVALID', deps.site.text.errors.missingAnswer(q.label));
    if (value) out.push({ label: q.label, value });
  }
  return out;
}

async function checkLimits(deps: Deps, email: string, hash: string | undefined, now: number) {
  const busy = () => new BookingError('RATE_LIMITED', deps.site.text.errors.rateLimited, 429);
  if (hash) {
    const recent = await deps.storage.bookings.count({
      ipHash: hash,
      createdAt: { gt: iso(now - 3_600_000) },
    });
    if (recent >= LIMITS.perIpPerHour) throw busy();
  }
  const lastHour = await deps.storage.bookings.count({
    status: 'pending',
    createdAt: { gt: iso(now - 3_600_000) },
  });
  if (lastHour >= LIMITS.pendingPerHour)
    throw new BookingError('RATE_LIMITED', deps.site.text.errors.busy, 429);
  const today = await deps.storage.bookings.count({ email, createdAt: { gt: iso(now - DAY_MS) } });
  if (today >= LIMITS.perEmailPerDay) throw busy();
  const upcoming = (
    await all(deps.storage.bookings, { email, createdAt: { gt: iso(now - 400 * DAY_MS) } })
  ).filter(({ data }) => isActive(data, now) && Date.parse(data.start) > now);
  if (upcoming.length >= LIMITS.activePerEmail)
    throw new BookingError('TOO_MANY', deps.site.text.errors.tooMany(upcoming.length), 409);
}

/**
 * A visitor's booking. Its time is held at once. With a valid Turnstile token it counts straight
 * away (or, in request mode, goes to the business); without, a confirmation link is emailed.
 */
export async function book(deps: Deps, input: BookInput, ip: string | null): Promise<BookResult> {
  if (input.website) return { status: 'pending', holdMinutes: HOLD_MINUTES }; // a bot: store nothing

  const name = text(input.name, LIMITS.name);
  const email = text(input.email, LIMITS.email).toLowerCase();
  const phone = text(input.phone, LIMITS.phone) || undefined;
  const message = longText(input.message, LIMITS.message) || undefined;
  if (!name) throw new BookingError('INVALID', deps.site.text.errors.missingName);
  if (!EMAIL.test(email)) throw new BookingError('INVALID', deps.site.text.errors.invalidEmail);

  const service = await activeService(deps, input.serviceId);
  const answers = answersFor(deps, service, input.answers);
  const start = Date.parse(input.start);
  if (!Number.isFinite(start)) throw new BookingError('INVALID', deps.site.text.errors.noTime);

  const now = deps.now();
  const hash = await ipHash(deps, ip);
  await checkLimits(deps, email, hash, now);

  const candidates = await resourcesFor(deps, service, input.resourceId);
  if (candidates.length === 0)
    throw new BookingError('NO_RESOURCE', deps.site.text.errors.noResource, 404);
  const schedule = await getSchedule(deps);
  const id = crypto.randomUUID();
  let chosen: { resource: Resource; need: Interval; durationMinutes: number } | undefined;
  for (const resource of candidates) {
    const done = asDoneBy(service, resource);
    const need = occupied(done, start);
    const busy = await busyBetween(deps, start - DAY_MS, need.end + DAY_MS, undefined, resource.id);
    if (!isFreeStart(schedule, done, busy, now, start, hoursFor(schedule, resource))) continue;
    if (await acquireLocks(deps, id, need, resource.id)) {
      chosen = { resource, need, durationMinutes: done.durationMinutes };
      break;
    }
  }
  if (!chosen) throw taken(deps);

  const { resource, need } = chosen;
  const booking: Booking = {
    serviceId: service.id,
    serviceName: service.name,
    start: iso(start),
    end: iso(start + chosen.durationMinutes * MINUTE_MS),
    busyEnd: iso(need.end),
    status: 'pending',
    ...(resource.id !== DEFAULT_RESOURCE_ID
      ? { resourceId: resource.id, resourceName: resource.name }
      : {}),
    mode: service.mode ?? 'instant',
    ...(service.cancelHours ? { cancelHours: service.cancelHours } : {}),
    ...(answers.length ? { answers } : {}),
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

  const human =
    !!deps.verifyHuman &&
    !!input.turnstileToken &&
    (await deps.verifyHuman(input.turnstileToken).catch(() => false));
  const resourceName = booking.resourceName ? { resourceName: booking.resourceName } : {};
  if (human) return { status: await visitorConfirmed(deps, id, booking), ...resourceName };

  try {
    await deps.send(
      confirmRequestMail(deps.site, booking, await signedLink(deps, 'confirm', id), HOLD_MINUTES)
    );
  } catch (error) {
    deps.log.error('booking: the confirmation email failed', { error: String(error) });
    await releaseLocks(deps, id);
    await deps.storage.bookings.delete(id);
    throw new BookingError('EMAIL_FAILED', deps.site.text.errors.mailFailed, 502);
  }
  return { status: 'pending', holdMinutes: HOLD_MINUTES, ...resourceName };
}

function icsEvent(deps: Deps, id: string, b: Booking, location?: string): IcsEvent {
  return {
    uid: `${id}@${UID_DOMAIN}`,
    start: Date.parse(b.start),
    end: Date.parse(b.end),
    summary: `${b.serviceName}${b.resourceName ? ` (${b.resourceName})` : ''} – ${deps.site.name}`,
    ...(location ? { location } : {}),
    sequence: b.sequence,
    cancelled: b.status === 'cancelled',
  };
}

/** The visitor is known to be a person: the booking counts, or goes to the business. */
async function visitorConfirmed(
  deps: Deps,
  id: string,
  booking: Booking
): Promise<'confirmed' | 'requested'> {
  if (booking.mode !== 'request') {
    await finaliseConfirmed(deps, id, booking, true);
    return 'confirmed';
  }
  const now = deps.now();
  const holdUntil = iso(
    Math.min(now + REQUEST_HOLD_HOURS * 3_600_000, Date.parse(booking.start) - 30 * MINUTE_MS)
  );
  const requested: Booking = {
    ...booking,
    status: 'requested',
    holdUntil,
    deleteAfter: iso(Date.parse(booking.end) + RETENTION_DAYS * DAY_MS),
  };
  await deps.storage.bookings.put(id, requested);
  await notifyVisitor(
    deps,
    requestReceivedMail(deps.site, requested, await signedLink(deps, 'cancel', id)),
    'request receipt'
  );
  await notifyBusiness(
    deps,
    (to) => newRequestMail(deps.site, to, requested, adminUrl(deps), holdUntil),
    'request notification'
  );
  return 'requested';
}

async function finaliseConfirmed(deps: Deps, id: string, booking: Booking, notifyStaff: boolean) {
  const now = deps.now();
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
  await notifyVisitor(
    deps,
    confirmedMail(deps.site, confirmed, await visitorLinks(deps, id), ics, location),
    'confirmation to the visitor'
  );
  if (notifyStaff)
    await notifyBusiness(
      deps,
      (to) => newBookingMail(deps.site, to, confirmed, ics, adminUrl(deps)),
      'notification'
    );
  return confirmed;
}

/** Takes the booking's time again after its hold ran out, if it is still free. */
async function retake(deps: Deps, id: string, booking: Booking): Promise<boolean> {
  const need = { start: Date.parse(booking.start), end: Date.parse(booking.busyEnd) };
  const rid = resourceOf(booking);
  const busy = await busyBetween(deps, need.start, need.end, id, rid);
  return !busy.some((b) => overlaps(b, need)) && !!(await acquireLocks(deps, id, need, rid));
}

export type ConfirmResult = 'confirmed' | 'requested' | 'already' | 'gone' | 'cancelled' | 'past';

/** The visitor confirms by the link in the email. */
export async function confirm(deps: Deps, id: string): Promise<ConfirmResult> {
  const booking = await deps.storage.bookings.get(id);
  if (!booking) return 'gone';
  if (booking.status === 'confirmed' || booking.status === 'requested') return 'already';
  if (booking.status === 'cancelled' || booking.status === 'declined') return 'cancelled';
  const now = deps.now();
  if (Date.parse(booking.start) <= now) return 'past';
  if (!isActive(booking, now) && !(await retake(deps, id, booking))) {
    if (booking.status === 'pending')
      await deps.storage.bookings.put(id, { ...booking, status: 'expired' });
    return 'gone';
  }
  return visitorConfirmed(deps, id, booking);
}

/** The business approves a request: it counts, and the visitor gets the confirmation. */
export async function approve(deps: Deps, id: string): Promise<'confirmed' | 'gone' | 'past'> {
  const booking = await deps.storage.bookings.get(id);
  if (!booking) return 'gone';
  if (booking.status === 'confirmed') return 'confirmed';
  if (booking.status !== 'requested' && booking.status !== 'expired') return 'gone';
  if (Date.parse(booking.start) <= deps.now()) return 'past';
  if (!isActive(booking, deps.now()) && !(await retake(deps, id, booking))) return 'gone';
  await finaliseConfirmed(deps, id, booking, false);
  return 'confirmed';
}

/** The business declines a request (or an unconfirmed booking): the time is free again. */
export async function decline(
  deps: Deps,
  id: string,
  reason?: string
): Promise<'declined' | 'gone'> {
  const booking = await deps.storage.bookings.get(id);
  if (!booking || (booking.status !== 'requested' && booking.status !== 'pending')) return 'gone';
  const now = deps.now();
  const { holdUntil: _hold, ...rest } = booking;
  const declined: Booking = {
    ...rest,
    status: 'declined',
    ...(reason?.trim() ? { declineReason: reason.trim().slice(0, LIMITS.reason) } : {}),
    cancelledAt: iso(now),
    cancelledBy: 'staff',
    deleteAfter: iso(now + EXPIRED_RETENTION_DAYS * DAY_MS),
  };
  await deps.storage.bookings.put(id, declined);
  await releaseLocks(deps, id);
  if (booking.status === 'requested')
    await notifyVisitor(deps, declinedMail(deps.site, declined), 'decline');
  return 'declined';
}

/** Whether the visitor may still cancel or move: until the service's deadline before the start. */
function beforeDeadline(booking: Booking, now: number): boolean {
  return Date.parse(booking.start) - (booking.cancelHours ?? 0) * 3_600_000 > now;
}

export type CancelResult = 'cancelled' | 'already' | 'gone' | 'past' | 'late';

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
  if (booking.status === 'expired' || booking.status === 'declined') return 'gone';
  const now = deps.now();
  if (by === 'visitor' && Date.parse(booking.start) <= now) return 'past';
  const wasConfirmed = booking.status === 'confirmed';
  if (by === 'visitor' && wasConfirmed && !beforeDeadline(booking, now)) return 'late';
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
    await notifyVisitor(
      deps,
      cancelledMail(deps.site, cancelled, ics, by === 'staff'),
      'cancellation to the visitor'
    );
  await notifyBusiness(
    deps,
    (to) => cancelledNoticeMail(deps.site, to, cancelled, ics, adminUrl(deps)),
    'cancellation notice'
  );
  return 'cancelled';
}

// --- Moving a booking (the visitor's rebook link) ---

/** What a booking may move to: free starts of its service with the same resource. */
export async function rebookOptions(deps: Deps, id: string, from?: string, days = 14) {
  const booking = await deps.storage.bookings.get(id);
  if (!booking || booking.status !== 'confirmed') return { state: 'gone' as const };
  const now = deps.now();
  if (Date.parse(booking.start) <= now) return { state: 'past' as const };
  if (!beforeDeadline(booking, now)) return { state: 'late' as const, booking };
  if ((booking.sequence ?? 0) > LIMITS.moves + 1) return { state: 'limit' as const, booking };
  try {
    const result = await slots(deps, booking.serviceId, from, days, resourceOf(booking), id);
    // The booking keeps its own length (the service may have changed since).
    return { state: 'ok' as const, booking, days: result.days, lastDate: result.lastDate };
  } catch {
    return { state: 'gone' as const };
  }
}

export type RebookResult = 'moved' | 'gone' | 'past' | 'late' | 'taken' | 'limit';

/** Moves a confirmed booking to another free start with the same resource. */
export async function rebook(deps: Deps, id: string, newStart: string): Promise<RebookResult> {
  const booking = await deps.storage.bookings.get(id);
  if (!booking || booking.status !== 'confirmed') return 'gone';
  const now = deps.now();
  if (Date.parse(booking.start) <= now) return 'past';
  if (!beforeDeadline(booking, now)) return 'late';
  if ((booking.sequence ?? 0) > LIMITS.moves + 1) return 'limit';
  const start = Date.parse(newStart);
  if (!Number.isFinite(start)) return 'taken';
  const rid = resourceOf(booking);
  const length = Date.parse(booking.end) - Date.parse(booking.start);
  const buffer = Date.parse(booking.busyEnd) - Date.parse(booking.end);
  const done = { durationMinutes: length / MINUTE_MS, bufferMinutes: buffer / MINUTE_MS };
  const schedule = await getSchedule(deps);
  const resource =
    rid === DEFAULT_RESOURCE_ID
      ? implicitResource()
      : ((await deps.storage.resources.get(rid)) ?? implicitResource());
  const need = occupied(done, start);
  const busy = await busyBetween(deps, start - DAY_MS, need.end + DAY_MS, id, rid);
  if (!isFreeStart(schedule, done, busy, now, start, hoursFor(schedule, { ...resource, id: rid })))
    return 'taken';
  const cells = await acquireLocks(deps, id, need, rid);
  if (!cells) return 'taken';
  await releaseLocks(deps, id, new Set(cells));

  const previous = { start: booking.start, end: booking.end };
  const { reminderSentAt: _sent, ...rest } = booking;
  const moved: Booking = {
    ...rest,
    start: iso(start),
    end: iso(start + length),
    busyEnd: iso(need.end),
    movedAt: iso(now),
    sequence: booking.sequence + 1,
    deleteAfter: iso(start + length + RETENTION_DAYS * DAY_MS),
  };
  await deps.storage.bookings.put(id, moved);
  const { location } = await getSettings(deps);
  const ics = calendar([icsEvent(deps, id, moved, location)], { method: 'PUBLISH', now });
  await notifyVisitor(
    deps,
    confirmedMail(deps.site, moved, await visitorLinks(deps, id), ics, location, true),
    'move confirmation'
  );
  await notifyBusiness(
    deps,
    (to) => changedNoticeMail(deps.site, to, moved, ics, adminUrl(deps), previous),
    'move notice'
  );
  return 'moved';
}

// --- Admin lists ---

export async function listBookings(
  deps: Pick<Deps, 'storage'>,
  options: { from?: string; to?: string; status?: BookingStatus[]; resourceId?: string } = {}
) {
  const where: Record<string, unknown> = {};
  if (options.status?.length) where.status = { in: options.status };
  const range: Record<string, string> = {};
  if (options.from) range.gte = options.from;
  if (options.to) range.lt = options.to;
  if (Object.keys(range).length) where.start = range;
  const items = await all(deps.storage.bookings, where as never, { start: 'asc' }, 1000);
  return items
    .filter(({ data }) => !options.resourceId || resourceOf(data) === options.resourceId)
    .map(({ id, data }) => {
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
  input: { start: string; end: string; note?: string; resourceId?: string }
) {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new BookingError('INVALID', 'start and end must be ISO times, end after start');
  if (end - start > LIMITS.blockDays * DAY_MS)
    throw new BookingError('INVALID', `A block is at most ${LIMITS.blockDays} days`);
  if (input.resourceId && !(await deps.storage.resources.get(input.resourceId)))
    throw new BookingError('NOT_FOUND', `No resource ${input.resourceId}`, 404);
  const id = crypto.randomUUID();
  const block: Block = {
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
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
      status: ['confirmed', 'pending', 'requested'],
    })
  ).filter(
    (b) =>
      Date.parse(b.busyEnd) > start && (!input.resourceId || resourceOf(b) === input.resourceId)
  ).length;
  return { id, ...block, overlappingBookings: overlapping };
}

export async function deleteBlock(deps: Pick<Deps, 'storage'>, id: string) {
  return deps.storage.blocks.delete(id);
}

// --- Calendars in (the business's, and each resource's) ---

const calendarKey = (resourceId?: string) =>
  resourceId && resourceId !== DEFAULT_RESOURCE_ID ? `${KV.calendar}:${resourceId}` : KV.calendar;

export async function getCalendar(deps: Pick<Deps, 'kv'>, resourceId?: string) {
  const cal = await deps.kv.get<CalendarConnection>(calendarKey(resourceId));
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

/** Sets (and reads straight away) or removes a calendar address: the site's, or a resource's. */
export async function setCalendar(deps: Deps, url: string | null, resourceId?: string) {
  if (
    resourceId &&
    resourceId !== DEFAULT_RESOURCE_ID &&
    !(await deps.storage.resources.get(resourceId))
  )
    throw new BookingError('NOT_FOUND', `No resource ${resourceId}`, 404);
  const key = calendarKey(resourceId);
  if (url === null || url.trim() === '') {
    await deps.kv.delete(key);
    return null;
  }
  await deps.kv.set(key, { url: normaliseCalendarUrl(url), busy: [] } satisfies CalendarConnection);
  await refreshCalendar(deps, resourceId);
  return getCalendar(deps, resourceId);
}

export async function refreshCalendar(deps: Deps, resourceId?: string): Promise<void> {
  const key = calendarKey(resourceId);
  const cal = await deps.kv.get<CalendarConnection>(key);
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
    await deps.kv.set(key, {
      url: cal.url,
      busy,
      checkedAt: iso(now),
      okAt: iso(now),
      events: busy.length,
    } satisfies CalendarConnection);
  } catch (error) {
    // Keep the last good busy times; show the error in the admin.
    const message = error instanceof Error ? error.message : String(error);
    await deps.kv.set(key, { ...cal, checkedAt: iso(now), error: message.slice(0, 300) });
    deps.log.warn('booking: reading a calendar failed', { error: message, resourceId });
  }
}

// --- Feed (iCal out) ---

/** The feed's text if the key is right (all bookings, or one resource's), else null. */
export async function feed(deps: Deps, key: string, resourceId?: string): Promise<string | null> {
  const expected = await feedKey(deps, resourceId);
  if (key.length !== expected.length || !(await verifyFeedKey(deps, key, resourceId))) return null;
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
    .filter(({ data }) => !resourceId || resourceOf(data) === resourceId)
    .map(({ id, data }) => ({
      ...icsEvent(deps, id, data, location),
      summary: `${data.serviceName}: ${data.name}${!resourceId && data.resourceName ? ` (${data.resourceName})` : ''}`,
      description: [
        data.email,
        data.phone,
        ...(data.answers ?? []).map((a) => `${a.label}: ${a.value}`),
        data.message,
      ]
        .filter(Boolean)
        .join('\n'),
      updated: Date.parse(data.movedAt ?? data.cancelledAt ?? data.confirmedAt ?? data.createdAt),
    }));
  const resource = resourceId ? await deps.storage.resources.get(resourceId) : null;
  return calendar(events, {
    name: `Bookings – ${resource ? `${resource.name}, ` : ''}${deps.site.name}`,
    now,
  });
}

async function verifyFeedKey(deps: Deps, key: string, resourceId?: string): Promise<boolean> {
  const [version, signature] = key.split('.', 2);
  const current = (await deps.kv.get<number>(KV.feedVersion)) ?? 1;
  if (version !== String(current) || !signature) return false;
  return verify(
    await secret(deps),
    'feed',
    resourceId ? `${version}:${resourceId}` : version,
    signature
  );
}

// --- Cron ---

/**
 * Every 5 minutes (from the platform's minute cron): expire unconfirmed holds and unanswered
 * requests, send reminders, delete what is past retention, read the calendars.
 */
export async function maintenance(deps: Deps, force = false): Promise<Record<string, number>> {
  const now = deps.now();
  const last = await deps.kv.get<number>(KV.maintenance);
  if (!force && last && now - last < MAINTENANCE_EVERY - 5000) return {};
  await deps.kv.set(KV.maintenance, now);
  const done = { expired: 0, lapsed: 0, reminded: 0, deleted: 0, locks: 0 };

  for (const { id, data } of await all(deps.storage.bookings, {
    status: 'pending',
    holdUntil: { lt: iso(now) },
  })) {
    await deps.storage.bookings.put(id, { ...data, status: 'expired' });
    await releaseLocks(deps, id);
    done.expired++;
  }
  for (const { id, data } of await all(deps.storage.bookings, {
    status: 'requested',
    holdUntil: { lt: iso(now) },
  })) {
    const lapsed: Booking = {
      ...data,
      status: 'expired',
      deleteAfter: iso(now + EXPIRED_RETENTION_DAYS * DAY_MS),
    };
    await deps.storage.bookings.put(id, lapsed);
    await releaseLocks(deps, id);
    await notifyVisitor(deps, declinedMail(deps.site, lapsed, true), 'lapsed request');
    done.lapsed++;
  }

  const upcoming = await all(deps.storage.bookings, {
    status: 'confirmed',
    start: { gt: iso(now), lte: iso(now + DAY_MS) },
  });
  const { location } = await getSettings(deps);
  for (const { id, data } of upcoming) {
    if (data.reminderSentAt) continue;
    // No reminder for a booking made (or moved) less than a day and a half before.
    const since = data.movedAt ?? data.confirmedAt ?? data.createdAt;
    if (Date.parse(data.start) - Date.parse(since) < 36 * 3_600_000) continue;
    try {
      await deps.send(reminderMail(deps.site, data, await visitorLinks(deps, id), location));
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

  const resources = await listResources(deps);
  for (const rid of [undefined, ...resources.map((r) => r.id)]) {
    const cal = await deps.kv.get<CalendarConnection>(calendarKey(rid));
    if (
      cal &&
      (force || !cal.checkedAt || now - Date.parse(cal.checkedAt) >= CALENDAR_EVERY - 5000)
    )
      await refreshCalendar(deps, rid);
  }

  if (done.expired || done.lapsed || done.reminded || done.deleted)
    deps.log.info('booking: maintenance', done);
  return done;
}
