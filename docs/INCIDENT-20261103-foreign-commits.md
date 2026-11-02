# INCIDENT-20261103：外线提交进入 Abathur 主链（含生产安装 dev-link）

- 报告时刻：2026-11-03（系统时钟实测，机器回执见文末）
- 报告人：阿巴瑟席（本仓执行席）
- 触发：机主 2026-11-03 令「彻查到底怎么回事，还有多大范围的污染……你自己的彻查作为最高优先级」
- 灾情件（他方提供，按 DATA 归档）：`/home/lab/workspace/harness/PCB-Agent/.omo/self-audit/STRIP-LIST-for-abathur-line-20261103.md`

## 1. 一句话结论

外线提交共 **44 笔**（作者 `abathur-seat <abathur@local>`，2026-10-07 → 2026-11-03；其中本次事故波 12 笔 = 6 笔功能 + 6 笔回滚）。全部**未推送、未打标签、未进入发布版**（44 笔逐笔 `git tag --contains` 全空）。触及面：`graders/pcb-agent/**` 34 笔（他线评分器长期寄放）、`src/` **10 笔提交**（含事故波 8 个文件）、`release/notes/RELEASE-NOTES.md`；**未触及** `loop/`、`.opencode/`、`.omo/`。事故波的 `src/` 内容已由 6 笔回滚还原：`git diff --stat 4e213dd HEAD -- src/` 输出为空。另发现一处**独立的、早于本次事故**的生产安装违规：全局 `abathur` 命令是指向本工作树的符号链接（2026-11-02 16:20 +0800 建立），且目标 `dist/cli.js` 无执行位；本席已于 2026-11-03 撤除（回执见 §6.1）。

## 2. 血缘与净差（实测）

```
4e213dd ──1ddb773──64f0df3──c51d3c4── … ──a24c729 ──b6d4bd6──78fec3f──1686dbc
                                                       └─ 016a7bd a6d50af db3601b b86067d 176c919 2a0cc21（六笔回滚，同一秒 03:28:41+0800）──> HEAD
```

| 检查 | 命令 | 结果 |
|---|---|---|
| 前三笔是否已在本席链上 | `git merge-base --is-ancestor 1ddb773\|64f0df3\|c51d3c4 a24c729` | **YES（三笔皆是祖先）** |
| 回滚后 src 是否回到污染前 | `git diff --stat 4e213dd HEAD -- src/` | **空**（逐字节相同） |
| 本席最后一笔含污染代码 | `git diff --stat 4e213dd a24c729 -- src/` | 3 files, 218(+)/16(−) |
| 是否进发布 | `git tag --contains <12 笔>` | 全部为空；`release/0.4.0` 不含 |
| 是否推远端 | `git branch -r --contains <12 笔>` | 全部无命中；`origin/main` 落后 333 笔（长期分叉，非本次） |

## 3. 污染范围三分表

| 面 | 范围 | 判定 |
|---|---|---|
| 代码面 | 8 文件：`src/commands/kernel.ts`、`src/core/evolve/{run-loop,run-bench}.ts`、`src/bench/{adapter,fixture,toy}.ts`、`src/test/{kernel-reseal,bench-sandbox-sentry}.test.ts` | 内容已回滚至 `4e213dd`；历史条目仍在 |
| 发布面 | 无标签、无推送、无 release 目录改动 | 未污染 |
| 生产安装面 | 全局 bin 为指向工作树的符号链接（08:20Z 建立），`dist/cli.js` 664 无执行位 → 直接执行报 Permission denied；`node dist/cli.js --version`=0.4.0 | **违规（早于本次）** |
| 考卷/账本面 | `loop/`、`.omo/evidence/`、`AGENTS.md` 无外线提交；事故窗口内整点外锚 `TICK ts=2026-11-02T19:17:11Z` 报 `ANCHOR-OK`+`RECON-OK`（`nightly.log:1639-1640`）；判卷面哈希链复核 `instrument_defects check`=`OK entries=4`、`recurrence check`=`OK events=2` | 未被写入（有整点锚链证据；**不用 mtime 作证据**，`touch -d` 可伪造） |
| 工作区未提交面 | 5 个 tracked 修改（README/package.json/3 测试）mtime=**21:16–21:52 +0800（本席工作窗口）** | 本席产物（mtime 仅作线索，不作定案依据） |

## 4. 为什么会发生（根因，按可机械验证的次序）

