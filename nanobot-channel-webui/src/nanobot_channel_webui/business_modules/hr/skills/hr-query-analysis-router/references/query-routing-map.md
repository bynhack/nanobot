# 人事自然语言查询分析路由表

所有命令通过：

```bash
nanobot-webui-business hr <command> [options]
```

## 员工与组织

| 用户问法 | 推荐命令 |
|---|---|
| 现在有哪些公司？ | `list-companies` |
| 某公司有哪些部门？ | `list-departments --company "公司全称"` |
| 现在有哪些员工？ | `list-employees` |
| 某公司现在有哪些员工？ | `list-employees --company "公司全称"` |
| 查某个员工信息 | `employee-detail --name "姓名" --company "公司全称"` |
| 查某员工所有记录/生命周期 | `employee-timeline --name "姓名" --company "公司全称"` |
| 这个手机号是谁？ | `find-employee --phone "手机号"` |
| 这个身份证是谁？ | `find-employee --id-card "证件号"` |
| 当前人员结构怎么样？ | `analyze-headcount` |
| 各公司现在多少人？ | `analyze-headcount` |
| 哪些员工资料不完整？ | `data-quality-check` 或 `employee-summary` |
| 有没有重复身份证/手机号？ | `employee-summary` |

## 合同

| 用户问法 | 推荐命令 |
|---|---|
| 某员工有没有合同？ | `contracts-by-employee --name "姓名" --company "公司全称"` |
| 某员工合同信息我看下 | `contracts-by-employee --name "姓名" --company "公司全称"` |
| 哪些在职员工没有合同？ | `employees-without-contracts` 或 `analyze-contract-coverage` |
| 合同覆盖率是多少？ | `analyze-contract-coverage` |
| 未来三个月哪些合同到期？ | `analyze-contract-expiry --days 90` |
| 未来 30 天合同到期的有哪些？ | `analyze-contract-expiry --days 30` |

## 绩效

| 用户问法 | 推荐命令 |
|---|---|
| 某员工绩效记录 | `performance-by-employee --name "姓名" --company "公司全称"` |
| 某月绩效明细 | `performance-by-month --month 2026-03 --company "公司全称"` |
| 某月绩效整体情况 | `analyze-performance-month --month 2026-03 --company "公司全称"` |
| 某月低于 60 分的人 | `analyze-low-performance --month 2026-03 --threshold 60 --company "公司全称"` |
| 绩效工资/实发绩效合计 | `analyze-performance-month --month 2026-03` |
| 某人最近几个月绩效 | `performance-by-employee --name "姓名" --company "公司全称"` |
| 某公司某月绩效工资总额 | `analyze-performance-month --month 2026-03 --company "公司全称"` |

## 社医保

| 用户问法 | 推荐命令 |
|---|---|
| 某员工社保记录 | `insurance-by-employee --name "姓名" --company "公司全称"` |
| 某月社保增减员 | `insurance-by-month --month 2026-03 --company "公司全称"` |
| 某月社保异动统计 | `analyze-insurance-month --month 2026-03 --company "公司全称"` |
| 某员工什么时候停保/增员 | `insurance-by-employee --name "姓名" --company "公司全称"` |

## 人事异动与奖惩

| 用户问法 | 推荐命令 |
|---|---|
| 某员工人事异动 | `personnel-changes-by-employee --name "姓名" --company "公司全称"` |
| 今年有哪些转正 / 某年转正人员 | `personnel-changes-list --year 2026 --reason "转正"` |
| 今年有哪些调薪 | `personnel-changes-list --year 2026 --reason "调薪"` |
| 某员工奖惩记录 | `disciplinary-by-employee --name "姓名" --company "公司全称"` |
| 奖惩整体情况 | `analyze-disciplinary` |
| 某公司奖惩情况 | `analyze-disciplinary --company "公司全称"` |
| 哪些奖惩缺少签字附件 | `analyze-disciplinary` |

## 用章

| 用户问法 | 推荐命令 |
|---|---|
| 某公司用章记录 | `seal-usage-list --company "公司全称"` |
| 某日期范围用章记录 | `seal-usage-list --from 2026-04-01 --to 2026-04-30` |
| 某人相关用章记录 | `seal-usage-list --name "姓名"` |

## 数据质量、待办、风险

| 用户问法 | 推荐命令 |
|---|---|
| 现在各模块有多少数据？ | `count-all` |
| 数据质量怎么样？ | `data-quality-check` |
| 哪些还要人事确认？ | `pending-review-list` |
| 当前有什么风险/待办？ | `analyze-hr-risk-dashboard` |
| 导入后还有哪些没处理？ | `pending-review-list` |
| 当前库里数据概况 | `count-all` 后视情况补 `analyze-headcount` |

## 路由注意事项

- 员工姓名可能重复时，先用 `find-employee` 找候选，再让用户确认公司、部门、手机号或身份证。
- 月份统一解析为 `YYYY-MM`，例如 `2026-03`。
- 如果用户问的是"新增、修改、删除、导入、清理"，不要使用本路由直接写库，改走 `hr-data-entry-workflow`。
- 如果用户需要一个 Word、Excel 或汇报材料，先运行查询/分析命令得到结果，再使用相应文档或表格技能生成材料。
