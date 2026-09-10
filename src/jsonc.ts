// Minimal dependency-free JSONC reader: // and /* */ comments plus trailing
// commas outside string literals. Kept separate from config so the parser can
// be unit-tested in isolation (config tests pin it through this seam).

/** Index just past the closing quote of the string literal starting at `start`. */
function findStringEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2; // escaped char (incl. escaped quote) — skip both
      continue;
    }
    if (source[i] === '"') return i + 1;
    i += 1;
  }
  return source.length; // unterminated — JSON.parse will report it
}

function dropComments(source: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"') {
      const end = findStringEnd(source, cursor);
      out += source.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (source.startsWith("//", cursor)) {
      const newline = source.indexOf("\n", cursor);
      cursor = newline === -1 ? source.length : newline; // keep the newline itself
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close === -1 ? source.length : close + 2;
      continue;
    }
    out += char;
    cursor += 1;
  }
  return out;
}

function dropTrailingCommas(source: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"') {
      const end = findStringEnd(source, cursor);
      out += source.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (char === ",") {
      let probe = cursor + 1;
      while (probe < source.length && /\s/.test(source[probe] ?? "")) probe += 1;
      const next = source[probe];
      if (next === "}" || next === "]") {
        cursor += 1; // drop the comma
        continue;
      }
    }
    out += char;
    cursor += 1;
  }
  return out;
}

/** Normalize JSONC to strict JSON text (comments + trailing commas removed). */
export function stripJsonc(source: string): string {
  return dropTrailingCommas(dropComments(source));
}

/** Parse JSONC text; throws SyntaxError on malformed input (caller rewraps). */
export function parseJsonc(source: string): unknown {
  return JSON.parse(stripJsonc(source));
}
