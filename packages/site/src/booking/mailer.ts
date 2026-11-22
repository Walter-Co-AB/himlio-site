// Sends booking emails through the platform's EMAIL binding (Cloudflare Email Sending), which,
// unlike EmDash's email API, takes attachments: the .ics files. From himlio.json's sender with
// the site's name. Without a sender (a site without email, `astro dev` of the starter) the email
// is written to the log instead.

import type { Mail } from './messages.js';

interface EmailBinding {
  send(message: {
    from: { email: string; name: string };
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    attachments?: {
      disposition: 'attachment';
      filename: string;
      type: string;
      content: string;
    }[];
  }): Promise<unknown>;
}

export function mailer(sender: { email: string; name: string } | null) {
  return async function send(mail: Mail): Promise<void> {
    const binding = sender
      ? ((await import('./worker-env.js')).env as unknown as { EMAIL?: EmailBinding }).EMAIL
      : undefined;
    if (!sender || !binding) {
      console.log(
        `[himlio-booking] email (not sent: ${sender ? 'no EMAIL binding' : 'no sender in himlio.json'})`,
        JSON.stringify({
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          ics: mail.ics?.filename,
        })
      );
      return;
    }
    await binding.send({
      from: sender,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      ...(mail.ics
        ? {
            attachments: [
              {
                disposition: 'attachment',
                filename: mail.ics.filename,
                type: `text/calendar; charset=utf-8; method=${mail.ics.method}`,
                content: mail.ics.content,
              },
            ],
          }
        : {}),
    });
  };
}

/** Reads the customer's calendar address: https only, 15 s, at most 5 MB. */
export async function fetchCalendar(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/calendar, */*;q=0.5', 'User-Agent': 'Himlio-Booking/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    throw new Error(
      timeout
        ? 'the calendar did not answer within 15 seconds'
        : `the calendar could not be reached (${new URL(url).host}); check the address`
    );
  }
  if (!response.ok)
    throw new Error(`the calendar answered ${response.status} ${response.statusText}`.trim());
  if (!response.url.startsWith('https://'))
    throw new Error('the calendar redirected away from https');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 5_000_000) throw new Error('the calendar is larger than 5 MB');
  return response.text();
}
