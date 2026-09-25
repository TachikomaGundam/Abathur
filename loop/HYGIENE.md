# 进化工装卫生制度（loop 产物与 CLI 临时物的处置）

2026-09-24 由机主提问立项："进化过程中产生大量一次性 session 和临时文件，工作完成后应该怎么处置？"
执行工具：`loop/sweep.py`（默认 dry-run，`--apply` 才动手；一切删除记入 sweep-log.jsonl）。

## 分类与处置

| 类 | 内容 | 处置 |
|---|---|---|
| A 证据级 | bundle.json / BUNDLE.md / manifest.json / verdict.json / transcript.json / memory.txt / disk_probe / hgf prescan / judge packet / 被裁定引用的候选体写动文件 | **先归档后清理**：归档到 `.omo/evidence/loop-archive/<GEN>/`（含 sha256 清单），核验一致后才允许删 /tmp 原件。/tmp 是易失的——G3 运行目录消失已是实证，证据不得只活 /tmp |
| B 运行残留 | 候选体夹具树、假 $HOME、隔离 opencode.db、node 缓存 | bundle 关闭 + A 类归档核验后即可删（purge-loop） |
| C CLI 临时目录 | abathur-promote-* / bundle-* / graft-* / selfmut-* / self-* / runloop-* / brief-* / qa-*（各自的账本在 ~/.config/abathur 与 repo .state，临时目录只是 staging） | 操作终结即删；sweep 按白名单模式 + 年龄门槛（默认 >24h）执行；abathur-loop-*、abathur-sync-*、任何 <1h 的目录永不在此列 |
| D 禁触 | 不匹配白名单的一切；符号链接不跟随；未完成 bundle 的 loop 目录 | 永不删 |

## 一次性 session 的真相（答机主问）

- loop 的候选体/法官 session 全部活在**隔离 opencode.db**（run 目录内 fake HOME 下），从不写入机主主 DB——隔离本身即处置边界。
- session 的**可携带记录**是 run 时抽取的 transcript.json（消息+part 含工具入参，源自 DB 而非 stdout——FM-04 纪律）；DB 本体随 B 类删除，transcript 随 A 类永存。
- abathur CLI 的 bench/promote/self-mutator 产生的 session 同理活在各自 sandbox home（C 类目录内），删目录即处置。
- 机主主 opencode DB：零写入、零清理需求（隔离已保证），本制度不动它。

## 制度落点

- `bundle_close.py` 关闭一个 generation 后，下一步固定是 `sweep.py archive <gen>`（证据离 /tmp），再 `purge-loop`。
- 本制度本身可入题库：未来的候选体应考"完工后证据先归档、残留按类清除"（backlog 项，SR4 bank 待加）。
