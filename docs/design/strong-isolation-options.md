# Strong isolation options — decision page

Status: options only. This page does not choose for the owner and does not implement anything.

The current wall is the opencode bash cage: repo RW, `/home/lab` tmpfs, `/tmp` tmpfs, network none, run record read-only. It stops accidental cross-repo writes but is still same-uid. A malicious child can rewrite files the same user can write, including state outside the mount table if a path is exposed.

| Option | Cost | Covers | Does not cover |
|---|---|---|---|
| **A. Dedicated worker uid** | Create a service account; chown workspace/state; launcher must setuid or use a small privileged helper; every toolchain must be readable by that uid; cross-repo read grants need explicit groups | Same-uid record/ledger rewriting; most cross-line writes; accidental writes to the main user's home; process ownership separation | Root/kernel exploits; files explicitly group-writable; network egress; secrets mounted into the worker; human terminal keys |
| **B. Container or VM per run** | Image build and pinning; mount planning; startup latency; no host toolchain unless baked in; orchestration and cleanup; GPU/device passthrough if needed | Filesystem, PID, network, and capability isolation when configured; cross-line writes; same-uid state tampering; reproducibility | Mounted secrets; allowed network paths; kernel/hypervisor escapes; image supply chain; human keys |
| **C. Read-only mount plus writable workspace** | Per-repo mount table; path mapping; tools that expect to write in the repo need a writable overlay; more complex failure messages | Accidental writes to other lines; most path-based mutations; protects evidence and rules from ordinary commands | A same-uid process that finds another writable mount; kernel bugs; network; secrets; if the mount table is wrong, nothing |
| **D. Current cage + doctrine** | Low; already installed | Accidental in-repo mistakes; obvious cross-line paths; network off by default | Same-uid malicious writes; a determined child; anything outside the mount table |

## What each option would close from the current defect ledger

- D-20261105-09 (broad root contains a forbidden surface): A or B can close it with real mount/UID denial. C can close the common case but not a writable overlay mistake.
- D-20261105-10 (read-only roots are a declaration): A or B can enforce; C can enforce only if the mount is correct; D cannot.
- D-20261105-11 (empty forbidden lists): none of the options fixes missing declarations. It is a registry/owner task independent of isolation.

## Cost honesty

- A is the cheapest real wall for this machine if the work is all local files. It changes file ownership and can break tools that assume `/home/lab`.
- B is the strongest and the most expensive. It also changes how the seat is launched.
- C is a middle step; it is only as good as the mount table.
- D is the current state. Calling it “closed” would be false.

Owner decision required. No option is selected here.
