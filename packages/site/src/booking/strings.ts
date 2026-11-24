// Everything a visitor reads in booking (the form, its messages, the emails to the visitor and
// the link pages), per language. The site's language is `locale` in himlio.json ("sv" → Swedish;
// anything else → English). The code and the customer's own notifications are English.
//
// Used on the server and in the browser (client.ts), so no imports beyond plain TypeScript.

export type Lang = 'en' | 'sv';

/** The language for a locale: "sv", "sv-SE" → sv; anything else → en. */
export const language = (locale?: string | null): Lang =>
  locale?.toLowerCase().startsWith('sv') ? 'sv' : 'en';

/** The Intl locale for dates and numbers. */
export const intlLocale = (lang: Lang) => (lang === 'sv' ? 'sv-SE' : 'en-GB');

type Pair = readonly [title: string, text: string];

export interface BookingText {
  lang: Lang;
  // --- The form (Booking.astro and client.ts) ---
  noScript: string;
  whatLegend: string;
  whoLegend: string;
  dateLegend: string;
  earlierDates: string;
  laterDates: string;
  timeLegend: string;
  /** "Time, Monday 23 November" */
  timeOn: (date: string) => string;
  name: string;
  email: string;
  phone: string;
  message: string;
  honeypot: string;
  book: string;
  sendRequest: string;
  anyone: Pair;
  /** " with Anna" after a service name */
  withWhom: (name: string) => string;
  /** "Monday 23 November at 10:00" */
  at: (date: string, time: string) => string;
  /** "from " before a price */
  priceFrom: string;
  noTimesOnDay: string;
  loading: string;
  noTimes: string;
  requestNote: string;
  deadlineNote: (hours: number) => string;
  pickTime: string;
  sending: string;
  unavailable: string;
  chooseService: string;
  genericError: string;
  confirmedDone: (email: string) => Pair;
  requestedDone: (email: string) => Pair;
  pendingDone: (email: string, minutes: number) => Pair;
  // --- Errors from the server that the visitor sees ---
  errors: {
    taken: string;
    noService: string;
    rateLimited: string;
    busy: string;
    tooMany: (count: number) => string;
    missingAnswer: (label: string) => string;
    missingName: string;
    invalidEmail: string;
    noTime: string;
    noResource: string;
    mailFailed: string;
  };
  // --- Emails to the visitor ---
  mail: {
    greeting: string;
    hello: (name: string) => string;
    signature: (site: string) => string;
    /** "Monday 23 November 2026 at 10:00–11:00" */
    when: (date: string, start: string, end: string) => string;
    /** "by Sunday 22 November at 10:00" */
    deadline: (date: string, time: string) => string;
    cantCome: string;
    cantComeBy: (deadline: string) => string;
    rebook: string;
    cancel: string;
    confirmRequest: { subject: (site: string) => string; booked: string; confirmIt: string };
    confirmBooking: { subject: (site: string) => string; booked: string; confirmIt: string };
    confirmBody: (
      did: string,
      what: string,
      confirm: string,
      minutes: number,
      url: string
    ) => string;
    confirmedSubject: (what: string) => string;
    movedSubject: (what: string) => string;
    confirmedLead: string;
    movedLead: string;
    calendarFile: string;
    icsFile: string;
    cancelIcsFile: string;
    requestReceivedSubject: (what: string) => string;
    requestReceived: (what: string) => string;
    withdraw: (url: string) => string;
    declinedSubject: (what: string) => string;
    declined: (what: string) => string;
    expired: (what: string) => string;
    declinedOutro: string;
    reminderSubject: (what: string) => string;
    reminder: (what: string) => string;
    cancelledSubject: (what: string) => string;
    cancelledByStaff: (what: string) => string;
    cancelledByVisitor: (what: string) => string;
  };
  // --- Link pages (/_booking) ---
  page: {
    badLink: Pair;
    notFound: Pair;
    failed: Pair;
    done: string;
    toSite: string;
    confirmRequest: string;
    confirmBooking: string;
    cancelTitle: string;
    cancelButton: string;
    rebookTitle: string;
    now: (what: string) => string;
    pickNewTime: string;
    noTimes: string;
    earlier: string;
    later: string;
    results: Record<'confirm' | 'cancel' | 'rebook', Record<string, Pair>>;
  };
}

