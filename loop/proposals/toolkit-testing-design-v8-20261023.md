# 设计 v8：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1(15)→v2(15)→v3(12)→v4(12,1A)→v5(10,1A)→v6(8,1A)→v7 5589 REJECT 1A/2R（**8 条**，机器计数=M3+B5+C0；CASPER APPROVE 三连并评『提案可加工性成立』）→ 本稿。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执

- AIHR 探测：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1af…。
- **AIHR acceptance 可达性实测**（2026-10-23，本席 /tmp 隔离 venv 实装实测，AIHR 树零写已验）：/home/lab/workspace/harness/Abathur/.omo/evidence/toolkit-probe/aihr-acceptance-reachability-20261023.txt，sha256=4d1d6bae6dea05c9db9e0187278023d48534d54465523f5b9d8243ab384e1003。事实：`hr --help` rc=0 输出含 'HR Agent'+'Commands' 块；`hr verdict --help` rc=0 含 'capability averages'；`hr db-dsn --help` rc=0；`hr --version` rc=2（负探针）。**weak_acceptance=false 在首考项目上可达**（≥2 枚高区分度 output-matching 探针+负探针组合）。
- bwrap 断网实测：--unshare-net 下 curl localhost:3000→rc=7；对照 rc=0。

## 结论状态机（单一来源）

五枚举：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。真值表（首命中生效）：

| # | 条件 | 结论 |
|---|---|---|
| 1 | 环境/基建失败、timeout、锚闸触发（树外 symlink/submodule 脏或未初始化/跨跑锚漂移/锚阶段失败禁回退）、**扫描闸 rc==2 或 rc==0 命中（另起器具伤单具名报警）或词元空集违规**、残留探测命中（皆同报保真底层信号） | UNVERIFIABLE |
| 2 | L0 冒烟失败 | FAIL |
| 3 | rc==5 或 collected==0 或 < min_tests | TRIVIAL-SUITE |
| 4 | L1 rc≠0（非 5） | FAIL |
| 5 | 双跑四元组不一致 | FAIL |
| 6 | acceptance 空集 | SELF-REPORT-ONLY |
| 7 | acceptance 任一未命中（含双跑逐项不一致） | FAIL |
| 8 | 全绿 | PASS |

扫描闸命中属器具自身违规：probe 结论 UNVERIFIABLE（不信任出自耦合器具的证据）+器具伤单；作为静态发布闸时=发布阻断。两解读均不放行。

## 六问裁断

### Q1 能力边界

L0+L1 强制、L2 可空。双跑五维谓词（同跑四元组+跨跑锚 tree-hash 漂移→UNVERIFIABLE；**锚语义=commit SHA 与 tree-hash 双值**，复算按 SHA checkout 复现禁裸 HEAD）；范围含 acceptance 逐项复跑；nondeterminism 只豁免输出哈希维；掩蔽计数入报告；规范化封闭列表=时间戳/E0 路径两枚。

### Q2 引擎面关系

独立器具 loop/toolkit_probe.py，零 import 引擎 src/；probe 登记 run_registry。被否两案同前。

### Q3 目标描述文件 schema

```jsonc
{
  "target":  { "repo": "/abs/path", "type": "python" },
  "install": { "cmd": "uv venv /work/v && uv pip install --python /work/v/bin/python /target", "env_class": "E0" },
  "suite":   { "cmd": "/work/v/bin/python -m pytest tests/ -x -q", "timeout_s": 1800, "min_tests": 1 },
  "acceptance": [
    { "id": "A1", "cmd": "/work/v/bin/hr --help", "expect": { "kind": "stdout-regex", "pattern": "HR Agent.*Commands" } },
    { "id": "A2", "cmd": "/work/v/bin/hr verdict --help", "expect": { "kind": "stdout-regex", "pattern": "capability averages" } },
    { "id": "A3", "cmd": "/work/v/bin/hr --version", "expect": { "kind": "rc", "value": 2 } }
  ],
  "limits":  { "net": "off", "wall_s": 2400, "rss_mb": 2048, "nproc": 64, "fsize_mb": 512 },
  "nondeterminism": []
}
```

- **expect schema 级定义**：`kind=rc`（值定死）或 `kind=stdout-regex`（pattern 区分度谓词：长度≥8 且命中封闭黑名单（`.*`、`^$`、纯字符类）即拒收）。**具名承认残余**：weak 旗标防数量不防语义质量，晋升门另设独立核验（盲重复算）。
- **修订锚**：对象库配方=临时主库+`GIT_ALTERNATE_OBJECT_DIRECTORIES=<repo>/.git/objects` 只读挂（alternates 原则可写之残余→fixture 验收含沙箱内对目标 objects 零写探测）；`-c core.fsmonitor=false -c core.hooksPath=/dev/null`；锚 git 阶段与套件同沙箱；审计复算=同沙箱规格+按记录的 commit SHA checkout 复现。**锚回执=commit SHA+tree-hash 双值入证据三件套**；锚阶段失败禁回退宿主 git（回退=UNVERIFIABLE）。
- **锚闸两枚**：①树外 symlink——**时序钉死：realpath 整链校验先于且紧邻 git add -A，add 后对索引全部路径复验；/target 只读挂载封堵闸后建目标写窗，残余竞态具名**；②submodule——foreach --recursive 同加固，脏/未初始化→UNVERIFIABLE。
- 信任级条款不变。

### Q4 证据与回执

复算三件套（锚 SHA+tree 双值/环境指纹/命令+rc+输出 sha256）+具名取舍（失败用例名集合入报告）。
**weak_acceptance 覆盖谓词**：weak=true 除非（output-matching 数≥2 且占 acceptance 总数≥50%）。**晋升门消费谓词设计层具名**（取消推迟）：消费工件=新器具 `loop/promotion-evidence-check.py`（实现战役首件交付；谓词位置=该校验脚本对晋升呈报材料中 toolkit-probe PASS 引用处的旗标读取），消费面清点三面=①晋升提名材料 ②考题 PASS 引用 ③对上汇报数字；PASS∧weak 一票否决证据资格。

