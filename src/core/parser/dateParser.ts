const FRENCH_MONTHS: Array<[string, number]> = [
  ['jan', 0],
  ['fev', 1],
  ['fév', 1],
  ['mar', 2],
  ['avr', 3],
  ['apr', 3],
  ['mai', 4],
  ['may', 4],
  ['juin', 5],
  ['jun', 5],
  ['juil', 6],
  ['jul', 6],
  ['ao', 7],
  ['aug', 7],
  ['sep', 8],
  ['oct', 9],
  ['nov', 10],
  ['dec', 11],
  ['déc', 11],
];

const NAMED_DATE_REGEX = /(\d{1,2})\s+([\p{L}.]+)(?:\s+(\d{4}))?/u;
const SLASH_DATE_REGEX = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
const RELATIVE_FR_REGEX =
  /il y a\s+(\d+|un|une)\s+(seconde|minute|heure|jour|semaine|mois|an|année)/i;
const RELATIVE_EN_REGEX = /(\d+|a|an)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;

function resolveMonthIndex(rawMonth: string): number | null {
  const lower = rawMonth.toLowerCase().replace(/\./g, '');
  for (const [prefix, idx] of FRENCH_MONTHS) {
    if (lower.startsWith(prefix)) return idx;
  }
  return null;
}

export function parseFlexibleDate(raw: string | undefined | null, nowTs = Date.now()): number | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text) return undefined;

  const lower = text.toLowerCase();
  if (lower.includes("aujourd'hui") || lower === 'today' || lower === 'just now') {
    return nowTs;
  }
  if (lower === 'hier' || lower === 'yesterday') {
    return nowTs - 86_400_000;
  }

  const frRel = RELATIVE_FR_REGEX.exec(text);
  if (frRel?.[1] && frRel[2]) {
    const qty = frRel[1].toLowerCase().startsWith('un') ? 1 : Number.parseInt(frRel[1], 10);
    const unit = frRel[2].toLowerCase();
    return subtractRelative(nowTs, qty, unit);
  }

  const enRel = RELATIVE_EN_REGEX.exec(text);
  if (enRel?.[1] && enRel[2]) {
    const qty = enRel[1] === 'a' || enRel[1] === 'an' ? 1 : Number.parseInt(enRel[1], 10);
    const unit = enRel[2].toLowerCase();
    return subtractRelative(nowTs, qty, unit);
  }

  const slashMatch = SLASH_DATE_REGEX.exec(text);
  if (slashMatch?.[1] && slashMatch[2] && slashMatch[3]) {
    const day = Number.parseInt(slashMatch[1], 10);
    const month = Number.parseInt(slashMatch[2], 10) - 1;
    let year = Number.parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }

  const namedMatch = NAMED_DATE_REGEX.exec(text);
  if (namedMatch?.[1] && namedMatch[2]) {
    const day = Number.parseInt(namedMatch[1], 10);
    const monthIdx = resolveMonthIndex(namedMatch[2]);
    if (monthIdx !== null) {
      const now = new Date(nowTs);
      const explicitYear = namedMatch[3] ? Number.parseInt(namedMatch[3], 10) : null;
      let year = explicitYear ?? now.getFullYear();
      let candidate = new Date(year, monthIdx, day);
      if (!explicitYear && candidate.getTime() > nowTs + 86_400_000) {
        year -= 1;
        candidate = new Date(year, monthIdx, day);
      }
      if (!Number.isNaN(candidate.getTime())) return candidate.getTime();
    }
  }

  if (/^\d{9,13}$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) {
      return num < 1e12 ? num * 1000 : num;
    }
  }

  const nativeParsed = Date.parse(text);
  if (!Number.isNaN(nativeParsed)) {
    return nativeParsed;
  }

  return undefined;
}

function subtractRelative(nowTs: number, qty: number, unit: string): number {
  const safeQty = Number.isFinite(qty) ? qty : 1;
  if (unit.startsWith('sec')) return nowTs - safeQty * 1000;
  if (unit.startsWith('min')) return nowTs - safeQty * 60_000;
  if (unit.startsWith('heu') || unit.startsWith('hour')) return nowTs - safeQty * 3_600_000;
  if (unit.startsWith('jou') || unit.startsWith('day')) return nowTs - safeQty * 86_400_000;
  if (unit.startsWith('sem') || unit.startsWith('week')) return nowTs - safeQty * 7 * 86_400_000;
  if (unit.startsWith('moi') || unit.startsWith('month')) return nowTs - safeQty * 30 * 86_400_000;
  if (unit.startsWith('an') || unit.startsWith('year')) return nowTs - safeQty * 365 * 86_400_000;
  return nowTs;
}
