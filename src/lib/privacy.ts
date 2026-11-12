/** Strip WoW references, phone numbers, secrets, and account numbers from text. */

const WOW = /World of Warcraft|\bWoW(?:\s+Forever)?\b/gi;
const PHONE =
  /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/g;
const SECRET =
  /\b(?:api[_-]?key|secret|token|password|bearer|webhook)\s*[:=]\s*\S+/gi;
const CARD = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const ACCOUNT_LABEL =
  /\b(?:account|acct|iban|routing)(?:\s*(?:number|no\.?|#))?\s*[:=#-]?\s*[A-Z0-9-]{6,}\b/gi;

export function stripPrivate(value: string): string {
  let text = value;
  text = text.replace(WOW, "");
  text = text.replace(PHONE, "");
  text = text.replace(SECRET, "");
  text = text.replace(CARD, "");
  text = text.replace(IBAN, "");
  text = text.replace(ACCOUNT_LABEL, "");
  // Clean leftover " /Inbox" or leading slashes after WoW removal.
  text = text.replace(/\s*\/\s*/g, " / ");
  text = text.replace(/^\s*\/\s*/, "");
  text = text.replace(/\s{2,}/g, " ");
  text = text.replace(/\s+([,;:.])/g, "$1");
  return text.trim();
}

export function stripPrivateValue(value: unknown): unknown {
  if (typeof value === "string") return stripPrivate(value);
  if (Array.isArray(value)) return value.map(stripPrivateValue);
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = stripPrivateValue(entry);
    }
    return next;
  }
  return value;
}

export function containsForbidden(value: string): boolean {
  return (
    /World of Warcraft|\bWoW\b/i.test(value) ||
    /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/.test(value) ||
    /\b(?:api[_-]?key|secret|token|password|bearer|webhook)\s*[:=]\s*\S+/i.test(
      value,
    ) ||
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/.test(value)
  );
}
