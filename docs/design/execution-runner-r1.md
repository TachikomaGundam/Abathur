# Execution-plane runner R1 — decision page

Status: **v10 APPROVED (3A/0R, run 评审运行) for body sha256 `4dd566edf50d092a2f977196bb07fe0932db3bd4f7c4b83a28bb71c35363d4f8`. This status/history metadata was added after approval; the reviewed security body is unchanged. Implementation still requires the plan tasks and the per-test gate.**
This page defines only R1: a per-invocation bwrap runner for target tools.
It does not change the Abathur controller, the human's opencode session, or
`~/.config`.

Review history:
- v2 (sha256 f326ec5d…): REJECT 1A/2R, run 评审运行.
- v3 (sha256 dc723624…): REJECT 1A/2R, run 评审运行.
- v4 (sha256 f52150e2…): REJECT 0A/3R, run 评审运行.
- v5 (sha256 79a46598…): REJECT 0A/3R, run 评审运行.
- v6 (sha256 15ababa0…): REJECT 0A/3R, run 评审运行.
- v7 (sha256 a30d6a4d…): REJECT 1A/2R, run 评审运行.
- v8 (sha256 c7f99036…): APPROVE 3A/0R, run 评审运行.
- v9 (sha256 8d6e82db…): APPROVE 2A/1R, run 评审运行; one
  must-fix: the setuid-absence assertion contradicted the ro-bound stock `/usr`.
- v10 (sha256 4dd566ed…): APPROVE 3A/0R, run 评审运行;
  approval is for the exact v10 body. Deferrable residuals are recorded in
  `<state>/evidence/r1-approval.md`; they do not change the approved body.

Implementation status: prototype exists in `kernel/exec/`; bwrap 0.11.1 uses
`--sync-fd` instead of the absent `--preserve-fds`, and `--size` takes bytes.
Host tests pass, but target-spawn wiring and the spawn gate are still open. See
`docs/design/execution-runner-r1-implementation.md` for the exact deviations and
residuals. This note is post-approval metadata; the security claims above are
unchanged.

## 1. The problem R1 solves

The requirement is:

> The human calling Abathur must not be affected. Abathur's calls to the target
> tool/harness/code must run in a controlled environment.

That is a control-plane / execution-plane split, not whole-seat isolation.

- **Control plane**: `abathur` CLI, rules, review, evidence, plan checks, MCP,
  model API, config, auth, caches. Runs as `lab`, unchanged.
- **Execution plane**: target tools, harnesses, tests, build/package scripts.
  Runs through R1. Adversarial candidate seats/mutators are excluded (section 5).

R1 is invoked by the trusted controller. It does not try to sandbox the
controller itself.

## 2. What R1 is

A runner API with an argv-only boundary:

```text
run({
  argv: ["npm", "test"],       // no shell string
  input: "/path/to/input",     // source tree, copied by runner into the jail
  stateDir: "/path/to/state",  // host-side run state: collector, metadata, cleanup
  runId: "run-...",            // host allocator; never a target-controlled path
  jailRunDir: "/run/warden",   // fixed jail-internal tmpfs mount point
  net: "none",                 // no R1 network profile
  timeoutMs: 120000,
  streamTimeoutMs: 30000,      // controller-side drain deadline
  memoryLimitBytes: 8589934592, // RLIMIT_AS 8G, above V8's reservation
  env: { CI: "1" },            // allowlisted, no host secrets
  artifactFd: 3,               // dedicated stream back to the controller
})
```

`stateDir` is controller-owned and is never mounted into the jail. `jailRunDir`
is a fixed internal path (`/run/warden`), not a host path. The runner creates a
bwrap jail and executes the target there. It returns:

```text
{ code, signal, stdout, stderr, outputDir, truncated }
```

The controller treats all of this as data. It never `eval`s target output and
never executes a target-produced script in the controller process.

## 3. R1 jail

Default flags (bwrap >= 0.8 is a conservative floor; the runner verifies the
actual required features, not the version alone):

```text
--die-with-parent
--new-session
--as-pid-1
--unshare-user
--unshare-pid
--unshare-ipc
--unshare-uts
--unshare-cgroup
--unshare-net
--disable-userns
--cap-drop ALL
--size 64M
--tmpfs /home
--size 512M
--tmpfs /tmp
--size 512M
--tmpfs /run/warden
--ro-bind <stagingInput> /run/warden/input
--ro-bind <r1-probe> /run/warden/r1-probe
--ro-bind /usr /usr
--symlink usr/bin /bin
--symlink usr/lib /lib
--symlink usr/lib64 /lib64
--symlink usr/sbin /sbin
--ro-bind <generated-etc> /etc
--dev /dev
--size 64M
--tmpfs /dev/shm
--proc /proc
--clearenv
--preserve-fds 2
--setenv HOME /run/warden
--setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
--chdir /run/warden
--seccomp 4
-- <r1-probe> <target-argv...>
```

**fd plan** (fixed, no ambiguity):

| fd | owner | purpose | target sees it |
|---|---|---|---|
| 0,1,2 | controller/probe | stdio | yes |
| 3 | `r1-probe` | artifact stream (pipe) | **no** |
| 4 | bwrap | seccomp filter (numeric fd) | no; bwrap consumes it |

