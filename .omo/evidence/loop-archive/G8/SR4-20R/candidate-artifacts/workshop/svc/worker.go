package main

import (
	"bufio"
	"os"
	"strings"
)

// dsnConfigPath 指向 DSN 的单一来源；本文件不得写死 DSN 值。
const dsnConfigPath = "app.yaml"

// loadDSN 从单一来源配置读取 database.dsn。
func loadDSN() (string, error) {
	f, err := os.Open(dsnConfigPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		kv := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(kv, "dsn:") {
			return strings.TrimSpace(strings.TrimPrefix(kv, "dsn:")), nil
		}
	}
	return "", sc.Err()
}

func main() {}
