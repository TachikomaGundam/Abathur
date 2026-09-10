// Lineage bundles (todo 12) — public surface: export + inspect with provenance
// and redacted train-only evidence. Members are verified byte-for-byte on
// inspect; nothing inside a bundle implies trust, only self-consistency.

export { exportBundle, type BundleExportRequest, type BundleExportOutcome } from "./bundle-export.js";
export { inspectBundle, type BundleInspectRequest } from "./bundle-inspect.js";
export { bundleManifestSchema, DIGEST_ALGO, BUNDLE_SCHEMA_VERSION, type BundleManifest } from "./bundle-manifest.js";
export { buildMaskPlan, scanMemberLeaks, type MaskPlan, type LeakHit } from "./bundle-mask.js";
export { readTar, writeTar, TarError, type TarMember } from "./bundle-tar.js";
export { benchDigestFor, containedSpec, maskPlanFor, primaryGenId, sha256Hex, treeOf } from "./bundle-common.js";
