# 设计 v6：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1(15)→v2(15)→v3(12)→v4(12,1A)→v5 deb9 REJECT 1A/2R（**10 条**，机器计数=M5+B5+C0；CASPER APPROVE 评『Shippable as-is』）→ 本稿。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执

- AIHR 探测：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1aff97016552f9d4cd2e8988dde08708b62d79a51d04178dc125edae975。
- bwrap 断网实测（2026-10-23）：--unshare-net 下 curl localhost:3000→rc=7；对照 rc=0。/usr/bin/bwrap 在机。

## 结论状态机（单一来源）

五枚举：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。真值表（首命中生效）：

| # | 条件 | 结论 |
|---|---|---|
| 1 | 环境/基建失败、timeout、锚闸触发（树外 symlink/submodule 脏或未初始化/跨跑锚漂移）、扫描闸 rc==2 或词元空集违规、残留探测命中（皆同报保真底层信号） | UNVERIFIABLE |
| 2 | L0 冒烟失败 | FAIL |
| 3 | rc==5 或 collected==0 或 < min_tests | TRIVIAL-SUITE |
| 4 | L1 rc≠0（非 5） | FAIL |
| 5 | 双跑四元组不一致（rc/collected/失败集/规范化输出哈希任一异） | FAIL |
| 6 | acceptance 空集 | SELF-REPORT-ONLY |
| 7 | acceptance 任一未命中（含双跑逐项不一致） | FAIL |
| 8 | 全绿 | PASS |

## 六问裁断

### Q1 能力边界

L0+L1 强制、L2 可空。**双跑谓词（五维定死）**：同跑内比对四元组=(rc, collected, 失败用例标识排序集, 规范化输出哈希)；跨跑锚 tree-hash 漂移→UNVERIFIABLE（入状态机 #1）。**范围含 acceptance 逐项复跑一致**。**nondeterminism 字段只许豁免输出哈希维**；rc/collected/失败集三维禁豁免。**规范化掩蔽计数**（原文异而规范化后同的对数）入报告。规范化封闭列表=ISO-8601 时间戳/E0 路径占位——hex 掩蔽规则撤销（v5 评审具名绕过：差异可编码进 hex 串伪一致），只留两枚。

### Q2 引擎面关系

独立器具 loop/toolkit_probe.py，零 import 引擎 src/。probe 登记 run_registry（role=probe）。被否两案同前。

### Q3 目标描述文件 schema

字段同 v5（target/install/suite/acceptance/limits/nondeterminism）。

- **修订锚（对目标零写+敌意加固）**：全部锚 git 调用固定参数 `-c core.fsmonitor=false -c core.hooksPath=/dev/null`；`GIT_OBJECT_DIRECTORY=$(mktemp -d)`+`GIT_INDEX_FILE=$(mktemp)` → read-tree HEAD → add -A -f → write-tree。**锚 git 阶段与套件同处 Q5 bwrap 沙箱内执行**（filter.<n>.clean 类不可枚举执行面被沙箱收编）；**审计方复算环境=同一沙箱规格**（写入规格，禁宿主裸跑 git 复算）。
- **锚闸两枚（同级 fail-closed→UNVERIFIABLE）**：①树外 symlink；②submodule：`git submodule foreach --recursive git status --porcelain`（同加固参数）任一非空→UNVERIFIABLE；**未初始化 submodule 或 .gitmodules 在而工作树缺=UNVERIFIABLE**（具名处置）。
- 信任级条款不变。

### Q4 证据与回执

复算三件套+具名取舍（失败用例名集合入报告，stdout 全文弃）同 v5。
**acceptance 强度旗标升级**：报告逐项标 rc-only/output-matching；`weak_acceptance=true`（output-matching==0）时——**PASS∧weak_acceptance 不得充当晋升证据：晋升门谓词消费该旗标（考题/晋升材料引用本器具 PASS 时旗标=true 一票否决其证据资格）**，不止台账披露。

### Q5 环境隔离（E0，首日钉死）

bwrap 白名单规格同 v5（--tmpfs /home、--tmpfs /dev/shm、/dev 三字符设备、--unshare-net --unshare-pid --die-with-parent、/target 只读、/work 可写）。进程收尸验收=fixture②。资源帽四枚+df。残留探测七项清单（含 /dev/shm）。八通道具名缺口五枚（DB 存储执行/队列消费/wiki 渲染执行/文件监视触发/进程间消息总线）。凭据：/home 遮蔽=挂载事实；E0 永不持键。

### Q6 落点与自考

夹具编号全局唯一：①谎绿包（FAIL+weak 旗标）②挂起包（timeout→UNVERIFIABLE+宿主零残留进程）③越面写包（残留报警+保真同报）④合成通用包（零耦合实证走全闸）⑤**短名合成夹具**（basename<3 且派生空集→闸判 UNVERIFIABLE 的实证）。行为考题族同前。

