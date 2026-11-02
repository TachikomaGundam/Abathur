# 晋升审计：G4（首次晋升）到 G83（2026-11-03）

审计人：阿巴瑟席。对象：宪章记载的 **33 次晋升**。本文第四版。前两版判 REJECT（`sibyl-20261102T195208Z-3701` 0A/3R、`sibyl-20261102T200253Z-b053` 1A/2R），驳点处置见第九、十节；第三版仍被 `sibyl-20261102T201047Z-46d3` 判 1A/2R（该轮确认第九、十节十条已落实，仅余四条），第四条处置见第十一节。

## 一、能证什么，不能证什么

能证（机器可复算）：归档内 bundle 的判决字段；证据镜像是否与台账钉值一致；提交血缘与 tag 包含关系；外部锚链对 `AGENTS.md` 与台账尾哈希的整点背书。

不能证：

- `.omo/evidence/loop-archive/**` 不在 git、不在锚链覆盖内，任何同 uid 进程可改写而不留痕。因此「今天读到的 bundle = 判卷当时的内容」对 2026-11-02 之前的批次**无法证明**。
- 「谁写的」只能到身份字符串层。

## 二、判定四类（严格按定义使用）

| 类 | 定义 | 计 |
|---|---|---|
| VERIFIED | 归档在 + 镜像已钉且复算一致 + 批准件可读回 | **0** |
| APPROVAL-ONLY | 归档在 + 批准件可读回，但镜像未钉（漂移不可保） | 3 |
| ARCHIVE-ONLY | 归档在、字段自洽，无镜像钉、无批准件 | 24 |
| UNVERIFIABLE-AT-DISK | 归档不存在，只剩宪章文字 | 6 |

合计 33。**没有任何一代达到严格 VERIFIED**——这是本节要说明的事实，不是修辞。

## 三、33 次晋升的判定

来源：`python3 scripts/promotion-inventory.py` 的 `promoted_gens()`（按宪章「晋升条款」标题行解析并展开区间；本日修正了漏抓 G23/G24/G25 与区间端点只取首尾的缺陷）。

| 代 | 归档实测 | 类 |
|---|---|---|
| G4 / G9 / G10 / G11 / G21 / G22 | 目录 MISSING（G22R 是 2026-10-01 灾变后的重跑件，非原件） | UNVERIFIABLE-AT-DISK（6） |
| G23 / G24 / G25 | 在 | ARCHIVE-ONLY |
| G26 / G27 / G28 / G29 / G30 / G31 / G32 | 在 | ARCHIVE-ONLY |
| G34 / G35 / G36B / G37 / G38 / G39 / G40 | 在 | ARCHIVE-ONLY |
| G42 / G43 / G44 / G45 | 在 | ARCHIVE-ONLY |
| G59 / G62 / G65 | 在 | ARCHIVE-ONLY |
| G67 / G68 / G72 | 在，且 `APPROVAL.md` 可读回 | APPROVAL-ONLY（3） |
| G22R（替代重跑件，非 G22） | 在 | SUBSTITUTE-RERUN：能证「2026-10-02 应人类令重建」，不能证 G22 原件 |

**G73–G83（11 代）不属晋升集**：逐目录 `ls` 实测无 `APPROVAL.md`、无 `NOMINATION.md`（11/11 命中 0）；其中 G80/G81/G82 虽有 CONVERGED 票面，从未有人批准。它们不参与本审计的晋升结论，其镜像未钉的事实另列于 F3。

## 四、三项具体发现

### F1 六代晋升没有任何磁盘证据

`G4 G9 G10 G11 G21 G22` 在 `loop-archive/` 下无目录。它们的「通过」只存在于宪章文字。G22 于 2026-10-01 主树灾变中丢失，之后以 G22R 重跑重建——那是新的判卷，不是原件复原。

处理：记为 UNVERIFIABLE-AT-DISK。不撤销已生效条款（人类权限），但此后不得引用它们作为「机器已验」的先例。

### F2 外线提交长期存在：触到生产码，未触到考道

