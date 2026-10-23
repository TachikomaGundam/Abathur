# 阿巴瑟插件 Tier-1 深化设计件 v9 定稿（谱系 v1 cf06 0A/3R → v2 6012 1A/2R → v3 d6ac 0A/3R → v4 1eab 0A/3R → v5 fb02 1A/2R → v6 5a35 1A/2R → v7 8355 CANNOT_ANSWER（基建抖动）→ v8 **89d1 APPROVE 2A/1R 过会** → v9 定稿吸收否决席 MELCHIOR 3 条+BALTHASAR 2 条顺手项；追溯矩阵：附录 A=v1 19 条 / B=v2 14 条 / C=v3 17 条 / D=v4 11 条 / E=v5 7 条 / F=v6 6 条；各附录「落点」列一律指当前版本落点）

- v8 轮（过会轮）run sibyl-20261020T104515Z-89d1：MELCHIOR.md sha256 3e4b5019d2eaddb3f1bc248d7f9df26a29ca148cab1e98cef72fd49750355c45；BALTHASAR.md sha256 31a6524b7cf304a77e48f6fc0ac2ac61e6910b2478ef18fed4b02a12c0e17569；CASPER.md sha256 092e2b5769aa22f6ef86fba964e3dd7f678cb5a386e7501f4711ae8ede80cc13

评审记录锚定（复算命令一律 `sha256sum <绝对路径>`）：
- v3 轮 run sibyl-20261020T101338Z-d6ac：MELCHIOR.md sha256 b3b51488eb9713873c8df8170c5cee608170d583058e0c736b5217468e529509；BALTHASAR.md sha256 445dbc9f3c4bdd4b25567d543d97cdafd0ebe95d7821c87dabe213ba8259d910；CASPER.md sha256 ad05b6d0f364bdb581297b0cc082aadde9ea9165e65cbc30922f8b57f23fcbea
- v4 轮 run sibyl-20261020T102123Z-1eab：MELCHIOR.md sha256 bbab2c1d9ae59e641ad1ebbefb4f577fcaf69c7c876205baa183b3a1bfffdc66；BALTHASAR.md sha256 a8cc0646a60f4259a7021a80e6a5c27c4ba93dc5e8a281368f4cf69331818fc1；CASPER.md sha256 76fda45c0e6e0faf57a107377a44430369f4ff447d8876ce33b2aec3a2159f05
- v5 轮 run sibyl-20261020T102715Z-fb02：MELCHIOR.md sha256 902bb863479da075e8b3fa49ecf1b50a73252f3fce5b31e22b6bdb9492c823e8；BALTHASAR.md sha256 5425996c018ebeced2d574c36a8db64567fd26b197f8d267a4c1285f822524e2；CASPER.md sha256 f98a916bfba31dc116235bc875d6e963b0a5937099353329a4fd2f3df623da63
- v6 轮 run sibyl-20261020T104024Z-8355：MELCHIOR.md sha256 85651f7401e1532c65c457d2bbc5be51268a74eaea02f69616081aef6118f3e4；CASPER.md sha256 5aa1c6b9bd6f2d17a21180d2bf6e6385dcfb102552c80c3c1ad54a0eeb756529（BALTHASAR 票解析失败无落盘票件，在册为基建事件）
- 路径根=/home/lab/.sibyl/spaces/<runId>/

目标不变：纪律中机械可判的部分交给代码。API 依据（当场实读）：@opencode-ai/plugin dist/index.d.ts 的 Hooks 接口 + PluginInput{client, project, directory, worktree, serverUrl}（tool.execute.before 携带 sessionID，d.ts:235-241）。引擎接管协议依据（当场实读+评审席复验一致）：src/core/locks.ts:83 STALE_GRACE_MS=250、:93-100 EPERM=活、:131-141 活持有者不回收、:146-148 renameSync 原子接管、:153 接管后 rmSync 清扫；src/core/ledger.ts:196 acquireGenomeLock。引擎环境键依据（两轮实读，第二轮补漏）：第一轮 `grep process.env.` 得 ABATHUR_SELF_REPO / ABATHUR_HISTORIAN_REPO / ABATHUR_DEBUG 三键，**该声明被评审席以磁盘证伪**——src/config.ts:163 经 `env.ABATHUR_CONFIG` 点访问读取（非 process.env.X 形态，静态 grep 漏检）；第二轮补 grep `env.ABATHUR` 证实。另 src/core/spec.ts:144-145 记载基因组 repoPath 的 `${VAR}` 动态解析：键名来自基因组字节，静态枚举无法封闭——处理规则见 T3。

