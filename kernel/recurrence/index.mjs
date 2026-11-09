/**
 * Recurrence ledger. The first occurrence is a normal fix. The second demands a
 * structural fix. The third is a method violation. The counter must not be
 * narrowed to only the occurrences that are easy to test.
 */

/**
 * @param {Map<string, {class:string, attempts:number, sites:string[]}>} ledger
 * @param {{class:string, site:string}} defect
 */
export function register(ledger, defect) {
  const key = String(defect?.class ?? "").trim();
  if (!key) return { action: "REJECT", code: "NO-CLASS", attempts: 0 };
  const row = ledger.get(key) ?? { class: key, attempts: 0, sites: [] };
  row.attempts += 1;
  if (defect.site) row.sites.push(defect.site);
  ledger.set(key, row);
  if (row.attempts === 1) return { action: "FIX", code: "FIRST-OCCURRENCE", attempts: row.attempts };
  if (row.attempts === 2) return { action: "STOP", code: "STRUCTURAL-FIX-REQUIRED", attempts: row.attempts };
  return { action: "STOP", code: "METHOD-VIOLATION", attempts: row.attempts };
}

/** Three-way disposition required; no disposition means the defect is not done. */
export function intake(defect, disposition) {
  const kind = disposition?.kind;
  if (!defect?.class) return { rc: 1, code: "NO-CLASS" };
  if (kind === "existing-class") {
    if (typeof disposition.class !== "string" || !disposition.class) {
      return { rc: 1, code: "NO-CLASS-TARGET" };
    }
    return { rc: 0, code: "INTAKE-EXISTING", target: disposition.class };
  }
  if (kind === "new-class") {
    if (typeof disposition.name !== "string" || !disposition.name) return { rc: 1, code: "NO-CLASS-NAME" };
    return { rc: 0, code: "INTAKE-NEW", target: disposition.name };
  }
  if (kind === "reject") {
    if (typeof disposition.reason !== "string" || disposition.reason.trim().length < 8) {
      return { rc: 1, code: "NO-REJECT-REASON" };
    }
    return { rc: 0, code: "INTAKE-REJECTED", target: disposition.reason };
  }
  return { rc: 1, code: "NO-DISPOSITION" };
}