`--preserve-fds 2` preserves exactly fds 3 and 4 across bwrap's exec. bwrap
reads the seccomp filter from fd 4 before the probe starts. The probe closes
fd 4; it keeps fd 3. On the target child's copy of fd 3, the probe sets
`FD_CLOEXEC` after fork and before exec, then closes it; the probe's own fd 3 is
not CLOEXEC and stays open for the stream. The target cannot read or write the
stream after exec, including across a re-exec. The probe owns fd 3 until it
emits the terminator. A test asserts fd 3 is closed in the target by trying to
`write(3, ...)`, checking `/proc/self/fd/3`, and attempting
`open('/proc/1/fd/3')`; the target has no capabilities after `--cap-drop ALL`.

`--unshare-cgroup` is the hard variant; do not use `--unshare-cgroup-try`,
whose silent failure would leave the cgroup boundary fail-open. The probe
records the cgroup namespace inode and the controller asserts it differs from
the host's; if the kernel cannot unshare cgroups, bwrap fails before exec.

Important choices:

- **No host home**: `/home` is tmpfs. `~/.config`, `~/.ssh`, `~/.local`, and
  opencode auth/data are absent.
- **No `/run` or `/var/run`**: no D-Bus, systemd user bus, Docker socket,
  display socket, or SSH agent socket.
- **No full `/etc`**: a generated minimal `/etc` (ld.so cache, CA certs, nsswitch,
  passwd/group as needed) is mounted. `/etc` is not a blanket read-only mount,
  because it may contain host secrets that the target has no business reading.
- **Loader and toolchain paths**: `/usr` is bound read-only and `/bin`, `/lib`,
  `/lib64`, `/sbin` are symlinked for merged-usr distros. Non-merged-usr distros
  bind the real directories instead; the profile records which strategy was used.
  `/opt` is profile-only, not default. A functional smoke test (`npm test` or the
  target harness) runs in the actual jail before any security test is trusted.
- **No host `/proc`**: `--unshare-pid`, `--as-pid-1`, plus `--proc /proc` gives
  the target its own PID namespace. It cannot see controller PIDs.
- **No nested user namespaces**: `--disable-userns` (requires `--unshare-user`).
- **No network**: `--unshare-net`. Network targets need R2/R3, not a `--share-net`
  escape hatch.
- **No Docker**: no socket mount, no docker group, no `/run`.
- **Input is staged by the controller and bound read-only**: the controller
  builds `stateDir/runs/<runId>/input` with default-deny semantics, then bwrap
  `--ro-bind`s it onto `/run/warden/input`. The original repository path is
  **never mounted**. The input is read-only inside the jail; the target can read
  it but cannot rewrite it. Staging bytes live on the host, not in the 512M
  `/run/warden` tmpfs; the input copy has its own size cap.
- **Secret overlay**: even inside a listed subtree, the copy excludes `.git/`,
  `.env*`, `.npmrc`, `.netrc`, `.git-credentials`, `.ssh`, cloud credential
  stores, `*.pem`, `*.key`, and token files unless the profile explicitly
  allows that exact path after review. The overlay is a second gate, not a
  substitute for the allowlist.
- **`/run/warden` is a sized tmpfs inside the jail**, not a host bind. It is
  the target's only writable area. The controller's host state is
  `stateDir/runs/<runId>/`, owned by the controller and never mounted. The sizes
  are `/home` 64M, `/tmp` 512M, `/run/warden` 512M, `/dev/shm` 64M; the target
  cannot fill the host filesystem through these paths. The jail path is fixed;
  it is not validated against controller roots. `stateDir` **is** validated
  (absolute, canonical, under the controller state root, no symlink).
- **Artifact collection is streamed, not a host directory walk**: `r1-probe` is
  the PID-namespace init (`--as-pid-1`) and the target is its child. The probe
  walks `/run/warden` with `O_NOFOLLOW`/`lstat`, refuses symlinks, and writes
  the stream over fd 3. **Excluded from the walk**: `/run/warden/input` and
  `/run/warden/r1-probe`, whose `st_dev` differs from the `/run/warden` tmpfs
  root; the probe skips every mount point with a different `st_dev` and asserts
  the input copy is not replayed as artifacts. The probe and target both run as
  uid 0 in the namespace; `--cap-drop ALL` leaves the target with an empty
  capability set, and the probe sets `PR_SET_DUMPABLE=0` before target start, so
  `/proc/1/fd/3` is not openable by the target. The probe closes fd 3 on the
  target child's copy after fork and before exec, and sets `FD_CLOEXEC` on that
  child copy; the target cannot write the stream, even after re-exec.
- **Stream protocol has a terminal record**: every frame is
  `[u32 length][u8 type][payload]`. Types are `HELLO`, `FILE_BEGIN`,
  `FILE_DATA`, `FILE_END`, `ARTIFACT_REFUSED`, `SUMMARY`, `TERMINATOR`.
  `SUMMARY` carries file count, total bytes, and probe exit status;
  `TERMINATOR` carries the sha256 of all preceding bytes and a final status.
  The controller treats a stream without `TERMINATOR` as
  `R1-STREAM-TRUNCATED`; no partial artifact set is accepted. The controller
  drains continuously and enforces `streamTimeoutMs`; a full pipe or a target
  that never exits is a failed run, not a silent hang.
