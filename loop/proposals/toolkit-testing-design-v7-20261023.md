# 设计 v7：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1(15)→v2(15)→v3(12)→v4(12,1A)→v5(10,1A)→v6 32bb REJECT 1A/2R（**8 条**，机器计数=M3+B5+C0；CASPER 连续第二轮 APPROVE）→ 本稿。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执

- AIHR 探测：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1aff97016552f9d4cd2e8988dde08708b62d79a51d04178dc125edae975。
- bwrap 断网实测（2026-10-23）：--unshare-net 下 curl localhost:3000→rc=7；对照 rc=0。/usr/bin/bwrap 在机。

## 结论状态机（单一来源）

五枚举：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。真值表（首命中生效）：

| # | 条件 | 结论 |
|---|---|---|
| 1 | 环境/基建失败、timeout、锚闸触发（树外 symlink 整链解析出树/submodule 脏或未初始化/跨跑锚漂移/锚阶段失败——**含禁回退宿主 git**）、扫描闸 rc==2 或词元空集违规、残留探测命中（皆同报保真底层信号） | UNVERIFIABLE |
| 2 | L0 冒烟失败 | FAIL |
| 3 | rc==5 或 collected==0 或 < min_tests | TRIVIAL-SUITE |
| 4 | L1 rc≠0（非 5） | FAIL |
| 5 | 双跑四元组不一致 | FAIL |
| 6 | acceptance 空集 | SELF-REPORT-ONLY |
| 7 | acceptance 任一未命中（含双跑逐项不一致） | FAIL |
| 8 | 全绿 | PASS |

## 六问裁断

### Q1 能力边界

L0+L1 强制、L2 可空。**双跑五维谓词**：同跑四元组=(rc, collected, 失败用例标识排序集, 规范化输出哈希)；跨跑锚 tree-hash 漂移→UNVERIFIABLE（#1）；**范围含 acceptance 逐项复跑一致**；**nondeterminism 只许豁免输出哈希维**（rc/collected/失败集三维禁豁免）；**规范化掩蔽计数入报告**；规范化封闭列表=ISO-8601 时间戳/E0 路径两枚（hex 掩蔽已撤销）。

### Q2 引擎面关系

独立器具 loop/toolkit_probe.py，零 import 引擎 src/；probe 登记 run_registry（role=probe）。被否两案同前。

### Q3 目标描述文件 schema

字段同 v5。**修订锚（零写+敌意加固+可解析）**：
- 对象库配方：`GIT_OBJECT_DIRECTORY=$(mktemp -d)`（主库，落新 blob）+ `GIT_ALTERNATE_OBJECT_DIRECTORIES=<repo>/.git/objects`（**只读挂目标对象库**，read-tree 可解析 HEAD 既有对象；纯替换配方读不到 HEAD 已实证为 v6 缺陷）；`GIT_INDEX_FILE=$(mktemp)`；read-tree HEAD → add -A -f → write-tree。fixture④ 实证干净仓可产 tree-hash。
- 加固：全部锚 git 调用固定 `-c core.fsmonitor=false -c core.hooksPath=/dev/null`；**锚 git 阶段与套件同处 Q5 沙箱内执行**；审计方复算环境=同一沙箱规格（写入规格）。**锚阶段任何失败禁止回退宿主 git——回退即 UNVERIFIABLE**。
- 锚闸两枚（同级 fail-closed）：①树外 symlink——**解析语义定死：realpath 整链解析（链式逐环、目录软链解析终目标、dangling 即触发），终目标出树→UNVERIFIABLE**；②submodule——`git submodule foreach --recursive git status --porcelain`（同加固）任一非空→UNVERIFIABLE；未初始化/.gitmodules 在而工作树缺→UNVERIFIABLE。
- 信任级条款不变。

### Q4 证据与回执

复算三件套+具名取舍（失败用例名集合入报告，stdout 全文弃）。
**weak_acceptance 覆盖谓词（数值定死）**：weak_acceptance=true 除非（output-matching 探针数≥2 **且** 占 acceptance 总数≥50%）；单枚 echo 级探针买不回资格。**PASS∧weak_acceptance 不得充当晋升证据：晋升门谓词消费该旗标**（考题/晋升材料引用本器具 PASS 时旗标=true 一票否决其证据资格；谓词落点工件在实现战役首段 PLAN-SEG 钉死）。

### Q5 环境隔离（E0，首日钉死）

bwrap 白名单规格同 v5，**补 `--setenv TMPDIR /work/tmp` 且 E0 内预建 /work/tmp**（锚/安装/套件的 mktemp 全部落在已钉可写路径；沙箱内 mktemp 不可写=规格缺陷已修）。进程收尸=fixture②。资源帽四枚+df。残留探测七项。八通道具名缺口五枚。凭据：/home 遮蔽=挂载事实；E0 永不持键。

### Q6 落点与自考

