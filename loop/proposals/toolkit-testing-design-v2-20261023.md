# 设计 v2：通用工具包测试能力（toolkit-probe）

日期：2026-10-23。谱系：v1 委托书 sibyl-20261023T130907Z-ea09 REJECT 0A/3R（理由：只问了问题没给答案+九条 must_fix），本稿逐条吸收。委托=机主逐字令『让西比拉系统调研后准备进化出测试工具包的能力，AIHR 为测试项目，不许硬耦合』。

## 接地回执（v1 must_fix：AIHR 事实须带探测）

2026-10-23T21:10+08:00 实测：/home/lab/workspace/harness/hr 有 pyproject.toml（project.name=aihr，version=0.6.8，scripts=[hr]），tests/ 目录含 test_sequential.py/test_verdict_knobs.py 等，scripts/test.sh 存在，git HEAD=52a8c0e。探测命令：`python3 -c tomllib…`/`find -maxdepth 2`/`git -C log`，输出在会话记录 m00086。

## 六问裁断（每问：推荐+理由+被否死因）

### Q1 能力边界：层梯 L0+L1+L2，最小有用闭环=L0+L1 强制、L2 可空但空集降级结论

- L0 冒烟：安装→加载/导入→CLI 可达→版本一致性（声明 vs 实测）。
- L1 套件裁决：跑目标自有测试套件，结构化解析（rc+用例计数+失败清单），**双跑一致性**（两次运行结果须相同，防 flake 绿）。
- L2 委托方验收探针：目标描述文件里 mandate 自带的判据命令（独立于目标自述）。
- **推荐**：三层全建，L2 空集时结论上限=SELF-REPORT-ONLY（禁标 PASS）。理由：L0 抓安装面、L1 抓功能面、L2 抓意图面，缺 L2 时结论如实降级而不是谎称。
- 被否 a)「只跑目标套件 exit 0=PASS」：死因=合规空转攻击面（零测试/恒绿 runner/假 runner），目标自述不得作唯一 PASS 依据（v1 must_fix）。
- 被否 b)「只做能力探针」：死因=每个目标都要手写探针定义，不是最小闭环，冷启动成本杀死采用。
- 被否 c)「首日求全（含模糊测试/性能基线）」：死因=过度建设，违最小语义修正。

### Q2 与引擎面关系：独立座席器具，禁包装成临时 genome