## Phase 0 spike（发布切前置，三测项各带判据）

在本机实装宿主挂测试钩子实测，报告入 .omo/evidence/：
- **S1 throw 分支**：tool.execute.before 里 throw ⇒ 判据=调用被阻断且错误文本回显到模型上下文（以会话记录为证）。
- **S2 args 改写分支**：before 钩子改 output.args.filePath+写 output.message ⇒ 判据=写入落在**隔离目录 `$XDG_STATE_HOME/abathur/quarantine/`（默认 ~/.local/state/abathur/quarantine/；排除在守卫面与仓库可写面之外；保留规则=30 天期限+100 件配额，每次拦截时 sweep：先删过期件，**仍超配额则按最旧件 FIFO 驱逐并 stderr 告警具名被逐件**（隔离面是暂存不是档案）；并发双拦截各写唯一文件名 <epoch>-<uuid> 互不干扰，用例在册）**且模型收到的 message 为钉死文案「写入被拦截并移至隔离路径：<path>」（验收逐字钉）。
- **S3 agent 遮蔽语义**：cfg.agent 注入与 ~/.config/opencode/agents/<同名>.md 并存谁生效 ⇒ 判据=实测生效方记录。
- 钉死宿主版本入报告，0.4.0 声明其为下限。S1 过→T2 拦截型；S1 不过→T2 走 S2 形态。

## 占用信号：引擎锁+心跳+进程反证（双层，判空闲必先过反证）

- `abathur run` 启动（任何 spawn 之前）写 `<ledger目录>/campaign.lock.json`：{pid, startedAt, runId, engineVersion}；运行期每 5 分钟 touch；正常收束删除。锁路径解析依赖 $ABATHUR_SELF_REPO。**兼容性决定（三选一已定，选降级）**：变量未设置或锁写失败（盘满/权限）⇒ **告警不阻断 run**（stderr 具名「占用信号降级：无锁，靠进程反证」）——双层信号的进程反证层正是为此存在；不构成对已装用户的破坏性变更，191 真实安装通道（无该变量的裸 `abathur run`）验收用例在册。
- **闸的每次写调用新鲜读锁态，永不复用 T1 的 60s TTL 缓存。**
- 锁存在时：kill(pid,0) 活（EPERM 视为活）∧ 启动时刻带容差比对（**proc_start ≤ startedAt ≤ proc_start+5s**；/proc/<pid>/stat **自末位右括号定位后**取第 22 字段（comm 可含空格/括号，含空格 comm 夹具用例在册），boottime 相对 jiffies 换算=boottime+starttime/CLK_TCK，与锁内 startedAt 同为 epoch 秒；/proc 不可读 ⇒ **占用待裁**不落 stale）∧ mtime 距今 ≤15min ⇒ 占用。pid 活但 mtime 超 15min ⇒ **占用待裁**（按占用+告警）。pid 死/启动时刻超容差 ⇒ stale 候选。
- **任一「判空闲」出口（含 stale 候选与无锁）必须先过进程反证**：模式集命中在跑写面子命令 ⇒ 占用+告警；未命中才判空闲。无锁且反证命中=覆盖锁写失败（盘满/权限）的静默 fail-open 面。**反证模式集覆盖 argv 各形态并各给用例**：裸 `abathur run`、`node <绝对路径>/dist/index.js run`、绝对路径可执行体形态、npx/符号链接包装形态（realpath 归一后比对）。**匹配算法钉死=argv 逐 token 精确匹配**（可执行体 realpath 命中注册表 ∧ 子命令 token 相等），禁子串命中（防编辑器打开同名字符串误判占用）；负例用例在册（同串非写面进程不命中）。
- 锁文件损坏 ⇒ fail-closed 按占用+告警。
- **模式集漂移义务（机制写死）**：引擎构建期从 CLI 命令注册表生成 `dist/engine-registry.json`（{writeCommands, envKeys}，引擎 0.4.0 同车交付物）。**生成规则 fail-closed 默认**：新命令无显式只读标注即视为写面入 writeCommands；envKeys 对账扫描语义=**按 `ABATHUR_[A-Z_]+` 令牌形态扫引擎 src/ 全文**（形态无关：点访问/下标/解构/重命名导入的具名字面键全部命中），去重结果必须与 registry envKeys 相等，不等 ⇒ 生成器/测试红；PATH 等非 ABATHUR_ 键不入对账面（注入白名单静态包含 PATH，不受漂移义务约束）。基因组 `${VAR}` 动态/计算键**具名豁免**（键名来自基因组字节，静态扫描对其无效——此界入明确不做残余清单，不得以真封闭枚举措辞掩盖）。**插件侧一致性测试的引擎解析源唯一**：与版本探针同源——由 `abathur --version` 解析出的安装版 dist 路径读 registry，**不读工作树**（worktree 与安装版不一致 ⇒ 测试红，验收用例在册；防 dev-link 漂移场景重演）。解析链可信性钉死：探测顺序=`command -v abathur` → realpath 归一 → 取其 dist/ 下 registry；**测试输出记录 registry 绝对路径+sha256**（与本机构处方逐字可跑/路径当场可解析纪律同标准）。**registry 缺席 ⇒ 测试红并提示升级引擎**（具名极性；运行期 FALLBACK-PROBE 容忍旧引擎与测试期要求注册表齐备不冲突——前者是运行韧性，后者是发布质量门）。
- **版本探针**：会话启动取一次 `abathur --version`，超时 2s，超时/失败 ⇒ FALLBACK-PROBE+告警；缓存 TTL 60s 复检。引擎 <0.4.0 ⇒ FALLBACK-PROBE 具名模式：闸占用判据=进程双通道为主信号（同一内嵌实现），T1 注入与闸决策行带标记。**发布序依赖具名：引擎 ≥0.4.0 先于插件安装**；混装占用验收用例在册。T5 工具「不喂闸」仅指工具面，闸内嵌实现与它同源。

