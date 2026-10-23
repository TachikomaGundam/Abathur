# 设计 v3：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1 委托书 sibyl-20261023T130907Z-ea09 REJECT 0A/3R（must_fix **15 条**，机器计数=MELCHIOR 4+BALTHASAR 6+CASPER 5，逐条原文见附录 A）→ v2 sibyl-20261023T131610Z-5a4d REJECT 0A/3R（must_fix **15 条**，M5+B6+C4，原文见附录 B）→ 本稿。更正：v2 谱系段『九条』系凭记忆误写（球面记录=15），此处具名勘误。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执（落盘工件，可复算）

- AIHR 探测工件：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1aff97016552f9d4cd2e8988dde08708b62d79a51d04178dc125edae975（内容：pyproject project.name=aihr version=0.6.8 scripts=[hr]、tests/ 目录、scripts/test.sh、HEAD=52a8c0e）。
- bwrap 断网实测（2026-10-23T21:2x+08:00）：`bwrap --unshare-net --ro-bind / / --dev-bind /dev /dev -- curl -s --max-time 3 http://localhost:3000` → http_code=000、rc=7（连接失败，localhost 共享服务同被隔离）；`bwrap --unshare-net … -- true` rc=0。二进制 /usr/bin/bwrap 在机。

## 结论状态机（单一来源，Q1/Q3/Q4 同引本节）

结论态=**五枚举**：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。
真值表（自上而下首个命中生效）：

| 条件 | 结论 |
|---|---|
| 环境/基建失败、任一步 timeout、残留探测命中 | UNVERIFIABLE |
| L0 冒烟失败（装不上/加载失败/版本不符） | FAIL |
| L1 套件 rc≠0 或双跑不一致 | FAIL |
| L1 套件 collected==0 或 < mandate 声明的 min_tests | TRIVIAL-SUITE |
| L0+L1 全绿且 acceptance 为空集 | SELF-REPORT-ONLY |
| L0+L1 全绿且 acceptance 全部命中 | PASS |

timeout=UNVERIFIABLE（不是 FAIL）；TRIVIAL-SUITE 谓词=机械计数（collected 数/min_tests 阈值），无人判入口。

## 六问裁断

### Q1 能力边界：L0+L1 强制、L2（acceptance）可空、空集落 SELF-REPORT-ONLY

L0 冒烟（安装/导入/CLI/版本一致性）；L1 套件裁决（rc+用例计数+失败清单+**双跑一致性**）；L2=mandate 验收探针。裁决权威三选：目标自述仅作 DATA；PASS 必须有 mandate acceptance 命中；目标无/少测试=TRIVIAL-SUITE 具名出口。被否：a) 纯目标套件 exit0=PASS——死因=合规空转攻击面；b) 纯能力探针——死因=逐目标手写定义，非最小闭环；c) 首日加模糊/性能基线——死因=过度建设。

### Q2 与引擎面关系：独立座席器具 loop/toolkit_probe.py，零 import 引擎 src/

被否「包装临时 genome」：死因=①graders/scoring 是引擎可信执行面，不受信第三方描述不得入；②污染 campaign/晋升谱系（L-ENGINE-ISOLATION）。被否「引擎新子命令」：死因=冻结发布面被测试需求牵动。probe 运行也登记 run_registry（role=probe，与 candidate/judge 同簿）。

### Q3 目标描述文件 schema（零硬耦合承载面）

```jsonc
{
  "target":  { "repo": "/abs/path", "type": "python" },
  "install": { "cmd": "uv venv && uv pip install .", "env_class": "E0" },
  "suite":   { "cmd": "uv run pytest tests/ -x -q", "timeout_s": 1800, "min_tests": 1 },
  "acceptance": [ { "id": "A1", "cmd": "uv run hr --version", "expect": "rc=0" } ],
  "limits":  { "net": "off", "wall_s": 2400, "rss_mb": 2048, "nproc": 64, "fsize_mb": 512 }
}
```

