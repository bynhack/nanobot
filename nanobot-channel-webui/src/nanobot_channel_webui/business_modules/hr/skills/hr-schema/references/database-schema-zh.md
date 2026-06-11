# HR 管理系统 — 数据库结构说明

本文档描述所有数据库表的用途、字段含义及表关系，字段名与原始 Excel 各 Sheet 的列名一一对应，供 agent 和开发者参考。

## 通用规范

| 规则 | 说明 |
|------|------|
| 主键 | 所有表使用 `uuid`，数据库自动生成（`gen_random_uuid()`） |
| 创建人 | `created_by uuid → auth.users`，**应用层必须手动填写**登录用户 UUID |
| 创建时间 | `created_at timestamptz`，数据库自动填写 |
| 修改人 | `updated_by uuid → auth.users`，**应用层必须手动填写**，INSERT 时也必须填 |
| 修改时间 | `updated_at timestamptz`，由触发器自动更新，**禁止手动设置** |
| 逻辑删除 | `is_deleted boolean NOT NULL DEFAULT false`，`false` 表示默认正常显示，`true` 表示逻辑删除 |
| 权限 | 所有表启用 RLS，已登录用户可 SELECT / INSERT / UPDATE |
| 文件存储 | `text[]` 类型字段存储 Supabase Storage 的文件 URL 数组 |

`is_deleted` 用于统一逻辑删除能力。前端和业务 CLI 默认列表应隐藏 `is_deleted = true` 的记录，但数据库不物理删除记录，便于审计、追溯和必要时恢复。该字段已覆盖：`companies`、`departments`、`employees`、`contracts`、`performance_reviews`、`insurance_changes`、`personnel_changes`、`disciplinary_records`、`seal_usage`、`overtime_records`、`work_injuries`、`job_postings`、`interview_records`、`training_records`、`webui_user_profiles`。

---

## 表总览

| # | 表名 | 对应 Excel Sheet | 用途 |
|---|------|-----------------|------|
| 1 | `companies` | 所有 Sheet 的「所属公司」列 | 集团旗下各公司主体 |
| 2 | `departments` | 花名册：部门 | 各公司下的部门 |
| 3 | `employees` | 花名册 + 离职花名册 | 全员档案（在职+离职合一） |
| 4 | `contracts` | 劳动合同 / 劳务合同 / 实习协议 / 合作协议 | 各类合同统一管理 |
| 5 | `performance_reviews` | 绩效考核 | 绩效评分与发放记录 |
| 6 | `insurance_changes` | 社医保增减员 | 社保/医保参保与停保记录 |
| 7 | `personnel_changes` | 人事异动 | 调岗、调薪、晋升、转正记录 |
| 8 | `disciplinary_records` | 奖惩记录 | 处分、警告等纪律记录 |
| 9 | `seal_usage` | 用章登记表 | 公司印章使用登记 |
| 10 | `overtime_records` | 加班记录 | 月度加班统计 |
| 11 | `work_injuries` | 工伤 | 工伤申报与认定材料 |
| 12 | `job_postings` | 招聘信息（岗位） | 招聘岗位信息 |
| 13 | `interview_records` | 招聘信息（面试候选人） | 面试邀约与录用记录 |
| 14 | `training_records` | 培训记录 | 培训课程与参与情况 |

---

## 表关系图

```
companies（公司）
├── departments（部门）          company_id → companies.id  [级联删除]
├── employees（员工）            company_id → companies.id
│   ├── department_id            department_id → departments.id
│   ├── contracts（合同）        employee_id → employees.id [级联删除]
│   │                            company_id → companies.id
│   ├── performance_reviews      employee_id → employees.id [级联删除]
│   ├── insurance_changes        employee_id → employees.id [级联删除]
│   ├── personnel_changes        employee_id → employees.id [级联删除]
│   ├── disciplinary_records     employee_id → employees.id [级联删除]
│   ├── overtime_records         employee_id → employees.id [级联删除]
│   └── work_injuries            employee_id → employees.id [级联删除]
├── seal_usage（用章）           company_id → companies.id
│                                applicant_id → employees.id（申请人，可为空）
│                                seal_applicant_id → employees.id（用章人，可为空）
├── job_postings（招聘岗位）     当前表不直接保存公司外键
│   └── interview_records        job_posting_id → job_postings.id [级联删除]
└── training_records（培训）     company_id → companies.id
```

