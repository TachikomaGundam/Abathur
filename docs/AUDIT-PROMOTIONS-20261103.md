# 晋升审计：G4（首次晋升）到 G83（2026-11-03）

审计人：阿巴瑟席。对象：宪章记载的 **33 次晋升**。本文**第五版**。前四版均判 REJECT（`sibyl-20261102T195208Z-3701` 0A/3R、`sibyl-20261102T200253Z-b053` 1A/2R、`sibyl-20261102T201047Z-46d3` 1A/2R、`sibyl-20261102T202251Z-7938` 1A/2R），驳点处置依次见第九、十、十一、十二节。第四轮已独立复算确认事实层无异议，剩余驳回点集中在取数当场性与扫描范围。

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

- 该身份在本仓共 **48 笔**：`git log --format='%H %ad' --author='abathur-seat <abathur@local>'`（HEAD 谱系）= 44 笔，2026-10-07T03:15 → 2026-11-03T03:03；`--all` = 48 笔，多出的 4 笔只存在于改写前备份 ref `original/refs/heads/main` 上：`7bfb4aac`（2026-10-03T22:11:53+08:00）、`d23bfba3`（10-04T02:03:06）、`a6ba1cf0`（10-04T02:58:52）、`d6542f4a`（10-04T11:57:56）。因此身份清点的窗口起点应为 **2026-10-03**，不是 10-07。（该 4 笔的归类由第四轮审计 `sibyl-20261102T202251Z-7938` 抓出；本版据其更正。）
- 分布：`graders/pcb-agent/**`（他线评分器长期寄放）36 次文件触碰；`src/` 下 **10 笔提交**（含 `src/core/evolve/run-loop.ts` 4 次、8 个 `src/test/*`）；`release/notes/RELEASE-NOTES.md`。
- 零笔触及 `loop/`、`.opencode/`、`.omo/`。
- 44 笔（HEAD 谱系）无一在任何 tag（逐笔 `git tag --contains` 全空），无一在 `release/0.4.0`；`git branch -r --contains <sha>` 对 44 笔全部无输出。
- **提交计数的可证边界**：本地 git 对象库同 uid 可写（第一节），所以「这个 sha 存在且内容如此」只在**本地对象库未被篡改**的前提下成立。可复算命令：`git cat-file -t <sha>`、`git log --format=%H --author=… `。未取得远端回执的部分不当作外部背书的证据——与 `.omo/` 下的工件同等对待。
- 事故窗口（2026-11-02T18:48Z–19:28Z）内的**整点外锚戳记**：`~/.local/share/abathur/anchor/nightly.log` 第 **1639** 行 `TICK ts=2026-11-02T19:17:11Z`、第 **1640** 行 `RECON-OK`、第 **1641** 行 `ANCHOR-OK`（三行逐字引用；第四轮审计指出原稿把 `ANCHOR-OK` 记在 1639–1640 是行号错误），即该时刻 `AGENTS.md` 与台账尾哈希与链上最新戳一致。
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
- **符号链＝L-ENGINE-ISOLATION 复发违规（本次立案）**：全局 `@tachikomagundam/abathur` 曾被建成指向工作树的符号链。建立时刻 **2026-11-02T16:20:01+0800** 来自撤除前的 `ls -la --time-style=full-iso` 输出，属**线索**（符号链 mtime 可用 `touch -h -d` 伪造，与 F2 已降级的 mtime 同类）；锚链只戳文件哈希、不戳符号链，因此该时刻**没有链上证据**，本文件不把它当作已证事实。已证事实只有两条：撤除前 `readlink` 指向 `../../../../workspace/harness/Abathur`、撤除后 `which abathur` 无输出（第七节第 10 条回执）。归因尝试：`.bash_history` 无 `npm link`/`ln -s …/Abathur` 记录；引擎会话库该时段 123 个会话（多线并跑），按 `npm link` 字样检索只命中本审计自身。**归因结论 DISPUTED**——不指认他席，也不排除本席。
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
| 2 | `scripts/check-foreign-commits.py` + 具名债务账 | 账文件绝对路径 `/home/lab/workspace/harness/Abathur/docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt`，当场实测 **66 行 = 44 枚 sha + 22 行非 sha**（复算：`wc -l …` 与 `grep -c '^[0-9a-f]\{40\}$' …`）；**现状是红灯且必须保持红灯**：`pending_adjudication=44` → `VERDICT=FOREIGN-COMMITS FAIL-PENDING` rc=1。`--allow-pending` 只用于裁定前的探查（rc=0），不得用于发布门 |
| 3 | `verify-all.sh` 第 8 步接入上述闸 | `steps=8` |
| 4 | `scripts/audit-promotions.py`、`scripts/promotion-inventory.py` | 本日修正后输出 33 代、缺档 6 代 |
| 5 | 事故报告 `docs/INCIDENT-20261103-foreign-commits.md` | 已存在（须按 44 笔口径复核） |

