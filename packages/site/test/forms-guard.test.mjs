import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  applyFormRules,
  guardFormsRequest,
  hasRecipients,
  isFormsWritePath,
  RETENTION_DAYS_MAX,
} from '../dist/runtime/forms-guard.js';

const ORIGIN = 'https://example.test';
const BASE = `${ORIGIN}/_emdash/api/plugins/emdash-forms/`;
const pluginSrc = dirname(createRequire(import.meta.url).resolve('@emdash-cms/plugin-forms'));

test('create: no autoresponder, retention 1–365 days with 365 by default', () => {
  const out = applyFormRules(
    { autoresponder: { subject: 's', body: 'b' }, submitLabel: 'Skicka' },
    true
  );
  assert.equal('autoresponder' in out, false);
  assert.equal(out.retentionDays, RETENTION_DAYS_MAX);
  assert.equal(out.submitLabel, 'Skicka');
  assert.equal(applyFormRules(undefined, true).retentionDays, 365);
  for (const [given, kept] of [
    [0, 365],
    [-1, 365],
    [1000, 365],
    [1.5, 365],
    ['30', 365],
    [30, 30],
    [365, 365],
    [1, 1],
  ])
    assert.equal(applyFormRules({ retentionDays: given }, true).retentionDays, kept, String(given));
});

test('update: clears the autoresponder; retention only when sent; no settings stays no settings', () => {
  assert.equal(applyFormRules(undefined, false), undefined);
  const out = applyFormRules({ autoresponder: { subject: 's', body: 'b' } }, false);
  assert.equal(out.autoresponder, null);
  assert.equal('retentionDays' in out, false);
  assert.equal(applyFormRules({ retentionDays: 0 }, false).retentionDays, 365);
  assert.equal(applyFormRules({ retentionDays: 90 }, false).retentionDays, 90);
});

test('create and update are matched however the path is spelled; other routes are not', () => {
  for (const path of [
    'forms/create',
    'forms/update',
    'forms/create/',
    'forms//create',
    'forms%2Fcreate',
    'Forms/Update',
  ])
    assert.ok(isFormsWritePath(new URL(BASE + path)), path);
  assert.ok(isFormsWritePath(new URL(`${ORIGIN}/_emdash/api/plugins/emdash%2Dforms/forms/create`)));
  assert.ok(isFormsWritePath(new URL(`${ORIGIN}/_emdash/api/plugins/emdash-forms/forms/%E0%A4%A`)));
  for (const path of ['forms/list', 'forms/duplicate', 'submit', 'definition', 'submissions/list'])
    assert.equal(isFormsWritePath(new URL(BASE + path)), false, path);
  assert.equal(isFormsWritePath(new URL(`${ORIGIN}/kontakt`)), false);
});

test('recipients: the platform list when none were sent; a sent list is kept', () => {
  const notify = ['anton@walterco.se'];
  assert.deepEqual(applyFormRules(undefined, true, notify).notifyEmails, notify);
  assert.deepEqual(applyFormRules({ notifyEmails: [] }, true, notify).notifyEmails, notify);
  assert.deepEqual(applyFormRules({ notifyEmails: ['x@example.com'] }, true, notify).notifyEmails, [
    'x@example.com',
  ]);
  // update: an empty list is filled; no notifyEmails leaves the stored list alone
  assert.deepEqual(applyFormRules({ notifyEmails: [] }, false, notify).notifyEmails, notify);
  assert.equal('notifyEmails' in applyFormRules({ retentionDays: 30 }, false, notify), false);
  assert.equal(applyFormRules(undefined, false, notify), undefined);
  // no platform list: nothing is added
  assert.equal('notifyEmails' in applyFormRules({}, true, []), false);
  assert.deepEqual(applyFormRules({ notifyEmails: [] }, true).notifyEmails, []);
  // the list is a copy
  const out = applyFormRules({}, true, notify);
  out.notifyEmails.push('y@example.com');
  assert.deepEqual(notify, ['anton@walterco.se']);
  assert.equal(hasRecipients(['a@example.com']), true);
  for (const v of [[], undefined, null, 'a@example.com']) assert.equal(hasRecipients(v), false);
});

