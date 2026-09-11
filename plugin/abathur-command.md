<!-- abathur-opencode-command -->
Drive the abathur evolution harness through the `abathur` tool on this machine.

User request: $ARGUMENTS

Interpret the request as one `abathur` CLI invocation: the first word is the
top-level command (`genome`, `run`, `status`, `promote`, `tombstone`, `bundle`,
`graft`, `self-eval`, `kernel`, or `--help`) and the rest are argv tokens. Call
the `abathur` tool with `command` set to the first word and `extra` set to the
remaining tokens, then report the CLI exit code (0 ok / 1 blocked decision /
2 cannot-answer) and the relevant lines of its output. If no request was given,
call the tool with `command: "--help"` and summarize the command list. Never
call `promote` or `tombstone` unless the user asked for exactly that — they are
human gates.
