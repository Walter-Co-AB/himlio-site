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
  book,
  BookingError,
  cancel,
  confirm,
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
import { swedishWhen } from './messages.js';
import { TIME_ZONE } from './time.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- EmDash's RouteContext
export type Ctx = any;
export type MakeDeps = (ctx: Ctx) => Deps;

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

export const serviceInput = z.object({
  id: id.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int().optional(),
  active: z.boolean().optional(),
  position: z.number().int().optional(),
});

const status = z.enum(['pending', 'confirmed', 'cancelled', 'expired']);
export const bookingsInput = z.object({
  from: isoTime.optional(),
  to: isoTime.optional(),
  status: z.array(status).optional(),
});

export const blockInput = z.object({
  start: isoTime,
  end: isoTime,
  note: z.string().max(200).optional(),
});

export const cancelInput = z.object({
  id,
  notifyVisitor: z.boolean().optional(),
});

const RESULTS = {
  confirm: {
    confirmed: ['Bokningen är bekräftad', 'Du får ett mejl med bokningen och en kalenderfil.'],
    already: ['Bokningen är redan bekräftad', ''],
    gone: [
      'Tiden är inte längre ledig',
      'Bekräftelsen kom för sent och tiden har gått till någon annan. Boka gärna en ny tid.',
    ],
    cancelled: ['Bokningen är avbokad', 'Den här bokningen har avbokats. Boka gärna en ny tid.'],
    past: ['Tiden har redan passerat', ''],
  },
  cancel: {
    cancelled: ['Bokningen är avbokad', 'Du får en bekräftelse på avbokningen med mejl.'],
    already: ['Bokningen är redan avbokad', ''],
    gone: ['Bokningen finns inte', 'Den kan redan ha avbokats eller tagits bort.'],
    past: [
      'Tiden har redan passerat',
      'Det går inte att avboka i efterhand. Kontakta oss om något blev fel.',
    ],
  },
} as const;

export interface LinkView {
  status: number;
  title: string;
  text: string[];
  /** For a GET: the button that POSTs back (confirm or cancel). */
  button?: string;
}

/**
 * The confirm and cancel links in emails, as data for the page the platform middleware renders
 * at /_booking (plugin routes may not serve HTML). `act: false` (the GET) only describes the
 * booking; `act: true` (the button's POST) confirms or cancels.
 */
async function linkView(
  deps: Deps,
  q: { a: string; b: string; s: string; act?: boolean }
): Promise<LinkView> {
  if (!(await verifyLink(deps, q.a, q.b, q.s)))
    return {
      status: 404,
      title: 'Länken fungerar inte',
      text: ['Kontrollera att hela länken från mejlet kom med.'],
    };
  const booking = await getBooking(deps, q.b);
  if (!booking)
    return { status: 404, title: 'Bokningen finns inte', text: ['Den kan redan ha tagits bort.'] };
  const what = `${booking.serviceName}, ${swedishWhen(booking)}`;
  const confirming = q.a === 'confirm';
  if (!q.act)
    return {
      status: 200,
      title: confirming ? 'Bekräfta bokningen' : 'Avboka',
      text: [what],
      button: confirming ? 'Bekräfta bokningen' : 'Avboka tiden',
    };
  const result = confirming ? await confirm(deps, q.b) : await cancel(deps, q.b, 'visitor');
  const [title, text] = (
    RESULTS[confirming ? 'confirm' : 'cancel'] as Record<string, readonly [string, string]>
  )[result]!;
  return { status: 200, title, text: [what, text].filter(Boolean) };
}

export function bookingRoutes(makeDeps: MakeDeps): Record<string, Route> {
  const withDeps =
    <I>(fn: (deps: Deps, input: I, ctx: Ctx) => Promise<unknown>) =>
    (ctx: Ctx) =>
      run(() => fn(makeDeps(ctx), ctx.input as I, ctx));

  return {
    // --- Public ---
    services: {
      public: true,
      input: z.object({}).optional(),
      handler: withDeps(async (deps) => ({
        timeZone: TIME_ZONE,
        items: (await listServices(deps, true)).map(
          ({ id, name, description, durationMinutes }) => ({
            id,
            name,
            description,
            durationMinutes,
          })
        ),
      })),
    },
    slots: {
      public: true,
      input: z.object({
        serviceId: id,
        from: z.string().max(10).optional(),
        days: z.number().int().min(1).max(62).optional(),
      }),
      handler: withDeps(
        async (deps, input: { serviceId: string; from?: string; days?: number }) => {
          const result = await slots(deps, input.serviceId, input.from, input.days ?? 14);
          return {
            timeZone: TIME_ZONE,
            service: {
              id: result.service.id,
              name: result.service.name,
              durationMinutes: result.service.durationMinutes,
            },
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
        start: isoTime,
        name: z.string().max(200),
        email: z.string().max(300),
        phone: z.string().max(100).optional(),
        message: z.string().max(2000).optional(),
        website: z.string().max(500).optional(),
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
      }),
      handler: withDeps((deps, input: { a: string; b: string; s: string; act?: boolean }) =>
        linkView(deps, input)
      ),
    },
    feed: {
      public: true,
      methods: ['GET', 'HEAD'],
      request: { body: 'none' },
      response: 'raw',
      handler: async (ctx: Ctx) => {
        const text = await feed(makeDeps(ctx), String(ctx.input?.k ?? ''));
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
        calendar: await getCalendar(deps),
        feedUrl: await feedUrl(deps),
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
      input: z.object({ url: z.string().max(2000).nullable() }),
      handler: withDeps(async (deps, input: { url: string | null }) => ({
        calendar: await setCalendar(deps, input.url),
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
        'List the bookable services (id, name, description, durationMinutes, bufferMinutes, active, position).',
      route: 'services/list',
      input: z.object({}),
    },
    save_service: {
      description:
        'Create a service (no id) or change one (id; only what you send changes). Lengths in minutes, ' +
        'multiples of 5; bufferMinutes is free time kept after each booking. Names in Swedish unless ' +
        'asked otherwise.',
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
    list_blocked_time: {
      description:
        'List blocked time (holidays, other appointments) from now on, or from `from` (ISO).',
      route: 'blocks/list',
      input: z.object({ from: isoTime.optional() }),
    },
    block_time: {
      description:
        'Block time so it cannot be booked: start and end as ISO date-times with offset (e.g. ' +
        '2026-12-24T00:00:00+01:00), an optional note. Existing bookings are not cancelled; the answer ' +
        'says how many overlap.',
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
        'List bookings by start time, optionally from/to (ISO) and status (pending = not yet ' +
        `confirmed by the visitor, confirmed, cancelled, expired). ${personal}`,
      route: 'bookings/list',
      input: bookingsInput,
    },
    get_booking: {
      description: `Get one booking by id. ${personal}`,
      route: 'bookings/get',
      input: z.object({ id }),
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