---

## 各表详细说明

---

### 1. `companies` — 公司主体

集团旗下所有子公司和关联公司。Excel 中各 Sheet 的「所属公司」列均引用此表。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `id` | uuid PK | — | 自动生成 |
| `name` | text UNIQUE | 所属公司（全称） | 法定全称，如：武汉赢城欣欣科技有限公司 |
| `short_name` | text | 公司简称 | 简称，如：赢城欣欣 |

---

### 2. `departments` — 部门

每家公司独立管理自己的部门，同一部门名称（如"财务部"）在不同公司中可以重复存在。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `id` | uuid PK | — | 自动生成 |
| `company_id` | uuid FK → companies | 所属公司 | 级联删除 |
| `name` | text | 花名册：部门 | 部门名称，如：财务部、人事行政部 |

> 唯一约束：同一公司内部门名不重复 `UNIQUE(company_id, name)`

---

### 3. `employees` — 员工主表

**合并了两个 Sheet**：「花名册」（在职）和「离职花名册」（已离职），用 `status` 字段区分。离职员工的 `resignation_*` 字段有值，在职员工该部分为 NULL。

#### 基本归属

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `company_id` | uuid FK → companies | 花名册：所属公司 | 必填 |
| `department_id` | uuid FK → departments | 花名册：部门 | 可为空 |
| `name` | text | 花名册：姓名 | 必填 |
| `gender` | text | 花名册：性别 | 男 / 女 |
| `birth_date` | date | 花名册：出生日期 | |
| `position` | text | 花名册：职位 | 岗位名称 |

#### 入职信息

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `hire_date` | date | 花名册：入职日期 | |
| `probation_end_date` | date | 花名册：转正日期 | 试用期结束日 |
| `status` | text | 花名册：状态 | `正式` / `试用` / `离职`，默认 `正式` |

#### 证件信息

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `id_card_number` | text | 花名册：身份证号 | |
| `id_card_expiry` | date | 花名册：身份证有效期 | |
| `phone` | text | 花名册：手机号码 | |

#### 学历信息

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `education` | text | 花名册：学历 | 本科 / 大专 / 研究生… |
| `school` | text | 花名册：毕业院校 | |
| `graduation_date` | date | 花名册：毕业时间 | |
| `major` | text | 花名册：专业 | |

#### 地址信息

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `current_address` | text | 花名册：现居住地址 | |
| `hukou_address` | text | 花名册：户籍地址 | |

#### 薪资 & 银行

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `bank_account` | text | 花名册：银行卡号 | |
| `bank_name` | text | 花名册：开户行 | |
| `tenure_months` | integer | 花名册：工龄月数 | 对应工龄工资档次 |
| `tenure_salary` | numeric | 花名册：工龄工资 | 元 |
| `salary_level` | text | 花名册：薪资级别 | 如：P15-G2 |

#### 党员信息

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `is_party_member` | boolean | 花名册：是否党员 | 默认 false |
| `party_relationship` | text | 花名册：党组织关系 | |

#### 其他

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `hr_clerk` | text | 花名册：负责 HR 专员 | |
| `notes` | text | 花名册：备注 | 含历次薪资调整记录等 |

#### 离职字段（来自「离职花名册」Sheet，在职员工为 NULL）

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `resignation_date` | date | 离职花名册：离职日期 | |
| `resignation_reason` | text | 离职花名册：离职原因 | |
| `resignation_handover_complete` | boolean | 离职花名册：离职手续是否完成 | |
| `resignation_cert_issued` | boolean | 离职花名册：离职证明是否已开具 | |
| `resignation_notes` | text | 离职花名册：离职备注 | |

