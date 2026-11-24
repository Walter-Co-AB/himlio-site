// The generated privacy policy: what the site's platform features do with personal data, in the
// site's language. Only the parts the site uses are included (forms, booking, Turnstile,
// analytics). It covers the platform; the company adds anything else it does (in the page
// around the block) and is responsible for the whole text. Pure; rendered by
// ./astro/PrivacyPolicy.astro with facts from runtime/privacy.ts.
import { language } from '../booking/strings.js';
import { RETENTION_DAYS, EXPIRED_RETENTION_DAYS } from '../booking/core.js';

export interface PrivacyFacts {
  /** The company (the site's name). */
  name: string;
  orgNumber?: string;
  address?: string;
  email?: string;
  phone?: string;
  forms: boolean;
  /**
   * How long form messages are kept: the longest retention of the active forms, when every one
   * deletes its messages (Forms plugin, weekly cleanup); undefined when any keeps them.
   */
  formsRetentionDays?: number;
  booking: boolean;
  turnstile: boolean;
  analytics: boolean;
}

export interface PolicySection {
  heading: string;
  paragraphs: string[];
  list?: string[];
}

const join = (parts: (string | undefined)[]) => parts.filter(Boolean).join(', ');

function en(f: PrivacyFacts): PolicySection[] {
  const who = f.orgNumber ? `${f.name} (company registration number ${f.orgNumber})` : f.name;
  const reach = join([f.email, f.phone, f.address?.replace(/\n/g, ', ')]);
  const sections: PolicySection[] = [
    {
      heading: 'Who is responsible',
      paragraphs: [
        `${who} is the controller for the personal data handled on this website.${reach ? ` You can reach us at ${reach}.` : ''}`,
      ],
    },
  ];
  if (f.forms)
    sections.push({
      heading: 'When you contact us',
      paragraphs: [
        'When you send a message through a form on the website, we receive what you write in it, usually your name, your contact details and your message. We use it to answer you and to follow up on your request, based on our legitimate interest in answering those who contact us.',
        f.formsRetentionDays
          ? `We keep the message as long as we need it to handle your request. It is deleted automatically about ${f.formsRetentionDays} days after it arrives.`
          : 'We keep the message as long as we need it to handle your request, and then delete it.',
      ],
    });
  if (f.booking)
    sections.push({
      heading: 'When you book',
      paragraphs: [
        'When you book a time, we receive your name, email address, phone number if you give it, what you booked and anything you write to us. We use it to manage the booking: to confirm it, send reminders and changes, and to be able to reach you. The legal basis is the agreement you make with us when you book.',
        `We delete a booking ${RETENTION_DAYS} days after the appointment, and a request or booking that was never confirmed after ${EXPIRED_RETENTION_DAYS} days.`,
      ],
    });
  if (f.turnstile)
    sections.push({
      heading: 'Protection against spam',
      paragraphs: [
        'To stop automated spam, our forms use Cloudflare Turnstile, which checks information about your browser and connection to tell people from bots. It does not use cookies for advertising or follow you across websites. The legal basis is our legitimate interest in protecting the website against abuse.',
      ],
    });
  if (f.analytics)
    sections.push({
      heading: 'Visitor statistics',
      paragraphs: [
        'We count visits with Cloudflare Web Analytics to see how the website is used. It uses no cookies, does not store your IP address and does not follow you across websites, so we cannot tell who you are from the statistics.',
      ],
    });
  sections.push(
    {
      heading: 'Cookies',
      paragraphs: [
        'The website only uses cookies it needs to work, for example to keep those who edit the website logged in, or to remember a choice you made on the page. They are not used to track you or for advertising.',
      ],
    },
    {
      heading: 'Who helps us',
      paragraphs: [
        `The website runs on Cloudflare, which also sends our emails. Cloudflare handles data on our behalf, under a data processing agreement, and may handle it outside the EU/EEA under the EU–US Data Privacy Framework. We do not sell personal data or share it with anyone for their own purposes.`,
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You have the right to know what personal data we hold about you and to get a copy of it, to have wrong data corrected, to have data deleted, and to object to or restrict how we use it. Contact us to use your rights.',
        'If you think we handle your personal data wrongly, you can complain to the data protection authority in your country.',
      ],
    }
  );
  return sections;
}

