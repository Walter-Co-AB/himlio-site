import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_SCOPES,
  DEVICE_DEFAULT_SCOPES,
  filterScopes,
  isOAuthScopePath,
  limitOAuthScopes,
} from '../src/lib/oauth-scopes.ts';

const ORIGIN = 'https://acme.himlio.app';
const EVERYTHING =
  'content:read content:write media:read media:write schema:read schema:write taxonomies:manage ' +
  'menus:manage settings:read settings:manage mcp:tools transfer:export transfer:analyze ' +
  'transfer:execute admin';

const post = (path, body) =>
  new Request(ORIGIN + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '999' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('filterScopes keeps only allowed scopes, from a string or a list', () => {
  assert.deepEqual(filterScopes(EVERYTHING), [...ALLOWED_SCOPES]);
  assert.deepEqual(filterScopes(['admin', 'content:read', 'content:read', 7]), ['content:read']);
  assert.deepEqual(filterScopes('mcp:tools:forms settings:manage'), []);
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
    assert.equal(u.searchParams.get('scope'), ALLOWED_SCOPES.join(' '));
    assert.equal(u.searchParams.get('client_id'), 'c');
    assert.equal(out.method, method);
    if (method === 'POST') assert.equal(await out.text(), 'scope=admin'); // form body untouched
  }
});

test('authorize: only disallowed scopes leaves an empty scope (EmDash refuses it)', async () => {
  const out = await limitOAuthScopes(new Request(`${ORIGIN}/_emdash/oauth/authorize?scope=admin`));
  assert.equal(new URL(out.url).searchParams.get('scope'), '');
});

test('device code: limited, defaulted without schema:read, refused when nothing is left', async () => {
  const path = '/_emdash/api/oauth/device/code';
  let out = await limitOAuthScopes(post(path, { client_id: 'cli', scope: EVERYTHING }));
  assert.deepEqual(await out.json(), { client_id: 'cli', scope: ALLOWED_SCOPES.join(' ') });
  assert.equal(out.headers.get('content-length'), null);

  out = await limitOAuthScopes(post(path, { client_id: 'cli' }));
  assert.deepEqual(await out.json(), { client_id: 'cli', scope: DEVICE_DEFAULT_SCOPES.join(' ') });

  out = await limitOAuthScopes(post(path, { client_id: 'cli', scope: 'admin schema:write' }));
  assert.ok(out instanceof Response);
  assert.equal(out.status, 400);
  assert.equal((await out.json()).error, 'invalid_scope');
});

test('register: scope limited or dropped, other fields kept', async () => {
  const path = '/_emdash/api/oauth/register';
  const base = { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] };

  let out = await limitOAuthScopes(post(path, { ...base, scope: EVERYTHING }));
  assert.deepEqual(await out.json(), { ...base, scope: ALLOWED_SCOPES.join(' ') });

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
