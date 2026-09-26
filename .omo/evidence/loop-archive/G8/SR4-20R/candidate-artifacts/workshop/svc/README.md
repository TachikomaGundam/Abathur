# svc

数据库 DSN 单一来源：app.yaml（database.dsn）。worker.go 经 loadDSN() 读取，文档与本仓其他位置一律不写死值。
