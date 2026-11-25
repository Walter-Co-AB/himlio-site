// Form validation messages in the site's language. Forms (the Forms plugin) and booking use the
// browser's own validation, whose messages follow the visitor's browser, not the site: an
// English browser on a Swedish site says "Please fill out this field.". The site plugin adds
// this script to every page: when a field is found invalid (the `invalid` event, which both
// checkValidity() and reportValidity() fire), it sets the message in the site's language with
// setCustomValidity(), and clears it when the visitor changes the field. The Forms plugin shows
// `validationMessage` under the field, so it gets the same text.
//
// On a site that isn't English, the script also translates the Forms plugin's own texts, which
// its client and server write in English: "Submitting...", its error and success messages,
// "Step 1 of 2", and the server's field errors ("Phone must be a valid phone number"). It
// watches the forms (.ec-form) and replaces exactly those texts (formText()).
import { language } from '../booking/strings.js';

export interface ValidationText {
  required: string;
  requiredCheckbox: string;
  requiredChoice: string;
  email: string;
  url: string;
  tooShort: string;
  tooLong: string;
  pattern: string;
  tooLow: string;
  tooHigh: string;
  number: string;
  invalid: string;
  phone: string;
  date: string;
  sending: string;
  failed: string;
  offline: string;
  sent: string;
  step: string;
}

export const VALIDATION_TEXT: Record<'en' | 'sv', ValidationText> = {
  en: {
    required: 'Please fill in this field.',
    requiredCheckbox: 'Please tick this box.',
    requiredChoice: 'Please choose an option.',
    email: 'Please enter a valid email address.',
    url: 'Please enter a valid web address.',
    tooShort: 'Please use at least {n} characters.',
    tooLong: 'Please use at most {n} characters.',
    pattern: 'Please use the format asked for.',
    tooLow: 'The value must be {n} or more.',
    tooHigh: 'The value must be {n} or less.',
    number: 'Please enter a number.',
    invalid: 'Please enter a valid value.',
    phone: 'Please enter a valid phone number.',
    date: 'Please enter a valid date.',
    sending: 'Sending…',
    failed: 'Something went wrong. Please try again.',
    offline: 'Could not reach the server. Check your connection and try again.',
    sent: 'Thank you, your message has been sent.',
    step: 'Step {n} of {m}',
  },
  sv: {
    required: 'Fyll i det här fältet.',
    requiredCheckbox: 'Kryssa i den här rutan.',
    requiredChoice: 'Välj ett alternativ.',
    email: 'Ange en giltig e-postadress.',
    url: 'Ange en giltig webbadress.',
    tooShort: 'Använd minst {n} tecken.',
    tooLong: 'Använd högst {n} tecken.',
    pattern: 'Använd formatet som efterfrågas.',
    tooLow: 'Värdet måste vara {n} eller mer.',
    tooHigh: 'Värdet måste vara {n} eller mindre.',
    number: 'Ange ett tal.',
    invalid: 'Ange ett giltigt värde.',
    phone: 'Ange ett giltigt telefonnummer.',
    date: 'Ange ett giltigt datum.',
    sending: 'Skickar…',
    failed: 'Något gick fel. Försök igen.',
    offline: 'Det gick inte att nå servern. Kontrollera anslutningen och försök igen.',
    sent: 'Tack! Ditt meddelande har skickats.',
    step: 'Steg {n} av {m}',
  },
};

export const validationText = (locale: string): ValidationText =>
  VALIDATION_TEXT[language(locale)] ?? VALIDATION_TEXT.en;

/**
 * The message for a field's validity state, or "" when it is valid. `field` is what the
 * browser gives (an input, select or textarea); pure, so tests run it with plain objects.
 */
