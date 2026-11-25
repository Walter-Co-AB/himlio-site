// What a site's pages and components use from the platform:
//   import { contactDetails, siteDescription, socialLinks, himlio, localized } from '@himlio/site/runtime';
export { contactDetails, hasContactDetails, telHref, type ContactDetails } from './contact.js';
export { himlio, type HimlioFacts } from './himlio.js';
export { localized, siteLanguage } from './localized.js';
export { feedPath, newsPath, postPath } from './news.js';
export { privacyPolicyPath } from './privacy.js';
export { siteDescription } from './site-description.js';
export { socialLinks, socialLinksFrom, type SocialLink, type SocialNetwork } from './social.js';
