// `abathur opencode` — installer for the official opencode plugin adapter
// (todo: opencode-plugin 1). Pure file management: byte-copies the packaged
// V1 plugin (`<package>/plugin/abathur.ts`) and slash-command template
// (`<package>/plugin/abathur-command.md`) into <HOME>/.config/opencode/
// {plugins,commands}/. No network, no shell, no opencode process contact.
// Identity rule: a target is ours only if its FIRST LINE carries our marker;
// a foreign file at a target path is refused (exit 2), never overwritten,
// never deleted — there is no --force anywhere.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandSpec } from "../cli.js";
import { EXIT_OK, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";

/** Minimal env surface for testability; defaults to process.env at call time (src/config.ts seam style). */
export interface OpencodeEnv {
  readonly HOME?: string | undefined;
}

/** First-line identity markers (the asset files must start with exactly these prefixes). */
export const PLUGIN_MARKER = "// abathur-opencode-plugin v";
export const COMMAND_MARKER = "<!-- abathur-opencode-command -->";

// Packaged assets live at <package>/plugin/ — two levels above dist/commands/
// (same import.meta.url-relative style as the shipped-config path in src/config.ts).
const PLUGIN_TS_ASSET = fileURLToPath(new URL("../../plugin/abathur.ts", import.meta.url));
const COMMAND_MD_ASSET = fileURLToPath(new URL("../../plugin/abathur-command.md", import.meta.url));

export interface AssetTarget {
  /** Human label used in status lines. */
  readonly label: string;
  /** Packaged source file inside the abathur package (read-only). */
  readonly source: string;
  /** Destination inside the user's opencode config dir. */
  readonly destination: string;
  /** Prefix a first line must carry for the file to count as ours. */
  readonly marker: string;
}

/** <HOME>/.config/opencode — HOME env-driven (os.homedir() fallback), never a literal. */
export function resolveOpencodeConfigDir(env: OpencodeEnv = process.env): string {
  const home = env.HOME === undefined || env.HOME.length === 0 ? os.homedir() : env.HOME;
  return path.join(home, ".config", "opencode");
}

export function pluginTargets(env: OpencodeEnv = process.env): AssetTarget[] {
  const dir = resolveOpencodeConfigDir(env);
  return [
    {
      label: "plugin",
      source: PLUGIN_TS_ASSET,
      destination: path.join(dir, "plugins", "abathur.ts"),
      marker: PLUGIN_MARKER,
    },
    {
      label: "command",
      source: COMMAND_MD_ASSET,
      destination: path.join(dir, "commands", "abathur.md"),
      marker: COMMAND_MARKER,
    },
  ];
}

function readPackagedAsset(target: AssetTarget): Buffer {
  try {
    return readFileSync(target.source);
  } catch {
    return cannotAnswer(
      `opencode: packaged ${target.label} asset is missing (${target.source})`,
      "the abathur install looks broken — re-run 'npm i -g @tachikomagundam/abathur'",
    );
  }
}

function readTarget(target: AssetTarget): Buffer | null {
  try {
    return readFileSync(target.destination);
  } catch {
    return null;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function carriesMarker(bytes: Buffer, marker: string): boolean {
  const text = bytes.toString("utf8");
  const newline = text.indexOf("\n");
  const firstLine = newline < 0 ? text : text.slice(0, newline);
  return firstLine.startsWith(marker);
}

type TargetState = "up-to-date" | "outdated" | "foreign" | "absent";

function classify(target: AssetTarget, packaged: Buffer): { state: TargetState; installed: Buffer | null } {
  const current = readTarget(target);
  if (current === null) return { state: "absent", installed: null };
  if (!carriesMarker(current, target.marker)) return { state: "foreign", installed: current };
  return { state: current.equals(packaged) ? "up-to-date" : "outdated", installed: current };
}

function refuseForeign(target: AssetTarget): never {
  return cannotAnswer(
    `opencode: refusing to touch ${target.destination} — the file exists but is not ours ` +
      `(its first line lacks the marker '${target.marker}')`,
    "resolve it manually: move the foreign file aside (or adopt the marker), then re-run 'abathur opencode install'",
  );
}

/** Atomicity rule shared by install/uninstall: validate EVERY target before writing to ANY. */
function requireNoForeign(targets: readonly AssetTarget[]): void {
  for (const target of targets) {
    const current = readTarget(target);
    if (current !== null && !carriesMarker(current, target.marker)) refuseForeign(target);
  }
}

function opencodeInstall(env: OpencodeEnv): ExitCode {
  const targets = pluginTargets(env);
  requireNoForeign(targets);
  for (const target of targets) {
    const packaged = readPackagedAsset(target);
    const { state } = classify(target, packaged);
    if (state === "up-to-date") {
      writeStdout(`${target.destination}: up to date`);
      continue;
    }
    mkdirSync(path.dirname(target.destination), { recursive: true }); // precedent: src/core/genome.ts registry dirs
    writeFileSync(target.destination, packaged);
    writeStdout(`${target.destination}: ${state === "outdated" ? "updated" : "installed"}`);
  }
  writeStdout("note: restart opencode to load the plugin — tools and commands are scanned at startup.");
  writeStdout(
    "note: abathur fixture benches mirror the real ~/.config/opencode (plugins and commands " +
      "included) into sandboxed HOMEs, so this plugin will also load inside bench sessions.",
  );
  return EXIT_OK;
}

function opencodeStatus(env: OpencodeEnv): ExitCode {
  for (const target of pluginTargets(env)) {
    const packaged = readPackagedAsset(target);
    const { state, installed } = classify(target, packaged);
    const installedSha = installed === null ? "-" : sha256(installed);
    writeStdout(
      `${target.destination}: ${state}  installed=${installedSha}  packaged=${sha256(packaged)}`,
    );
  }
  return EXIT_OK;
}

function opencodeUninstall(env: OpencodeEnv): ExitCode {
  const targets = pluginTargets(env);
  requireNoForeign(targets);
  for (const target of targets) {
    if (!existsSync(target.destination)) {
      writeStdout(`${target.destination}: absent (nothing to remove)`);
      continue;
    }
    rmSync(target.destination);
    writeStdout(`${target.destination}: removed`);
  }
  writeStdout("note: restart opencode for the tool and command to disappear.");
  return EXIT_OK;
}

function runOpencode(args: readonly string[]): ExitCode {
  const [sub, ...rest] = args;
  if (rest.length > 0) {
    cannotAnswer(
      `opencode ${sub}: unexpected argument '${rest[0]}'`,
      "usage: abathur opencode install | status | uninstall",
    );
  }
  switch (sub) {
    case "install":
      return opencodeInstall(process.env);
    case "status":
      return opencodeStatus(process.env);
    case "uninstall":
      return opencodeUninstall(process.env);
    default:
      return cannotAnswer(
        `opencode: unknown subcommand '${sub ?? "<none>"}'`,
        "usage: abathur opencode install | status | uninstall",
      );
  }
}

export const opencodeCommand: CommandSpec = {
  name: "opencode",
  summary: "install/status/uninstall the official opencode plugin adapter",
  run: ({ args }) => runOpencode(args),
};