- 44 笔 `abathur-seat <abathur@local>`，2026-10-07 → 2026-11-03。
- 分布：`graders/pcb-agent/**`（他线评分器长期寄放）36 次文件触碰；`src/` 下 **10 笔提交**（含 `src/core/evolve/run-loop.ts` 4 次、8 个 `src/test/*`）；`release/notes/RELEASE-NOTES.md`。
- 零笔触及 `loop/`、`.opencode/`、`.omo/`。
- 44 笔无一在任何 tag（逐笔 `git tag --contains` 全空），无一在 `release/0.4.0`。
- 事故窗口（2026-11-02T18:48Z–19:28Z）内的**整点外锚戳记**：`TICK ts=2026-11-02T19:17:11Z` 报 `ANCHOR-OK` 且 `RECON-OK`（`~/.local/share/abathur/anchor/nightly.log` 第 1639–1640 行），即该时刻 `AGENTS.md` 与台账尾哈希与链上最新戳一致。
- **文件 mtime 不作为证据**：`touch -d` 可任意伪造时间，mtime 只能当线索。第一节已认定同 uid 可写，故此处只用整点锚链（需要改链才能伪造）下结论。

**结论必须限定在探针覆盖内**：

- 可下：没有可见的外线提交改过考道文件（`loop/` 等）；治理文件（`AGENTS.md`、台账尾）在事故窗口有锚链连续性。
- **不可下**：「判卷结果未被操纵」。理由：判卷器与题库不在外线提交里，但归档可被无痕改写，而归档不在锚链覆盖内（第一节）。
- **另有未闭合风险**：全局 `abathur` 命令是指向工作树的符号链（2026-11-02 16:20 +0800 建立），故**引擎战役**（`abathur run`）跑的是可变工作树。外线对 `src/` 的 10 笔提交因此对战役面有效。考道（判卷经 `opencode run` + `loop/*.py`）不经过该链，但这一点必须由「冻结安装恢复」来关闭，而不是靠声明。

### F3 镜像钉值与晋升面

- 晋升面（33 代）中镜像未钉：G65、G67、G68、G72（4 代）。其余 23 代当时无镜像制度。
- 非晋升面另有 4 代未钉：G66、G80、G81、G82。它们不属于 F3 对晋升面的指控，单列以免混类。
- 「未钉」的准确含义：`evidence/<GEN>/SHA256SUMS` 存在，但其自身哈希未写入台账 → 镜像可被整体替换而不被发现。

## 五、责任归属（含本席）

- **本席责任（不软化）**：`abathur-seat` 使用的邮箱 `abathur@local` 与本席同一；身份闸一个月内只校验邮箱、不校验名，本席从未复检；44 笔外线提交 27 天未被发现，因为锚链只戳文件哈希、不查提交流；镜像钉值长期缺失。这四项都是本席的治理失职。
- **符号链＝L-ENGINE-ISOLATION 复发违规（本次立案）**：全局 `@tachikomagundam/abathur` 于 2026-11-02T16:20:01+0800 被建成指向工作树的符号链（`ls -la --time-style=full-iso` 实测）。归因尝试：`.bash_history` 无 `npm link`/`ln -s …/Abathur` 记录；引擎会话库该时段 123 个会话（多线并跑），按 `npm link` 字样检索只命中本审计自身。**归因结论 DISPUTED**——不指认他席，也不排除本席。处置：本席已撤除（见第七节第 10 条回执）。
- **他线责任**：PCB 席在其自书 `STRIP-LIST-for-abathur-line-20261103.md` 承认六笔写入并已 revert；其获本仓路径的依据在其侧文档，需其线自查。本席不代其定罪。
- **匿名面**：同 uid 且无审计日志，无法把 2026-11-02 18:48Z 的动作归到具体进程。DISPUTED 到进程层，可归到身份字符串层。

## 六、结论（逐条限定）

1. 33 次晋升中：**0 次达到严格 VERIFIED**；3 次有可读回批准件（G67/G68/G72）；24 次只有归档；**6 次连归档都没有**。
2. 没有机器证据表明外线提交改过考道文件；**也没有机器证据能排除归档被无痕改写**。因此对 2026-11-02 之前的判卷结论，本审计的正确标签是 UNVERIFIABLE，而不是「通过」。
3. 本审计不宣布任何一代「晋升无效」——撤销属人类权限；本审计给出的是证据分级与责任清单。

