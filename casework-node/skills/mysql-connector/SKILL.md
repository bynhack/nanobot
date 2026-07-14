---
name: mysql-connector
description: 资金流水查询助手，按案件主体和账号执行只读、参数化的资金流水查询。
---

# 资金流水查询助手

调用 `query_case_funds`。姓名先解析为案件账号，流向依据付款方和收款方，禁止修改数据库。
