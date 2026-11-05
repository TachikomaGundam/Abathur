# Strong isolation options — decision page (v3)

Status: revised after Sibyl REJECT `sibyl-20261105T075051Z-2d70`. The
recommendation is conditional: no option may be called “closed” until its
named negative tests pass. Owner decision still required.

## 1. Scope: the seat has more than one write path

The bash cage is not the whole seat. The seat can write through at least:

1. the `bash` tool, which is wrapped in bwrap;
2. the `write`/`edit`/`lsp_rename` tools, which run in the opencode process as
   `lab`, outside the cage;
3. MCP tools and plugins, also in the opencode process;
4. human execution of files the seat wrote.

Therefore **hardening only bash does not stop a malicious seat**. A seat can
call `write` on `.git/hooks/pre-push` or `.omo/evidence/INTENT-LEDGER.md`
without ever entering the cage. This is the main correction in v3.

## 2. Machine facts

Measured 2026-11-05. Receipts:
`.omo/evidence/isolation-baseline-20261105.out`,
`.omo/evidence/isolation-mechanisms-20261105.out`,
`.omo/evidence/systemd-user-probe*.out`,
`.omo/evidence/systemd-user-docker-probe.out`,
`.omo/evidence/systemd-user-inaccessible-probe.out`.

| Fact | Value |
|---|---|
| Host user | `uid=1000(lab)`, groups include `sudo` and `docker` |
| Host privilege | `sudo -n -l` succeeds: `(ALL : ALL) NOPASSWD: ALL` |
| Docker | `/var/run/docker.sock` is `root:docker 0660`; access is root-equivalent |
| Kernel | Linux 7.0.0; Landlock loaded |
| bwrap | 0.11.1, not setuid, unprivileged user namespaces enabled |
| systemd | 259.5; user manager running; subuid/subgid set |
| hardlinks | `fs.protected_hardlinks=1` |
| Cage env | `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `SSH_AUTH_SOCK` unset |
| Cage `/run` | absent; `/run/user/1000` absent; `busctl --user` and `systemd-run --user` fail |

Inside the current bash cage:

```text
uid=1000(lab); supplementary groups collapse to nogroup
CapEff=0; NoNewPrivs=1
sudo -n true   -> blocked by no-new-privileges
docker ps      -> socket not mounted
network none
```

The bash cage already blocks sudo, Docker, network, and capabilities. It is not
“no wall”. Its limits are:

- repo is RW, including `.git/hooks` and `.omo/evidence`;
- same uid;
- no seccomp;
- nested user namespaces allowed (`--disable-userns` absent);
- only bash is wrapped; the other write tools are not.

### systemd `--user` is not sufficient

Empirical probe:

```text
systemd-run --user -p NoNewPrivileges=yes ...        sudo blocked
systemd-run --user -p PrivateUsers=yes \
  -p ProtectSystem=strict -p ReadWritePaths=<dir>    /etc blocked, <dir> writable
