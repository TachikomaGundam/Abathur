#!/usr/bin/env bash
# 断言：沙箱插件只存在于本仓项目级；用户级与 root 快照的配置不得引用它。
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
PLUGIN="$REPO/.opencode/plugins/sandbox-bash.js"

if [ -f "$PLUGIN" ]; then echo "OK   project-plugin-present"; else echo "FAIL project-plugin-missing"; fail=1; fi

for cfg in "$HOME/.config/opencode/opencode.jsonc" /usr/local/lib/abathur/xdg/opencode/opencode.jsonc; do
  [ -f "$cfg" ] || { echo "SKIP $cfg (absent)"; continue; }
  if grep -q "sandbox-bash" "$cfg" 2>/dev/null; then
    echo "FAIL user-level-reference: $cfg"
    fail=1
  else
    echo "OK   no-reference: $cfg"
  fi
done

# 严格模式：用户级插件目录不得有同名文件（上次事故的第二装载点）
for p in "$HOME/.config/opencode/plugins/sandbox-bash.js" "$HOME/.config/opencode/plugins/sandbox-tools.js"; do
  if [ -e "$p" ]; then echo "FAIL stale-user-plugin: $p"; fail=1; fi
done
echo "RESULT=$([ $fail -eq 0 ] && echo PASS || echo FAIL)"; exit $fail
#