#### 档案延续 / 跨主体调动字段

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `identity_key` | text | 系统归并字段 | 员工身份归并键，用于跨记录识别同一自然人。 |
| `previous_employee_id` | uuid FK → employees | 档案延续 | 上一条员工档案或调动前员工记录。 |
| `transfer_group_id` | uuid | 档案延续 | 跨公司 / 主体调动归并组。 |
| `service_continuity_policy` | text | 档案延续 | 工龄连续性规则或说明。 |
| `recognized_service_start_date` | date | 档案延续 | 认定连续工龄起算日期。 |

---

### 4. `contracts` — 合同

合并「劳动合同」「劳务合同」「实习协议」「合作协议」四个 Sheet，用 `type` 字段区分。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `company_id` | uuid FK → companies | 合同归属公司 | 用于合同按公司归属过滤和授权。 |
| `type` | text | Sheet 名称 | `劳动合同` / `劳务合同` / `实习协议` / `合作协议` |
| `sequence` | integer | 第几份 | 第1份、第2份… |
| `sign_date` | date | 签订日期 | |
| `duration_years` | integer | 合同期限（年） | |
| `start_date` | date | 合同开始日期 | |
| `expiry_date` | date | 合同到期日期 | |
| `is_permanent` | boolean | 无固定期限 | 默认 false |
| `scan_file_url` | text | 纸质合同扫描件 | Supabase Storage bucket: `contracts` |
| `notes` | text | 备注 | |

---

### 5. `performance_reviews` — 绩效考核

对应「绩效考核」Sheet，每条记录 = 某员工某次考核结果。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `review_date` | date | 考核日期 | 对应月份/季度 |
| `self_score` | numeric | 自评得分 | |
| `supervisor_score` | numeric | 上级评分 | |
| `final_score` | numeric | 最终综合得分 | |
| `performance_ratio` | numeric | 绩效系数/比例 | |
| `performance_salary` | numeric | 绩效工资目标额 | 元 |
| `actual_performance_salary` | numeric | 实际发放绩效工资 | 元 |
| `performance_adjustment` | numeric | 绩效调整额 | 实发 - 目标，可为负 |
| `notes` | text | 备注 | |

---

### 6. `insurance_changes` — 社医保增减员

对应「社医保增减员」Sheet，每条记录 = 一次参保状态变更。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `change_date` | date | 变更日期 | 本次操作日期 |
| `hire_date` | date | 入职日期 | 表中冗余，方便核对 |
| `probation_end_date` | date | 转正日期 | 表中冗余 |
| `resignation_date` | date | 离职日期 | 停保时填写 |
| `insurance_add_date` | date | 参保日期 | 新增参保时填写 |
| `insurance_remove_date` | date | 停保日期 | 离职停保时填写 |
| `status` | text | 状态 | 在职新增 / 离职停保 / 转正新增 |
| `signed_upload` | text[] | 上传纸质签字版 | Storage bucket: `hr-documents` |
| `hr_clerk` | text | 经办 HR 专员 | |
| `notes` | text | 备注 | |

---

### 7. `personnel_changes` — 人事异动

对应「人事异动」Sheet，记录调岗、调薪、晋升、转正等。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `current_department` | text | 现部门 | 异动前 |
| `current_position` | text | 现职位 | 异动前 |
| `probation_salary` | numeric | 试用期工资 | 元 |
| `regular_salary` | numeric | 转正工资 | 元 |
| `new_department` | text | 新部门 | 调岗时填写 |
| `new_position` | text | 新职位 | 调岗/晋升时填写 |
| `change_reason` | text | 变动原因 | 晋升 / 调薪 / 调岗 / 转正 |
| `salary_before` | numeric | 调整前工资 | 元 |
| `salary_after` | numeric | 调整后工资 | 元 |
| `effective_date` | date | 生效日期 | |
| `procedures_complete` | boolean | 手续是否完成 | |
| `signed_upload` | text[] | 上传纸质签字版 | Storage bucket: `hr-documents` |
| `hr_clerk` | text | 经办 HR 专员 | |
| `notes` | text | 备注 | 记录提前转正、合作协议、生效说明等补充信息 |

