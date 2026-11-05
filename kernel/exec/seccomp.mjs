/**
 * Minimal seccomp filter for R1.
 *
 * Blocks the same-uid inspection/control syscalls that would otherwise let a
 * target read the probe's artifact fd or another process's memory. The filter
 * is a raw sock_filter array, which is the format bubblewrap's --seccomp
 * accepts.
 */
import { R1Error } from "./policy.mjs";

const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_RET_K = 0x06;
const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ERRNO = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const AUDIT_ARCH_X86_64 = 0xc000003e;
const EPERM = 1;

// x86_64 syscall numbers. On other architectures this module fails closed.
const BLOCKED_X86_64 = new Map([
  [101, "ptrace"],
  [310, "process_vm_readv"],
  [311, "process_vm_writev"],
  [312, "kcmp"],
  [438, "pidfd_getfd"],
]);

function insn(code, jt, jf, k) {
  const buf = Buffer.alloc(8);
  buf.writeUInt16LE(code, 0);
  buf.writeUInt8(jt, 2);
  buf.writeUInt8(jf, 3);
  buf.writeUInt32LE(k >>> 0, 4);
  return buf;
}

export function buildSeccompFilter(arch = process.arch) {
  if (arch !== "x64") {
    throw new R1Error("R1-SECCOMP-ARCH", `seccomp filter not implemented for arch ${arch}`);
  }
  const program = [
    insn(BPF_LD_W_ABS, 0, 0, 4), // seccomp_data.arch
    insn(BPF_JMP_JEQ_K, 1, 0, AUDIT_ARCH_X86_64),
    insn(BPF_RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS),
    insn(BPF_LD_W_ABS, 0, 0, 0), // seccomp_data.nr
  ];
  for (const nr of [...BLOCKED_X86_64.keys()].sort((a, b) => a - b)) {
    program.push(insn(BPF_JMP_JEQ_K, 0, 1, nr));
    program.push(insn(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO | EPERM));
  }
  program.push(insn(BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW));
  return Buffer.concat(program);
}

export function blockedSyscalls() {
  return [...BLOCKED_X86_64.values()];
}
