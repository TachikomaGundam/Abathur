// Lineage bundles (todo 12) — public surface: export + inspect with provenance
// and redacted train-only evidence. Members are verified byte-for-byte on
// inspect; nothing inside a bundle implies trust, only self-consistency.

export { benchDigestFor, containedSpec, maskPlanFor, primaryGenId, sha256Hex, treeOf } from "./bundle-common.js";
export { type BundleExportOutcome, type BundleExportRequest, exportBundle } from "./bundle-export.js";
export { type BundleInspectRequest, inspectBundle } from "./bundle-inspect.js";
export { BUNDLE_SCHEMA_VERSION, type BundleManifest, bundleManifestSchema, DIGEST_ALGO } from "./bundle-manifest.js";
export { buildMaskPlan, type LeakHit, type MaskPlan, scanMemberLeaks } from "./bundle-mask.js";
export { readTar, TarError, type TarMember, writeTar } from "./bundle-tar.js";
