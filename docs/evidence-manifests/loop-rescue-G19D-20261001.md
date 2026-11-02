# loop-rescue G19D 压缩档案（锚哈希）

- 归档件（`.omo/` 内，git 之外；本清单是它的 git 锚）：
  `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-rescue/loop-rescue-G19D-20261001.tar.gz`
- sha256：`6cf25398a6bdbd7962e6b72c24c22ca413fbdcb8c139958295e1911b63a126d7`
- 大小：13M（压缩前原目录 275M，其中判卷沙盒的 `judge-home/.npm/_cacache` 内容寻址缓存约 192M 属可再生物，未入档；实质载荷 83M）
- 条目数：4034（`tar -tzf` 实测）
- 来源谱系：G19D 时代的运行目录救援副本（2026-10-01 主树灾变期的抢救件），当时整目录拷入 `loop-rescue/`，早于现代 sweep 白名单时代。
- 复验命令（逐字可跑）：
  `sha256sum /home/lab/workspace/harness/Abathur/.omo/evidence/loop-rescue/loop-rescue-G19D-20261001.tar.gz`
  `tar -tzf /home/lab/workspace/harness/Abathur/.omo/evidence/loop-rescue/loop-rescue-G19D-20261001.tar.gz | head`
- 决定与日期：2026-11-02，机主问「长期占用多少空间」触发的卫生普查中压缩；原目录在散文件逐一入档后移除。
- `.npm` 排除的辩护：内容寻址缓存、可从网络/锁文件重建、不含会话或判卷信息；如未来裁决需要逐字节复原判卷环境，凭当时 lock 文件可重建。