- 修订锚谓词（单一定死）：`anchor=git write-tree 树哈希`——临时索引法（`GIT_INDEX_FILE=$(mktemp)` → `git read-tree HEAD` → `git add -A` → `git write-tree`），覆盖脏树与未跟踪文件；HEAD sha 仅作附属信息，不作锚。工作树脏不脏同一路径。
- 信任级条款：凡从目标元数据自动派生的命令=不受信输入，执行前 fail-closed 呈委托方确认；器具不得自动派生执行命令。

### Q4 证据与回执

五态见状态机节。复算三件套：①修订锚（write-tree 树哈希）②环境指纹（OS/kernel/解释器/安装器版本实测）③命令+rc+输出 sha256。报告工件落 .omo/evidence/toolkit-probe/<target>-<ts>/，结论落 INTENT-LEDGER（stamp.sh 协议，[line:abathur]，E0 派生条目带 evidence_class=E0-DATA 标注）。写者=执行座席。

### Q5 环境隔离（E0 机械规格，全部接地）

- 执行面=E0：mktemp 工作目录+fake HOME（考场先例）；**每跑独立 fresh E0**（双跑=两次各自重装，无状态泄漏通道）。
- 网络：`net=off` 的强制机制=`bwrap --unshare-net` 包裹 install/suite/acceptance 三步（实测断 localhost 共享服务，回执见接地节）；安装期需网=mandate 具名 `net_install=on` 例外，默认关。
- 资源帽四枚：wall（timeout）、rss/nproc/fsize（ulimit）——fsize 即磁盘帽，外加跑前后 `df` 差额探测兜底。
- 残留探测封闭清单（跑前快照基线↔跑后 diff，任一命中=UNVERIFIABLE-ENV+具名报警）：①`crontab -l` ②`systemctl --user list-units --all` ③shell rc 文件（~/.bashrc ~/.profile ~/.bash_profile）mtime+哈希 ④真实 HOME 顶层 mtime 扫描 ⑤目标工作区树 mtime 扫描（`find -newer <基线戳>`）⑥E0 目录树清单。声明：同 uid 无 FS 强制隔离首日不谎称闭合——残留探测是检测面，bwrap 挂载面（--tmpfs/--ro-bind 收窄）列为 v3 落地时工程项。
- 凭据：fake HOME 不挂真 ~/.config；E0 永不持键。

### Q6 落点与自考

- 落点：`loop/toolkit_probe.py`（器具）+ `loop/toolkit-fixtures/`（自考夹具）+ 描述文件放 .omo 数据面。
- 自考对抗夹具三件套：①谎绿包 ②挂起包（验 timeout→UNVERIFIABLE）③越面写包（验残留探测报警）——另加④**第二个合成通用包**（证明同一器具路径对非 AIHR 目标通用，零硬耦合实证面）。
- 行为考题：bank.py 新题族（压力下把 TRIVIAL-SUITE 说成 PASS=可杀面），注册轮换义务。

## 零硬耦合机械判据（三条）

1. 无目标描述文件可跑：器具对命令行给定的任意 repo 完整出结论（演练=合成通用包 fixture④）。
2. 词项扫描闸（器具自检内置）：`grep -rniE 'aihr|harness/hr' --include='*.py' --include='*.ts' --include='*.js' --include='*.sh' src/ loop/` 零命中——大小写不敏感、代码文件白名单、数据文档面（loop/proposals/、.omo/、loop/toolkit-fixtures/ 登记清单）走显式路径豁免，豁免条目入闸配置并在台账登记。
3. 目标名只出现在：命令行参数、.omo 描述文件、台账条目。

## 附录 A：v1（ea09）must_fix 15 条原文 → v2 落点映射

机器计数来源：/home/lab/.sibyl/spaces/sibyl-20261023T130907Z-ea09/{MELCHIOR,BALTHASAR,CASPER}.md 内 must_fix 数组（4+6+5=15）。

MELCHIOR（4）：
1. 「deliver the six answers in the artifact itself…」→ v2 六问裁断节（Q1-Q6 全答）
2. 「expand question 5…E0 disposable runner, scrubbed credentials, egress/border policy, timeout and resource caps」→ v2 Q5
3. 「attach machine receipts…for the AIHR grounding claims」→ v2 接地回执节（v3 已改落盘工件）
4. 「add to question 2…genome-lineage isolation…」→ v2 Q2 被否①②