## T1 开工状态注入（experimental.chat.system.transform）

- PluginInput.directory/worktree 初始化钉住门槛：仅当目录含 .omo/evidence/INTENT-LEDGER.md 时注入。
- 注入面：账本尾 3 条标题行+锁占用状态（含 FALLBACK-PROBE/占用待裁 标记）。≤2KB；60s TTL 缓存（仅展示面）；超时注入「状态未取到」占位。**T1 是纯信息面，T2 的信任永不来自 T1。**
- 宿主版本下限声明+升级观察义务。测试：门外目录零注入。

## T2 考题动笔闸（tool.execute.before）

- **守卫面（封闭枚举，单一权威源=本设计件，实现后为代码常量，宪章只引用）**：{loop/bank.py, loop/draw.py, .omo/evidence/INTENT-LEDGER.md, .omo/evidence/campaign.lock.json}。（锁文件入守卫面：堵 write 工具覆写锁伪造死 pid 判 stale 的旁路；引擎直写锁不经 edit/write 工具，不受影响。）
- **匹配维度**：filePath 按宿主 ctx cwd 解析+realpath 规范化；且与守卫面文件做 (device,inode) 相等比对（收硬链接旁路；残余：bind mount 异设备同内容，具名入册）。**apply_patch 逐 hunk 枚举全部文件路径逐一匹配**。
- **管什么**：tool∈{edit,write,apply_patch} 的写入；拦截依据=占用信号（每次新鲜读）；拦截语义=Phase 0 钉死分支。
- **bash 旁路在册**：管不到。补偿三层：T1 可见化；bash 命令文本含守卫面文件名时 tool.execute.after 告警行（启发式只告警，变量/通配旁路具名入册）；合法写入的账本声明义务留规则层。定位=**防手滑+可见化**；恶意面归人类批准门。TOCTOU（新鲜读锁与落盘间窗口）具名入册。
- **override 出口（人类痕迹+审计检出——措辞降级，诚实命名）**：先经 T4 落 kind=guard-override 条目（**占用期经 T4 写 guard-override 显式允许——落账通道不设卡，消费侧四验证才是拦截点**；验收用例在册），闸验证四项：①引用一条人类批准类账本条目，按其哈希在链内定位成功 ∧ **距今 ≤24h ∧ 正文具名指向本次守卫面目标文件** ②override 条目会话标识==当前写入会话 ③override 条目距今 ≤15 分钟 ④override 条目自身过末 k=3 前向链验证（防伪链外单条）。四项缺一拒放，验收用例逐条对应编号。**引用语义钉死：按文件+按窗授权——同一批准条目在 24h 窗内对其具名文件可被多次引用（非一次性消费），每次放行落闸决策行可审计**；批准条目不对具名文件以外的目标生效。**具名缺口 G-OVERRIDE-FORGE**：插件权限内无法机械证明被引条目真出自人类（空闲期账本可经 bash 直写，伪造只能事后审计检出）；强度=人类痕迹可定位+伪造成本抬高+审计可追责，非密码学验证。
- S1 失败分支：闸改 S2 隔离改写形态，message 钉文案见 Phase 0。

