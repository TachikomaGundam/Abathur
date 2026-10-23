# 设计 v9（定稿）：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1(15)→v2(15)→v3(12)→v4(12,1A)→v5(10,1A)→v6(8,1A)→v7(8,1A)→**v8 sibyl-20261023T141401Z-90a0 APPROVE 2A/1R**（少数席 must_fix 5 条，机器计数见附录 H）→ 本稿=吸收少数席 5 条的定稿。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执

- AIHR 探测：.omo/evidence/toolkit-probe/aihr-grounding-20261023.txt，sha256=6a6cd1af…。
- AIHR acceptance 可达性实测：.omo/evidence/toolkit-probe/aihr-acceptance-reachability-20261023.txt，sha256=4d1d6bae6dea05c9db9e0187278023d48534d54465523f5b9d8243ab384e1003（/tmp 隔离 venv 实测，AIHR 树零写已验；hr --help/verdict --help/db-dsn --help rc=0 含高区分度字面，--version rc=2 负探针；weak_acceptance=false 可达）。
- bwrap 断网实测：--unshare-net 下 curl localhost:3000→rc=7；对照 rc=0。
（路径前缀省略处均为 /home/lab/workspace/harness/Abathur/。）

## 结论状态机（单一来源）

五枚举：`PASS / SELF-REPORT-ONLY / FAIL / TRIVIAL-SUITE / UNVERIFIABLE`。真值表（首命中生效）：

| # | 条件 | 结论 |
|---|---|---|
| 1 | 环境/基建失败、timeout、锚闸触发（树外 symlink/submodule 脏或未初始化/跨跑锚漂移/锚失败禁回退/审计对象缺失）、扫描闸 rc==2/rc==0 命中（+器具伤单）/词元空集违规/词元文件失配、残留探测命中（皆同报保真底层信号） | UNVERIFIABLE |
| 2 | L0 冒烟失败 | FAIL |
| 3 | rc==5 或 collected==0 或 < min_tests | TRIVIAL-SUITE |
| 4 | L1 rc≠0（非 5） | FAIL |
| 5 | 双跑四元组不一致 | FAIL |
| 6 | acceptance 空集 | SELF-REPORT-ONLY |
| 7 | acceptance 任一未命中（含双跑逐项不一致） | FAIL |
| 8 | 全绿 | PASS |

## 六问裁断

### Q1 能力边界

L0+L1 强制、L2 可空。双跑五维谓词（同跑四元组=(rc, collected, 失败用例标识排序集, 规范化输出哈希)；跨跑锚 tree-hash 漂移→UNVERIFIABLE）；范围含 acceptance 逐项复跑；nondeterminism 只豁免输出哈希维；掩蔽计数入报告；规范化封闭列表=时间戳/E0 路径两枚。

### Q2 引擎面关系

独立器具 loop/toolkit_probe.py，零 import 引擎 src/；probe 登记 run_registry。被否两案同前。

### Q3 目标描述文件 schema

字段同 v8（target/install/suite/acceptance/limits/nondeterminism）。
- **expect schema**：`kind=rc`（值定死）或 `kind=stdout-regex`。**区分度谓词（二义已修）**：①黑名单=**全等匹配**（模式串全等于封闭黑名单成员 {`.*`, `.+`, `^$`, `^.*$`} 即拒收；含 `.*` 片段不拒——v8 自例 A1 合规）；②随机对照串测试：pattern 对器具内置固定随机对照串集任一命中→拒收。
- **修订锚**：临时主库+`GIT_ALTERNATE_OBJECT_DIRECTORIES` 只读挂+`-c core.fsmonitor=false -c core.hooksPath=/dev/null`；锚阶段与套件同沙箱；**锚回执=commit SHA+tree-hash 双值**+**`git bundle` 把 pin SHA 对象打包入证据三件套**（防 probe 后目标历史重写/gc 致复算不可能；审计时对象缺失=UNVERIFIABLE）；审计复算=同沙箱规格+按 SHA checkout；锚失败禁回退宿主 git。
- **锚闸两枚**：①树外 symlink——realpath 整链校验先于且紧邻 git add -A、add 后索引全路径复验、/target 只读封闸后写窗、残余竞态具名；②submodule foreach --recursive 同加固，脏/未初始化→UNVERIFIABLE。
- 信任级条款不变。

### Q4 证据与回执

