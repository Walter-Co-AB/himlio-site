// MCP tools for the Forms plugin, so AI connectors can manage forms and read submissions
// without the `admin` scope. EmDash registers MCP tools that an in-process plugin declares
// (`mcp.tools`, each pointing at one of the plugin's routes) and lets a token use them with the
// `mcp:tools:emdash-forms` (or `mcp:tools`) scope, the route's permission checked against the
// user's role. The Forms plugin declares none, so `src/forms/plugin.js` wraps its createPlugin()
// with withFormTools(): no change to the plugin's code.
//
// - list_forms, list_submissions, get_submission: the plugin's own read routes (plugins:read,
//   editors and up).
// - create_form, update_form: routes of ours (plugins:manage, admins, like the admin's form
//   builder) that apply the platform rules (forms-guard.ts) before calling the plugin's handler.
//   Connectors can't set the autoresponder, the notification recipients or the webhook (who
//   gets the visitors' data stays in the admin); the platform's recipients are filled in.
// - Not offered: deleting or duplicating forms, changing, deleting or exporting submissions.
//
// EmDash only lists a plugin's tools once an admin has turned them on (and with them, the exact
// tool list). These are the platform's tools, so the minute cron turns them on and keeps the
// consent current (enableFormTools); whether a connector may use them is the user's choice of
// scope when connecting.
import { z } from 'astro/zod';
import { applyFormRules } from './forms-guard.js';

export const FORMS_PLUGIN_ID = 'emdash-forms';

/** Settings a connector can't set: they decide who receives the visitors' data. */
export const CONNECTOR_OMITTED_SETTINGS = ['autoresponder', 'notifyEmails', 'webhookUrl'] as const;

const OMIT = {
  autoresponder: true,
  notifyEmails: true,
  webhookUrl: true,
} as const satisfies Record<(typeof CONNECTOR_OMITTED_SETTINGS)[number], true>;

type Settings = Record<string, unknown>;
type RouteContext = { input: unknown } & Record<string, unknown>;

interface Route {
  input?: z.ZodType;
  permission?: string;
  public?: boolean;
  handler: (ctx: RouteContext) => Promise<unknown>;
}

interface Tool {
  description: string;
  route: string;
  input: z.ZodType;
  destructive?: boolean;
}

export interface FormsPluginLike {
  id: string;
  routes: Record<string, Route>;
  mcp?: { tools: Record<string, Tool> };
}

/** The settings from a connector with the platform rules applied. */
export function connectorSettings(
  settings: Settings | undefined,
  create: boolean,
  notify: readonly string[]
): Settings | undefined {
  if (!create && settings === undefined) return undefined;
  const own: Settings = { ...(settings ?? {}) };
  for (const key of CONNECTOR_OMITTED_SETTINGS) delete own[key];
  const out = applyFormRules(own, create, notify)!;
  if (create && out.notifyEmails === undefined) out.notifyEmails = [];
  return out;
}

const ROUTES = {
  list: 'forms/list',
  create: 'forms/create',
  update: 'forms/update',
  submissions: 'submissions/list',
  submission: 'submissions/get',
} as const;

const CONNECTOR_CREATE = 'connector/forms/create';
const CONNECTOR_UPDATE = 'connector/forms/update';

function objectInput(route: Route, name: string): z.ZodObject {
  // Duck-typed: the plugin's zod may be another copy than ours.
  const input = route.input as Partial<z.ZodObject> | undefined;
  if (typeof input?.extend !== 'function' || typeof input.shape !== 'object')
    throw new Error(`[himlio] the Forms plugin's ${name} route has no object input`);
  return input as z.ZodObject;
}

