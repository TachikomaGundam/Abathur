// Pure-node tar (USTAR + PAX 'path' override) for lineage bundles (todo 12).
// Deterministic output (mtime 0, uid/gid 0, fixed mode, sorted-in-callers paths)
// so a re-export of the same ledger state is byte-identical; the reader is the
// adversarial boundary — it never materialises anything, validates every header
// checksum, and refuses absolute / traversal / odd-type member names.

const BLOCK = 512;
const NAME_MAX = 99;
const PREFIX_MAX = 154;
export const TAR_TOTAL_CAP_BYTES = 64 * 1024 * 1024;

export interface TarMember {
  readonly path: string;
  readonly content: Uint8Array;
}

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarError";
  }
}

function ascii(s: string, len: number): Uint8Array {
  if (s.length > len) throw new TarError(`tar field overflow: "${s}" > ${String(len)} bytes`);
  const b = new Uint8Array(len);
  for (let i = 0; i < s.length; i += 1) b[i] = s.charCodeAt(i);
  return b;
}

function octal(value: number, len: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new TarError(`tar octal: bad value ${String(value)}`);
  const digits = (value >>> 0).toString(8).padStart(len - 1, "0");
  if (digits.length > len - 1) throw new TarError(`tar octal overflow: ${String(value)}`);
  return ascii(`${digits}\0`, len);
}

function assertSafePath(p: string): void {
  if (p.length === 0) throw new TarError("tar: empty member path");
  if (p.startsWith("/") || p.includes("\\")) throw new TarError(`tar: unsafe member path ${p}`);
  for (const seg of p.split("/")) {
    if (seg === ".." || seg === "") throw new TarError(`tar: traversal/unsafe member path ${p}`);
  }
}

function zeroBlock(): Uint8Array {
  return new Uint8Array(BLOCK);
}

function headerBlock(fields: {
  readonly name: string;
  readonly prefix: string;
  readonly size: number;
  readonly typeflag: string;
}): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const parts: readonly (readonly [Uint8Array, number])[] = [
    [ascii(fields.name, 100), 0],
    [octal(0o644, 8), 100],
    [octal(0, 8), 108],
    [octal(0, 8), 116],
    [octal(fields.size, 12), 124],
    [octal(0, 12), 136],
    [new Uint8Array(8).fill(0x20), 148],
    [ascii(fields.typeflag, 1), 156],
    [new Uint8Array(100), 157],
    [ascii("ustar\0", 6), 257],
    [ascii("00", 2), 263],
    [new Uint8Array(32), 265],
    [new Uint8Array(32), 297],
    [octal(0, 8), 329],
    [octal(0, 8), 337],
    [ascii(fields.prefix, PREFIX_MAX + 1), 345],
  ];
  for (const [bytes, offset] of parts) h.set(bytes, offset);
  let sum = 0;
  for (const byte of h) sum += byte;
  h.set(ascii(`${(sum & 0o777777).toString(8).padStart(6, "0")}\0 `, 8), 148);
  return h;
}

function splitLongPath(p: string): { name: string; prefix: string } | null {
  if (p.length <= NAME_MAX) return { name: p, prefix: "" };
  let cut = -1;
  for (let i = p.length - 1; i >= 0; i -= 1) {
    if (p[i] === "/" && p.slice(0, i).length <= PREFIX_MAX && p.slice(i + 1).length <= NAME_MAX) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return null;
  return { name: p.slice(cut + 1), prefix: p.slice(0, cut) };
}

function paxPathHeader(p: string): Uint8Array {
  // PAX len counts BYTES of "<len> path=<p>\n" — for non-ASCII names the UTF-8
  // byte length exceeds the string length, so the fixed point is byte-based.
  const enc = new TextEncoder();
  const body = `path=${p}\n`;
  let len = enc.encode(body).length + 5;
  for (;;) {
    const record = `${String(len)} ${body}`;
    const bytes = enc.encode(record);
    if (bytes.length === len) {
      const name = `././PaxHeaders.${p.split("/").pop() ?? "x"}`.slice(0, 99);
      const header = headerBlock({ name, prefix: "", size: bytes.length, typeflag: "x" });
      const data = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
      data.set(bytes);
      return new Uint8Array([...header, ...data]);
    }
    len = bytes.length;
  }
}

function pad(data: Uint8Array): Uint8Array {
  const rem = data.length % BLOCK;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (BLOCK - rem));
  out.set(data);
  return out;
}

