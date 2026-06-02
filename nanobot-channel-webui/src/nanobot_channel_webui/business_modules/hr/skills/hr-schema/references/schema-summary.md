# HR 数据库结构速查

这个文件是技能包内的中文速查版。先读它，再决定读完整字段说明或完整 SQL。

完整资料位置：

- `database-schema-zh.md`
- `all-migrations-zh.sql`

## 连接前提

- 数据库类型：Supabase PostgreSQL
- 连接配置由技能包自身 `.env` 提供
- 依赖环境变量：
  - `SUPABASE_URL`
  - `channels.webui_plugin.hrSupabaseServiceRoleKey` in `~/.nanobot/config.json`

## 全局规则

- 所有主键都是 `uuid`
- 所有表都有审计字段：
  - `created_by`
  - `created_at`
  - `updated_by`
  - `updated_at`
- `updated_at` 由 `update_updated_at()` 触发器自动维护
- 所有表启用了 RLS
- 已登录用户可 `SELECT / INSERT / UPDATE`

## 表分组

### 组织架构

- `companies`
  - 公司主体，`name` 唯一
- `departments`
  - 公司下的部门，同一公司内 `(company_id, name)` 唯一

### 员工全生命周期

- `employees`
  - 员工主表，在职和离职合并存储
- `contracts`
  - 员工合同
- `performance_reviews`
  - 绩效记录
- `insurance_changes`
  - 社医保增减员
- `personnel_changes`
  - 人事异动
- `disciplinary_records`
  - 奖惩记录
- `overtime_records`
  - 加班记录
- `work_injuries`
  - 工伤记录

### 行政与培训

- `seal_usage`
  - 用章登记，同时关联公司和员工
- `training_records`
  - 培训记录，按公司归属

### 招聘

- `job_postings`
  - 招聘岗位
- `interview_records`
  - 面试记录，挂在岗位下

## 核心关系

```text
companies（公司）
  ├─ departments（部门）
  ├─ employees（员工）
  │   ├─ contracts（合同）
  │   ├─ performance_reviews（绩效）
  │   ├─ insurance_changes（社医保）
  │   ├─ personnel_changes（异动）
  │   ├─ disciplinary_records（奖惩）
  │   ├─ overtime_records（加班）
  │   └─ work_injuries（工伤）
  ├─ job_postings（岗位）
  │   └─ interview_records（面试）
  ├─ training_records（培训）
  └─ seal_usage（用章）
      ├─ applicant_id -> employees.id
      └─ seal_applicant_id -> employees.id
```

## 高价值表快速说明

### `employees`

关键字段：

- `company_id`
- `department_id`
- `name`
- `position`
- `hire_date`
- `status`
- `phone`
- `id_card_number`
- `salary_level`
- `hr_clerk`
- `resignation_date`
- `resignation_reason`

注意：

- 同时存储在职和离职员工。
- `status='离职'` 通常表示该员工已离职。
- 删除员工会影响多个子表，默认不要硬删。

### `contracts`

关键字段：

- `employee_id`
- `type`
- `sequence`
- `sign_date`
- `start_date`
- `expiry_date`
- `is_permanent`

### `insurance_changes`

关键字段：

- `employee_id`
- `change_date`
- `insurance_add_date`
- `insurance_remove_date`
- `status`

### `personnel_changes`

关键字段：

- `employee_id`
- `current_department`
- `current_position`
- `new_department`
- `new_position`
- `change_reason`
- `effective_date`

### `job_postings`

关键字段：

- `company_id`
- 岗位相关业务字段，详见 `database-schema-zh.md`

### `interview_records`

关键字段：

- `job_posting_id`
- 候选人和面试结果相关字段，详见 `database-schema-zh.md`

## 写入前判断规则

- 子表插入前，先确认父表记录存在。
- 修改员工数据时，优先使用 `employee_id`，其次用 `name + company_id`。
- `companies.name` 是最明显的业务唯一键。
- `departments` 用 `(company_id, name)` 识别最稳妥。
- 不要默认删除 `employees`，因为其下多张表设置了级联删除。

## 什么时候读完整资料

- 只想快速查表：读当前文件。
- 想确认字段中文含义、Excel 来源、业务备注：读 `database-schema-zh.md`。
- 想确认约束、索引、触发器、RLS、SQL 细节：读 `all-migrations-zh.sql`。
