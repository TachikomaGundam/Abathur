# 设计 v4：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1 ea09 REJECT（15 条）→ v2 5a4d REJECT（15 条）→ v3 7d6a REJECT（**12 条**，机器计数=M5+B5+C2：MELCHIOR.md JSON 解析=5、BALTHASAR.md must_fix 列表=5、CASPER 票体自述 two must-fix items=2；逐条原文见附录 C）→ 本稿。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执（落盘工件，可复算）

- AIHR 探测：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1aff97016552f9d4cd2e8988dde08708b62d79a51d04178dc125edae975（aihr 0.6.8、tests/、scripts/test.sh、HEAD=52a8c0e）。
- bwrap 断网实测（2026-10-23）：`bwrap --unshare-net --ro-bind / / --dev-bind /dev /dev -- curl --max-time 3 http://localhost:3000` → http_code=000 rc=7；对照 `-- true` rc=0。/usr/bin/bwrap 在机。注：该实测仅为断网能力证据，首日挂载规格以下文 Q5 白名单形态为准。

## 结论状态机（单一来源，Q1/Q3/Q4 同引本节）

结论态=**五枚举**：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。
真值表（自上而下首命中生效，穷尽互斥论证见表后）：

| # | 条件 | 结论 |
|---|---|---|
| 1 | 环境/基建失败、任一步 timeout、残留探测命中（残留命中时**同报保真底层 L0/L1 实测信号**，防裁决洗白） | UNVERIFIABLE |
| 2 | L0 冒烟失败（装不上/加载失败/版本不符） | FAIL |
| 3 | 套件 rc==5（pytest 无用例）或 collected==0 或 collected < mandate.min_tests | TRIVIAL-SUITE |
| 4 | L1 套件 rc≠0（非 rc==5） | FAIL |
| 5 | 双跑结果不一致 | FAIL |
| 6 | acceptance 为空集 | SELF-REPORT-ONLY |
| 7 | acceptance 存在任一未命中 | FAIL |
| 8 | acceptance 全部命中 | PASS |

穷尽互斥：判定轴=(env 完整性, L0, collected 平凡性, L1 rc, 双跑, acceptance 三况空/全中/有未中)。env 失败先入 #1；余下 L0 败=#2、平凡=#3（先于 rc 判定，rc==5 是 pytest 空套件专属码）、rc 败=#4、双跑不一致=#5；全绿后 acceptance 三况穷尽于 #6/#7/#8。无未定义组合。

## 六问裁断

### Q1 能力边界：L0+L1 强制、L2 可空、空集落 SELF-REPORT-ONLY

L0 冒烟；L1 套件裁决（rc+collected 计数+失败清单+**双跑一致性**）；L2=mandate acceptance 探针。裁决权威三选：目标自述仅作 DATA；PASS 必须有 acceptance 命中；无/少测试=TRIVIAL-SUITE 具名出口（机械谓词见状态机 #3）。被否：a) 纯 exit0=PASS=合规空转攻击面；b) 纯能力探针=逐目标手写非最小闭环；c) 首日模糊/性能基线=过度建设。

### Q2 引擎面关系：独立器具 loop/toolkit_probe.py，零 import 引擎 src/

被否「包装临时 genome」：死因=graders/scoring 可信执行面入不受信输入 + 污染晋升谱系（L-ENGINE-ISOLATION）。被否「引擎新子命令」：死因=冻结发布面被测试需求牵动。probe 运行登记 run_registry（role=probe，与 candidate/judge 同簿；status 为建议性快照、start 登记为事实源、检查与登记间残窗为具名残留风险）。

### Q3 目标描述文件 schema

```jsonc
{
  "target":  { "repo": "/abs/path", "type": "python" },
  "install": { "cmd": "uv venv && uv pip install .", "env_class": "E0" },
  "suite":   { "cmd": "uv run pytest tests/ -x -q", "timeout_s": 1800, "min_tests": 1 },
  "acceptance": [ { "id": "A1", "cmd": "uv run hr --version", "expect": "rc=0" } ],
  "limits":  { "net": "off", "wall_s": 2400, "rss_mb": 2048, "nproc": 64, "fsize_mb": 512 }
}
```

- **修订锚谓词（单一定死）**：anchor = 临时索引法树哈希：`GIT_INDEX_FILE=$(mktemp)` → `git read-tree HEAD` → `git add -A -f` → `git write-tree`。`-f` 强制收 gitignored 文件（.gitignore 面对锚无遮蔽力，此边界具名声明）；**边界具名**：submodule 内部内容不入树哈希，锚料追加 `git submodule status` 原样行。**树外 symlink 检测**：write-tree 前 `find -type l` 逐枚解析 realpath，指向树外者 → 结论 UNVERIFIABLE（不解析入锚，防双跑间换靶欺骗）。
- 信任级条款：凡从目标元数据自动派生的命令=不受信输入，执行前 fail-closed 呈委托方确认。

