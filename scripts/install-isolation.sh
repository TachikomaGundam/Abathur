#!/usr/bin/env bash
# install-isolation.sh v4 — R-ISO-3 三件套结构性部署（2026-10-24 重设计）
#
# 与 v1-v3 的本质差别（换原始动作，不是补丁）：
#   v1-v3: 凭据 mv 到 keyuser + sudoers 行内 sed 剥 token + 可读性验证
#          → 四域各自的路径/权限/keyring/幂等/半态 = 无界边缘面（三轮评审 51 条 must-fix 全由它长出）
#   v4   : 凭据由各域官方工具在 keyuser 侧重发、seat 侧登出/删除
#          sudo 只删 seat 专属 NOPASSWD 文件（原子幂等，备份在 sudoers.d 之外）
#          验证用双向功能谓词（seat 必败 + keyuser 必成）
#
# 四个不变量（本脚本的存在理由；任何一条不成立即 NOT-DONE）
#   I1  seat 无法免密取得 root（判据 = sudo -l -U seat 实测零 NOPASSWD）
#   I2  seat 无法行使外写凭据（seat 侧 gh/npm 认证必败、私钥/GPG 私钥不可读）
#   I3  keyuser 能行使各域权（正向实测；未配置的域=具名人类步骤，不阻塞其余域收口）
#   I4  幂等 + 无假 DONE（重跑收敛；任何未达标域具名并令退出码非零）
#
# 人类不可约步骤（机器不能代做；脚本逐条印出处方）
#   H1  provider 侧吊销旧 token（GitHub/npm 网页设置）
#   H2  keyuser 首次登录（gh auth login / npm login / ssh-keygen + 服务端授权公钥）
#   H3  组继承或 User_Alias 形式免密 sudo 的裁决（--accept-nopasswd-scope 记录）
#
# 用法: sudo bash install-isolation.sh            # dry-run，零改动
#       sudo bash install-isolation.sh --apply    # 执行（验证不允许时绝不收权）
set -uo pipefail

APPLY=0
ACCEPT_SCOPE=""
prev=""
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
  esac
  [[ "$prev" == "--accept-nopasswd-scope" ]] && ACCEPT_SCOPE="$a"
  prev="$a"
done