- **Probe death is a named failure**: if the probe is killed (OOM, SIGKILL,
  bwrap timeout), the controller sees EOF without `TERMINATOR` and reports
  `R1-PROBE-LOST`; artifacts are not accepted. The probe has the same uid as the
  target, so this is detection, not prevention; `--die-with-parent` and the
  controller's pidfd/exit status cover cleanup.
- **Same-uid artifact tamper residual**: the target can rewrite its own tmpfs
  before exit. The probe kills descendants and waits before collecting, but a
  target can race before that point. Streaming and hashing detect tampering
  after the fact; they do not prevent it. For adversarial targets use R2/R3.
- **Hardlink denial is layout-independent**: `/run/warden` is tmpfs, so it has
  a different `st_dev` from `/usr` and `/etc`; `link()` from those mounts
  returns `EXDEV`. The runner asserts `st_dev` differs at startup and the test
  expects failure, not `fs.protected_hardlinks`.
- **Memory limit is per-process, not per-run aggregate**: the runner applies
  `prlimit --as=8G` (above V8's ~4G pointer-compression reservation, so
  Node >=22 still starts) and does **not** use `RLIMIT_NPROC`, which counts
  against the host uid and would break the controller. A per-run cgroup v2
  `MemoryMax`/`TasksMax` is optional when the controller has a delegated
  cgroup; without it, a fork bomb and multi-process RAM pressure are named
  residuals. The 8G cap is not a host-RAM guarantee.
- **No uid split is claimed**: with unprivileged bwrap, a uid-0 entrypoint and a
  uid-65534 target cannot be guaranteed on every host (the subuid map may not
  include 65534). The probe and target therefore run as uid 0 in the namespace,
  with `--cap-drop ALL`. Security comes from namespaces, seccomp, bwrap, empty
  capabilities, and fd closure, not from a second uid. The probe calls
  `prctl(PR_SET_DUMPABLE, 0)` and `prctl(PR_SET_NO_NEW_PRIVS, 1)` before starting
  the target; with the target's capabilities empty, `/proc/1/fd/3` is not
  openable by the target, and fd 3 is closed in the target child. If the target
  kills the probe, the run fails with `R1-PROBE-LOST`; no artifact is accepted.
  This is detection, not a claim that the probe is unkillable.
- **Self-probe runs in the same jail instance immediately before target exec**:
  the in-jail entrypoint is `r1-probe` (a small runner-owned Node helper mounted
  read-only, not a caller shell). It checks `/proc/self/mountinfo` (`/home`
  tmpfs, `/run/warden` tmpfs), `/proc/net/dev` (only `lo`), `/proc/1` (jail
  init), `Seccomp: 2`, `NoNewPrivs: 1`, `CapEff: 0` in the target child after
  fork, and the cgroup namespace. `Seccomp: 2` is the authoritative ptrace
  defense; Yama is optional defense in depth, not a gate. It does not claim a
  second uid; uid_map is diagnostics only. On success it starts the target as
  its child in the same PID namespace; on failure it exits with a named error.
  There is no second bwrap instance and no re-mount between probe and target.
- **Generated `/etc` is a runner-owned fixed file list**: `passwd` (minimal
  `root` and `nobody`), `group`, `nsswitch.conf`, `hosts`, empty `resolv.conf`,
  `ld.so.cache`, `ssl/certs/ca-certificates.crt`, and `localtime` only. No host
  user list, no host secrets. A jail-side test asserts each required entry
  exists and that no host-only account/token is present. Refresh is tied to the
  bwrap digest policy (open decision 7); a distro update that changes the CA
  bundle or loader cache requires a re-generated `/etc` and a re-run of the
  functional smoke.

## 4. What R1 claims

| Claim | Mechanism | Test |
|---|---|---|
| Target cannot write the controller home | `/home` tmpfs, no bind | write `<home>/...` fails |
| Target cannot read controller config/auth/SSH | `/home` tmpfs, env cleared | read `~/.config`, `~/.ssh` fails |
| Target cannot gain host privilege via sudo | no host identity; ns uid 0 has empty caps; generated `/etc` has no sudoers; stock `/usr` setuid binaries are inert under `NoNewPrivs` + empty caps | `sudo` is either absent by design (`ENOENT`/`EACCES`) or present and fails with no-valid-sudoers/`EPERM`; exact shape recorded, bare nonzero rejected; an existing setuid binary is exec'd as a positive control and must leave `CapEff: 0` and ns uid 0 |
| Target cannot use Docker | no socket, no `/run`, no docker group | `docker ps` fails |
| Target cannot use network | `--unshare-net` | `curl`/`git fetch` fails |
| Target cannot write main `.git` or evidence | not mounted; only run dir writable | write `.git/hooks`, ledger fails |
| Target cannot read the original input path, `.git`, `.env`, or token files | copy-only; original path never mounted | read original path and secret files fails |
| Target cannot create nested user namespaces | `--disable-userns`, kernel-dependent; test 10 is the authority | `bwrap --unshare-user ...` fails on this kernel |
| Target cannot see controller processes | separate PID namespace | `/proc` lists only target PIDs |
| Target cannot ptrace or `process_vm_readv`/`process_vm_writev`/`kcmp` a jail sibling | seccomp filter (authoritative) | attach/read/write/kcmp of probe sibling fails with EPERM/ENOSYS |
| Target cannot forge artifacts if the probe dies | probe loss = no `TERMINATOR` = failed run; fd 3 closed and `PR_SET_DUMPABLE=0` | `R1-PROBE-LOST`, no artifacts accepted |
| Target actually starts with the toolchain | `/usr` bind + merged-usr symlinks or real dirs | per-class smoke passes in jail |
| Target cannot fill the host disk through `/run/warden` | sized tmpfs (512M) + stream cap | fill attempt stops at 512M; host filesystem unaffected |
| One target process cannot exceed 8G virtual address space | `prlimit --as=8G` | large allocation hits `ENOMEM`; multi-process RAM pressure is residual |
| Artifact stream integrity is checked in flight | kill descendants, stream, hash, `TERMINATOR` | the controller detects truncation/forgery between probe read and stream; it does not prove the tmpfs bytes were untampered before the probe read them, and target output is never executed |
| Target can write its own workspace | `/run/warden` is a sized tmpfs | `touch /run/warden/ok` succeeds |
| Target can read its input copy | `/run/warden/input` | read input file succeeds |
| Artifact stream refuses target symlinks | `O_NOFOLLOW`/`lstat` walk in probe | symlink is refused, `ARTIFACT_REFUSED` record emitted |

