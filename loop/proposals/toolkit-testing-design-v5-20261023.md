# 设计 v5：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1 ea09 REJECT（15）→ v2 5a4d REJECT（15）→ v3 7d6a REJECT（12）→ v4 bee8 REJECT 1A/2R（**12 条**，机器计数=M2+B6+C4，逐条原文见附录 D；CASPER 已投 APPROVE 附 4 条改进项）→ 本稿。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执（落盘工件，可复算）

- AIHR 探测：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1aff97016552f9d4cd2e8988dde08708b62d79a51d04178dc125edae975。
- bwrap 断网实测（2026-10-23）：`--unshare-net` 下 curl localhost:3000 → http_code=000 rc=7；对照 rc=0。/usr/bin/bwrap 在机。

## 结论状态机（单一来源，Q1/Q3/Q4 同引本节）

五枚举：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。真值表（自上而下首命中生效）：

| # | 条件 | 结论 |
|---|---|---|
| 1 | 环境/基建失败、timeout、锚阶段触发 fail-closed（树外 symlink/submodule 脏）、残留探测命中（同报保真底层 L0/L1 信号） | UNVERIFIABLE |
| 2 | L0 冒烟失败 | FAIL |
| 3 | 套件 rc==5 或 collected==0 或 collected < mandate.min_tests | TRIVIAL-SUITE |
| 4 | L1 套件 rc≠0（非 rc==5） | FAIL |
| 5 | 双跑不一致（谓词见 Q1） | FAIL |
| 6 | acceptance 为空集 | SELF-REPORT-ONLY |
| 7 | acceptance 存在任一未命中 | FAIL |
| 8 | acceptance 全部命中 | PASS |

穷尽互斥：判定轴=(env, 锚, L0, 平凡性, rc, 双跑, acceptance 三况)，#1 收 env/锚/残留，#2–#5 收执行面，#6/#7/#8 穷尽 acceptance 三况。无未定义组合。

## 六问裁断

### Q1 能力边界

L0 冒烟；L1 套件（rc+collected+失败用例名集合+双跑一致性）；L2 acceptance 可空。裁决权威三选不变（目标自述=DATA；PASS 须 acceptance 命中；平凡=TIRIVIAL-SUITE 出口）。被否三案同前。
**双跑一致性谓词（定死）**：比对四元组=(rc, collected 计数, 失败用例标识排序集合, 规范化输出哈希)。规范化封闭列表：ISO-8601 时间戳→占位符、E0/tmp 绝对路径→占位符、≥8 位十六进制串→占位符；列表外良性非确定性须由 mandate `nondeterminism` 字段具名声明，未声明的不一致=FAIL。只比 rc（留同 rc 异输出洗白面）与逐字节比（误杀面）皆禁。

### Q2 引擎面关系

独立器具 loop/toolkit_probe.py，零 import 引擎 src/。被否「包装 genome」（可信执行面入不受信输入+污染晋升谱系）与「引擎子命令」（冻结发布面被牵动）。probe 登记 run_registry（role=probe；status 建议性快照、start 登记事实源、检查-登记残窗具名残留风险）。

### Q3 目标描述文件 schema

```jsonc
{
  "target":  { "repo": "/abs/path", "type": "python" },
  "install": { "cmd": "uv venv && uv pip install .", "env_class": "E0" },
  "suite":   { "cmd": "uv run pytest tests/ -x -q", "timeout_s": 1800, "min_tests": 1 },
  "acceptance": [ { "id": "A1", "cmd": "uv run hr --version", "expect": "rc=0" } ],
  "limits":  { "net": "off", "wall_s": 2400, "rss_mb": 2048, "nproc": 64, "fsize_mb": 512 },
  "nondeterminism": []
}
```

- **修订锚谓词（单一定死，对目标零写）**：临时对象库+临时索引：`GIT_OBJECT_DIRECTORY=$(mktemp -d)` + `GIT_INDEX_FILE=$(mktemp)` → `git read-tree HEAD` → `git add -A -f` → `git write-tree`。blob 全落临时对象库，目标 .git/objects 零写（防恶意仓 gitignored 巨型工件塞爆对象库）。`-f` 收 gitignored（.gitignore 无遮蔽力，边界具名）。
- **fail-closed 锚闸两枚**（同级）：①树外 symlink——`find -type l` 逐枚 realpath，出树→UNVERIFIABLE；②submodule 脏——`git submodule foreach git status --porcelain` 任一非空→UNVERIFIABLE（与 symlink 同级 fail-closed，双跑防换靶闭合）。
- 信任级条款：自动派生命令=不受信输入，执行前 fail-closed 呈确认。