const en: BookingText = {
  lang: 'en',
  noScript: 'Turn on JavaScript to book a time.',
  whatLegend: 'What would you like to book?',
  whoLegend: 'With whom?',
  dateLegend: 'Date',
  earlierDates: 'Earlier dates',
  laterDates: 'Later dates',
  timeLegend: 'Time',
  timeOn: (date) => `Time, ${date}`,
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  message: 'Message',
  honeypot: 'Leave empty',
  book: 'Book',
  sendRequest: 'Send request',
  anyone: ['Anyone', 'First free time'],
  withWhom: (name) => ` with ${name}`,
  at: (date, time) => `${date} at ${time}`,
  priceFrom: 'from ',
  noTimesOnDay: ', no free times',
  loading: 'Finding free times…',
  noTimes: 'No free times on these days. Try the next period.',
  requestNote: 'This is a request: the time is held for you and you will hear from us by email.',
  deadlineNote: (hours) => `Cancel or change at least ${hours} hours before.`,
  pickTime: 'Choose a time first.',
  sending: 'Sending…',
  unavailable: 'Booking is not available right now.',
  chooseService: 'Choose what you would like to book.',
  genericError: 'Something went wrong. Please try again.',
  confirmedDone: (email) => [
    'Thank you, you are booked!',
    `We have sent a confirmation with a calendar file to ${email}.`,
  ],
  requestedDone: (email) => [
    'Thank you for your request!',
    `The time is held for you. We will write to ${email} when we have answered.`,
  ],
  pendingDone: (email, minutes) => [
    'Almost done!',
    `We have sent an email to ${email}. Confirm with the link in it within ${minutes} minutes, or the time is released.`,
  ],
  errors: {
    taken: 'That time is no longer free. Please choose another.',
    noService: 'That service does not exist.',
    rateLimited: 'Too many bookings in a short time. Please try again later.',
    busy: 'Booking is not available right now. Please try again in a while.',
    tooMany: (count) =>
      `You already have ${count} upcoming bookings. Please cancel one of them first.`,
    missingAnswer: (label) => `Please fill in “${label}”.`,
    missingName: 'Please fill in your name.',
    invalidEmail: 'Please fill in a valid email address.',
    noTime: 'Please choose a time.',
    noResource: 'This cannot be booked right now.',
    mailFailed: 'The confirmation email could not be sent. Please try again later.',
  },
  mail: {
    greeting: 'Hello!',
    hello: (name) => `Hello ${name}!`,
    signature: (site) => `\n\nKind regards\n${site}`,
    when: (date, start, end) => `${date} at ${start}–${end}`,
    deadline: (date, time) => `by ${date} at ${time}`,
    cantCome: 'Can’t make it?',
    cantComeBy: (deadline) => `Can’t make it? Cancel or change ${deadline}.`,
    rebook: 'Change time',
    cancel: 'Cancel',
    confirmRequest: {
      subject: (site) => `Confirm your request at ${site}`,
      booked: 'sent a request for',
      confirmIt: 'the request',
    },
    confirmBooking: {
      subject: (site) => `Confirm your booking at ${site}`,
      booked: 'booked',
      confirmIt: 'the booking',
    },
    confirmBody: (did, what, confirm, minutes, url) =>
      `Someone, hopefully you, has ${did} ${what}.\n\n` +
      `Confirm ${confirm} within ${minutes} minutes by opening the link:\n${url}\n\n` +
      'If you don’t confirm, the time is released to someone else. If you didn’t book anything, ' +
      'you can ignore this email.',
    confirmedSubject: (what) => `Booking confirmed: ${what}`,
    movedSubject: (what) => `Booking moved: ${what}`,
    confirmedLead: 'Your booking is confirmed',
    movedLead: 'Your booking has been moved to',
    calendarFile: 'The time is in the attached calendar file.',
    icsFile: 'booking.ics',
    cancelIcsFile: 'cancellation.ics',
    requestReceivedSubject: (what) => `Request received: ${what}`,
    requestReceived: (what) =>
      `Thank you for your request for ${what}. The time is held for you until we have answered, ` +
      'and you will get an email when we have confirmed, or if we can’t take it.',
    withdraw: (url) => `Want to withdraw the request? ${url}`,
    declinedSubject: (what) => `Your request: ${what}`,
    declined: (what) => `Unfortunately we can’t take your request for ${what}. `,
    expired: (what) =>
      `Unfortunately we didn’t manage to answer your request for ${what}, and the time has been released. `,
    declinedOutro: 'Feel free to reply to this email, or choose another time on the website.',
    reminderSubject: (what) => `Reminder: ${what}`,
    reminder: (what) => `Welcome to ${what}.`,
    cancelledSubject: (what) => `Cancelled: ${what}`,
    cancelledByStaff: (what) =>
      `Unfortunately we have had to cancel your booking of ${what}. ` +
      'Reply to this email if you have questions, or book a new time on the website.',
    cancelledByVisitor: (what) => `Your booking of ${what} is cancelled.`,
  },
  page: {
    badLink: ['The link doesn’t work', 'Check that the whole link from the email came along.'],
    notFound: ['The booking doesn’t exist', 'It may already have been removed.'],
    failed: ['Something went wrong', 'Please try again in a while.'],
    done: 'Done',
    toSite: 'To the website',
    confirmRequest: 'Confirm the request',
    confirmBooking: 'Confirm the booking',
    cancelTitle: 'Cancel',
    cancelButton: 'Cancel the booking',
    rebookTitle: 'Change time',
    now: (what) => `Now: ${what}`,
    pickNewTime: 'Choose a new time:',
    noTimes: 'No free times on these days.',
    earlier: '← Earlier dates',
    later: 'Later dates →',
    results: {
      confirm: {
        confirmed: [
          'The booking is confirmed',
          'You will get an email with the booking and a calendar file.',
        ],
        requested: [
          'The request is sent',
          'The time is held for you. You will get an email when it is confirmed, or if it can’t be taken.',
        ],
        already: ['Already confirmed', ''],
        gone: [
          'The time is no longer free',
          'The confirmation came too late and the time went to someone else. Feel free to book a new time.',
        ],
        cancelled: [
          'The booking is cancelled',
          'This booking has been cancelled. Feel free to book a new time.',
        ],
        past: ['The time has already passed', ''],
      },
      cancel: {
        cancelled: ['Cancelled', 'You will get a confirmation by email.'],
        already: ['The booking is already cancelled', ''],
        gone: ['The booking doesn’t exist', 'It may already have been cancelled or removed.'],
        past: [
          'The time has already passed',
          'It can’t be cancelled afterwards. Contact us if something went wrong.',
        ],
        late: [
          'It’s too late to cancel here',
          'The time for cancelling on the web has run out. Contact us directly and we’ll help you.',
        ],
      },
      rebook: {
        moved: [
          'The booking is moved',
          'You will get an email with the new time and a calendar file.',
        ],
        gone: ['The booking doesn’t exist', 'It may already have been cancelled or removed.'],
        past: ['The time has already passed', ''],
        late: [
          'It’s too late to change the time here',
          'The time for changing on the web has run out. Contact us directly and we’ll help you.',
        ],
        taken: ['That time is no longer free', 'Please choose another time.'],
        limit: [
          'The booking has already been moved several times',
          'Contact us directly if you need to move it again.',
        ],
      },
    },
  },
};