export function validationMessage(
  field: {
    type?: string;
    validity: Partial<Record<keyof ValidityState, boolean>>;
    minLength?: number;
    maxLength?: number;
    min?: string;
    max?: string;
  },
  t: ValidationText
): string {
  const v = field.validity;
  const type = (field.type ?? '').toLowerCase();
  const n = (text: string, value: unknown) => text.replace('{n}', String(value));
  if (v.valueMissing) {
    if (type === 'checkbox') return t.requiredCheckbox;
    if (type === 'radio' || type.startsWith('select')) return t.requiredChoice;
    return t.required;
  }
  if (v.typeMismatch) return type === 'email' ? t.email : type === 'url' ? t.url : t.invalid;
  if (v.tooShort) return n(t.tooShort, field.minLength);
  if (v.tooLong) return n(t.tooLong, field.maxLength);
  if (v.patternMismatch) return t.pattern;
  if (v.rangeUnderflow) return n(t.tooLow, field.min);
  if (v.rangeOverflow) return n(t.tooHigh, field.max);
  if (v.badInput) return type === 'number' ? t.number : t.invalid;
  if (v.stepMismatch) return t.invalid;
  return '';
}

/**
 * The site-language version of a text the Forms plugin wrote in English, or null for any other
 * text (left as it is). Pure, so tests run it; the page script uses its source.
 */
export function formText(text: string, t: ValidationText): string | null {
  const s = text.trim();
  if (s === 'Submitting...') return t.sending;
  if (s === 'Something went wrong. Please try again.') return t.failed;
  if (s === 'Network error. Please try again.') return t.offline;
  if (s === 'Submitted successfully.') return t.sent;
  if (s === 'Spam verification failed. Please try again.') return t.failed;
  const step = /^Step (\d+) of (\d+)$/.exec(s);
  if (step) return t.step.replace('{n}', step[1]).replace('{m}', step[2]);
  // The server's field errors: "<label> is required", "<label> must be a valid email address", ...
  if (/ is required$/.test(s)) return t.required;
  if (/ must be a valid email address$/.test(s)) return t.email;
  if (/ must be a valid URL$/.test(s)) return t.url;
  if (/ must be a valid phone number$/.test(s)) return t.phone;
  if (/ must be a number$/.test(s)) return t.number;
  if (/ must be a valid date$/.test(s)) return t.date;
  if (/ has an invalid (value|selection)$/.test(s)) return t.invalid;
  return null;
}

/** The inline script for a page: validationMessage() and the site's texts, wired to events. */
// Translates the Forms plugin's texts in .ec-form as they appear (t and formText are in scope).
const FORM_TEXT_SCRIPT = `var formText=${formText.toString()};
var SEL=".ec-form-submit,[data-form-status],[data-ec-progress],[data-error-for]";
function fix(el){if(!el||!el.matches||!el.matches(SEL))return;var to=formText(el.textContent||"",t);if(to!==null&&to!==el.textContent)el.textContent=to;}
function scan(root){if(root.matches&&root.matches(SEL))fix(root);if(root.querySelectorAll)root.querySelectorAll(SEL).forEach(fix);}
function start(){new MutationObserver(function(list){list.forEach(function(m){var n=m.target.nodeType===3?m.target.parentElement:m.target;if(n&&n.closest&&n.closest(".ec-form")){fix(n.closest(SEL)||n);m.addedNodes.forEach(function(a){if(a.nodeType===1)scan(a);});}});}).observe(document.body,{subtree:true,childList:true,characterData:true});document.querySelectorAll(".ec-form").forEach(scan);}
if(document.body)start();else document.addEventListener("DOMContentLoaded",start);`;

export function validationScript(locale: string): string {
  return `(function(){var t=${JSON.stringify(validationText(locale))};var message=${validationMessage.toString()};
function own(el){return el&&el.validity&&typeof el.setCustomValidity==="function";}
document.addEventListener("invalid",function(e){var el=e.target;if(!own(el))return;el.setCustomValidity("");if(el.validity.valid)return;el.setCustomValidity(message(el,t));},true);
function clear(e){var el=e.target;if(!own(el))return;var group=el.type==="radio"&&el.form&&el.name?el.form.querySelectorAll('input[type="radio"]'):[el];for(var i=0;i<group.length;i++)if(group[i]===el||group[i].name===el.name)group[i].setCustomValidity("");}
document.addEventListener("input",clear,true);document.addEventListener("change",clear,true);${
    language(locale) === 'en' ? '' : FORM_TEXT_SCRIPT
  }})();`;
}