function sv(f: PrivacyFacts): PolicySection[] {
  const who = f.orgNumber ? `${f.name} (organisationsnummer ${f.orgNumber})` : f.name;
  const reach = join([f.email, f.phone, f.address?.replace(/\n/g, ', ')]);
  const sections: PolicySection[] = [
    {
      heading: 'Vem som ansvarar',
      paragraphs: [
        `${who} är personuppgiftsansvarig för de personuppgifter som hanteras på den här webbplatsen.${reach ? ` Du når oss på ${reach}.` : ''}`,
      ],
    },
  ];
  if (f.forms)
    sections.push({
      heading: 'När du kontaktar oss',
      paragraphs: [
        'När du skickar ett meddelande via ett formulär på webbplatsen får vi det du skriver, oftast ditt namn, dina kontaktuppgifter och ditt meddelande. Vi använder det för att svara dig och följa upp ditt ärende, med stöd av vårt berättigade intresse av att kunna svara den som kontaktar oss.',
        f.formsRetentionDays
          ? `Vi sparar meddelandet så länge vi behöver det för att hantera ditt ärende. Det raderas automatiskt ungefär ${f.formsRetentionDays} dagar efter att det kom in.`
          : 'Vi sparar meddelandet så länge vi behöver det för att hantera ditt ärende, och raderar det sedan.',
      ],
    });
  if (f.booking)
    sections.push({
      heading: 'När du bokar',
      paragraphs: [
        'När du bokar en tid får vi ditt namn, din e-postadress, ditt telefonnummer om du anger det, vad du bokade och det du skriver till oss. Vi använder det för att hantera bokningen: bekräfta den, skicka påminnelser och ändringar och kunna nå dig. Den rättsliga grunden är avtalet du ingår med oss när du bokar.',
        `Vi raderar en bokning ${RETENTION_DAYS} dagar efter besöket, och en förfrågan eller bokning som aldrig bekräftades efter ${EXPIRED_RETENTION_DAYS} dagar.`,
      ],
    });
  if (f.turnstile)
    sections.push({
      heading: 'Skydd mot skräppost',
      paragraphs: [
        'För att stoppa automatisk skräppost använder våra formulär Cloudflare Turnstile, som kontrollerar uppgifter om din webbläsare och anslutning för att skilja människor från robotar. Den använder inga kakor för reklam och följer dig inte mellan webbplatser. Den rättsliga grunden är vårt berättigade intresse av att skydda webbplatsen mot missbruk.',
      ],
    });
  if (f.analytics)
    sections.push({
      heading: 'Besöksstatistik',
      paragraphs: [
        'Vi räknar besök med Cloudflare Web Analytics för att se hur webbplatsen används. Den använder inga kakor, sparar inte din IP-adress och följer dig inte mellan webbplatser, så vi kan inte se vem du är i statistiken.',
      ],
    });
  sections.push(
    {
      heading: 'Kakor (cookies)',
      paragraphs: [
        'Webbplatsen använder bara kakor som behövs för att den ska fungera, till exempel för att hålla de som redigerar webbplatsen inloggade eller för att komma ihåg ett val du gjort på sidan. De används inte för att spåra dig eller för reklam.',
      ],
    },
    {
      heading: 'Vilka som hjälper oss',
      paragraphs: [
        'Webbplatsen drivs på Cloudflare, som också skickar våra e-postmeddelanden. Cloudflare behandlar uppgifter för vår räkning enligt ett personuppgiftsbiträdesavtal och kan behandla dem utanför EU/EES med stöd av EU:s och USA:s ramverk för dataskydd (Data Privacy Framework). Vi säljer inte personuppgifter och lämnar inte ut dem till någon för deras egna syften.',
      ],
    },
    {
      heading: 'Dina rättigheter',
      paragraphs: [
        'Du har rätt att få veta vilka personuppgifter vi har om dig och få en kopia av dem, att få felaktiga uppgifter rättade, att få uppgifter raderade och att invända mot eller begränsa hur vi använder dem. Kontakta oss för att använda dina rättigheter.',
        'Om du tycker att vi hanterar dina personuppgifter fel kan du klaga hos Integritetsskyddsmyndigheten (IMY), imy.se.',
      ],
    }
  );
  return sections;
}

/** The policy's sections in the site's language (Swedish for "sv", otherwise English). */
export function privacyPolicy(facts: PrivacyFacts, locale: string): PolicySection[] {
  return language(locale) === 'sv' ? sv(facts) : en(facts);
}

/** The privacy page's title and URL slug in the site's language. */
export function privacyPage(locale: string): { title: string; slug: string } {
  return language(locale) === 'sv'
    ? { title: 'Integritetspolicy', slug: 'integritetspolicy' }
    : { title: 'Privacy policy', slug: 'privacy-policy' };
}
