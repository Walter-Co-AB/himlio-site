import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { FORMS_ENTRYPOINT, formsPlugin, formsPluginVersion } from '../dist/forms-plugin.js';

// Our copy of the Forms plugin's descriptor must equal what the installed plugin's own
// formsPlugin() returns, so a plugin update that changes it fails here.
test('the Forms descriptor matches the installed plugin', () => {
  const source = readFileSync(
    createRequire(import.meta.url).resolve('@emdash-cms/plugin-forms'),
    'utf8'
  );
  const start = source.indexOf('export function formsPlugin(');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'formsPlugin() not found in the plugin source');
  const fn = stripTypeScriptTypes(source.slice(start, end + 2).replace('export ', ''));
  const theirs = new Function('version', `${fn}\nreturn formsPlugin;`)(formsPluginVersion());

  const options = { defaultSpamProtection: 'honeypot' };
  assert.deepEqual(formsPlugin(options), {
    ...theirs(options),
    entrypoint: FORMS_ENTRYPOINT, // ours: the plugin plus the connector tools
  });
});

test('the Forms plugin is pinned exactly', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pinned = pkg.dependencies['@emdash-cms/plugin-forms'];
  assert.match(pinned, /^\d+\.\d+\.\d+$/);
  assert.equal(formsPluginVersion(), pinned);
});
