const DIGITS = "0123456789";
const GENERATED_CODE_LENGTH = 8;

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) {
    code += DIGITS[byte % DIGITS.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const PROPOSED_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/**
 * Validate a client-supplied pairing code against the existing client format.
 *
 * Client-minted codes remain uppercase A-Z minus I/L/O (visual confusables)
 * and digits 2-9 (minus 0/1), in the `XXXX-XXXX` shape. This intentionally
 * differs from the server-generated `1234-5678` format for compatibility.
 */
export function isValidProposedCode(value: unknown): value is string {
  return typeof value === "string" && PROPOSED_CODE_PATTERN.test(value);
}
