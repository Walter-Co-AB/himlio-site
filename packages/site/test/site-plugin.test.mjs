import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessJsonLd, postalAddress } from '../dist/site/business.js';
import { privacyPage, privacyPolicy } from '../dist/site/privacy.js';
import { socialLinksFrom, socialUrl } from '../dist/runtime/social.js';
import { sitePlugin } from '../dist/site-plugin.js';

test('a Swedish address is parsed into street, postcode and city', () => {
  assert.deepEqual(postalAddress('Exempelgatan 1\n123 45 Stockholm'), {
    '@type': 'PostalAddress',
    streetAddress: 'Exempelgatan 1',
    postalCode: '123 45',
    addressLocality: 'Stockholm',
    addressCountry: 'SE',
  });
  assert.equal(postalAddress('Box 12, 12345 Malmö').postalCode, '123 45');
  assert.deepEqual(postalAddress('1 Example Street\nLondon EC1A 1AA'), {
    '@type': 'PostalAddress',
    streetAddress: '1 Example Street, London EC1A 1AA',
  });
  assert.equal(postalAddress('  '), undefined);
});

test('social settings take usernames or URLs', () => {
  assert.equal(socialUrl('instagram', '@walterco'), 'https://www.instagram.com/walterco/');
  assert.equal(
    socialUrl('linkedin', 'https://www.linkedin.com/company/walterco'),
    'https://www.linkedin.com/company/walterco'
  );
  assert.equal(socialUrl('facebook', 'javascript:alert(1)'), undefined);
  assert.equal(socialUrl('facebook', 'two words'), undefined);
  assert.deepEqual(
    socialLinksFrom({ twitter: '', facebook: 'walterco', instagram: 'walterco' }).map(
      (l) => l.network
    ),
    ['instagram', 'facebook']
  );
});

test('the business info has what is known, and a valid type', () => {
  const graph = businessJsonLd({
    name: 'Walter & Co',
    url: 'https://walterco.se/',
    type: 'NotAType',
    details: { phone: '08-1', email: 'a@b.se', address: 'Gatan 1\n111 22 Stockholm' },
    social: [{ network: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/w/' }],
  });
  assert.equal(graph['@type'], 'LocalBusiness');
  assert.equal(graph['@id'], 'https://walterco.se/#business');
  assert.equal(graph.url, 'https://walterco.se/');
  assert.equal(graph.telephone, '08-1');
  assert.equal(graph.address.addressLocality, 'Stockholm');
  assert.deepEqual(graph.sameAs, ['https://www.instagram.com/w/']);
  assert.equal(
    businessJsonLd({ name: 'X', url: 'https://x.se', type: 'HairSalon', details: {}, social: [] })[
      '@type'
    ],
    'HairSalon'
  );
  assert.equal(businessJsonLd({ name: ' ', url: 'https://x.se', details: {}, social: [] }), null);
});

const base = { name: 'Firma AB', forms: false, booking: false, turnstile: false, analytics: false };
const headings = (facts, locale) => privacyPolicy(facts, locale).map((s) => s.heading);

test('the privacy policy has only the parts the site uses, in its language', () => {
  assert.deepEqual(headings(base, 'sv'), [
    'Vem som ansvarar',
    'Kakor (cookies)',
    'Vilka som hjälper oss',
    'Dina rättigheter',
  ]);
  const all = { ...base, forms: true, booking: true, turnstile: true, analytics: true };
  assert.equal(headings(all, 'sv-SE').length, 8);
  assert.equal(headings(all, 'en').length, 8);
  assert.ok(headings(all, 'en').includes('When you book'));
  const who = privacyPolicy({ ...base, orgNumber: '556000-0000', email: 'a@b.se' }, 'sv')[0];
  assert.match(who.paragraphs[0], /Firma AB \(organisationsnummer 556000-0000\)/);
  assert.match(who.paragraphs[0], /Du når oss på a@b.se\./);
  assert.match(
    privacyPolicy(all, 'sv').find((s) => s.heading === 'När du bokar').paragraphs[1],
    /365 dagar/
  );
});

test('the privacy page is slugged in the site language', () => {
  assert.deepEqual(privacyPage('sv'), { title: 'Integritetspolicy', slug: 'integritetspolicy' });
  assert.deepEqual(privacyPage('en'), { title: 'Privacy policy', slug: 'privacy-policy' });
});

test('the site plugin descriptor matches the plugin', async () => {
  const d = sitePlugin();
  assert.equal(d.id, 'himlio-site');
  assert.equal(d.entrypoint, '@himlio/site/site/plugin');
  assert.deepEqual(d.capabilities, ['hooks.page-fragments:register']);
});
