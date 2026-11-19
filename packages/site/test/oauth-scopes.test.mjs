import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_SCOPES,
  DEVICE_DEFAULT_SCOPES,
  filterScopes,
  isOAuthScopePath,
  limitOAuthScopes,
  refusesOAuthToken,
  refusesSiteUrlChange,
} from '../dist/runtime/oauth-scopes.js';

const ORIGIN = 'https://acme.himlio.app';
const EVERYTHING =
  'content:read content:write media:read media:write schema:read schema:write taxonomies:manage ' +
  'menus:manage settings:read settings:manage mcp:tools transfer:export transfer:analyze ' +
  'transfer:execute admin';
// What the allowlist keeps of EVERYTHING (a plugin's tools scope is kept too, see below).

const post = (path, body) =>
  new Request(ORIGIN + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '999' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('the allowlist is everything but admin and the transfer scopes', () => {
  assert.deepEqual([...ALLOWED_SCOPES].sort(), [
    'content:read',
    'content:write',
    'mcp:tools',
    'media:read',
    'media:write',
    'menus:manage',
    'schema:read',
    'schema:write',
    'settings:manage',
    'settings:read',
    'taxonomies:manage',
  ]);
  for (const s of ['admin', 'transfer:export', 'transfer:analyze', 'transfer:execute'])
    assert.equal(ALLOWED_SCOPES.includes(s), false, s);
});

test('filterScopes keeps only allowed scopes, from a string or a list', () => {
  assert.deepEqual(filterScopes(EVERYTHING).sort(), [...ALLOWED_SCOPES].sort());
  assert.deepEqual(filterScopes(['admin', 'content:read', 'content:read', 7]), ['content:read']);
  assert.deepEqual(filterScopes('admin transfer:export transfer:analyze transfer:execute'), []);
  // A single plugin's MCP tools, in EmDash's own syntax for the plugin id.
  assert.deepEqual(filterScopes('mcp:tools:emdash-forms mcp:tools:my_plugin2'), [
    'mcp:tools:emdash-forms',
    'mcp:tools:my_plugin2',
  ]);
  for (const bad of [
    'mcp:tools:',
    'mcp:tools:Forms',
    'mcp:tools:-forms',
    'mcp:tools:@acme/forms',
    'mcp:tools:a b',
    'mcp:toolsx',
    'mcp:tools:forms:admin',
  ])
    assert.deepEqual(filterScopes([bad]), [], bad);
  assert.deepEqual(filterScopes('schema:read settings:read'), ['schema:read', 'settings:read']);
  assert.deepEqual(filterScopes(undefined), []);
});

test('only the three OAuth paths are matched, however they are spelled', () => {
  for (const p of [
    '/_emdash/oauth/authorize',
    '/_emdash/OAuth/Authorize/',
    '/_emdash//oauth/authorize',
    '/_emdash/oauth/%61uthorize',
    '/_emdash/api/oauth/device/code',
    '/_emdash/api/oauth/register',
  ])
    assert.equal(isOAuthScopePath(new URL(ORIGIN + p)), true, p);
  for (const p of ['/', '/_emdash/api/oauth/token', '/_emdash/api/mcp', '/_emdash/api/tokens'])
    assert.equal(isOAuthScopePath(new URL(ORIGIN + p)), false, p);
});

test('authorize: scope in the URL is limited, for GET and POST', async () => {
  for (const method of ['GET', 'POST']) {
    const url = `${ORIGIN}/_emdash/oauth/authorize?client_id=c&scope=${encodeURIComponent(EVERYTHING)}`;
    const out = await limitOAuthScopes(
      new Request(url, {
        method,
        body: method === 'POST' ? 'scope=admin' : undefined,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    );
    const u = new URL(out.url);
    assert.deepEqual(u.searchParams.get('scope').split(' ').sort(), [...ALLOWED_SCOPES].sort());
    assert.equal(u.searchParams.get('client_id'), 'c');
    assert.equal(out.method, method);
    if (method === 'POST') assert.equal(await out.text(), 'scope=admin'); // form body untouched
  }
});

test('authorize: only disallowed scopes leaves an empty scope (EmDash refuses it)', async () => {
  const out = await limitOAuthScopes(new Request(`${ORIGIN}/_emdash/oauth/authorize?scope=admin`));
  assert.equal(new URL(out.url).searchParams.get('scope'), '');
});

test('device code: limited, defaulted to the EmDash CLI scopes, refused when nothing is left', async () => {
  const path = '/_emdash/api/oauth/device/code';
  let out = await limitOAuthScopes(post(path, { client_id: 'cli', scope: EVERYTHING }));
  const body = await out.json();
  assert.equal(body.client_id, 'cli');
  assert.deepEqual(body.scope.split(' ').sort(), [...ALLOWED_SCOPES].sort());
  assert.equal(out.headers.get('content-length'), null);

  out = await limitOAuthScopes(post(path, { client_id: 'cli' }));
  assert.deepEqual(await out.json(), { client_id: 'cli', scope: DEVICE_DEFAULT_SCOPES.join(' ') });
  assert.ok(DEVICE_DEFAULT_SCOPES.includes('schema:read'));
  for (const s of DEVICE_DEFAULT_SCOPES) assert.ok(ALLOWED_SCOPES.includes(s), s);

  for (const s of ['schema:write', 'settings:manage', 'mcp:tools'])
    assert.ok(DEVICE_DEFAULT_SCOPES.includes(s), s);

  out = await limitOAuthScopes(post(path, { client_id: 'cli', scope: 'admin transfer:export' }));
  assert.ok(out instanceof Response);
  assert.equal(out.status, 400);
  assert.equal((await out.json()).error, 'invalid_scope');
});

test('register: scope limited or dropped, other fields kept', async () => {
  const path = '/_emdash/api/oauth/register';
  const base = { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] };

  let out = await limitOAuthScopes(post(path, { ...base, scope: EVERYTHING }));
  const registered = await out.json();
  assert.deepEqual(registered.scope.split(' ').sort(), [...ALLOWED_SCOPES].sort());
  assert.deepEqual(registered.redirect_uris, base.redirect_uris);

  out = await limitOAuthScopes(post(path, { ...base, scope: ['admin', 'menus:manage'] }));
  assert.deepEqual(await out.json(), { ...base, scope: 'menus:manage' });

  out = await limitOAuthScopes(post(path, { ...base, scope: 'admin' }));
  assert.deepEqual(await out.json(), base);

  const unchanged = post(path, base);
  assert.equal(await limitOAuthScopes(unchanged), unchanged);
});

test('invalid JSON is passed through for EmDash to answer', async () => {
  const req = post('/_emdash/api/oauth/register', '{not json');
  assert.equal(await limitOAuthScopes(req), req);
});

test('OAuth access tokens are refused on the 404 log and settings sub-routes, nothing else', () => {
  const req = (path, auth) =>
    new Request(ORIGIN + path, { headers: auth ? { Authorization: auth } : {} });
  for (const p of [
    '/_emdash/api/redirects/404s',
    '/_emdash/api/redirects/404s/summary',
    '/_emdash/api/Redirects/404s/',
    '/_emdash//api/redirects/%34%304s',
    '/_emdash/api/settings/email',
    '/_emdash/api/settings/domain',
    '/_emdash/api/settings/backups',
    '/_emdash/api/settings/x',
    '/_emdash/api/Settings/%65mail',
    '/_emdash/api/%zz',
  ])
    assert.equal(refusesOAuthToken(req(p, 'Bearer ec_oat_abc')), true, p);
  // Signed-in admins (no bearer) and personal API tokens keep access.
  for (const p of ['/_emdash/api/redirects/404s', '/_emdash/api/settings/email']) {
    assert.equal(refusesOAuthToken(req(p)), false, p);
    assert.equal(refusesOAuthToken(req(p, 'Bearer ec_pat_abc')), false, p);
  }
  // Exact /settings (what settings_get returns) and other routes are left to EmDash.
  for (const p of [
    '/_emdash/api/settings',
    '/_emdash/api/settings/',
    '/_emdash/api/redirects',
    '/_emdash/api/mcp',
  ])
    assert.equal(refusesOAuthToken(req(p, 'Bearer ec_oat_abc')), false, p);
});

const settingsWrite = (body, auth = 'Bearer ec_oat_abc', path = '/_emdash/api/settings') =>
  new Request(ORIGIN + path, {
    method: 'POST',
    headers: { Authorization: auth, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const mcpCall = (name, args, id = 7) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

test('settings writes from OAuth tokens: the site URL is refused, the rest passes', async () => {
  for (const body of [{ url: 'https://evil.example' }, { url: '' }, { title: 'x', url: null }]) {
    const out = await refusesSiteUrlChange(settingsWrite(body));
    assert.equal(out.status, 403, JSON.stringify(body));
    assert.equal((await out.json()).error.code, 'HIMLIO_SITE_URL');
  }
  for (const path of ['/_emdash/api/Settings/', '/_emdash//api/settings'])
    assert.equal(
      (await refusesSiteUrlChange(settingsWrite({ url: '' }, undefined, path))).status,
      403
    );
  // Everything else in the settings is the customer's, staging/noindex included.
  for (const body of [{ title: 'Acme', tagline: 'Hej', staging: true, seo: { title: 'x' } }, {}])
    assert.equal(await refusesSiteUrlChange(settingsWrite(body)), null);
  // Signed-in admins and personal API tokens are not affected; bad JSON is EmDash's to answer.
  assert.equal(await refusesSiteUrlChange(settingsWrite({ url: '' }, 'Bearer ec_pat_x')), null);
  assert.equal(await refusesSiteUrlChange(settingsWrite({ url: '' }, '')), null);
  assert.equal(await refusesSiteUrlChange(settingsWrite('{bad')), null);
  // Reads pass.
  const get = new Request(ORIGIN + '/_emdash/api/settings', {
    headers: { Authorization: 'Bearer ec_oat_abc' },
  });
  assert.equal(await refusesSiteUrlChange(get), null);
});

test('settings_update over MCP with a url is answered with a tool error; others pass', async () => {
  const path = '/_emdash/api/mcp';
  let out = await refusesSiteUrlChange(
    settingsWrite(mcpCall('settings_update', { url: 'https://x.example' }), undefined, path)
  );
  assert.equal(out.status, 200);
  const answer = await out.json();
  assert.equal(answer.id, 7);
  assert.equal(answer.result.isError, true);
  assert.match(answer.result.content[0].text, /site URL/);

  out = await refusesSiteUrlChange(
    settingsWrite(
      [mcpCall('content_list', {}, 1), mcpCall('settings_update', { url: '' }, 2)],
      undefined,
      path
    )
  );
  assert.deepEqual(
    (await out.json()).map((m) => m.id),
    [2]
  );

  for (const body of [
    mcpCall('settings_update', { staging: true, tagline: 'Ny' }),
    mcpCall('content_update', { url: 'https://x.example' }),
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  ])
    assert.equal(await refusesSiteUrlChange(settingsWrite(body, undefined, path)), null);
  assert.equal(
    await refusesSiteUrlChange(
      settingsWrite(mcpCall('settings_update', { url: '' }), 'Bearer ec_pat_x', path)
    ),
    null
  );
});
