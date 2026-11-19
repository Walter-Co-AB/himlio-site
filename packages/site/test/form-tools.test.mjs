import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { z } from 'astro/zod';
import {
  CONNECTOR_OMITTED_SETTINGS,
  connectorSettings,
  enableFormTools,
  withFormTools,
} from '../dist/runtime/form-tools.js';

// The installed plugin's own schemas (TypeScript source, stripped and loaded from a data: URL).
const pluginSrc = dirname(createRequire(import.meta.url).resolve('@emdash-cms/plugin-forms'));
const schemasSource = stripTypeScriptTypes(
  readFileSync(join(pluginSrc, 'schemas.ts'), 'utf8')
).replaceAll('"astro/zod"', JSON.stringify(import.meta.resolve('astro/zod')));
const S = await import(
  `data:text/javascript;base64,${Buffer.from(schemasSource).toString('base64')}`
);
const indexSource = readFileSync(join(pluginSrc, 'index.ts'), 'utf8');

const NOTIFY = ['anton@walterco.se'];

/** A plugin shaped like the Forms plugin, its handlers recording their input. */
function fakePlugin() {
  const calls = [];
  const route = (name, input, permission) => ({
    input,
    ...(permission ? { permission } : {}),
    handler: async (ctx) => {
      calls.push({ name, input: ctx.input, user: ctx.user });
      return { ok: name };
    },
  });
  return {
    calls,
    plugin: {
      id: 'emdash-forms',
      routes: {
        'forms/list': route('forms/list', undefined, 'plugins:read'),
        'forms/create': route('forms/create', S.formCreateSchema),
        'forms/update': route('forms/update', S.formUpdateSchema),
        'forms/delete': route('forms/delete', S.formDeleteSchema),
        'submissions/list': route('submissions/list', S.submissionsListSchema, 'plugins:read'),
        'submissions/get': route('submissions/get', S.submissionGetSchema, 'plugins:read'),
        'submissions/delete': route('submissions/delete', S.submissionDeleteSchema),
        'submissions/export': route('submissions/export', S.exportSchema),
      },
    },
  };
}

const FORM = {
  name: 'Kontakt',
  slug: 'kontakt',
  pages: [{ fields: [{ id: 'f1', type: 'text', label: 'Namn', name: 'namn', required: true }] }],
};

test('the tools: forms list/create/update and reading submissions, nothing that deletes or exports', () => {
  const { plugin } = fakePlugin();
  const out = withFormTools(plugin, NOTIFY);
  const tools = Object.fromEntries(Object.entries(out.mcp.tools).map(([k, t]) => [k, t.route]));
  assert.deepEqual(tools, {
    list_forms: 'forms/list',
    create_form: 'connector/forms/create',
    update_form: 'connector/forms/update',
    list_submissions: 'submissions/list',
    get_submission: 'submissions/get',
  });
  // EmDash only registers a tool whose route declares a permission (and isn't public).
  for (const [name, tool] of Object.entries(out.mcp.tools)) {
    const route = out.routes[tool.route];
    assert.ok(route?.permission, name);
    assert.ok(!route.public, name);
    z.toJSONSchema(tool.input); // what EmDash sends to clients and stores as consent
  }
  assert.equal(out.routes['connector/forms/create'].permission, 'plugins:manage');
  assert.equal(out.routes['connector/forms/update'].permission, 'plugins:manage');
  // The plugin's own routes are kept as they were.
  for (const [k, r] of Object.entries(plugin.routes)) assert.equal(out.routes[k], r, k);
});

test("connectors can't send the autoresponder, recipients or webhook: not in the tool schemas", () => {
  const { tools } = withFormTools(fakePlugin().plugin, NOTIFY).mcp;
  for (const name of ['create_form', 'update_form']) {
    const json = JSON.stringify(z.toJSONSchema(tools[name].input));
    for (const key of CONNECTOR_OMITTED_SETTINGS)
      assert.ok(!json.includes(`"${key}"`), `${name} ${key}`);
    assert.ok(json.includes('"retentionDays"'), name);
    assert.ok(json.includes('"submitLabel"'), name);
  }
  assert.ok(
    !JSON.stringify(z.toJSONSchema(tools.update_form.input)).includes('"deleteSubmissions"')
  );
});