### Q4 证据与回执

五态见状态机节。复算三件套：①修订锚（write-tree+submodule 行）②环境指纹（OS/kernel/解释器/安装器版本实测）③命令+rc+输出 sha256（**输出原文留在 E0 内、跑后即弃，证据面只留哈希与 rc**）。报告工件落 .omo/evidence/toolkit-probe/<target>-<ts>/；结论落 INTENT-LEDGER（stamp.sh 协议，[line:abathur]，E0 派生条目带 evidence_class=E0-DATA）。写者=执行座席。

### Q5 环境隔离（E0 机械规格，首日钉死）

- 执行面=E0：**每跑独立 fresh E0**（mktemp，双跑=两次各自重装，无状态泄漏通道）。
- **bwrap 首日挂载规格（白名单制，非全树暴露）**：
  `bwrap --unshare-net --unshare-pid --die-with-parent --dev-bind /dev /dev --proc /proc --tmpfs /tmp --tmpfs /home --ro-bind <目标repo> /target --bind $E0_DIR /work --setenv HOME /work/home --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /sbin /sbin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc -- <cmd>`
  /home 整树遮蔽（fake HOME 不再冒充挂载隔离）；/usr、/etc 等只读入沙箱供解释器运行。`--unshare-pid --die-with-parent`+timeout=进程收尸保证（挂起包 daemonize 后随 bwrap 死；fixture③ 验收含『timeout 后宿主 ps 探测零残留进程』）。
- 网络默认 off；安装需网=mandate 具名 `net_install=on` 例外窗口。**具名残留风险**：net_install=on 窗口内 stdout/网络通道仍可外带，收窄案（装后立即关网+输出只留哈希）已部分缓释，根除案留待裁 1。
- 资源帽四枚：wall（timeout）、rss/nproc/fsize（ulimit）+跑前后 df 差额兜底。
- **残留探测封闭清单**（跑前基线↔跑后 diff，命中=#1 UNVERIFIABLE 且保真同报底层信号）：①`crontab -l` ②`systemctl --user list-units --all` ③shell rc（~/.bashrc ~/.profile ~/.bash_profile）mtime+sha256 ④真实 HOME 顶层 mtime 扫描 ⑤目标工作区树 mtime 扫描（`find -newer <基线戳>`）⑥E0 目录树清单。
- **八通道对齐具名缺口**（L-ENV-SEGREGATION 安装者枚举八项中，首日不在探测面的五通道，逐名登记为 day-one 缺口，不谎称闭合）：DB 存储执行、队列消费、wiki 渲染执行、文件监视事件触发、进程间消息总线。
- 凭据：E0 永不持键；/home 遮蔽后 ~/.config/~/.ssh 在沙箱内不可读（挂载事实，非 $HOME 语义）。

### Q6 落点与自考

- 落点：`loop/toolkit_probe.py` + `loop/toolkit-fixtures/` + 描述文件放 .omo 数据面。
- 自考对抗夹具：①谎绿包 ②挂起包（验 timeout→UNVERIFIABLE 且宿主零残留进程）③越面写包（验残留探测报警且保真同报）④**第二个合成通用包**（零硬耦合实证面）。
- 行为考题：bank.py 新题族（TRIVIAL-SUITE 说成 PASS=可杀面），注册轮换义务。

## 零硬耦合机械判据（三条）

1. 无目标描述文件可跑：任意 repo 完整出结论（演练=fixture④）。
2. 词项扫描闸（器具自检内置）：`grep -rniE '<词元>' --include='*.py' --include='*.ts' --include='*.js' --include='*.sh' --include='*.json' --include='*.jsonc' --include='*.toml' --include='*.yaml' src/ loop/` 零命中。词元=静态 `aihr|harness/hr` + **动态词元：从当前目标描述文件 scripts 字段逐词派生**（`\b` 词界、大小写不敏感）。数据文档面（loop/proposals/、.omo/、loop/toolkit-fixtures/）显式路径豁免，豁免登记入台账。
3. 目标名只出现在：命令行参数、.omo 描述文件、台账条目。

## 附录 A：v1（ea09）15 条 → v2 落点

