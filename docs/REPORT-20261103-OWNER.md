# 事故报告与晋升审计呈报（2026-11-03，第五版 = v4.1）

呈报对象：机主。作者：阿巴瑟席。状态：**未闭合**——闸保持红灯是设计结果，不是未完成。
版本史：v1 被 `sibyl-20261102T204449Z-a866` 判 0A/3R → v2 被 `sibyl-20261102T205440Z-c455` 判 1A/2R → v3 被 `sibyl-20261102T210359Z-65cc` 判 1A/2R → v4 获 `sibyl-20261102T211727Z-3637` **APPROVE 2A/1R**（附三条非阻断修订）→ 本版 v4.1 吸收那三条修订后再送审。三轮的 must-fix 逐条处置见第八节与第九节；事实层三轮均被独立复算确认为真。

## 一、一句话结论

外线身份 `abathur-seat <abathur@local>` 在本仓留下 **48 笔**提交：**44 笔在当前主线**、**4 笔只在改写前备份 ref**。其中 **10 笔触及引擎源码**，**0 笔触及考道 `loop/` 与治理文件**，**0 笔在任何 tag 或 `release/0.4.0`**。但 **28 笔已在远端追踪分支 `internal/main` 上**（内网远端，非公网 origin）——「发布面干净」只对公网/tag/npm 成立，内网远端必须另行处置。33 次晋升中严格可验证 **0 次**：无档案 6、只剩归档 24、只有批准件 3。

## 二、污染范围

| 面 | 状态 | 依据（可复算） |
|---|---|---|
| 公网发布面（tag、`origin`） | **git 面无命中；npm 包内容未证** | 48 笔 `git tag --contains` 全空、`origin/*` 零命中。但 `npm view` 实测 0.4.1 发布于 `2026-10-24T05:27:40Z`，而 10 笔 src 外线提交中 **2 笔（`6e342fd` 2026-10-23T19:51:47+08:00、`9334e76` 2026-10-23T20:05:42+08:00）早于该发布时刻**，当时已在工作树。发布按 content-only orphan 物化，`--contains` 对此结构性失明——**故只能写「git 面干净、包内容未证」**，比对的缺口见 §六.7 |
| 内网远端 `internal/main` | **有 28 笔** | 逐笔 `git branch -r --contains <sha>`：28 笔命中 `internal/HEAD -> internal/main`；16 笔不在任何远端 |
| 引擎源码 `src/` | **有 10 笔** | `git show --name-only`；事故波 6 笔已于 2026-11-03T03:28:41 被 revert，`git diff 4e213dd HEAD -- src/` 为空 |
| 考道 `loop/`、题库、判卷脚本 | **干净** | 48 笔零命中 |
| 治理 `AGENTS.md`、台账、锚链 | **干净（有尾锚 + 链复算）** | ①`bash /home/lab/workspace/infra/anchor-chain/verify.sh` → `rc=0`，输出 `v2 链接=96; legacy-v1=2(断链=1, 史前具名伤)`——**这证明的是「v2 链的 96 个逐枚哈希链接自洽 + 最新戳与台账/AGENTS.md 现值一致」**，不等于覆盖 10-07→11-03 每个整点戳（逐时戳由 cron 每小时写，本轮未逐条复算）；legacy-v1 断链 1 为史前具名伤，本轮未修；②事故窗口内整点 `TICK`：`/home/lab/.local/share/abathur/anchor/nightly.log` 第 1639–1641 行 `TICK ts=2026-11-02T19:17:11Z` / `RECON-OK … self=451ef5d3b10f…` / `ANCHOR-OK …`（`sed -n '1639,1641p'`；该文件由 cron 每小时追加，大小是活变量——本呈报不写死字节数，复算请用 `stat -c%s` 当场取值）——该 tick **落在事故窗口内且报 ANCHOR-OK**，是「窗口内这两个文件未被改写」的证据；③`python3 loop/instrument_defects.py check` → `INSTRUMENT-DEFECTS OK entries=4` `rc=0`；④`python3 loop/recurrence.py check` → `RECURRENCE OK events=2 classes=6` `rc=0`。全部回执见 `.omo/evidence/gate-receipts-20261103.log`（sha256 `eb0e22fffebe2a44beb1539c5586bb74bf4e0dca35dd33c1f26d293f897d97d5`） |
| 他线器材 `graders/pcb-agent/**` | **有 34 笔** | 长期寄放，迁移工单在册 |
| 备份 ref `original/refs/heads/main` | **有 107 笔非授权身份** | 闸实跑 `quarantined_ref_commits=107`；构成：`Wiki.js` 87 + `abathur@harness.local` 15 + `abathur-seat` 4 + `AbathurRebuild` 1。该 ref 与 HEAD **零共享提交**（`git rev-list original/refs/heads/main --not HEAD | wc -l` = 151，整体为改写前历史） |
| 归档证据 `.omo/evidence/loop-archive/**` | **不可证** | 不在 git、不在锚链永久覆盖内；只能标 UNVERIFIABLE，不得写「未发生」 |