夹具：①谎绿包 ②挂起包（timeout→UNVERIFIABLE+零残留进程）③越面写包 ④合成通用包（**走全闸含锚 tree-hash 产出实证**）⑤短名合成夹具（basename<3+派生空集→闸判 UNVERIFIABLE 实证）。行为考题族同前。

## 零硬耦合机械判据（三条）

1. 无描述文件可跑任意 repo（fixture④ 全闸）。
2. **词项扫描闸**：
   - 词元外置 .omo/toolkit-probe/gate-tokens.json；器具源码零词元；闸自扫无豁免。
   - **匹配语义定死**：`grep -F -i`（逐字面+大小写折叠）；rc==2→UNVERIFIABLE；rc==0=命中、rc==1=零命中。
   - **扫描面封闭枚举**（与器具分发 manifest 同源单一来源）：{src/, loop/, scripts/} 全文件（grep -I 排二进制）+ 仓根行为配置封闭列 {Makefile, Dockerfile, package.json, pyproject.toml, tsconfig.json, setup.py, setup.cfg} + 无扩展名可执行文件；**豁免仅数据文档面**（loop/proposals/、.omo/）——**fixtures 拆两面：可执行脚本不豁免入扫，数据文件豁免**。
   - **动态词元派生**：源=target.repo basename+install/suite/acceptance cmd 的 argv[0] basename；停用词表={uv,run,pip,python,python3,pytest,bash,sh,node,npm,npx,cd,echo,cat,install,test,tests,curl,git}；词长<3 丢弃；**空集→mandate 必须显式供给项目词元，否则闸判 UNVERIFIABLE**；高频词碰撞只可加不可撤、具名呈裁。
3. 目标名只出现在四面：命令行参数、.omo 描述文件、台账条目、**fixtures 数据文件（非可执行）**。

## 附录 A–E

v1(15)→v2；v2(15)→v3（B11 子项 v5 收齐）；v3(12)→v4；v4(12)→v5；v5(10)→v6（附录 E 十条逐条落点，M2『闭合』措辞如实化=两机制同立方称防换靶闭合）。

## 附录 F：v6（32bb）must_fix 8 条原文 → v7 落点

机器计数=M3+B5+C0（/home/lab/.sibyl/spaces/sibyl-20261023T135418Z-32bb/ 三席文件 JSON 解析）。

MELCHIOR（3）：
1. 「判据2匹配语义只定死区分大小写的 grep -F：派生词元与源码字面量大小写不同即互相逃逸…必须补 case-fold 匹配（grep -F -i 或词元集含大小写变体入闸）…」→ 判据 2 `grep -F -i`
2. 「扫描面枚举 {src/,loop/,scripts/}+仓根无扩展名可执行面遗漏随包分发的带扩展名行为配置（package.json/pyproject.toml/tsconfig 类）…未达 B7『全部随包分发/执行路径』原文，封闭枚举须显式覆盖全部行为配置面」→ 判据 2 扫描面补行为配置封闭列+manifest 同源
3. 「Q3 锚用 GIT_OBJECT_DIRECTORY=$(mktemp -d)/GIT_INDEX_FILE=$(mktemp) 而 Q5 沙箱规格…未钉 /tmp 或 TMPDIR；沙箱内 mktemp 若不可写则锚阶段确定性失败→全 probe 恒 UNVERIFIABLE，规格须具名 TMPDIR 指向已钉可写路径并入 fixture④ 全闸实证」→ Q5 TMPDIR 钉死+fixture④

BALTHASAR（5）：
4. 「扫描闸定死大小写语义：grep -Fi 或逐词元大小写变体入闸，否则大小写变形绕过零耦合判据」→ 判据 2 `grep -F -i`（与 1 同条两席同点）
5. 「锚对象库配方改为 mktemp 主库+GIT_ALTERNATE_OBJECT_DIRECTORIES 只读挂目标 objects，并以 fixture 实证干净仓可产出 tree-hash；禁止失败回退宿主 git（回退=UNVERIFIABLE）」→ Q3 对象库配方+禁回退+fixture④
6. 「对账判据3 与夹具豁免：fixtures 拆数据文件与可执行脚本两面，可执行脚本不豁免入扫；数据文件出现目标名须写入判据3 允许面或由闸禁止，二选一」→ 判据 2 豁免拆面+判据 3 允许面第四面
7. 「weak_acceptance 升级为覆盖谓词：output-matching 用例占比/最低枚数数值定死，禁单枚 echo 级测试放行晋升证据」→ Q4 覆盖谓词（≥2 且 ≥50%）
8. 「symlink/submodule 闸谓词补解析语义：整链 realpath 出树（含 dangling 与目录软链）即触发，链式 symlink 不得出闸」→ Q3 锚闸①解析语义

## 待裁（留机主）

1. net_install=on 根除案。圈一。2. bwrap bind 清单 fixture 阶段微调。圈一。3. 实现体量=一档战役，批准后排 PLAN-SEG。