systemd-run --user -p PrivateUsers=yes ...           docker ps STILL succeeds
systemd-run --user -p InaccessiblePaths=/var/run/docker.sock ...  ignored
```

`ProtectSystem=` does not restrict `AF_UNIX` connections, and the Docker socket
remains reachable. A user unit is not a sufficient boundary. A **system**
transient unit created by root may be, but that is a human-keyed surface and
must be tested.

## 3. Threat model

| ID | Threat |
|---|---|
| T1 | Accidental write outside the line root |
| T2 | Deliberate write to another line or the human home |
| T3 | Privilege escalation via sudo, setuid, or Docker socket |
| T4 | Evidence/ledger tampering |
| T5 | Git hook or script planted for the human to execute |
| T6 | Network exfiltration |
| T7 | Kernel attack surface |
| T8 | Reading another line's secrets |
| T9 | Seat output executed by the human outside the sandbox |
| T10 | Secret disclosure through readable mounts, env, D-Bus, or display sockets |

T9 is **not technically closable by uid or mount alone**. A human who executes
seat-written code with `lab` rights is root-equivalent. Only a mechanical
wrapper that runs candidate files inside the sandbox, or a policy plus an
enforced “never run” path, changes that. The matrix labels T9 “policy” for every
option, never “strong”.

## 4. Options

### O1 — Harden only the bash cage (partial)

Add to bwrap:

- `--unshare-ipc --unshare-uts --unshare-cgroup-try`;
- `--disable-userns` (requires `--unshare-user`);
- `--cap-drop ALL` explicitly;
- repo read-only; one writable seat workspace;
- `.git` read-only; `.omo/evidence` read-only;
- keep `/home/lab` tmpfs, `/tmp` tmpfs, `/usr`/`/etc`/`/opt` ro, network none;
- no `/run`, no `/run/user/1000`, no display sockets.

Coverage: accidental cross-line writes through bash, sudo, Docker, network,
nested user namespaces, and in-bash evidence/hook writes.

**Not covered:** the `write`/`edit`/`lsp_rename`/MCP tools still run as `lab`
outside the cage. A malicious seat can bypass the whole cage with one `write`
call. T4/T5 are also not “strong” because same-uid hardlinks can reach a
read-only bind on the same filesystem (`fs.protected_hardlinks=1` does not stop
the owner from hardlinking its own file). O1 must be labeled **bash-only**, not
seat-wide.

Cost: medium; breaks in-repo commits if `.git` is read-only; use a per-seat
clone or a human commit step.

### O2 — Whole seat as a separate uid + per-seat clone + O1 (recommended)

Run the **entire opencode seat** as `abathur-worker`, not just bash. The worker:

- has no login, no sudo, no docker group, no supplementary groups;
- owns a per-seat clone/worktree under a worker-owned root;
- sees the main repo and other lines read-only or not at all;
- has its bash tool inside the O1 cage, network none;
- has its model/API network only through a named proxy or allowlist, not raw
  host network;
- receives no `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `SSH_AUTH_SOCK`,
  display socket, or token-bearing environment.

The main repo, `.git`, and `.omo/evidence` are not writable by the worker.
Human merge is a separate step: `git fetch` from the worker clone into the main
repo, then inspect, then merge. The human never runs worker scripts or hooks in
the lab shell.

#### O2 launch mechanism (must be chosen before O2 is called viable)

bwrap is not setuid, and the cage has `NoNewPrivs`, so a `lab` seat cannot
“become” the worker uid by itself. One of these human-keyed mechanisms is
required:

- **L1 — root systemd transient unit**: root starts the seat with
  `systemd-run --uid=abathur-worker ...`. This is the cleanest. The unit must
  set `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=tmpfs`,
  `ReadWritePaths=<worker clone>`, `InaccessiblePaths=/var/run/docker.sock`,
  `PrivateTmp=yes`, and `RestrictAddressFamilies` as needed. The Docker socket
  must be tested from inside; user units are not enough.
- **L2 — narrow sudoers runas**: `lab ALL=(abathur-worker) NOPASSWD:
  /usr/local/bin/warden-launch` with an exact-path wrapper that validates cwd
  and arguments. This is a security-critical rule; a seat must not be able to
  pass arbitrary arguments or escape the wrapper.
- **L3 — worker login session**: the human starts a separate session as the
  worker. Simple, no setuid, but manual.

Any launch mechanism needs a negative test: from the lab seat, attempt to invoke
the launcher with a different cwd/argument and with an arbitrary command; both
must fail.

#### O2 merge and evidence policy

- Fetch/merge must reject changes to `.omo/evidence/**`, `.git/hooks/**`,
  `.gitmodules`, and any `.gitattributes` filter that can execute on checkout.
- The ledger must be checked against the external human-signed anchor before
  merge; an internally consistent hash chain written by the worker is not
  enough.
- Evidence append is a separate helper, not the worker's shell: fixed uid,
  `O_NOFOLLOW`, realpath containment, allowlisted target, append-only, and a
  hash-chain receipt. “Narrow helper or human merge” is not a design; the helper
  must be specified and tested.
- `git` must use `-c protocol.file.allow=never`, no recursive submodules, and a
  pinned version. A hostile clone with `.gitmodules`/symlinks is a required
  fixture.

#### O2 coverage

Closes T1/T2 for worker-visible paths, T3, T4/T5 for the main repo, T6 for bash
(and for the seat only to the extent the model proxy is not itself an open
egress), and T8. It does **not** close T7 (shared kernel), T9 (human executes
worker output), or T10 if secrets are readable by the worker.

