// The facts for the generated privacy policy (site/privacy.ts): the company from the site
// settings and Company details, and which platform features the site uses. A form or bookable
// service counts while it exists and is active; Turnstile and analytics count when himlio.json
// turns them on.
import { env } from 'cloudflare:workers';
import { getSiteSettings } from 'emdash';
import { facts } from 'virtual:himlio/config';
import type { PrivacyFacts } from '../site/privacy.js';
import { contactDetails } from './contact.js';

const db = () => (env as unknown as { DB: D1Database }).DB;

/**
 * The longest retention (days) of the active forms, or undefined when there are none or any of
 * them keeps its messages (retentionDays 0 or unset).
 */
async function formsRetentionDays(): Promise<number | undefined> {
  try {
    const { results } = await db()
      .prepare(
        "SELECT json_extract(data, '$.settings.retentionDays') AS days FROM _plugin_storage WHERE plugin_id = 'emdash-forms' AND collection = 'forms' AND json_extract(data, '$.status') = 'active'"
      )
      .all<{ days: number | null }>();
    if (results.length === 0) return undefined;
    const days = results.map((r) => Number(r.days) || 0);
    return days.every((d) => d > 0) ? Math.max(...days) : undefined;
  } catch {
    return undefined;
  }
}

async function exists(sql: string): Promise<boolean> {
  try {
    return (await db().prepare(sql).first()) !== null;
  } catch {
    return false; // a site set up before the table existed
  }
}

export async function privacyFacts(): Promise<PrivacyFacts> {
  const [settings, details, forms, booking, retention, turnstileForms] = await Promise.all([
    getSiteSettings(),
    contactDetails(),
    exists(
      "SELECT 1 FROM _plugin_storage WHERE plugin_id = 'emdash-forms' AND collection = 'forms' AND json_extract(data, '$.status') = 'active' LIMIT 1"
    ),
    exists(
      "SELECT 1 FROM _plugin_storage WHERE plugin_id = 'himlio-booking' AND collection = 'services' AND json_extract(data, '$.active') = 1 LIMIT 1"
    ),
    formsRetentionDays(),
    exists(
      "SELECT 1 FROM _plugin_storage WHERE plugin_id = 'emdash-forms' AND collection = 'forms' AND json_extract(data, '$.status') = 'active' AND json_extract(data, '$.settings.spamProtection') = 'turnstile' LIMIT 1"
    ),
  ]);
  // Booking checks with Turnstile when the platform has given the site both keys (plugin.ts).
  const turnstileSecret = !!(env as unknown as { TURNSTILE_SECRET?: string }).TURNSTILE_SECRET;
  return {
    name: settings.title?.trim() || facts.name,
    ...(details.org_number ? { orgNumber: details.org_number } : {}),
    ...(details.address ? { address: details.address } : {}),
    ...(details.email ? { email: details.email } : {}),
    ...(details.phone ? { phone: details.phone } : {}),
    forms,
    ...(forms && retention ? { formsRetentionDays: retention } : {}),
    booking,
    turnstile: { booking: booking && !!facts.turnstile && turnstileSecret, forms: turnstileForms },
    analytics: !!facts.analytics,
  };
}

/**
 * The path of the published page with the Privacy policy block (e.g. "/integritetspolicy"), for
 * a footer link, or undefined while there is none.
 */
export async function privacyPolicyPath(): Promise<string | undefined> {
  try {
    const row = await db()
      .prepare(
        "SELECT slug FROM ec_pages WHERE status = 'published' AND deleted_at IS NULL AND content LIKE '%\"himlio-privacy\"%' ORDER BY published_at LIMIT 1"
      )
      .first<{ slug: string | null }>();
    return row?.slug ? `/${row.slug}` : undefined;
  } catch {
    return undefined;
  }
}
