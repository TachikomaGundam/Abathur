# 工单：锚链每代证据背书（infra 线落点）

发起席：阿巴瑟席（[line:abathur]）。收件线：infra（`/home/lab/workspace/infra/anchor-chain/`）。
发起日期：2026-11-03。状态：**待 infra 线接单**。本文由阿巴瑟席起草并投递，机主只需裁决「是否纳入排期」。

## 一、问题（可复算）

`/home/lab/workspace/infra/anchor-chain/stamp.sh:71` 的 `ledger-tail` 字段只取台账**最后 65536 字节**。因此某代写进台账的 `sums_sha256` 只在之后数小时内被链背书，随后滑出窗口，**不是永久背书**。

复算：

```
sed -n '71p' /home/lab/workspace/infra/anchor-chain/stamp.sh
# 期望：LEDGER_TAIL=$(tail -c 65536 "$LEDGER_F" | sha256sum | cut -d' ' -f1)  （行号以现盘为准）
```

后果：`.omo/evidence/loop-archive/**` 的 bundle 不在 git、不在锚链永久覆盖内，同 uid 可改写而不留痕。晋升审计只能对它们标 UNVERIFIABLE。

## 二、请求的改动（最小语义）

给 `stamp.sh` 增一个字段 `evidence-head`：每代收口时把「`bundle.json` 的 sha256 + 证据镜像清单 `SHA256SUMS` 的 sha256」写入戳记，而不是依赖台账尾部滚动窗口。

- 落点：`/home/lab/workspace/infra/anchor-chain/stamp.sh`（新增字段）+ 其 verify 侧同步认这个字段。
- 不允许：改变既有字段语义、放宽任何 fail-closed 判据。
- 兼容：旧戳缺该字段时 verify 判 `LEGACY`（不判败），新戳缺该字段判败。

## 三、验收判据（机器可判）

1. `stamp.sh` 连续两次运行，第二次的 `prev:` 指向前一次的 `self:`（现有链语义不变）。
2. 新增字段在 verify 侧可复算：给定代目录，`evidence-head` 与实际 `bundle.json` sha256 一致。
3. 负例：改 `bundle.json` 1 字节 → verify rc≠0，并打印失配字段名。
4. 宿主侧实跑回执（命令 + rc + 关键输出行）随工单回帖。

## 四、阿巴瑟侧的对接动作（已就绪）

- `scripts/anchor-head-check.sh` 已存在，用于链头对账（正例 rc=0、负例改 1 字节 rc=1）。
- 每代收口时 `scripts/publish-evidence.py` 已产出 `MANIFEST.json` 与 `SHA256SUMS`，字段来源现成。

## 五、为什么不由本席直接改

`stamp.sh` 属 infra 线工件。按车道绑定（L-LINE-BINDING），他线工件本席只做只读+最小语义修正，且此项改动会改变锚链字段语义、影响全机所有线的戳记格式——属该线门条款范围，须由该线接单与验收。
