// The booking plugin's routes (under /_emdash/api/plugins/himlio-booking/) and MCP tools.
//
// Public: services, slots, book (the visitor's booking UI), link (confirm and cancel links from
// emails: GET shows a page with a button, POST acts, so email scanners that follow links change
// nothing; the page itself is rendered by the platform middleware at /_booking) and feed (the
// secret iCal feed of bookings).
// Admin: reads need plugins:read (editors and up), writes plugins:manage (admins).
// MCP tools for AI connectors cover services, opening hours, blocked time and bookings (list,
// read, cancel). The calendar address, notification recipients and feed address stay in the
// admin: they decide where the visitors' data goes, like Forms' recipients.

import { z } from 'astro/zod';
import { pluginResponse, PluginRouteError } from 'emdash';
import {
  approve,
  book,
  BookingError,
  cancel,
  confirm,
  decline,
  deleteResource,
  listResources,
  rebook,
  rebookOptions,
  saveResource,
  createBlock,
  deleteBlock,
  deleteService,
  feed,
  feedUrl,
  getBooking,
  getCalendar,
  getSchedule,
  getSettings,
  listBlocks,
  listBookings,
  listServices,
  maintenance,
  rotateFeed,
  saveService,
  setCalendar,
  setSchedule,
  setSettings,
  slots,
  verifyLink,
  type Deps,
} from './core.js';
import { visitorWhen, what } from './messages.js';
import { intlLocale, type BookingText } from './strings.js';
import { addDays, TIME_ZONE, toLocal } from './time.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- EmDash's RouteContext
export type Ctx = any;
export type MakeDeps = (ctx: Ctx) => Deps | Promise<Deps>;

interface Route {
  public?: boolean;
  permission?: string;
  input?: z.ZodType;
  methods?: string[];
  request?: { body: 'none' };
  response?: 'raw';
  cacheControl?: string;
  handler: (ctx: Ctx) => Promise<unknown>;
}

/** Runs core code, turning its refusals into route errors with their status. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BookingError)
      throw new PluginRouteError(error.code, error.message, error.status);
    throw error;
  }
}

const id = z.string().min(1).max(100);
const timeRange = z.object({ start: z.string(), end: z.string() });
const isoTime = z.string().min(10).max(40);

export const scheduleInput = z.object({
  hours: z.array(z.array(timeRange).max(6)).length(7).optional(),
  exceptions: z
    .array(
      z.object({
        date: z.string(),
        hours: z.array(timeRange).max(6),
        note: z.string().max(200).optional(),
      })
    )
    .max(400)
    .optional(),
  stepMinutes: z.number().int().optional(),
  minNoticeMinutes: z.number().int().optional(),
  maxDaysAhead: z.number().int().optional(),
});

const weekHours = z.array(z.array(timeRange).max(6)).length(7);
const dateExceptions = z
  .array(
    z.object({
      date: z.string(),
      hours: z.array(timeRange).max(6),
      note: z.string().max(200).optional(),
    })
  )
  .max(400);

export const serviceInput = z.object({
  id: id.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
  price: z
    .object({ kind: z.enum(['fixed', 'from']), amount: z.number().int() })
    .nullable()
    .optional(),
  mode: z.enum(['instant', 'request']).optional(),
  cancelHours: z.number().int().optional(),
  questions: z
    .array(
      z.object({
        id: z.string().max(40),
        label: z.string().max(200),
        required: z.boolean().optional(),
        long: z.boolean().optional(),
      })
    )
    .max(5)
    .optional(),
});

export const resourceInput = z.object({
  id: id.optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
  hours: weekHours.nullable().optional(),
  exceptions: dateExceptions.optional(),
  serviceIds: z.array(id).max(50).optional(),
  durations: z.record(z.string(), z.number().int()).optional(),
});

const status = z.enum(['pending', 'requested', 'confirmed', 'cancelled', 'declined', 'expired']);
export const bookingsInput = z.object({
  from: isoTime.optional(),
  to: isoTime.optional(),
  status: z.array(status).optional(),
  resourceId: id.optional(),
});

export const blockInput = z.object({
  start: isoTime,
  end: isoTime,
  note: z.string().max(200).optional(),
  resourceId: id.optional(),
});

export const cancelInput = z.object({
  id,
  notifyVisitor: z.boolean().optional(),
});

export interface LinkView {
  status: number;
  title: string;
  text: string[];
  /** For a GET: the button that POSTs back (confirm or cancel). */
  button?: string;
  /** For rebooking: the times to move to, by day (value: the new start), and paging. */
  groups?: { heading: string; choices: { label: string; value: string }[] }[];
  more?: { label: string; from: string }[];
}

