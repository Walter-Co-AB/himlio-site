// The page behind the confirm and cancel links in booking emails, at /_booking. EmDash doesn't
// let plugin routes serve HTML, so the platform middleware renders it from the booking plugin's
// `link` route. GET only shows the booking and a button (email scanners follow links); the
// button's POST confirms or cancels.
import { LINK_PATH } from '../booking/core.js';
import { linkPage } from '../booking/messages.js';
import { BOOKING_PLUGIN_ID } from '../booking/store.js';
import { bookingText } from '../booking/strings.js';

interface Runtime {
  handlePublicPluginApiRoute(
    pluginId: string,
    method: string,
    path: string,
    request: Request
  ): Promise<unknown>;
}

export const isBookingPage = (url: URL) =>
  url.pathname === LINK_PATH || url.pathname === `${LINK_PATH}/`;

export async function bookingPage(
  request: Request,
  runtime: Runtime | undefined,
  siteName: string,
  locale?: string
) {
  const url = new URL(request.url);
  const site = { name: siteName, text: bookingText(locale) };
  const page = site.text.page;
  const home = url.origin;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  };
  if (request.method !== 'GET' && request.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  const q = Object.fromEntries(url.searchParams);
  if (typeof runtime?.handlePublicPluginApiRoute !== 'function' || !q.a || !q.b || !q.s)
    return new Response(
      linkPage({
        site,
        title: page.badLink[0],
        text: [page.badLink[1]],
        home,
      }),
      { status: 404, headers }
    );
  const result = (await runtime.handlePublicPluginApiRoute(
    BOOKING_PLUGIN_ID,
    'POST',
    '/link',
    new Request(`${url.origin}/_emdash/api/plugins/${BOOKING_PLUGIN_ID}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        a: q.a,
        b: q.b,
        s: q.s,
        act: request.method === 'POST',
        ...(q.t ? { t: q.t } : {}),
        ...(q.from ? { from: q.from } : {}),
      }),
    })
  )) as {
    success?: boolean;
    data?: {
      status: number;
      title: string;
      text: string[];
      button?: string;
      groups?: { heading: string; choices: { label: string; value: string }[] }[];
      more?: { label: string; from: string }[];
    };
  };
  if (!result?.success || !result.data) {
    console.error('[himlio] booking link failed:', JSON.stringify(result).slice(0, 300));
    return new Response(linkPage({ site, title: page.failed[0], text: [page.failed[1]], home }), {
      status: 500,
      headers,
    });
  }
  const { status, title, text, button, groups, more } = result.data;
  // Links keep the signed part (a, b, s) and add a new start (t) or the dates to show (from).
  const link = (extra: Record<string, string>) =>
    `${url.pathname}?${new URLSearchParams({ a: q.a, b: q.b, s: q.s, ...extra })}`;
  return new Response(
    linkPage({
      site,
      title,
      text,
      button,
      action: button ? link({}) : undefined,
      groups: groups?.map((g) => ({
        heading: g.heading,
        choices: g.choices.map((c) => ({ label: c.label, action: link({ t: c.value }) })),
      })),
      links: more?.map((m) => ({ label: m.label, href: link({ from: m.from }) })),
      home,
    }),
    { status, headers }
  );
}
