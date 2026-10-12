// Minimal unified-diff parser + atomic in-memory applier for mutator candidates
// (todo 8, plan lines 133-140). Git style sections: `--- a/f`, `+++ b/f`,
// `@@ -oldStart[,oldCount] +newStart[,newCount] @@` with ' '/'-'/'+' body lines.
//
// v1 candidate ops, DOCUMENTED SCOPE:
//   allowed:  modify existing text file, create new text file (`--- /dev/null`).
//   refused:  delete (`+++ /dev/null`), rename/copy (a/ != b/ or rename lines),
//             binary (`Binary files … differ`, `GIT binary patch`), and
//             `\ No newline at end of file` markers.
// Nothing touches disk here: parseUnifiedDiff + applyChanges are pure, so a
// candidate with ANY violating file is rejected before ANY file is mutated
// (whole-candidate rejection is enforceable, not best-effort).

export interface DiffHunkLine {
  readonly op: " " | "-" | "+";
  readonly text: string;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffHunkLine[];
}

export interface FileChange {
  readonly path: string;
  readonly kind: "modify" | "create";
  readonly hunks: readonly DiffHunk[];
}

export type ParseOutcome =
  | { readonly ok: true; readonly changes: readonly FileChange[] }
  | { readonly ok: false; readonly error: string };

export type ApplyOutcome =
  | { readonly ok: true; readonly files: ReadonlyMap<string, string>; readonly touched: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_GIT_RE = /^diff --git a\/(\S+) b\/(\S+)$/;

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

function isBinaryMarker(line: string): boolean {
  return line.startsWith("Binary files") || line.startsWith("GIT binary patch") || line.startsWith("literal ") || line.startsWith("delta ");
}

/** Skip metadata lines between a `diff --git` header and its `---` line. */
function metadata(line: string): boolean {
  return (
    line.startsWith("index ") ||
    line.startsWith("new file mode") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode") ||
    line.startsWith("similarity index")
  );
}

export function parseUnifiedDiff(text: string): ParseOutcome {
  if (text.includes("\r")) return fail("CRLF line endings are not supported in v1");
  // control bytes outside tab/LF = binary payload smuggled into a text hunk
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return fail("control characters (binary content) are not supported as candidate ops");
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const changes: FileChange[] = [];
  let pendingGit: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.length === 0 || metadata(line)) {
      i += 1;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const m = DIFF_GIT_RE.exec(line);
      if (m === null) return fail(`diff --git header not parsable (spaces in paths unsupported in v1): ${line}`);
      if (m[1] !== m[2]) return fail(`renames are not supported as candidate ops: ${String(m[1])} -> ${String(m[2])}`);
      pendingGit = String(m[1]);
      i += 1;
      continue;
    }
    if (line.startsWith("rename ") || line.startsWith("copy ")) return fail("renames/copies are not supported as candidate ops");
    if (line.startsWith("deleted file mode")) return fail("deletes are not supported as candidate ops");
    if (isBinaryMarker(line)) return fail("binary patches are not supported as candidate ops");
    if (!line.startsWith("--- ")) return fail(`unrecognized diff line: ${line}`);

    const oldRaw = (line.slice(4).split("\t")[0] as string).trim();
    const next = lines[i + 1];
    if (next === undefined || !next.startsWith("+++ ")) return fail(`expected '+++ b/<path>' after '---' at line ${String(i + 1)}`);
    const newRaw = (next.slice(4).split("\t")[0] as string).trim();
    if (newRaw === "/dev/null") return fail("deletes (+++ /dev/null) are not supported as candidate ops");
    if (!newRaw.startsWith("b/")) return fail(`+++ header must name a b/<path>: ${newRaw}`);
    const newPath = newRaw.slice(2);

    let kind: "modify" | "create";
    if (oldRaw === "/dev/null") {
      kind = "create";
    } else {
      if (!oldRaw.startsWith("a/")) return fail(`--- header must name an a/<path> or /dev/null: ${oldRaw}`);
      if (oldRaw.slice(2) !== newPath) return fail(`renames are not supported as candidate ops: ${oldRaw.slice(2)} -> ${newPath}`);
      kind = "modify";
    }
    if (pendingGit !== null && pendingGit !== newPath) {
      return fail(`diff --git header path '${pendingGit}' disagrees with section path '${newPath}'`);
    }
    i += 2;

    const hunks: DiffHunk[] = [];
    while (i < lines.length && !isBinaryMarker(lines[i] as string) && !metadata(lines[i] as string)) {
      const hm = HUNK_RE.exec(lines[i] as string);
      if (hm === null) break; // section ends where a new one begins
      const oldStart = Number(hm[1]);
      const oldCount = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newCount = hm[4] === undefined ? 1 : Number(hm[4]);
      i += 1;
      const body: DiffHunkLine[] = [];
      let oldSeen = 0;
      let newSeen = 0;
      while (i < lines.length) {
        const bl = lines[i] as string;
        if (bl.startsWith("@@") || bl.startsWith("--- ") || bl.startsWith("diff --git ")) break;
        if (isBinaryMarker(bl)) break;
        if (bl.startsWith("\\")) return fail('"No newline at end of file" markers are not supported in v1');
        const op = bl.length === 0 ? " " : bl[0] === " " || bl[0] === "-" || bl[0] === "+" ? bl[0] : null;
        if (op === null) return fail(`unrecognized hunk line: ${bl}`);
        if (op !== "+") oldSeen += 1;
        if (op !== "-") newSeen += 1;
        body.push({ op, text: bl.slice(1) });
        i += 1;
      }
      if (oldSeen !== oldCount || newSeen !== newCount) {
        return fail(`hunk @@ -${oldStart},${oldCount} +${newStart},${newCount} @@ declares ${oldCount}/${newCount} lines, body has ${oldSeen}/${newSeen}`);
      }
      if (oldCount + newCount === 0) return fail(`empty hunk at ${newPath}:${String(oldStart)}`);
      hunks.push({ oldStart, oldCount, newStart, newCount, lines: body });
    }
    if (i < lines.length && isBinaryMarker(lines[i] as string)) return fail("binary patches are not supported as candidate ops");
    if (hunks.length === 0) return fail(`no valid @@ hunk for file section ${newPath}`);
    changes.push({ path: newPath, kind, hunks });
    pendingGit = null;
  }

  if (changes.length === 0) return fail("no file sections found in diff");
  return { ok: true, changes };
}

