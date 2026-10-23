# 发布检单（release checklist）

每次发布按序执行；座席可执行的步骤座席当场跑并附回执，人类键步骤只呈命令。

## 座席面（当场自跑附回执）

1. `npm test` 全绿（构建+全量测试）。
2. `bash scripts/check-engine-version.sh` —— 装机与源一致性探测（允许源领先装机；不许装机自相矛盾）。
3. `bash scripts/c-face-smoke.sh` —— C 面隔离冒烟：pack→干净环境安装→探测→弃。回执含 tarball sha256。
4. `bash scripts/pack-gate.sh` —— D 面内容拦截（机主令 2026-10-23「D区域要拦截所有不合适的代码」）：顶层白名单+异线器材/工作面禁项+机器绝对路径内容扫描。任一 FAIL 即停。
5. 发布收据 `docs/release/<ver>.md`：gate 段含**行首** `gate: PASS`（^-锚定，列表项不算）。
6. `bash scripts/release-lease.sh acquire <vX.Y.Z> <who>` 拿轮（先拿轮后切版）。
7. 隔离 checkout 制件（L-RELEASE-TREE-ISOLATION）：orphan 支、排除清单、镜像生成全在专用目录，主树不做分支手术。

## 人类键面（座席呈命令，机主按）

8. 门检工具复核（本机=border，机主终端跑真身命令）。
9. `git push` tag + 发布支（pre-push 钩校验收据+租约；blocked=协调问题报告，不是绕行对象）。
10. `npm publish`（publish=第四人类键点；publish 前一刻对封存哈希当场重比）。
11. `bash scripts/release-lease.sh release` 放轮。
12. 装机更新（人类终端 `npm i -g`），装后跑 `bash scripts/check-engine-version.sh` 复核。

## 冻结面（A 面，R-ISO-2 落地后生效）

- npm 全局根非座席属主（root）；座席对装机面零写通道。
- 座席开发只在工作树；工作树 dist/ 漂移不构成生产事实。
