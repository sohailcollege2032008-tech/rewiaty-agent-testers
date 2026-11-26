/**
 * Decode a text entry from an archive into a JS string.
 *
 * `fflate`'s `strFromU8` assumes UTF-8, which is right for most EPUBs but silently mangles an
 * Arabic book saved as Windows-1256 (still common in older Egyptian publishing toolchains) or one
 * with a UTF-16 BOM. The declared encoding is read from the XML declaration / `<meta charset>`
 * before falling back to UTF-8, and no external decoder (Hermes ships none) is required.
 */
import { strFromU8 } from 'fflate';

// Windows-1256 (the Arabic Windows code page). Generated from the Unicode consortium mapping;
// a `\ufffd` entry means the byte is undefined in that code page.
const CP1256_HEX = `
0000 0001 0002 0003 0004 0005 0006 0007 0008 0009 000a 000b 000c 000d 000e 000f
0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 001a 001b 001c 001d 001e 001f
0020 0021 0022 0023 0024 0025 0026 0027 0028 0029 002a 002b 002c 002d 002e 002f
0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 003a 003b 003c 003d 003e 003f
0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 004a 004b 004c 004d 004e 004f
0050 0051 0052 0053 0054 0055 0056 0057 0058 0059 005a 005b 005c 005d 005e 005f
0060 0061 0062 0063 0064 0065 0066 0067 0068 0069 006a 006b 006c 006d 006e 006f
0070 0071 0072 0073 0074 0075 0076 0077 0078 0079 007a 007b 007c 007d 007e 007f
20ac 067e 201a 0192 201e 2026 2020 2021 02c6 2030 0679 2039 0152 0686 0698 0688
06af 2018 2019 201c 201d 2022 2013 2014 06a9 2122 0691 203a 0153 200c 200d 06ba
00a0 060c 00a2 00a3 00a4 00a5 00a6 00a7 00a8 00a9 06be 00ab 00ac 00ad 00ae 00af
00b0 00b1 00b2 00b3 00b4 00b5 00b6 00b7 00b8 00b9 061b 00bb 00bc 00bd 00be 061f
06c1 0621 0622 0623 0624 0625 0626 0627 0628 0629 062a 062b 062c 062d 062e 062f
0630 0631 0632 0633 0634 0635 0636 00d7 0637 0638 0639 063a 0640 0641 0642 0643
00e0 0644 00e2 0645 0646 0647 0648 00e7 00e8 00e9 00ea 00eb 0649 064a 00ee 00ef
064b 064c 064d 064e 00f4 064f 0650 00f7 0651 00f9 0652 00fb 00fc 200e 200f 06d2
`;

const CP1256_CODES = CP1256_HEX.trim()
  .split(/\s+/)
  .map((hex) => Number.parseInt(hex, 16));

function decodeCp1256(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    const end = Math.min(bytes.length, i + 4096);
    let chunk = '';
    for (let j = i; j < end; j += 1) {
      chunk += String.fromCodePoint(CP1256_CODES[bytes[j]!] ?? 0xfffd);
    }
    out += chunk;
  }
  return out;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? bytes[i]! | (bytes[i + 1]! << 8)
      : (bytes[i]! << 8) | bytes[i + 1]!;
    out += String.fromCharCode(code);
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

function declaredEncoding(bytes: Uint8Array): string | null {
  const head = latin1(bytes.subarray(0, 1024));
  const xml = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (xml?.[1]) return xml[1].trim().toLowerCase();
  const meta = /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._-]+)/i.exec(head);
  if (meta?.[1]) return meta[1].toLowerCase();
  return null;
}

export function decodeTextBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return strFromU8(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16(bytes.subarray(2), true);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16(bytes.subarray(2), false);
  }

  const encoding = declaredEncoding(bytes);
  if (encoding) {
    const normalized = encoding.replace(/[^a-z0-9]/g, '');
    if (normalized === 'windows1256' || normalized === 'cp1256' || normalized === 'xcp1256') {
      return decodeCp1256(bytes);
    }
    if (
      normalized === 'iso88591' ||
      normalized === 'latin1' ||
      normalized === 'windows1252' ||
      normalized === 'cp1252'
    ) {
      return latin1(bytes);
    }
    // `us-ascii`, `utf-8`, `utf8` and anything unrecognised all decode as UTF-8: Arabic bytes are
    // multi-byte there, so a wrong-but-valid label cannot corrupt an already-UTF-8 chapter.
  }
  return strFromU8(bytes);
}
