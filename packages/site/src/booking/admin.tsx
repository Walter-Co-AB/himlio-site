// The booking plugin's admin pages (English, like the rest of the admin):
//   /          Bookings: a week of bookings and blocked time, a booking's details, cancel, block time
//   /settings  Booking settings: services, opening hours, exceptions, rules, notifications,
//              the customer's calendar (iCal in) and the feed of bookings (iCal out)
// Built with EmDash's admin kit (kumo) and inline layout, against the plugin's admin routes.

import { Badge, Button, Checkbox, Input, Loader } from '@cloudflare/kumo';
import { apiFetch } from 'emdash/plugin-utils';
import * as React from 'react';
import { addDays, fromLocal, toLocal, weekdayOf } from './time.js';

const API = '/_emdash/api/plugins/himlio-booking/';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

async function call<T>(route: string, body?: unknown): Promise<T> {
  const res = await apiFetch(API + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => null)) as
    { success: true; data: T } | { success: false; error?: { message?: string } } | null;
  if (!res.ok || !json?.success)
    throw new Error(
      res.status === 403
        ? 'You do not have permission to do this.'
        : (json && !json.success && json.error?.message) || `Request failed (${res.status})`
    );
  return json.data;
}

// --- Types (as the routes return them) ---

interface Service {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes: number;
  active: boolean;
  position?: number;
  price?: { kind: 'fixed' | 'from'; amount: number };
  mode?: 'instant' | 'request';
  cancelHours?: number;
  questions?: Question[];
}
interface Question {
  id: string;
  label: string;
  required?: boolean;
  long?: boolean;
}
interface Resource {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  position?: number;
  hours?: Range[][];
  exceptions?: { date: string; hours: Range[]; note?: string }[];
  serviceIds?: string[];
  durations?: Record<string, number>;
}
interface Range {
  start: string;
  end: string;
}
interface Schedule {
  hours: Range[][];
  exceptions: { date: string; hours: Range[]; note?: string }[];
  stepMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
}
interface Booking {
  id: string;
  serviceName: string;
  start: string;
  end: string;
  status: 'pending' | 'requested' | 'confirmed' | 'cancelled' | 'declined' | 'expired';
  resourceId?: string;
  resourceName?: string;
  mode?: 'instant' | 'request';
  answers?: { label: string; value: string }[];
  declineReason?: string;
  movedAt?: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  createdAt: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}
interface Block {
  id: string;
  resourceId?: string;
  start: string;
  end: string;
  note?: string;
}
interface CalendarStatus {
  url: string;
  checkedAt?: string;
  okAt?: string;
  error?: string;
  events?: number;
}
interface Settings {
  turnstile: boolean;
  resources: { id: string; name: string; calendar: CalendarStatus | null; feedUrl: string }[];
  notifyEmails: string[];
  location?: string;
  platformNotify: string[];
  feedUrl: string;
  calendar: CalendarStatus | null;
}

// --- Small pieces ---

const time = (iso: string) => toLocal(Date.parse(iso)).time;
const dayLabel = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const fullDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Stockholm' });

const STATUS: Record<Booking['status'], { label: string; variant: string }> = {
  confirmed: { label: 'Confirmed', variant: 'success' },
  pending: { label: 'Awaiting the visitor', variant: 'warning' },
  requested: { label: 'Request: answer it', variant: 'info' },
  cancelled: { label: 'Cancelled', variant: 'error' },
  declined: { label: 'Declined', variant: 'error' },
  expired: { label: 'Not confirmed', variant: 'neutral' },
};

function StatusBadge({ status }: { status: Booking['status'] }) {
  const s = STATUS[status];
  return <Badge variant={s.variant as never}>{s.label}</Badge>;
}

const stack = (gap = 12): React.CSSProperties => ({ display: 'grid', gap });
const row = (gap = 8): React.CSSProperties => ({
  display: 'flex',
  gap,
  alignItems: 'center',
  flexWrap: 'wrap',
});
const card: React.CSSProperties = {
  border: '1px solid var(--color-kumo-line, rgba(127,127,127,.25))',
  borderRadius: 8,
  padding: 16,
};
const muted: React.CSSProperties = { opacity: 0.7, fontSize: 13 };

/** A labelled native select (kumo's Select needs more wiring than these lists are worth). */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 500 }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          font: 'inherit',
          fontWeight: 400,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid rgba(127,127,127,.35)',
          background: 'transparent',
          color: 'inherit',
          minHeight: 38,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const useResources = () => useLoad(() => call<{ items: Resource[] }>('resources/list'));

function Message({ error, ok }: { error?: string; ok?: string }) {
  if (error)
    return (
      <p style={{ color: 'var(--color-kumo-danger, #c62828)' }} role="alert">
        {error}
      </p>
    );
  if (ok)
    return (
      <p style={{ color: 'var(--color-kumo-success, #2e7d32)' }} role="status">
        {ok}
      </p>
    );
  return null;
}

