// Limits what OAuth clients (MCP connectors such as Claude's custom connector, the EmDash CLI)
// can get: content, media, taxonomies, menus, the content model (read and write), site settings
// (read and write, except the site URL: refusesSiteUrlChange) and plugins' MCP tools (the Forms
// tools, runtime/form-tools.ts). Not `admin` (users, roles, plugin installs, and every plugin
// route) and not the transfer:* scopes (export of the whole site).
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
  'schema:write',
  'settings:read',
  'settings:manage',
  'mcp:tools',
] as const;

/** A single plugin's MCP tools, e.g. mcp:tools:emdash-forms (EmDash's own syntax for it). */
export const PLUGIN_TOOLS_SCOPE = /^mcp:tools:[a-z][a-z0-9_-]*$/;

const ALLOWED = new Set<string>(ALLOWED_SCOPES);
const allowed = (scope: string) => ALLOWED.has(scope) || PLUGIN_TOOLS_SCOPE.test(scope);

/** Scopes for a device-code request without any: EmDash's CLI defaults plus ours. */
export const DEVICE_DEFAULT_SCOPES = [
  'content:read',
  'content:write',
  'media:read',
  'media:write',
  'schema:read',
  'schema:write',
  'settings:manage',
  'mcp:tools',
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
  return [...new Set(list.filter(allowed))];
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
  if (!isOAuthToken(request)) return false;
  const path = routePath(new URL(request.url));
  if (path === null) return true;
  return (
    path === NOT_FOUND_LOG ||
    path.startsWith(NOT_FOUND_LOG + '/') ||
    path.startsWith(SETTINGS + '/')
  );
}

const MCP = '/_emdash/api/mcp';

const SITE_URL_MESSAGE =
  "The site URL is set by the Himlio platform and can't be changed by a connector " +
  '(sign-in with passkeys and the connector itself depend on it). Leave out `url`.';

const isOAuthToken = (request: Request) =>
  (request.headers.get('Authorization') ?? '').startsWith('Bearer ec_oat_');

const hasUrl = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && 'url' in value;

/** A JSON-RPC message that calls settings_update with a `url`. */
function setsSiteUrlOverMcp(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const m = message as { method?: unknown; params?: { name?: unknown; arguments?: unknown } };
  return (
    m.method === 'tools/call' && m.params?.name === 'settings_update' && hasUrl(m.params.arguments)
  );
}

/**
 * The refusal of a settings write from an OAuth token that sets the site URL: the REST route
 * (POST /_emdash/api/settings) or the MCP tool settings_update. Null if the request may pass.
 * Everything else in the settings is the customer's (title, tagline, logo, staging/noindex,
 * SEO, social). Signed-in admins and personal API tokens are not affected.
 */
export async function refusesSiteUrlChange(request: Request): Promise<Response | null> {
  if (request.method !== 'POST' || !isOAuthToken(request)) return null;
  const path = routePath(new URL(request.url));
  if (path !== SETTINGS && path !== MCP) return null;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null; // EmDash answers invalid JSON itself.
  }
  if (path === SETTINGS) {
    if (!hasUrl(body)) return null;
    return Response.json(
      { error: { code: 'HIMLIO_SITE_URL', message: SITE_URL_MESSAGE } },
      { status: 403 }
    );
  }
  const messages = Array.isArray(body) ? body : [body];
  const call = messages.find(setsSiteUrlOverMcp) as { id?: unknown } | undefined;
  if (!call) return null;
  // A tool error, as EmDash's own tools answer, so the agent reads why and goes on.
  const refusal = {
    jsonrpc: '2.0',
    id: call.id ?? null,
    result: { content: [{ type: 'text', text: SITE_URL_MESSAGE }], isError: true },
  };
  return Response.json(messages.length === 1 ? refusal : [refusal]);
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
