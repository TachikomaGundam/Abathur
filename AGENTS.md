# Abathur 仓级规则（本仓 = 阿巴瑟进化引擎 + 考场）

本文件是本仓项目义务的唯一权威面。全局宪章（`~/.config/opencode/AGENTS.md`）只载通用纪律，不下达项目任务。两文件冲突时：通用纪律以全局宪章为准，项目事实以本文件为准。

本仓在 v2 重构后曾缺失本文件；2026-11-04 按当时机器事实恢复。任何“本文件说的架构”与磁盘冲突时，以当场探测为准，并先修本文件。

## 一、命令目录约定（2026-11-04 机主纠错后立，硬规则）

本机同 uid 多仓共用文件系统，当前目录是命令语义的一部分。凡写入呈报、工单、release 收据、交接件的命令块，必须满足：

1. 每条命令自带工作目录：`cd /home/lab/workspace/harness/Abathur && ...`。
2. 不得把裸 `git`、`npm`、`node`、`python3` 命令交给任何人；命令文本里没有 `cd` 或显式 `--prefix/--cwd` 即视为处方伤。
3. 需要其他目录时，在该条命令内写明完整绝对路径，不用“上一条的目录”隐含继承。
4. 派单给席位时，manifest 的每个 cell 必须有 `cwd`，且 `cwd` 必须落在该 cell 的 `allowed_roots` 内；派单行必须自带 `cd <cwd> &&`。
5. 相对路径只在 `cwd` 内解释；回执中的相对路径按 cell 的 `cwd` 解析，不按仓库根或监工目录猜测。

## 二、车道绑定（L-LINE-BINDING 本仓落点）

- 本仓座席 = 阿巴瑟席。他线座席进入本仓 = 客席：只读 + 最小语义修正，不得动本仓门条款、不得向本仓直提非本线代码。
- 跨线读可以显式进行；跨线写默认禁止。`tools/wave_engine/line_roots.local.json` 是本地产线根与禁触面的单源（gitignored；模板 `line_roots.example.json` 只含占位路径）；`wave.py plan` 对任何与其他产线根重叠的 `allowed_roots` fail-closed。禁触面属于本机策略，不得写进引擎代码或模板默认值。
- 不得把别线的台账任务搬进本仓执行；跨线委托必须带落点、命令、验收三要件。

## 三、开工三步

1. 读台账尾：`.omo/evidence/INTENT-LEDGER.md`（追加式证据账本；链协议在 `/home/lab/workspace/infra/anchor-chain/`，链数据在 `${ABATHUR_HOME:-~/.local/share/abathur}/anchor/`）。
2. 动共享状态前查占用：`node cli/abathur-v2.mjs surface show`，并在 `~/.local/state/abathur/runs/` 看活记录；不靠裸 `pgrep` 自匹配。
3. 动机构事实前查机构记忆：`historian_read` / `historian_search`；页过期就在笔记里标过期。

## 四、当前架构（v2，机器事实）

- CLI：`cli/abathur-v2.mjs`；包 `@tachikomagundam/abathur`，Node `>=22.22.1`，零运行时依赖。
- 内核：`kernel/{planning,identity,evidence,judge,surface,lane,hygiene,recurrence,gate}`。
- 考场：`exam/{bank,draw,runner,spawn,judges}`。
- 规则：`rules/`，22 条；`node cli/abathur-v2.mjs rules validate`。
- 派单引擎：`tools/wave_engine/`（manifest 校验、N 路扇出、状态机、回执污染探测、饱和度仪表）；条令 `docs/parallel-dispatch-doctrine.md`。
- 发布制件：`scripts/release-candidate.mjs`；按 commit 在临时目录制件，记录 sha256 与文件数。
- 证据：`.omo/evidence/`；追加式台账 `INTENT-LEDGER.md`。
- v1 已封存：`archive/v1-final` 标签；活跃树没有 `loop/`、`src/`、`dist/`，不得把 v1 路径当现行事实。

## 五、门（交付前全跑，命令带目录）

```sh
cd /home/lab/workspace/harness/Abathur && npm test
cd /home/lab/workspace/harness/Abathur && node scripts/scan-quality.mjs
cd /home/lab/workspace/harness/Abathur && node scripts/scan-coupling.mjs
cd /home/lab/workspace/harness/Abathur && node cli/abathur-v2.mjs rules validate
cd /home/lab/workspace/harness/Abathur && node cli/abathur-v2.mjs gate run
cd /home/lab/workspace/harness/Abathur && node kernel/exec/spawn-gate.mjs
cd /home/lab/workspace/harness/Abathur && node scripts/plan-check.mjs .omo/plans/refactor-abathur-v2.md
cd /home/lab/workspace/harness/Abathur && python3 -m pytest tools/wave_engine/tests -q
```

门不绿不得称完成。测试夹具不得写死 `/home/lab` 之外的开发机绝对路径；用 `os.tmpdir()` / state temp root。安装后的 CLI 不得用 `import.meta.url` 推仓根；用 `findRepoRoot(process.cwd())`。

## 六、发布

- 单仓单线：只在 `main` 演进，v1 由 `archive/v1-final` 标签封存；不再建第二仓或长期 v2 分支。
- 预推钩只拦 `v*` 标签；要求 `docs/release/v<tag>.md` 含 `gate: PASS`，且 `~/.config/abathur/release-lease.json` 的 `version` 精确匹配 tag。
- 租约、`git push`、npm 发布、全局安装是机主键；座席只准备提交、收据、候选包并跑完可自跑的门。
- 发布收据中的每条命令必须带 `cd /home/lab/workspace/harness/Abathur`。

## 七、已知边界（不得粉饰）

- 同 uid 隔离是信任边界，不是墙：恶意子进程可改自己的 run record、可读写同 uid 文件。更强隔离（独立 uid/VM）未实现，属人类政策。
- run record 只信 launcher 签发：`/abathur-run.json` 或 `runsDir()/<id>.json`，`origin=launcher`，运行 ID 匹配，pid 活。
- 链头是防篡改可检出，不是防篡改可阻止。
- Q 发布面已取消；按需制件替代常驻隔离 checkout。

## 八、并行与资源

- 相互独立的工作并发发起；波内不齐不候（deps 门控除外）。
- `wave.py launch` 一次打印全部可开火格，单消息扇出；席位只做“预检→提交→交号即退”，不在会话里睡觉等。
- 验收随到随验；返工走 `requeue`，`done` 是终态。
