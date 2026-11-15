// himlio.json is written by the Himlio platform (Terraform) and rewritten on every apply.
// It holds platform facts only. Read it; never edit it from the site. The customer's own
// details (contact details, description) are edited in the admin: see contact.ts and
// site-description.ts.
import data from '../../himlio.json';

export interface Himlio {
  slug: string;
  name: string;
  locale: string;
  url?: string | null;
  /** Set by the platform when the EMAIL binding is available. */
  email?: { from: string };
}

const raw = data as Partial<Himlio>;

export const himlio: Himlio = {
  slug: raw.slug ?? '',
  name: raw.name ?? '',
  locale: raw.locale || 'sv',
  url: raw.url ?? null,
  email: raw.email?.from ? { from: raw.email.from } : undefined,
};