复算三件套（锚 SHA+tree 双值+bundle/环境指纹/命令+rc+输出 sha256/**词元文件 sha256**）+具名取舍。
**weak_acceptance**：weak=true 除非（output-matching≥2 且占比≥50%）；具名残余=防数量不防语义质量。**晋升门消费谓词**：工件=loop/promotion-evidence-check.py（实现战役首件交付），消费面三面=晋升提名材料/考题 PASS 引用/对上汇报数字；PASS∧weak 一票否决证据资格；晋升门复算『动态派生∪机主 mandate』与词元文件逐字节比对，失配=UNVERIFIABLE。

### Q5 环境隔离（E0，首日钉死）

bwrap 白名单规格（--unshare-net --unshare-pid --die-with-parent --tmpfs /tmp /home /dev/shm、/dev 三字符设备、/target 只读、/work 可写、TMPDIR=/work/tmp、/usr /bin /sbin /lib /lib64 /etc 只读）。进程收尸=fixture②。资源帽四枚+df。残留探测七项。八通道具名缺口五枚。凭据：/home 遮蔽=挂载事实；E0 永不持键。

### Q6 落点与自考

夹具：①谎绿包 ②挂起包 ③越面写包 ④合成通用包（全闸含锚 tree-hash 产出+目标 objects 零写探测实证）⑤短名合成夹具（派生空集→UNVERIFIABLE+伪造 mandate 词元拒收实证）。行为考题族同前。

## 零硬耦合机械判据（三条）

1. 无描述文件可跑任意 repo（fixture④ 全闸）。
2. **词项扫描闸**：词元外置 gate-tokens.json（sha256 入证据三件套，晋升门逐字节复算）；器具源码零词元；闸自扫无豁免。匹配语义=`grep -F -i`+`LC_ALL=C`；rc==2→UNVERIFIABLE。扫描面封闭枚举（与分发 manifest 同源）：{src/, loop/, scripts/} 全文件+仓根行为配置封闭列+无扩展名可执行文件；**扫描集定义=实际被扫文件集；`git ls-files` 减豁免面 ⊆ 扫描集，ls-files 内被判二进制而跳过的文件计缺项→UNVERIFIABLE**；豁免仅数据文档面（fixtures 可执行脚本不豁免）。动态词元派生=basename+argv[0] basename+停用词表+词长<3 丢弃；**空集→mandate 显式供给，供给源=机主显式条目，禁取自目标描述文件**。**具名残余**：分段拼接/hex/base64 编码/unicode 同形字绕过面明文承认，晋升门盲复算审读兜底。
3. 目标名只出现在四面：命令行参数、.omo 描述文件、台账条目、fixtures 数据文件（非可执行）。

## 附录 A–G

v1(15)→v2；v2(15)→v3；v3(12)→v4；v4(12)→v5；v5(10)→v6；v6(8)→v7；v7(8)→v8。逐条映射见各代附录（v8 稿附录 G=v7 八条）。

## 附录 H：v8（90a0，APPROVE 2A/1R）少数席 must_fix 5 条原文 → v9 落点

来源 /home/lab/.sibyl/spaces/sibyl-20261023T141401Z-90a0/（聚合输出 5 条）。

1. 「expect黑名单语义二义+自例冲突：A1『HR Agent.*Commands』含.*…改为：模式命中一组固定随机对照串即拒收，并钉死黑名单为全等匹配」→ Q3 区分度谓词①②
2. 「词元供给源完整性：…词元文件sha256入证据三件套；晋升门复算『动态派生∪机主mandate』与文件逐字节比对，失配=UNVERIFIABLE」→ 判据 2+Q4 三件套+晋升门复算
3. 「二进制排除漏洞：NUL字节使grep -I静默跳过…扫描目录内被判二进制的ls-files文件计缺项=UNVERIFIABLE，或以-a全扫；『扫描集』定义为实际被扫文件集」→ 判据 2 扫描集定义+二进制缺项判负
4. 「锚可复算性对目标历史重写不设防…锚阶段git bundle被pin SHA对象入证据三件套；审计时对象缺失具名判UNVERIFIABLE」→ Q3 bundle 入三件套
5. 「逐字匹配残余未具名：…分段拼接、hex/base64编码、unicode同形字。要求：在具名承认节明文列入残余并指派晋升门盲复算审读兜底…」→ 判据 2 具名残余

## 待裁（留机主）

1. net_install=on 根除案。圈一。2. bwrap bind 清单 fixture 阶段微调。圈一。3. 实现体量=一档战役（器具+promotion-evidence-check+五夹具+考题族），批准后排 PLAN-SEG。
