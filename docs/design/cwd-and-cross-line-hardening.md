# 设计：派单工作目录与跨线写入硬化（2026-11-04）

## 目标

消灭两个同类事故面：

1. 派单命令没有约定当前目录，席位在错误仓库里执行相对路径。
2. 回执只校验“路径字符串”，不校验“这个路径是从哪个目录解析出来的”，跨线写入靠人眼。

## 不变量

- 每个 cell 必须有 `cwd`；`cwd` 必须是已存在目录，且位于该 cell 的 `allowed_roots` 之内。
- `allowed_roots` 必须非空；任何 root 不得与本机 `line_roots.local.json` 中其他产线的根重叠。
- `plan` 可带 `--expect-root`：所有 `cwd` 与 `allowed_roots` 必须落在该根内，否则拒绝，且不写任何 launchpack。
- `done` 可带 `--expect-root`：回执中出现的路径必须落在 `allowed_roots` 内；相对路径按该 cell 的 `cwd` 解析，不按仓库根猜测。
- 派单行必须自带 `cd <cwd> &&`；`wave.py` 命令一律绝对路径。
- 文档与呈报中的命令块必须显式写当前目录；禁止裸 `git push`、`npm test`、`node ...`。

## 影响面

- `tools/wave_engine/wave.py`
- `tools/wave_engine/tests/test_wave.py`
- `tools/wave_engine/README.md`
- 新增 `AGENTS.md`（本仓项目义务面，v2 重构后缺失）
- 本设计文档

## 回滚

单提交可回滚；wave 状态目录是运行数据，不在仓库内，回滚代码不删除历史 wave。

## 验收

- `python3 -m pytest tools/wave_engine/tests -q` 全绿。
- 新测试覆盖：缺 `cwd` 拒绝、`cwd` 越界拒绝、`--expect-root` 拒绝、派单行含 `cd`、相对回执按 `cwd` 解析。
- `npm test`、`node cli/abathur-v2.mjs gate run` 仍绿。
