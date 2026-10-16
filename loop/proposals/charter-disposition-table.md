# 票面锚定处置表（生成器产物, 共 59 行 = v1:28 + v2:24 + v3-BALTHASAR:7; CASPER-v3 残页条目以机主携件 ①-⑫ 并入 §F 人工段）
# 生成时刻: 2026-10-19? 以文件 mtime 为准 | 源票面: /home/lab/.sibyl/spaces/{91fc,a70b,ea46}/
# 列: 票主#序 | 原句短引(96字) | 落点(待 v4 起草席填) | 判定(adopt/partial/open 待填)

| # | 轮·票主#序 | 原句短引 | 落点 | 判定 |
|---|---|---|---|---|
| 1 | v1·BALTHASAR#1 | A1 判据主体换成人级花名册身份（name+key fingerprint，对齐 L-STATE-ATOMIC 注册链），sid 只作辅助；判定元组扩为 (identity, role, in | _TODO_ | _TODO_ |
| 2 | v1·BALTHASAR#2 | A1 与 B3 互引并定单一权威源：『修复≠认证』永久；『评审该器具所判工件之资格』自修复时刻起时间窗 W 后恢复；W 全典只定义一次。 | _TODO_ | _TODO_ |
| 3 | v1·BALTHASAR#3 | A3/A4/A5 的强制执行点改为可回溯判定：预提交钩子仅作便利，违规判定以哈希链账本+审计脚本事后重算为准（断链/无回执/混 lane 即红），并写明本机 git 钩子不是安全边界。 | _TODO_ | _TODO_ |
| 4 | v1·BALTHASAR#4 | A4 增加链连续性判据：回执 N 的前像哈希必须等于回执 N-1 的后像，不符=DISPUTED；可恢复引用只准指向追加式账本条目，禁用可删改的 ref/tag 作为唯一引用。 | _TODO_ | _TODO_ |
| 5 | v1·BALTHASAR#5 | A5 永久↔战役降级或 TTL 删除必须引用人类签署条目或盲审收据；TTL 天数、夜扫覆盖范围（含仓外 scratch）数值化定义。 | _TODO_ | _TODO_ |
| 6 | v1·BALTHASAR#6 | A2 lint 改白名单+有效性检查：仅显式标 global 的核心条款可入全局文件；derived_from 必须解析到存在条款号；『静默覆写禁止』给出机械判据（注解中出现规则差分=覆写，须 | _TODO_ | _TODO_ |
| 7 | v1·BALTHASAR#7 | 生效路径补三条：①评审席会话标识登记于账本，机主逐条批准前先按 L-BLIND-AUDIT 对照六卷宗执行链核验独立性；②吸收评议会 must-fix 须逐条落 adopt/reject+理由 | _TODO_ | _TODO_ |
| 8 | v1·BALTHASAR#8 | A3 明确：未覆盖路径写入 fail-closed 并给人类快签通道；为座席专属临时工作区设默认道以免道主表变更全卡人类签署（瘫痪防护）；表 lint 断言无歧义嵌套前缀；superseded | _TODO_ | _TODO_ |
| 9 | v1·BALTHASAR#9 | A0 例外条目须携带可复算的人类签名凭据（对应花名册 key binding），无凭据的『人类点将』文本一律视为伪造。 | _TODO_ | _TODO_ |
| 10 | v1·MELCHIOR#1 | 改写A1机械判据为器具-工件隶属制：建立器具登记表（器具及其版本谱系哈希→所判工件范围），凡sid对器具I有author/repairer记录（含任一版本），即禁任I所辖工件的judge/ce | _TODO_ | _TODO_ |
| 11 | v1·MELCHIOR#2 | 规定A1账本三元组由引擎会话库派生或可被DB对账复核（承接L-BLIND-AUDIT'自报身份不作数'），角色取封闭枚举；定义裁决周期；把身份锚从单sid扩展到续跑/换sid的执行链，链条内换 | _TODO_ | _TODO_ |
| 12 | v1·MELCHIOR#3 | 在草案正文内定义A0：人类逐案书面点将、账本条目须引用人类签署条目、限期限器限范围，使A1护栏可评估；否则删除该引用并另设泄压机制。 | _TODO_ | _TODO_ |
| 13 | v1·MELCHIOR#4 | A3增设与L-GOVERNANCE-REMEDY的调和条款：跨道修复经道主表登记的工单授权合法化（授权随工单路由，非消息转办），并明确无主/新增路径的默认处置=隔离挂账出工单，既非静默放行亦非 | _TODO_ | _TODO_ |
| 14 | v1·MELCHIOR#5 | A3限制superseded-by为同层或严格向下（附律永不得向上覆写核心），装配器lint检查声明方向；写明核心条款冲突时以A2层级为准，堵住平级声明绕开分层的口子。 | _TODO_ | _TODO_ |
| 15 | v1·MELCHIOR#6 | A3冲突计数改为滚动窗口、给出'跨道写冲突'的机械识别器，并规定拆分评审由机主或独立席执行，涉事道主不得自审。 | _TODO_ | _TODO_ |
| 16 | v1·MELCHIOR#7 | A4前像回执入L-STATE-ATOMIC哈希链账本（条目含写者引擎sid、链接前项回执），并发写以链序裁决；在pre-commit之外增加开机/定期'当前哈希vs回执链'对账扫描覆盖非git | _TODO_ | _TODO_ |
| 17 | v1·MELCHIOR#8 | 生效路径补三条：评议会盲审席的会话标识须证明不属于起草链并经引擎DB对账在册；'修正吸收'后向机主呈修正前后草案sha256与逐字diff，禁止起草者自证吸收完成；明文规定本修正案自身的评审适 | _TODO_ | _TODO_ |
| 18 | v1·MELCHIOR#9 | B3给出W的默认数值与调值权属（人类签署条目），或将该条降级为待定参数并注明不得在W定值前援引为已生效安排。 | _TODO_ | _TODO_ |
| 19 | v1·CASPER#1 | A1判据改为按执行链归属判定：评审/认证条目的session须与起草/修复条目的链条（父会话/发起来源，可经引擎DB对账）做不相交校验，仅查sid相等即封死轮换会话绕过；沿用L-BLIND-A | _TODO_ | _TODO_ |
| 20 | v1·CASPER#2 | A1增设'器具→裁决'边：账本每份裁决须登记所用器具（门/尺/考卷）sha清单，凡评审者同链曾author/repair该清单内任一器具即违规——堵'修尺者判卷'漏边。 | _TODO_ | _TODO_ |
| 21 | v1·CASPER#3 | 消除A1内部矛盾：'一个裁决周期内只任一职'与'修器之席永远不出健康证书'冲突，且'裁决周期/同窗口'未定义；二选一——周期须给出机器可读边界，或改为永久禁+具名冷却期。 | _TODO_ | _TODO_ |
| 22 | v1·CASPER#4 | A1判据改fail-closed：角色、artifact_sha256、所用器具字段任一缺失=违规成立（缺字段视同双角相交），不得缺席即过检。 | _TODO_ | _TODO_ |
| 23 | v1·CASPER#5 | 生效路径补自指条款：评审本草案的盲审会话须登记'与起草链不相交'的引擎DB对账回执，无回执的评议通过不得计入生效路径；否则按草案自己的判词作废。 | _TODO_ | _TODO_ |
| 24 | v1·CASPER#6 | 补写A0条款全文或将其'人类逐案书面点将+落账'机制内联进A1，删除悬空引用。 | _TODO_ | _TODO_ |
| 25 | v1·CASPER#7 | A3为'同工件互斥双裁'补机械判据：裁决账本按(工件sha256)唯一有效裁决，第二纸=自动DISPUTED呈人，禁止各出一纸。 | _TODO_ | _TODO_ |
| 26 | v1·CASPER#8 | B3定义时间隔离窗W：给出时长（如N个裁决周期）与隔离语义（同链席在多长窗口内不得任相邻角色），使小机构替代机制落地。 | _TODO_ | _TODO_ |
| 27 | v1·CASPER#9 | A4明确核验器触发时机（逐写即时/夜扫/两者），并校验前像回执内'可恢复引用'实际可达（备份ref存在性断言），防指向空洞引用的假安全。 | _TODO_ | _TODO_ |
| 28 | v1·CASPER#10 | A2病句'核心无源可溯即无效'语义方向写反（应为'附律无核心源可溯即无效'），lint依据文本必须消除歧义。 | _TODO_ | _TODO_ |
| 29 | v2·BALTHASAR#1 | A1.4 独立性改正证明：每份裁决/评审条目登记召集人身份锚，召集人须为机主或花名册预登记的具名独立召集面；无链 DB 回执仅证「非子席」，不足以证独立，禁止座席以自行 spawn 的无头会话 | _TODO_ | _TODO_ |
| 30 | v2·BALTHASAR#2 | 全部机械判据终核面外部锚定：回执链创世哈希+每期链末摘要钉到座席无写权介质（机主持第二介质或禁 force-push 远端），A4.4 对账改为「当前值+本机箱头 vs 外部钉摘要」；引擎 D | _TODO_ | _TODO_ |
| 31 | v2·BALTHASAR#3 | 审计脚本/核验器自身入器：按 L-ENGINE-ISOLATION 走版本化冻结发布，升级须机主批+前像回执；A4.3「审计者身份独立」给出机械判据=被运行脚本 blob 哈希与外部钉版本一致 | _TODO_ | _TODO_ |
| 32 | v2·BALTHASAR#4 | A1.3 补：空数组=缺失；「工件落在某已登记器具所辖范围而该裁决未登记此器具」=违规；定义所用器具的 DB 派生机制（评分器调用强制留痕）；无器具登记的目测裁决不得出完成态/证书，仅可出呈人 | _TODO_ | _TODO_ |
| 33 | v2·BALTHASAR#5 | 补回 v1 遗漏的「修复」重要性边界（触谓词/判据代码=repair，文档注释≠）；instrument_id 的 git blob 谱系根改为注册制声明，并加继承条款：fork/改名/重写既 | _TODO_ | _TODO_ |
| 34 | v2·BALTHASAR#6 | W 加日历时间下限（如 ≥2 周期且 ≥48h），并写明按器具所属道计数，堵同日微周期刷空冷却窗。 | _TODO_ | _TODO_ |
| 35 | v2·BALTHASAR#7 | A3.1 工单批准人点名=受影响道主身份锚或人类签署条目，A3.5 识别器增判「批准条目签署者归属」；A3.2 道主表匹配一律用规范化绝对路径（realpath），lint 拦截经符号链接/绑 | _TODO_ | _TODO_ |
| 36 | v2·BALTHASAR#8 | A3.4 给「互斥」封闭裁决词表（批准/否决/挂账争议类），同 artifact_sha256 第二张互斥或附条件纸面一律自动 DISPUTED；A3.5 冲突计数按 (身份锚,面) 累计带衰 | _TODO_ | _TODO_ |
| 37 | v2·BALTHASAR#9 | A5.2 降级/删除所引盲审收据必须逐字引用该永久件的 artifact_sha256；A0 点将条目绑定案例 ID/nonce 与机读范围（路径前缀+instrument_id 集），一单一 | _TODO_ | _TODO_ |
| 38 | v2·BALTHASAR#10 | v2 文本内附 30 条 must-fix 逐条 adopt/reject+承接条文号的对照表（现缺；采样已实锤至少「重要性边界」一条无承接）——否则「全量吸收」不可核，生效路径第 2 条对  | _TODO_ | _TODO_ |
| 39 | v2·BALTHASAR#11 | 发布最小临时条款请机主即刻签署（例：门配置自本日起每写落前像回执；座席自召集之一切复审按「自查参考」降级；AGENTS.md 全局段现文本摘要外部钉+夜扫比对），堵批准期零防护真空。 | _TODO_ | _TODO_ |
| 40 | v2·CASPER#1 | Attach the 30-row must-fix disposition table to the artifact itself (original text quote + claus | _TODO_ | _TODO_ |
| 41 | v2·CASPER#2 | Enumerate 器具隶属表、道主表、器具登记表 in the A4.1 shared-authority-surface list with receipts on every write | _TODO_ | _TODO_ |
| 42 | v2·CASPER#3 | Require every '引擎 DB 对账' receipt to include a snapshot of the DB (file path + sha256 + message c | _TODO_ | _TODO_ |
| 43 | v2·CASPER#4 | Add predicates for the two unmapped incident vectors: (a) name the multi-lane shared git tree as | _TODO_ | _TODO_ |
| 44 | v2·CASPER#5 | Tighten A3.1: require any cross-lane write justified under L-GOVERNANCE-REMEDY to cite, in its 工 | _TODO_ | _TODO_ |
| 45 | v2·CASPER#6 | Define the W clock source (which clock, which receipts' timestamps, and behavior on clock adjust | _TODO_ | _TODO_ |
| 46 | v2·MELCHIOR#1 | A0 增位阶条：列举 A0 可悬起的条款面；建议 A1.1 出证豁免不可悬起，或改为 A0 兼程所出证书永久标注『兼程』、未经事后独立盲审复证自动无效——二选一，不许『永久』与紧急通道并存而互 | _TODO_ | _TODO_ |
| 47 | v2·MELCHIOR#2 | A1 独立性判据改一句话定死：『同锚并集∧执行链』——同一身份锚跨任意链（含新起根会话）一律非独立；并为链关系补完整性：裁决落账时同步链导出件入哈希链账本（可对账、可重算），引擎 DB 不得作 | _TODO_ | _TODO_ |
| 48 | v2·MELCHIOR#3 | 隶属表加机械判据：器具→工件所辖范围由器具登记表内容导出（路径 glob/登记表模式），漏登按最大范围 fail-closed，低报即违规；隶属表变更只认人类签署条目（与 B5 道主表同构）。 | _TODO_ | _TODO_ |
| 49 | v2·MELCHIOR#4 | A4 加外部锚：回执链末端哈希定期具名外投（远端 git 提交/机主周期签署条目二选一，由机主点名），灾备第二介质须至少一份在座席写路径之外；月度抽验的期望值改为人类签署数据。 | _TODO_ | _TODO_ |
| 50 | v2·MELCHIOR#5 | A5.2 删 TTL 倒挂：凡被未结裁决/DISPUTED/挂账工单引用的工件 TTL 自动冻结；战役→删除与永久→战役同档需回执（盲审通过或人类签署），到期只准转隔离区不准自动删。 | _TODO_ | _TODO_ |
| 51 | v2·MELCHIOR#6 | A2.3 给可执行判据：注解仅准引用条款号+逐字引原文，非逐字引文的任何复述自动判覆写嫌疑并路由独立席事后审；或删『按伪造回执论』改为可申诉的挂账处置。A3.4 的『互斥』定义=同 artif | _TODO_ | _TODO_ |
| 52 | v2·MELCHIOR#7 | 本版文末即附『v1 30 条 must-fix × v2 处置』逐条对照表（adopt/reject+条款引用），随 v2 同呈议会核销——不许把吸收证明推迟到 v3 而要求本版按已吸收论。 | _TODO_ | _TODO_ |
| 53 | v3·BALTHASAR#1 | §E 重建为票面 24 条（7+11+6）：a70b/CASPER.md 的 C1-C6 逐条立行、各引条款号判定 closed/partial/open；并按 C1 原文『delete th | _TODO_ | _TODO_ |
| 54 | v3·BALTHASAR#2 | §D 重算为票面 28 条（9+9+10）：删除 row27-29 重复行与 row30 无票面来源行，补 CASPER-v1 #6/#8/#9 三行；两表每行须附票面锚（reply 文件绝对 | _TODO_ | _TODO_ |
| 55 | v3·BALTHASAR#3 | 花名册+独立召集面名册列入 A4.1 共享权威面：逐写落哈希链回执、按 P1 外钉、变更仅认机主键写入（与 B5 道主表同构）；否则 P11『可复算 key 凭据』与 P4『预登记召集面』的信 | _TODO_ | _TODO_ |
| 56 | v3·BALTHASAR#4 | P1 补『无写权』机器判据：外钉介质成立须附当场权限探测回执（以受审座席身份实际写入尝试失败的回显+独立席或机主确认条目），远端选项须附禁 force-push 保护配置的可复核证据；无探测回 | _TODO_ | _TODO_ |
| 57 | v3·BALTHASAR#5 | P3 断言强制留痕挂钩 P8：每次运行核验器的『在场脚本==外钉版本』断言落回执条目（脚本 blob sha+外钉序号+时刻），裁决/证书条目须引用该回执编号，缺编号按 P8『无器具留痕不得出 | _TODO_ | _TODO_ |
| 58 | v3·BALTHASAR#6 | P7 文本回写票面语义：『判据代码、参数与承载判据的配置改动=repair』（引 a70b/B#5 与 91fc/B#1 原文），并规定 repair/author 事件在器具登记表实时登记， | _TODO_ | _TODO_ |
| 59 | v3·BALTHASAR#7 | P10 补 A0 悬起面白名单：逐条列举兼程授权可悬起/不可悬起的条款（至少覆盖 A1.1/A1.2/A1.3/A3.4），未列入『可悬起』者默认不可（fail-closed），回应 a70b | _TODO_ | _TODO_ |
