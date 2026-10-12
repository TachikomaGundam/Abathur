// Dependency-free glob matcher + working-tree walker for the kernel seal (todo 4).
// minimatch would be a new runtime dep, which the plan forbids; this covers the
// documented subset the registry needs:
//   **   zero or more whole path segments (must occupy a full segment)
//   *    zero or more chars WITHIN one segment (never '/')
//   ?    exactly one char within one segment
//   [..] char class; leading '!' or '^' negates; a-z ranges supported
// Anything else is literal (regex metachars escaped, '.' included). Patterns match
// repo-root-relative POSIX-style paths, anchored as a full match. The `.git`
// directory and symlinks are never walked: seals cover working-tree FILE content.

import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

function escapeLiteral(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function segmentToRegExpSource(segment: string): string {
  let out = "";
  let i = 0;
  while (i < segment.length) {
    const char = segment[i] as string;
    if (char === "*") {
      out += "[^/]*";
      i += 1;
    } else if (char === "?") {
      out += "[^/]";
      i += 1;
    } else if (char === "[") {
      const close = segment.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\["; // unterminated class: literal bracket
        i += 1;
        continue;
      }
      let body = segment.slice(i + 1, close);
      const negated = body.startsWith("!") || body.startsWith("^");
      if (negated) body = body.slice(1);
      const safe = body.replace(/[\\\]^]/g, (m) => `\\${m}`);
      out += negated ? `[^/${safe}]` : `[${safe}]`;
      i = close + 1;
    } else {
      out += escapeLiteral(char);
      i += 1;
    }
  }
  return out;
}

export function compileGlob(glob: string): RegExp {
  const segments = glob.split("/");
  let source = "^";
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as string;
    const isLast = i === segments.length - 1;
    if (segment === "**") {
      if (segments.length === 1) source += ".*"; // bare ** matches every path
      else if (i === 0) source += "(?:[^/]+/)*"; // **/x ⇒ x, a/x, a/b/x
      else if (isLast) source += "/.*"; // x/** ⇒ everything strictly under x/
      else source += "/(?:[^/]+/)*"; // x/**/y ⇒ x/y, x/a/y, x/a/b/y
      continue; // each ** branch already consumed its leading separator
    }
    if (i > 0 && segments[i - 1] !== "**") source += "/";
    source += segmentToRegExpSource(segment);
  }
  return new RegExp(`${source}$`);
}

function walk(absDir: string, rel: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(absDir).sort();
  } catch {
    return; // unreadable subdirectory: nothing sealable there
  }
  for (const name of names) {
    if (name === ".git") continue; // VCS metadata is never genome content
    const abs = path.join(absDir, name);
    const relPath = rel.length === 0 ? name : `${rel}/${name}`;
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) continue; // never follow links out of the tree
    if (stat.isDirectory()) walk(abs, relPath, out);
    else if (stat.isFile()) out.push(relPath);
  }
}

/** Every regular file under `root` (excluding .git and symlinks), sorted POSIX paths. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, "", out);
  return out;
}

/** Files matching at least one glob, in listFiles() (sorted) order. */
export function filesMatching(root: string, globs: readonly string[]): string[] {
  const matchers = globs.map(compileGlob);
  return listFiles(root).filter((file) => matchers.some((re) => re.test(file)));
}
