// Sample content for `himlio-site fixtures`, in the site's language (himlio.json `locale`): it
// stands in for the customer's content, so it uses that language's page URLs and its long words
// (Swedish compound words don't fit narrow columns). Names inside the CMS that aren't URLs (the
// form's slug and name, field names) are English whatever the language. Every text says it is
// sample text.

const en = {
  pages: { about: 'about', contact: 'contact' },
  titles: { start: 'Welcome', home: 'Home', about: 'About us', contact: 'Contact' },
  startText:
    'This is sample content from himlio-site fixtures, to see how the design works with real text. It is only on the local development server.',
  aboutText:
    'Sample text: a couple of paragraphs about the company. Here the customer can tell what they do, for whom, and how to get in touch.',
  moreText: 'Another paragraph of sample text, to show line length and spacing.',
  subheading: 'Sample subheading',
  startHeading: 'Sample text for the home page',
  hero: {
    headline: 'Sample headline for the home page',
    subheadline: 'Sample text: one sentence about what the company offers.',
    cta: 'About us',
  },
  contact: {
    eyebrow: 'Contact',
    headline: 'Get in touch',
    intro: 'Sample text: write to us and we will get back to you.',
    aside: 'Sample text: a few lines beside the form, for example when you answer.',
  },
  form: {
    labels: { name: 'Name', email: 'Email', phone: 'Phone', message: 'Message' },
    submit: 'Send',
    confirmation: 'Thank you! This is a sample form on the development server.',
  },
  tagline: 'Sample text: one sentence about what the company does.',
  company: {
    phone: '+44 20 7946 0000',
    address: '1 Example Street\nLondon EC1A 1AA',
    org_number: '01234567',
    opening_hours: 'Mon–Fri 9–17',
  },
  long: {
    headline:
      'A sample headline with a really long word in it: internationalisation-responsibilities',
    short: 'Sample text, a few words',
    sentence:
      'Sample text: a longer sentence that shows how text wraps over several lines, with words like counterrevolutionaries.',
    paragraphs:
      'Sample text: the first paragraph, long enough to show line length and the space between lines.\n\nThe second paragraph, with a long word like incomprehensibilities and one more sentence.',
    lines: 'First point\nSecond point, a little longer than the first\nThird point',
    subheading: 'Sample subheading',
    price: '£120',
  },
};

const sv = {
  pages: { about: 'om-oss', contact: 'kontakt' },
  titles: { start: 'Välkommen', home: 'Start', about: 'Om oss', contact: 'Kontakt' },
  startText:
    'Det här är exempelinnehåll från himlio-site fixtures, för att se hur designen fungerar med riktig text. Det visas bara på den lokala utvecklingsservern.',
  aboutText:
    'Exempeltext: ett par stycken om företaget. Här kan kunden berätta vad de gör, för vem och hur man kommer i kontakt.',
  moreText: 'Ytterligare ett stycke exempeltext för att visa radlängd och avstånd.',
  subheading: 'Exempel på underrubrik',
  startHeading: 'Exempeltext för startsidan',
  hero: {
    headline: 'Exempelrubrik för startsidan',
    subheadline: 'Exempeltext: en mening om vad företaget erbjuder.',
    cta: 'Om oss',
  },
  contact: {
    eyebrow: 'Kontakt',
    headline: 'Kontakta oss',
    intro: 'Exempeltext: skriv till oss så hör vi av oss.',
    aside: 'Exempeltext: ett par rader bredvid formuläret, till exempel när ni svarar.',
  },
  form: {
    labels: { name: 'Namn', email: 'E-post', phone: 'Telefon', message: 'Meddelande' },
    submit: 'Skicka',
    confirmation: 'Tack! Det här är ett exempelformulär på utvecklingsservern.',
  },
  tagline: 'Exempeltext: en mening om vad företaget gör.',
  company: {
    phone: '08-123 456 78',
    address: 'Exempelgatan 1\n123 45 Stockholm',
    org_number: '556000-0000',
    opening_hours: 'Mån–fre 9–17',
  },
  long: {
    headline:
      'Exempelrubrik med ett riktigt långt sammansatt ord: hårvårdsspecialistkonsultationer',
    short: 'Exempeltext med några ord',
    sentence:
      'Exempeltext: en längre mening som visar hur texten bryts över flera rader, med ord som verksamhetsutvecklingsprojekt.',
    paragraphs:
      'Exempeltext: första stycket, tillräckligt långt för att visa radlängd och avstånd mellan rader.\n\nAndra stycket, med ett långt ord som kundtjänstmedarbetarutbildning och en mening till.',
    lines: 'Första punkten\nAndra punkten, lite längre än den första\nTredje punkten',
    subheading: 'Exempel på underrubrik',
    price: '1 200 kr',
  },
};

const SAMPLES = { en, sv };

/** The sample content for a locale ("sv", "sv-SE" → Swedish; anything else → English). */
export function samples(locale) {
  return (
    SAMPLES[
      String(locale ?? '')
        .toLowerCase()
        .split(/[-_]/)[0]
    ] ?? en
  );
}