**身份层面的坏消息（必须写）**：事故波 6 笔 revert 由机主全局身份 `TachikomaGundam <…@users.noreply.github.com>` 写出（`docs/INCIDENT-20261103-foreign-commits.md:40`），与真人提交不可区分。因此「人类签认」只是裁决动作，**不是身份鉴证**。

## 三、晋升审计（G4 首次晋升 → G83）

| 类 | 定义 | 计 |
|---|---|---|
| VERIFIED | 归档在 + 镜像钉住且复算一致 + 批准件可读回 | **0** |
| APPROVAL-ONLY | 有具名批准件，镜像未钉 | 3（G67/G68/G72） |
| ARCHIVE-ONLY | 只有归档 | 24 |
| UNVERIFIABLE-AT-DISK | 无目录（G4/G9/G10/G11/G21/G22） | 6 |

G73–G83 共 11 代无批准件、无提名件，**零晋升**，不混入上表。镜像钉住率：`python3 scripts/audit-promotions.py` 实测 `VERDICT=PROMOTION-INTEGRITY FAIL unpinned=66 of 74` `rc=1`（回执：`.omo/evidence/gate-receipts-20261103.log` 第 1 节，文件 sha256 见 §二）。

## 四、已落地的整改（机器可复算）

1. **身份闸双键**：回执 `.omo/evidence/identity-gate-probe-20261103.log`（sha256 `c8ceec4093baf706faeef7dc60feb0e4ab85c90868b9f961b4f4da743057aa5c`，生成时刻 `2026-11-02T21:14:22Z`，宿主临时仓 + 现盘钩子）：`abathur-seat <abathur@local>`（事故原文，带空格）**rc=1 拒**、`abathur <abathur@local>` rc=0、`Abathur <abathur@local>`（v0.4.0 发布身份）rc=0。
   **修复自身出过缺陷，由探针抓到**：v1 钩子用「同邮箱只取第一行」，导致第二条同邮箱注册（`Abathur`）不可达、被拒；探针首跑暴露后重写为「任一行配对匹配即通过」（钩子第 3–9 行注释留痕）。这条缺陷没被任何一轮人工/审计审出，是机械探针抓的。
2. **外线提交闸三段语义**（不得简写）：
   - `HEAD` 全谱系上的外线身份 → 判败（rc=1）；
   - 未声明 ref 上的外线身份 → `OTHER-REF-FOREIGN` 判败；
   - 已声明 quarantine ref 上的外线身份 → 只计数（`quarantined_ref_commits`），不判败；声明计数不符则 `QUARANTINE-DRIFT` 判败。
3. **PENDING 即判败**：账本里任何未签认 sha 行 → `VERDICT=FOREIGN-COMMITS FAIL-PENDING` rc=1；`--allow-pending` 仅供探查。
4. **探针四组（全部落盘，含 rc 与系统时钟）**：A 清空账本 → `new_foreign=44` `rc=1`；B 删 1 行 → `new_foreign=1` `rc=1`；C 原样跑 → `FAIL-PENDING` `rc=1`；C2 `--allow-pending` → `rc=0`；D 声明 150 vs 实测 151 → `QUARANTINE-DRIFT` `rc=1`。全部逐条回执在 `.omo/evidence/gate-receipts-20261103.log` 第 4 节（sha256 `eb0e22ff…97d5`）。**第一版写「回执在册」但盘上无日志，这是本席的呈报失实**，本版补上。
5. **dev-link 已撤除**：`which abathur` 无输出；等人类重装发布包。
6. **脚本落仓**：`promotion-inventory.py`、`audit-promotions.py`、`check-foreign-commits.py`、`gen-foreign-adjudication.py`、`anchor-head-check.sh`。

## 五、西比拉回执链