/**
 * Apply parsed changes fully in memory. `readBase(relPath)` returns the current
 * file text or null when absent. Hunks are POSITIONAL: the drifted worktree case
 * (file shifted or edited around the anchor) refuses with a mismatch reason and
 * the caller — having written nothing yet — discards the whole candidate.
 * Precondition enforced here: paths unique across `changes`.
 */
export function applyChanges(
  changes: readonly FileChange[],
  readBase: (relPath: string) => string | null,
): ApplyOutcome {
  const files = new Map<string, string>();
  const touched: string[] = [];
  for (const change of changes) {
    if (files.has(change.path)) return failApply(`duplicate file section for ${change.path}`);
    const base = readBase(change.path);
    if (change.kind === "create") {
      if (base !== null) return failApply(`create refused: ${change.path} already exists`);
      const added = change.hunks.flatMap((h) => h.lines.filter((l) => l.op !== "-").map((l) => l.text));
      files.set(change.path, `${added.join("\n")}\n`);
      touched.push(change.path);
      continue;
    }
    if (base === null) return failApply(`target file missing in worktree: ${change.path}`);
    const hadFinalNewline = base.endsWith("\n");
    const src = base.split("\n");
    if (hadFinalNewline) src.pop();
    const out = [...src];
    let offset = 0;
    for (const h of change.hunks) {
      const olds = h.lines.filter((l) => l.op !== "+").map((l) => l.text);
      const news = h.lines.filter((l) => l.op !== "-").map((l) => l.text);
      const start = h.oldStart - 1 + offset;
      if (start < 0 || start + olds.length > src.length) {
        return failApply(`hunk at ${change.path}:${String(h.oldStart)} out of range — worktree drifted`);
      }
      for (let j = 0; j < olds.length; j += 1) {
        if (out[start + j] !== olds[j]) {
          return failApply(`hunk context mismatch at ${change.path}:${String(h.oldStart + j)} — worktree drifted, refusing without force`);
        }
      }
      out.splice(start, olds.length, ...news);
      offset += news.length - olds.length;
    }
    files.set(change.path, out.join("\n") + (hadFinalNewline ? "\n" : ""));
    touched.push(change.path);
  }
  return { ok: true, files, touched };
}

function failApply(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