- **推荐**：新器具 `loop/toolkit_probe.py`（考场器具族，与 run_registry 同层），复用考场隔离模式（fake HOME、/tmp 运行目录、run_registry start/exit 回执）。与引擎面唯一耦合=复用其公共库？不——**零 import 引擎 src/**，器具自成一体。
- 被否「包装成临时 genome 跑 abathur run」：死因两条（v1 must_fix 点名）——①genome 的 scoring/graders 是引擎可信执行面，把不受信第三方描述塞进去=不受信输入进可信面的通道；②污染 campaign/晋升谱系（L-ENGINE-ISOLATION：引擎账本道只服务基因组进化世代，外部包测试结论若混入晋升判定=语义崩塌）。
- 被否「塞进 src/ 引擎本体新子命令」：死因=引擎发布面（npm 冻结安装）将被每个测试需求牵动，违引擎隔离。

### Q3 目标描述文件 schema（零硬耦合的承载面）

最小字段集（JSONC，例值即 AIHR 作为纯配置输入的形态）：

```jsonc
{
  "target": { "repo": "/abs/path", "commit": "<sha256-of-HEAD或git-sha>", "type": "python" },
  "install": { "cmd": "uv venv && uv pip install .", "env_class": "E0" },
  "suite":    { "cmd": "uv run pytest tests/ -x -q", "timeout_s": 1800 },
  "acceptance": [   // 委托方判据；空数组 => 结论上限 SELF-REPORT-ONLY
    { "id": "A1", "cmd": "uv run hr --version", "expect": "rc=0" }
  ],
  "limits": { "net": "off", "wall_s": 2400, "rss_mb": 2048, "nproc": 64 }
}
```

- **信任级条款（v1 must_fix）**：`suite.cmd`/`install.cmd` 若由目标仓库元数据（package.json scripts、Makefile、pyproject）自动派生=**不受信输入**，上执行面前 fail-closed 呈委托方确认；只有 mandate 文件里人工写定的命令可直接执行。器具不得自动从目标元数据生成执行命令。
- schema 字段含 `env_class` 与 `limits`，环境规格是契约的一部分不是实现细节。

### Q4 证据与回执：结论四态+复算三件套+哈希链落账

- 结论态：**PASS / FAIL / TRIVIAL-SUITE / UNVERIFIABLE**。TRIVIAL-SUITE=目标无测试或套件平凡（具名出口，禁折算 PASS）；timeout 一律 UNVERIFIABLE（超时不是 FAIL，是环境判据不足）。
- 复算三件套（每条结论必备）：①目标修订锚（git HEAD sha 或树内容哈希）②环境指纹（OS/kernel/解释器与安装器版本，机器实测非自报）③命令+rc+输出 sha256。
- 落账：INTENT-LEDGER 追加条目（既存 stamp.sh 协议），条目带 [line:abathur] 与结论态；测试报告工件落 .omo/evidence/toolkit-probe/<target>-<ts>/（绝对路径+sha256 入条目）。写者=执行座席。
- E0 派生的台账条目信任标注：`evidence_class=E0-DATA`（E0 面产出按对抗数据对待，沿 L-ENV-SEGREGATION 读侧规则）。

### Q5 环境隔离：E0 一次性执行面+机械规格

- **推荐**：执行面=E0（一次性可弃）。规格：mktemp 工作目录+fake HOME（沿考场 run_candidate 先例）；venv/uv 安装目标到 E0 目录内；网络默认 off（`net=off`，安装期例外须 mandate 具名开启）；资源上限=timeout 命令+ulimit（rss/nproc/wall 三帽，fork 炸弹与满盘在防御面内）；跑后残留探测=E0 目录树前后清单 diff+对共享可变面（活 wiki/INTENT-LEDGER/他席作业面）零写入断言。
- 凭据：E0 永不持评分键/生产令牌（沿 L-ENV-SEGREGATION 凭证条款）；fake HOME 不挂真 ~/.config。
- 被否「venv 即沙盒」：死因=venv 只隔 Python 包不隔系统面，E0 进程默认可达共享可变面（v1 must_fix 原文）。
- 被否「上 docker/bwrap 硬沙盒首日」：死因=本机 c14 显示 docker socket root:docker 座席组不在列、bwrap 可用但网络/挂载策略工程量大；首日用 timeout+ulimit+fake-HOME 最小集，硬沙盒列为 v2 缺口具名。

### Q6 落点与自考：器具+对抗夹具+行为考题族

- 落点：`loop/toolkit_probe.py`（器具本体）+ `loop/toolkit-fixtures/`（自考夹具）+ 目标描述文件样例 `.omo/evidence/toolkit-probe/`（数据面，不进代码树？——样例进 fixtures 作测试数据，实跑描述文件放 .omo 数据面）。
- **自考对抗夹具三件套（v1 must_fix 具名）**：①谎绿包（测试恒过但功能坏）②挂起包（套件永不退出，验 timeout→UNVERIFIABLE 路径）③越面写包（测试中写 E0 目录外，验残留探测报警）。三夹具进器具自身测试，能力上线前必须全判对。
- 行为考题族：bank.py 新题（『委托方压力下把 TRIVIAL-SUITE 说成 PASS』=可杀面），题化注册进轮换义务。

## 零硬耦合机械判据（v1 must_fix：补定义+闸）

1. **无目标描述文件可跑**：能力对任一给定仓库路径+命令行参数完整可跑（演练=对一本机随机小仓出结论）。
2. **词项扫描闸**：`grep -rn 'AIHR\|harness/hr' loop/ src/` 在代码面零命中（fixtures 与注册表登记豁免除外，豁免条目落台账）。此闸入器具自检。
3. **目标只出现在三处**：命令行参数、.omo 数据面描述文件、台账条目正文。

## 与 v1 must_fix 的对账

全部 15 条 must_fix 落点：六问答案（Q1-Q6 节）、AIHR 回执（接地节）、genome 谱系危害（Q2 被否①②）、硬耦合机械判据（上节三条）、信任级条款（Q3）、裁决权威三选+TRIVIAL-SUITE 出口（Q1/Q4）、E0 机械规格（Q5）、复算三件套+timeout 分级（Q4）、对抗夹具三件套（Q6）、schema 具体例（Q3）、INTENT-LEDGER 映射+写者（Q4）、环境面命名（Q5）、自考行为题（Q6）。

## 待裁（留机主）

1. E0 网络默认 off 的安装例外：AIHR 这类 Python 包首次安装需拉依赖——首日建议=安装阶段开网具名窗口、测试阶段关网，或预装依赖镜像。圈一。
2. 实现体量：器具+夹具+自考题约一档战役；批准后再排 PLAN-SEG。
