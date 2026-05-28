const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let raw = "";
  for (let i = 0; i < length; i++) {
    raw += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

const PROPOSED_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/**
 * Validate a client-supplied pairing code against the server alphabet.
 *
 * Accepts the same character set `generateCode` emits — uppercase A-Z
 * minus I/L/O (visual confusables) and digits 2-9 (minus 0/1) — in the
 * `XXXX-XXXX` shape. Centralizing the regex here keeps mint and accept
 * paths in lock-step.
 */
export function isValidProposedCode(value: unknown): value is string {
  return typeof value === "string" && PROPOSED_CODE_PATTERN.test(value);
}