**注意**：第 1 条只是防误操作，不是防同 uid 恶意写——`git commit --no-verify` 可绕过。不得称「已闭合」。

**第 2 条的写入规则与残留（第三轮驳回点，`sibyl-20261102T201047Z-46d3`）**：该债务账同 uid 可写，本席完全可以自增一行 sha 使 `new_foreign` 归零——闸会被账本吞掉。已作的处理（不是闭合）：

- 账头四条写入规则：本席不得自增；一行只有在人类签认或 `sibyl_audit` 回执（`independence=INDEPENDENT`，审计会话可在引擎库对账）附卷后才算有效；未裁定前一律 PENDING；同 uid 可写的残留以文字披露。
- 闸输出改为 `pending_adjudication=<n>` + 逐行 `PENDING-ADJUDICATION` + VERDICT 文案带 `not amnesty`；**加行不再等于静默放过**。
- **扫描范围修正（第四轮驳回点，`sibyl-20261102T202251Z-7938`）**：原实现只扫 `origin/main..HEAD`，于是活在改写前备份 ref 上的 4 笔同身份提交从未被看见——闸报 `new_foreign=0` 而盘上仍有未裁定外线提交。现实现扫 `HEAD` 全谱系，并单独扫 `--all --not HEAD`：不属于已声明历史 ref 的归 `OTHER-REF-FOREIGN`（判败），属于的归 `quarantined_ref_commits`（计数+具名，不判败，因为它们是 filter-repo 改写前的历史）。声明文件 `/home/lab/workspace/harness/Abathur/docs/evidence-manifests/QUARANTINED-REFS.txt`（当前仅 `original/refs/heads/main`，107 笔；该文件同 uid 可写，属同类残留）。
- **探针回执（四项，均用 `--ack` 副本或可回滚的 sed，不污染真账）**：
  - A 账本清空（只留注释行）→ `pending_adjudication=0 new_foreign=44` rc=1，且逐行打印 44 条 `FOREIGN`。
  - B 账本删去 1 枚 sha → `pending_adjudication=43 new_foreign=1` rc=1。
  - C 插入路径（第五轮 `sibyl-20261102T203622Z-db86` 指出的盲区）→ 闸已改为**任何 sha 行都判败**：真实账本原样跑 `pending_adjudication=44 … VERDICT=FOREIGN-COMMITS FAIL-PENDING` **rc=1**；只有显式 `--allow-pending` 才 rc=0。因此「把新外线提交的 sha 追加进账本」只能把 `FOREIGN` 换成 `FAIL-PENDING`，两者都是红灯，**升不到绿**。
  - D 声明漂移 → 把 `QUARANTINED-REFS.txt` 的期望计数从 151 改成 150，闸输出 `QUARANTINE-DRIFT original/refs/heads/main declared=150 actual=151`、`VERDICT=… FAIL — quarantine declaration drift` **rc=1**；改回 151 后恢复（见 §12 的 C/D 处置）。
  - 结论：闸的绿灯只有一种来源——**没有未裁定的外线提交**。账本与声明文件都只能把「未知」变「红着等你签」，不能把它们变绿。

**仍不闭合、必须由人类或异 uid 面解决**：账本与 `QUARANTINED-REFS.txt` 本身同 uid 可写；闸的绿灯只等于「没有未裁定的外线提交」，不等于「没有人能写这些文件」。真闭合＝异 uid 写面或远端镜像。

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
| 44 vs 53 条目冲突 | 已澄清并再次更正：文件当场实测 **66 行 = 44 枚 sha + 22 行非 sha**（第四轮审计指出 53/9 已被磁盘证伪） |
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

## 十二、第四版被驳回的处置（`sibyl-20261102T202251Z-7938`，1A/2R）

该轮独立复算了事实层并确认无异议（33 代四类计数、G73–G83 零批准、10 笔 `src/`、锚链窗口、`/home/lab/workspace/infra/anchor-chain/stamp.sh:71` 的 64 KiB 语义、第三轮四条为工件级处置）。驳回集中在七处可复算缺陷：