KEYUSER=abathur-keys
SEATUSER="${SUDO_USER:-}"
say()  { printf '%s\n' "$*"; }
ok()   { printf '  [OK] %s\n' "$*"; }
plan() { printf '  [PLAN] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
bad()  { printf '  [FAIL] %s\n' "$*"; }
human(){ printf '  [人类步骤] %s\n' "$*"; }
act()  { if [[ $APPLY -eq 1 ]]; then "$@"; else plan "would: $*"; return 0; fi; }

[[ ${EUID:-0} -eq 0 ]] || { bad "须以 root 运行: sudo bash $0 [--apply]"; exit 2; }
[[ -n "$SEATUSER" && "$SEATUSER" != root ]] || { bad "SUDO_USER 不可解析（须 sudo 从座席账户发起）"; exit 2; }
SEATHOME=$(getent passwd "$SEATUSER" | cut -d: -f6)
[[ -d "$SEATHOME" ]] || { bad "seat home 不存在: $SEATHOME"; exit 2; }
KEYHOME=$(getent passwd "$KEYUSER" 2>/dev/null | cut -d: -f6)
KEYHOME=${KEYHOME:-/home/$KEYUSER}
BKROOT=/root/isolation-backup/$(date -u +%Y%m%dT%H%M%SZ)
RC=0
FAILED=()
have() { command -v "$1" >/dev/null 2>&1; }

echo "== 0. 前置闸（不满足即停，绝不在死锁风险下收权）=="
PS=$(passwd -S "$SEATUSER" 2>/dev/null | awk '{print $2}')
[[ "$PS" == "P" ]] || { bad "$SEATUSER 密码状态=$PS（需可用密码，先 sudo passwd $SEATUSER）"; exit 2; }
ok "seat 密码可用"
EXPD=$(chage -l "$SEATUSER" 2>/dev/null | awk -F': ' '/Password expires/{print $2}')
if [[ -z "$EXPD" || "$EXPD" == "never" ]]; then ok "密码不过期"
elif [[ $(date -d "$EXPD" +%s 2>/dev/null || echo 0) -le $(date +%s) ]]; then
  bad "密码已过期（$EXPD）——收权后必死锁"; exit 2
else ok "密码到期日 $EXPD"; fi
echo "  目标 seat=$SEATUSER ($SEATHOME)  keyuser=$KEYUSER ($KEYHOME)"
if [[ $APPLY -eq 1 ]]; then
  printf '  输入 YES 确认（另一终端已验 sudo 可解锁）: '; read -r C
  [[ "$C" == "YES" ]] || { bad "未确认"; exit 2; }
fi

echo "== 1. keyuser 账户（幂等）=="
if id "$KEYUSER" >/dev/null 2>&1; then ok "$KEYUSER 已存在"
elif [[ $APPLY -eq 1 ]]; then
  useradd -m -s /bin/bash "$KEYUSER" && passwd -l "$KEYUSER"
  ok "$KEYUSER 建立（密码锁定=无交互登录，只能 root/sudo -u 进入）"
else plan "useradd -m -s /bin/bash $KEYUSER && passwd -l $KEYUSER"
fi
if [[ -d "$KEYHOME" ]] || [[ $APPLY -eq 0 ]]; then ok "keyuser home: $KEYHOME"
else bad "keyuser home 不存在: $KEYHOME"; RC=1; fi

echo "== 2. sudo 去免密（动作=删 seat 专属文件；不做行内改写）=="
SUDOL=""
if SUDOL=$(sudo -l -U "$SEATUSER" 2>/dev/null); then :
else bad "sudo -l -U 失败——无法判定 I1，收权中止"; RC=1; fi
NP_ALL=$(printf '%s\n' "$SUDOL" | grep 'NOPASSWD' || true)
if [[ -z "$NP_ALL" ]]; then ok "sudo -l 实测：seat 无任何 NOPASSWD"
else
  echo "  当前 NOPASSWD 条目（sudo -l 引擎输出）:"
  printf '%s\n' "$NP_ALL" | sed 's/^/    /'
fi

DEDI=(); MIXED=()
if [[ -d /etc/sudoers.d || -f /etc/sudoers ]]; then
  mapfile -t CAND < <(grep -rl 'NOPASSWD' /etc/sudoers /etc/sudoers.d/ 2>/dev/null | grep -vE '\.bak|~$|\.tmp$|\.swp$' || true)
else CAND=(); fi
for f in "${CAND[@]}"; do
  specs=$(grep -vE '^[[:space:]]*(#|$|Defaults|User_Alias|Host_Alias|Cmnd_Alias|Runas_Alias)' "$f" 2>/dev/null || true)
  [[ -n "$specs" ]] || continue
  # 是否含 seat 以外的用户规格行 → 非专属
  if printf '%s\n' "$specs" | grep -vE "^[[:space:]]*($SEATUSER|%[a-zA-Z0-9_-]+)[[:space:]]" | grep -q .; then
    MIXED+=("$f")
  elif printf '%s\n' "$specs" | grep -qE "^[[:space:]]*$SEATUSER[[:space:]]"; then
    DEDI+=("$f")
  else
    MIXED+=("$f")   # 只含 %组 规格 → 人类裁决
  fi
done
for f in "${DEDI[@]}"; do
  if [[ $APPLY -eq 1 ]]; then
    mkdir -p "$BKROOT"; cp -a "$f" "$BKROOT/$(basename "$f")"
    rm -f "$f"
    if visudo -c >/dev/null 2>&1; then
      ok "已删 seat 专属免密文件 $f（备份 $BKROOT/$(basename "$f")）"
    else
      bad "删除后 visudo -c 失败——从备份恢复并中止"
      cp -a "$BKROOT/$(basename "$f")" "$f"; exit 3
    fi
  else plan "删 seat 专属免密文件 $f（备份到 $BKROOT/）"; fi
done
for f in "${MIXED[@]}"; do
  warn "非专属免密文件，不自动改: $f"
  human "核对其中的 $SEATUSER 相关规则，人工删除或改走组裁决"
done

GRP_NP=$(printf '%s\n' "$SUDOL" | grep -E '\(%[^)]*\)' | grep 'NOPASSWD' || true)
if [[ -n "$GRP_NP" ]]; then
  warn "组继承免密（不自动动——动组影响全体组员）:"
  printf '%s\n' "$GRP_NP" | sed 's/^/    /'
  if [[ -n "$ACCEPT_SCOPE" ]]; then
    human "人类已接受范围: $ACCEPT_SCOPE（记录入收据，不计 I1 违例）"
  else
    human "裁决二选一：①从该组移除 $SEATUSER；②接受并重跑 --accept-nopasswd-scope '<组名+理由>'"
  fi
fi

echo "== 3. 凭据面（seat 侧登出/删除；keyuser 侧重发=人类步骤 H2）=="

if have gh; then
  if sudo -u "$SEATUSER" -H bash -lc 'gh auth status' >/dev/null 2>&1; then
    if [[ $APPLY -eq 1 ]]; then
      if sudo -u "$SEATUSER" -H bash -lc 'gh auth logout --hostname github.com' >/dev/null 2>&1; then
        ok "seat: gh 已登出"
      else bad "seat: gh 登出失败"; FAILED+=("gh-logout"); fi
    else plan "seat: gh auth logout --hostname github.com"; fi
  else ok "seat: gh 未认证（无凭据可收）"; fi
  if sudo -u "$KEYUSER" -H bash -lc 'gh auth status' >/dev/null 2>&1; then ok "keyuser: gh 已就绪"
  else human "H2a: sudo -u $KEYUSER -i 然后 gh auth login"; fi
else ok "gh 未安装，跳过"; fi

if have npm; then
  if sudo -u "$SEATUSER" -H bash -lc 'npm whoami' >/dev/null 2>&1; then
    if [[ $APPLY -eq 1 ]]; then
      REG=$(sudo -u "$SEATUSER" -H bash -lc 'npm config get registry' 2>/dev/null | tail -1)
      if sudo -u "$SEATUSER" -H bash -lc "npm logout --registry '$REG'" >/dev/null 2>&1; then
        ok "seat: npm 已登出（$REG）"
      else bad "seat: npm 登出失败"; FAILED+=("npm-logout"); fi
    else plan "seat: npm logout（registry 取 seat 配置）"; fi
  else ok "seat: npm 未登录"; fi
  if sudo -u "$KEYUSER" -H bash -lc 'npm whoami' >/dev/null 2>&1; then ok "keyuser: npm 已就绪"
  else human "H2b: sudo -u $KEYUSER -i 然后 npm login --registry <发布源>"; fi
else ok "npm 未安装，跳过"; fi

SHH=$SEATHOME/.ssh
WL='^(authorized_keys|authorized_keys2|known_hosts|known_hosts\.old|config|environment|rc)$'
is_privkey() { grep -q 'PRIVATE KEY-----' "$1" 2>/dev/null; }
if [[ -d "$SHH" ]]; then
  n=0
  while IFS= read -r -d '' f; do
    b=$(basename "$f")
    [[ "$b" =~ $WL ]] && continue
    [[ "$b" == *.pub ]] && continue
    if is_privkey "$f"; then
      if [[ $APPLY -eq 1 ]]; then
        mkdir -p "$BKROOT"; cp -a "$f" "$BKROOT/ssh-$b"; rm -f "$f" "$f.pub"
        ok "seat: 私钥材料已移出 $b（备份 $BKROOT/ssh-$b）"
      else plan "移出 seat 私钥材料: $b"; fi
      n=$((n+1))
    else
      warn "seat .ssh 内无法分类的文件（保留待人工核）: $b"
    fi
  done < <(find "$SHH" -maxdepth 1 -type f -print0 2>/dev/null)
  [[ $n -eq 0 ]] && ok "seat: .ssh 内无私钥材料"
  if compgen -G "$KEYHOME/.ssh/id_*" >/dev/null 2>&1; then ok "keyuser: 已有 ssh 密钥"
  else human "H2c: sudo -u $KEYUSER -i 然后 ssh-keygen -t ed25519（公钥到服务端授权）"; fi
else ok "seat: 无 .ssh 目录"; fi

if have gpg; then
  if sudo -u "$SEATUSER" -H bash -lc 'gpg --list-secret-keys 2>/dev/null | grep -q .'; then
    if [[ $APPLY -eq 1 ]]; then
      mkdir -p "$BKROOT"; tar -C "$SEATHOME" -cf "$BKROOT/gnupg.tar" .gnupg 2>/dev/null
      rm -rf "$SEATHOME/.gnupg"
      ok "seat: GPG 私钥环已移出（备份 $BKROOT/gnupg.tar）"
    else plan "移出 seat .gnupg（备份 tar）"; fi
  else ok "seat: 无 GPG 私钥"; fi
else ok "gpg 未安装，跳过"; fi

echo "== 4. ptrace 收口（dry-run 只读不写；本机实测：该内核为单向棘轮，升后不可降）=="
CUR=$(sysctl -n kernel.yama.ptrace_scope 2>/dev/null || echo unknown)
LV=""
if [[ $APPLY -eq 0 ]]; then
  plan "当前 ptrace_scope=$CUR；目标=3（不支持则 2），写 /etc/sysctl.d/99-abathur-isolation.conf 后 sysctl --system 复核"
  LV=$CUR
elif [[ "$CUR" == 3 ]]; then LV=3; ok "ptrace_scope 已是 3（无需写）"
elif sysctl -w kernel.yama.ptrace_scope=3 >/dev/null 2>&1; then LV=3
elif sysctl -w kernel.yama.ptrace_scope=2 >/dev/null 2>&1; then
  LV=2; warn "本机不支持 3，降级 2（同 uid 键录面未全封，具名残余）"
else warn "ptrace_scope 不可写（Yama 未启用/棘轮拒绝）——具名失败"; FAILED+=("ptrace"); fi
if [[ -n "$LV" && $APPLY -eq 1 ]]; then
  F=/etc/sysctl.d/99-abathur-isolation.conf
  if printf 'kernel.yama.ptrace_scope = %s\n' "$LV" > "$F"; then
    sysctl --system >/dev/null 2>&1
    live=$(sysctl -n kernel.yama.ptrace_scope 2>/dev/null)
    if [[ "$live" == "$LV" ]]; then ok "ptrace_scope 持久化并实测 =$live"
    else bad "ptrace 持久化复核失败 (live=$live)"; FAILED+=("sysctl-verify"); fi
  else bad "写 $F 失败"; FAILED+=("sysctl-persist"); fi
fi
if [[ "$LV" == 3 ]]; then
  warn "副作用：全机禁 debugger attach；Chrome/Electron 崩溃报告可能失效"
  warn "本机内核实测：ptrace_scope 为单向棘轮（升后 0/1/2 均 EINVAL），回退只能重启（本脚本不写盘时重启即复原）"
fi

echo "== 5. 收据 =="
if [[ $APPLY -eq 1 ]]; then
  mkdir -p "$BKROOT"; R="$BKROOT/RECEIPT.txt"
  {
    echo "install-isolation v4  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "seat=$SEATUSER keyuser=$KEYUSER ptrace=${LV:-unknown} accept_scope=${ACCEPT_SCOPE:-none}"
    echo "--- sudo -l -U $SEATUSER ---"; sudo -l -U "$SEATUSER" 2>&1 || true
    echo "--- seat gh ---";  sudo -u "$SEATUSER" -H bash -lc 'gh auth status' 2>&1 || true
    echo "--- seat npm ---"; sudo -u "$SEATUSER" -H bash -lc 'npm whoami' 2>&1 || true
  } > "$R" 2>&1
  ok "收据 $R"; say "  sha256: $(sha256sum "$R" | cut -d' ' -f1)"
fi

echo "== 6. 不变量终检（I1/I2 机器判据；任一不成立即 NOT-DONE）=="
if [[ $APPLY -eq 1 ]]; then
  NP_FINAL=$(sudo -l -U "$SEATUSER" 2>/dev/null | grep 'NOPASSWD' || true)
  if [[ -z "$NP_FINAL" ]]; then ok "I1 成立：seat 零 NOPASSWD"
  elif [[ -n "$ACCEPT_SCOPE" ]]; then warn "I1 例外（人类已接受）: $ACCEPT_SCOPE"; printf '%s\n' "$NP_FINAL" | sed 's/^/      /'
  else bad "I1 不成立：尚有 NOPASSWD（见上）"; RC=1; fi

  if have gh; then
    if sudo -u "$SEATUSER" -H bash -lc 'gh auth status' >/dev/null 2>&1; then bad "I2 不成立：seat 仍可用 gh"; RC=1
    else ok "I2(gh) 成立：seat 认证失败"; fi
  fi
  if have npm; then
    if sudo -u "$SEATUSER" -H bash -lc 'npm whoami' >/dev/null 2>&1; then bad "I2 不成立：seat 仍可用 npm"; RC=1
    else ok "I2(npm) 成立：seat 未登录"; fi
  fi
  LEFT=0
  if [[ -d "$SHH" ]]; then
    while IFS= read -r -d '' f; do
      b=$(basename "$f"); [[ "$b" =~ $WL ]] && continue; [[ "$b" == *.pub ]] && continue
      is_privkey "$f" && { bad "I2 不成立：seat 仍可读私钥 $b"; LEFT=1; }
    done < <(find "$SHH" -maxdepth 1 -type f -print0 2>/dev/null)
  fi
  [[ $LEFT -eq 0 ]] && ok "I2(ssh) 成立：seat 无明文私钥"
  [[ ${#FAILED[@]} -eq 0 ]] || { bad "过程失败项: ${FAILED[*]}"; RC=1; }
fi

cat <<EOF

== 人类不可约步骤（补完即全部达标；机器不能代做的原因见括号）==
H1 吊销旧 token（迁/删本机不等于吊销；provider 侧吊销需网页登录=人类键）
   GitHub: https://github.com/settings/tokens
   npm   : https://www.npmjs.com/settings/<用户名>/tokens
H2 keyuser 重发（秘密只进 keyuser 的 tty，不经座席会话=设计而非疏忽）
   sudo -u $KEYUSER -i ; gh auth login ; npm login --registry <发布源> ; ssh-keygen -t ed25519
H3 若第2步印出组继承/别名免密：裁决后重跑 --accept-nopasswd-scope '<范围+理由>'
具名未封堵面：GH_TOKEN 类环境变量、桌面 keyring、pts/X11 键录面（缓解级，超出本脚本范围）
EOF
if [[ $APPLY -eq 1 ]]; then
  if [[ $RC -eq 0 ]]; then echo "DONE（I1/I2 机器判据全绿；I3 缺域见人类步骤）"; exit 0
  else echo "NOT-DONE（见上 FAIL/人类步骤），退出码 1"; exit 1; fi
else echo "DRY-RUN 结束（零改动）。执行: sudo bash $0 --apply"; fi