## T3 环境注入（shell.env）——位置即信任锚+真封闭枚举

- 文件=`~/.config/opencode/abathur-shell-env.json`（与 opencode.jsonc 同人类键面）；**仓库内 shell-env 文件不再被读取**。
- 启用前提：opencode.jsonc PluginOptions 人类钉 repoRoot ∧ realpath(directory)==realpath(钉值)。
- **键白名单（真封闭枚举，不用前缀通配）**：{PATH, ABATHUR_CONFIG, ABATHUR_SELF_REPO, ABATHUR_HISTORIAN_REPO, ABATHUR_DEBUG}（依据=两轮 grep 实读，含 config.ts:163 点访问形态的补漏）；PATH 仅 prepend；白名单外拒绝+告警。**基因组 `${VAR}` 动态键（spec.ts:144-145）具名豁免**：基因组声明的键属 campaign 环境、由跑器按 campaign 前置规程导出，不经 shell-env 注入面。**漂移义务同模式集形状**：绑定 engine-registry.json 的 envKeys 一致性测试，引擎新增读取键而白名单未更新 ⇒ 测试红。malformed ⇒ 忽略+告警不阻断。

## T4 账本追加工具（tool: abathur_ledger_append）

- **互斥**：mkdir 锁目录（原子）包裹 读末行→O_APPEND→fsync→读回末 k=3 前向链验证。锁目录内含 owner.json {pid, acquiredAt}。
- **崩溃接管严格镜像引擎协议**：仅当持锁 pid 死（ESRCH）或 owner.json 缺失且超 **STALE_GRACE=250ms（与引擎同值钉死）** 方可回收；活持有者不论锁龄不得回收。接管=renameSync 到 `<lockDir>.stale-<nonce>` 原子重 Claim（禁 rm+mkdir），随后 rmSync 清扫 stale 目录（镜像 locks.ts:153）；接管落 kind=lock-takeover 账本条目。**释放须 owner.pid 匹配方可删锁目录**。验收含双并发接管与「活而慢持有者不被抢」两用例。
- 锁获取超时（5s）或读回链断 ⇒ 拒绝追加（fail-closed）+返回断点行号。
- **撕行修复**：写入与 fsync 之间崩溃留半行 ⇒ 持锁状态下截断到末条完整行，落 kind=evidence-note 条目标记被截字节 sha256，再恢复服务。验收含崩溃中途夹具用例。
- **kind 封闭白名单**：T4 可写 kind={declaration, guard-override, lock-takeover, evidence-note}；**人类批准类条目不经 T4 落账**（只走终端直写通道）。**占用期经 T4 直写守卫面账本（白名单内全部 kind，含 guard-override）显式允许**：理由=T4 是账本唯一受管写通道且自带互斥+链验+sessionID 审计定位，T2 只 hook edit/write/apply_patch 不拦截插件直写；guard-override 的放行控制点在消费侧四验证（T2 节），不在落账侧。
- 路径解析：$ABATHUR_SELF_REPO/.omo/evidence/INTENT-LEDGER.md 或显式绝对路径，二选一；**$ABATHUR_SELF_REPO 未设置 ⇒ fail-closed 报错具名该变量**（入封闭测试清单）。

## T5 占用探测工具（tool: abathur_campaign_status）

- 只读便利面（喂人与 T1 展示）：锁判据+进程双通道并列，与闸内嵌实现同源。
- 验收封闭用例：pgrep 自匹配、插件自身进程命中、跨用户进程过滤、stale 锁、占用待裁。

## T6 playbook skill 化 + 随包 agent（单向派生）

