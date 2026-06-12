# 人事自然语言查询路由表

所有只读请求优先走结构化 `hr_business` 工具。下面的 CLI 形式只作为人工排障和兼容
fallback，并与 tool 参数一一对应：

```bash
nanobot-webui-business hr business <list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities> <resource|topic> [options]
```

默认不要传 `--company`，让当前账号 policy 自动限定授权公司范围。只有用户明确指定某家公司时才传 `--company "公司全称"`。

## 列表规则

- 裸 `list` 返回分页结果，默认 `page-size` 为 100，可用 `--page` 和 `--page-size` 翻页。
- 带业务过滤条件的 `list` 返回完整匹配结果；过滤列表不要使用 `--limit`。
- 所有 `list` 记录都会返回 `id`，后续精确读取使用 `business get <resource> --id <id>`。

## 高频路由

| 用户问法 | 推荐命令 | 注意 |
|---|---|---|
| 我负责哪些公司？ | `business list company` | 裸 list，可翻页。 |
| 某公司有哪些部门 | `business list department --company "公司全称"` | 带过滤，返回完整匹配。 |
| 员工花名册明细 | `business list employee --page-size 100` | 继续查看用 `--page`。 |
| 员工人数 / 人员结构 / 花名册汇总 | `business analyze roster` | 用 summary 和 groups 回答，不要从 records 自行计数。 |
| 某公司员工花名册 | `business list employee --company "公司全称"` | 带过滤。 |
| 查某个员工信息 | `business list employee --name "姓名"` → `business get employee --id <id>` | 先定位 id，再精确读取。 |
| 这个手机号是谁 | `business list employee --phone "手机号"` → `business get employee --id <id>` | 先定位 id。 |
| 这个身份证是谁 | `business list employee --id-card "证件号"` → `business get employee --id <id>` | 先定位 id。 |
| 员工资料风险 / 主档完整性 | `business analyze employee-profile` | 用资料质量 findings 回答，不自行数明细。 |
| 某员工合同 | `business list contract --employee "姓名"` | 如需精确记录，再用 `business get contract --id <id>`。 |
| 合同覆盖率 / 在职员工缺合同 | `business analyze contract-coverage` | 分清任意合同覆盖和当前有效合同覆盖。 |
| 未来三个月合同到期 | `business analyze contract-expiry --days 90` | 汇总和到期名单使用 analyze；单条明细再 get。 |
| 某月绩效明细 | `business list performance --month YYYY-MM` | 可追加 `--company` 或 `--employee`。 |
| 某月绩效汇总 / 低绩效分析 | `business analyze performance-month --month YYYY-MM` | 用 summary/findings 回答，不自行数 records。 |
| 某员工绩效记录 | `business list performance --employee "姓名"` | 如需精确记录，再用 `business get performance-review --id <id>`。 |
| 某月社保增减员 | `business list insurance --month YYYY-MM` | 可追加 `--status`。 |
| 某月社保异动汇总 | `business analyze insurance-month --month YYYY-MM` | 汇总增员、减员、签字件缺失等问题。 |
| 某员工社保记录 | `business list insurance --employee "姓名"` | 如需精确记录，再用 `business get insurance-change --id <id>`。 |
| 今年人事异动汇总 / 转正调岗离职统计 | `business analyze personnel-change --year YYYY` | 用 change reason 分组和 findings 回答。 |
| 今年有哪些转正 | `business list personnel-change --year YYYY --reason "转正"` | 用户要明细名单时使用，可追加 `--company`。 |
| 某员工人事异动 | `business list personnel-change --employee "姓名"` | 如需精确记录，再用 `business get personnel-change --id <id>`。 |
| 某员工奖惩记录 | `business list disciplinary --employee "姓名"` | 如需精确记录，再用 `business get disciplinary-record --id <id>`。 |
| 奖惩统计 / 处分异常 | `business analyze disciplinary` | 用 penalty type 分组和 findings 回答。 |
| 某公司用章记录 | `business list seal-usage --company "公司全称"` | 可追加日期范围。 |
| 用章统计 / 用章附件缺失 | `business analyze seal-usage --from YYYY-MM-DD --to YYYY-MM-DD` | 用 summary/findings 回答，明细再 list。 |
| 某日期范围用章记录 | `business list seal-usage --from YYYY-MM-DD --to YYYY-MM-DD` | 带过滤。 |
| 某人相关用章记录 | `business list seal-usage --applicant "姓名"` | 如需精确记录，再用 `business get seal-usage --id <id>`。 |

## 路由禁止项

- 不要运行 `which` 或 `find` 查找 `nanobot-webui-business`。
- 不要读取 `runtime/`、`scripts/`、`tenant-runtime.json`、policy 文件或数据库配置来确认已知命令。
- 不要为汇总问题先拉取全量逐行明细；需要明细时使用带过滤的 `business list`。
- 如果用户要新增、修改、导入、清理或删除，转到 `hr-db-ops` 的写入流程，先整理拟录入或拟更新信息，再确认执行。
