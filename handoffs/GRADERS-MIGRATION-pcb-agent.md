# 迁移工单：graders/pcb-agent/ 整体迁出阿巴瑟仓（2026-10-22，机主批准方案 4+5）

**状态：已执行完毕（2026-10-23T13:04:05+0800）。campaign 于 2026-10-23 凌晨正常终态（DONE，wallS 预算耗尽）。执行回执见 INTENT-LEDGER 同时刻条目。** 提前执行会抽掉在跑考试脚下的尺（runCommand/graderCommand/mutate 均指向本仓路径，每次 spawn 时按文件系统解析）。

## 为什么迁

2026-09-30（6f181ae 时代）PCB 线整套考试器材被提交进阿巴瑟仓，从此阿巴瑟仓工作树成了 PCB 线的生产面：污染 0.2.8/0.2.9 发布物、诱发 2026-10-22 晚三个跨线直提（5ff6b2b/96b618d/54883cf）。结构修复=器材归本线仓，跨线引用归零。

## 执行序列（每步带回执）

前置探测（同回合）：
```
ps -p 478729 -o pid,etime,args   # 须不存在（campaign 已结束）
tail -2 /tmp/engine-run-f43.log  # 尾行应有 campaign 终态
```

1. 在 PCB-Agent 仓建目标位并迁移（保历史用 git mv 做不到跨仓，用拷贝+删除两段式）：
   ```
   mkdir -p /home/lab/workspace/harness/PCB-Agent/graders
   cp -a /home/lab/workspace/harness/Abathur/graders/pcb-agent /home/lab/workspace/harness/PCB-Agent/graders/
   diff -r /home/lab/workspace/harness/Abathur/graders/pcb-agent /home/lab/workspace/harness/PCB-Agent/graders/pcb-agent   # 须无输出
   ```
2. 新注册基因组：PCB-Agent/genome.jsonc 内的器材路径从 `harness/Abathur/graders/pcb-agent/...` 改为 `harness/PCB-Agent/graders/pcb-agent/...`，重跑 `abathur genome add`（新指纹；旧指纹 1c1c6b3b2aa6aa07 退役但账本不动——账本在 PCB-Agent/.state/abathur/ledger.jsonl，谱系不断）。
3. 阿巴瑟仓删除器材并提交（具名删除，非批量）：
   ```
   git rm -r graders/pcb-agent
   git commit -m "separation: migrate pcb-agent graders to PCB-Agent repo (lane binding, 2026-10-22)"
   ```
4. PCB-Agent 仓提交新增器材。
5. 验证：PCB 席跑一次 `--dry-run` campaign 确认路径解析；阿巴瑟仓 `grep -rn "pcb" src/ scripts/ docs/ plugin/ genomes/` 须零命中（考题材料 SR4-19 等例外——它们只引用考题文本不引用路径，逐条人工确认）；npm pack 内容零 PCB 字样。
6. 双仓台账各自落账（[line:pcb] / [line:abathur]）。

## 不做什么

- 不动 .state/abathur/ledger.jsonl（PCB 线账本谱系，与器材位置无关）。
- 不改阿巴瑟 main 上 5ff6b2b/96b618d/54883cf 三提交（随本工单整体迁走即覆盖其内容，历史保留）。
- campaign 结束信号出现前，本工单只准准备、不准执行。