### Q4 证据与回执

五态见状态机节。复算三件套：修订锚（write-tree+锚闸记录）/环境指纹/命令+rc+输出 sha256。**具名取舍**（v4 评审缺陷 3 吸收）：stdout 全文随 E0 弃（秘密外带面优先），但 **L1 失败用例名集合与 acceptance 逐项结果入报告**（非全文，盲审可重读结论依据）；复算=重跑非重读，具名接受。
**acceptance 强度机械旗标**：报告逐项标注探针类型（rc-only / output-matching），汇总 `weak_acceptance=true` 当 output-matching 数==0；PASS 携带该旗标时报告与台账条目必须显式带旗标（防谎绿包弱验收洗白）。
落点同前（.omo 工件+INTENT-LEDGER，[line:abathur]，E0 派生带 E0-DATA 标注）。写者=执行座席。

### Q5 环境隔离（E0 机械规格，首日钉死）

- fresh E0 per run；**bwrap 白名单挂载规格**：
  `bwrap --unshare-net --unshare-pid --die-with-parent --proc /proc --tmpfs /tmp --tmpfs /home --tmpfs /dev/shm --dev-bind /dev/null /dev/null --dev-bind /dev/zero /dev/zero --dev-bind /dev/urandom /dev/urandom --ro-bind <目标repo> /target --bind $E0_DIR /work --setenv HOME /work/home --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /sbin /sbin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc -- <cmd>`
  变更点：不再 `--dev-bind /dev /dev`（宿主 /dev/shm 跨跑串台通道封堵），/dev 只放三个必需字符设备+`--tmpfs /dev/shm`。
- 进程收尸：`--unshare-pid --die-with-parent`+timeout；fixture② 验收=timeout 后宿主 ps 探测零残留进程。
- 网络默认 off；`net_install=on` 具名窗口+输出哈希化缓释，根除案待裁 1。
- 资源帽四枚+df 兜底。
- **残留探测封闭清单七项**：①crontab -l ②systemctl --user list-units --all ③shell rc mtime+sha256 ④真实 HOME 顶层 mtime ⑤目标工作区树 mtime（find -newer）⑥E0 树清单 ⑦**/dev/shm 清单**（封堵面入探测双保险）。
- **八通道具名缺口**（首日不谎称闭合）：DB 存储执行、队列消费、wiki 渲染执行、文件监视事件触发、进程间消息总线。
- 凭据：/home 遮蔽=挂载事实；E0 永不持键。

### Q6 落点与自考

- 落点：loop/toolkit_probe.py + loop/toolkit-fixtures/ + .omo 数据面。
- 自考夹具（编号全局唯一）：①谎绿包（验 FAIL+weak_acceptance 旗标）②挂起包（验 timeout→UNVERIFIABLE+宿主零残留进程）③越面写包（验残留探测报警+保真同报）④合成通用包（零硬耦合实证，完整走扫描闸）。
- 行为考题：bank.py 新题族（TRIVIAL-SUITE 说成 PASS=可杀面）。

## 零硬耦合机械判据（三条）

1. 无描述文件可跑任意 repo（演练=fixture④ 全走闸）。
2. **词项扫描闸（器具自检内置，词元全部外置）**：`grep -rniE '<词元>' --include='*.py' --include='*.ts' --include='*.js' --include='*.sh' --include='*.json' --include='*.jsonc' --include='*.toml' --include='*.yaml' src/ loop/` 零命中。
   - **词元外置**：静态词元存数据文件 .omo/toolkit-probe/gate-tokens.json；器具源码零词元字面值（源码含词元=自命中，故外置）；**闸自扫无豁免**——豁免登记只覆盖数据文档面（loop/proposals/、.omo/、loop/toolkit-fixtures/），器具源码永不可豁免。
   - **动态词元派生算法（定死）**：源字段=target.repo 的 basename + install.cmd/suite.cmd/acceptance[].cmd 各命令的 argv[0] basename；停用词封闭表={uv,run,pip,python,python3,pytest,bash,sh,node,npm,npx,cd,echo,cat,install,test,tests,curl,git}；词长<3 丢弃；mandate 可显式追加词元。派生词以 `\b` 词界大小写不敏感入闸。