R1 **does not claim**:

- protection from kernel exploits;
- protection from a host compromise outside the jail;
- network isolation for targets that need network (R2/R3);
- Docker/GUI support (R2/R3);
- protection from a controller that deliberately mounts secrets into the input;
- protection from a controller that `eval`s target output;
- host-level memory isolation across concurrent runs (only per-process
  `RLIMIT_AS=8G`; no host aggregate cap unless an optional cgroup is enabled);
- prevention of same-uid artifact tampering before target exit; the stream hash
  proves in-flight integrity of what the probe read, not that the tmpfs bytes
  were untampered before the probe read them;
- survival of the probe under the same 8G `RLIMIT_AS`: a very large artifact
  tree or Node heap spike can OOM the probe and yield `R1-PROBE-LOST`, not a
  partial artifact set;
- safety for arbitrary untrusted or adversarial code that can exploit the kernel;
- coverage of exam seats or mutator scripts that are adversarial by design;
  those are excluded from R1 (section 5).

R1 is a **controlled execution environment for target tools**, not a claim that
the whole seat or the whole host is safe.

## 5. Target vs controller classification

R1 only helps if **every** target execution in its class goes through it. The
class boundary is part of the security claim:

**R1 target class (semi-trusted, operator-controlled source):**

- tests and harness commands;
- build/package scripts that execute repository code, including
  release-candidate packaging;
- wave-engine cells whose briefs and inputs come from the operator's repos.

**Excluded from R1 (adversarial by design):**

- candidate exam seats;
- mutator scripts / self-evolved code that is itself the subject of an
  adversarial evaluation;
- any target the operator cannot describe as "source I control, not an
  adversary trying to escape."

Those targets fail closed with `R1-ADVERSARIAL-TARGET`; they need R2/R3 or must
not run. This removes the contradiction in v5: R1 is not claimed for
adversarial code.

Acceptance gate: a single sanctioned spawn API is the only way target commands
can start. A mechanical check (lint/test) fails on direct `child_process` spawn
in the listed R1 paths, including `exam/spawn`, `scripts/release-candidate`, and
`tools/wave_engine` dispatch. The check covers the Abathur repository's JS entry
points; it **cannot** see `eval`, `Function`, native addons calling `execve`, or
every `process.binding` path. That is a named residual, not an absolute claim.
Unclassified new call sites fail closed.
Network/Docker/GUI targets fail with named refusals (`R1-NO-NETWORK`,
`R1-NO-DOCKER`, `R1-NO-GUI`) unless a reviewed R2/R3 profile is selected.

## 6. Self-evolution guard

If Abathur evolves itself:

- the running controller must come from a pinned install or frozen commit;
- the candidate tree is copied as input to R1;
- R1 runs the candidate tests;
- the human reviews and promotes;
- the running controller never imports the candidate tree.

Without this, a candidate change to the controller would run as `lab` on the
next invocation, and R1 would be bypassed.

## 7. Negative and positive tests

Run through the actual controller path, not a hand-written bwrap command.

1. Write `<home>/...` fails.
2. Write another line root fails.
3. Read `~/.config`/`~/.ssh` fails.
4. **Non-vacuous process visibility**: the controller places a unique canary in
   its environment before the run; the target scans every `/proc/*/environ` in
   the jail and must never find the canary. The controller records its own host
   PID before the run; the jail's `/proc` must not contain that PID. A failure
   must be absence of the canary or `EPERM`/`ENOENT`; an `ESRCH` on a coincident
   PID is not accepted as proof.
5. `sudo` is either absent from the generated jail by design (`ENOENT` or
   `EACCES`) or present and fails with no valid sudoers/`EPERM`. The exact shape
   is recorded; a bare nonzero or an unexplained command-not-found is rejected.
   The runner-controlled mounts (generated `/etc`, staging input, tmpfs) contain
   no setuid-root binary. Stock `/usr` is a ro-bind, so setuid binaries may
   exist there; the test does not claim their absence. Instead, if any
   setuid-root file exists under `/usr`, execute a harmless one (for example
   `su --help`) and assert `CapEff: 0` and ns uid 0 afterward; `NoNewPrivs` plus
   empty caps are the guarantee. Record the mount flags too.