## 零硬耦合机械判据（三条）

1. 无描述文件可跑任意 repo（fixture④ 走全闸）。
2. **词项扫描闸**：
   - 词元外置 .omo/toolkit-probe/gate-tokens.json；器具源码零词元；闸自扫无豁免（豁免仅数据文档面：loop/proposals/、.omo/、loop/toolkit-fixtures/）。
   - **匹配语义定死**：逐字面 `grep -F`（或等价元字符转义）；**rc==2（模式/IO 错）→UNVERIFIABLE**；rc==0=命中、rc==1=零命中，rc≠0 禁视为干净。
   - **扫描面封闭枚举**（废扩展名白名单）：{src/, loop/, scripts/} 全文件（`grep -I` 排除二进制）+仓根无扩展名可执行面（Makefile/Dockerfile 类显式入列）。
   - **动态词元派生**：源=target.repo basename+install.cmd/suite.cmd/acceptance[].cmd 的 argv[0] basename；停用词表={uv,run,pip,python,python3,pytest,bash,sh,node,npm,npx,cd,echo,cat,install,test,tests,curl,git}；词长<3 丢弃；**空集/短名条款：派生集为空→mandate 必须显式供给项目词元，否则闸判 UNVERIFIABLE（fail-closed）**；器具源码高频词碰撞处置=只可加词元不可撤词元，碰撞时具名呈委托方裁。
3. 目标名只出现在：命令行参数、.omo 描述文件、台账条目。

## 附录 A–D

v1 15 条→v2；v2 15 条→v3（B11 词元子项迟至 v5 收齐）；v3 12 条→v4；v4 12 条→v5。其中附录 D 对 v4-M2（submodule 换靶面）的『闭合』措辞如实化（v5 评审 M5）：**submodule 同级闸+双跑锚哈希比对（v6 #1 跨跑锚漂移）两机制同时成立后，方称防换靶闭合**。

## 附录 E：v5（deb9）must_fix 10 条原文 → v6 落点

机器计数=M5+B5+C0（/home/lab/.sibyl/spaces/sibyl-20261023T134812Z-deb9/；CASPER APPROVE 零 must_fix）。

MELCHIOR（5）：
1. 「Q3 锚谓词全部 git 调用固定敌意加固：-c core.fsmonitor=false、-c core.hooksPath=/dev/null…锚 git 阶段与套件同处 bwrap 沙箱内执行且复算路径同样入沙箱；复算执行环境写入规格」→ Q3 锚加固段
2. 「双跑一致性比对扩展为五元组或增独立谓词：两跑锚 write-tree 哈希必须相等，不等→UNVERIFIABLE，状态机 #5 相应改写」→ Q1 跨跑锚漂移→UNVERIFIABLE（状态机 #1）
3. 「submodule 锚闸改 git submodule foreach --recursive 并同步加固参数；未初始化子模块与 .gitmodules 面处置具名」→ Q3 锚闸②
4. 「动态词元派生补空集/短名条款…mandate 必须显式供给项目词元，否则闸判 UNVERIFIABLE（fail-closed），并在 fixture④ 之外增一条短名合成夹具实证」→ 判据 2 空集条款+fixture⑤
5. 「附录 D 对 M2 的『闭合』声称改为如实：submodule 同级闸+双跑锚哈希比对同时成立后方称防换靶闭合」→ 附录 A-D 节如实化措辞

BALTHASAR（5）：
6. 「派生词元入闸前逐字面匹配（grep -F 或元字符转义），并定义 grep rc=2→UNVERIFIABLE，禁止 rc≠0 视为干净」→ 判据 2 匹配语义
7. 「扫描面改为器具全部随包分发/执行路径的封闭枚举+全文件扫描（排除二进制），废除扩展名白名单或显式补无扩展名可执行面」→ 判据 2 扫描面封闭枚举
8. 「双跑谓词补三钉：rc/collected/失败集三维不得被 nondeterminism 豁免；规范化掩蔽差异计数入报告；修订锚 tree-hash 纳入双跑比对，跨跑树漂移→UNVERIFIABLE」→ Q1 三钉（含 hex 掩蔽规则撤销——同条评审另具名绕过面，一并修）
9. 「定死双跑范围含 acceptance 逐项复跑一致」→ Q1 范围钉
10. 「PASS∧weak_acceptance 不得充当晋升证据：晋升门谓词消费该旗标，不得仅靠台账披露」→ Q4 旗标升级

## 待裁（留机主）

1. net_install=on 根除案。圈一。2. bwrap bind 清单 fixture 阶段微调。圈一。3. 实现体量=一档战役，批准后排 PLAN-SEG。