| 驳回点 | 处置（本版已改 / 已跑） |
|---|---|
| 债务账「53 行＝44＋9」被磁盘证伪（实为 66 行） | 改为当场实测 **66 行 = 44 枚 sha + 22 行非 sha**，并给复算命令（§7 表第 2 条、§9 表） |
| F2 只清点窗口内 44 笔；`--all` 为 48 笔 | 已按完整清点改写：44 笔（HEAD）+ 4 笔（`original/refs/heads/main`：`7bfb4aac`/`d23bfba3`/`a6ba1cf0`/`d6542f4a`，2026-10-03→10-04），窗口起点改 **2026-10-03**（§4 F2） |
| 闸的扫描范围把备份 ref 上的同身份提交永久藏在视野外（`new_foreign=0` 假绿） | 已改实现：扫 `HEAD` 全谱系 + 单独扫 `--all --not HEAD`；新增 `OTHER-REF-FOREIGN`（判败）与 `quarantined_ref_commits`（具名计数）；新增声明文件 `/home/lab/workspace/harness/Abathur/docs/evidence-manifests/QUARANTINED-REFS.txt`；实跑 `head_commits=425 other_ref_commits=257 pending_adjudication=44 new_foreign=0 other_ref_foreign=0 quarantined_ref_commits=107` rc=0（§7 第 2 条） |
| 加行探针只有判据没有回执 | 已实跑两项（`--ack` 副本，不污染真账）：A 清空账本 → `pending=0 new_foreign=44` rc=1；B 删 1 枚 sha → `pending=43 new_foreign=1` rc=1（§7 第 2 条） |
| `nightly.log` 行号：`ANCHOR-OK` 实为第 1641 行 | 已改 1639/1640/1641 三行逐字引用（§4 F2） |
| §5 用符号链 mtime（`ls -la --time-style=full-iso`）钉 dev-link 建立时刻 | 已降级为**线索**并明示锚链不戳符号链、该时刻无链上证据；只保留 `readlink` 与撤除后 `which` 两条已证事实（§5） |
| 提交计数被列在「能证」而未加不可证限定 | 已加边界声明（本地对象库同 uid 可写）并给复算命令；44 笔的 `git branch -r --contains` 全空回执同时列出（§4 F2） |

**本版新增的残留（同样不闭合）**：`QUARANTINED-REFS.txt` 与本席同 uid 可写——把任意 ref 声明为「历史备份」即可让该 ref 上的外线提交转成不判败的 `quarantined` 计数。缓解只有三条：该文件不被信任（每次审计须自己跑 `git rev-list original/refs/heads/main | wc -l` 复核 151 这个数）、`quarantine` 只对「不在 HEAD 谱系」的提交生效、任何 ref 若被推送到远端则须人工复核。真闭合仍要靠异 uid 写面（第 11 条）或远端镜像。

## 十三、第五版被驳回的处置（`sibyl-20261102T203622Z-db86`，**APPROVE 2A/1R**，附四条 must-fix）

该轮独立复算了三项磁盘事实（66 行=44+22、`QUARANTINED-REFS.txt` 仅 1 条、`nightly.log` 1639/1640/1641 三行逐字），并确认扫描修复与「不把缓解写成闭合」两维度达标；四条 must-fix 如下，全部已落：

| 驳回点 | 处置 |
|---|---|
| 结论句「账本不能把未知提交变成通过」与实跑 `rc=0` 矛盾；插入路径零覆盖 | 闸改为 **PENDING 即判败**（`FAIL-PENDING` rc=1），`--allow-pending` 仅供探查；探针 C 记录原样跑 rc=1。插入 sha 只能从 FOREIGN 变 FAIL-PENDING，无法升绿（§7 第 2 条） |
| `QUARANTINED-REFS` 无外部锚，可自增 ref 洗白 | 声明格式改 `ref <期望提交数>`，闸做**计数比对**，不符即 `QUARANTINE-DRIFT` 判败；探针 D 记录 declared=150/actual=151 → rc=1。外部锚（入链/人类签认）待 infra 工单，文中如实列为不闭合 |
| 写入规则说「须签认才算有效」，实现却见行即计 PENDING | 规则改写为实现：**任何 sha 行立即生效为 PENDING，而 PENDING 一律判败**——两者对齐后，规则不再是「说了但不执行」（账头第 3 条已重写） |
| F2 行号引用缺宿主侧复算命令、路径未绝对化 | 已改为绝对路径 `/home/lab/.local/share/abathur/anchor/nightly.log` 并给 `sed -n '1639,1641p'` 复算命令，三行预期随文 |

**本版新增的不闭合（如实列出）**：闸现在**恒红灯**直到 44 笔逐行人类签认——这是设计意图（绿灯不得建立在未裁定外线提交之上），代价是发布门与 `verify-all` 第 8 步在此期间始终红。裁定表见 `docs/INCIDENT-20261103-FOREIGN-COMMITS-ADJUDICATION.md`。