6. `docker ps` fails.
7. `curl` and `git fetch` fail with `net=none`.
8. Write `.git/hooks/pre-push` fails.
9. Write `<state>/evidence/INTENT-LEDGER.md` fails.
10. Nested `bwrap --unshare-user ...` fails.
11. Write `/run/warden/ok` succeeds (positive control).
12. Read the input copy succeeds (positive control).
13. A symlink in the input pointing outside the input is not followed while the
    runner builds the copy; `..` and absolute-path escapes are rejected.
14. The original input path is not mounted: reading
    `/path/to/original/input/.env`, `.git`, or a token file from the jail fails.
15. A target that runs longer than `timeoutMs` is killed; output over the cap is
    truncated and marked.
16. Controller commands (`abathur status`, `rules validate`, `plan check`) still
    work while target calls use R1.
17. A target-produced script is **not** executed by the controller; it is only
    stored as an artifact.
18. A target that writes outside its run dir through a hardlink or symlink is
    denied. `/run/warden` is tmpfs on a different device from `/usr` and `/etc`; the
    test attempts `link()` of a `/usr` file into the run dir and expects `EXDEV`,
    and does not treat `fs.protected_hardlinks` as the mechanism.
19. **In-jail stream walk refuses a symlink**: the target plants a symlink in
    `/run/warden` pointing at a controller secret path. After target exit, the
    probe's no-follow walk emits an `ARTIFACT_REFUSED` record naming the path
    and reason; the stream contains no secret bytes, and the controller's
    collector sees the refusal. There is no host-side directory walk to test;
    the host only receives the stream.
20. **Self-probe in the same jail instance**: `r1-probe` runs immediately before
    target exec and checks `/proc/self/mountinfo` (`/home` tmpfs,
    `/run/warden` tmpfs), `/proc/net/dev` (only `lo`), `/proc/1` (jail init),
    `Seccomp: 2`, `NoNewPrivs: 1`, `CapEff: 0` in the target child after fork,
    and the cgroup namespace inode differing from the host's; it sets
    `PR_SET_DUMPABLE=0`. It checks `Seccomp: 2` mode only; ptrace filter
    semantics are covered by test 25's jail-visible sibling and positive
    control, not by this probe. It starts the target as its child in the same
    PID namespace. A setuid-degraded bwrap or a probe failure aborts with a
    named error. `uid_map` is diagnostics only; there is no second-uid claim.
21. **bwrap identity and features**: resolve bwrap by absolute path; require
    version >= 0.8 as a conservative floor, a pinned file digest, and support
    for `--size`, hard `--unshare-cgroup`, `--disable-userns`, `--cap-drop`,
    `--ro-bind`, and `--seccomp` with a numeric fd. A same-named fake binary, an
    old version, a setuid-degraded build, or a missing feature fails closed
    before any target starts. The version/digest policy is recorded with the
    distro package version; a routine package update requires re-pinning (open
    decision 7).
22. **Copy allowlist and secret overlay**: a profile lists subtrees; the test
    seeds an arbitrarily named secret (`signer.pem`, dot-env variants, `.npmrc`,
    `.netrc`, `.git-credentials`, cloud credential files) and proves zero bytes
    reach `/run/warden/input` unless the exact path is explicitly listed. **Named
    residual**: a token embedded inside the contents of an allowlisted source
    file cannot be detected by a path/name overlay; the profile review must
    handle that, and no zero-byte guarantee is claimed for it.
23. **Spawn gate (bounded claim)**: a direct child-process call in an R1 target
    path fails the mechanical check. Seed one rejection test per entry point:
    `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync`,
    `fork`, any `node:child_process` import, re-export wrapper, dynamic
    `require`, dynamic `import('node:child_process')`, and computed member
    access; include `process.binding('spawn_sync')`. A repo-wide registry
    classifies every call site as control-plane or R1-routed; an unclassified
    new path fails closed. The gate covers Abathur repository JS entry points.
    **Named residual**: `eval`, `Function`, native addons calling `execve`, and
    unlisted `process.binding` paths are outside static detection; a target that
    uses them is a bypass candidate and must not be admitted to R1.
24. **Artifact stream protocol**: after the target exits, `r1-probe` kills
    remaining descendants, waits for the namespace to be empty, walks
    `/run/warden` with `O_NOFOLLOW`/`lstat`, and streams regular files over fd 3.
    It skips every mount point whose `st_dev` differs from the `/run/warden`
    tmpfs root: `/run/warden/input` and `/run/warden/r1-probe` are never
    replayed as artifacts. A test asserts the input copy is not in the stream
    and does not consume the byte cap. The stream has fixed frames and a
    `TERMINATOR` with a hash of all preceding bytes and probe status. A
    backgrounded writer is gone before collection; a symlink is refused
    (`ARTIFACT_REFUSED`); a byte-cap overrun truncates and marks; a missing
    terminator or mid-stream probe death is `R1-STREAM-TRUNCATED` or
    `R1-PROBE-LOST`, never a partial success. The target has empty capabilities
    after `--cap-drop ALL`; a test tries `write(3, ...)`, checks
    `/proc/self/fd/3`, and attempts `open('/proc/1/fd/3')`, all of which fail.
    The controller hashes the stream and never executes it. This is detection,
    not prevention.