/** The plugin with its MCP tools added. Fails if the plugin's routes are not what we expect. */
export function withFormTools<P extends FormsPluginLike>(plugin: P, notify: readonly string[]): P {
  for (const name of Object.values(ROUTES))
    if (!plugin.routes[name]) throw new Error(`[himlio] the Forms plugin has no ${name} route`);
  const create = plugin.routes[ROUTES.create]!;
  const update = plugin.routes[ROUTES.update]!;

  const createInput = objectInput(create, ROUTES.create);
  const updateInput = objectInput(update, ROUTES.update);
  const createSettings = createInput.shape.settings as z.ZodObject;
  const updateSettings = (updateInput.shape.settings as z.ZodOptional<z.ZodObject>).unwrap();
  const connectorCreateInput = createInput.extend({ settings: createSettings.omit(OMIT) });
  const connectorUpdateInput = updateInput.extend({
    settings: updateSettings.omit(OMIT).optional(),
  });

  const withRules =
    (route: Route, isCreate: boolean): Route['handler'] =>
    (ctx) => {
      const input = ctx.input as Record<string, unknown>;
      const settings = connectorSettings(input.settings as Settings | undefined, isCreate, notify);
      return route.handler({
        ...ctx,
        input: settings === undefined ? input : { ...input, settings },
      });
    };

  const rules =
    'Platform rules: submissions are kept 1-365 days (365 if not set); notifications go to the ' +
    "platform's recipients, set in the admin, and there is no autoresponder or webhook.";

  return {
    ...plugin,
    routes: {
      ...plugin.routes,
      [CONNECTOR_CREATE]: {
        permission: 'plugins:manage',
        input: connectorCreateInput,
        handler: withRules(create, true),
      },
      [CONNECTOR_UPDATE]: {
        permission: 'plugins:manage',
        input: connectorUpdateInput,
        handler: withRules(update, false),
      },
    },
    mcp: {
      tools: {
        ...plugin.mcp?.tools,
        list_forms: {
          description:
            'List the forms on the site (id, slug, name, status, fields and settings). ' +
            'Place a form on a page with { _type: "emdash-form", _key, formId: <the slug> }.',
          route: ROUTES.list,
          input: z.object({}),
        },
        create_form: {
          description:
            'Create a form: name, slug, pages of fields (one page for a normal form), and ' +
            'settings such as submitLabel, confirmationMessage and retentionDays. Labels in ' +
            `Swedish unless asked otherwise. ${rules}`,
          route: CONNECTOR_CREATE,
          input: connectorCreateInput,
        },
        update_form: {
          description:
            'Change a form by id: name, slug, pages and fields, settings (labels, button, ' +
            'confirmation message, retention) or status (active/paused). Only what you send ' +
            `changes; pages replace all pages. ${rules}`,
          route: CONNECTOR_UPDATE,
          input: connectorUpdateInput,
        },
        list_submissions: {
          description:
            "List a form's submissions, newest first, 50 per page (limit up to 100; pass the " +
            'returned cursor for the next page). Submissions are personal data: use them only ' +
            "for what the user asks, and don't copy them into site content.",
          route: ROUTES.submissions,
          input: plugin.routes[ROUTES.submissions]!.input ?? z.object({}),
        },
        get_submission: {
          description:
            'Get one submission by id. Personal data: use it only for what the user asks, and ' +
            "don't copy it into site content.",
          route: ROUTES.submission,
          input: plugin.routes[ROUTES.submission]!.input ?? z.object({}),
        },
      },
    },
  };
}

/** What enableFormTools needs from EmDash's runtime. */
export interface FormToolsRuntime {
  getPluginMcpTools(pluginId: string): Promise<unknown[]>;
  serializePluginMcpConsent(tools: never, pluginId: string): string;
  db: {
    selectFrom(table: '_plugin_state'): any; // eslint-disable-line @typescript-eslint/no-explicit-any
    updateTable(table: '_plugin_state'): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/**
 * Turns the Forms plugin's MCP tools on, with consent for the current tool list. Nothing changes
 * while it is already so, or while the plugin is inactive. Returns whether it changed anything.
 */
export async function enableFormTools(runtime: FormToolsRuntime): Promise<boolean> {
  const tools = await runtime.getPluginMcpTools(FORMS_PLUGIN_ID);
  if (tools.length === 0) return false;
  const consent = runtime.serializePluginMcpConsent(tools as never, FORMS_PLUGIN_ID);
  const row = (await runtime.db
    .selectFrom('_plugin_state')
    .select(['status', 'mcp_tools_enabled', 'mcp_tools_consent'])
    .where('plugin_id', '=', FORMS_PLUGIN_ID)
    .executeTakeFirst()) as
    { status: string; mcp_tools_enabled: number; mcp_tools_consent: string | null } | undefined;
  if (!row || row.status !== 'active') return false;
  if (row.mcp_tools_enabled === 1 && row.mcp_tools_consent === consent) return false;
  await runtime.db
    .updateTable('_plugin_state')
    .set({ mcp_tools_enabled: 1, mcp_tools_consent: consent })
    .where('plugin_id', '=', FORMS_PLUGIN_ID)
    .execute();
  return true;
}