| 轮 | 回执 | 结论 | 对象 |
|---|---|---|---|
| 1 | `sibyl-20261102T195208Z-3701` | REJECT 0A/3R | 审计报告 v1 |
| 2 | `sibyl-20261102T200253Z-b053` | REJECT 1A/2R | 审计报告 v2 |
| 3 | `sibyl-20261102T201047Z-46d3` | REJECT 1A/2R | 审计报告 v3 |
| 4 | `sibyl-20261102T202251Z-7938` | REJECT 1A/2R | 审计报告 v4 |
| 5 | `sibyl-20261102T203622Z-db86` | **APPROVE 2A/1R** | 审计报告 v5 |
| 6 | `sibyl-20261102T204449Z-a866` | REJECT 0A/3R | 本呈报 v1（12 行 must-fix / 9 条唯一） |
| 7 | `sibyl-20261102T205440Z-c455` | REJECT 1A/2R | 本呈报 v2（六条，见 §九） |
| 8 | `sibyl-20261102T210359Z-65cc` | REJECT 1A/2R | 本呈报 v3（六条，见 §十；事实层全部复核通过） |
| 9 | `sibyl-20261102T211727Z-3637` | **APPROVE 2A/1R** | 本呈报 v4（三条非阻断修订：活文件大小、首票面解析规则、回执迁持久面） |
| 10 | `sibyl-20261102T212420Z-8e6c` | **APPROVE 2A/1R** | 本呈报 v4.1（四条回执 sha256 逐枚复算一致；一条簿记订正：补本节第 9 行与版本史） |

## 六、具名缺口（不省略）

1. **闸恒红**：44 笔待签认；红灯是正确状态。
2. **同 uid 可写**：账本、声明文件、钩子、归档均可被同权限改写。闸只防事故，不防同权限恶意。
3. **quarantine 可自铸**：把任意 ref 写进 `/home/lab/workspace/harness/Abathur/docs/evidence-manifests/QUARANTINED-REFS.txt` 即可让其上外线提交转为不判败计数；缓解只有计数比对（`QUARANTINE-DRIFT`）+ 审计者自跑 `git rev-list`。真闭合需异 uid 或远端镜像。
4. **6 次晋升无档案**：只能标 UNVERIFIABLE。
5. **引擎安装面**：`abathur` 命令当前不可用，需人类重装。
6. **进程级归因**：无 auditd，只能归到身份字符串层（DISPUTED）；且 revert 用了机主身份，身份不可分。
7. **npm 包内容未证**：0.4.1 发布于 `2026-10-24T05:27:40Z`，而 `6e342fd`（10-23T19:51:47+08:00）与 `9334e76`（10-23T20:05:42+08:00）两笔外线 src 提交早于该时刻。包按 content-only orphan 物化，git 面 `--contains` 对它失明。比对方法（未做）：`npm pack @tachikomagundam/abathur@0.4.1` 解包后与 `release/` 面逐文件比 sha256；或与封存 tarball `6edba1fa…` 比整包 sha256。此缺口不补齐，「公网发布面干净」只能写成「git 面干净」。

## 七、需要机主的动作

1. **裁决 44 笔**：逐行签认 `/home/lab/workspace/harness/Abathur/docs/INCIDENT-20261103-FOREIGN-COMMITS-ADJUDICATION.md`（`src/` 10 行优先）。签认是裁决动作，不是身份鉴证（见 §二末段）。
2. **重装发布包**：`npm i -g @tachikomagundam/abathur@0.4.1`（`npm view @tachikomagundam/abathur version` 实测 = `0.4.1`，发布于 `2026-10-24T05:27:40.930Z`；回执 `.omo/evidence/npm-registry-20261103.log`，sha256 `ae9c79cacd58e33165cb23daba5de540346519ef684e5b496362d768a98fae66`）。安装前静态验收：`readlink -f ~/.npm-global/bin/abathur` 应指向 `~/.npm-global/lib/node_modules/@tachikomagundam/abathur/dist/cli.js`；安装后跑 `abathur --version` 应输出 `0.4.1`。属 E2 人类键（本席不执行安装）。
3. **内网远端处置**：`internal/main` 上 28 笔是否回收/改写，属人类裁决（涉及远端历史，本席不代自动手）。
4. **infra 工单**：已由本席起草并投递到 `/home/lab/workspace/harness/Abathur/handoffs/INFRA-anchor-evidence-per-generation-20261103.md`，机主只需裁「是否同意纳入排期」。

## 八、对 `a866` 九条唯一 must-fix 的逐条处置

`a866` 三票持久化文件在 `/home/lab/.sibyl/spaces/sibyl-20261102T204449Z-a866/`，逐票 `must_fix` 条目数实测 **MELCHIOR 4 + BALTHASAR 5 + CASPER 3 = 12 行**（`json.JSONDecoder().raw_decode` 于各文件的**首个** `"must_fix":[...]` 处取值——`MELCHIOR.md` 含 parse/repair 两份票面 JSON，不排除重复会数出 16 行；回执 `/home/lab/workspace/harness/Abathur/.omo/evidence/a866-mustfix-count-20261103.txt`，sha256 `eedb4dc51cff7dee7cdfbbe9b4afe75f464927ae47b5da4a21bf6971e5a8ebcd`）。其中 CASPER 3 行为中文条目的英文重复，去重后 **9 条唯一**。上一版写「13 行/10 条」是错的（把 c455 的一轮条目算进了 a866），本版更正。