const post = (path, body, init = {}) =>
  new Request(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'session=x', 'X-EmDash-Request': '1' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

test('the request body is rewritten, headers kept', async () => {
  const out = await guardFormsRequest(
    post('forms/create', {
      name: 'Kontakt',
      slug: 'contact',
      pages: [],
      settings: { autoresponder: { subject: 's', body: 'b' }, retentionDays: 0 },
    })
  );
  assert.ok(out instanceof Request);
  assert.equal(out.headers.get('Cookie'), 'session=x');
  assert.equal(out.headers.get('X-EmDash-Request'), '1');
  const body = await out.json();
  assert.equal(body.name, 'Kontakt');
  assert.equal('autoresponder' in body.settings, false);
  assert.equal(body.settings.retentionDays, 365);

  const update = await (
    await guardFormsRequest(
      post('forms/update', { id: 'f1', settings: { autoresponder: { subject: 's', body: 'b' } } })
    )
  ).json();
  assert.equal(update.settings.autoresponder, null);
  const rename = await (
    await guardFormsRequest(post('forms/update', { id: 'f1', name: 'Ny' }))
  ).json();
  assert.deepEqual(rename, { id: 'f1', name: 'Ny' });
});

test('fails closed: anything it cannot read is refused', async () => {
  const get = await guardFormsRequest(new Request(`${BASE}forms/create?name=x`));
  assert.equal(get.status, 405);
  for (const body of [
    'not json',
    '[]',
    'null',
    '"x"',
    JSON.stringify({ settings: 'x' }),
    JSON.stringify({ settings: [] }),
  ]) {
    const out = await guardFormsRequest(post('forms/create', body));
    assert.ok(out instanceof Response, body);
    assert.equal(out.status, 400, body);
  }
  const badPath = await guardFormsRequest(post('forms/%E0%A4%A', {}));
  assert.equal(badPath.status, 400);
});

// Every admin route of the pinned plugin, and whether it takes form settings. A plugin update
// that adds a route (e.g. an import) fails here until someone decides whether it needs guarding.
const ROUTES = {
  submit: 'public: a submission, no form settings',
  definition: 'public: reads a form',
  'forms/list': 'reads',
  'forms/create': 'guarded: takes settings',
  'forms/update': 'guarded: takes settings',
  'forms/delete': 'no settings',
  'forms/duplicate': 'no settings: copies a stored (already guarded) form',
  'submissions/list': 'reads',
  'submissions/get': 'reads',
  'submissions/update': 'a submission status, no form settings',
  'submissions/delete': 'no settings',
  'submissions/export': 'reads',
  'settings/turnstile-status': 'reads',
};

test('the plugin has exactly the routes we know of', () => {
  const index = readFileSync(join(pluginSrc, 'index.ts'), 'utf8');
  const routes = index.slice(index.indexOf('routes: {'), index.indexOf('admin: {'));
  const names = [...routes.matchAll(/^\t{3}(?:"([^"]+)"|([a-z]+)): \{/gm)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(names.toSorted(), Object.keys(ROUTES).toSorted());
});

test('only the create and update inputs take form settings', () => {
  const schemas = readFileSync(join(pluginSrc, 'schemas.ts'), 'utf8');
  const inputs = [...schemas.matchAll(/^export const (\w+Schema) = ([\s\S]*?)^\}\)/gm)];
  assert.ok(inputs.length > 5);
  const withSettings = inputs
    .filter(([, , body]) => /\bsettings:/.test(body))
    .map(([, name]) => name);
  assert.deepEqual(withSettings.toSorted(), ['formCreateSchema', 'formUpdateSchema']);
});