Cost: high and ongoing: user/group, toolchain and caches (npm/uv), model/API
proxy, per-seat clone, merge review, KiCad headless/GPU decision. Not a one-time
setup.

### O3 — Whole seat in a container or VM

- **O3a rootless Podman**: not installed; subuid exists. No Docker socket;
  worktree only; network none or proxy; cap-drop; no-new-privileges. Shares the
  host kernel and the user namespace; kernel bugs remain. Same-user rootless
  containers share a user namespace unless `--userns=auto`.
- **O3b rootful Docker**: installed, but the daemon socket is root-equivalent.
  The seat must never see the socket. The daemon itself is root; a Docker/kernel
  exploit is host root. Do not use `-v /var/run/docker.sock`.
- **O3c VM**: QEMU/KVM, strongest. Highest cost: image, toolchain, GPU/KiCad
  device passthrough, storage, boot time.

Coverage: T1–T6, T8, and T10 if the image/mount/network are correct. T7 is
reduced by a VM, not by a container; T9 remains policy unless the human runs
output inside the same boundary.

Cost: high. Recommended for untrusted third-party code or multi-tenant work,
not as the default for local Abathur/PCB.

### O4 — Current cage + explicit residual

The current bash cage blocks sudo, Docker, network, and caps. It does not stop
`write`/`edit`/MCP writes, same-uid hardlinks, repo `.git/hooks`, or evidence
tamper. T1–T5 remain partially open; T7/T9/T10 remain open. D-09/10/11 stay OPEN.

Acceptable only if every seat is trusted and the human never executes seat
output. It is not a closure.

### O5 — Landlock/seccomp supplement (not standalone)

Landlock is loaded but has no helper installed. It can restrict filesystem
rights and TCP/UDP ports for the calling process and children. Limitations:
files opened before sandboxing are not restricted; `/proc/*/fd` and some special
filesystems are not explicitly restrictable; network rules are ports, not
destinations; UNIX sockets and already-open fds need separate treatment. Use it
only as an add-on to O1/O2, never as the sole boundary. Seccomp allowlists must
be tested against Node/Python or they break the toolchain.

## 5. Decision matrix

“Strong” means enforced by uid, mount, or namespace. “Partial” means only some
write paths. “Policy” is not enforcement.

| Threat | O1 bash-only | O2 whole-seat uid | O3 VM/container | O4 current |
|---|---|---|---|---|
| T1 accidental cross-line | strong in bash | strong | strong | partial |
| T2 deliberate cross-line | **not closed** (write tools) | strong | strong | weak |
| T3 sudo/Docker | strong in bash | strong | strong if no socket | strong in bash |
| T4 evidence tamper | partial (hardlink) | strong with merge+anchor | strong | weak |
| T5 git hook plant | partial (hardlink) | strong with merge policy | strong | weak |
| T6 network | strong in bash | strong in bash; proxy-dependent for seat | strong if none | strong in bash |
| T7 kernel exploit | weak | weak | medium (VM) | weak |
| T8 other-line secrets | **partial** (same-uid `/proc`, ptrace) | strong | strong | **weak** |
| T9 human runs seat output | policy | policy | policy unless executed inside | policy |
| T10 secrets via mounts/env | **partial** (same-uid process introspection) | strong with audit | strong with image config | weak |

## 6. Recommendation

**O2 + O1 is the recommended direction, but only with L1/L2/L3 launch,
merge/evidence policy, secret audit, and the negative tests below.** It is the
best wall-per-cost given a root-equivalent human uid; same-uid isolation cannot
stop a malicious seat.

**If O2 is not approved:** O1 is only a bash-cage hardening. It does not close
T2/T4/T5 for `write`/`edit`/MCP, and same-uid process introspection (`/proc`,
ptrace) keeps T8/T10 open. Record that honestly; do not call O1 “seat
isolation”. O4 is explicit residual-risk acceptance.

**If the code is untrusted or GUI-heavy:** O3c VM; route KiCad GUI/GPU work there
with a named device/display plan. Do not mount the host display socket into a
container and call it isolated.