---

### 8. `disciplinary_records` — 奖惩记录

对应「奖惩记录」Sheet，记录警告、处分、通报批评等。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `incident_dates` | date[] | 事件日期 | 当前数据库字段为复数数组字段，可记录多个处罚发生日期。标准业务 CLI 对外仍以 `incident_date` 返回和接收。 |
| `penalty_type` | text | 处罚类型 | 书面警告 / 记过 / 降薪 / 辞退 |
| `penalty_reason` | text | 处罚原因 | 事件描述 |
| `signed_upload` | text[] | 上传纸质签字版 | Storage bucket: `hr-documents` |
| `hr_clerk` | text | 经办 HR 专员 | |

---

### 9. `seal_usage` — 用章登记表

对应「用章登记表」Sheet。**注意：有两个员工外键，含义不同。**

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `company_id` | uuid FK → companies | 所属公司 | 使用哪家公司的印章 |
| `usage_date` | date | 用章日期 | |
| `applicant_id` | uuid FK → employees | 申请人 | **提交用章申请**的员工（可为空） |
| `seal_applicant_id` | uuid FK → employees | 用章人 | **实际使用印章**的员工（可为空，可与申请人不同） |
| `reason` | text | 用章事由 | 合同盖章 / 证明文件… |
| `attachments` | text[] | 附件 | Storage bucket: `hr-documents` |
| `notes` | text | 备注 | |

> ⚠️ `applicant_id`（申请人）和 `seal_applicant_id`（用章人）是两个不同的字段，不能混用。

---

### 10. `overtime_records` — 加班记录

对应「加班记录」Sheet，按月汇总，一条记录 = 某员工某月加班情况。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `overtime_month` | text | 加班月份 | 格式 `YYYY-MM`，如：`2025-03` |
| `actual_hours` | numeric | 实际加班小时数 | |
| `overtime_pay` | numeric | 加班费 | 元 |
| `compensatory_hours` | numeric | 调休小时数 | 以调休代替加班费的部分 |
| `hr_clerk` | text | 经办 HR 专员 | |
| `notes` | text | 备注 | |

---

### 11. `work_injuries` — 工伤申报

对应「工伤」Sheet。文书类字段支持双模式：`_text`（直接录入文字）+ `_files`（上传扫描件），因为 Excel 原表中这些字段既可以是文字也可以是图片附件。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `employee_id` | uuid FK → employees | 员工姓名 | 级联删除 |
| `determination_result` | text | 认定结果 | 认定为工伤 / 不认定 |
| `id_card_number` | text | 身份证号 | 代理申请时为代理人证件号 |
| `relationship` | text | 与伤者关系 | 本人 / 配偶 / 子女… |
| `applicant_address` | text | 申请人联系地址 | |
| `injured_part` | text | 受伤部位 | |
| `job_description` | text | 工作描述 | 受伤时所从事的工作 |
| `contact_phone` | text | 联系电话 | |
| `injury_time` | text | 受伤时间 | 含"上午""下班途中"等文字描述 |
| `application_date` | date | 申请日期 | 工伤认定申请日期 |
| `accident_type` | text | 事故类型 | 工作事故 / 上下班途中 / 职业病 |
| `company_report` | text | 单位陈述 | |
| `personal_report` | text | 个人陈述 | |
| `route_map` | text | 路线说明 | 上下班途中工伤时填写 |
| `power_of_attorney_text` | text | 授权委托书（文字） | 直接录入文本 |
| `power_of_attorney_files` | text[] | 授权委托书（文件） | Storage bucket: `work-injury-docs` |
| `situation_statement_text` | text | 情况说明书（文字） | |
| `situation_statement_files` | text[] | 情况说明书（文件） | Storage bucket: `work-injury-docs` |
| `witness_testimony_text` | text | 证人证词（文字） | |
| `witness_testimony_files` | text[] | 证人证词（文件） | Storage bucket: `work-injury-docs` |
| `injury_category` | text | 伤害类别 | 骨折 / 软组织损伤… |