### Q5 环境隔离（E0，首日钉死）

bwrap 白名单规格同 v6/v7：`--unshare-net --unshare-pid --die-with-parent --tmpfs /tmp --tmpfs /home --tmpfs /dev/shm --dev-bind /dev/{null,zero,urandom} 各一 --ro-bind <repo> /target --bind $E0 /work --setenv HOME /work/home --setenv TMPDIR /work/tmp`（E0 预建 /work/tmp）+`/usr /bin /sbin /lib /lib64 /etc` 只读。进程收尸=fixture②。资源帽四枚+df。残留探测七项。八通道具名缺口五枚。凭据：/home 遮蔽=挂载事实；E0 永不持键。

### Q6 落点与自考

夹具：①谎绿包 ②挂起包 ③越面写包 ④合成通用包（全闸含锚 tree-hash 产出实证）⑤短名合成夹具（basename<3+派生空集→UNVERIFIABLE；**补验被测方伪造 mandate 词元路径=拒收**）。行为考题族同前。

## 零硬耦合机械判据（三条）

1. 无描述文件可跑任意 repo（fixture④ 全闸）。
2. **词项扫描闸**：
   - 词元外置 .omo/toolkit-probe/gate-tokens.json；器具源码零词元；闸自扫无豁免。
   - 匹配语义：`grep -F -i`（逐字面+大小写折叠），环境钉 `LC_ALL=C`（非 ASCII 名大小写变形残余面具名）；rc==2→UNVERIFIABLE；rc==0=命中（状态机 #1+伤单）、rc==1=干净。
   - 扫描面封闭枚举（与器具分发 manifest 同源）：{src/, loop/, scripts/} 全文件（grep -I 排二进制）+仓根行为配置封闭列 {Makefile, Dockerfile, package.json, pyproject.toml, tsconfig.json, setup.py, setup.cfg}+无扩展名可执行文件；**完整性闭合判据：器具仓 `git ls-files` 全树枚举减豁免面必须逐文件 ⊆ 扫描集，缺项=UNVERIFIABLE**；豁免仅数据文档面（loop/proposals/、.omo/、fixtures 数据文件——fixtures 可执行脚本不豁免入扫）。
   - 动态词元派生：源=target.repo basename+各 cmd argv[0] basename；停用词表（同 v5）；词长<3 丢弃；**空集→mandate 必须显式供给项目词元，且供给源=机主显式条目（台账签署/机主令），禁止取自目标描述文件字段**；高频词碰撞只可加不可撤、具名呈裁。
3. 目标名只出现在四面：命令行参数、.omo 描述文件、台账条目、fixtures 数据文件（非可执行）。

## 附录 A–F

v1(15)→v2；v2(15)→v3；v3(12)→v4；v4(12)→v5；v5(10)→v6；v6(8)→v7（附录 F 八条逐条落点）。

## 附录 G：v7（5589）must_fix 8 条原文 → v8 落点

机器计数=M3+B5+C0（/home/lab/.sibyl/spaces/sibyl-20261023T135941Z-5589/ 三席 JSON 解析）。

MELCHIOR（3）：
1. 「状态机为扫描闸 rc==0（命中）定义 fail-closed 归属（并入#1 或具名独立态），静态发布闸/运行时复检两种解读下均不得静默放行」→ 状态机 #1 补 rc==0 命中+器具伤单+发布阻断
2. 「设计层即具名 weak_acceptance 晋升门消费工件（文件+谓词位置）并清点其余消费面（汇报层/考题材料），取消『首段再钉』推迟」→ Q4 消费工件 loop/promotion-evidence-check.py+三面清点
3. 「定死 mandate 项目词元供给源=机主显式条目，禁止取自目标描述文件字段，并在 fixture⑤ 补验『被测方伪造 mandate』路径」→ 判据 2 供给源钉死+fixture⑤ 补验

BALTHASAR（5）：
4. 「钉死『output-matching 探针』的 schema 级定义（期望输出断言的最小结构…），并给出可机械判定的反『低质输出匹配』谓词或具名承认 weak 旗标只防数量不防质量且晋升门另设独立核验」→ Q3 expect schema+区分度谓词+具名残余+晋升门独立核验
5. 「规定 symlink 闸解析时序：realpath 校验必须先于且紧邻 git add -A，或 add 阶段对全部路径复验；具名禁止『闸后建外部目标再 add』的竞态（含沙箱内只读挂载面说明）」→ Q3 锚闸①时序
6. 「扫描闸补 manifest 完整性闭合判据：git ls-files（或等价全树枚举）减去豁免面必须逐文件 ⊆ 扫描集，缺项=UNVERIFIABLE…」→ 判据 2 完整性闭合判据
7. 「锚回执必须记录 commit SHA 与 tree-hash 双值入证据三件套，审计复算按 SHA 检出对应树复现，禁止裸 HEAD 复算；跨跑锚漂移条款同步引用该 SHA 语义」→ Q3 锚回执双值+Q1 锚语义
8. 「在接地层补一条机器回执：当场枚举 AIHR acceptance 命令数与 output-matching 数，证明 weak_acceptance=false 在测试项目上可达（或具名接受 AIHR 首考恒 weak…）」→ 接地节可达性实测（4d1d6bae…，weak=false 可达）

## 待裁（留机主）

1. net_install=on 根除案。圈一。2. bwrap bind 清单 fixture 阶段微调。圈一。3. 实现体量=一档战役，批准后排 PLAN-SEG。
