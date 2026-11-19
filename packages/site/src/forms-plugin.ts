// The descriptor of @emdash-cms/plugin-forms (Forms), what its `formsPlugin()` returns.
// Written out here because Astro loads the config in plain Node, which can't import the
// plugin's TypeScript source from node_modules; EmDash's Vite build loads the plugin itself
// from `entrypoint`. test/forms-plugin.test.mjs checks it against the installed plugin.
// One difference: `entrypoint` is ours (src/forms/plugin.js), the plugin plus MCP tools for AI
// connectors (runtime/form-tools.ts).
import type { PluginDescriptor } from 'emdash';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface FormsPluginOptions {
  /** Spam protection for new forms. */
  defaultSpamProtection?: 'none' | 'honeypot' | 'turnstile';
}

export const FORMS_PACKAGE = '@emdash-cms/plugin-forms';
export const FORMS_ENTRYPOINT = '@himlio/site/forms/plugin';

/** The installed plugin's version (its exports don't include package.json). */
export function formsPluginVersion(): string {
  const entry = createRequire(import.meta.url).resolve(FORMS_PACKAGE); // <pkg>/src/index.ts
  const pkg = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'));
  return pkg.version;
}

export function formsPlugin(
  options: FormsPluginOptions = {}
): PluginDescriptor<FormsPluginOptions> {
  return {
    id: 'emdash-forms',
    version: formsPluginVersion(),
    entrypoint: FORMS_ENTRYPOINT,
    adminEntry: `${FORMS_PACKAGE}/admin`,
    componentsEntry: `${FORMS_PACKAGE}/astro`,
    options,
    capabilities: ['email:send', 'media:write', 'network:request'],
    allowedHosts: ['*'],
    adminPages: [
      { path: '/', label: 'Forms', icon: 'list' },
      { path: '/submissions', label: 'Submissions', icon: 'inbox' },
    ],
    adminWidgets: [{ id: 'recent-submissions', title: 'Recent Submissions', size: 'half' }],
    storage: {
      forms: { indexes: ['status', 'createdAt'], uniqueIndexes: ['slug'] },
      submissions: { indexes: ['formId', 'status', 'starred', 'createdAt'] },
    },
  };
}