const dayHeadings = new Map<string, Intl.DateTimeFormat>();
const dayHeading = (text: BookingText, date: string) => {
  let f = dayHeadings.get(text.lang);
  if (!f)
    dayHeadings.set(
      text.lang,
      (f = new Intl.DateTimeFormat(intlLocale(text.lang), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }))
    );
  return f.format(new Date(`${date}T12:00:00Z`));
};

/**
 * The links in emails, as data for the page the platform middleware renders at /_booking (plugin
 * routes may not serve HTML). Without `act` (the GET) it only describes the booking, or for
 * rebooking lists free times; `act: true` (a button's POST) confirms, cancels or moves to `t`.
 */
async function linkView(
  deps: Deps,
  q: { a: string; b: string; s: string; act?: boolean; t?: string; from?: string }
): Promise<LinkView> {
  const t = deps.site.text;
  const page = t.page;
  if (!(await verifyLink(deps, q.a, q.b, q.s)))
    return { status: 404, title: page.badLink[0], text: [page.badLink[1]] };
  const booking = await getBooking(deps, q.b);
  if (!booking) return { status: 404, title: page.notFound[0], text: [page.notFound[1]] };
  const whatWhen = (b: {
    serviceName: string;
    resourceName?: string;
    start: string;
    end: string;
  }) => `${what(t, b)}, ${visitorWhen(t, b)}`;
  const current = whatWhen(booking);
  const action = q.a as 'confirm' | 'cancel' | 'rebook';
  const answer = (result: string): LinkView => {
    const [title, text] = page.results[action][result] ?? [page.done, ''];
    return { status: 200, title, text: [current, text].filter(Boolean) };
  };

  if (action === 'rebook') {
    if (q.act && q.t) {
      const result = await rebook(deps, q.b, q.t);
      if (result !== 'moved') return answer(result);
      const moved = await getBooking(deps, q.b);
      const [title, text] = page.results.rebook.moved!;
      return { status: 200, title, text: [moved ? whatWhen(moved) : current, text] };
    }
    const options = await rebookOptions(deps, q.b, q.from);
    if (options.state !== 'ok') return answer(options.state);
    const groups = options.days
      .filter((d) => d.starts.length)
      .map((d) => ({
        heading: dayHeading(t, d.date),
        choices: d.starts.map((s) => ({ label: s.time, value: s.start })),
      }));
    const last = options.days.at(-1)?.date;
    const first = options.days[0]?.date;
    const more: { label: string; from: string }[] = [];
    if (first && q.from && q.from > toLocal(deps.now()).date)
      more.push({ label: page.earlier, from: addDays(first, -14) });
    if (last && last < options.lastDate) more.push({ label: page.later, from: addDays(last, 1) });
    return {
      status: 200,
      title: page.rebookTitle,
      text: [page.now(current), groups.length ? page.pickNewTime : page.noTimes],
      groups,
      more,
    };
  }

  const confirming = action === 'confirm';
  if (!q.act)
    return {
      status: 200,
      title: confirming
        ? booking.mode === 'request'
          ? page.confirmRequest
          : page.confirmBooking
        : page.cancelTitle,
      text: [current],
      button: confirming
        ? booking.mode === 'request'
          ? t.sendRequest
          : page.confirmBooking
        : page.cancelButton,
    };
  return answer(confirming ? await confirm(deps, q.b) : await cancel(deps, q.b, 'visitor'));
}

