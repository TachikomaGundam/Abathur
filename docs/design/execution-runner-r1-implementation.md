# R1 implementation note

Status: **prototype implemented and tested on the host; not wired to every
target spawn site; not a complete security boundary yet.**

Approved design: `docs/design/execution-runner-r1.md` (v10, APPROVE 3A/0R).
This note records implementation facts that differ from, or are narrower than,
the approved prose. It does not change the claims in the approved body.

## What exists

- `kernel/exec/policy.mjs` — request validation, target classes, env allowlist,
  input staging, bwrap argv.
- `kernel/exec/bwrap.mjs` — absolute bwrap lookup, version and feature probe,
  sha256.
- `kernel/exec/seccomp.mjs` — x86_64 BPF filter blocking `ptrace`,
  `process_vm_readv`, `process_vm_writev`, `kcmp`, `pidfd_getfd`.
- `kernel/exec/r1-probe.py` — PID-1 probe: dumpable/NNP/cap clear, self-check,
  target fork, artifact walk (no-follow, st_dev skip), framed stream with
  per-file hash and terminator.
- `kernel/exec/runner.mjs` — controller-side invocation, fd 3 artifact stream,
  fd 4 seccomp, timeout, stream/hash verification, artifacts as data.
- `test/exec-policy.test.mjs` — 6 unit tests.
- `test/exec-runner.test.mjs` — 1 unit + 11 host integration tests. The
  integration tests skip inside the Abathur bash cage because nested bwrap is
  denied; run them on the host with `R1_INTEGRATION=1`.

## Verified facts

- Host bwrap 0.11.1: `--sync-fd` works; `--preserve-fds` is absent.
- `--size` takes bytes; the builder uses 64 MiB and 512 MiB.
- Host integration: 12/12 pass — basic artifact, original input path denied,
  allowlist-only input, Docker socket absent, sudo denied, host home write
  contained, symlink artifact refused, ptrace denied, network absent, timeout,
  probe artifact fd denied.
- Seccomp filter is a raw x86_64 BPF program accepted by bwrap.
- Input is staged into `stateDir/runs/<runId>/input` and mounted read-only;
  the original path is never mounted.
- Artifact stream is framed and hashed; controller rejects truncation, hash
  mismatch, symlinks, and cap overflow.

## Deviations / narrower than the approved prose

- The approved prose says `--preserve-fds`; bwrap 0.11.1 has no such flag. The
  implementation uses `--sync-fd 3` (verified to keep fd 3 open into the probe)
  and fd 4 for the seccomp filter.
- The implementation does not yet generate `/etc`; the jail has no `/etc` bind.
  This works for the tested Python target and is a deliberate narrow profile,
  but targets that need `/etc/passwd`, NSS, CA bundles, or locale files will
  fail closed rather than read host files. A generated `/etc` is still open.
- Memory is a per-process `RLIMIT_AS=8 GiB`; there is no per-run aggregate cap
  unless a delegated cgroup is available. Aggregate RAM exhaustion remains a
  named residual.
- The probe is Python, not a native helper. It relies on `/usr/bin/python3`
  from the read-only `/usr` bind.
- The probe is uid 0 in the user namespace; it is not a different uid. It sets
  dumpable=0, NNP, empty caps, and closes fd 3 in the target. A same-uid target
  that can exploit the kernel can still escape; R1 does not claim to stop that.
- The static spawn gate and target-class wiring are not implemented yet. The
  runner exists, but `exam/runner.mjs`, release-candidate, and wave dispatch
  still use their current spawn paths. Until those are routed through
  `kernel/exec/runner.mjs`, the guarantee is partial.
- No CPU limit is enforced. A CPU-bound target can consume host CPU until the
  wall-clock timeout.
- The `r1-probe.py` self-check depends on `/home` being a distinct tmpfs and
  `CapEff` being empty; if the host bwrap layout changes, it fails closed.

## Next integration steps

1. Add a target-spawn registry/lint so unclassified `child_process` use fails.
2. Route one real target class (tests/harness) through `runTarget`, keep the
   old path only behind an explicit legacy flag.
3. Add the `/etc` generator and a cgroup profile where available.
4. Add adversarial tests for fd/stream forgery and probe death.
5. Re-run the approved acceptance matrix and update the decision page.

Do not call R1 a full sandbox. It is a per-invocation execution boundary for
semi-trusted targets.
