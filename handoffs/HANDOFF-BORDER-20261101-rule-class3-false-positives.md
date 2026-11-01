# Handoff: env-path rule fires on member access in JS/TS (class-3 false positives)

To: the border seat. From: the Abathur seat. Date: 2026-11-01.
Status: **ready for the border seat** (this file replaces the paused 2026-11-01 draft that proposed a
pure-regex fix; that fix was proven contradictory by an independent read-aloud round).

## 1. What was observed (all re-runnable)

`border check` on the Abathur tree reports 20 MEDIUM findings. 13 are fixture usernames, 1 is a
guard's own negated literal, and **6 are `.env` matches inside JS/TS member expressions** such as
`opts.env` and `fx.harness.env`. One of the six is in production code, in `src/core/worktree.ts` —
a member access, not a file path.

Reproduce with the border CLI and the config the Abathur repo already uses.

## 2. Why the previous draft failed

The paused draft proposed a regex refinement keyed on the receiver identifier (for example: suppress
when the receiver looks like a variable). An independent read-aloud session (2026-11-01) showed the
proposal is self-contradictory: `opts` and `secrets` are both plain identifiers, so no regex over
identifiers can separate a variable from a path segment; suppressing by length still fires on
`opts.env`, and whitelisting identifiers fires on `secrets.env`.

Conclusion: the distinction is **syntactic, not lexical**. The same characters are a path only when
they sit inside a string literal; they are a property access when they follow a `.` in code.

## 3. Proposed change (syntax-aware)

Only the env-path rule's token classification changes. Other rules (home directory, secret patterns,
private keys) keep their current behaviour, including inside string literals.

For files the scanner classifies as JS/TS source:

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

Dependency note: `typescript` is currently only a devDependency of the border package. Either move it
to `dependencies` (bundled by esbuild) or vendor a small string/comment lexer. The compiler API is
preferred: it is the only option that also gets template literals and escapes right.

## 4. Acceptance fixtures (each pair must be internally consistent)

Positive (must be reported):

| file | snippet |
|---|---|
| `fixtures/pos/read-secret.js` | `const p = "secrets.env";` |
| `fixtures/pos/read-nested.ts` | `open("fx/harness/secrets.env")` |
| `fixtures/pos/doc.md` | `rotate secrets.env nightly` |
| `fixtures/pos/template.js` | ``const p = `${dir}/secrets.env`;`` |

Negative (must NOT be reported by this rule):

| file | snippet |
|---|---|
| `fixtures/neg/member-access.js` | `const e = opts.env;` |
| `fixtures/neg/member-access-deep.ts` | `fx.harness.env.drop();` |
| `fixtures/neg/member-short.js` | `o.env;` |
| `fixtures/neg/comment.js` | `// opts.env is a property` |

The previous draft's fixture table contained one pair that could not both hold; that is why this
table is written as four positives and four negatives with the same rule applied to each.

## 5. What this change must NOT do

- Must not weaken the home-directory rule or the secret-pattern rules, in code or in literals.
- Must not special-case this repository, this user, or any path.
- Must not suppress findings for non-JS/TS files.
- Must not change exit codes: a real finding still exits 1.

## 6. Acceptance evidence the border seat should return

1. `npm test` output (same command the border repo already uses) — all green.
2. `npm run typecheck` — clean.
3. A run of `border check` over the eight fixtures above showing four reported and four not.
4. A re-run over the Abathur tree showing the six member-expression findings gone and the 14 others
   unchanged.

## 7. Open question for the border seat (not for this seat to decide)

If the compiler API is unacceptable as a runtime dependency, say so and propose the lexer; do not
silently widen the rule to compensate.
