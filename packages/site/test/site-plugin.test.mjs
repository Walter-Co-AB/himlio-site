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

const base = {
  name: 'Firma AB',
  forms: false,
  booking: false,
  turnstile: { booking: false, forms: false },
  analytics: false,
};
const headings = (facts, locale) => privacyPolicy(facts, locale).map((s) => s.heading);

test('the privacy policy has only the parts the site uses, in its language', () => {
  assert.deepEqual(headings(base, 'sv'), [
    'Vem som ansvarar',
    'Kakor (cookies)',
    'Vilka som hjälper oss',
    'Dina rättigheter',
  ]);
  const all = {
    ...base,
    forms: true,
    booking: true,
    turnstile: { booking: true, forms: true },
    analytics: true,
  };
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

test('the privacy policy states the forms retention only when every form deletes', () => {
  const contact = (facts, locale) =>
    privacyPolicy({ ...base, forms: true, ...facts }, locale)[1].paragraphs[1];
  assert.match(contact({ formsRetentionDays: 365 }, 'sv'), /ungefär 365 dagar efter/);
  assert.match(contact({ formsRetentionDays: 30 }, 'en'), /about 30 days after/);
  assert.doesNotMatch(contact({}, 'sv'), /dagar/);
  assert.doesNotMatch(contact({}, 'sv'), /för det,/);
  const cookies = privacyPolicy(base, 'sv').find((s) => s.heading === 'Kakor (cookies)');
  assert.doesNotMatch(cookies.paragraphs[0], /ljust eller mörkt/);
});

test('the spam protection paragraph names what uses Turnstile', () => {
  const spam = (turnstile, locale) =>
    privacyPolicy({ ...base, booking: true, forms: true, turnstile }, locale).find((s) =>
      /spam|skräppost/i.test(s.heading)
    )?.paragraphs[0];
  assert.equal(spam({ booking: false, forms: false }, 'sv'), undefined);
  assert.match(spam({ booking: true, forms: false }, 'sv'), /använder bokningen Cloudflare/);
  assert.match(spam({ booking: false, forms: true }, 'sv'), /använder våra formulär Cloudflare/);
  assert.match(spam({ booking: true, forms: true }, 'sv'), /bokningen och våra formulär/);
  assert.match(spam({ booking: true, forms: false }, 'en'), /booking uses Cloudflare/);
  assert.match(spam({ booking: true, forms: true }, 'en'), /booking and our forms use/);
});

test('validation messages follow the site language and the field', async () => {
  const { validationMessage, validationText, validationScript } =
    await import('../dist/site/validation.js');
  const sv = validationText('sv-SE');
  const msg = (field) => validationMessage(field, sv);
  assert.equal(msg({ type: 'text', validity: { valueMissing: true } }), 'Fyll i det här fältet.');
  assert.equal(
    msg({ type: 'checkbox', validity: { valueMissing: true } }),
    'Kryssa i den här rutan.'
  );
  assert.equal(msg({ type: 'radio', validity: { valueMissing: true } }), 'Välj ett alternativ.');
  assert.equal(
    msg({ type: 'select-one', validity: { valueMissing: true } }),
    'Välj ett alternativ.'
  );
  assert.equal(
    msg({ type: 'email', validity: { typeMismatch: true } }),
    'Ange en giltig e-postadress.'
  );
  assert.equal(
    msg({ type: 'text', minLength: 3, validity: { tooShort: true } }),
    'Använd minst 3 tecken.'
  );
  assert.equal(msg({ type: 'text', validity: {} }), '');
  assert.equal(
    validationMessage({ type: 'text', validity: { valueMissing: true } }, validationText('de')),
    'Please fill in this field.'
  );
  // The page script is valid JavaScript with the texts in it.
  const script = validationScript('sv');
  new Function(script);
  assert.match(script, /Fyll i det här fältet/);
});

test("the Forms plugin's English texts are translated on a site that isn't English", async () => {
  const { formText, validationText, validationScript } = await import('../dist/site/validation.js');
  const sv = validationText('sv');
  assert.equal(formText('Submitting...', sv), 'Skickar…');
  assert.equal(formText('Network error. Please try again.', sv), sv.offline);
  assert.equal(formText('Step 2 of 3', sv), 'Steg 2 av 3');
  assert.equal(
    formText('Telefon must be a valid phone number', sv),
    'Ange ett giltigt telefonnummer.'
  );
  assert.equal(formText('E-post is required', sv), 'Fyll i det här fältet.');
  assert.equal(formText('Tack för ditt meddelande.', sv), null);
  assert.equal(formText('Skickar…', sv), null);
  assert.doesNotMatch(validationScript('en'), /MutationObserver/);
  assert.match(validationScript('sv'), /MutationObserver/);
});
