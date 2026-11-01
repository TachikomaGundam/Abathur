# 晋升决策备忘录（2026-11-01，G66 / G67）

用途：G66/G67 两份提名纸的独立审已按止损器熔断（第 16 轮不可自行发起）。按蜂群方案 B 的口径，晋升判断不再依赖纸面，改以**机器记录 + 探测回执**为对象。本备忘录只做索引与如实边界，不做担保。

## 你批之前能看到什么（全部当场可复算）

| 记录 | 位置 | 怎么复核 |
|---|---|---|
| G67 两题判决 CONVERGED / nominatable=true | `evidence/G67/bundle.json`（git 内） | `python3 loop/nomination_manifest.py G67 --run-probes .omo/evidence/nomination-history/G67/manifest.json`（66 格全量重跑） |
| G67 判卷记录独立锚 | 引擎会话库（title/created）+ `evidence/G67/SR4-64/judge-work/session.txt` | 同上，探测含引擎收据 |
| G67 跨族复判 | `evidence/G67/zerotrust/SR4-64.compare.crossfamily.json`（本地判 vs 云端 DeepSeek 判，`cross_family=true`，结论一致） | 文件内 `judge_model_v1/v2` 必填字段 |
| G66 同上但弱一档 | `evidence/G66/`（无跨族复判、判卷会话收据属早期形态） | 同左 |
| 零信任钉码 | `evidence/<GEN>/*/zerotrust-compare.json` 的 `pinned_tooling` blob | `git cat-file blob <sha>` 重算 |
| 四道闸 | `scripts/verify-all.sh G67` | 实测 `VERDICT=G67 GREEN steps=4 fails=0`（2026-11-01） |

## 如实边界（不粉饰）

1. **G66 比 G67 弱**：G66 没有跨族复判、没有引擎收据闸（当时未建）；它的提名纸被否十轮虽全是文字层，但按「证据不对等就不并表」原则，两代应分开批，不打包。
2. 所有闸输入仍同 uid 可写（缺口 G1 在册）——这些记录对「候选作弊」成立，对「操作者作弊」不成立。
3. 判卷是 LLM，跨族只消一半同族盲区；`MODEL-DIVERSITY-PENDING` 语义不变。
4. `evidence/` 入 git 是今天起的效果，G65 及更早只有部分镜像。

## 三个可选动作（只列，不催）

- 批 G67、G66 各自单独批或只批 G67；
- 都不批，让 G68 先在完整新证据面（含跨族）下跑一代再比；
- 对 G66 走「补证据再批」：对它补一次云端复判（一次模型调用）。

批准动作本身仍是人在终端做（`APPROVED <GEN> at <时刻>` 行首戳），我不代裁。