- skills/abathur-loop/SKILL.md 随包。
- 人格唯一来源=包内 config 钩子注入 cfg.agent.abathur（可移植描述+硬线指针，零本机路径）；宪章唯一来源=~/.config/opencode/AGENTS.md；包内人格写死「宪章在用户级 AGENTS.md，缺席即停手声明」。本机 agents/abathur.md（Tier-0）在 0.4.0 装包后退役删除——以 Phase 0 S3 实测为准，若遮蔽语义实测相反则退役方向反转，不预设立场。

## 明确不做

- banner 剥离（单点 run-scenario.sh）；permission.ask/chat.params（越权面/职责重叠）；通用文件锁框架（YAGNI）。
- **环境隔离律机械执法面（DISPUTED 写冻结、_sandbox 读禁）暂不入 Tier-1**：需跨进程策略引擎与 wiki 网关，超出插件钩子面；条款级维持，具名缺口登记。
- 残余具名缺口：G-OVERRIDE-FORGE（override 人类痕迹非密码学验证）；bind mount 同内容异设备绕过守卫匹配；bash 旁路（含变量/通配绕过告警启发式）；T2 新鲜读锁与落盘间 TOCTOU 窗口；**静态扫描对动态/计算键环境读取无效**（基因组 ${VAR} 族，与 config.ts:163 点访问漏检同根因——漂移义务的实际强度以 ABATHUR_ 令牌字面扫描为界）。保留规则二分：stale 接管残渣 rename-then-rm 即清；S2 隔离目录 30 天+100 件配额 sweep（超配额无过期件按最旧件 FIFO 驱逐+stderr 具名告警）。

## 测试与验收（含对抗面）

- 插件侧：占用六态（含 stale 候选过反证才判空闲）；混装 FALLBACK-PROBE 占用用例；pid 复用与容差边界+含空格 comm 夹具；反证模式集三 argv 形态各一用例；T2 apply_patch 多 hunk+(device,inode) 硬链接+bash 旁路告警-only 钉字+bash rm 锁告警+write 工具覆写锁被拦；override 四验证缺一拒放+超 24h 援引拒放+非目标文件援引拒放+**占用期 T4 落 guard-override 后四验证全过放行**；T4 双并发链连续性+锁超时拒绝+双接管者并发+活而慢持有者不被抢+撕行修复恢复+$ABATHUR_SELF_REPO 未设置 fail-closed；T3 未钉值零注入+白名单外键拒绝+envKeys 一致性测试；T1 门外零注入+TTL；T5 五封闭用例；模式集与 engine-registry.json 一致性测试（**解析源唯一=版本探针安装路径；worktree 与安装版不一致 ⇒ 测试红；registry 缺席 ⇒ 测试红并提示升级引擎**）；S2 并发双拦截互不干扰+过期 sweep+超配额 FIFO 驱逐告警用例；**191 通道裸 `abathur run`（无 ABATHUR_SELF_REPO）告警降级但不阻断**用例。
- **引擎侧（0.4.0 同车）**：run 启动即写锁、5min touch、正常收束删除、崩溃留 stale 四用例；engine-registry.json 生成步骤入构建。
- **Phase 0 spike 报告（三测项）为 0.4.0 发布切前置。**发布序：引擎 ≥0.4.0 先于插件安装。
- 全量 npm test 绿+实机烟测（状态块可见、锁在被拦、合规 override 放行）。版本：随 0.4.0（不与 0.3.1 混车）。

## 附录 A：v1 19 条追溯矩阵（run cf06，M/B/C=三席）

| 条目 | 要旨 | 落点（当前版） |
|---|---|---|
| M1 | throw spike 先行钉版本 | Phase 0 S1 |
| M2 | 写面枚举或降级+bash 验收例 | T2 分级+旁路在册+验收 |
| M3 | T4 互斥+并发测试 | T4 |
| M4 | T1 cwd 解析+版本钉+门外测试 | T1 |
| M5 | 人格单向派生 | T6 |
| B1 | 全写面+realpath+封闭枚举含 draw.py | T2 守卫面+匹配维度 |
| B2 | T3 登记仓库限定+键名单 | T3（位置锚+真封闭枚举） |
| B3 | T4 flock/CAS fail-closed+k 条链验 | T4 |
| B4 | T5 模式集工件化+机械占用信号 | 占用信号+engine-registry.json 绑定+T5 |
| B5 | BANK_GUARD 改账本锚定或删 | T2 override |
| B6 | T1 占位下游语义 | T1 末段 |
| B7 | 对抗性验收用例 | 测试与验收 |
| C1 | T2 威胁降级或 bash 扫描 | T2 分级+after 告警 |
| C2 | override 人类批准工单入口 | T2 override①（+G-OVERRIDE-FORGE 降级） |
| C3 | T4 互斥+冲突 fail-closed | T4 |
| C4 | T4/T2 路径解析源禁模糊 | T4/T2 路径解析+未设置 fail-closed |
| C5 | T5 自匹配/自命中/跨用户用例 | T5 验收 |
| C6 | 三待裁给裁决建议 | v2 已给并沿用（S1 定颗粒/TTL/单向派生） |
| C7 | 隔离律机械面暂缺具名 | 明确不做 |

