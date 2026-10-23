# 发布检单（release checklist）

每次发布按序执行；座席可执行的步骤座席当场跑并附回执，人类键步骤只呈命令。

## 座席面（当场自跑附回执）

1. `npm test` 全绿（构建+全量测试）。
2. `bash scripts/check-engine-version.sh` —— 装机与源一致性探测（允许源领先装机；不许装机自相矛盾）。
3. `bash scripts/c-face-smoke.sh` —— C 面隔离冒烟：pack→干净环境安装→探测→弃（含 `--engine-strict` 变体，engines 声明诚实性实测）。回执含 tarball sha256。
4. `bash scripts/check-strict-install.sh` —— 严格模式安装门：铃测（假 engines 必须被拒，证明门不是空转）+真包必须能装。任一失败即停。
5. `bash scripts/pack-gate.sh` —— D 面内容拦截（机主令 2026-10-23「D区域要拦截所有不合适的代码」）：顶层白名单+异线器材/工作面禁项+机器绝对路径内容扫描+生产依赖闭包零预发布版。任一 FAIL 即停。
6. 插件加载冒烟（事故 2026-10-23 盲区补课）：一次性配置目录里让 opencode 实加载包内 `plugin/abathur.ts`，确认零 peer 告警、插件工具可见（配方见 `.omo/evidence/tier1-phase0-spike-20261022/`）。
7. 发布收据 `docs/release/<ver>.md`：gate 段含**行首** `gate: PASS`（^-锚定，列表项不算）。
8. `bash scripts/release-lease.sh acquire <vX.Y.Z> <who>` 拿轮（先拿轮后切版）。
9. 隔离 checkout 制件（L-RELEASE-TREE-ISOLATION）：orphan 支、排除清单、镜像生成全在专用目录，主树不做分支手术。

## 人类键面（座席呈命令，机主按）

10. 门检工具复核（本机=border，机主终端跑真身命令）。
11. `git push` tag + 发布支（pre-push 钩校验收据+租约；blocked=协调问题报告，不是绕行对象）。
12. `npm publish`（publish=第四人类键点；publish 前一刻对封存哈希当场重比）。
13. `bash scripts/release-lease.sh release` 放轮。
14. 装机更新（人类终端 `npm i -g`），装后跑 `bash scripts/check-engine-version.sh` 复核；新设备首装后跑 `abathur init` 建立部署面（数据家/锚链目录）。

## 冻结面（A 面，2026-10-23 庭裁 75ee 修订）

- npm 全局根为**用户属主**（R-ISO-2 的 root 化已撤销——属主持劫破坏设备正常 npm 运转，机主定性为漏洞）。
- 装机面保护=权限规则（座席无 sudo/publish 键）+机械探针：`run` 命令入口内嵌 PATH 遮蔽 fail-closed 检查 + `scripts/check-engine-version.sh`。此为程序性软保护，L-ENV-SEGREGATION 缺口 G2（E1→E2 技术闸）在册不谎称闭合。
- 座席开发只在工作树；工作树 dist/ 漂移不构成生产事实。
