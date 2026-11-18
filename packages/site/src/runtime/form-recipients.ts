// Stored forms without notification recipients get the platform's list (himlio.json
// forms.notify), on the platform's minute cron: forms created before this rule existed, or by
// any path the request rewrite in forms-guard.ts doesn't see. Through the plugin's own routes
// (forms/list, forms/update) via EmDash's withEmDashRuntime, so the plugin validates and stores
// the change itself, digest schedule included. A form with recipients is never touched.
import { hasRecipients } from './forms-guard.js';

/** Calls one of the Forms plugin's routes and returns its result (`{ success, data | error }`). */
export type FormsRoute = (path: string, body?: unknown) => Promise<unknown>;

interface FormSummary {
  id: string;
  settings?: { notifyEmails?: unknown };
}

/** Fills in recipients on stored forms that have none. Returns the ids it updated. */
export async function fillFormRecipients(
  call: FormsRoute,
  notify: readonly string[]
): Promise<string[]> {
  if (notify.length === 0) return [];
  const list = (await call('/forms/list')) as {
    success?: boolean;
    data?: { items?: FormSummary[] };
  };
  if (!list?.success) throw new Error(`forms/list failed: ${JSON.stringify(list).slice(0, 200)}`);
  const updated: string[] = [];
  for (const form of list.data?.items ?? []) {
    if (hasRecipients(form.settings?.notifyEmails)) continue;
    const result = (await call('/forms/update', {
      id: form.id,
      settings: { notifyEmails: [...notify] },
    })) as { success?: boolean };
    if (!result?.success)
      throw new Error(`forms/update ${form.id} failed: ${JSON.stringify(result).slice(0, 200)}`);
    updated.push(form.id);
  }
  return updated;
}

/** The pass, against the EmDash runtime (outside any request, as in a scheduled handler). */
export async function fillStoredFormRecipients(notify: readonly string[]): Promise<void> {
  if (notify.length === 0) return;
  const { withEmDashRuntime } = await import('emdash/middleware');
  await withEmDashRuntime(async (runtime) => {
    const call: FormsRoute = (path, body) =>
      runtime.handlePluginApiRoute(
        'emdash-forms',
        'POST',
        path,
        new Request(`https://internal${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
      );
    const updated = await fillFormRecipients(call, notify);
    if (updated.length > 0)
      console.log(`[himlio] forms: notification recipients set on ${updated.join(', ')}`);
  });
}