const sv: BookingText = {
  lang: 'sv',
  noScript: 'Aktivera JavaScript för att boka en tid.',
  whatLegend: 'Vad vill du boka?',
  whoLegend: 'Hos vem?',
  dateLegend: 'Datum',
  earlierDates: 'Tidigare datum',
  laterDates: 'Senare datum',
  timeLegend: 'Tid',
  timeOn: (date) => `Tid, ${date}`,
  name: 'Namn',
  email: 'E-post',
  phone: 'Telefon',
  message: 'Meddelande',
  honeypot: 'Lämna tomt',
  book: 'Boka',
  sendRequest: 'Skicka förfrågan',
  anyone: ['Vem som helst', 'Första lediga tid'],
  withWhom: (name) => ` hos ${name}`,
  at: (date, time) => `${date} kl. ${time}`,
  priceFrom: 'från ',
  noTimesOnDay: ', inga lediga tider',
  loading: 'Hämtar lediga tider…',
  noTimes: 'Inga lediga tider de här dagarna. Prova nästa period.',
  requestNote: 'Det här är en förfrågan: tiden reserveras åt dig och du får besked med mejl.',
  deadlineNote: (hours) => `Avbokning och ombokning senast ${hours} timmar innan.`,
  pickTime: 'Välj en tid först.',
  sending: 'Skickar…',
  unavailable: 'Det går inte att boka just nu.',
  chooseService: 'Välj vad du vill boka.',
  genericError: 'Något gick fel. Försök igen.',
  confirmedDone: (email) => [
    'Tack, du är bokad!',
    `Vi har skickat en bekräftelse med kalenderfil till ${email}.`,
  ],
  requestedDone: (email) => [
    'Tack för din förfrågan!',
    `Tiden är reserverad åt dig. Du får besked till ${email} när vi har svarat.`,
  ],
  pendingDone: (email, minutes) => [
    'Nästan klart!',
    `Vi har skickat ett mejl till ${email}. Bekräfta via länken i mejlet inom ${minutes} minuter, annars släpps tiden.`,
  ],
  errors: {
    taken: 'Tiden är inte längre ledig. Välj en annan tid.',
    noService: 'Tjänsten finns inte.',
    rateLimited: 'För många bokningar på kort tid. Försök igen senare.',
    busy: 'Det går inte att boka just nu. Försök igen om en stund.',
    tooMany: (count) => `Du har redan ${count} kommande bokningar. Avboka någon av dem först.`,
    missingAnswer: (label) => `Fyll i ”${label}”.`,
    missingName: 'Fyll i ditt namn.',
    invalidEmail: 'Fyll i en giltig e-postadress.',
    noTime: 'Välj en tid.',
    noResource: 'Det går inte att boka det här just nu.',
    mailFailed: 'Bekräftelsemejlet kunde inte skickas. Försök igen senare.',
  },
  mail: {
    greeting: 'Hej!',
    hello: (name) => `Hej ${name}!`,
    signature: (site) => `\n\nVänliga hälsningar\n${site}`,
    when: (date, start, end) => `${date} kl. ${start}–${end}`,
    deadline: (date, time) => `senast ${date} kl. ${time}`,
    cantCome: 'Kan du inte komma?',
    cantComeBy: (deadline) => `Kan du inte komma? Avboka eller boka om ${deadline}.`,
    rebook: 'Boka om',
    cancel: 'Avboka',
    confirmRequest: {
      subject: (site) => `Bekräfta din förfrågan hos ${site}`,
      booked: 'skickat en förfrågan om',
      confirmIt: 'förfrågan',
    },
    confirmBooking: {
      subject: (site) => `Bekräfta din bokning hos ${site}`,
      booked: 'bokat',
      confirmIt: 'bokningen',
    },
    confirmBody: (did, what, confirm, minutes, url) =>
      `Någon, förhoppningsvis du, har ${did} ${what}.\n\n` +
      `Bekräfta ${confirm} inom ${minutes} minuter genom att öppna länken:\n${url}\n\n` +
      'Om du inte bekräftar släpps tiden till någon annan. Har du inte bokat något kan du ' +
      'bortse från det här mejlet.',
    confirmedSubject: (what) => `Bokning bekräftad: ${what}`,
    movedSubject: (what) => `Ombokad: ${what}`,
    confirmedLead: 'Din bokning är bekräftad',
    movedLead: 'Din bokning är flyttad till',
    calendarFile: 'Du hittar tiden i den bifogade kalenderfilen.',
    icsFile: 'bokning.ics',
    cancelIcsFile: 'avbokning.ics',
    requestReceivedSubject: (what) => `Förfrågan mottagen: ${what}`,
    requestReceived: (what) =>
      `Tack för din förfrågan om ${what}. Tiden är reserverad åt dig tills vi har svarat, ` +
      'och du får ett mejl när vi har bekräftat eller om vi inte kan ta emot den.',
    withdraw: (url) => `Vill du dra tillbaka förfrågan? ${url}`,
    declinedSubject: (what) => `Förfrågan: ${what}`,
    declined: (what) => `Vi kan tyvärr inte ta emot din förfrågan om ${what}. `,
    expired: (what) =>
      `Vi hann tyvärr inte svara på din förfrågan om ${what}, och tiden är släppt. `,
    declinedOutro: 'Svara gärna på det här mejlet, eller välj en annan tid på webbplatsen.',
    reminderSubject: (what) => `Påminnelse: ${what}`,
    reminder: (what) => `Välkommen till ${what}.`,
    cancelledSubject: (what) => `Avbokad: ${what}`,
    cancelledByStaff: (what) =>
      `Vi har tyvärr fått ställa in din bokning av ${what}. ` +
      'Svara på det här mejlet om du har frågor, eller boka en ny tid på webbplatsen.',
    cancelledByVisitor: (what) => `Din bokning av ${what} är avbokad.`,
  },
  page: {
    badLink: ['Länken fungerar inte', 'Kontrollera att hela länken från mejlet kom med.'],
    notFound: ['Bokningen finns inte', 'Den kan redan ha tagits bort.'],
    failed: ['Något gick fel', 'Försök igen om en stund.'],
    done: 'Klart',
    toSite: 'Till webbplatsen',
    confirmRequest: 'Bekräfta förfrågan',
    confirmBooking: 'Bekräfta bokningen',
    cancelTitle: 'Avboka',
    cancelButton: 'Avboka tiden',
    rebookTitle: 'Boka om',
    now: (what) => `Nu: ${what}`,
    pickNewTime: 'Välj en ny tid:',
    noTimes: 'Inga lediga tider de här dagarna.',
    earlier: '← Tidigare datum',
    later: 'Senare datum →',
    results: {
      confirm: {
        confirmed: ['Bokningen är bekräftad', 'Du får ett mejl med bokningen och en kalenderfil.'],
        requested: [
          'Förfrågan är skickad',
          'Tiden är reserverad åt dig. Du får ett mejl när den är bekräftad, eller om den inte kan tas emot.',
        ],
        already: ['Redan bekräftad', ''],
        gone: [
          'Tiden är inte längre ledig',
          'Bekräftelsen kom för sent och tiden har gått till någon annan. Boka gärna en ny tid.',
        ],
        cancelled: [
          'Bokningen är avbokad',
          'Den här bokningen har avbokats. Boka gärna en ny tid.',
        ],
        past: ['Tiden har redan passerat', ''],
      },
      cancel: {
        cancelled: ['Avbokat', 'Du får en bekräftelse med mejl.'],
        already: ['Bokningen är redan avbokad', ''],
        gone: ['Bokningen finns inte', 'Den kan redan ha avbokats eller tagits bort.'],
        past: [
          'Tiden har redan passerat',
          'Det går inte att avboka i efterhand. Kontakta oss om något blev fel.',
        ],
        late: [
          'Det är för sent att avboka här',
          'Tiden för att avboka på webben har gått ut. Kontakta oss direkt, så hjälper vi dig.',
        ],
      },
      rebook: {
        moved: ['Bokningen är flyttad', 'Du får ett mejl med den nya tiden och en kalenderfil.'],
        gone: ['Bokningen finns inte', 'Den kan redan ha avbokats eller tagits bort.'],
        past: ['Tiden har redan passerat', ''],
        late: [
          'Det är för sent att boka om här',
          'Tiden för att boka om på webben har gått ut. Kontakta oss direkt, så hjälper vi dig.',
        ],
        taken: ['Den tiden är inte längre ledig', 'Välj en annan tid.'],
        limit: [
          'Bokningen har redan flyttats flera gånger',
          'Kontakta oss direkt om du behöver flytta den igen.',
        ],
      },
    },
  },
};

export const BOOKING_TEXT: Record<Lang, BookingText> = { en, sv };

/** The visitor texts for a locale (himlio.json `locale`). */
export const bookingText = (locale?: string | null): BookingText => BOOKING_TEXT[language(locale)];