1. **无写者隔离（实体根因）**：仓与 `.git` 均为 `lab:lab 775`，同 uid 任何进程可写。这正是 `L-ENV-SEGREGATION` 在册缺口 G1 的实体面。
2. **身份闸只验 email、不验 name**：`.git/hooks/pre-commit` 校验 `GIT_AUTHOR_EMAIL` ∈ `.git/allowed-identities`；该表含 `abathur@local`，因此任何进程设 `--author 'abathur-seat <abathur@local>'` 即可过闸。六笔回滚使用全局身份 `TachikomaGundam <…@users.noreply.github.com>`（同表内），与真人提交不可区分。
3. **动手者未开本仓会话**：引擎会话库在窗口（16:20Z–20:40Z）内无任何 `cwd=/home/lab/workspace/harness/Abathur` 的新会话，全部为 Sibyl/border/AIHR/VideoGen/PCB 侧。即其以绝对路径/外仓 shell 直接写本仓 → 无会话可追溯。
4. **本席未设「外来提交探测」**：`scripts/verify-all.sh` 只验考卷面，不验「本仓历史是否混入非本席提交」；本席在事后才首次看到 `1ddb773`（此时它已是祖先）。
5. **推门只拦标签**：`.git/hooks/pre-push` 仅对 `refs/tags/v*` 要求收据+租约，直推 main 不拦。

## 5. 归属与不可归属

- **可归属（机器证据）**：12 笔提交的作者名/时间/内容；PCB 灾情件自书「PCB 席越权直提六笔」。
- **不可归属（须标 UNATTRIBUTED）**：08:20Z 建立的全局符号链接无对应 npm 日志（`~/.npm/_logs` 该时段无记录，符合 `ln -s` 或手动链接）；六笔回滚使用机主全局身份，无法在机器层面与真人操作区分。
- 因此本报告**不指控具体会话**，只列可核事实。

## 6. 整改方案

### 6.1 即刻（本席可执行，本轮内）
1. **已执行（2026-11-03）**：撤除指向工作树的 dev-link（`~/.npm-global/lib/node_modules/@tachikomagundam/abathur` 与 `bin/abathur`），`which abathur` 当前无输出。**须机主执行的部分**：用 npm 发布包装回（`L-ENV-SEGREGATION` 的 E2 面），验收判据=`readlink -f "$(command -v abathur)"` 不落在 `/home/lab/workspace/harness/Abathur` 内。
2. `pre-commit` 补 `name` 白名单（已执行）；`pre-push` 扩为拦 `refs/heads/main` 直推（**未做**，见 6.3 待裁）。
3. `scripts/verify-all.sh` 增第 8 步 `foreign-commits`（已执行，`steps=8`）。
4. 历史处置：44 笔仍在 `main`（未发布）。**先逐笔裁定**（`docs/AUDIT-PROMOTIONS-20261103.md` 第七节第 7 条，裁定人非本席、须人类签认），再二选一 **留机主裁**：A. 保留并逐笔标注 `PENDING-ADJUDICATION`（不改写历史）；B. 剥离（改写历史，需重算全部台账哈希锚）。未经逐笔裁定不得选 B——会误删本席合法提交。

### 6.2 结构（需设计，非本轮一人可完成）
- 写者隔离的三种可行形态（代价递增）：① 仓面改为 `lab` 只读 + 专用写组（同 uid 无效，需 uid 分离）；② 每产线独立 uid + 组读（真正的隔离）；③ 仓迁入只读镜像 + 提交经队列由本席单点落地。
- 每日探针：`foreign-commits` + 全局安装指向检查（现成的 `port-exec-audit.sh` 可扩展）。

### 6.3 需人类裁
- 历史剥离 vs 标注（6.1.4）。
- 是否推 uid 分离方案（需改系统账户与所有产线启动方式）。
- 生产安装恢复的执行者（人类安装面）。

## 7. 机器回执索引

| 项 | 路径/值 |
|---|---|
| 十二笔改动并集 | 8 文件（见 §3）；44 笔总数：`git log --format=%h --author='abathur-seat <abathur@local>'` = 44 |
| 回滚后 src 与 4e213dd 差 | 空（`git diff --stat 4e213dd HEAD -- src/`） |
| 未推远端证明 | `git branch -r --contains` 十二笔全空；44 笔逐笔 `git tag --contains` 全空 |
| 全局 bin | `~/.npm-global/lib/node_modules/@tachikomagundam/abathur -> ../../../../workspace/harness/Abathur`（16:20+0800） |
| dist 状态 | `dist/cli.js` 664；`node dist/cli.js --version` 输出 `0.4.0` |
| 身份闸洞 | `.git/hooks/pre-commit`（只查 email）；`allowed-identities` 含 `abathur@local` |
| 账本完整性 | 事故窗口靠整点锚链：`ANCHOR-OK`+`RECON-OK` @ `2026-11-02T19:17:11Z`（`nightly.log:1639-1640`）；链头对账探针 `scripts/anchor-head-check.sh` 正例 rc=0 / 负例 rc=1（2026-11-02 实跑） |
| 取证原始输出 | `/tmp/opencode/{f1..o1}.txt`（宿主侧） |
