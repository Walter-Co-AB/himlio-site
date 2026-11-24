// What a site's pages and components use from the platform:
//   import { contactDetails, siteDescription, himlio, localized } from '@himlio/site/runtime';
export { contactDetails, hasContactDetails, telHref, type ContactDetails } from './contact.js';
export { himlio, type HimlioFacts } from './himlio.js';
export { localized, siteLanguage } from './localized.js';
export { siteDescription } from './site-description.js';