export function bookingRoutes(makeDeps: MakeDeps): Record<string, Route> {
  const withDeps =
    <I>(fn: (deps: Deps, input: I, ctx: Ctx) => Promise<unknown>) =>
    (ctx: Ctx) =>
      run(async () => fn(await makeDeps(ctx), ctx.input as I, ctx));

  return {
    // --- Public ---
    services: {
      public: true,
      input: z.object({}).optional(),
      handler: withDeps(async (deps) => {
        const resources = await listResources(deps, true);
        return {
          timeZone: TIME_ZONE,
          ...(deps.turnstileSiteKey ? { turnstileSiteKey: deps.turnstileSiteKey } : {}),
          items: (await listServices(deps, true))
            .map((s) => {
              const by = resources.filter(
                (r) => !r.serviceIds?.length || r.serviceIds.includes(s.id)
              );
              return {
                id: s.id,
                name: s.name,
                ...(s.description ? { description: s.description } : {}),
                durationMinutes: s.durationMinutes,
                ...(s.price ? { price: s.price } : {}),
                mode: s.mode ?? 'instant',
                ...(s.cancelHours ? { cancelHours: s.cancelHours } : {}),
                questions: s.questions ?? [],
                resources: by.map((r) => ({
                  id: r.id,
                  name: r.name,
                  ...(r.description ? { description: r.description } : {}),
                  durationMinutes: r.durations?.[s.id] ?? s.durationMinutes,
                })),
              };
            })
            // With resources, a service nobody offers can't be booked.
            .filter((s) => resources.length === 0 || s.resources.length > 0),
        };
      }),
    },
    slots: {
      public: true,
      input: z.object({
        serviceId: id,
        resourceId: id.optional(),
        from: z.string().max(10).optional(),
        days: z.number().int().min(1).max(62).optional(),
      }),
      handler: withDeps(
        async (
          deps,
          input: { serviceId: string; resourceId?: string; from?: string; days?: number }
        ) => {
          const result = await slots(
            deps,
            input.serviceId,
            input.from,
            input.days ?? 14,
            input.resourceId
          );
          return {
            timeZone: TIME_ZONE,
            service: {
              id: result.service.id,
              name: result.service.name,
              durationMinutes: result.service.durationMinutes,
            },
            resources: result.resources,
            firstDate: result.firstDate,
            lastDate: result.lastDate,
            days: result.days,
          };
        }
      ),
    },
    book: {
      public: true,
      input: z.object({
        serviceId: id,
        resourceId: id.optional(),
        start: isoTime,
        name: z.string().max(200),
        email: z.string().max(300),
        phone: z.string().max(100).optional(),
        message: z.string().max(2000).optional(),
        answers: z.record(z.string().max(40), z.string().max(2000)).optional(),
        website: z.string().max(500).optional(),
        turnstileToken: z.string().max(4096).optional(),
      }),
      handler: withDeps((deps, input: Parameters<typeof book>[1], ctx) =>
        book(deps, input, ctx.requestMeta?.ip ?? null)
      ),
    },
    link: {
      public: true,
      input: z.object({
        a: z.string().max(20),
        b: id,
        s: z.string().max(100),
        act: z.boolean().optional(),
        t: isoTime.optional(),
        from: z.string().max(10).optional(),
      }),
      handler: withDeps((deps, input: Parameters<typeof linkView>[1]) => linkView(deps, input)),
    },
    feed: {
      public: true,
      methods: ['GET', 'HEAD'],
      request: { body: 'none' },
      response: 'raw',
      handler: async (ctx: Ctx) => {
        const r = ctx.input?.r ? String(ctx.input.r) : undefined;
        const text = await feed(await makeDeps(ctx), String(ctx.input?.k ?? ''), r);
        if (text === null)
          return pluginResponse({ status: 404, body: { kind: 'text', value: 'Not found' } });
        return pluginResponse({
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Cache-Control': 'private, max-age=300',
            'X-Robots-Tag': 'noindex',
          },
          body: { kind: 'text', value: text },
        });
      },
    },

    // --- Admin: resources (people, chairs, rooms) ---
    'resources/list': {
      permission: 'plugins:read',
      handler: withDeps(async (deps) => ({ items: await listResources(deps) })),
    },
    'resources/save': {
      permission: 'plugins:manage',
      input: resourceInput,
      handler: withDeps((deps, input: z.infer<typeof resourceInput>) =>
        saveResource(deps, input as never)
      ),
    },
    'resources/delete': {
      permission: 'plugins:manage',
      input: z.object({ id }),
      handler: withDeps(async (deps, input: { id: string }) => ({
        deleted: await deleteResource(deps, input.id),
      })),
    },

    // --- Admin: services, opening hours, blocked time ---
    'services/list': {
      permission: 'plugins:read',
      handler: withDeps(async (deps) => ({ items: await listServices(deps) })),
    },
    'services/save': {
      permission: 'plugins:manage',
      input: serviceInput,
      handler: withDeps((deps, input: z.infer<typeof serviceInput>) => saveService(deps, input)),
    },
    'services/delete': {
      permission: 'plugins:manage',
      input: z.object({ id }),
      handler: withDeps(async (deps, input: { id: string }) => ({
        deleted: await deleteService(deps, input.id),
      })),
    },
    'schedule/get': {
      permission: 'plugins:read',
      handler: withDeps(async (deps) => ({ timeZone: TIME_ZONE, ...(await getSchedule(deps)) })),
    },
    'schedule/update': {
      permission: 'plugins:manage',
      input: scheduleInput,
      handler: withDeps((deps, input: z.infer<typeof scheduleInput>) =>
        setSchedule(deps, input as never)
      ),
    },
    'blocks/list': {
      permission: 'plugins:read',
      input: z.object({ from: isoTime.optional() }).optional(),
      handler: withDeps(async (deps, input?: { from?: string }) => ({
        items: await listBlocks(deps, input?.from),
      })),
    },
    'blocks/create': {
      permission: 'plugins:manage',
      input: blockInput,
      handler: withDeps((deps, input: z.infer<typeof blockInput>) => createBlock(deps, input)),
    },
    'blocks/delete': {
      permission: 'plugins:manage',
      input: z.object({ id }),
      handler: withDeps(async (deps, input: { id: string }) => ({
        deleted: await deleteBlock(deps, input.id),
      })),
    },

    // --- Admin: bookings ---
    'bookings/list': {
      permission: 'plugins:read',
      input: bookingsInput.optional(),
      handler: withDeps(async (deps, input?: z.infer<typeof bookingsInput>) => ({
        items: await listBookings(deps, input ?? {}),
      })),
    },
    'bookings/get': {
      permission: 'plugins:read',
      input: z.object({ id }),
      handler: withDeps(async (deps, input: { id: string }) => {
        const booking = await getBooking(deps, input.id);
        if (!booking) throw new BookingError('NOT_FOUND', `No booking ${input.id}`, 404);
        return booking;
      }),
    },
    'bookings/approve': {
      permission: 'plugins:manage',
      input: z.object({ id }),
      handler: withDeps(async (deps, input: { id: string }) => ({
        result: await approve(deps, input.id),
      })),
    },
    'bookings/decline': {
      permission: 'plugins:manage',
      input: z.object({ id, reason: z.string().max(500).optional() }),
      handler: withDeps(async (deps, input: { id: string; reason?: string }) => ({
        result: await decline(deps, input.id, input.reason),
      })),
    },
    'bookings/cancel': {
      permission: 'plugins:manage',
      input: cancelInput,
      handler: withDeps(async (deps, input: z.infer<typeof cancelInput>) => ({
        result: await cancel(deps, input.id, 'staff', { notifyVisitor: input.notifyVisitor }),
      })),
    },

    // --- Admin only (not MCP): where the data goes ---
    'settings/get': {
      permission: 'plugins:manage',
      handler: withDeps(async (deps) => ({
        ...(await getSettings(deps)),
        platformNotify: deps.platformNotify,
        turnstile: !!deps.verifyHuman,
        calendar: await getCalendar(deps),
        feedUrl: await feedUrl(deps),
        resources: await Promise.all(
          (await listResources(deps)).map(async (r) => ({
            id: r.id,
            name: r.name,
            calendar: await getCalendar(deps, r.id),
            feedUrl: await feedUrl(deps, r.id),
          }))
        ),
      })),
    },
    'settings/update': {
      permission: 'plugins:manage',
      input: z.object({
        notifyEmails: z.array(z.string().max(254)).max(10).optional(),
        location: z.string().max(200).optional(),
      }),
      handler: withDeps((deps, input: { notifyEmails?: string[]; location?: string }) =>
        setSettings(deps, input)
      ),
    },
    'calendar/set': {
      permission: 'plugins:manage',
      input: z.object({ url: z.string().max(2000).nullable(), resourceId: id.optional() }),
      handler: withDeps(async (deps, input: { url: string | null; resourceId?: string }) => ({
        calendar: await setCalendar(deps, input.url, input.resourceId),
      })),
    },
    'feed/rotate': {
      permission: 'plugins:manage',
      handler: withDeps(async (deps) => ({ feedUrl: await rotateFeed(deps) })),
    },
    // Called by the platform's minute cron (runtime/booking-cron.ts); runs every 5 minutes.
    maintenance: {
      permission: 'plugins:manage',
      input: z.object({ force: z.boolean().optional() }).optional(),
      handler: withDeps((deps, input?: { force?: boolean }) =>
        maintenance(deps, input?.force === true)
      ),
    },
  };
}

