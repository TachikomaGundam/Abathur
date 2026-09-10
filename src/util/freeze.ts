// Mode-bit walkers for read-only commit snapshots (todo 3). freezeTree strips
// write bits recursively (files 0o444/0o555, dirs 0o555); thawTree restores
// writability so rm -rf can collect a frozen tree. Linux cannot lchmod, so
// symlinks are skipped — the enclosing dir's 0o555 already forbids unlink/create.

import { chmod, lstat, readdir } from "node:fs/promises";
import path from "node:path";

async function walk(
  dir: string,
  dirMode: number,
  fileMode: (mode: number) => number,
): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p, dirMode, fileMode);
      await chmod(p, dirMode);
    } else {
      const st = await lstat(p);
      await chmod(p, fileMode(st.mode));
    }
  }
  await chmod(dir, dirMode);
}

/** Strip all write bits under `root` (root itself included). */
export async function freezeTree(root: string): Promise<void> {
  await walk(root, 0o555, (mode) => 0o444 | (mode & 0o111));
}

/** Re-add owner write bits under `root` (root itself included). */
export async function thawTree(root: string): Promise<void> {
  await walk(root, 0o755, (mode) => 0o644 | (mode & 0o111));
}