**O5** only after O1/O2.

## 7. Mandatory tests before any option is called done

Run from the actual proposed boundary. A pass means the operation fails.

1. `sudo -n true` fails; `id` shows the worker uid for O2, or explicitly records
   same-uid for O1.
2. `docker ps` fails; `/var/run/docker.sock` absent or permission-denied.
3. `/run/user/1000`, `busctl --user`, and `systemd-run --user` fail; D-Bus,
   XDG, SSH, and display env vars are unset.
4. Write to another line root fails.
5. Write to main `.git/hooks` fails.
6. Write to `.omo/evidence/INTENT-LEDGER.md` fails.
7. Hardlink test: from a writable mount on the same filesystem, hardlink
   `.git/hooks/pre-push` and the ledger, then write through the link; must fail.
8. Nested `bwrap --unshare-user` fails (`--disable-userns`).
9. `curl`/`git fetch` fails when network is none.
10. Write to the seat's own workspace succeeds (positive control).
11. Non-bash write path: `write`/`edit`/`lsp_rename`/MCP attempted against a
    forbidden path fails. This must be tested through the actual opencode tool,
    not through bash.
12. Human merge: `git fetch` from the worker clone succeeds; a hostile clone
    with `.gitmodules`/symlinks/filters is refused; `.omo/evidence/**` changes
    are refused; ledger mismatch against the external anchor is refused.
13. Evidence helper: symlink swap, `..`, absolute path, and non-allowlisted
    target are refused; append result is hash-chained.
14. Secret audit: worker cannot read `~/.config` token stores, `~/.ssh`,
    `XDG_RUNTIME_DIR`, display sockets, or other-line env files.
14b. Same-uid process introspection: through the actual non-bash seat path
    (`write`/MCP), read `/proc/<lab-pid>/environ` of a token-bearing lab process
    and ptrace a keyring/gpg daemon. Both must fail under any option claiming
    T8/T10 coverage; if they succeed, O1/O4 T8 and T10 are **OPEN**, not
    partial. A sandbox that only wraps bash cannot pass this test.
15. GUI: if PCB/KiCad needs display, the chosen path is either a VM with a
    named device/display plan or an explicit risk acceptance; a mounted host
    display socket must be recorded as a wall break.

`systemd-analyze security` is not accepted as proof.

## 8. Preconditions before implementation

1. Choose L1/L2/L3 for O2 and test the launcher cannot be abused.
2. Audit every world/group-readable secret reachable by the worker; strip
   token-bearing env.
3. Decide the evidence helper (uid, path validation, `O_NOFOLLOW`, TOCTOU,
   append-only, hash chain); “human merge” alone is not a design.
4. Decide merge policy and hostile-clone fixture.
5. Decide KiCad GUI: headless O2, or O3c with a device/display plan.
6. Verify the external anchor path for the ledger before claiming T4.
7. Inventory all seat write tools; O1 covers bash only.

## 9. Open owner decisions

1. O2 whole-seat uid, or O1 bash-only with explicit T2/T4/T5 open?
2. If O2: L1, L2, or L3?
3. If O2: which toolchains/caches must the worker read, and which secrets must
   be purged?
4. If O3: VM or rootless container; how are KiCad GUI/GPU and device access
   handled?
5. Where does the evidence append live, and who holds its key?
6. Do we add seccomp/Landlock now, or defer until O1/O2 is stable?

## 10. Sources

- systemd.exec: https://freedesktop.org/software/systemd/man/latest/systemd.exec.html
- bwrap: https://man.archlinux.org/man/extra/bubblewrap/bwrap.1.en
- Landlock: https://docs.kernel.org/userspace-api/landlock.html
- Docker security: https://docs.docker.com/engine/security/
- Rootless Podman: https://github.com/podman-container-tools/podman/blob/main/rootless.md
- Local receipts: `.omo/evidence/isolation-baseline-20261105.out`,
  `.omo/evidence/isolation-mechanisms-20261105.out`,
  `.omo/evidence/systemd-user-probe.out`,
  `.omo/evidence/systemd-user-probe2.out`,
  `.omo/evidence/systemd-user-docker-probe.out`,
  `.omo/evidence/systemd-user-inaccessible-probe.out`
