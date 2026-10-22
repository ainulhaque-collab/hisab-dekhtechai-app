/**
 * Money and BDT Paisa Mathematics Engine
 * All amounts are strictly integer minor units (paisa/poisha): 1 BDT = 100 paisa.
 * Floating-point arithmetic for currency is strictly prohibited.
 */

export type Paisa = bigint;

export const PAISA_FACTOR = 100n;

/**
 * Converts an integer minor units string (e.g. "2500000") directly to Paisa (bigint).
 */
export function paisaFromString(minorStr: string | number | bigint): Paisa {
  if (typeof minorStr === 'bigint') return minorStr;
  if (typeof minorStr === 'number') return BigInt(Math.round(minorStr));
  const clean = minorStr.trim();
  if (!clean) return 0n;
  return BigInt(clean);
}

/**
 * Parses user input decimal string (e.g., "1250.50" or "৳ ১২৫০.৫০" or Bengali digits "১২৫০.৫০")
 * into Paisa minor units.
 */
export function parsePaisaString(raw: string): Paisa {
  if (!raw || typeof raw !== 'string') return 0n;
  
  // Convert Bengali numerals to Western ASCII digits
  const western = fromBengaliDigits(raw.trim().replace(/[৳,\s]/g, ''));
  if (western === '' || western === '.') return 0n;

  // Validate format: optional leading minus, digits, optional decimal point and 1-2 digits
  const match = western.match(/^(-)?(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new Error(`Invalid currency format: "${raw}"`);
  }

  const isNegative = match[1] === '-';
  const whole = BigInt(match[2]);
  const fractionStr = (match[3] || '').padEnd(2, '0');
  const fraction = BigInt(fractionStr);

  const total = whole * PAISA_FACTOR + fraction;
  return isNegative ? -total : total;
}

/**
 * Universal toPaisa: handles BigInt, number (minor or decimal), or string.
 */
export function toPaisa(amount: number | string | bigint): Paisa {
  if (typeof amount === 'bigint') {
    return amount;
  }
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || Number.isNaN(amount)) {
      throw new Error('Invalid number for money: NaN or infinite');
    }
    return BigInt(Math.round(amount));
  }
  if (typeof amount === 'string') {
    // If it's already an integer minor string without dot:
    if (/^-?\d+$/.test(amount.trim())) {
      return BigInt(amount.trim());
    }
    return parsePaisaString(amount);
  }
  throw new Error(`Unsupported money value type: ${typeof amount}`);
}

/**
 * Formats Paisa into standard decimal string "1250.50"
 */
export function paisaToDecimalString(paisa: Paisa | number | string): string {
  const bigPaisa = typeof paisa === 'bigint' ? paisa : typeof paisa === 'number' ? BigInt(Math.round(paisa)) : BigInt(paisa.trim() || '0');
  const isNegative = bigPaisa < 0n;
  const abs = isNegative ? -bigPaisa : bigPaisa;
  const whole = abs / PAISA_FACTOR;
  const fraction = abs % PAISA_FACTOR;
  const fracStr = fraction.toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${whole.toString()}.${fracStr}`;
}

/**
 * Formats Paisa into localized display with currency symbol (৳)
 */
export function formatBDT(
  paisa: Paisa | number | string,
  options: {
    locale?: 'bn' | 'en';
    showDecimals?: boolean;
    showSign?: boolean;
  } = {}
): string {
  const { locale = 'bn', showDecimals = true, showSign = false } = options;
  const bigPaisa = typeof paisa === 'bigint' ? paisa : typeof paisa === 'number' ? BigInt(Math.round(paisa)) : BigInt(paisa.trim() || '0');
  const isNegative = bigPaisa < 0n;
  const abs = isNegative ? -bigPaisa : bigPaisa;
  const whole = abs / PAISA_FACTOR;
  const fraction = abs % PAISA_FACTOR;

  // Indian / South Asian numbering grouping: 12,34,567.89
  const wholeStr = formatSouthAsianNumber(whole.toString());
  
  let formattedNumber = wholeStr;
  if (showDecimals || fraction > 0n) {
    formattedNumber += '.' + fraction.toString().padStart(2, '0');
  }

  if (locale === 'bn') {
    formattedNumber = toBengaliDigits(formattedNumber);
  }

  const sign = isNegative ? '-' : showSign && bigPaisa > 0n ? '+' : '';
  return `${sign}৳${formattedNumber}`;
}

function formatSouthAsianNumber(valStr: string): string {
  if (valStr.length <= 3) return valStr;
  const lastThree = valStr.substring(valStr.length - 3);
  const otherNumbers = valStr.substring(0, valStr.length - 3);
  const formattedOthers = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${formattedOthers},${lastThree}`;
}

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBengaliDigits(input: string | number): string {
  const str = input.toString();
  return str.replace(/[0-9]/g, (digit) => BENGALI_DIGITS[parseInt(digit, 10)]);
}

export function fromBengaliDigits(input: string): string {
  return input.replace(/[০-৯]/g, (ch) => {
    const idx = BENGALI_DIGITS.indexOf(ch);
    return idx !== -1 ? idx.toString() : ch;
  });
}

export function addPaisa(a: Paisa, b: Paisa): Paisa {
  return a + b;
}

export function subPaisa(a: Paisa, b: Paisa): Paisa {
  return a - b;
}

/**
 * Normalizes user input in amount field:
 * - Automatically converts Bengali numerals (০-৯) to English digits (0-9)
 * - Removes any letters, special symbols, or spaces
 * - Allows only numeric digits and at most one decimal point
 * - Limits decimal places to at most 2 digits
 */
export function normalizeNumericAmountInput(input: string): string {
  if (!input) return '';
  const ascii = fromBengaliDigits(input);

  let result = '';
  let hasDecimal = false;
  let decimalCount = 0;

  for (const ch of ascii) {
    if (ch >= '0' && ch <= '9') {
      if (hasDecimal) {
        if (decimalCount < 2) {
          result += ch;
          decimalCount++;
        }
      } else {
        result += ch;
      }
    } else if ((ch === '.' || ch === ',') && !hasDecimal) {
      result += '.';
      hasDecimal = true;
    }
  }

  return result;
}

/**
 * Parses dual-language titles formatted like "Cash in Hand (নগদ টাকা)" or "ব্যক্তিগত (Personal)"
 * and returns the appropriate language name according to user preference.
 */
export function formatAccountTitle(name: string, locale: 'en' | 'bn' = 'en'): string {
  if (!name) return '';
  const match = name.match(/^(.*?)\s*\((.*?)\)$/);
  if (match) {
    const part1 = match[1].trim();
    const part2 = match[2].trim();
    const part1HasBengali = /[\u0980-\u09FF]/.test(part1);
    const part2HasBengali = /[\u0980-\u09FF]/.test(part2);

    if (locale === 'bn') {
      if (part1HasBengali) return part1;
      if (part2HasBengali) return part2;
    } else {
      if (!part1HasBengali) return part1;
      if (!part2HasBengali) return part2;
    }
  }
  return name;
}
