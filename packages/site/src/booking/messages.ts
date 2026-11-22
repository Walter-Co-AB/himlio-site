// The emails and link pages of booking. To visitors in Swedish (the site's language); to the
// customer in English, like the Forms notifications and the admin.

import type { Booking } from './store.js';
import { TIME_ZONE } from './time.js';

const svDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const svTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const enWhen = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "måndag 23 november 2026 kl. 10:00–11:00" */
export function swedishWhen(booking: Pick<Booking, 'start' | 'end'>): string {
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  return `${svDate.format(start)} kl. ${svTime.format(start)}–${svTime.format(end)}`;
}

export function englishWhen(booking: Pick<Booking, 'start' | 'end'>): string {
  return `${enWhen.format(new Date(booking.start))}–${svTime.format(new Date(booking.end))} (Stockholm time)`;
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
}

const signature = (site: Site) => `\n\nVänliga hälsningar\n${site.name}`;

export function confirmRequestMail(
  site: Site,
  booking: Booking,
  confirmUrl: string,
  holdMinutes: number
): Mail {
  return {
    to: booking.email,
    subject: `Bekräfta din bokning hos ${site.name}`,
    // Nothing the visitor typed (not even the name): the address isn't proven yet, so this
    // email must be useless for sending someone else a message.
    text:
      'Hej!\n\n' +
      `Någon, förhoppningsvis du, har bokat ${booking.serviceName} ${swedishWhen(booking)}.\n\n` +
      `Bekräfta bokningen inom ${holdMinutes} minuter genom att öppna länken:\n${confirmUrl}\n\n` +
      'Om du inte bekräftar släpps tiden till någon annan. Har du inte bokat något kan du ' +
      'bortse från det här mejlet.' +
      signature(site),
  };
}

export function confirmedMail(
  site: Site,
  booking: Booking,
  cancelUrl: string,
  ics: string,
  location?: string
): Mail {
  return {
    to: booking.email,
    subject: `Bokning bekräftad: ${booking.serviceName}, ${swedishWhen(booking)}`,
    text:
      `Hej ${booking.name}!\n\n` +
      `Din bokning är bekräftad:\n\n${booking.serviceName}\n${swedishWhen(booking)}\n` +
      (location ? `${location}\n` : '') +
      '\nDu hittar tiden i den bifogade kalenderfilen.\n\n' +
      `Kan du inte komma? Avboka här:\n${cancelUrl}` +
      signature(site),
    ics: { filename: 'bokning.ics', content: ics, method: 'PUBLISH' },
  };
}

export function reminderMail(
  site: Site,
  booking: Booking,
  cancelUrl: string,
  location?: string
): Mail {
  return {
    to: booking.email,
    subject: `Påminnelse: ${booking.serviceName} ${swedishWhen(booking)}`,
    text:
      `Hej ${booking.name}!\n\n` +
      `Välkommen till ${booking.serviceName} ${swedishWhen(booking)}.\n` +
      (location ? `${location}\n` : '') +
      `\nKan du inte komma? Avboka här:\n${cancelUrl}` +
      signature(site),
  };
}

export function cancelledMail(site: Site, booking: Booking, ics: string, byStaff: boolean): Mail {
  return {
    to: booking.email,
    subject: `Avbokad: ${booking.serviceName} ${swedishWhen(booking)}`,
    text:
      `Hej ${booking.name}!\n\n` +
      (byStaff
        ? `Vi har tyvärr fått ställa in din bokning av ${booking.serviceName} ${swedishWhen(booking)}. ` +
          'Svara på det här mejlet om du har frågor, eller boka en ny tid på webbplatsen.'
        : `Din bokning av ${booking.serviceName} ${swedishWhen(booking)} är avbokad.`) +
      signature(site),
    ics: { filename: 'avbokning.ics', content: ics, method: 'CANCEL' },
  };
}

function details(booking: Booking): string {
  return [
    `Service: ${booking.serviceName}`,
    `When: ${englishWhen(booking)}`,
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    booking.phone ? `Phone: ${booking.phone}` : '',
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
    subject: `New booking: ${booking.serviceName}, ${englishWhen(booking)}`,
    text:
      `A visitor booked on ${site.name}:\n\n${details(booking)}\n\n` +
      `Open the attached calendar file to add it to your calendar. All bookings: ${adminUrl}`,
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

// --- Link pages (confirm and cancel links in emails) ---

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

/**
 * A small page in Swedish: a heading, text and optionally a button that POSTs back to the same
 * address (email scanners follow links with GET; only the button changes anything).
 */
export function linkPage(options: {
  site: Site;
  title: string;
  text: string[];
  button?: string;
  action?: string;
  home?: string;
}): string {
  const { site, title, text, button, action, home } = options;
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} – ${escapeHtml(site.name)}</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafafa; --muted: #555; --accent: #1f4fd1; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #161616; --muted: #aaa; --accent: #8aa8ff; } }
  body { margin: 0; font: 17px/1.55 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 34rem; margin: 12vh auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; line-height: 1.25; }
  p { color: var(--muted); }
  button { font: inherit; padding: .7rem 1.3rem; border: 0; border-radius: .5rem; background: var(--accent); color: var(--bg); cursor: pointer; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
<p>${escapeHtml(site.name)}</p>
<h1>${escapeHtml(title)}</h1>
${text.map((t) => `<p>${escapeHtml(t)}</p>`).join('\n')}
${button && action ? `<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(button)}</button></form>` : ''}
${home ? `<p><a href="${escapeHtml(home)}">Till webbplatsen</a></p>` : ''}
</main>
</body>
</html>
`;
}
