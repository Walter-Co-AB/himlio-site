// Platform rules for forms (@emdash-cms/plugin-forms), applied to the admin's requests that
// create or change a form, before the plugin sees them:
//
// - No autoresponder. It emails whatever address a visitor types in, which would make every
//   site a spam relay from the platform's sender. Dropped on create, cleared on update; the
//   plugin's duplicate copies stored settings, so it can't come back that way.
// - Submissions are kept 1–365 days, 365 by default: no "forever" (personal data, GDPR). The
//   plugin's weekly cleanup deletes what is older.
// - Notification recipients: the plugin's admin has no field for them, so a form saved without
//   any (missing or empty `notifyEmails`) gets the platform's list (himlio.json forms.notify).
//   A non-empty list that was sent is kept. Stored forms are filled in by form-recipients.ts.
//
// The plugin has no settings for either, so the Worker rewrites the request body of the routes
// that take form settings (create, update). It fails closed: a request it can't read is refused,
// not passed through. The plugin's other admin routes don't take settings: duplicate copies a
// stored form, which these rules already apply to (test/forms-guard.test.mjs lists them all).

export const FORMS_ROUTES = '/_emdash/api/plugins/emdash-forms/forms/';
export const RETENTION_DAYS_MAX = 365;

const CREATE = `${FORMS_ROUTES}create`;
const UPDATE = `${FORMS_ROUTES}update`;

/**
 * The path as EmDash will match it: Astro decodes the path before the plugin route is looked
 * up, so compare it decoded, lowercased, with repeated and trailing slashes removed. Null if it
 * can't be decoded.
 */
function routePath(url: URL): string | null {
  try {
    return decodeURIComponent(url.pathname).toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * The plugin's create and update routes, however the path is spelled. A path under /_emdash/
 * that can't be decoded counts as a match too, and is refused (fail closed).
 */
export function isFormsWritePath(url: URL): boolean {
  const path = routePath(url);
  if (path === null) return url.pathname.toLowerCase().startsWith('/_emdash/');
  return path === CREATE || path === UPDATE;
}

function retention(days: unknown): number {
  return typeof days === 'number' && Number.isInteger(days) && days >= 1
    ? Math.min(days, RETENTION_DAYS_MAX)
    : RETENTION_DAYS_MAX;
}

type Settings = Record<string, unknown>;

/** The form settings with the platform rules applied. `create` fills in what is missing. */
export function applyFormRules(
  settings: Settings | undefined,
  create: boolean,
  notify: readonly string[] = []
): Settings | undefined {
  if (!create && settings === undefined) return undefined; // update without settings: unchanged
  const out: Settings = { ...(settings ?? {}) };
  if (create) delete out.autoresponder;
  else out.autoresponder = null; // the plugin's way to clear a stored one
  if (create || 'retentionDays' in out) out.retentionDays = retention(out.retentionDays);
  if (notify.length > 0 && (create || 'notifyEmails' in out) && !hasRecipients(out.notifyEmails))
    out.notifyEmails = [...notify];
  return out;
}

/** A non-empty list: the plugin validates the addresses themselves. */
export function hasRecipients(notifyEmails: unknown): boolean {
  return Array.isArray(notifyEmails) && notifyEmails.length > 0;
}

const refuse = (status: number, message: string, headers?: HeadersInit) =>
  Response.json(
    { success: false, error: { code: 'HIMLIO_FORMS_RULES', message } },
    { status, headers }
  );

/**
 * The request with the rules applied to its body, or a Response refusing it: only POST with a
 * JSON object body (and an object `settings`, if any) is let through.
 */
export async function guardFormsRequest(
  request: Request,
  notify: readonly string[] = []
): Promise<Request | Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed', { Allow: 'POST' });
  const path = routePath(new URL(request.url));
  if (path === null) return refuse(400, 'Bad path');
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return refuse(400, 'The body must be JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return refuse(400, 'The body must be a JSON object');
  const input = body as Record<string, unknown>;
  const settings = input.settings;
  if (
    settings !== undefined &&
    (typeof settings !== 'object' || settings === null || Array.isArray(settings))
  )
    return refuse(400, 'settings must be an object');
  const rewritten = applyFormRules(settings as Settings | undefined, path === CREATE, notify);
  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  headers.delete('content-length');
  return new Request(request, {
    body: JSON.stringify(rewritten === undefined ? input : { ...input, settings: rewritten }),
    headers,
  });
}
