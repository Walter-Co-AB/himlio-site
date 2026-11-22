// The visitor's booking UI in the browser: service, who (if the site has resources), date, time,
// contact details and the service's questions, send. Enhances the markup of Booking.astro
// ([data-hb-booking]); all text is Swedish. Talks to the plugin's public routes (services, slots,
// book). With Turnstile on the site, a widget proves the visitor is a person and the booking
// counts at once; otherwise the visitor confirms by email.

const API = '/_emdash/api/plugins/himlio-booking/';
const DAYS_PER_PAGE = 14;
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Question {
  id: string;
  label: string;
  required?: boolean;
  long?: boolean;
}
interface ServiceResource {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
}
interface Service {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  price?: { kind: 'fixed' | 'from'; amount: number };
  mode: 'instant' | 'request';
  cancelHours?: number;
  questions: Question[];
  resources: ServiceResource[];
}
interface Day {
  date: string;
  starts: { start: string; time: string; resources: string[] }[];
}
interface Slots {
  firstDate: string;
  lastDate: string;
  days: Day[];
}
interface BookResult {
  status: 'pending' | 'requested' | 'confirmed';
  holdMinutes?: number;
  resourceName?: string;
}

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id?: string): void;
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

let turnstileScript: Promise<Turnstile | null> | undefined;
function loadTurnstile(): Promise<Turnstile | null> {
  turnstileScript ??= new Promise((resolve) => {
    const existing = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (existing) return resolve(existing);
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () =>
      resolve((window as unknown as { turnstile?: Turnstile }).turnstile ?? null);
    script.onerror = () => resolve(null); // booking still works, by email confirmation
    document.head.appendChild(script);
  });
  return turnstileScript;
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
const kronor = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const asUtc = (date: string) => new Date(`${date}T12:00:00Z`);
const addDays = (date: string, n: number) =>
  new Date(asUtc(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const minutes = (n: number) =>
  n % 60 === 0 ? `${n / 60} h` : n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`;
const price = (p?: Service['price']) =>
  p ? `${p.kind === 'from' ? 'från ' : ''}${kronor.format(p.amount)} kr` : '';

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

let uid = 0;

function option(
  name: string,
  value: string,
  checked: boolean,
  lines: string[],
  onChange: () => void
) {
  const label = el('label', { class: 'hb-booking-option' });
  const input = el('input', { type: 'radio', name, value, checked });
  input.addEventListener('change', onChange);
  const text = el('span', { class: 'hb-booking-option-text' });
  const [title, ...rest] = lines;
  add(text, el('strong', {}, title ?? ''));
  for (const line of rest.filter(Boolean)) add(text, el('span', {}, line));
  add(label, input, text);
  return label;
}

function init(root: HTMLElement) {
  if (root.dataset.hbReady) return;
  root.dataset.hbReady = '1';
  const form = root.querySelector<HTMLFormElement>('form')!;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const servicePart = q<HTMLFieldSetElement>('[data-hb-services]');
  const serviceList = q<HTMLElement>('[data-hb-service-list]');
  const resourcePart = q<HTMLFieldSetElement>('[data-hb-resources]');
  const resourceList = q<HTMLElement>('[data-hb-resource-list]');
  const datePart = q<HTMLFieldSetElement>('[data-hb-dates]');
  const dateList = q<HTMLElement>('[data-hb-date-list]');
  const prev = q<HTMLButtonElement>('[data-hb-prev]');
  const next = q<HTMLButtonElement>('[data-hb-next]');
  const timePart = q<HTMLFieldSetElement>('[data-hb-times]');
  const timeList = q<HTMLElement>('[data-hb-time-list]');
  const timeLegend = q<HTMLElement>('[data-hb-time-legend]');
  const details = q<HTMLFieldSetElement>('[data-hb-details]');
  const questions = q<HTMLElement>('[data-hb-questions]');
  const summary = q<HTMLElement>('[data-hb-summary]');
  const note = q<HTMLElement>('[data-hb-note]');
  const turnstileBox = q<HTMLElement>('[data-hb-turnstile]');
  const status = q<HTMLElement>('[data-hb-status]');
  const submit = q<HTMLButtonElement>('[data-hb-submit]');
  const fixedService = root.dataset.service ?? '';
  const fixedResource = root.dataset.resource ?? '';

  let services: Service[] = [];
  let service: Service | undefined;
  let resource = 'any';
  let from = '';
  let slots: Slots | undefined;
  let date = '';
  let start: Day['starts'][number] | undefined;
  let siteKey: string | undefined;
  let turnstile: Turnstile | null = null;
  let widget: string | undefined;
  let token = '';

  const say = (text: string, kind: 'info' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };
  const nameOf = (id: string) => service?.resources.find((r) => r.id === id)?.name ?? '';

  function renderServices() {
    serviceList.replaceChildren();
    servicePart.hidden = services.length < 2 || !!fixedService;
    for (const s of services)
      add(
        serviceList,
        option(
          'service',
          s.id,
          s.id === service?.id,
          [
            s.name,
            [minutes(s.durationMinutes), price(s.price)].filter(Boolean).join(' · '),
            s.description ?? '',
          ],
          () => void choose(s)
        )
      );
  }

  function renderResources() {
    resourceList.replaceChildren();
    const rs = service?.resources ?? [];
    resourcePart.hidden = rs.length < 2 || !!fixedResource;
    if (resourcePart.hidden) return;
    add(
      resourceList,
      option('resource', 'any', resource === 'any', ['Vem som helst', 'Första lediga tid'], () => {
        resource = 'any';
        void reload();
      })
    );
    for (const r of rs)
      add(
        resourceList,
        option(
          'resource',
          r.id,
          resource === r.id,
          [
            r.name,
            r.durationMinutes !== service!.durationMinutes ? minutes(r.durationMinutes) : '',
            r.description ?? '',
          ],
          () => {
            resource = r.id;
            void reload();
          }
        )
      );
  }

  function renderQuestions() {
    questions.replaceChildren();
    for (const question of service?.questions ?? []) {
      const id = `hb-q-${++uid}`;
      const field = el('div', { class: 'ec-form-field' });
      const label = el('label', { class: 'ec-form-label', for: id }, question.label);
      if (question.required)
        add(label, el('span', { class: 'ec-form-required', 'aria-hidden': 'true' }, '*'));
      const input = question.long
        ? el('textarea', {
            class: 'ec-form-input',
            id,
            name: `q:${question.id}`,
            rows: '3',
            maxlength: '1000',
            required: !!question.required,
          })
        : el('input', {
            class: 'ec-form-input',
            id,
            name: `q:${question.id}`,
            maxlength: '200',
            required: !!question.required,
          });
      add(field, label, input);
      add(questions, field);
    }
  }

  async function choose(s: Service) {
    service = s;
    resource =
      fixedResource &&
      s.resources.some(
        (r) => r.id === fixedResource || r.name.toLowerCase() === fixedResource.toLowerCase()
      )
        ? s.resources.find(
            (r) => r.id === fixedResource || r.name.toLowerCase() === fixedResource.toLowerCase()
          )!.id
        : 'any';
    renderResources();
    renderQuestions();
    submit.textContent = s.mode === 'request' ? 'Skicka förfrågan' : 'Boka';
    await reload();
  }

  async function reload() {
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
        ...(resource !== 'any' ? { resourceId: resource } : {}),
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
        const who =
          resource !== 'any'
            ? ` hos ${nameOf(resource)}`
            : s.resources.length === 1 && service!.resources.length >= 1
              ? ` hos ${nameOf(s.resources[0]!)}`
              : '';
        summary.textContent = `${service!.name}${who}, ${longDate.format(asUtc(day.date))} kl. ${s.time}${service!.price ? ` · ${price(service!.price)}` : ''}`;
        const notes: string[] = [];
        if (service!.mode === 'request')
          notes.push(
            'Det här är en förfrågan: tiden reserveras åt dig och du får besked med mejl.'
          );
        if (service!.cancelHours)
          notes.push(`Avbokning och ombokning senast ${service!.cancelHours} timmar innan.`);
        note.textContent = notes.join(' ');
        note.hidden = notes.length === 0;
        void showTurnstile();
        details.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      });
      add(timeList, button);
    }
  }

  async function showTurnstile() {
    if (!siteKey || widget !== undefined) return;
    turnstile = await loadTurnstile();
    if (!turnstile) return;
    turnstileBox.hidden = false;
    widget = turnstile.render(turnstileBox, {
      sitekey: siteKey,
      language: 'sv',
      callback: (t: string) => (token = t),
      'expired-callback': () => (token = ''),
      'error-callback': () => (token = ''),
    });
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
    const answers: Record<string, string> = {};
    for (const question of service.questions) {
      const v = value(`q:${question.id}`);
      if (v) answers[question.id] = v;
    }
    submit.disabled = true;
    say('Skickar…');
    try {
      const result = await call<BookResult>('book', {
        serviceId: service.id,
        ...(resource !== 'any' ? { resourceId: resource } : {}),
        start: start.start,
        name: value('name'),
        email: value('email'),
        phone: value('phone') || undefined,
        message: value('message') || undefined,
        ...(Object.keys(answers).length ? { answers } : {}),
        website: value('website') || undefined,
        ...(token ? { turnstileToken: token } : {}),
      });
      const who = result.resourceName ? ` hos ${result.resourceName}` : '';
      const when = `${longDate.format(asUtc(date))} kl. ${start.time}`;
      const done = el('div', { class: 'hb-booking-done', role: 'status', tabindex: '-1' });
      const lines: Record<BookResult['status'], [string, string]> = {
        confirmed: [
          'Tack, du är bokad!',
          `Vi har skickat en bekräftelse med kalenderfil till ${value('email')}.`,
        ],
        requested: [
          'Tack för din förfrågan!',
          `Tiden är reserverad åt dig. Du får besked till ${value('email')} när vi har svarat.`,
        ],
        pending: [
          'Nästan klart!',
          `Vi har skickat ett mejl till ${value('email')}. Bekräfta via länken i mejlet inom ` +
            `${result.holdMinutes ?? 30} minuter, annars släpps tiden.`,
        ],
      };
      const [title, text] = lines[result.status];
      add(
        done,
        el('h3', {}, title),
        el('p', {}, text),
        el('p', {}, `${service.name}${who}, ${when}`)
      );
      say('');
      form.replaceWith(done);
      done.focus();
    } catch (error) {
      const e = error as Error & { code?: string };
      say(e.message, 'error');
      if (turnstile && widget !== undefined) {
        token = '';
        turnstile.reset(widget);
      }
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
      const result = await call<{ items: Service[]; turnstileSiteKey?: string }>('services', {});
      siteKey = result.turnstileSiteKey;
      services = result.items;
      const wanted = fixedService.toLowerCase();
      if (fixedService)
        services = services.filter((s) => s.id === fixedService || s.name.toLowerCase() === wanted);
      if (fixedResource) {
        const r = fixedResource.toLowerCase();
        services = services.filter(
          (s) =>
            s.resources.length === 0 ||
            s.resources.some((x) => x.id === fixedResource || x.name.toLowerCase() === r)
        );
      }
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
