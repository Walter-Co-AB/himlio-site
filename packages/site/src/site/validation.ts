// Form validation messages in the site's language. Forms (the Forms plugin) and booking use the
// browser's own validation, whose messages follow the visitor's browser, not the site: an
// English browser on a Swedish site says "Please fill out this field.". The site plugin adds
// this script to every page: when a field is found invalid (the `invalid` event, which both
// checkValidity() and reportValidity() fire), it sets the message in the site's language with
// setCustomValidity(), and clears it when the visitor changes the field. The Forms plugin shows
// `validationMessage` under the field, so it gets the same text.
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

/** The inline script for a page: validationMessage() and the site's texts, wired to events. */
export function validationScript(locale: string): string {
  return `(function(){var t=${JSON.stringify(validationText(locale))};var message=${validationMessage.toString()};
function own(el){return el&&el.validity&&typeof el.setCustomValidity==="function";}
document.addEventListener("invalid",function(e){var el=e.target;if(!own(el))return;el.setCustomValidity("");if(el.validity.valid)return;el.setCustomValidity(message(el,t));},true);
function clear(e){var el=e.target;if(!own(el))return;var group=el.type==="radio"&&el.form&&el.name?el.form.querySelectorAll('input[type="radio"]'):[el];for(var i=0;i<group.length;i++)if(group[i]===el||group[i].name===el.name)group[i].setCustomValidity("");}
document.addEventListener("input",clear,true);document.addEventListener("change",clear,true);})();`;
}