25. **Ptrace/kcmp defense with a seeded negative control**: a target attempt to
    `ptrace`, `process_vm_readv`, `process_vm_writev`, `kcmp`, or `pidfd_getfd`
    the probe sibling (jail-visible PID) fails with `EPERM`/`ENOSYS` from the
    seccomp filter, not vacuous `ESRCH`. The test first proves the target and
    probe are in the same PID namespace; a seeded syscall that is not filtered
    by the profile is used as a positive control so the gate cannot pass
    vacuously. The probe checks `Seccomp: 2`; filter semantics are covered by
    this CI gate, not by mode alone.
26. **Functional smoke per R1 class**: run the real workload for each R1 class
    from section 5 in the actual jail on the actual distro, with the minimal
    loader/toolchain mounts (`/usr`, merged-usr symlinks or real
    `/bin`/`/lib`/`/lib64`/`/sbin`): (a) `npm test`/pytest for tests and harness;
    (b) a build/package script; (c) a wave-cell smoke from an operator-controlled
    brief. A git-free build also passes. Adversarial exam-seat and mutator
    smoke tests are **not** R1 tests; they must run under R2/R3 or be refused
    with `R1-ADVERSARIAL-TARGET`. Functional tests precede security tests.
27. **Probe-to-target handoff**: the probe and target are in the same bwrap
    instance; there is no second bwrap and no re-mount. The test verifies the
    target is a descendant of `r1-probe` in the same PID namespace, and that a
    probe failure prevents target start. “No re-exec” is not required; a
    probe-to-child handoff is allowed.
28. **Resource limits are mandatory in R1**: the runner wraps bwrap with
    `prlimit --as=8G` (above V8's virtual-address reservation, which makes a
    smaller `RLIMIT_AS` kill Node >=20). There is no `RLIMIT_NPROC`: it is
    per-uid, and one jail's limit would block the controller or other jails. A
    large allocation in the target hits `ENOMEM`; the controller survives. The
    test reads actual mounted sizes from `/proc/self/mountinfo` inside the jail:
    `/home` 64M, `/tmp` 512M, `/run/warden` 512M, `/dev/shm` 64M. Concurrent
    runs and multi-process allocation can still pressure host RAM; that is a
    named residual, not a host-level guarantee. A cgroup v2 `MemoryMax`/`TasksMax`
    is optional when delegation is available.
29. **Probe loss is detected, not prevented**: the probe and target are both
    uid 0 in the namespace. The probe sets `PR_SET_DUMPABLE=0` before starting the
    target and keeps fd 3 only in itself; the target sees no fd 3 and cannot read
    `/proc/1/fd/3`. The target may or may not be able to send `SIGKILL` to PID 1;
    kernel pid-namespace-init semantics decide. The test accepts both recorded
    outcomes: if delivered, the controller reports `R1-PROBE-LOST`, closes the
    stream, and accepts no artifacts; if suppressed, collection proceeds and the
    stream must still terminate with a valid hash. There is no claim that the
    probe is unkillable.
30. **Stream termination and backpressure**: a target that floods fd 3 or a
    controller that stops draining must not hang indefinitely. The controller
    drains continuously, enforces `streamTimeoutMs`, and kills the run on
    timeout; the result is `R1-STREAM-TIMEOUT`. A stream with no `TERMINATOR`
    is `R1-STREAM-TRUNCATED`; a stream with a bad final hash is
    `R1-STREAM-HASH-MISMATCH`.
31. **Generated `/etc` content**: a jail-side test asserts the fixed file list
    exists, `passwd` contains only the minimal `root`/`nobody` entries, and no
    host-only account or token file is present; a missing CA bundle or loader
    cache fails the functional smoke.
32. **Seccomp fd is consumed**: after bwrap starts, the probe asserts fd 4 is
    closed (`fcntl(4)` = `EBADF` or `ENOENT`-tolerant close); if bwrap left it
    open, the probe closes it before target start. No target ever inherits fd 4.

## 8. Implementation boundaries

- Add `kernel/exec/runner.mjs` (or `tools/runner/`) with a bwrap backend. No new
  runtime dependency.
- Resolve bwrap by absolute path; require version >= 0.8 as a conservative
  floor, a pinned file digest, and support for `--size`, `--unshare-cgroup`
  (hard, not `-try`), `--disable-userns`, `--cap-drop`, `--ro-bind`, and
  `--seccomp` with a numeric fd; fail closed on missing binary, old version,
  missing feature, or setuid-degraded build.
- argv array only; no shell string. If a target needs a shell, the caller passes
  `/bin/sh -c` explicitly and is responsible for quoting.
- Validate `stateDir` and `input` are absolute, canonical, and inside the
  controller's allowlisted roots; reject symlinks and `..`. `stateDir` is the
  host-side run state and collector directory, owned by the controller. The jail
  path `/run/warden` is fixed and is **not** validated as a host path; it never
  exists on the host.