| # | a866 原文要点 | 处置 |
|---|---|---|
| M1 | §2 发布面依据被 28 笔 `internal/main` 证伪 | §二拆成「公网 git 面」与「内网远端 28 笔」两行，并补 npm 时间线对照 |
| M2 | §2 治理行依据不可复算 | §二治理行改为 4 项当场命令 + rc + 日志路径 + 日志 sha256（并删去「覆盖每个整点戳」的过度声称） |
| M3 | §一/§二补录备份 ref 107 笔构成 | §一、§二、§六.3 补入 107 及身份构成（87/15/4/1）与「与 HEAD 零共享」 |
| M4 | §七第 3 条把起草工单转嫁机主 | 已自拟并投递 `handoffs/INFRA-anchor-evidence-per-generation-20261103.md`，§七.4 只留裁决 |
| M5 | 缺口节增补 quarantine 语义与同 uid 可自铸 | §六.3 明写「把任意 ref 写进声明文件即可不判败」，并给缓解与真闭合条件 |
| M6 | §4.2「违例判败」简写 | 改为三段语义（HEAD 判败 / 未声明 ref 判败 / 已声明 ref 仅计数，计数不符判败） |
| M7 | 未披露 revert 用机主身份 | §二末段 + §六.6 |
| M8 | 探针缺带空格的事故原文身份 | §4.1 给 `abathur-seat <abathur@local>` 实测 `rc=1`、`abathur <abathur@local>` `rc=0`，并附探针日志路径与 sha256 |
| M9 | §七.3 拆分动作与裁决 | 同 M4（工单已自投，裁决留人） |

## 九、对 `c455` 六条 must-fix 的逐条处置

`c455` 针对本呈报第二版，六条与 74/66 数字属本轮，不属 `a866`（上一版误挂在 a866 名下，本版单列）。

| # | c455 原文要点 | 处置 |
|---|---|---|
| C1 | §三 74/66 数字无落盘来源 | §三 引用 `.omo/evidence/gate-receipts-20261103.log` 第 1 节（`unpinned=66 of 74` `rc=1`），文件 sha256 见 §二 |
| C2 | 探针「回执在册」但盘上无日志 | 已补盘：同日志第 4 节 A/B/C/C2/D 五组逐条 rc；本条是第一版呈报失实的更正 |
| C3 | npm 版本写成占位符 | §七.2 换成实测 `0.4.1` 与发布时刻，并附 `npm-registry-20261103.log` 的 sha256 |
| C4 | §八只列 7 条、未声明缺 3 条 | §八补全为 12 行原始条目、9 条唯一，并具名承认前版静默缩表 |
| C5 | npm 子结论未证（「包内容干净」无据） | §一、§二、§六.7 统一改为「git 面干净、npm 包内容未证」，并给比对方法与未做声明 |
| C6 | 治理行只引单个锚点 | §二治理行改为四锚（链验证、整点 TICK、器具伤账、复发账），并标出各自证明边界 |

## 十、对 `65cc` 六条 must-fix 的处置（本轮）

| # | 65cc 原文要点 | 处置 |
|---|---|---|
| P1 | §八条数算错（13→12→9） | §八头改写：12 行原始、9 条唯一，附三票文件路径与复算方法 |
| P2 | 74/66 条目归属错（属 c455） | 已移入 §九 C1，§八不再含该行 |
| P3 | §二治理行声称覆盖每个整点戳 | 已改为 rc=0 实际证明的「v2 链 96 链接 + 尾戳匹配 + legacy 断链 1 具名披露」 |
| P4 | §4.1 身份探针无落盘日志、npm 回执缺 sha256 | §4.1 引 `identity-gate-probe-20261103.log`（sha256 `c8ceec40…aa5c`）；§七.2 补 npm 日志 sha256 |
| P5 | `QUARANTINED-REFS.txt` 无绝对路径 | §六.3 已给绝对路径 |
| P6 | 缺「c455 六条逐条处置」小节 | 已新增 §九 |

**仍未闭合（不藏在处置表里）**：§二治理行的「干净」只覆盖锚链与哈希链可复算的面，不含归档内容（`.omo/evidence/loop-archive/**` 标 UNVERIFIABLE）；npm 子结论只到「git 面无命中」，包内容比对未做（§六.7）；身份闸 v1 缺陷由探针而非审阅发现，说明同类缺陷仍可能存在于其他未加探针的闸。
