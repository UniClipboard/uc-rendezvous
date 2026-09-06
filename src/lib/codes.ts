const DIGITS = "0123456789";

export function generateCode(length: 6 | 8 = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) {
    code += DIGITS[byte % DIGITS.length];
  }
  const midpoint = length / 2;
  return `${code.slice(0, midpoint)}-${code.slice(midpoint)}`;
}

const PROPOSED_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const SIX_DIGIT_CODE_PATTERN = /^[0-9]{3}-[0-9]{3}$/;

/**
 * Accept six numeric digits in XXX-XXX shape alongside the legacy
 * XXXX-XXXX alphabet (uppercase letters minus I/L/O and digits 2-9).
 */
export function isValidProposedCode(value: unknown): value is string {
  return typeof value === "string" && (
    PROPOSED_CODE_PATTERN.test(value) ||
    (value.length === 7 && SIX_DIGIT_CODE_PATTERN.test(value))
  );
}