- **Never mount the original input path.** Build `/run/warden/input` with a
  **default-deny profile**: nothing is copied unless the target-class profile
  lists the subtree. On top, the secret overlay excludes `.git/`, `.env*`,
  `.npmrc`, `.netrc`, `.git-credentials`, `.ssh`, cloud credential stores,
  `*.pem`, `*.key`, and token files unless the exact path is explicitly listed
  after review.
  Copy regular files only; no symlinks, no special files; cap file size and total
  copy size. The target sees only the copy.
- **Toolchain mounts**: bind `/usr` read-only and create merged-usr symlinks
  `/bin`, `/lib`, `/lib64`, `/sbin`; on non-merged-usr distros bind the real
  directories. `/opt` is profile-only. `/home`, `/tmp`, `/run/warden`, and
  `/dev/shm` are sized tmpfs (64M/512M/512M/64M) so disk-fill is bounded. Each
  `--size` must precede its `--tmpfs`; test 28 reads the effective sizes from
  `/proc/self/mountinfo`. Run a functional smoke test in the real jail before
  trusting security tests.
- **Generated `/etc` is a runner-owned fixed list**: `passwd`, `group`,
  `nsswitch.conf`, `hosts`, empty `resolv.conf`, `ld.so.cache`,
  `ssl/certs/ca-certificates.crt`, `localtime`; no host user list or token file.
  The generator is part of the runner, not a target hook. Refresh follows the
  bwrap/distro re-pin policy; a missing CA bundle or loader cache fails the
  functional smoke.
- Set `HOME=/run/warden`, clear env, pass only an allowlist.
- **In-jail probe atom**: mount a runner-owned `r1-probe` helper read-only. The
  bwrap entrypoint is `r1-probe` and the PID-namespace init (`--as-pid-1`),
  running as uid 0 in the namespace; it sets `PR_SET_DUMPABLE=0` and
  `PR_SET_NO_NEW_PRIVS=1`, checks the observables, then starts the target as
  uid 0 in the same PID namespace. After fork and before exec, the probe child
  calls `capset` with an empty effective, permitted, and inheritable set;
  `--cap-drop ALL` also removes the bounding set. The input is already a read-only bind at `/run/warden/input`; the probe
  does not remount or chmod it. On the target child's fd 3 copy, the probe sets
  `FD_CLOEXEC` and closes it; the probe's own fd 3 is not CLOEXEC and stays
  open. No caller shell and no second bwrap instance.
- **fd plan**: fd 3 is the artifact stream; fd 4 is the numeric seccomp filter
  passed to bwrap. `--preserve-fds 2` preserves both; bwrap consumes fd 4; the
  probe asserts fd 4 is closed (`fcntl(4)` = `EBADF` or an `ENOENT`-tolerant
  close) and keeps fd 3. No other fd is preserved. Test 32 covers fd 4; a test
  asserts the target sees no fd 3 after exec and cannot open `/proc/1/fd/3`,
  `/proc/self/fd/3`, or any jail-visible sibling's fd 3; that defense rests on
  the seccomp ptrace block plus `PR_SET_DUMPABLE=0`, not on the PID-1 path alone.
- Add a seccomp filter that blocks `ptrace`, `process_vm_readv`,
  `process_vm_writev`, `kcmp`, and `pidfd_getfd`; check `Seccomp: 2` and
  `NoNewPrivs: 1` in the probe. The seccomp filter is the authoritative ptrace
  control; Yama is optional defense in depth, not a gate. The probe checks mode
  only; filter semantics are covered by the CI gate against a jail-visible
  sibling, including writev/kcmp/pidfd_getfd and a seeded positive control.
- After target exit, `r1-probe` kills remaining descendants, waits for the PID
  namespace to be empty, walks `/run/warden` with `O_NOFOLLOW`/`lstat`, refuses
  symlinks, skips every mount point whose `st_dev` differs from the `/run/warden`
  tmpfs root (`/run/warden/input`, `/run/warden/r1-probe`), and streams frames
  over fd 3 with a total cap. `SUMMARY` carries count/bytes/probe status;
  `TERMINATOR` carries the hash of preceding bytes and final status. The
  controller drains continuously with `streamTimeoutMs`; a missing terminator is
  `R1-STREAM-TRUNCATED`, a bad hash is `R1-STREAM-HASH-MISMATCH`, a stalled
  stream is `R1-STREAM-TIMEOUT`, and probe death is `R1-PROBE-LOST`. No partial
  artifact set is accepted. There is no host-directory bind and no rename. Record
  that same-uid tampering before exit is detectable, not preventable.
- **Memory limits are mandatory**: wrap bwrap with `prlimit --as=8G`; this is
  above V8's virtual-address reservation. Do **not** use `RLIMIT_NPROC`; it is
  per-uid and would block the controller or sibling jails. A cgroup v2
  `MemoryMax`/`TasksMax` is optional when delegation is available. This caps one
  process, not host RAM across concurrent runs; that residual is named in
  section 4. The probe shares the same 8G cap: a large artifact tree can OOM the
  probe and yields `R1-PROBE-LOST`, never a partial artifact set.
- Per-invocation self-probe in the same jail instance: `/home` and
  `/run/warden` tmpfs, only `lo`, `/proc/1` jail init, `Seccomp: 2`,
  `NoNewPrivs: 1`, `CapEff: 0` in the target child after fork, cgroup namespace
  differs from host, `PR_SET_DUMPABLE=0`, ptrace/kcmp seccomp defense. Abort on
  any mismatch immediately before target start. `uid_map` is diagnostics only;
  there is no second-uid claim.
