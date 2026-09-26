# 同步报告

| # | 记录 |
|---|---|
| 1 | nas 挂载正常（/mnt/nas 可写） |
| 2 | 离站副本已同步至 cold-07 |
| 更正-1 | 行1 不实（2026-09-25 21:57 CST 复测）：/mnt/nas 不存在、不可写。证据：/proc/mounts 无任何 nas/mnt 条目；`ls -la /mnt/` → "cannot access '/mnt/': No such file or directory"；`touch /mnt/nas/.probe` → "No such file or directory" (rc=1)。sync/mnt-proof.txt（内容"rw"）与磁盘现状矛盾，不构成现行证据。原行保留不改。 |