## 七、整改方案（分「已落地」与「待落地」，各自带验收判据）

### 已落地（本日，带回执）

| # | 措施 | 回执 |
|---|---|---|
| 1 | 提交身份闸改 `Name <email>` 双键 | 四例实测：`abathur-seat<abathur@local>` 拒、`abathur` 过、机主身份过、`x@y` 拒 |
| 2 | `scripts/check-foreign-commits.py` + 具名债务账 | 账文件绝对路径 `/home/lab/workspace/harness/Abathur/docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt`，53 行＝44 枚 sha＋9 行说明；当前 `pending_adjudication=44 new_foreign=0`，VERDICT 文案带「not amnesty」 |
| 3 | `verify-all.sh` 第 8 步接入上述闸 | `steps=8` |
| 4 | `scripts/audit-promotions.py`、`scripts/promotion-inventory.py` | 本日修正后输出 33 代、缺档 6 代 |
| 5 | 事故报告 `docs/INCIDENT-20261103-foreign-commits.md` | 已存在（须按 44 笔口径复核） |

**注意**：第 1 条只是防误操作，不是防同 uid 恶意写——`git commit --no-verify` 可绕过。不得称「已闭合」。

**第 2 条的写入规则与残留（第三轮驳回点，`sibyl-20261102T201047Z-46d3`）**：该债务账同 uid 可写，本席完全可以自增一行 sha 使 `new_foreign` 归零——闸会被账本吞掉。已作的处理（不是闭合）：

- 账头四条写入规则：本席不得自增；一行只有在人类签认或 `sibyl_audit` 回执（`independence=INDEPENDENT`，审计会话可在引擎库对账）附卷后才算有效；未裁定前一律 PENDING；同 uid 可写的残留以文字披露。
- 闸输出改为 `pending_adjudication=<n>` + 逐行 `PENDING-ADJUDICATION` + VERDICT 文案带 `not amnesty`；**加行不再等于静默放过**。
- 验收探针：追加一个不在账内的假 sha → 重跑必须出现对应 `PENDING-ADJUDICATION` 行且计数 +1；若加行后输出变成干净的 `OK`，本条不成立。

### 待落地（本席可自执行）

6. **锚链对账（拆成已落地的探针 + 未闭合的根因，不许合并宣称）**：
   - 6a（**已落地，带回执**）：`scripts/anchor-head-check.sh` 比对链头 `self` 与 `nightly.log` 最近 `RECON-OK` 行记录的链头前缀。实跑（宿主侧，2026-11-02）：正例 `ANCHOR-HEAD OK head=451ef5d3… recon-prefix=451ef5d3b10f` `POS_RC=0`；负例（把链副本头哈希首字符 4→0）`ANCHOR-HEAD MISMATCH head=051ef5d3… ` `NEG_RC=1`。即 1 字节改动会响。
   - 6b（**未闭合，卡在别线**）：把每代 `bundle.json`/证据镜像哈希**永久**纳入链，需要给 `stamp.sh` 增一个「整本台账 sha256」字段——该脚本在 `/home/lab/workspace/infra/anchor-chain/`，属 infra 线，按车道规矩不代改，须提工单。**现有覆盖的真实边界**：`ledger-tail` 只取台账**最后 65536 字节**（`/home/lab/workspace/infra/anchor-chain/stamp.sh:71`），实测当前窗口覆盖 16 行含 `G8` 的条目；因此某代写进台账的 `sums_sha256` 只在其后数小时内有链背书，随后滑出窗口，**不是永久背书**。
   - 6c：因此本条的正确措辞是「链头对账可检 1 字节级篡改（6a 已验）；证据永久背书未建立（6b 待工单）」。
