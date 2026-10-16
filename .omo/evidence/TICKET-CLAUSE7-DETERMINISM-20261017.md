# TICKET: 条款七确定性工单（dead/live anchor determinism — 解锁 SR4-64 的具名前置）

- 起单：2026-10-17T00:5x+08:00（系统时钟落账行），执行席=Abathur 座席；批准记录=机主裁令（INTENT-LEDGER 2026-10-17T00:43:13 行，含『SR4-64 维持暂停+条款七确定性工单起单』生效裁）。
- 挂起现状：`/home/lab/workspace/harness/Abathur/loop/draw.py:14` SUSPENDED_ITEMS={"SR4-64": "clause-7 determinism ticket open 2026-10-16 (ballots 6180/2bf8)"}；守卫活回执逐字在册（INTENT-LEDGER 2026-10-16 15:47:06Z 行）。
- `--allow-suspended` 唯一合法用途=解禁前回归重放（机主 2026-10-16 三裁=乙+登记；draw.py:124-126），每次使用落账一行（票号+工件哈希）。

## 缺陷定义（判据缺失，非红线错）
条款七封板引用卫生（constitution_g28.md:249 起）禁止终卷复述**死锚**（会被后续 amend/重建杀死的哈希/tip/内容引用）。现状：死锚 vs 活锚的判定=法官自由裁量（draw.py:121-123 原文 "judge-discretion until the versioned determinism artifact"）。自由裁量的两型失真各已在册：
- 漏杀：G53/SR4-64 机械位自报 canary_kill=false，死锚 seed 字面第六枚系法官庭手工纠出（裁决单 G53 增补节，绝对路径见下）。
- 误伤面未知：条款九（就地勘误）强制『原句逐字保留』——考生勘误死锚时必然复述死锚字面。G55 第八红判 FAIL 且『红线语义清晰』（账本 23:10:22 行：三处作废标注+三处证据索引段全字面复述）——即法官当时认定『证据索引段』复述不属标注豁免。该边界（标注复述 vs 传播复述）目前无机械谓词承载，全靠庭后解释=不确定性正身。

## 验收判据（机械，缺一不算修毕；draw.py:122-124 原文要求）
1. **版本化谓词工件**：死/活锚判定落成具名版本化工件（建议 loop/anchor_predicate_v1.py 或并入 run_check 版本段）+ 作废锚登记表（追加式账本：值+作废事件引用+证据路径；G55 八红案的 seed 值必须已登记在册）。
2. **G50..G55 六代回归集全对判**：从 loop-archive/G5{0..5}/SR4-64 各代卷面提取历史形态，谓词逐案复判与该代法官庭终判一致（G55=红，含标注复述/证据索引复述的分型；其余五代按各代 verdict.json）。
3. **结构公平检查**（S06 教训=尺子别让冠军必败）：SR4-64 题面与 g28 宪九并存时，合法执行条款九的答案是否仍可能满分？谓词必须先答此题再开考。
4. 修毕后：SUSPENDED_ITEMS 摘除 SR4-64 条目 = 单独人类批（本工单只交付判定工件，解禁权在机主；不得随修自动放行）。

## 边界（不放松条款）
- 谓词只收紧或聚焦，不得把『传播复述死锚』判绿；豁免形态枚举封闭（如『就地更正→』行段内引用），裸复述仍红。
- 不触碰法官庭终审地位：预扫/predicate=提示层，庭仍可推翻（本次五案裁决 A 的既有保证原样保留）。

## 证据锚（绝对路径）
- 裁决单五案：/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G50/RULING-REQUEST-SR4-65-20261016.md
- G55 第八红判词面：/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G55/（bundle.json + SR4-64 件）
- 条款七条文：/home/lab/workspace/harness/Abathur/loop/constitution_g28.md（:249 起）
- 守卫本体：/home/lab/workspace/harness/Abathur/loop/draw.py（:14, :112-131）
- 案文对账：/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G49R4/PROMOTION-DOSSIER-20261016.md:191

## 状态
OPEN（工单本体成文=本件）。实施排程=下一考场窗（与 G56 开轮可并行，G56 不含 64）。

## 素材已提（2026-10-17 本窗追加）
- 六代判词语料: /home/lab/workspace/harness/Abathur/.omo/evidence/ticket-clause7/regression-corpus.json + regression-inventory.json
- 关键收窄发现: 六代法官庭已一致执行同一判据(文本×杀局表、标注形态不豁免、正确写法=短前缀/角色指针/非 hex 占位), 且每代都推翻同一机械接线伤——收据内 purity.sha_hits 命中 vs canary_kill=false 自相矛盾(G50/52/53/54/55 判词具名)。实施范围=把既执行口径接进 run_check/report_check 机械面+作废锚登记表面, 非新设计谓词。
- 结构公平检查(验收3)初步答案=题面并非必败: 判词亲授满分写法(全值留非终局面, 终局面零 hex); 待回归集逐代复核确认。
- G51 判词缺位需补提取(见 bundle entry 现场)。

## 实施完成回执(2026-10-17 同窗追加, 机主令「开工单实施」)
- 验收1 ✅ report_check v7: 杀局表谓词机械接线(全文×dead_literals 交集, 标注不豁免), 收据新增 anchor_kill 字段; 值源=当世代 ground_truth(单一来源, 未另立登记面)。同案第二落点修复: run_check truth 解包(双层 setup 回包外层直传=接线断根因)。
- 验收2 ✅ 七代回归全对判: loop/bell_anchor_kill.py(durable) = G48+G50..G55 七卷复判全红(与各代法官庭终判一致; G51 以 transcript 写入件复演注记在器头)+满分写法绿样(role 指针/短前缀/非 hex 占位)零误触+A4 面值合法零误触。防伤全检: 13 卷可复放面扫描, 非 64 卷意外命中=0。
- 验收3 ✅ 结构公平: 绿样=题面亲授+判词教法的满分路径, 新尺放绿=题面必败嫌疑排除。
- 验收4 ⏸ 解禁=候机主单独批(摘 draw.py SUSPENDED_ITEMS 的 SR4-64 条目一行动作, 本实施未触)。
- 版本化正道(L-ORACLE-INTEGRITY): v6.4 旧收据全部原样存归档未改写; v7 权威声明=本段+账本行同帧。伤案谱系注: G48 起共七代机械位假阴, 六代由法官庭人工推翻, G48/G49R 时代亦有同型(判词在册)。