- Mechanical spawn gate (bounded): a repo-wide registry classifies every
  child-process call site as control-plane or R1-routed. Lint/test fails on
  **every** unclassified entry point (`spawn`, `spawnSync`, `exec`, `execSync`,
  `execFile`, `execFileSync`, `fork`, `node:child_process` imports, re-export
  wrappers, dynamic `require`, dynamic `import('node:child_process')`,
  `process.binding('spawn_sync')`, computed access). Missing/unresolvable lint
  config fails closed; seeded rejection tests are required per API. The gate
  covers Abathur repository JS entry points; `eval`, `Function`, native addons
  calling `execve`, and unlisted `process.binding` paths are named residuals.
- Hardlink/symlink denial rests on `/run/warden` being tmpfs with a different
  `st_dev` from `/usr`/`/etc`, so `link()` returns `EXDEV`; the runner asserts the
  device difference at startup. It does not rely on `fs.protected_hardlinks`.
- Return data only; do not execute artifacts.
- Add a target-spawn audit so no unclassified target `spawn` remains.

## 9. Open decisions

1. Which input subtrees and non-secret files are copied for each R1 target class?
   The copy is always an allowlist; this decides the allowlist entries.
2. What are the per-class `prlimit --as` values? R1 mandates `--as=8G` (above
   V8's reservation); tighter values are per class. No `RLIMIT_NPROC` is used.
   Concurrent-run and multi-process host RAM pressure remains a named residual;
   optional cgroup v2 limits are open.
3. Which R2/R3 profile is implemented first for network/Docker/GUI or adversarial
   targets? R1 itself must fail closed with `R1-NO-NETWORK`, `R1-NO-DOCKER`,
   `R1-NO-GUI`, `R1-ADVERSARIAL-TARGET`.
4. Is the controller pinned to an installed package for self-evolution, or does
   it run from a frozen commit with an integrity check? A pinned package is
   simpler; a frozen commit needs a digest check.
5. Where does the controller put `stateDir` and how long are artifacts retained?
   The stream protocol and fd plan are fixed in sections 3 and 8; the host
   collector path is `stateDir/runs/<runId>/`.
6. What is the maximum input copy size before R1 refuses and asks for an R2/R3
   profile?
7. bwrap digest pinning will fail closed on routine distro package updates; do we
   pin per distro/version, or allow a signed package update with re-pin? This is
   an availability residual either way; the same re-pin refreshes generated
   `/etc`.
8. Do we add CPU time (`--cpu`) and cgroup memory limits on top of `prlimit`, or
   keep `prlimit` as the mandatory floor? R1's claim is a per-process address-space
   cap, not host isolation or a per-run aggregate cap.

## 10. Recommendation

R1 is the minimum boundary that matches the current requirement: the human's
Abathur use stays as `lab`; only target execution is jailed. It is cheaper than
whole-seat worker isolation and has a much smaller impact on normal opencode
use.

Acceptance requires all of the following, not just a bwrap invocation:

- every R1 target class runs through the sanctioned spawn API; every unclassified
  child-process entry point in the covered JS paths fails the mechanical check;
  adversarial exam seats/mutators are refused, not silently routed;
- the original input path is never mounted; only a default-deny copy at
  `/run/warden/input` exists, with the secret overlay and an arbitrary-secret
  test;
- the loader/toolchain mounts are present and the per-class functional smoke
  passes in the real jail on the actual distro before security tests;
- `/run/warden` is a sized tmpfs with no host bind; effective tmpfs sizes are
  read from `/proc/self/mountinfo` in the test;
- artifact collection waits for an empty namespace, skips the input/probe mounts
  by `st_dev`, streams frames over fd 3 with a byte cap and `TERMINATOR`, is
  no-follow, and treats a missing terminator, probe death, or timeout as a
  failed run; same-uid tamper is detection, not prevention;
- the per-invocation self-probe and bwrap identity/feature check pass in the same
  jail, including `Seccomp: 2`, `NoNewPrivs: 1`, `CapEff: 0`, `PR_SET_DUMPABLE=0`,
  cgroup namespace, and ptrace/kcmp/pidfd_getfd defense; fd 3 is closed in the
  target and `/proc/1/fd/3` is not openable; fd 4 is closed in the probe after
  bwrap consumes it;
- `prlimit --as=8G` is applied to every run; there is no `RLIMIT_NPROC`;
  concurrent-run and multi-process host RAM pressure remains a named residual;
  the probe shares the cap and may end as `R1-PROBE-LOST`, never a partial set;
- network/Docker/GUI/adversarial targets fail closed with named refusals unless a
  reviewed R2/R3 profile is selected;
- setuid-root binaries present in the ro-bound `/usr` are inert under
  `NoNewPrivs` + empty caps; the test asserts that by executing one and checking
  `CapEff: 0`, not by claiming the stock `/usr` contains none.

R1 is **not** a substitute for R2/R3 when the target is untrusted, needs Docker,
needs GUI, or needs network. Those targets must use a container or VM profile.

R1 should not be called “seat isolation”. It is **target execution isolation**.
