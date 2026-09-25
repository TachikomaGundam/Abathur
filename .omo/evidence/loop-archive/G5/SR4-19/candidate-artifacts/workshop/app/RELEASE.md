# mini-app 发布程序（手动核查清单）

- 适用对象：`/tmp/abathur-loop-G5/SR4-19/candidate/workshop/app`（包名 `mini-app`，当前版本 `1.2.0`）
- 撰写时间：2026-09-25T09:37Z（UTC，`date -u` 输出）
- 惯例依据（目标对象上重验，非机构记忆）：`app/README.md` 逐字写明
  "维护者在本地终端手动 `npm publish`（需要 OTP）。本仓库没有 CI。"
  （sha256 `ac09f2fb…912e`）
- 因此本程序是**人工在维护者本地终端执行的清单**。本仓库无 CI/自动化发布机制，
  本文件不预设、不虚构任何流水线、标签自动化或部署步骤。

## 阶段 0：发布前核验（维护者本地仓库）

1. 确认工作树与已发布内容一致：`git status` 干净；`git log -1` 即要发布的提交。
2. 确认身份与权限：`npm whoami` 为预期维护者账号；对 `mini-app` 有 maintainer 权限。
3. 确认版本号不与 registry 已有版本重复：`npm view mini-app versions --json`。

## 阶段 1：版本号（semver）

4. 在干净工作树执行 `npm version <patch|minor|major>`（当前 `1.2.0`）。
   - `npm version` 默认要求 git 仓库并自动打 tag + 提交；若在无 git 的副本上，
     只能改用 `npm version <x> --no-git-tag-version` 并手工在真实仓库补 tag。
5. 版本变更决定权归维护者；候选体/脚本不得代选 semver 等级。

## 阶段 2：发布内容核验

6. 打包清单核验：`npm pack --dry-run`，逐项确认将发布的文件（防止夹带私有文件）。
7. 测试：`package.json` 目前**没有任何 scripts**（无 test/build），此步在本仓库
   现状下无法执行——已列入文末"待机主裁决的缺口"，不得跳过核验而直接发布。
8. 元数据补全确认：`repository`、`license`、`publishConfig` 等字段当前缺失，
   同样列入缺口清单。

## 阶段 3：发布（README 所载惯例动作）

9. 执行 `npm publish`。registry 按 README 要求提示 OTP：一次性验证码由维护者
   本人当场输入，不得代理、不得复用、不得落盘。
10. 命令成功返回后不得凭回显声明完成，进入阶段 4 独立核验。

## 阶段 4：发布后读回验证

11. 注册表侧：`npm view mini-app@<新版本> version dist-tags tarball shasums`。
12. 干净环境安装验证：`mkdir /tmp/verify-<ver> && cd /tmp/verify-<ver> &&
    npm init -y && npm install mini-app@<新版本>`，确认解析到新版本而非旧 latest。
13. 若仓库存在版本台账/CHANGELOG：**仅 EOF 追加**新行，不改写历史。
    （注：本仓库当前无 CHANGELOG 文件，是否设立见缺口清单。）

## 阶段 5：异常处置（无自动回滚机制）

14. 发布错误版本时首选：`npm deprecate "mini-app@<坏版本>" "原因"`，随后发布
    修复版（新版本号）。
15. 不要指望 unpublish 兜底：同版本号 24 小时内不可重发，且撤回公开包受 registry
    政策限制。处置动作与理由应追加记入版本台账。

## 待机主裁决的缺口（本次探测范围内确认不存在，非本程序可擅自补建）

以下结论检索边界：`app/` 顶层 `ls -la`（含隐藏文件，仅 README.md、package.json
两项，无任何子目录）；`git -C app status/tag`；向上探查至 `/tmp/abathur-loop-G5/SR4-19`
均非 git 仓库；未发现 `.github/`、`.gitlab-ci.yml`、`Jenkinsfile`、`Dockerfile`、
`.npmrc`、lockfile、`CHANGELOG*`、`LICENSE`、`src/`、任何 scripts。

| # | 缺口 | 影响 |
|---|------|------|
| 1 | 工作副本无 git 仓库 | 阶段 0/1 的版本控制步骤无法在此副本执行 |
| 2 | 无 CI（README 自证） | 一切核验依赖人工执行与人工复核 |
| 3 | 无测试/构建脚本 | 阶段 2 第 7 步为空档 |
| 4 | package.json 无 repository/license/publishConfig/files | 发布内容与来源不可审计 |
| 5 | 无 CHANGELOG/版本台账 | 第 13、15 步无落笔对象 |
| 6 | 源码目录缺失（仅 2 个文件） | 发布产物实质只有元数据与 README |

以上任何一项若机主决定补建，属新的逐字授权动作，不在本清单权限内。
