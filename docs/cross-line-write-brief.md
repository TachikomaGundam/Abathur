# 跨线写入问题总结 · 机主携带简报（2026-11-04）

用途：机主拿去阿巴瑟侧做升级的对账文件。逐条=现象/证据/损害/要的改动。

## 问题清单（按严重度）
1. **同机多仓无命名空间**：所有席位共享整机文件系统，任何票面写错路径就写进别的产线仓。
   证据：两次真实落错（R87、R108——OTM 票产物落进仓根裸 staging/，靠监工迁位善后）。
   损害：账本 MISSING/UNREGISTERED 震荡、门禁 FAIL、迁移工单耗墙钟。
   要的改动：**派单三要素硬校验**——每格 brief 无 `allowed_roots` 即拒派；写操作前路径前缀断言。
2. **回执路径与账本路径无机器对账**：落错仓在门禁上表现为“缺件+多件”两串噪声，无人被判责。
   要的改动：done 时自动跑 `receipt ∩ allowed_roots` 校验（wave_engine 已实现 DONE-POLLUTED 标记），产线仓门禁侧配套 `--expect-root` 参数。
3. **角色/工具白名单在会话启动时固化**：新建角色文件（OTM-runner）在旧会话不可派发，升级不能热生效。
   证据：R110 金丝雀 Unknown agent 实测。
   损害：每次进化交付物延迟一个会话周期才可见，验证节奏被拖慢。
   要的改动：角色表热加载（或明确文档化"重启生效"并在建造票里自动提示）。
4. **团队/编排引擎并发上限与等待语义**：maxParallelMembers=4 + 发射席 sleep 陪等 = 名义并发远小于机器 64 路上限。
   证据：R111 事故案（控制台个位数并发实拍 vs 云侧 limited=false）。
   要的改动：等待归零-token 轮询器（OTM 侧 cloudq.py 在建）、会话级 N 路扇出（wave_engine launch 打印单消息派发清单）。
5. **跨线读合法、跨线写非法的边界未工具化**：现状靠纪律条文+监工人肉审查。
   要的改动：只读跨线访问（如 OTM 队列账 CLOUDQ.tsv）用显式 `--read-only` 通道参数表达；写通道默认关闭，开启=机主键。
6. **禁触面清单分散在每种票面**：MODEL-REGISTRY/RULINGS/SHOT-MANIFEST/MANIFEST 各票重复手抄，漏抄即开口子。
   要的改动：禁触面进 `line_roots.json` 单源（wave_engine plan 阶段拒绝任何 brief 触碰面引用可写）。

## 阿巴瑟侧已在建的对应物（对账用）
- `Abathur/tools/wave_engine/`：manifest 校验（allowed_roots 必填+跨线根互斥）、N 路扇出、状态机、回执污染探测、饱和度仪表（本地在飞/64、云在飞、镜/小时、返工率）。
- `VideoGen/evolution/scripts/cloudq.py`：云任务中央账（提交/轮询/验收解耦，席位交号即退）。
- 条令：`Abathur/docs/parallel-dispatch-doctrine.md`。

## 机主待键（本简报附带）
- 席位模型升档（本地小模型→服务器强模型）：并发×质量=产出；现并发修好，质量档不升=更快生产返工。
- 跨线写：建议保持"默认禁止"，只开显式只读通道。
