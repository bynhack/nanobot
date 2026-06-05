# 人事自然语言查询分析路由表

所有查询和分析优先走标准业务命令：

```bash
nanobot-webui-business hr business <query|get|analyze> <resource|topic> [options]
```

默认不要传 `--company`，让当前账号 policy 自动限定授权公司范围。只有用户明确指定某家公司时才传 `--company "公司全称"`。

## 高频快路径

| 用户问法 | 推荐命令 | 注意 |
|---|---|---|
| 我负责哪些公司？下面有哪些部门？ | `business query organization-tree` | 一条命令返回公司和部门树。 |
| 花名册汇总、员工概况、人员结构 | `business analyze headcount` | 不要先运行逐行花名册。 |
| 按公司、部门、在职状态汇总 | `business analyze headcount` | 已包含公司、部门和状态。 |
| 员工资料质量、重复身份证、重复手机号 | `business analyze employee-summary` | 用于质量提示。 |
| 合同覆盖率、哪些在职员工缺合同 | `business analyze contract-coverage` | 不要先列出所有员工。 |
| 未来 N 天合同到期 | `business analyze contract-expiry --days N` | 默认可用 `--days 90`。 |
| 月度绩效整体情况 | `business analyze performance --month YYYY-MM` | 只在用户要求明细时查逐行绩效。 |
| 低绩效名单 | `business analyze low-performance --month YYYY-MM --threshold 60` | 阈值按用户要求调整。 |
| 月度社医保增减员 | `business analyze insurance --month YYYY-MM` | 汇总和明细一起返回。 |
| 奖惩整体情况、缺签字附件 | `business analyze disciplinary` | 可按公司过滤。 |

## 员工与组织

| 用户问法 | 推荐命令 |
|---|---|
| 当前账号可见公司和部门 | `business query organization-tree` |
| 某公司有哪些部门 | `business query departments --company "公司全称"` |
| 现在有哪些员工 | `business query employee` |
| 某公司现在有哪些员工 | `business query employee --company "公司全称"` |
| 查某个员工信息 | `business get employee --name "姓名" [--company "公司全称"]` |
| 查某员工所有记录/生命周期 | `business query employee-timeline --name "姓名" [--company "公司全称"]` |
| 这个手机号是谁 | `business get employee --phone "手机号"` |
| 这个身份证是谁 | `business get employee --id-card "证件号"` |

## 合同

| 用户问法 | 推荐命令 |
|---|---|
| 某员工有没有合同 | `business query employee-contracts --name "姓名" [--company "公司全称"]` |
| 合同覆盖率是多少 | `business analyze contract-coverage` |
| 未来三个月哪些合同到期 | `business analyze contract-expiry --days 90` |
| 未来 30 天合同到期的有哪些 | `business analyze contract-expiry --days 30` |

## 绩效和社医保

| 用户问法 | 推荐命令 |
|---|---|
| 某员工绩效记录 | `business query performance-by-employee --name "姓名" [--company "公司全称"]` |
| 某月绩效明细 | `business query performance --month YYYY-MM [--company "公司全称"]` |
| 某月绩效整体情况 | `business analyze performance --month YYYY-MM [--company "公司全称"]` |
| 某月低于 60 分的人 | `business analyze low-performance --month YYYY-MM --threshold 60 [--company "公司全称"]` |
| 某员工社保记录 | `business query insurance-by-employee --name "姓名" [--company "公司全称"]` |
| 某月社保增减员 | `business analyze insurance --month YYYY-MM [--company "公司全称"]` |

## 人事异动、奖惩和用章

| 用户问法 | 推荐命令 |
|---|---|
| 某员工人事异动 | `business query personnel-change-by-employee --name "姓名" [--company "公司全称"]` |
| 今年有哪些转正 | `business query personnel-change --year YYYY --reason "转正"` |
| 某员工奖惩记录 | `business query disciplinary --name "姓名" [--company "公司全称"]` |
| 奖惩整体情况 | `business analyze disciplinary [--company "公司全称"]` |
| 某公司用章记录 | `business query seal-usage --company "公司全称"` |
| 某日期范围用章记录 | `business query seal-usage --from YYYY-MM-DD --to YYYY-MM-DD` |
| 某人相关用章记录 | `business query seal-usage --name "姓名"` |

## 路由禁止项

- 不要运行 `which` 或 `find` 查找 `nanobot-webui-business`。
- 不要读取 `runtime/`、`scripts/`、`tenant-runtime.json`、policy 文件或数据库配置来确认已知命令。
- 不要为汇总问题先运行 `business query employee` 或 legacy `list-employees`。
- 不要用 `count-all`、`data-quality-check`、`analyze-hr-risk-dashboard` 回答 scoped 用户的普通业务问题；这些是全局/管理类命令，可能被 policy 拒绝。
- 如果用户要新增、修改、导入、清理或删除，转到 `hr-db-ops` 的写入流程，先 preview，再确认，再执行和 verify。