test('create_form: the platform rules applied before the plugin sees it', async () => {
  const { plugin, calls } = fakePlugin();
  const out = withFormTools(plugin, NOTIFY);
  const route = out.routes['connector/forms/create'];
  // What the route registry does: parse with the route's input, then call the handler.
  const input = route.input.parse({
    ...FORM,
    settings: {
      retentionDays: 0,
      notifyEmails: ['evil@example.com'],
      webhookUrl: 'https://x.example',
    },
  });
  assert.deepEqual(await route.handler({ input, user: { id: 'u' } }), { ok: 'forms/create' });
  const { settings } = calls[0].input;
  assert.equal(calls[0].name, 'forms/create');
  assert.deepEqual(calls[0].user, { id: 'u' });
  assert.equal(settings.retentionDays, 365);
  assert.deepEqual(settings.notifyEmails, NOTIFY);
  assert.equal('webhookUrl' in settings, false);
  assert.equal('autoresponder' in settings, false);
  assert.equal(settings.submitLabel, 'Submit'); // the plugin's defaults still apply
  // Even if a value got past the schema, the handler drops it.
  await route.handler({
    input: {
      ...FORM,
      settings: { autoresponder: { subject: 'a', body: 'b' }, retentionDays: 9999 },
    },
  });
  assert.equal('autoresponder' in calls[1].input.settings, false);
  assert.equal(calls[1].input.settings.retentionDays, 365);
});

test('update_form: recipients untouched, autoresponder cleared, retention kept in range', async () => {
  const { plugin, calls } = fakePlugin();
  const route = withFormTools(plugin, NOTIFY).routes['connector/forms/update'];
  await route.handler({
    input: route.input.parse({ id: 'f', settings: { submitLabel: 'Skicka' } }),
  });
  assert.deepEqual(calls[0].input.settings, { submitLabel: 'Skicka', autoresponder: null });
  await route.handler({ input: route.input.parse({ id: 'f', settings: { retentionDays: 30 } }) });
  assert.equal(calls[1].input.settings.retentionDays, 30);
  await route.handler({ input: route.input.parse({ id: 'f', status: 'paused' }) });
  assert.deepEqual(calls[2].input, { id: 'f', status: 'paused' });
  assert.throws(() => route.input.parse({ id: 'f', status: 'deleted' }));
});

test('connectorSettings without platform recipients: an empty list on create', () => {
  assert.deepEqual(connectorSettings({ notifyEmails: ['a@b.se'] }, true, []).notifyEmails, []);
  assert.equal(connectorSettings(undefined, false, NOTIFY), undefined);
});

test("a Forms plugin without the routes we wrap fails the build, it isn't silently skipped", () => {
  const { plugin } = fakePlugin();
  delete plugin.routes['submissions/get'];
  assert.throws(() => withFormTools(plugin, NOTIFY), /submissions\/get/);
  const other = fakePlugin().plugin;
  other.routes['forms/create'].input = undefined;
  assert.throws(() => withFormTools(other, NOTIFY), /object input/);
});

test('the installed plugin: the read routes we expose need plugins:read, writes have no permission', () => {
  const permission = (route) => {
    const at = indexSource.indexOf(`"${route}": {`);
    assert.ok(at > 0, route);
    const block = indexSource.slice(at, indexSource.indexOf('handler', at));
    return block.match(/permission: "([^"]+)"/)?.[1];
  };
  for (const r of ['forms/list', 'submissions/list', 'submissions/get'])
    assert.equal(permission(r), 'plugins:read', r);
  for (const r of ['forms/create', 'forms/update']) assert.equal(permission(r), undefined, r);
  assert.ok(!/\bmcp:\s*\{/.test(indexSource), 'the plugin declares MCP tools of its own now');
});

function fakeRuntime(row) {
  const updates = [];
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirst: async () => row,
    set: (values) => (updates.push(values), query),
    execute: async () => {},
  };
  return {
    updates,
    getPluginMcpTools: async () => [{ name: 'list_forms' }],
    serializePluginMcpConsent: () => 'CONSENT',
    db: { selectFrom: () => query, updateTable: () => query },
  };
}

test('enableFormTools: turns the tools on with current consent, leaves inactive plugins', async () => {
  let rt = fakeRuntime({ status: 'active', mcp_tools_enabled: 0, mcp_tools_consent: null });
  assert.equal(await enableFormTools(rt), true);
  assert.deepEqual(rt.updates, [{ mcp_tools_enabled: 1, mcp_tools_consent: 'CONSENT' }]);

  rt = fakeRuntime({ status: 'active', mcp_tools_enabled: 1, mcp_tools_consent: 'OLD' });
  assert.equal(await enableFormTools(rt), true);

  for (const row of [
    { status: 'active', mcp_tools_enabled: 1, mcp_tools_consent: 'CONSENT' },
    { status: 'inactive', mcp_tools_enabled: 0, mcp_tools_consent: null },
    undefined,
  ]) {
    rt = fakeRuntime(row);
    assert.equal(await enableFormTools(rt), false);
    assert.deepEqual(rt.updates, []);
  }
});
