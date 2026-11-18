// The descriptor of @emdash-cms/plugin-forms (Forms), what its `formsPlugin()` returns.
// Written out here because Astro loads the config in plain Node, which can't import the
// plugin's TypeScript source from node_modules; EmDash's Vite build loads the plugin itself
// from `entrypoint`. test/forms-plugin.test.mjs checks it against the installed plugin.
import type { PluginDescriptor } from 'emdash';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface FormsPluginOptions {
  /** Spam protection for new forms. */
  defaultSpamProtection?: 'none' | 'honeypot' | 'turnstile';
}

export const FORMS_PACKAGE = '@emdash-cms/plugin-forms';

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
    entrypoint: FORMS_PACKAGE,
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
