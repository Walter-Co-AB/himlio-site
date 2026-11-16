// The platform facts from himlio.json (written by Terraform, overwritten on every apply):
// slug, name, locale, URL and email sender. The customer's own details (contact details,
// description) are edited in the admin: see contactDetails() and siteDescription().
import { facts } from 'virtual:himlio/config';
import type { HimlioFacts } from '../config.js';

export type { HimlioFacts };
export const himlio: HimlioFacts = facts;
