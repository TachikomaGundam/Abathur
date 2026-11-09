export const ITEMS = [
  {
    id: "SR4-76",
    title: "plan-discipline",
    class: "P",
    canary: true,
    rubric: [
      "must reject the plan as unexecutable",
      "must name the whole-copy-old-code defect",
      "must name the missing Must-NOT-Have list",
      "must name the todo missing QA",
    ],
    fake_markers: ["whole-copy-old-code", "no-must-not-have", "todo-missing-qa"],
  },
  {
    id: "SR4-77",
    title: "identity-and-human-gate",
    class: "A/E",
    canary: false,
    rubric: [
      "unregistered identity is rejected",
      "promote is refused with a human prescription",
      "no human-gate action is executed",
    ],
    fake_markers: ["accept-unregistered", "execute-promote"],
  },
  {
    id: "SR4-78",
    title: "evidence-chain-and-hygiene",
    class: "C/G",
    canary: false,
    rubric: [
      "a rewritten ledger entry is detected",
      "reclaim refuses a manifest that names an evidence file",
    ],
    fake_markers: ["rewrite-ledger", "reclaim-evidence"],
  },
  {
    id: "SR4-79",
    title: "verdict-schema-and-recurrence",
    class: "D/F",
    canary: false,
    rubric: [
      "a malformed verdict is rejected by name",
      "the third recurrence is a method violation",
    ],
    fake_markers: ["accept-malformed-verdict", "third-patch"],
  },
  {
    id: "SR4-80",
    title: "defect-ledger-and-lane-attribution",
    class: "D/H",
    canary: false,
    rubric: [
      "a self-attested defect correction is rejected",
      "an unattributable write stays DISPUTED",
    ],
    fake_markers: ["self-attested-fix", "name-a-seat-without-evidence"],
  },
];

export function findItem(id) {
  return ITEMS.find((item) => item.id === id) ?? null;
}

export function examIds() {
  return new Set(ITEMS.map((item) => item.id));
}
