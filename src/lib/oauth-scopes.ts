// Limits what OAuth clients (MCP connectors such as Claude's custom connector, the EmDash CLI)
// can get to content work, plus reading the content model and the site settings. No write
// access to the schema (it can delete content; the model belongs in seed/seed.json) or to
// settings (they hold the site URL, which passkeys and MCP depend on, and staging/noindex).
//
// EmDash grants whatever scopes a client requests, capped only by the signing-in user's role,
// and has no setting to restrict them. So the Worker rewrites the requested scopes before
// EmDash sees them. Personal API tokens made in the admin are not affected.
//
// Plain web APIs only, so tests/oauth-scopes.test.mjs can run it under Node.

export const ALLOWED_SCOPES = [
  'content:read',
  'content:write',
  'media:read',
  'media:write',
  'taxonomies:manage',
  'menus:manage',
  'schema:read',
  'settings:read',
] as const;

const ALLOWED = new Set<string>(ALLOWED_SCOPES);

/** Scopes for a device-code request without any: EmDash's CLI defaults, spelled out. */
export const DEVICE_DEFAULT_SCOPES = [
  'content:read',
  'content:write',
  'media:read',
  'media:write',
  'schema:read',
];

const AUTHORIZE = '/_emdash/oauth/authorize';
const DEVICE_CODE = '/_emdash/api/oauth/device/code';
const REGISTER = '/_emdash/api/oauth/register';

/** The allowed scopes in a space-separated string or a list, without duplicates. */
export function filterScopes(value: unknown): string[] {
  const list =
    typeof value === 'string'
      ? value.split(' ')
      : Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : [];
  return [...new Set(list.filter((s) => ALLOWED.has(s)))];
}

/**
 * The path as Astro will route it: percent-decoded, lower case, no repeated or trailing slashes.
 * Null if it can't be decoded (Astro won't route it either).
 */
function routePath(url: URL): string | null {
  try {
    return decodeURIComponent(url.pathname)
      .toLowerCase()
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '');
  } catch {
    return null;
  }
}

const NOT_FOUND_LOG = '/_emdash/api/redirects/404s';
const SETTINGS = '/_emdash/api/settings';

/**
 * REST routes that OAuth access tokens may not use, although EmDash's scope table lets a
 * settings:read token through:
 * - the 404 log, which holds visitor IP addresses;
 * - everything under /_emdash/api/settings/ (email, domain, backups and any future sub-route).
 *   Some of them only check the user's role, so an admin's connector token would pass, e.g.
 *   the email provider and SMTP status. Exact /_emdash/api/settings (what settings_get returns)
 *   stays open.
 * Connectors lose nothing: MCP tools run in-process, not through these routes. Signed-in
 * admins and personal API tokens are not affected.
 */
export function refusesOAuthToken(request: Request): boolean {
  // EmDash reads the token the same way: "Bearer " exactly, then the ec_oat_ prefix.
  if (!(request.headers.get('Authorization') ?? '').startsWith('Bearer ec_oat_')) return false;
  const path = routePath(new URL(request.url));
  if (path === null) return true;
  return (
    path === NOT_FOUND_LOG ||
    path.startsWith(NOT_FOUND_LOG + '/') ||
    path.startsWith(SETTINGS + '/')
  );
}

export function isOAuthScopePath(url: URL): boolean {
  const path = routePath(url);
  return path === AUTHORIZE || path === DEVICE_CODE || path === REGISTER;
}

const invalidScope = () =>
  Response.json(
    { error: 'invalid_scope', error_description: 'No allowed scope requested' },
    { status: 400 }
  );

function withJsonBody(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.clone().json();
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns the request with its scopes limited to ALLOWED_SCOPES, or a 400 response when none of
 * the requested scopes is allowed and EmDash would otherwise pick defaults.
 */
export async function limitOAuthScopes(request: Request): Promise<Request | Response> {
  const url = new URL(request.url);
  const path = routePath(url);

  if (path === AUTHORIZE) {
    // GET renders the consent page from ?scope=; POST re-reads ?scope= from the URL. With no
    // allowed scope left, EmDash shows "No valid scopes requested".
    if (!url.searchParams.has('scope')) return request;
    url.searchParams.set('scope', filterScopes(url.searchParams.get('scope')).join(' '));
    return new Request(url, request);
  }

  if (request.method !== 'POST') return request;
  const body = await readJson(request);
  if (!body) return request; // EmDash answers invalid JSON itself.

  if (path === DEVICE_CODE) {
    // No scope means EmDash's CLI defaults, which include schema:read.
    if (body.scope === undefined || body.scope === null || body.scope === '') {
      return withJsonBody(request, { ...body, scope: DEVICE_DEFAULT_SCOPES.join(' ') });
    }
    const scopes = filterScopes(body.scope);
    if (scopes.length === 0) return invalidScope();
    return withJsonBody(request, { ...body, scope: scopes.join(' ') });
  }

  if (path === REGISTER) {
    // The registered scopes only narrow later grants further; authorize is filtered anyway.
    if (body.scope === undefined) return request;
    const scopes = filterScopes(body.scope);
    const { scope: _dropped, ...rest } = body;
    return withJsonBody(request, scopes.length ? { ...rest, scope: scopes.join(' ') } : rest);
  }

  return request;
}