3. 目标名只出现在：命令行参数、.omo 描述文件、台账条目。

## 附录 A/B：v1/v2 → 落点

同 v3 稿（v1 15 条全收于 v2；v2 15 条全收于 v3，唯 B11『脚本名词元』子项迟至 v5 由动态词元派生收齐——v3/v4 期间该子项状态具名：部分吸收，原因=派生算法未定义，见附录 D 第 10/11 条）。

## 附录 C：v3（7d6a）12 条 → v4 落点

同 v4 稿附录 C（状态机 #7、#3 先于 #4、锚 -f+submodule+symlink、八通道缺口、待裁选项集、白名单挂载、收尸、闸白名单四类、动态词元）。其中第 12 条动态词元在 v4 被再判机制未定义，v5 收齐（判据 2 派生算法）。

## 附录 D：v4（bee8）must_fix 12 条原文 → v5 落点

机器计数=M2+B6+C4（来源 /home/lab/.sibyl/spaces/sibyl-20261023T134043Z-bee8/：MELCHIOR.md JSON=2、BALTHASAR.md JSON=6、CASPER.md=4 票为 APPROVE 附改进项）。

MELCHIOR（2）：
1. 「判据2给出可机械执行的动态词元派生算法：定义源字段…提取规则…词界与误杀处理…并对fixture④完整走通闸」→ 判据 2 派生算法+fixture④ 走闸
2. 「闭合双跑锚的submodule面…submodule status含脏标记…即UNVERIFIABLE，或…升为与symlink同级的fail-closed谓词」→ Q3 锚闸②（submodule 脏=UNVERIFIABLE，同级）

BALTHASAR（6）：
3. 「Q3 锚谓词 git add -A -f 会把 blob 对象写进目标仓 .git/objects…必须 GIT_OBJECT_DIRECTORY/临时对象库重定向，锚对目标零写」→ Q3 临时对象库
4. 「Q5 --dev-bind /dev /dev 把宿主共享的 /dev/shm 带入沙箱…须 --tmpfs /dev/shm 或把 shm 探测入封闭清单」→ Q5 规格 --tmpfs /dev/shm+残留清单第⑦项（双保险）
5. 「判据2 扫描闸自身源码含静态词元 aihr|harness/hr 必自命中…词元须外置数据源或闸源自扫有独立防豁免机制，豁免登记不可覆盖器具源码」→ 判据 2 词元外置+闸自扫无豁免
6. 「判据2 动态词元引用的 scripts 字段在 Q3 schema 中不存在…切词规则、停用词表、uv/run/pytest 类通用词误杀未定义」→ 判据 2 派生算法（源字段=实有 cmd 字段+停用词表）
7. 「真值表 #5 双跑『结果不一致』谓词空心：比对字段…与良性非确定性…规范化未定义」→ Q1 双跑谓词（四元组+规范化封闭列表+mandate nondeterminism 字段）
8. 「PASS 质量=f(acceptance 质量) 不受闸…报告面须附 acceptance 强度机械旗标（输出匹配数 vs 纯 rc 数）」→ Q4 weak_acceptance 旗标

CASPER（4，APPROVE 附改进项）：
9. 「Bind dynamic token derivation to the actual Q3 schema: the cited 'scripts field' does not exist there…」→ 同 6
10. 「Add a closed stop-list or project-specific selection policy for derived tokens: naive word-by-word derivation injects uv/run/pip/install/pytest…」→ 判据 2 停用词封闭表+argv[0]-only 提取
11. 「Fix scanner self-hit: the static token 'aihr' lives inside the scanner's own source under loop/…specify explicit self-exclusion or runtime-composed tokens」→ 判据 2 词元外置数据文件
12. 「Correct the Q5/Q6 cross-reference: Q5 attaches the hang-package zero-residual acceptance to fixture-3 while Q6 numbers it fixture-2…」→ Q5/Q6 编号统一（挂起包=fixture②）

## 待裁（留机主）

1. net_install=on 根除案（预装镜像 vs 具名窗口+输出哈希化）。圈一。
2. bwrap 精确 bind 清单在 fixture 阶段实测微调。圈一。
3. 实现体量=一档战役，批准后排 PLAN-SEG。
