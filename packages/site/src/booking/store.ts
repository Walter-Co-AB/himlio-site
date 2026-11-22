// What the booking plugin stores, and typed access to it. EmDash plugin storage (one D1 table,
// JSON documents with expression indexes) and the plugin's KV; the shapes here are the contract.

import type { Interval, Schedule, Service } from './schedule.js';

export const BOOKING_PLUGIN_ID = 'himlio-booking';
/** The plugin's storage and routes version; bump when they change. */
export const BOOKING_PLUGIN_VERSION = '1.0.0';

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface Booking {
  serviceId: string;
  /** The service's name and length when booked: they show even if the service changes. */
  serviceName: string;
  start: string; // ISO, UTC
  end: string; // start + duration
  busyEnd: string; // end + the service's buffer
  status: BookingStatus;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  createdAt: string;
  /** A pending booking holds its time until then; after it, it expires. */
  holdUntil?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelledBy?: 'visitor' | 'staff';
  reminderSentAt?: string;
  /** Salted hash of the visitor's IP address, for the per-IP limit. */
  ipHash?: string;
  /** Bumped on every change, for calendar apps (SEQUENCE). */
  sequence: number;
  /** Deleted by the cron after this (personal data). */
  deleteAfter: string;
}

export interface Lock {
  bookingId: string;
  /** When the lock stops mattering (the booking's busyEnd); old locks are deleted. */
  until: string;
}

export interface Block {
  start: string; // ISO
  end: string;
  note?: string;
  createdAt: string;
}

export interface BookingSettings {
  /** Who gets new-booking and cancellation emails. Empty: the platform's list (himlio.json). */
  notifyEmails: string[];
  /** Shown in emails and the calendar event, e.g. the address. */
  location?: string;
}

export interface CalendarConnection {
  /** The customer's secret iCal address (https). */
  url: string;
  /** Busy intervals from the last good read. */
  busy: Interval[];
  checkedAt?: string;
  okAt?: string;
  error?: string;
  /** Busy events in the window at the last good read. */
  events?: number;
}

export const KV = {
  schedule: 'state:schedule',
  settings: 'state:settings',
  secret: 'state:secret',
  calendar: 'state:calendar',
  feedVersion: 'state:feedVersion',
  maintenance: 'state:maintenanceAt',
} as const;

/** Indexes the queries below need (declared in the plugin's storage config). */
export const BOOKING_STORAGE = {
  services: { indexes: ['active', 'position'] },
  bookings: {
    indexes: [
      'status',
      'start',
      'email',
      'ipHash',
      'createdAt',
      'deleteAfter',
      ['status', 'start'],
      ['status', 'holdUntil'],
      ['status', 'createdAt'],
      ['email', 'createdAt'],
      ['ipHash', 'createdAt'],
    ],
  },
  locks: { indexes: ['bookingId', 'until'] },
  blocks: { indexes: ['start', 'end'] },
} as const;

// The subset of EmDash's StorageCollection and KVAccess this module uses (tests fake them).

export type Where = Record<
  string,
  | string
  | number
  | boolean
  | null
  | { gt?: string | number; gte?: string | number; lt?: string | number; lte?: string | number }
  | { in: Array<string | number> }
>;

export interface Collection<T> {
  get(id: string): Promise<T | null>;
  put(id: string, data: T): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteMany(ids: string[]): Promise<number>;
  compareAndSet(
    id: string,
    expectedRevision: string | null,
    data: T
  ): Promise<{ applied: boolean }>;
  query(options?: {
    where?: Where;
    orderBy?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: { id: string; data: T }[]; cursor?: string; hasMore: boolean }>;
  count(where?: Where): Promise<number>;
}

export interface Storage {
  services: Collection<Service>;
  bookings: Collection<Booking>;
  locks: Collection<Lock>;
  blocks: Collection<Block>;
}

export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  compareAndSet(
    key: string,
    expectedRevision: string | null,
    value: unknown
  ): Promise<{ applied: boolean }>;
}

/** Every item matching a query, following the cursor (at most `max`). */
export async function all<T>(
  collection: Collection<T>,
  where: Where,
  orderBy?: Record<string, 'asc' | 'desc'>,
  max = 5000
): Promise<{ id: string; data: T }[]> {
  const out: { id: string; data: T }[] = [];
  let cursor: string | undefined;
  do {
    const page = await collection.query({ where, orderBy, limit: 100, cursor });
    out.push(...page.items);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

export type { Schedule, Service };
