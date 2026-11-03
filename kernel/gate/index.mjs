import { HUMAN_GATES, humanGatePrescription } from "../surface/index.mjs";

/**
 * E-class predicates. The CLI only wires these; the decisions live here.
 */
export function isHumanGate(op) {
  return HUMAN_GATES.has(op);
}

/**
 * @param {string} op
 * @param {string} target
 */
export function gate(op, target) {
  if (!isHumanGate(op)) return { rc: 1, code: "NOT-A-HUMAN-GATE", detail: op };
  return { rc: 1, code: "HUMAN-GATE", prescription: humanGatePrescription(op, target) };
}

/** Reject operations that would cross from E1 into E2/E3. */
export function requireHumanForSurface(surface) {
  return ["E2", "E3"].includes(surface)
    ? { rc: 1, code: "HUMAN-GATE", detail: `${surface} is owner-only` }
    : { rc: 0, code: "OK" };
}
