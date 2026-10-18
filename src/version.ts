import { readFileSync } from "node:fs";

const packageUrl = new URL("../package.json", import.meta.url);
const artifactUrl = new URL("./version-manifest.json", import.meta.url);

export class PackageVersionError extends Error {
  public constructor(readonly reason: "unreadable" | "invalid" | "mismatch") {
    super(
      reason === "unreadable"
        ? "package version binding cannot be read"
        : reason === "mismatch"
          ? "compiled artifact version does not match package manifest"
          : "package version binding is invalid",
    );
    this.name = "PackageVersionError";
  }
}

function readVersion(read: () => string): string {
  let raw: string;
  try {
    raw = read();
  } catch {
    throw new PackageVersionError("unreadable");
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new PackageVersionError("invalid");
  }
  if (typeof document !== "object" || document === null || !("version" in document)) {
    throw new PackageVersionError("invalid");
  }
  const { version } = document;
  if (typeof version !== "string" || version.length === 0) {
    throw new PackageVersionError("invalid");
  }
  return version;
}

export function runtimeVersion(
  readManifest: () => string = () => readFileSync(packageUrl, "utf8"),
  readArtifact: () => string = () => readFileSync(artifactUrl, "utf8"),
): string {
  const manifestVersion = readVersion(readManifest);
  const artifactVersion = readVersion(readArtifact);
  if (manifestVersion !== artifactVersion) throw new PackageVersionError("mismatch");
  return manifestVersion;
}
