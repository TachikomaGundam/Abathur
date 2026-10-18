import { z } from "zod";

export const RELEASE_SOURCES = Object.freeze([
  "runtime",
  "registry",
  "remote-tag",
  "remote-main",
  "local-head",
] as const);

const observationSchema = z.discriminatedUnion("kind", [
  z.object({
    source: z.enum(RELEASE_SOURCES),
    kind: z.literal("observed"),
    version: z.string().min(1),
    released: z.boolean(),
  }).strict(),
  z.object({
    source: z.enum(RELEASE_SOURCES),
    kind: z.literal("unavailable"),
    reason: z.string().min(1),
  }).strict(),
]);

export type ReleaseSource = (typeof RELEASE_SOURCES)[number];
export type ReleaseObservation = z.infer<typeof observationSchema>;
export type ReleaseIdentityStatus = "aligned" | "diverged" | "incomplete" | "unreleased";

export type ReleaseIdentity = {
  readonly basis: "supplied-observations";
  readonly status: ReleaseIdentityStatus;
  readonly versions: Readonly<Record<ReleaseSource, string | null>>;
  readonly missing: readonly ReleaseSource[];
  readonly unavailable: readonly ReleaseSource[];
  readonly unreleased: readonly ReleaseSource[];
};

export class ReleaseIdentityError extends Error {
  public constructor(readonly source: ReleaseSource) {
    super(`duplicate release observation: ${source}`);
    this.name = "ReleaseIdentityError";
  }
}

export class ReleaseIdentityInputError extends Error {
  public constructor() {
    super("invalid release observation");
    this.name = "ReleaseIdentityInputError";
  }
}

function freezeSources(sources: readonly ReleaseSource[]): readonly ReleaseSource[] {
  return Object.freeze([...sources]);
}

export function assessReleaseIdentity(input: readonly unknown[]): ReleaseIdentity {
  const observations = input.map((item) => {
    try {
      return observationSchema.parse(item);
    } catch {
      throw new ReleaseIdentityInputError();
    }
  });
  const bySource = new Map<ReleaseSource, ReleaseObservation>();
  for (const observation of observations) {
    if (bySource.has(observation.source)) {
      throw new ReleaseIdentityError(observation.source);
    }
    bySource.set(observation.source, observation);
  }

  const versionFor = (source: ReleaseSource): string | null => {
    const observation = bySource.get(source);
    return observation?.kind === "observed" ? observation.version : null;
  };
  const versions = Object.freeze({
    runtime: versionFor("runtime"),
    registry: versionFor("registry"),
    "remote-tag": versionFor("remote-tag"),
    "remote-main": versionFor("remote-main"),
    "local-head": versionFor("local-head"),
  });
  const missing = RELEASE_SOURCES.filter((source) => !bySource.has(source));
  const unavailable = RELEASE_SOURCES.filter((source) => bySource.get(source)?.kind === "unavailable");
  const unreleased = RELEASE_SOURCES.filter((source) => {
    const observation = bySource.get(source);
    return observation?.kind === "observed" && observation.released === false;
  });
  const releasedVersions = new Set(RELEASE_SOURCES.flatMap((source) => {
    const observation = bySource.get(source);
    return observation?.kind === "observed" && observation.released ? [observation.version] : [];
  }));
  const status: ReleaseIdentityStatus = missing.length > 0 || unavailable.length > 0
    ? "incomplete"
    : releasedVersions.size > 1
      ? "diverged"
      : unreleased.length > 0
        ? "unreleased"
        : "aligned";

  return Object.freeze({
    basis: "supplied-observations" as const,
    status,
    versions,
    missing: freezeSources(missing),
    unavailable: freezeSources(unavailable),
    unreleased: freezeSources(unreleased),
  });
}