## 附录 B：v2 14 条追溯矩阵（run 6012，三席合并去重 11 项）

| 条目 | 要旨 | 落点（当前版） |
|---|---|---|
| 1 | 锁心跳+超期判占用待裁 | 占用信号（5min 心跳+待裁态） |
| 2 | 版本错配行为+混装用例 | 占用信号·版本探针+FALLBACK-PROBE |
| 3 | T4 锁目录 pid+时间戳+接管+恢复用例 | T4（镜像引擎协议） |
| 4 | 锁损坏 fail-closed+override 会话匹配 | 占用信号+T2 override② |
| 5 | override 人类签署或降级 | T2 override（降级+G-OVERRIDE-FORGE） |
| 6 | Phase 0 补 S3+S2 双测 | Phase 0 三测项 |
| 7 | T3 内容锚（移人类键面） | T3 搬家 ~/.config/opencode/ |
| 8 | 账本入守卫面 | T2 守卫面 |
| 9 | T4 接管镜像 acquireGenomeLock（renameSync 原子） | T4 接管段 |
| 10 | S2 降级分支 message 钉文案 | Phase 0 S2 |
| 11 | v1 19 条逐条追溯矩阵 | 附录 A |

## 附录 C：v3 17 条追溯矩阵（run d6ac；锚定见文首）

| # | 要旨 | 落点（当前版） |
|---|---|---|
| 1 | override 被引人类条目双约束（≤24h+具名目标） | T2 override① |
| 2 | T4 kind 白名单；人类批准类不经 T4 | T4 kind 白名单 |
| 3 | 无锁∧进程反证命中 ⇒ 占用 | 占用信号「判空闲必先过反证」 |
| 4 | 版本探针补超时/失败极性/TTL/EPERM/proc 不可读 | 占用信号·版本探针+判据 |
| 5 | T4 接管前置 pid 死+防双持 | T4 接管段 |
| 6 | 补 v2 矩阵+S2 隔离路径定义 | 附录 B+Phase 0 S2 |
| 7 | override 神谕定义或降级+缺口登记 | T2 override 降级+G-OVERRIDE-FORGE |
| 8 | apply_patch 逐 hunk | T2 匹配维度 |
| 9 | 硬链接 device+inode 或残余具名 | T2 匹配维度+明确不做 |
| 10 | T4 原子重 Claim+双接管测试 | T4 接管段 |
| 11 | 锁入 bash 告警枚举 | T2 bash 补偿（v5 起升级为锁入守卫面） |
| 12 | /proc 容差+不可读=待裁 | 占用信号（Δ=5s+末右括号定位+换算式） |
| 13 | T2 每次新鲜读锁 | 占用信号第二行 |
| 14 | T4 镜像引擎协议（ESRCH/renameSync/两用例） | T4 接管段 |
| 15 | override 降级措辞 | 同 7 |
| 16 | FALLBACK-PROBE 闸信号来源写明 | 占用信号·版本探针 |
| 17 | 勘误三处（ledger.ts:196/单一权威源/S2 目录具名） | 文首依据行+T2 守卫面+Phase 0 S2 |

## 附录 D：v4 11 条追溯矩阵（run 1eab，M5+B5+C1；锚定见文首）