BALTHASAR（6）：
5. 「委托书补硬耦合的机械判据…项目名词项扫描闸…」→ v2 零硬耦合机械判据节
6. 「Q3 增加信任级条款…」→ v2 Q3 信任级条款
7. 「Q1/Q4 定义裁决权威三选…目标自述不得作唯一 PASS 依据」→ v2 Q1
8. 「Q5 给出 E0 机械规格…」→ v2 Q5
9. 「Q2 被否方案必须含『包装成临时 genome』案及其安全死因…」→ v2 Q2
10. 「Q4 补复算三件套字段…Q6 具名三类对抗夹具…」→ v2 Q4/Q6

CASPER（5）：
11. 「Produce the actual deliverable…」→ 同 1
12. 「Define the target-description schema minimum fields…with AIHR as pure config input」→ v2 Q3 schema 例
13. 「Map evidence states…to the INTENT-LEDGER entry format…who writes the receipt」→ v2 Q4
14. 「Align the sandbox execution plan with L-ENV-SEGREGATION…」→ v2 Q5
15. 「Add the self-test answer…canary」→ v2 Q6 行为考题族

## 附录 B：v2（5a4d）must_fix 15 条原文 → v3 落点映射

机器计数来源：/home/lab/.sibyl/spaces/sibyl-20261023T131610Z-5a4d/ 三席文件（5+6+4=15）。

MELCHIOR（5）：
1. 「对账9条vs15条矛盾：嵌入v1 must_fix逐条原文，与v2落点1:1登记映射…」→ 本稿谱系更正+附录 A
2. 「给net=off可执行机制（netns/代理阻断/localhost阻断封闭枚举）…」→ Q5 bwrap --unshare-net（接地实测）
3. 「limits补磁盘帽（fsize或跑前后df差额探测）…」→ Q5 资源帽四枚
4. 「扫描闸改大小写不敏感并覆盖小写aihr与路径别名；fixtures豁免用显式路径白名单…」→ 判据 2
5. 「状态模型定义SELF-REPORT-ONLY：第五态或具名修饰符，附四态×L2空集交互真值表」→ 状态机节（第五态+真值表）

BALTHASAR（6）：
6. 「结论态集合单一来源闭合…Q1/Q3/Q4 同引一份状态枚举」→ 状态机节（单一来源声明）
7. 「残留探测面扩为封闭清单：crontab、systemd-user、shell rc、真实HOME与工作区树mtime…」→ Q5 残留探测六项清单
8. 「net 强制机制落到实现（测试阶段 unshare -n 或 bwrap netns…）」→ Q5（同 2）
9. 「目标修订锚谓词收紧…git write-tree 类…二选一定死」→ Q3 修订锚谓词
10. 「双跑定义 fresh-E0-per-run…run_registry 原子登记并写明 probe 与 campaign 互斥/并发语义」→ Q1 双跑（fresh E0）+Q2（probe 同簿登记）；互斥语义：status 是建议性快照、start 登记是事实源、抢跑残窗具名残留风险
11. 「零耦合闸补强：扫描改大小写不敏感并纳入项目脚本名词元，另用第二个合成夹具包…9对15计数更正…」→ 判据 2+fixture④+附录 A

CASPER（4）：
12. 「逐条列出v1判词ea09的must_fix原文与编号…无逐条引用不得称『全部吸收』」→ 附录 A
13. 「修判据2闸面：grep改为代码文件白名单…loop/proposals等数据文档面写入豁免登记条目…」→ 判据 2
14. 「TRIVIAL-SUITE给封闭机械谓词（如collected==0或低于mandate阈值）…」→ 状态机节+Q3 min_tests
15. 「AIHR接地探测输出落盘为.omo/evidence下绝对路径工件，替换会话记录m00086锚」→ 接地回执节

## 待裁（留机主）

1. 安装期联网例外形态（net_install=on 具名窗口 vs 预装依赖镜像）。圈一。
2. bwrap 挂载面收窄（--tmpfs/--ro-bind）是否首日落地，或先 detection-only。圈一。
3. 实现体量=器具+夹具+考题一档战役，批准后排 PLAN-SEG。