function Section({
  title,
  children,
  intro,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ ...card, ...stack(12) }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
      {intro && <p style={{ ...muted, margin: 0 }}>{intro}</p>}
      {children}
    </section>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState('');
  const reload = React.useCallback(() => {
    setError('');
    load().then(setData, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  React.useEffect(reload, [reload]);
  return { data, error, reload };
}

// =============================================================================
// Bookings
// =============================================================================

function mondayOf(date: string) {
  return addDays(date, -weekdayOf(date));
}

function BookingsPage() {
  const today = toLocal(Date.now()).date;
  const [week, setWeek] = React.useState(mondayOf(today));
  const [selected, setSelected] = React.useState<Booking | null>(null);
  const [showCancelled, setShowCancelled] = React.useState(false);
  const [resource, setResource] = React.useState('');
  const resources = useResources();
  const only = resource ? { resourceId: resource } : {};
  const from = new Date(fromLocal(week, '00:00')).toISOString();
  const to = new Date(fromLocal(addDays(week, 7), '00:00')).toISOString();
  const bookings = useLoad(
    () => call<{ items: Booking[] }>('bookings/list', { from, to, ...only }),
    [from, resource]
  );
  const blocks = useLoad(() => call<{ items: Block[] }>('blocks/list', { from }), [from]);
  const upcoming = useLoad(
    () =>
      call<{ items: Booking[] }>('bookings/list', {
        from: new Date().toISOString(),
        status: ['confirmed', 'pending', 'requested'],
        ...only,
      }),
    [resource]
  );
  const reload = () => {
    bookings.reload();
    blocks.reload();
    upcoming.reload();
  };
  const people = resources.data?.items ?? [];
  const requests = (upcoming.data?.items ?? []).filter((b) => b.status === 'requested');

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const visible = (bookings.data?.items ?? []).filter(
    (b) => showCancelled || ['confirmed', 'pending', 'requested'].includes(b.status)
  );
  const blockList = (blocks.data?.items ?? []).filter(
    (b) => !resource || !b.resourceId || b.resourceId === resource
  );
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.name;

  return (
    <div style={{ ...stack(20), padding: 24, maxWidth: 1200 }}>
      <header style={{ ...row(12), justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Bookings</h1>
        <div style={row(8)}>
          <Button variant="secondary" onClick={() => setWeek(addDays(week, -7))}>
            ← Previous
          </Button>
          <Button variant="secondary" onClick={() => setWeek(mondayOf(today))}>
            This week
          </Button>
          <Button variant="secondary" onClick={() => setWeek(addDays(week, 7))}>
            Next →
          </Button>
        </div>
      </header>
      <div style={row(16)}>
        <strong>
          Week of {dayLabel.format(new Date(`${week}T12:00:00Z`))} –{' '}
          {dayLabel.format(new Date(`${addDays(week, 6)}T12:00:00Z`))}
        </strong>
        <Checkbox
          label="Show cancelled and unconfirmed"
          checked={showCancelled}
          onCheckedChange={setShowCancelled}
        />
        {people.length > 0 && (
          <Choice
            label="Show"
            value={resource}
            options={[
              { value: '', label: 'Everyone' },
              ...people.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={setResource}
          />
        )}
        <span style={muted}>Times are Stockholm time.</span>
      </div>
      {requests.length > 0 && (
        <Section
          title={`Requests to answer (${requests.length})`}
          intro="These visitors asked for a time. It is held until you answer, for at most 72 hours."
        >
          <ul style={{ ...stack(6), listStyle: 'none', padding: 0, margin: 0 }}>
            {requests.map((b) => (
              <li key={b.id} style={row(12)}>
                <span>
                  <strong>
                    {fullDate.format(new Date(b.start))} {time(b.start)}
                  </strong>{' '}
                  · {b.serviceName}
                  {b.resourceName ? ` (${b.resourceName})` : ''} · {b.name}
                </span>
                <Button size="sm" onClick={() => setSelected(b)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Message error={bookings.error || blocks.error} />
      {!bookings.data ? (
        <Loader />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          {days.map((day) => {
            const dayStart = fromLocal(day, '00:00');
            const dayEnd = fromLocal(addDays(day, 1), '00:00');
            const items = visible.filter((b) => toLocal(Date.parse(b.start)).date === day);
            const dayBlocks = blockList.filter(
              (b) => Date.parse(b.start) < dayEnd && Date.parse(b.end) > dayStart
            );
            return (
              <div
                key={day}
                style={{
                  ...card,
                  padding: 10,
                  minHeight: 160,
                  ...stack(6),
                  alignContent: 'start',
                  outline: day === today ? '2px solid var(--color-kumo-brand, #2563eb)' : undefined,
                }}
              >
                <strong style={{ fontSize: 13 }}>
                  {dayLabel.format(new Date(`${day}T12:00:00Z`))}
                </strong>
                {dayBlocks.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      ...muted,
                      fontSize: 12,
                      padding: 6,
                      borderRadius: 6,
                      background: 'rgba(127,127,127,.15)',
                    }}
                  >
                    {b.resourceId ? `${nameOf(b.resourceId) ?? 'Someone'} off` : 'Blocked'}{' '}
                    {Date.parse(b.start) <= dayStart ? '' : time(b.start)}
                    {Date.parse(b.end) >= dayEnd ? '' : `–${time(b.end)}`}
                    {b.note ? `: ${b.note}` : ''}
                  </div>
                ))}
                {items.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    style={{
                      textAlign: 'left',
                      font: 'inherit',
                      fontSize: 12,
                      padding: 6,
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: '1px solid rgba(127,127,127,.3)',
                      background: b.status === 'confirmed' ? 'rgba(46,125,50,.12)' : 'transparent',
                      opacity: b.status === 'confirmed' ? 1 : 0.65,
                      color: 'inherit',
                    }}
                  >
                    <strong>
                      {time(b.start)}–{time(b.end)}
                    </strong>
                    <br />
                    {b.serviceName}
                    {b.resourceName && !resource ? ` · ${b.resourceName}` : ''}
                    <br />
                    {b.name}
                    {b.status === 'requested' ? ' (request)' : ''}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <BookingDetails
          booking={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      )}

      <BlockTime blocks={blockList} resources={people} onChanged={reload} />

      <Section
        title="Upcoming"
        intro="Confirmed bookings, requests, and bookings awaiting the visitor's confirmation."
      >
        <Message error={upcoming.error} />
        {!upcoming.data ? (
          <Loader />
        ) : upcoming.data.items.length === 0 ? (
          <p style={muted}>No upcoming bookings.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>When</th>
                <th>Service</th>
                {people.length > 0 && <th>With</th>}
                <th>Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.data.items.map((b) => (
                <tr
                  key={b.id}
                  style={{ borderTop: '1px solid rgba(127,127,127,.2)', cursor: 'pointer' }}
                  onClick={() => setSelected(b)}
                >
                  <td style={{ padding: '6px 4px' }}>
                    {fullDate.format(new Date(b.start))} {time(b.start)}
                  </td>
                  <td>{b.serviceName}</td>
                  {people.length > 0 && <td>{b.resourceName ?? ''}</td>}
                  <td>{b.name}</td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <p style={muted}>
        Bookings are personal data: they are deleted 12 months after the appointment, and
        unconfirmed ones after 30 days.
      </p>
    </div>
  );
}

function BookingDetails({
  booking,
  onClose,
  onChanged,
}: {
  booking: Booking;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [notify, setNotify] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reason, setReason] = React.useState('');
  const active = booking.status === 'confirmed' || booking.status === 'pending';
  const act = async (route: string, body: unknown, question?: string) => {
    if (question && !confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      const { result } = await call<{ result: string }>(route, body);
      if (result !== 'confirmed' && result !== 'declined')
        throw new Error(
          result === 'past'
            ? 'The time has already passed.'
            : 'The time is no longer free, or the request is gone.'
        );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!confirm(`Cancel ${booking.name}'s booking? The time becomes free again.`)) return;
    setBusy(true);
    setError('');
    try {
      await call('bookings/cancel', { id: booking.id, notifyVisitor: notify });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title={`${booking.serviceName}${booking.resourceName ? ` with ${booking.resourceName}` : ''}, ${fullDate.format(new Date(booking.start))} ${time(booking.start)}–${time(booking.end)}`}
    >
      <div style={row(8)}>
        <StatusBadge status={booking.status} />
        <span style={muted}>
          Booked {when(booking.createdAt)}
          {booking.confirmedAt ? `, confirmed ${when(booking.confirmedAt)}` : ''}
          {booking.cancelledAt
            ? `, cancelled ${when(booking.cancelledAt)} by ${booking.cancelledBy}`
            : ''}
          {booking.movedAt ? `, moved by the visitor ${when(booking.movedAt)}` : ''}
        </span>
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          gap: '4px 16px',
          margin: 0,
        }}
      >
        <dt>Name</dt>
        <dd style={{ margin: 0 }}>{booking.name}</dd>
        <dt>Email</dt>
        <dd style={{ margin: 0 }}>
          <a href={`mailto:${booking.email}`}>{booking.email}</a>
        </dd>
        {booking.phone && (
          <>
            <dt>Phone</dt>
            <dd style={{ margin: 0 }}>
              <a href={`tel:${booking.phone.replace(/[^\d+]/g, '')}`}>{booking.phone}</a>
            </dd>
          </>
        )}
        {(booking.answers ?? []).map((a) => (
          <React.Fragment key={a.label}>
            <dt>{a.label}</dt>
            <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.value}</dd>
          </React.Fragment>
        ))}
        {booking.declineReason && (
          <>
            <dt>Reason given</dt>
            <dd style={{ margin: 0 }}>{booking.declineReason}</dd>
          </>
        )}
        {booking.message && (
          <>
            <dt>Message</dt>
            <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{booking.message}</dd>
          </>
        )}
      </dl>
      <Message error={error} />
      {booking.status === 'requested' && (
        <div style={stack(8)}>
          <Input
            label="Reason if you decline (optional, sent to the visitor, in Swedish)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div style={row(8)}>
            <Button onClick={() => act('bookings/approve', { id: booking.id })} disabled={busy}>
              Approve
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                act(
                  'bookings/decline',
                  { id: booking.id, reason: reason || undefined },
                  `Decline ${booking.name}'s request? The time becomes free again.`
                )
              }
              disabled={busy}
            >
              Decline
            </Button>
          </div>
        </div>
      )}
      <div style={row(12)}>
        {active && (
          <>
            {booking.status === 'confirmed' && (
              <Checkbox
                label="Email the visitor about the cancellation"
                checked={notify}
                onCheckedChange={setNotify}
              />
            )}
            <Button variant="destructive" onClick={cancel} disabled={busy}>
              Cancel booking
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Section>
  );
}

function BlockTime({
  blocks,
  resources,
  onChanged,
}: {
  blocks: Block[];
  resources: Resource[];
  onChanged: () => void;
}) {
  const today = toLocal(Date.now()).date;
  const [form, setForm] = React.useState({
    fromDate: today,
    fromTime: '',
    toDate: today,
    toTime: '',
    note: '',
    resourceId: '',
  });
  const [msg, setMsg] = React.useState<{ error?: string; ok?: string }>({});
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setMsg({});
    try {
      const start = fromLocal(form.fromDate, form.fromTime || '00:00');
      const end = form.toTime
        ? fromLocal(form.toDate, form.toTime)
        : fromLocal(addDays(form.toDate, 1), '00:00');
      const result = await call<{ overlappingBookings: number }>('blocks/create', {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        note: form.note || undefined,
        resourceId: form.resourceId || undefined,
      });
      setMsg({
        ok: result.overlappingBookings
          ? `Blocked. ${result.overlappingBookings} existing booking(s) overlap; they are not cancelled.`
          : 'Blocked.',
      });
      onChanged();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  };
  const remove = async (id: string) => {
    await call('blocks/delete', { id }).then(onChanged, (e: Error) => setMsg({ error: e.message }));
  };
  return (
    <Section
      title="Blocked time"
      intro="Time nobody can book: holidays, other appointments. Leave the times empty to block whole days."
    >
      <div style={row(12)}>
        <Input label="From date" type="date" value={form.fromDate} onChange={set('fromDate')} />
        <Input label="From time" type="time" value={form.fromTime} onChange={set('fromTime')} />
        <Input label="To date" type="date" value={form.toDate} onChange={set('toDate')} />
        <Input label="To time" type="time" value={form.toTime} onChange={set('toTime')} />
        <Input label="Note (only you see it)" value={form.note} onChange={set('note')} />
        {resources.length > 0 && (
          <Choice
            label="For"
            value={form.resourceId}
            options={[
              { value: '', label: 'Everyone' },
              ...resources.map((r) => ({ value: r.id, label: r.name })),
            ]}
            onChange={(resourceId) => setForm({ ...form, resourceId })}
          />
        )}
      </div>
      <div>
        <Button onClick={save}>Block time</Button>
      </div>
      <Message {...msg} />
      {blocks.length > 0 && (
        <ul style={{ ...stack(6), listStyle: 'none', padding: 0, margin: 0 }}>
          {blocks.map((b) => (
            <li key={b.id} style={row(12)}>
              <span>
                {when(b.start)} – {when(b.end)}
                {b.resourceId
                  ? ` · ${resources.find((r) => r.id === b.resourceId)?.name ?? 'someone'}`
                  : ''}
                {b.note ? ` (${b.note})` : ''}
              </span>
              <Button variant="secondary" size="sm" onClick={() => remove(b.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// =============================================================================
// Settings
// =============================================================================

function SettingsPage() {
  return (
    <div style={{ ...stack(20), padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Booking settings</h1>
      <TurnstileStatus />
      <Services />
      <Resources />
      <Hours />
      <Notifications />
      <Calendars />
    </div>
  );
}

function TurnstileStatus() {
  const settings = useSettings();
  if (!settings.data) return null;
  return (
    <p style={{ ...muted, margin: 0 }}>
      {settings.data.turnstile
        ? 'One-step booking is on: visitors pass a bot check in the form, and the booking counts at once.'
        : 'Visitors confirm their bookings by email. For one-step booking (a bot check in the form), ask Walter & Co to turn on Turnstile.'}
    </p>
  );
}

const emptyService = {
  name: '',
  description: '',
  durationMinutes: 60,
  bufferMinutes: 0,
  active: true,
  priceKind: 'none' as 'none' | 'fixed' | 'from',
  priceAmount: 0,
  mode: 'instant' as 'instant' | 'request',
  cancelHours: 0,
  questions: [] as Question[],
};

const kr = (p?: Service['price']) =>
  p ? `${p.kind === 'from' ? 'from ' : ''}${p.amount.toLocaleString('sv-SE')} kr` : '';

function Services() {
  const services = useLoad(() => call<{ items: Service[] }>('services/list'));
  const [editing, setEditing] = React.useState<(Partial<Service> & typeof emptyService) | null>(
    null
  );
  const [msg, setMsg] = React.useState<{ error?: string; ok?: string }>({});
  const save = async () => {
    if (!editing) return;
    setMsg({});
    try {
      const { priceKind, priceAmount, ...rest } = editing;
      await call('services/save', {
        ...rest,
        description: editing.description || undefined,
        durationMinutes: Number(editing.durationMinutes),
        bufferMinutes: Number(editing.bufferMinutes),
        cancelHours: Number(editing.cancelHours) || 0,
        price: priceKind === 'none' ? null : { kind: priceKind, amount: Number(priceAmount) },
        questions: editing.questions.filter((q) => q.label.trim()),
      });
      setEditing(null);
      setMsg({ ok: 'Saved.' });
      services.reload();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  };
  const remove = async (s: Service) => {
    if (!confirm(`Delete "${s.name}"? Existing bookings keep their service name.`)) return;
    await call('services/delete', { id: s.id }).then(services.reload, (e: Error) =>
      setMsg({ error: e.message })
    );
  };
  return (
    <Section
      title="Services"
      intro="What visitors can book. Lengths in minutes, in steps of 5; the buffer is free time kept after each booking."
    >
      <Message error={services.error || msg.error} ok={msg.ok} />
      {!services.data ? (
        <Loader />
      ) : (
        <ul style={{ ...stack(8), listStyle: 'none', padding: 0, margin: 0 }}>
          {services.data.items.map((s) => (
            <li key={s.id} style={{ ...row(12), justifyContent: 'space-between' }}>
              <span>
                <strong>{s.name}</strong> · {s.durationMinutes} min
                {s.bufferMinutes ? ` + ${s.bufferMinutes} min buffer` : ''}
                {s.price ? ` · ${kr(s.price)}` : ''}
                {s.mode === 'request' ? ' · by request' : ''}
                {s.cancelHours ? ` · cancel ${s.cancelHours} h before` : ''}
                {!s.active && (
                  <>
                    {' '}
                    <Badge>Hidden</Badge>
                  </>
                )}
              </span>
              <span style={row(8)}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      ...emptyService,
                      ...s,
                      description: s.description ?? '',
                      priceKind: s.price?.kind ?? 'none',
                      priceAmount: s.price?.amount ?? 0,
                      mode: s.mode ?? 'instant',
                      cancelHours: s.cancelHours ?? 0,
                      questions: s.questions ?? [],
                    })
                  }
                >
                  Edit
                </Button>
                <Button variant="secondary" size="sm" onClick={() => remove(s)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
          {services.data.items.length === 0 && (
            <li style={muted}>No services yet: add one so visitors can book.</li>
          )}
        </ul>
      )}
      {editing ? (
        <div style={{ ...stack(10), ...card }}>
          <Input
            label="Name (shown to visitors, Swedish)"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <Input
            label="Description (optional)"
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          />
          <div style={row(12)}>
            <Input
              label="Length (minutes)"
              type="number"
              min={5}
              step={5}
              value={String(editing.durationMinutes)}
              onChange={(e) => setEditing({ ...editing, durationMinutes: Number(e.target.value) })}
            />
            <Input
              label="Buffer after (minutes)"
              type="number"
              min={0}
              step={5}
              value={String(editing.bufferMinutes)}
              onChange={(e) => setEditing({ ...editing, bufferMinutes: Number(e.target.value) })}
            />
          </div>
          <div style={row(12)}>
            <Choice
              label="Price shown"
              value={editing.priceKind}
              options={[
                { value: 'none', label: 'No price' },
                { value: 'fixed', label: 'Fixed price' },
                { value: 'from', label: 'From (starting price)' },
              ]}
              onChange={(v) =>
                setEditing({ ...editing, priceKind: v as 'none' | 'fixed' | 'from' })
              }
            />
            {editing.priceKind !== 'none' && (
              <Input
                label="Price (kr)"
                type="number"
                min={0}
                value={String(editing.priceAmount)}
                onChange={(e) => setEditing({ ...editing, priceAmount: Number(e.target.value) })}
              />
            )}
          </div>
          <div style={row(12)}>
            <Choice
              label="Booking"
              value={editing.mode}
              options={[
                { value: 'instant', label: 'Booked at once' },
                { value: 'request', label: 'By request: you approve each one' },
              ]}
              onChange={(v) => setEditing({ ...editing, mode: v as 'instant' | 'request' })}
            />
            <Input
              label="Visitors can cancel or move until (hours before; 0: until it starts)"
              type="number"
              min={0}
              value={String(editing.cancelHours)}
              onChange={(e) => setEditing({ ...editing, cancelHours: Number(e.target.value) })}
            />
          </div>
          <div style={stack(6)}>
            <strong style={{ fontSize: 14 }}>Questions in the booking form (Swedish)</strong>
            {editing.questions.map((q, i) => (
              <div key={q.id} style={row(8)}>
                <Input
                  label={`Question ${i + 1}`}
                  value={q.label}
                  placeholder="Placering"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      questions: editing.questions.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x
                      ),
                    })
                  }
                />
                <Checkbox
                  label="Required"
                  checked={!!q.required}
                  onCheckedChange={(required) =>
                    setEditing({
                      ...editing,
                      questions: editing.questions.map((x, j) =>
                        j === i ? { ...x, required } : x
                      ),
                    })
                  }
                />
                <Checkbox
                  label="Long answer"
                  checked={!!q.long}
                  onCheckedChange={(long) =>
                    setEditing({
                      ...editing,
                      questions: editing.questions.map((x, j) => (j === i ? { ...x, long } : x)),
                    })
                  }
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      questions: editing.questions.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            {editing.questions.length < 5 && (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      questions: [
                        ...editing.questions,
                        { id: `q${Date.now().toString(36)}`, label: '' },
                      ],
                    })
                  }
                >
                  Add question
                </Button>
              </div>
            )}
          </div>
          <Checkbox
            label="Bookable (shown to visitors)"
            checked={editing.active}
            onCheckedChange={(active) => setEditing({ ...editing, active })}
          />
          <div style={row(8)}>
            <Button onClick={save}>Save service</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setEditing({ ...emptyService })}>
            Add service
          </Button>
        </div>
      )}
    </Section>
  );
}

function RangesEditor({ ranges, onChange }: { ranges: Range[]; onChange: (r: Range[]) => void }) {
  return (
    <div style={row(8)}>
      {ranges.length === 0 && <span style={muted}>Closed</span>}
      {ranges.map((r, i) => (
        <span key={i} style={row(4)}>
          <input
            type="time"
            step={300}
            value={r.start}
            aria-label="Opens"
            onChange={(e) =>
              onChange(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))
            }
          />
          –
          <input
            type="time"
            step={300}
            value={r.end === '24:00' ? '23:59' : r.end}
            aria-label="Closes"
            onChange={(e) =>
              onChange(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))
            }
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange(ranges.filter((_, j) => j !== i))}
            aria-label="Remove these hours"
          >
            ×
          </Button>
        </span>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([
            ...ranges,
            ranges.length ? { start: '13:00', end: '17:00' } : { start: '09:00', end: '17:00' },
          ])
        }
      >
        {ranges.length ? 'Add hours' : 'Open'}
      </Button>
    </div>
  );
}

function Hours() {
  const loaded = useLoad(() => call<Schedule>('schedule/get'));
  const [s, setS] = React.useState<Schedule | null>(null);
  const [msg, setMsg] = React.useState<{ error?: string; ok?: string }>({});
  const [exception, setException] = React.useState({
    date: '',
    closed: true,
    start: '10:00',
    end: '14:00',
    note: '',
  });
  React.useEffect(() => {
    if (loaded.data) setS(loaded.data);
  }, [loaded.data]);
  if (!s)
    return (
      <Section title="Opening hours for booking">
        {loaded.error ? <Message error={loaded.error} /> : <Loader />}
      </Section>
    );
  const save = async (next: Schedule = s) => {
    setMsg({});
    try {
      const saved = await call<Schedule>('schedule/update', {
        hours: next.hours,
        exceptions: next.exceptions,
        stepMinutes: Number(next.stepMinutes),
        minNoticeMinutes: Number(next.minNoticeMinutes),
        maxDaysAhead: Number(next.maxDaysAhead),
      });
      setS(saved);
      setMsg({ ok: 'Saved.' });
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  };
  const addException = () => {
    if (!exception.date) return setMsg({ error: 'Pick a date.' });
    const next = {
      ...s,
      exceptions: [
        ...s.exceptions.filter((e) => e.date !== exception.date),
        {
          date: exception.date,
          hours: exception.closed ? [] : [{ start: exception.start, end: exception.end }],
          ...(exception.note ? { note: exception.note } : {}),
        },
      ],
    };
    void save(next);
  };
  const today = toLocal(Date.now()).date;
  return (
    <Section
      title="Opening hours for booking"
      intro="When visitors can book, Stockholm time. Bookings must fit inside these hours."
    >
      <div style={stack(8)}>
        {DAY_NAMES.map((name, i) => (
          <div
            key={name}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 14 }}>{name}</strong>
            <RangesEditor
              ranges={s.hours[i] ?? []}
              onChange={(r) => setS({ ...s, hours: s.hours.map((h, j) => (j === i ? r : h)) })}
            />
          </div>
        ))}
      </div>
      <div style={row(12)}>
        <Input
          label="Start times every (minutes)"
          type="number"
          min={5}
          step={5}
          value={String(s.stepMinutes)}
          onChange={(e) => setS({ ...s, stepMinutes: Number(e.target.value) })}
        />
        <Input
          label="Earliest booking (hours from now)"
          type="number"
          min={0}
          step={0.5}
          value={String(s.minNoticeMinutes / 60)}
          onChange={(e) =>
            setS({ ...s, minNoticeMinutes: Math.round(Number(e.target.value) * 60) })
          }
        />
        <Input
          label="Bookable up to (days ahead)"
          type="number"
          min={1}
          max={365}
          value={String(s.maxDaysAhead)}
          onChange={(e) => setS({ ...s, maxDaysAhead: Number(e.target.value) })}
        />
      </div>
      <div>
        <Button onClick={() => save()}>Save opening hours</Button>
      </div>
      <Message {...msg} />

      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 0' }}>
        Other hours on specific dates
      </h3>
      <p style={{ ...muted, margin: 0 }}>Holidays, closed days, or a day with other hours.</p>
      <ul style={{ ...stack(6), listStyle: 'none', padding: 0, margin: 0 }}>
        {s.exceptions
          .filter((e) => e.date >= today)
          .map((e) => (
            <li key={e.date} style={row(12)}>
              <span>
                <strong>{fullDate.format(new Date(`${e.date}T12:00:00Z`))}</strong>:{' '}
                {e.hours.length ? e.hours.map((h) => `${h.start}–${h.end}`).join(', ') : 'closed'}
                {e.note ? ` (${e.note})` : ''}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  save({ ...s, exceptions: s.exceptions.filter((x) => x.date !== e.date) })
                }
              >
                Remove
              </Button>
            </li>
          ))}
      </ul>
      <div style={row(12)}>
        <Input
          label="Date"
          type="date"
          value={exception.date}
          onChange={(e) => setException({ ...exception, date: e.target.value })}
        />
        <Checkbox
          label="Closed all day"
          checked={exception.closed}
          onCheckedChange={(closed) => setException({ ...exception, closed })}
        />
        {!exception.closed && (
          <>
            <Input
              label="Opens"
              type="time"
              value={exception.start}
              onChange={(e) => setException({ ...exception, start: e.target.value })}
            />
            <Input
              label="Closes"
              type="time"
              value={exception.end}
              onChange={(e) => setException({ ...exception, end: e.target.value })}
            />
          </>
        )}
        <Input
          label="Note"
          value={exception.note}
          onChange={(e) => setException({ ...exception, note: e.target.value })}
        />
        <Button variant="secondary" onClick={addException}>
          Add date
        </Button>
      </div>
    </Section>
  );
}

function useSettings() {
  return useLoad(() => call<Settings>('settings/get'));
}

function Notifications() {
  const settings = useSettings();
  const [emails, setEmails] = React.useState<string | null>(null);
  const [location, setLocation] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ error?: string; ok?: string }>({});
  const [copied, setCopied] = React.useState(false);
  if (!settings.data)
    return (
      <Section title="Notifications and calendar feed">
        {settings.error ? <Message error={settings.error} /> : <Loader />}
      </Section>
    );
  const d = settings.data;
  const save = async () => {
    setMsg({});
    try {
      await call('settings/update', {
        notifyEmails: (emails ?? d.notifyEmails.join(', ')).split(/[\s,;]+/).filter(Boolean),
        location: location ?? d.location ?? '',
      });
      setMsg({ ok: 'Saved.' });
      settings.reload();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  };
  const rotate = async () => {
    if (!confirm('Make a new feed address? Calendars subscribed to the old one stop updating.'))
      return;
    await call('feed/rotate').then(settings.reload, (e: Error) => setMsg({ error: e.message }));
  };
  return (
    <Section title="Notifications and calendar feed">
      <Input
        label="Email new bookings and cancellations to (comma-separated)"
        value={emails ?? d.notifyEmails.join(', ')}
        placeholder={d.platformNotify.join(', ')}
        onChange={(e) => setEmails(e.target.value)}
      />
      <p style={{ ...muted, margin: 0 }}>
        {d.notifyEmails.length === 0 && d.platformNotify.length
          ? `Empty: they go to ${d.platformNotify.join(', ')} (set by Walter & Co).`
          : d.notifyEmails.length === 0
            ? 'Empty: nobody is notified by email.'
            : ''}
      </p>
      <Input
        label="Address shown in emails and calendar events (optional)"
        value={location ?? d.location ?? ''}
        onChange={(e) => setLocation(e.target.value)}
      />
      <div>
        <Button onClick={save}>Save</Button>
      </div>
      <Message {...msg} />
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 0' }}>
        Bookings in your calendar
      </h3>
      <p style={{ ...muted, margin: 0 }}>
        Subscribe to this address in Google Calendar ("From URL"), Outlook ("Subscribe from web") or
        Apple Calendar ("New calendar subscription"). Calendar apps refresh it every few hours; the
        notification emails come at once. Keep the address secret: it shows the bookings.
      </p>
      <div style={row(8)}>
        <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{d.feedUrl}</code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigator.clipboard.writeText(d.feedUrl).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" size="sm" onClick={rotate}>
          New address
        </Button>
      </div>
    </Section>
  );
}

function CalendarConnect({
  title,
  intro,
  status,
  resourceId,
  onChanged,
}: {
  title: string;
  intro?: string;
  status: CalendarStatus | null;
  resourceId?: string;
  onChanged: () => void;
}) {
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ error?: string; ok?: string }>({});
  const set = async (value: string | null) => {
    setBusy(true);
    setMsg({});
    try {
      await call('calendar/set', { url: value, ...(resourceId ? { resourceId } : {}) });
      setUrl('');
      onChanged();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={stack(8)}>
      <strong style={{ fontSize: 15 }}>{title}</strong>
      {intro && <span style={muted}>{intro}</span>}
      {status ? (
        <div style={stack(6)}>
          <div style={row(8)}>
            {status.error ? (
              <Badge variant={'error' as never}>Error</Badge>
            ) : (
              <Badge variant={'success' as never}>Connected ✓</Badge>
            )}
            <span>{status.url}</span>
            <Button variant="secondary" size="sm" onClick={() => set(null)} disabled={busy}>
              Disconnect
            </Button>
          </div>
          <span style={muted}>
            {status.okAt
              ? `Last read ${when(status.okAt)}, ${status.events ?? 0} busy period(s) ahead.`
              : 'Not read yet.'}
            {status.error
              ? ` Last attempt ${status.checkedAt ? when(status.checkedAt) : ''} failed: ${status.error}`
              : ''}
          </span>
        </div>
      ) : (
        <span style={muted}>Not connected.</span>
      )}
      <div style={row(8)}>
        <Input
          label={status ? 'Replace with another address' : 'Secret iCal address'}
          value={url}
          placeholder="https://… or webcal://…"
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button onClick={() => set(url)} disabled={busy || !url.trim()}>
          {busy ? 'Reading…' : 'Connect'}
        </Button>
      </div>
      <Message {...msg} />
    </div>
  );
}

function FeedLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div style={row(8)}>
      <span style={{ fontSize: 14, minWidth: 90 }}>{label}</span>
      <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{url}</code>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function Calendars() {
  const settings = useSettings();
  if (!settings.data)
    return (
      <Section title="Calendars">
        {settings.error ? <Message error={settings.error} /> : <Loader />}
      </Section>
    );
  const d = settings.data;
  return (
    <Section
      title="Calendars"
      intro="Connect calendars so visitors can't book busy times: paste a calendar's secret iCal address (Google Calendar: Settings → the calendar → Secret address in iCal format; Outlook: Settings → Calendar → Shared calendars → Publish a calendar, ICS). Only busy times are read, every 5 minutes; never what the events are."
    >
      <CalendarConnect
        title="The business's calendar"
        intro="Blocks everyone."
        status={d.calendar}
        onChanged={settings.reload}
      />
      {d.resources.map((r) => (
        <CalendarConnect
          key={r.id}
          title={`${r.name}'s calendar`}
          intro={`Blocks only ${r.name}.`}
          status={r.calendar}
          resourceId={r.id}
          onChanged={settings.reload}
        />
      ))}
      {d.resources.length > 0 && (
        <div style={stack(6)}>
          <strong style={{ fontSize: 15 }}>Each person's bookings as a calendar</strong>
          <span style={muted}>
            For subscribing in their own calendar app; all bookings are under Notifications.
          </span>
          {d.resources.map((r) => (
            <FeedLink key={r.id} label={r.name} url={r.feedUrl} />
          ))}
        </div>
      )}
    </Section>
  );
}

const emptyResource = (): Resource => ({ id: '', name: '', active: true });

function Resources() {
  const resources = useResources();
  const services = useLoad(() => call<{ items: Service[] }>('services/list'));
  const [editing, setEditing] = React.useState<Resource | null>(null);
  const [ownHours, setOwnHours] = React.useState(false);
  const [off, setOff] = React.useState({ from: '', to: '' });
  const [msg, setMsg] = React.useState<{ error?: string; ok?: string }>({});
  const all = services.data?.items ?? [];
  const edit = (r: Resource) => {
    setEditing(r);
    setOwnHours(!!r.hours);
  };
  const save = async () => {
    if (!editing) return;
    setMsg({});
    try {
      const { id, ...rest } = editing;
      await call('resources/save', {
        ...(id ? { id } : {}),
        ...rest,
        hours: ownHours ? (editing.hours ?? DEFAULT_WEEK()) : null,
        durations: Object.fromEntries(
          Object.entries(editing.durations ?? {}).filter(([, v]) => Number(v) > 0)
        ),
      });
      setEditing(null);
      setMsg({ ok: 'Saved.' });
      resources.reload();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  };
  const remove = async (r: Resource) => {
    if (!confirm(`Delete ${r.name}?`)) return;
    await call('resources/delete', { id: r.id }).then(resources.reload, (e: Error) =>
      setMsg({ error: e.message })
    );
  };
  const addTimeOff = () => {
    if (!editing || !off.from) return;
    const to = off.to && off.to >= off.from ? off.to : off.from;
    const dates: string[] = [];
    for (let d = off.from; d <= to && dates.length < 62; d = addDays(d, 1)) dates.push(d);
    const rest = (editing.exceptions ?? []).filter((e) => !dates.includes(e.date));
    setEditing({
      ...editing,
      exceptions: [...rest, ...dates.map((date) => ({ date, hours: [] }))],
    });
    setOff({ from: '', to: '' });
  };
  const today = toLocal(Date.now()).date;
  return (
    <Section
      title="Staff and resources"
      intro="Who or what is booked: people (stylists, tattoo artists), chairs or rooms. Each can have its own hours, time off, services and lengths. With none, bookings are for the business as a whole."
    >
      <Message error={resources.error || msg.error} ok={msg.ok} />
      {!resources.data ? (
        <Loader />
      ) : (
        <ul style={{ ...stack(8), listStyle: 'none', padding: 0, margin: 0 }}>
          {resources.data.items.map((r) => (
            <li key={r.id} style={{ ...row(12), justifyContent: 'space-between' }}>
              <span>
                <strong>{r.name}</strong>
                {r.description ? ` · ${r.description}` : ''}
                {' · '}
                {r.serviceIds?.length
                  ? all
                      .filter((s) => r.serviceIds!.includes(s.id))
                      .map((s) => s.name)
                      .join(', ')
                  : 'all services'}
                {r.hours ? ' · own hours' : ''}
                {!r.active && (
                  <>
                    {' '}
                    <Badge>Hidden</Badge>
                  </>
                )}
              </span>
              <span style={row(8)}>
                <Button variant="secondary" size="sm" onClick={() => edit(r)}>
                  Edit
                </Button>
                <Button variant="secondary" size="sm" onClick={() => remove(r)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
          {resources.data.items.length === 0 && (
            <li style={muted}>None: everything is booked with the business.</li>
          )}
        </ul>
      )}
      {editing ? (
        <div style={{ ...stack(12), ...card }}>
          <div style={row(12)}>
            <Input
              label="Name (shown to visitors)"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              label="Description (optional, e.g. Frisör)"
              value={editing.description ?? ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </div>
          <div style={stack(6)}>
            <strong style={{ fontSize: 14 }}>Services (none ticked: all)</strong>
            <div style={row(12)}>
              {all.map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.name}
                  checked={!!editing.serviceIds?.includes(s.id)}
                  onCheckedChange={(on) =>
                    setEditing({
                      ...editing,
                      serviceIds: on
                        ? [...(editing.serviceIds ?? []), s.id]
                        : (editing.serviceIds ?? []).filter((x) => x !== s.id),
                    })
                  }
                />
              ))}
            </div>
          </div>
          <div style={stack(6)}>
            <strong style={{ fontSize: 14 }}>Own lengths (minutes; empty: the service's)</strong>
            <div style={row(12)}>
              {all
                .filter((s) => !editing.serviceIds?.length || editing.serviceIds.includes(s.id))
                .map((s) => (
                  <Input
                    key={s.id}
                    label={`${s.name} (${s.durationMinutes})`}
                    type="number"
                    min={5}
                    step={5}
                    value={editing.durations?.[s.id] ? String(editing.durations[s.id]) : ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        durations: { ...editing.durations, [s.id]: Number(e.target.value) },
                      })
                    }
                  />
                ))}
            </div>
          </div>
          <div style={stack(6)}>
            <Checkbox
              label="Own working hours (otherwise the opening hours below)"
              checked={ownHours}
              onCheckedChange={(on) => {
                setOwnHours(on);
                if (on && !editing.hours) setEditing({ ...editing, hours: DEFAULT_WEEK() });
              }}
            />
            {ownHours &&
              DAY_NAMES.map((name, i) => (
                <div
                  key={name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '110px 1fr',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{name}</span>
                  <RangesEditor
                    ranges={(editing.hours ?? DEFAULT_WEEK())[i] ?? []}
                    onChange={(r) =>
                      setEditing({
                        ...editing,
                        hours: (editing.hours ?? DEFAULT_WEEK()).map((h, j) => (j === i ? r : h)),
                      })
                    }
                  />
                </div>
              ))}
          </div>
          <div style={stack(6)}>
            <strong style={{ fontSize: 14 }}>Time off</strong>
            {(editing.exceptions ?? [])
              .filter((e) => e.date >= today)
              .map((e) => (
                <div key={e.date} style={row(8)}>
                  <span>
                    {fullDate.format(new Date(`${e.date}T12:00:00Z`))}
                    {e.hours.length
                      ? `: ${e.hours.map((h) => `${h.start}–${h.end}`).join(', ')}`
                      : ''}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        exceptions: (editing.exceptions ?? []).filter((x) => x.date !== e.date),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            <div style={row(8)}>
              <Input
                label="From"
                type="date"
                value={off.from}
                onChange={(e) => setOff({ ...off, from: e.target.value })}
              />
              <Input
                label="To (optional)"
                type="date"
                value={off.to}
                onChange={(e) => setOff({ ...off, to: e.target.value })}
              />
              <Button variant="secondary" onClick={addTimeOff}>
                Add time off
              </Button>
            </div>
          </div>
          <Checkbox
            label="Bookable (shown to visitors)"
            checked={editing.active}
            onCheckedChange={(active) => setEditing({ ...editing, active })}
          />
          <div style={row(8)}>
            <Button onClick={save}>Save</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => edit(emptyResource())}>
            Add person or resource
          </Button>
        </div>
      )}
    </Section>
  );
}

const DEFAULT_WEEK = (): Range[][] => [
  [{ start: '09:00', end: '17:00' }],
  [{ start: '09:00', end: '17:00' }],
  [{ start: '09:00', end: '17:00' }],
  [{ start: '09:00', end: '17:00' }],
  [{ start: '09:00', end: '17:00' }],
  [],
  [],
];

// =============================================================================
// Exports
// =============================================================================

export const pages = {
  '/': BookingsPage,
  '/settings': SettingsPage,
};