| # | 要旨 | 落点（当前版） |
|---|---|---|
| M1 | /proc 启动时刻改容差比对+验收用例 | 占用信号（Δ=5s+容差边界用例） |
| M2 | 附录 C v3 17 行矩阵+d6ac 锚定 | 附录 C+文首锚定（64 位全值） |
| M3 | 引擎侧锁生命周期用例+发布序依赖 | 测试与验收·引擎侧四用例+发布序 |
| M4 | T4 三句（占用期非 override 直写允许+owner.pid 释放+STALE_GRACE=250ms） | T4（v6 修正为含 guard-override 全白名单允许） |
| M5 | 判定表矛盾消除：判空闲先过反证+锁文件归类 | 占用信号反证段+锁入守卫面 |
| B1 | 附录 C（与 M2/C1 同条） | 附录 C |
| B2 | T4 撕行修复+崩溃夹具用例 | T4 撕行修复段 |
| B3 | $ABATHUR_SELF_REPO 未设置 fail-closed 入测试 | T4 路径解析+占用信号+测试清单 |
| B4 | 模式集漂移义务绑定命令注册表+测试 | 占用信号·模式集漂移义务（engine-registry.json） |
| B5 | 残渣清理+隔离目录保留规则 | 明确不做·保留规则二分+S2 sweep |
| C1 | 附录 C（同 M2/B1） | 附录 C |

## 附录 E：v5 7 条追溯矩阵（run fb02，M/B/C=三席；锚定见文首）

| # | 要旨 | 落点（当前版） |
|---|---|---|
| 1 | override 死锁矛盾消除（占用期 T4 可落 guard-override，消费侧四验证为拦截点） | T4 kind 段+T2 override+放行用例 |
| 2 | 模式集绑定机制写死（engine-registry.json 生成+读取锚） | 占用信号·模式集漂移义务 |
| 3 | 附录 D+1eab 锚定 | 附录 D+文首锚定 |
| 4 | 64 位完整哈希+复算命令 | 文首锚定（复算命令 sha256sum <绝对路径>） |
| 5 | 保留规则拆分（stale 即清/S2 期限+配额） | Phase 0 S2+明确不做 |
| 6 | T3 白名单真封闭枚举（逐键列出+envKeys 一致性测试） | T3 |
| 7 | /proc 末右括号定位+含空格 comm 夹具+三 argv 形态用例 | 占用信号判据段+测试与验收 |

## 附录 F：v6 6 条追溯矩阵（run 5a35，M/B/C=三席；锚定见文首）

| # | 要旨 | 落点（当前版） |
|---|---|---|
| 1 | 环境键枚举重做（五键含 ABATHUR_CONFIG+${VAR} 具名豁免+诚实谱系） | T3 白名单+文首依据行 |
| 2 | engine-registry.json 生成 fail-closed 默认（未标注即写面/新增键未登记即红） | 占用信号·模式集漂移义务 |
| 3 | override 第四验证补编号（条目自身过 k=3 链验） | T2 override④ |
| 4 | S2 配额消歧（超配额无过期件=FIFO 驱逐+告警） | Phase 0 S2+明确不做 |
| 5 | 一致性测试解析源唯一（版本探针安装路径，不读工作树） | 占用信号·模式集漂移义务 |
| 6 | registry 缺席 ⇒ 测试红并提示升级（具名极性） | 占用信号·模式集漂移义务+测试与验收 |

## 附录 G：Phase 0 spike 实跑结果（2026-10-22，opencode 1.19.3，归档 .omo/evidence/tier1-phase0-spike-20261022/）

三个先行验证全部完成，两个无约束成立、一个带硬约束成立：

- **S1 throw 拦截 = 成立**。tool.execute.before 抛错 ⇒ 工具调用被拒，错误文本以 "✗ <cmd> failed / Error: <message>" 形态到达模型（throw-run.out 实测：模型收到 SPIKE-BLOCK-MARKER 并如实上报）。对照组 output.args 改写宿主侧生效（rewrite-run.out：echo SPIKE_REWRITE 实际执行了改写后的 echo REWRITTEN-BY-SPIKE）。
- **S2 system.transform = 成立但带硬约束**：**只能合并进 system[0]，禁止新增第二条 system 消息**——push 或 unshift 第二条均触发 provider 400「System message must be at the beginning」（local-qwen/vLLM 实测，两位置同败）；合并进 system[0] 则标记直达模型（模型逐字回显 SPIKE-SYSTEM-MARKER）。T1 实现约束据此钉死。
- **S3 PluginInput.$ = 成立**。keys=[$, client, directory, experimental_workspace, project, serverUrl, worktree]；$ 为 function，execFile 语义实测可用（echo 往返成功）。client.version 在该版本为 undefined（版本获取另寻通道）。

附带发现：opencode run 在模型调用 400 时仍 exit 0——harness 层判失败不能只看 RC。
