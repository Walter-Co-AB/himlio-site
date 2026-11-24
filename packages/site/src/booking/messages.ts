// The emails and link pages of booking. To visitors in the site's language (strings.ts); to
// the customer in English, like the Forms notifications and the admin.

import type { Booking } from './store.js';
import { intlLocale, type BookingText, type Lang } from './strings.js';
import { TIME_ZONE } from './time.js';

const formats = new Map<Lang, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();
function format(lang: Lang) {
  let f = formats.get(lang);
  if (!f) {
    const locale = intlLocale(lang);
    f = {
      date: new Intl.DateTimeFormat(locale, {
        timeZone: TIME_ZONE,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      time: new Intl.DateTimeFormat(locale, {
        timeZone: TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    };
    formats.set(lang, f);
  }
  return f;
}

const enWhen = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Monday 23 November 2026 at 10:00–11:00", in the visitor's language. */
export function visitorWhen(text: BookingText, booking: Pick<Booking, 'start' | 'end'>): string {
  const { date, time } = format(text.lang);
  const start = new Date(booking.start);
  return text.mail.when(date.format(start), time.format(start), time.format(new Date(booking.end)));
}

/** For the customer (English): "Monday, 23 November 2026 at 10:00–11:00 (Stockholm time)". */
export function englishWhen(booking: Pick<Booking, 'start' | 'end'>): string {
  return `${enWhen.format(new Date(booking.start))}–${format('en').time.format(new Date(booking.end))} (Stockholm time)`;
}

/** "Haircut with Anna" (or just the service when nobody in particular is booked). */
export function what(
  text: BookingText,
  booking: Pick<Booking, 'serviceName' | 'resourceName'>
): string {
  return booking.serviceName + (booking.resourceName ? text.withWhom(booking.resourceName) : '');
}

/** "by Sunday 22 November at 10:00", or null without a deadline. */
export function deadlineText(
  text: BookingText,
  booking: Pick<Booking, 'start' | 'cancelHours'>
): string | null {
  if (!booking.cancelHours) return null;
  const { date, time } = format(text.lang);
  const at = new Date(Date.parse(booking.start) - booking.cancelHours * 3_600_000);
  return text.mail.deadline(date.format(at).replace(/,? \d{4}$/, ''), time.format(at));
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** An .ics file, attached when the email transport allows it. */
  ics?: { filename: string; content: string; method: 'PUBLISH' | 'CANCEL' | 'REQUEST' };
}

interface Site {
  name: string;
  /** Where visitors' replies go (himlio.json email.reply_to); else no Reply-To. */
  replyTo?: string;
  /** The visitor texts in the site's language. */
  text: BookingText;
}

/** The visitor's links in confirmations and reminders. */
export interface VisitorLinks {
  cancel: string;
  rebook?: string;
}

const replyTo = (site: Site) => (site.replyTo ? { replyTo: site.replyTo } : {});

const signature = (site: Site) => site.text.mail.signature(site.name);

/** "Haircut with Anna, Monday 23 November 2026 at 10:00–11:00" */
const whatWhen = (site: Site, booking: Booking) =>
  `${what(site.text, booking)}, ${visitorWhen(site.text, booking)}`;

function changeText(site: Site, booking: Booking, links: VisitorLinks): string {
  const m = site.text.mail;
  const deadline = deadlineText(site.text, booking);
  const lines = [deadline ? m.cantComeBy(deadline) : m.cantCome];
  if (links.rebook) lines.push(`${m.rebook}: ${links.rebook}`);
  lines.push(`${m.cancel}: ${links.cancel}`);
  return lines.join('\n');
}

const answersText = (booking: Booking) =>
  booking.answers?.length
    ? booking.answers.map((a) => `${a.label}: ${a.value}`).join('\n') + '\n'
    : '';

export function confirmRequestMail(
  site: Site,
  booking: Booking,
  confirmUrl: string,
  holdMinutes: number
): Mail {
  const m = site.text.mail;
  const kind = booking.mode === 'request' ? m.confirmRequest : m.confirmBooking;
  return {
    to: booking.email,
    ...replyTo(site),
    subject: kind.subject(site.name),
    // Nothing the visitor typed (not even the name): the address isn't proven yet, so this
    // email must be useless for sending someone else a message.
    text:
      `${m.greeting}\n\n` +
      m.confirmBody(
        kind.booked,
        `${what(site.text, booking)} ${visitorWhen(site.text, booking)}`,
        kind.confirmIt,
        holdMinutes,
        confirmUrl
      ) +
      signature(site),
  };
}

export function confirmedMail(
  site: Site,
  booking: Booking,
  links: VisitorLinks,
  ics: string,
  location?: string,
  moved = false
): Mail {
  const m = site.text.mail;
  return {
    to: booking.email,
    ...replyTo(site),
    subject: (moved ? m.movedSubject : m.confirmedSubject)(whatWhen(site, booking)),
    text:
      `${m.hello(booking.name)}\n\n` +
      `${moved ? m.movedLead : m.confirmedLead}:\n\n` +
      `${what(site.text, booking)}\n${visitorWhen(site.text, booking)}\n` +
      (location ? `${location}\n` : '') +
      `\n${m.calendarFile}\n\n` +
      changeText(site, booking, links) +
      signature(site),
    ics: { filename: m.icsFile, content: ics, method: 'PUBLISH' },
  };
}

export function requestReceivedMail(site: Site, booking: Booking, cancelUrl: string): Mail {
  const m = site.text.mail;
  return {
    to: booking.email,
    ...replyTo(site),
    subject: m.requestReceivedSubject(whatWhen(site, booking)),
    text:
      `${m.hello(booking.name)}\n\n` +
      m.requestReceived(`${what(site.text, booking)} ${visitorWhen(site.text, booking)}`) +
      `\n\n${m.withdraw(cancelUrl)}` +
      signature(site),
  };
}

export function declinedMail(site: Site, booking: Booking, expired = false): Mail {
  const m = site.text.mail;
  const subject = `${what(site.text, booking)} ${visitorWhen(site.text, booking)}`;
  return {
    to: booking.email,
    ...replyTo(site),
    subject: m.declinedSubject(whatWhen(site, booking)),
    text:
      `${m.hello(booking.name)}\n\n` +
      (expired ? m.expired(subject) : m.declined(subject)) +
      (booking.declineReason ? `\n\n${booking.declineReason}\n\n` : '') +
      m.declinedOutro +
      signature(site),
  };
}

export function reminderMail(
  site: Site,
  booking: Booking,
  links: VisitorLinks,
  location?: string
): Mail {
  const m = site.text.mail;
  return {
    to: booking.email,
    ...replyTo(site),
    subject: m.reminderSubject(whatWhen(site, booking)),
    text:
      `${m.hello(booking.name)}\n\n` +
      `${m.reminder(`${what(site.text, booking)} ${visitorWhen(site.text, booking)}`)}\n` +
      (location ? `${location}\n` : '') +
      '\n' +
      changeText(site, booking, links) +
      signature(site),
  };
}

export function cancelledMail(site: Site, booking: Booking, ics: string, byStaff: boolean): Mail {
  const m = site.text.mail;
  const subject = `${what(site.text, booking)} ${visitorWhen(site.text, booking)}`;
  return {
    to: booking.email,
    ...replyTo(site),
    subject: m.cancelledSubject(whatWhen(site, booking)),
    text:
      `${m.hello(booking.name)}\n\n` +
      (byStaff ? m.cancelledByStaff(subject) : m.cancelledByVisitor(subject)) +
      signature(site),
    ics: { filename: m.cancelIcsFile, content: ics, method: 'CANCEL' },
  };
}

function details(booking: Booking): string {
  return [
    `Service: ${booking.serviceName}`,
    booking.resourceName ? `With: ${booking.resourceName}` : '',
    `When: ${englishWhen(booking)}`,
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    booking.phone ? `Phone: ${booking.phone}` : '',
    answersText(booking).trim(),
    booking.message ? `Message:\n${booking.message}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function newBookingMail(
  site: Site,
  to: string,
  booking: Booking,
  ics: string,
  adminUrl: string
): Mail {
  return {
    to,
    replyTo: booking.email,
    subject: `New booking: ${booking.serviceName}${booking.resourceName ? ` (${booking.resourceName})` : ''}, ${englishWhen(booking)}`,
    text:
      `A visitor booked on ${site.name}:\n\n${details(booking)}\n\n` +
      `Open the attached calendar file to add it to your calendar. All bookings: ${adminUrl}`,
    ics: { filename: 'booking.ics', content: ics, method: 'PUBLISH' },
  };
}

export function newRequestMail(
  site: Site,
  to: string,
  booking: Booking,
  adminUrl: string,
  holdUntil: string
): Mail {
  return {
    to,
    replyTo: booking.email,
    subject: `Booking request: ${booking.serviceName}${booking.resourceName ? ` (${booking.resourceName})` : ''}, ${englishWhen(booking)}`,
    text:
      `A visitor asks to book on ${site.name}:\n\n${details(booking)}\n\n` +
      `Approve or decline it in the admin: ${adminUrl}\n` +
      `The time is held until ${enWhen.format(new Date(holdUntil))}; after that the request lapses and the visitor is told.`,
  };
}

export function changedNoticeMail(
  site: Site,
  to: string,
  booking: Booking,
  ics: string,
  adminUrl: string,
  previous: Pick<Booking, 'start' | 'end'>
): Mail {
  return {
    to,
    replyTo: booking.email,
    subject: `Moved: ${booking.serviceName}, now ${englishWhen(booking)}`,
    text:
      `The visitor moved a booking on ${site.name}, from ${englishWhen(previous)}:\n\n${details(booking)}\n\n` +
      `All bookings: ${adminUrl}`,
    ics: { filename: 'booking.ics', content: ics, method: 'PUBLISH' },
  };
}

export function cancelledNoticeMail(
  site: Site,
  to: string,
  booking: Booking,
  ics: string,
  adminUrl: string
): Mail {
  const who =
    booking.cancelledBy === 'staff' ? 'was cancelled in the admin' : 'was cancelled by the visitor';
  return {
    to,
    replyTo: booking.email,
    subject: `Cancelled: ${booking.serviceName}, ${englishWhen(booking)}`,
    text:
      `A booking on ${site.name} ${who}:\n\n${details(booking)}\n\n` +
      `The time is free again. All bookings: ${adminUrl}`,
    ics: { filename: 'cancelled.ics', content: ics, method: 'CANCEL' },
  };
}

// --- Link pages (confirm, cancel and rebook links in emails) ---

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

/** A group of buttons on a link page, each POSTing to its own address (e.g. the times to move to). */
export interface ChoiceGroup {
  heading: string;
  choices: { label: string; action: string }[];
}

/**
 * A small page in the site's language: a heading, text and optionally a button (or groups of buttons) that
 * POST back (email scanners follow links with GET; only a button changes anything).
 */
export function linkPage(options: {
  site: Site;
  title: string;
  text: string[];
  button?: string;
  action?: string;
  groups?: ChoiceGroup[];
  links?: { label: string; href: string }[];
  home?: string;
}): string {
  const { site, title, text, button, action, groups, links, home } = options;
  const form = (label: string, to: string, cls = '') =>
    `<form method="post" action="${escapeHtml(to)}"><button type="submit"${cls ? ` class="${cls}"` : ''}>${escapeHtml(label)}</button></form>`;
  return `<!doctype html>
<html lang="${site.text.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} – ${escapeHtml(site.name)}</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafafa; --muted: #555; --accent: #1f4fd1; --line: rgba(127,127,127,.35); }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #161616; --muted: #aaa; --accent: #8aa8ff; } }
  body { margin: 0; font: 17px/1.55 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 34rem; margin: 10vh auto; padding: 0 1rem 4rem; }
  h1 { font-size: 1.5rem; line-height: 1.25; }
  h2 { font-size: 1rem; margin: 1.5rem 0 .5rem; }
  p { color: var(--muted); }
  button { font: inherit; padding: .7rem 1.3rem; border: 0; border-radius: .5rem; background: var(--accent); color: var(--bg); cursor: pointer; }
  .times { display: flex; flex-wrap: wrap; gap: .5rem; }
  .times form { margin: 0; }
  button.time { padding: .5rem .9rem; background: transparent; color: var(--fg); border: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
<p>${escapeHtml(site.name)}</p>
<h1>${escapeHtml(title)}</h1>
${text.map((t) => `<p>${escapeHtml(t)}</p>`).join('\n')}
${button && action ? form(button, action) : ''}
${(groups ?? [])
  .map(
    (g) =>
      `<h2>${escapeHtml(g.heading)}</h2>\n<div class="times">${g.choices.map((c) => form(c.label, c.action, 'time')).join('')}</div>`
  )
  .join('\n')}
${(links ?? []).map((l) => `<p><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></p>`).join('\n')}
${home ? `<p><a href="${escapeHtml(home)}">${escapeHtml(site.text.page.toSite)}</a></p>` : ''}
</main>
</body>
</html>
`;
}