/** Serialise members (callers keep them sorted) into deterministic tar bytes. */
export function writeTar(members: readonly TarMember[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const m of members) {
    assertSafePath(m.path);
    if (m.path.length > PREFIX_MAX + 1 + NAME_MAX) throw new TarError(`tar: path too long: ${m.path}`);
    const split = m.path.length <= NAME_MAX ? { name: m.path, prefix: "" } : splitLongPath(m.path);
    // USTAR name/prefix fields are 7-bit (ascii() truncates each char to its low
    // byte), so anything outside printable ASCII travels in a PAX 'path' override.
    if (split === null || !/^[\x20-\x7E]+$/.test(m.path)) {
      chunks.push(paxPathHeader(m.path));
      chunks.push(headerBlock({ name: m.path.slice(0, NAME_MAX), prefix: "", size: m.content.length, typeflag: "0" }));
    } else {
      chunks.push(headerBlock({ name: split.name, prefix: split.prefix, size: m.content.length, typeflag: "0" }));
    }
    const data = pad(m.content);
    chunks.push(data);
  }
  chunks.push(zeroBlock(), zeroBlock());
  return concat(chunks);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function parseOctal(field: Uint8Array): number {
  const s = new TextDecoder().decode(field).replace(/\0| /g, "");
  if (s.length === 0) return 0;
  if (!/^[0-7]+$/.test(s)) throw new TarError(`tar: bad octal field "${s}"`);
  const v = Number.parseInt(s, 8);
  if (!Number.isSafeInteger(v) || v < 0) throw new TarError("tar: octal field out of range");
  return v;
}

function verifyChecksum(block: Uint8Array): void {
  const stored = parseOctal(block.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  }
  if (sum !== stored) throw new TarError("tar: header checksum mismatch (corrupt or truncated archive)");
}

/** Parse tar bytes; throws TarError on any corruption, traversal or odd member type. */
export function readTar(bytes: Uint8Array): TarMember[] {
  const members: TarMember[] = [];
  const seen = new Set<string>();
  let off = 0;
  let pendingPath: string | null = null;
  let totalBytes = 0;
  const dec = new TextDecoder();

  const cstring = (b: Uint8Array): string => dec.decode(b).split("\0")[0] ?? "";

  while (off < bytes.length) {
    if (bytes.length - off < BLOCK) {
      throw new TarError("tar: truncated archive (partial block at end of stream)");
    }
    const block = bytes.subarray(off, off + BLOCK);
    off += BLOCK;
    if (block.every((x) => x === 0)) {
      const rest = bytes.subarray(off);
      if (bytes.length - (off - BLOCK) < 2 * BLOCK || rest.length % BLOCK !== 0 || !rest.every((x) => x === 0)) {
        throw new TarError("tar: truncated archive (incomplete end-of-archive marker)");
      }
      break;
    }
    verifyChecksum(block);
    const magic = cstring(block.subarray(257, 265));
    if (!magic.startsWith("ustar")) throw new TarError("tar: missing ustar magic — not a tar archive");
    const rawName = cstring(block.subarray(0, 100));
    const prefix = cstring(block.subarray(345, 500));
    const size = parseOctal(block.subarray(124, 136));
    const typeflag = String.fromCharCode(block[156] ?? 0x30);
    const name = prefix.length > 0 && pendingPath === null ? `${prefix}/${rawName}` : rawName;

    if (size > TAR_TOTAL_CAP_BYTES || totalBytes + size > TAR_TOTAL_CAP_BYTES) {
      throw new TarError(`tar: member ${name} exceeds size cap`);
    }
    if (bytes.length - off < size) throw new TarError(`tar: truncated archive (member ${name} data missing)`);
    const data = bytes.subarray(off, off + Math.ceil(size / BLOCK) * BLOCK).subarray(0, size);
    off += Math.ceil(size / BLOCK) * BLOCK;

    if (typeflag === "x" || typeflag === "g") {
      pendingPath = extractPaxPath(dec.decode(data)) ?? pendingPath;
      continue;
    }
    if (typeflag === "5") continue;
    if (typeflag !== "0" && typeflag !== "\0") {
      throw new TarError(`tar: refusing member ${name} of type '${typeflag}' (only regular files allowed)`);
    }
    const finalPath = pendingPath ?? name;
    pendingPath = null;
    assertSafePath(finalPath);
    if (seen.has(finalPath)) throw new TarError(`tar: duplicate member path ${finalPath}`);
    seen.add(finalPath);
    totalBytes += size;
    members.push({ path: finalPath, content: new Uint8Array(data) });
  }
  return members;
}

function extractPaxPath(records: string): string | null {
  const enc = new TextEncoder();
  let path: string | null = null;
  for (const record of records.split("\n")) {
    if (record.length === 0) continue;
    const space = record.indexOf(" ");
    const eq = record.indexOf("=", space + 1);
    // the declared len is the record's BYTE length + the split-off "\n"
    if (space > 0 && eq > space && record.slice(0, space) === String(enc.encode(record).length + 1)) {
      if (record.slice(space + 1, eq) === "path") path = record.slice(eq + 1);
    }
  }
  return path;
}
