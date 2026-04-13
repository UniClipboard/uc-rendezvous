const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let raw = "";
  for (let i = 0; i < length; i++) {
    raw += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