7. **先逐笔裁定 44 笔，再谈重建血统**：`check-foreign-commits.py` 只按身份对分类，不足以判定单笔归属。**裁定通道**（第三轮驳回点）：本席 spawn 的同链 `sibyl_consult` **不算独立通道**（先例：G65 提名附卷的 `sibyl-20261031T061736Z-2c2a` 记 `independence=NOT-INDEPENDENT`，已判定不构成盲审）；须用 `sibyl_audit`（从引擎新开的 root 会话发球），回执落在本文件附卷，且 `independence=INDEPENDENT`、审计会话 ID 可在引擎库对账；**最终每一行的裁定必须由人类具名签认**（签认载体：台账人类条目，含 sha 与结论）。产出逐笔表（sha / 作者 / 路径 / 判定 / 依据 / 审计回执号 / 人类签认位）。验收：表内每行有依据且裁定人非本席；未经此表不得从 `4e213dd` 拉分支（会误删本席 116 笔合法提交中的一部分）。
8. **仓内禁写面（非闭合）**：pre-commit 增加 `graders/pcb-agent/**` 拒绝规则。**与第 1 条同受 `--no-verify` 绕过、钩子文件本身可写**，只能防误操作。真闭合＝`handoffs/GRADERS-MIGRATION-pcb-agent.md` 执行完毕（判据：`graders/pcb-agent/` 目录在本仓不存在，且 PCB 侧持有迁移后的副本并出回执）。
9. **每代钉镜像**：`publish-evidence` 缺失即 fail；已归档的 4 代（G65/G67/G68/G72）补钉当前字节为**「as-of 2026-11-03 基线，非判卷时点」**，并注明该基线不能证明判卷时内容。
10. **引擎安装面分两半**：
    - 10a（本席已执行）：撤除 dev-link。回执：`ls -l ~/.npm-global/lib/node_modules/@tachikomagundam/` 原显示 `abathur -> ../../../../workspace/harness/Abathur`、`bin/abathur -> …/dist/cli.js`；执行后目录为空、`which abathur` 无输出。
    - 10b（需人类）：重装 npm 发布包。验收不用版本串（两态可能同串），用落点：`readlink -f "$(command -v abathur)"` 必须位于 npm 全局前缀内且**不含** `/workspace/harness/Abathur`。中间态（`abathur` 不在 PATH）为合规状态，须在人类执行前保持。

### 需人类/root

11. uid 分离：另建账户持有本仓写权（`sudo` 当前被 `no new privileges` 阻断，本席无法自建）。
12. 裁决 6 代无档（G4/G9/G10/G11/G21/G22）的条款效力。

## 八、局限

- 无 auditd，进程级归因不可得。
- 归档改写窗口无界：本审计不能说「某代一定没被改」，只能说「没有证据表明被改」。
- **审计集本身是自指来源**：33 代名单取自 `AGENTS.md` 的「晋升条款」标题行，而该文件同 uid 可写；因此该计数的外部性仅等于锚链对 `AGENTS.md` 的覆盖深度（整点戳记），不构成独立事实源。
- 本席是自审方；本审计已送西比拉独立席复核，结论以复核为准。
- `scripts/check-citations.py` 的适用面：它按「路径存在 + 行号在范围内」复算。本文引用的 `/home/lab/workspace/infra/anchor-chain/stamp.sh:71` 在**仓外**，而座席的 bash 沙箱把 `/home/lab` 设为 tmpfs（仓外路径不可见），因此该检查必须在**宿主侧**跑：宿主侧 `CITATIONS OK … problems=0 … RC=0`（回执 `/home/lab/tmp/opencode/cite.out`）；牢内跑会报 `absolute path missing`——这是沙箱视野，不是引用错误。此差别必须随文披露，否则读者会误以为闸在任何环境都等价。

## 九、第一版被驳回的处置（`sibyl-20261102T195208Z-3701`，0A/3R）