const personal =
  "Bookings are visitors' personal data: use them only for what the user asks, and don't copy them " +
  'into site content.';

export function bookingMcpTools() {
  return {
    list_services: {
      description:
        'List the bookable services (id, name, description, durationMinutes, bufferMinutes, active, ' +
        'position, price, mode, cancelHours, questions).',
      route: 'services/list',
      input: z.object({}),
    },
    save_service: {
      description:
        'Create a service (no id) or change one (id; only what you send changes). Lengths in minutes, ' +
        'multiples of 5; bufferMinutes is free time kept after each booking. price: {kind: fixed|from, ' +
        'amount in whole kronor} or null; mode: instant (booked at once) or request (the business ' +
        'approves each); cancelHours: visitors can cancel or move until this many hours before; ' +
        'questions: up to 5 extra form fields {id, label, required, long}. Names and labels are ' +
        "shown to visitors: in the site's language unless asked otherwise; ids in English.",
      route: 'services/save',
      input: serviceInput,
    },
    delete_service: {
      description:
        'Delete a service. Existing bookings keep its name. Prefer active: false to hide it instead.',
      route: 'services/delete',
      input: z.object({ id }),
      destructive: true,
    },
    get_schedule: {
      description:
        'Opening hours for booking (hours: 7 lists of {start,end} "HH:MM", Monday first; exceptions: ' +
        'dates with other hours, an empty list is closed), stepMinutes between start times, ' +
        'minNoticeMinutes, maxDaysAhead. Times are Europe/Stockholm.',
      route: 'schedule/get',
      input: z.object({}),
    },
    update_schedule: {
      description:
        'Change opening hours for booking; only the fields you send change (exceptions replaces the ' +
        'whole list, so read it first). Times "HH:MM" on whole 5 minutes, Europe/Stockholm.',
      route: 'schedule/update',
      input: scheduleInput,
    },
    list_resources: {
      description:
        'List who or what can be booked: people (stylists, tattoo artists), chairs or rooms, with ' +
        "their own hours (absent: the site's), time off (exceptions), services (serviceIds; " +
        'empty: all) and own lengths (durations by service id). No resources: the business as one.',
      route: 'resources/list',
      input: z.object({}),
    },
    save_resource: {
      description:
        'Create a resource (no id) or change one (id; only what you send changes). hours: 7 lists ' +
        "of {start,end}, Monday first, or null for the site's opening hours; exceptions: dates " +
        'with other hours (an empty list is time off) and replaces the whole list, so read it ' +
        'first; serviceIds: what it offers (empty: all); durations: its own length per service id.',
      route: 'resources/save',
      input: resourceInput,
    },
    delete_resource: {
      description:
        'Delete a resource without upcoming bookings. Prefer active: false to stop new bookings.',
      route: 'resources/delete',
      input: z.object({ id }),
      destructive: true,
    },
    list_blocked_time: {
      description:
        'List blocked time (holidays, other appointments) from now on, or from `from` (ISO).',
      route: 'blocks/list',
      input: z.object({ from: isoTime.optional() }),
    },
    block_time: {
      description:
        'Block time so it cannot be booked: start and end as ISO date-times with offset (e.g. ' +
        "2026-12-24T00:00:00+01:00), an optional note, and resourceId for one person's time off " +
        '(absent: everyone). Existing bookings are not cancelled; the answer says how many overlap.',
      route: 'blocks/create',
      input: blockInput,
    },
    unblock_time: {
      description: 'Remove blocked time by id.',
      route: 'blocks/delete',
      input: z.object({ id }),
      destructive: true,
    },
    list_bookings: {
      description:
        'List bookings by start time, optionally from/to (ISO), resourceId and status (pending: ' +
        'not yet confirmed by the visitor; requested: waiting for the business to approve or ' +
        `decline; confirmed; cancelled; declined; expired). ${personal}`,
      route: 'bookings/list',
      input: bookingsInput,
    },
    get_booking: {
      description: `Get one booking by id. ${personal}`,
      route: 'bookings/get',
      input: z.object({ id }),
    },
    approve_booking: {
      description:
        'Approve a requested booking (status requested): it is confirmed and the visitor emailed. ' +
        'Ask the user first.',
      route: 'bookings/approve',
      input: z.object({ id }),
    },
    decline_booking: {
      description:
        "Decline a requested booking, with an optional reason shown to the visitor (in the site's language). " +
        'The time is free again. Ask the user first.',
      route: 'bookings/decline',
      input: z.object({ id, reason: z.string().max(500).optional() }),
      destructive: true,
    },
    cancel_booking: {
      description:
        'Cancel a booking by id: the time is free again, the customer gets a notice, and the visitor ' +
        'an email unless notifyVisitor is false. Ask the user before cancelling.',
      route: 'bookings/cancel',
      input: cancelInput,
      destructive: true,
    },
  };
}
