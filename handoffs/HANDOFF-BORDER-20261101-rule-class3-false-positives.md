# Handoff: env-path rule fires on member access in JS/TS (class-3 false positives)

To: the border seat. From: the Abathur seat. Date: 2026-11-01.
Status: **ready for the border seat** (this file replaces the paused 2026-11-01 draft that proposed a
pure-regex fix; that fix was proven contradictory by an independent read-aloud round).

## 1. What was observed (all re-runnable)

`border check` on the Abathur tree reports 20 MEDIUM findings. 13 are fixture usernames, 1 is a
guard's own negated literal, and **6 are `.env` matches inside JS/TS member expressions** such as
`opts.env` and `fx.harness.env`. One of the six is in production code, in `src/core/worktree.ts` —
a member access, not a file path.

Reproduce with `cd /home/lab/workspace/harness/Abathur && /home/lab/.npm-global/bin/border` — no
arguments and no config, exactly as recorded in `.omo/evidence/gate4-full-20261101.txt` (rc=1).
The border source repository on this box is `/home/lab/workspace/harness/border` (verified
2026-11-01, HEAD `df64444`); all paths in this document are relative to that root.

## 2. Why the previous draft failed

The paused draft proposed a regex refinement keyed on the receiver identifier (for example: suppress
when the receiver looks like a variable). An independent read-aloud session (2026-11-01) showed the
proposal is self-contradictory: `opts` and `secrets` are both plain identifiers, so no regex over
identifiers can separate a variable from a path segment; suppressing by length still fires on
`opts.env`, and whitelisting identifiers fires on `secrets.env`.

Conclusion: the distinction is **syntactic, not lexical**. The same characters are a path only when
they sit inside a string literal; they are a property access when they follow a `.` in code.

## 3. Proposed change (syntax-aware)

Only the `exfil-cred-location` rule changes — the rule implemented in `src/exfil/rulesPath.ts`
(section starting at line 28). Its token classification becomes syntax-aware. Other rules (home
directory, secret patterns, private keys) keep their current behaviour, including inside string
literals.

The JS/TS source set is enumerated here, so it is not a judgement call: file extensions `.js`,
`.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts` take the new logic. Every other extension
(including `.md`, `.txt`, `.yaml`, `.json`) keeps today's behaviour.

For those files:

1. Parse the file with the TypeScript compiler API (`ts.createSourceFile`) using the file's extension
   to pick the script kind.
2. Collect the spans of all string-like literals (string literals, no-substitution template literals,
   and template literal fragments).
3. A `.env` match is **a path candidate** only when its span lies inside one of those literal spans.
   A match outside every literal span (property access, comment text, identifier) is **not** a path
   and must not be reported by this rule.
4. Comment text inside JS/TS is not a literal span, so it is not reported by this rule. (If comment
   text should be reported, that is a separate rule with its own fixtures — not this one.)

For non-JS/TS files (Markdown, plain text, config), keep today's behaviour: a bare mention is
reported.

Parse failure (decided here, so nobody has to guess): if a file is classified as JS/TS but the
parser cannot produce a syntax tree, keep today's behaviour for that file — report every match — and
write one diagnostic line to stderr naming the file and the parse error. Do not skip the file and do
not change the exit code for this case.

Dependency note: `typescript` is currently only a devDependency of the border package. Either move it
to `dependencies` (bundled by esbuild) or vendor a small string/comment lexer. The compiler API is
preferred: it is the only option that also gets template literals and escapes right.

## 4. Acceptance fixtures (each pair must be internally consistent)

All fixture paths below are written in full, relative to the **border repository root** (the same
root that holds `package.json`). Create exactly these paths.

Positive (must be reported):

| file | snippet |
|---|---|
| `test/fixtures-span-guard/pos/read-secret.js` | `const p = "secrets.env";` |
| `test/fixtures-span-guard/pos/read-nested.ts` | `open("fx/harness/secrets.env")` |
| `test/fixtures-span-guard/pos/doc.md` | `rotate secrets.env nightly` |
| `test/fixtures-span-guard/pos/template.js` | ``const p = `${dir}/secrets.env`;`` |

Negative (must NOT be reported by this rule):

| file | snippet |
|---|---|
| `test/fixtures-span-guard/neg/member-access.js` | `const e = opts.env;` |
| `test/fixtures-span-guard/neg/member-access-deep.ts` | `fx.harness.env.drop();` |
| `test/fixtures-span-guard/neg/member-short.js` | `o.env;` |
| `test/fixtures-span-guard/neg/comment.js` | `// opts.env is a property` |

The previous draft's fixture table contained one pair that could not both hold; that is why this
table is written as four positives and four negatives with the same rule applied to each.

## 5. What this change must NOT do

- Must not weaken the home-directory rule or the secret-pattern rules, in code or in literals.
- Must not special-case this repository, this user, or any path.
- Must not suppress findings for non-JS/TS files.
- Must not change exit codes: a real finding still exits 1.

## 6. Acceptance evidence the border seat should return

Commands, written out so no path has to be guessed:

1. In the border repository root: `npm test` — all green.
2. In the border repository root: `npm run typecheck` — clean.
3. In the border repository root, after `npm run build`: `node dist/index.js check` — no path argument
   and no `--config` flag (the Abathur run recorded `config=<none>`). Judge the result by exact path
   presence in the output: the four `test/fixtures-span-guard/pos/…` paths must appear, the four
   `test/fixtures-span-guard/neg/…` paths must not.
4. Against the Abathur tree, run the **repo build**, not the installed binary, so no install step is
   needed and no guessing is involved:
   `cd /home/lab/workspace/harness/Abathur && node /home/lab/workspace/harness/border/dist/index.js check`
   (no args, no config). The old-behaviour baseline is the recorded dispatch in
   `/home/lab/workspace/harness/Abathur/.omo/evidence/gate4-full-20261101.txt` lines 1–2 (that one used
   the installed binary, rc=1). After the fix: the six member-expression findings are gone and the
   remaining 14 appear unchanged. Updating the installed global binary is a human install step and is
   out of scope here — do not install from the worktree.

## 7. Dependency choice (decided here, not left to the reader)

Use the TypeScript compiler API and move `typescript` from devDependencies to dependencies. That is
the instruction; there is nothing to choose. If that move is impossible in the border package, stop
and report it — do not widen the rule to compensate.
