// The visitor's booking UI in the browser: service, date, time, contact details, send. Enhances
// the markup of Booking.astro ([data-hb-booking]); all text is Swedish. Talks to the plugin's
// public routes (services, slots, book).

const API = '/_emdash/api/plugins/himlio-booking/';
const DAYS_PER_PAGE = 14;

interface Service {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
}
interface Day {
  date: string;
  starts: { start: string; time: string }[];
}
interface Slots {
  firstDate: string;
  lastDate: string;
  days: Day[];
}

async function call<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(API + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: { code?: string; message?: string } }
    | null;
  if (!res.ok || !json || !json.success) {
    const error = new Error(
      (json && !json.success && json.error?.message) || 'Något gick fel. Försök igen.'
    ) as Error & { code?: string };
    error.code = (json && !json.success && json.error?.code) || undefined;
    throw error;
  }
  return json.data;
}

const weekday = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const longDate = new Intl.DateTimeFormat('sv-SE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const asUtc = (date: string) => new Date(`${date}T12:00:00Z`);
const addDays = (date: string, n: number) =>
  new Date(asUtc(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const minutes = (n: number) =>
  n % 60 === 0 ? `${n / 60} h` : n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`;

/** Appends children (Element.append's type clashes with workers-types in this package). */
function add(parent: Node, ...children: Node[]) {
  for (const child of children) parent.appendChild(child);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function init(root: HTMLElement) {
  if (root.dataset.hbReady) return;
  root.dataset.hbReady = '1';
  const form = root.querySelector<HTMLFormElement>('form')!;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const servicePart = q<HTMLFieldSetElement>('[data-hb-services]');
  const serviceList = q<HTMLElement>('[data-hb-service-list]');
  const datePart = q<HTMLFieldSetElement>('[data-hb-dates]');
  const dateList = q<HTMLElement>('[data-hb-date-list]');
  const prev = q<HTMLButtonElement>('[data-hb-prev]');
  const next = q<HTMLButtonElement>('[data-hb-next]');
  const timePart = q<HTMLFieldSetElement>('[data-hb-times]');
  const timeList = q<HTMLElement>('[data-hb-time-list]');
  const timeLegend = q<HTMLElement>('[data-hb-time-legend]');
  const details = q<HTMLFieldSetElement>('[data-hb-details]');
  const summary = q<HTMLElement>('[data-hb-summary]');
  const status = q<HTMLElement>('[data-hb-status]');
  const submit = q<HTMLButtonElement>('[data-hb-submit]');
  const fixed = root.dataset.service ?? '';

  let services: Service[] = [];
  let service: Service | undefined;
  let from = '';
  let slots: Slots | undefined;
  let date = '';
  let start: { start: string; time: string } | undefined;

  const say = (text: string, kind: 'info' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  function renderServices() {
    serviceList.replaceChildren();
    servicePart.hidden = services.length < 2 || !!fixed;
    for (const s of services) {
      const label = el('label', { class: 'hb-booking-option' });
      const input = el('input', {
        type: 'radio',
        name: 'service',
        value: s.id,
        checked: s.id === service?.id,
      });
      input.addEventListener('change', () => choose(s));
      const text = el('span', { class: 'hb-booking-option-text' });
      add(text, el('strong', {}, s.name), el('span', {}, minutes(s.durationMinutes)));
      if (s.description) add(text, el('span', { class: 'hb-booking-option-desc' }, s.description));
      add(label, input, text);
      add(serviceList, label);
    }
  }

  async function choose(s: Service) {
    service = s;
    from = '';
    date = '';
    start = undefined;
    await loadSlots();
  }

  async function loadSlots() {
    if (!service) return;
    datePart.hidden = false;
    datePart.setAttribute('aria-busy', 'true');
    say('Hämtar lediga tider…');
    try {
      slots = await call<Slots>('slots', {
        serviceId: service.id,
        from: from || undefined,
        days: DAYS_PER_PAGE,
      });
      from = slots.days[0]?.date ?? from;
      say('');
      if (!date || !slots.days.some((d) => d.date === date && d.starts.length))
        date = slots.days.find((d) => d.starts.length)?.date ?? '';
      renderDates();
      renderTimes();
    } catch (error) {
      say((error as Error).message, 'error');
    } finally {
      datePart.removeAttribute('aria-busy');
    }
  }

  function renderDates() {
    if (!slots) return;
    dateList.replaceChildren();
    for (const d of slots.days) {
      const button = el('button', {
        type: 'button',
        class: 'hb-booking-date',
        'aria-pressed': String(d.date === date),
        disabled: d.starts.length === 0,
        'aria-label': `${longDate.format(asUtc(d.date))}${d.starts.length ? '' : ', inga lediga tider'}`,
      });
      add(
        button,
        el('span', { class: 'hb-booking-date-weekday' }, weekday.format(asUtc(d.date))),
        el('span', { class: 'hb-booking-date-day' }, dayMonth.format(asUtc(d.date)))
      );
      button.addEventListener('click', () => {
        date = d.date;
        start = undefined;
        renderDates();
        renderTimes();
      });
      add(dateList, button);
    }
    prev.disabled = !from || from <= slots.firstDate;
    next.disabled = addDays(from, DAYS_PER_PAGE) > slots.lastDate;
    if (!slots.days.some((d) => d.starts.length))
      say('Inga lediga tider de här dagarna. Prova nästa period.');
  }

  function renderTimes() {
    const day = slots?.days.find((d) => d.date === date);
    timePart.hidden = !day;
    details.hidden = !start;
    submit.hidden = !start;
    timeList.replaceChildren();
    if (!day) return;
    timeLegend.textContent = `Tid, ${longDate.format(asUtc(day.date))}`;
    for (const s of day.starts) {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'hb-booking-time',
          'aria-pressed': String(s.start === start?.start),
        },
        s.time
      );
      button.addEventListener('click', () => {
        start = s;
        renderTimes();
        summary.textContent = `${service!.name}, ${longDate.format(asUtc(day.date))} kl. ${s.time}`;
        details.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      });
      add(timeList, button);
    }
  }

  prev.addEventListener('click', () => {
    from = addDays(from, -DAYS_PER_PAGE);
    if (slots && from < slots.firstDate) from = slots.firstDate;
    date = '';
    start = undefined;
    void loadSlots();
  });
  next.addEventListener('click', () => {
    from = addDays(from, DAYS_PER_PAGE);
    date = '';
    start = undefined;
    void loadSlots();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!service || !start) return say('Välj en tid först.', 'error');
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const value = (k: string) => String(data.get(k) ?? '').trim();
    submit.disabled = true;
    say('Skickar…');
    try {
      const result = await call<{ holdMinutes: number }>('book', {
        serviceId: service.id,
        start: start.start,
        name: value('name'),
        email: value('email'),
        phone: value('phone') || undefined,
        message: value('message') || undefined,
        website: value('website') || undefined,
      });
      const done = el('div', { class: 'hb-booking-done', role: 'status', tabindex: '-1' });
      add(
        done,
        el('h3', {}, 'Nästan klart!'),
        el(
          'p',
          {},
          `Vi har skickat ett mejl till ${value('email')}. Bekräfta bokningen via länken i mejlet ` +
            `inom ${result.holdMinutes} minuter, annars släpps tiden.`
        ),
        el('p', {}, summary.textContent ?? '')
      );
      say('');
      form.replaceWith(done);
      done.focus();
    } catch (error) {
      const e = error as Error & { code?: string };
      say(e.message, 'error');
      if (e.code === 'TAKEN') {
        start = undefined;
        await loadSlots();
        say(e.message, 'error');
      }
    } finally {
      submit.disabled = false;
    }
  });

  (async () => {
    try {
      services = (await call<{ items: Service[] }>('services', {})).items;
      const wanted = fixed.toLowerCase();
      if (fixed)
        services = services.filter((s) => s.id === fixed || s.name.toLowerCase() === wanted);
      if (services.length === 0) {
        say('Det går inte att boka just nu.');
        return;
      }
      root.querySelector('[data-hb-noscript]')?.remove();
      form.hidden = false;
      renderServices();
      if (services.length === 1) await choose(services[0]!);
      else say('Välj vad du vill boka.');
    } catch (error) {
      say((error as Error).message, 'error');
    }
  })();
}

/** Starts every booking form on the page (and is safe to call again). */
export function initBooking() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-hb-booking]')) init(root);
}