---

### 12. `job_postings` — 招聘岗位

对应「招聘信息」Sheet 的岗位部分，先有岗位记录，才能建面试记录。当前表不直接保存公司外键；如需公司维度，需要通过业务流程补充或后续 schema 扩展，不要从本表字段推断。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `position_name` | text | 招聘岗位 | 如：人事专员、会计 |
| `headcount` | integer | 招聘人数 | |
| `job_type` | text | 岗位类型 | 全职 / 兼职 / 实习 |
| `responsibilities` | text | 岗位职责 | |
| `requirements` | text | 任职要求 | |
| `work_hours` | text | 工作时间 | 如：朝九晚六、排班制 |
| `work_location` | text | 工作地点 | |
| `salary_range` | text | 薪资范围 | 如：5000-8000元/月 |
| `benefits` | text | 福利待遇 | |
| `notes` | text | 备注 | |

---

### 13. `interview_records` — 面试邀约记录

对应「招聘信息」Sheet 的面试候选人部分，必须关联一个 `job_postings` 记录。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `job_posting_id` | uuid FK → job_postings | 应聘岗位 | 级联删除 |
| `candidate_name` | text | 候选人姓名 | |
| `gender` | text | 性别 | |
| `age` | integer | 年龄 | |
| `phone` | text | 联系电话 | |
| `source_platform` | text | 来源渠道 | BOSS直聘 / 猎聘 / 内推… |
| `interview_date` | date | 面试日期 | |
| `interview_time` | time | 面试时间 | |
| `attended` | boolean | 是否到场 | |
| `result` | text | 面试结果 | 通过 / 不通过 / 待定 |
| `hired` | boolean | 是否录用 | |
| `hire_date` | date | 入职日期 | 录用后实际入职日期 |
| `recruiter` | text | 招聘专员 | 负责招聘的 HR |
| `notes` | text | 备注 | |

---

### 14. `training_records` — 培训记录

对应「培训记录」Sheet，一条记录 = 一次培训活动。参与人员以文本存储，不关联 employees 外键。

| 字段 | 类型 | 对应 Excel | 说明 |
|------|------|-----------|------|
| `company_id` | uuid FK → companies | 所属公司 | 组织培训的公司 |
| `topic` | text | 培训主题 | 课程名称 |
| `trainer` | text | 讲师 | 培训师姓名 |
| `training_date` | date | 培训日期 | |
| `location` | text | 培训地点 | |
| `department` | text | 培训部门 | 面向部门（文本，非外键） |
| `attendee_names` | text | 参与人员 | 逗号或换行分隔的姓名列表，不做 FK 关联 |
| `expected_count` | integer | 应到人数 | |
| `actual_count` | integer | 实到人数 | |
| `attachments` | text[] | 培训资料 | Storage bucket: `training-assets` |
| `photos` | text[] | 现场照片 | Storage bucket: `training-assets` |
| `notes` | text | 备注 | |

---

## Storage Bucket 对照

| Bucket | 存储内容 | 关联字段 |
|--------|---------|---------|
| `contracts` | 纸质合同扫描件 | `contracts.scan_file_url` |
| `hr-documents` | 社保签字表、人事异动审批表、处分文件、用章附件 | `insurance_changes.signed_upload`、`personnel_changes.signed_upload`、`disciplinary_records.signed_upload`、`seal_usage.attachments` |
| `work-injury-docs` | 工伤相关文书扫描件 | `work_injuries.*_files` |
| `training-assets` | 培训资料和现场照片 | `training_records.attachments`、`training_records.photos` |