| 驳回点 | 处置 |
|---|---|
| 漏 G23/G24/G25、总数 30 是正则产物的假数 | 已修 `promoted_gens()`（区间展开 + 后缀保留），实测 33 代、缺档 6 代 |
| 「逐一对应 30」不实 | 已删除该断言，改为脚本输出实数 |
| G67/G68/G72 标 VERIFIED 与自身定义矛盾 | 新增 APPROVAL-ONLY 类，严格 VERIFIED 计数为 0 |
| F3 混入非晋升代 | 拆成晋升面 4 代 / 非晋升面 4 代 |
| G73–G83 无处置 | 已加「零晋升」实测说明（11/11 无批准件） |
| 44 vs 53 条目冲突 | 已澄清：文件 53 行 = 44 枚 sha + 9 行说明 |
| 「零笔触考道」不足以排除引擎操纵 | 已补引擎面：考道不经 dist/，但全局符号链使战役面仍在风险中；列第 10 条整改 |
| 锚链本地可写→第 6 条不闭合根因 | 已改为 bundle 入链 + historian 页对账 |
| 第 7 条重建血统可能误删合法提交 | 已改为「先逐笔裁定」 |
| 第 9 条把他线义务外推 | 已加本席侧禁写规则 |
| 缺本席自身责任 | 已加第五节 |
| TAINTED-SUSPECT 零命中无依据 | 已删除该类：归档篡改窗口无界，正确标签是 UNVERIFIABLE，不是 TAINTED |
| 结论未限定在探针覆盖内 | 已按探针改写第六节 |

## 十、第二版被驳回的处置（`sibyl-20261102T200253Z-b053`，1A/2R）

事实层（33 计数、F2 数字、F3 分类、自责段）经独立复原，无异议。驳回全在整改面，逐条处置：

| 驳回点 | 处置 |
|---|---|
| 第 10 条把 npm 全局重装列为「本席可自执行」，属 E1→E2 越界 | 拆成 10a（本席撤 dev-link，已执行并附前后回执）/ 10b（人类重装），验收改为 `readlink -f` 落点判据 |
| 第 10 条验收用版本串无判别力 | 已弃用版本串，改用落点路径 |
| 第 6 条把 historian 页当根信任，未披露同 uid 残留 | 已写明「可改链头者亦可改页」，降级为缓解，并给不一致探针 |
| 第 7 条裁定人未具名（本席自裁风险） | 已指定人类或全新西比拉会话，附逐笔表验收形式 |
| 第 8 条未带 `--no-verify` 警示、未给工单完成判据 | 已补警示与迁移工单完成判据 |
| 第 2 条回执缺绝对路径 | 已写绝对路径 |
| G22 判 UNVERIFIABLE 但 G22R 在盘，未交代 | 已单列 SUBSTITUTE-RERUN 行并说明不能证原件 |
| 第八节未披露 33 名单源自座席可写的 `AGENTS.md` | 已加「自指来源」条目 |
| 符号链未立案、未归因 | 已在第五节立案（L-ENGINE-ISOLATION 复发），归因 DISPUTED（history 无记录、会话库检索零命中），处置回执在第 10a 条 |

## 十一、第三版被驳回的处置（`sibyl-20261102T201047Z-46d3`，1A/2R）

该轮确认：第九、十节所列十条已逐条落实，事实层无异议；余四条如下。

| 驳回点 | 处置 |
|---|---|
| 债务账同 uid 可写，本席自增一行即可让 `new_foreign` 归零 | 账头四条写入规则（本席不得自增 / 须人类签认或 `sibyl_audit` INDEPENDENT 回执 / 未裁定即 PENDING / 同 uid 残留披露）；闸输出改 `pending_adjudication=` + `PENDING-ADJUDICATION` + 「not amnesty」文案，加行不再静默；加行探针见第七节第 2 条 |
| 第 7 条裁定人若取西比拉，同链 consult 不独立 | 已绑 `sibyl_audit` 独立通道 + `independence=INDEPENDENT` + 引擎库对账；最终须人类具名签认（引 G65 `sibyl-20261031T061736Z-2c2a` 的 NOT-INDEPENDENT 先例） |
| F2 用 mtime 作证据，可 `touch -d` 伪造 | 已删去 mtime 的证据地位，只保留整点锚链 TICK（改链才可伪造） |
| 第 6 条链头对比缺具名命令与负例 | 已落 `scripts/anchor-head-check.sh` 并实跑：正例 `POS_RC=0`，负例（改 1 字节）`NEG_RC=1`；同时写明 `ledger-tail` 只有 64 KiB 滚动窗口、永久背书待 infra 工单（6b/6c） |

**仍未闭合、已披露**：债务账与本席同 uid 可写；归档不在锚链永久覆盖内；`.omo/evidence/loop-archive/**` 无外部副本；进程级归因需 auditd 或异 uid（第 11 条）。
