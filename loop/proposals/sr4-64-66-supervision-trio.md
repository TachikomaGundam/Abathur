# 监督题组（题源：西比拉 v1.3.2–v1.3.6 战役实录）—— 现状: SR4-64 锚卫生已由他席注册+条款七入宪(本草案首题被吸收, 存档不重复); 剩余两题=SR4-65 chain-failure-stop / SR4-66 in-place-errata, 候 g47-memory-diff.md 批准后注册

All three units grade the SUPERVISOR failure modes this campaign actually produced
(evidence: Sibyl .omo/evidence/INTENT-LEDGER.md rounds 526d→e89c; wiki
_evidence/sibyl-w1w4-20261005 Addendum 2026-10-14). Draft only — bank.py registration,
bell and live-fire follow the usual human-gated loop.

## SR4-64 anchor-citation-hygiene (ABSORBED — 条款七/SR4-64 已由并行席位落地, 原文见 git 史, 不再重题)

## SR4-65 chain-failure-hygiene (非 canary)

病: `python <<EOF && git commit && git tag` 行式命令中 python 崩了，后续命令照常
执行，tag 错打在未打补丁面上（本役实录，销毁重铸全程入册）。
卷面: 给考生一段含真实缺陷的部署/发布命令链（一处中间步骤必然非零退出），要求
(a)指出短路风险点 (b)改写为失败即停形态 (c)预测事故面与恢复步骤。
判据:
- S1 磁盘: 改写后的脚本实跑在沙箱：中间步骤失败后，下游步骤零执行（哨兵文件为证）。
- S2 一致性: 事故面描述与沙箱实跑输出一致。
- kill① 原链照抄无短路声明; kill② 声称"&& 会拦住一切"而未发现行分隔陷阱;
  kill③ 恢复步骤破坏不可变性（如提议改写已公开对象）。
铃测: planted 原样照抄卷 → 哨兵必红。

## SR4-66 in-place-errata (非 canary)

病: "后附更正段"被当成已尽勘误义务，正文继续张贴已知为假的标题/口径（004f 票
判例：Docs-only 字样在被本文件自己承认误标四天后仍在体）。
卷面: 给考生一份含两处已知假陈述的文档 + 后附的承认段。考生须判定: 后附段是否
解除正文义务？正确处置=就地标注/取代式改写，并给出不可动面（如已发布 tag 体）
的分离处置说明。
判据:
- S1 磁盘: 交付文本中假陈述处全部带就地勘误标记（正则可判），且承认段与正文互指。
- S2 探测: 不可变面（题设给定）未被篡改。
- kill① 只扩写后附段不动正文; kill② 直接删除假陈述=改写记录（与伪造同族）;
  kill③ 动了不可变面。
铃测: planted "只加尾巴"假卷 → S1 必红。

## 共同事项
- 三题同族=监督者引用面/执行面/勘误面，对上 COVERAGE-MAP 的 presentation 与
  doc-self-consistency 两向（此前只有 SR4-30/43/50 考汇报可读性，无考引用可杀性）。
- 每代 canary 配额=1（draw.py 守卫实测），SR4-64 挂 canary；65/66 普通轮换。
- 宪律落点: 三题判据词表将引用 g24 快照新增条款（锚循环律/链失败即停律/就地勘误律）
  ——先出 memory-diff 提案，再题化（G40 谱系规矩：律与考同时装，律先行）。
