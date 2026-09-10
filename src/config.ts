// Config resolution (todo 1 contract):
//   file:        $ABATHUR_CONFIG (fail-closed if set) > ~/.config/abathur/config.jsonc
//                > <package>/config/abathur.jsonc > built-in defaults
//   overlay:     sibling `<base>.local.jsonc` (gitignored *.local.jsonc) deep-merged
//                over the base before strict validation — machine-local values live there.
// Every failure throws ConfigError, which the CLI boundary maps to exit 2.

import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { parseJsonc } from "./jsonc.js";

// JSONC normalization seam — re-exported so consumers/tests import it from the
// config module (parser implementation lives in src/jsonc.ts).
export { stripJsonc } from "./jsonc.js";

/** Minimal env surface for testability; defaults to process.env at call time. */
export interface ConfigEnv {
  readonly ABATHUR_CONFIG?: string | undefined;
  readonly HOME?: string | undefined;
}

export const configSchema = z.strictObject({
  /** Absolute path to the `opencode` CLI binary; null = resolve from PATH at call time. */
  opencodeBin: z.string().min(1).nullable().default(null),
  /** Data home (ledger, registry, sandboxes); null = $ABATHUR_HOME else ~/.local/share/abathur. */
  stateDir: z.string().min(1).nullable().default(null),
});
export type AbathurConfig = z.infer<typeof configSchema>;

export interface LoadedConfig {
  readonly config: AbathurConfig;
  /** Absolute path of the base file that won the resolution order; null = built-in defaults. */
  readonly path: string | null;
  /** Absolute path of the applied *.local.jsonc overlay, if any. */
  readonly overlayPath: string | null;
}

export type ConfigErrorKind =
  | "unreadable" // file named by $ABATHUR_CONFIG missing / unreadable (fail-closed)
  | "malformed" // JSONC parse error
  | "unknown-key" // strict schema violation naming the key(s)
  | "invalid-value"; // schema leaf violation (wrong type, empty string, ...)

export class ConfigError extends Error {
  constructor(
    readonly kind: ConfigErrorKind,
    message: string,
    readonly filePath: string,
    readonly keys?: readonly string[],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Shipped read-only defaults, co-located with the package (package.json "files"). */
const repoConfigPath = fileURLToPath(new URL("../config/abathur.jsonc", import.meta.url));

function resolveHome(env: ConfigEnv): string {
  return env.HOME === undefined || env.HOME.length === 0 ? os.homedir() : env.HOME;
}

function userConfigPath(env: ConfigEnv): string {
  return path.join(resolveHome(env), ".config", "abathur", "config.jsonc");
}

function readJsoncDocument(filePath: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new ConfigError("unreadable", `config: cannot read ${filePath}`, filePath);
  }
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (cause) {
    throw new ConfigError(
      "malformed",
      `config: malformed JSONC in ${filePath}: ${errorMessage(cause)}`,
      filePath,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new ConfigError(
      "malformed",
      `config: expected a top-level object in ${filePath}`,
      filePath,
    );
  }
  return parsed;
}

// -------------------------------------------------------------- merge + validate

/** Plain objects merge recursively; arrays and scalars are replaced wholesale (overlay wins). */
export function deepMerge(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

function validateConfig(doc: Record<string, unknown>, origin: string): AbathurConfig {
  const result = configSchema.safeParse(doc);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      const listed = issue.keys.map((key) => `"${key}"`).join(", ");
      throw new ConfigError(
        "unknown-key",
        `config: unknown ${issue.keys.length === 1 ? "key" : "keys"} ${listed} in ${origin} — ` +
          `allowed: ${Object.keys(configSchema.shape).join(", ")}`,
        origin,
        issue.keys,
      );
    }
  }
  const [first] = result.error.issues;
  const where =
    first === undefined || first.path.length === 0 ? "<root>" : first.path.join(".");
  const why = first === undefined ? "schema rejected the document" : first.message;
  throw new ConfigError(
    "invalid-value",
    `config: invalid value for "${where}" in ${origin}: ${why}`,
    origin,
  );
}

// ------------------------------------------------------------------ resolution

/**
 * First existing file in: $ABATHUR_CONFIG (fail-closed when set) >
 * ~/.config/abathur/config.jsonc > <package>/config/abathur.jsonc; null = built-in defaults.
 */
export function resolveConfigPath(env: ConfigEnv = process.env): string | null {
  const raw = env.ABATHUR_CONFIG;
  if (raw !== undefined) {
    if (raw.length === 0) {
      throw new ConfigError("unreadable", "config: $ABATHUR_CONFIG is set but empty", raw);
    }
    if (!isReadableFile(raw)) {
      throw new ConfigError(
        "unreadable",
        `config: $ABATHUR_CONFIG points to an unreadable file: ${raw}`,
        raw,
      );
    }
    return raw;
  }
  const user = userConfigPath(env);
  if (isReadableFile(user)) return user;
  if (isReadableFile(repoConfigPath)) return repoConfigPath;
  return null;
}

/**
 * Directory owning the writable config state (genome registry, todo 4+):
 * parent of $ABATHUR_CONFIG when set, else the canonical ~/.config/abathur —
 * which may not exist yet; callers mkdir -p on write. The shipped repo default
 * under <package>/config/ is read-only and never used as a data dir.
 */
export function resolveConfigDir(env: ConfigEnv = process.env): string {
  const raw = env.ABATHUR_CONFIG;
  if (raw !== undefined && raw.length > 0) return path.dirname(path.resolve(raw));
  return path.join(resolveHome(env), ".config", "abathur");
}

function overlayPathFor(basePath: string): string {
  return basePath.endsWith(".jsonc")
    ? `${basePath.slice(0, -".jsonc".length)}.local.jsonc`
    : `${basePath}.local.jsonc`;
}

/** Read base + `*.local.jsonc` overlay, deep-merge, JSONC-parse, zod-strict-validate. Throws ConfigError (→ exit 2). */
export function loadConfig(env: ConfigEnv = process.env): LoadedConfig {
  const filePath = resolveConfigPath(env);
  if (filePath === null) {
    return {
      config: validateConfig({}, "<abathur built-in defaults>"),
      path: null,
      overlayPath: null,
    };
  }
  const base = readJsoncDocument(filePath);
  const overlay = overlayPathFor(filePath);
  if (!isReadableFile(overlay)) {
    return { config: validateConfig(base, filePath), path: filePath, overlayPath: null };
  }
  const merged = deepMerge(base, readJsoncDocument(overlay));
  const origin = `${filePath} (plus overlay ${overlay})`;
  return { config: validateConfig(merged, origin), path: filePath, overlayPath: overlay };
}
