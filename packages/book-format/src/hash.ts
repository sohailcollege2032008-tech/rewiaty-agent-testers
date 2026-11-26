/**
 * Pure TypeScript deterministic hash (two-lane 32-bit FNV-1a -> 16 hex chars).
 * Zero Node or DOM dependencies.
 */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}

/**
 * Same two-lane FNV-1a over raw bytes, for content that never becomes a string (image assets).
 * Kept byte-oriented so the archive identity changes when only a picture changes.
 */
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    h1 ^= byte;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= byte ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}
