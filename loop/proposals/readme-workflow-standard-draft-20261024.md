# README 工作流描述最低标准合约（草案 v1，2026-10-24）

## 目标
合格新接席（无机构记忆、干净机器视角）读 README 一屏内能答三问：它干什么 / 第一条命令是什么（可直接抄）/ 跑完看到什么算成功。

## 证据基座（六项目实测，2026-10-24，全部 path:line 可复验）
- 调研全文结论：border > Abathur > hr > SimpleCut > historian > PCB-Agent。
- 六者共同缺口：①无一带完整「第一次会话」走查（命令→真实屏幕输出→被拦/失败长什么样）；②「跑完看到什么算成功」普遍无 verbatim 样例（hr 无 hr status 样例、historian 无判卷示例、PCB 无成功定义、SimpleCut 收据仅有名）；③前置环境集体缺席（historian 的 wiki+/opt/wiki-ops 引用无出处 README.md:86-87、PCB 的 kicad-cli、hr 的 provider 配置、本仓 historian 实跑 env 散落两处）；④实现视角稀释用户视角首屏（border changelog 占 20% README.md:970-1229、本仓双语全文重复、hr 三路安装并列）。
- 可取形态正面实物：SimpleCut 阶段×契约×收据三列表+箭头链（README.md:18-29）；border 首屏装+跑+退出码合同表（README.md:7-11,564-576）；本仓 Quick start 附逐字期望输出（README.md:119-128）；hr CLI 计数由 guard test 钉死防漂移（README.md:222）；historian 单点冒烟带期望输出模式（README.md:40-46）。

## 合约条款（R1-R7）
- R1 首屏必含可抄的第一命令：安装+第一条可执行命令出现在前三屏内，单行可粘贴，零前置阅读。
- R2 每条 quick-start 命令附逐字成功输出样例（verbatim 屏幕片段，非转述）；失败面至少一条：最常见的一个失败输出+一行归因。
- R3 前置环境汇总页在 Quick start 之前：一表列全（服务/文件/密钥/env 绝对路径），README 内消费的一切路径与环境必须在该表有出处；禁止 /opt/xxx 凭空出现。
- R4 changelog 与架构论证移出 README（各自独立文件，README 只留链接）。
- R5 文档事实 guard test 钉死：README 中出现的命令行数/路径存在性/退出码表由仓库测试断言（照 hr 案），CI/npm test 覆盖。
- R6 管线型项目必含「阶段×契约×收据」三列表（照 SimpleCut 案）+一行箭头链；未完成阶段在表内直接标注，禁止完成度信息后置到末节。
- R7 双语不得全文重复：单语言权威源+另一语言镜像由生成或分文件，禁同一文件逐节双写（L-SINGLE-SOURCE）。

## 验收判据
- 机械闸：新增 scripts/readme-lint.sh——对指定仓 README 检查 R1（前 N 行内有命令块）、R3（README 引用的仓内绝对路径存在）、R4（无 changelog 段标题）、R7（单文件同文重复度阈值），rc≠0 即败。
- 人工闸：一个无机构记忆会话（subagent）只读 README，60 秒内答三问，逐问 pass/fail 落收据。
- 本仓 README 按标准整改为第一件实物；其余五仓出整改工单（各线自有面，本席不直改——L-LINE-BINDING 客席规矩）。

## 禁项
- 不为过闸而灌水（样例输出必须真实截取，禁止手写理想输出——R2 的 verbatim 由 guard test 与真实运行日志对拍）。
- 不在本合约硬耦合任何单仓特例；单仓事实只出现在证据基座节。

## 待裁（呈机主前需蜂群辩明）
1. R2 的「失败样例」是否强制两条以上？
2. R5 guard test 的 README 解析健壮性与误报率如何界定？
3. 存量五仓整改的优先序与豁免（PCB=文档缺位、historian=环境断链两类修法不同）。