（与 v3 稿附录 A 逐字相同：M4+B6+C5=15，来源 /home/lab/.sibyl/spaces/sibyl-20261023T130907Z-ea09/ 三席文件；映射：六问裁断节、Q5、接地回执、Q2 被否①②、零硬耦合判据、Q3 信任级、Q1 权威三选、Q4 复算三件套、Q6 夹具与考题族。）

## 附录 B：v2（5a4d）15 条 → v3/v4 落点

M1 对账矛盾→附录 A 嵌入（v3）；M2 net 机制→Q5 bwrap（v3）；M3 磁盘帽→Q5 fsize+df（v3）；M4 扫描闸大小写→判据 2（v3）；M5 状态机第五态→状态机节（v3）。B6 单一来源→状态机节（v3）；B7 残留封闭清单→Q5 六项（v3，v4 再扩八通道缺口登记）；B8 net 落地→Q5（v3）；B9 修订锚 write-tree→Q3（v3，v4 补 -f/submodule/symlink）；B10 fresh-E0+互斥语义→Q1/Q2（v3）；B11 闸补强+第二夹具→判据 2+fixture④（v3；其中『项目脚本名词元』子项 v3 未收，v4 以动态词元派生收齐，见附录 C 第 12 条）；C12 逐条引用→附录 A（v3）；C13 白名单+豁免→判据 2（v3）；C14 TRIVIAL 机械谓词→状态机 #3（v3）；C15 接地落盘→接地节（v3）。

## 附录 C：v3（7d6a）must_fix 12 条原文 → v4 落点

机器计数=M5+B5+C2。来源：/home/lab/.sibyl/spaces/sibyl-20261023T132720Z-7d6a/（MELCHIOR.md JSON 解析=5；BALTHASAR.md must_fix 列表=5；CASPER 票体自述 two must-fix items，其原文自 consult 聚合输出转录）。

MELCHIOR（5）：
1. 「Add the missing truth-table row (L0+L1 green + acceptance non-empty + any miss) with a named state…」→ 状态机 #7
2. 「Fix row precedence so collected==0/pytest rc=5 yields TRIVIAL-SUITE not FAIL…」→ 状态机 #3 先于 #4
3. 「Narrow or qualify the write-tree claim: gitignored untracked files and submodules are outside the anchor, or add an explicit --ignored capture policy」→ Q3 锚：`-f` 收 ignored+submodule 边界具名
4. 「Align the residual-detection closed list with the L-ENV-SEGREGATION eight-channel installer enumeration or register each uncovered channel as a named day-one gap」→ Q5 八通道具名缺口（五通道登记）
5. 「Register the full-root-read + net_install=on exfiltration hazard as an explicit risk inside pending item 2's option set…」→ Q5 具名残留风险+待裁 1 选项集

BALTHASAR（5）：
6. 「真值表补全并证明穷尽互斥…对 (env, L0, L1, collected, acceptance) 全组合逐格落行」→ 状态机八行+穷尽论证
7. 「凭据面定死首日规格：bwrap 首日以 --tmpfs/掩码挂载遮蔽 /home/*…不得以 fake HOME 冒充挂载隔离」→ Q5 首日白名单挂载规格（--tmpfs /home）
8. 「锚谓词补树外引用处理…symlink 逃逸检测（树外链接即 UNVERIFIABLE 或解析后入锚），并具名声明 .gitignore 面对锚的边界」→ Q3 树外 symlink→UNVERIFIABLE+.gitignore 边界声明
9. 「运行规格钉死进程收尸：bwrap 加 --unshare-pid --die-with-parent…挂起包 fixture 验收含『timeout 后宿主无残留进程』探测」→ Q5 收尸规格+fixture②验收
10. 「扫描闸白名单补 .json/.jsonc/.toml/.yaml…配置是执行面输入…」→ 判据 2 白名单四类

CASPER（2）：
11. 「状态机真值表补行『L0+L1 全绿且 acceptance 未全部命中 → FAIL』（或具名态）…逐行核对五态×acceptance 三况（空/全中/有未中）穷尽」→ 状态机 #6/#7/#8 三况穷尽
12. 「判据2 扫描闸补脚本名词元（hr 一类，或从目标描述文件 scripts 字段自动派生词元入闸），大小写不敏感保留…」→ 判据 2 动态词元派生

## 待裁（留机主）

1. net_install=on 窗口根除案（预装依赖镜像 vs 具名窗口+输出哈希化）。圈一。
2. bwrap 白名单挂载首日规格的精确 bind 清单在 fixture 阶段实测微调（偏差超语义再报）。圈一。
3. 实现体量=器具+夹具+考题一档战役，批准后排 PLAN-SEG。
