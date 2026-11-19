// The Forms plugin's entrypoint as Himlio loads it (the descriptor in ../forms-plugin.js points
// here): the plugin itself, plus the MCP tools for AI connectors (../runtime/form-tools.js).
// Plain JS, copied into dist/forms/: the plugin's exports are TypeScript source, which only
// EmDash's Vite build loads.
import { createPlugin as createFormsPlugin } from '@emdash-cms/plugin-forms';
import { facts } from 'virtual:himlio/config';
import { withFormTools } from '../runtime/form-tools.js';

export function createPlugin(options) {
  return withFormTools(createFormsPlugin(options), facts.forms.notify);
}
