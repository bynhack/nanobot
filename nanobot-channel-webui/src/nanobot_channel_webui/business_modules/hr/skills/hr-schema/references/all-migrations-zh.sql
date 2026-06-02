-- ============================================================
-- HR 管理系统 — 完整建表语句（含中文备注）
-- 字段名对应原始 Excel 各 Sheet 的列名
-- ============================================================

-- 所有表公共规范：
--   id          uuid 主键，自动生成
--   created_by  创建人（对应登录用户 UUID，需应用层手动填写）
--   created_at  创建时间（数据库自动填写）
--   updated_by  最后修改人（需应用层手动填写，INSERT 时也必须填）
--   updated_at  最后修改时间（由触发器 update_updated_at() 自动更新，禁止手动设置）

-- ============================================================
-- 共享触发器函数（建表前先建）
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. companies — 公司主体
-- 对应 Excel 中所有 Sheet 的「所属公司」列
-- ============================================================
CREATE TABLE companies (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL UNIQUE,  -- 公司全称（法定名称），如：武汉赢城欣欣科技有限公司
    short_name  text,                         -- 公司简称，如：赢城欣欣
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 2. departments — 部门
-- 对应 Excel「花名册」Sheet 的「部门」列
-- 同一部门名称可在不同公司中重复存在
-- ============================================================
CREATE TABLE departments (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,  -- 所属公司
    name        text        NOT NULL,   -- 部门名称，如：财务部、人事行政部
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, name)           -- 同一公司内部门名不重复
);
CREATE INDEX idx_departments_company_id ON departments(company_id);
CREATE TRIGGER departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 3. employees — 员工主表
-- 合并「花名册」+ 「离职花名册」两个 Sheet
-- 在职员工：resignation_* 字段为 NULL
-- 离职员工：status = '离职'，resignation_* 字段有值
-- ============================================================
CREATE TABLE employees (
    id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ── 基本归属（花名册：公司、部门、职位）──
    company_id                    uuid        NOT NULL REFERENCES companies(id),   -- 花名册：所属公司
    department_id                 uuid        REFERENCES departments(id),          -- 花名册：部门
    name                          text        NOT NULL,   -- 花名册：姓名
    gender                        text,                   -- 花名册：性别（男/女）
    birth_date                    date,                   -- 花名册：出生日期
    position                      text,                   -- 花名册：职位/岗位

    -- ── 入职信息 ──
    hire_date                     date,                   -- 花名册：入职日期
    probation_end_date            date,                   -- 花名册：转正日期（试用期结束日）
    status                        text        NOT NULL DEFAULT '正式',
                                                          -- 花名册：状态（正式 / 试用 / 离职）

    -- ── 证件信息 ──
    id_card_number                text,                   -- 花名册：身份证号
    id_card_expiry                date,                   -- 花名册：身份证有效期
    phone                         text,                   -- 花名册：手机号码

    -- ── 学历信息 ──
    education                     text,                   -- 花名册：学历（本科/大专/研究生…）
    school                        text,                   -- 花名册：毕业院校
    graduation_date               date,                   -- 花名册：毕业时间
    major                         text,                   -- 花名册：专业

    -- ── 地址信息 ──
    current_address               text,                   -- 花名册：现居住地址
    hukou_address                 text,                   -- 花名册：户籍地址

    -- ── 薪资/银行 ──
    bank_account                  text,                   -- 花名册：银行卡号
    bank_name                     text,                   -- 花名册：开户行
    tenure_months                 integer,                -- 花名册：工龄月数（对应工龄工资档次）
    tenure_salary                 numeric,                -- 花名册：工龄工资（元）
    salary_level                  text,                   -- 花名册：薪资级别，如 P15-G2

    -- ── 党员信息 ──
    is_party_member               boolean     DEFAULT false,  -- 花名册：是否党员（是/否）
    party_relationship            text,                       -- 花名册：党组织关系

    -- ── 其他 ──
    hr_clerk                      text,                   -- 花名册：负责 HR 专员姓名
    notes                         text,                   -- 花名册：备注（含历次薪资调整记录）

    -- ── 离职信息（来自「离职花名册」Sheet，在职员工此处为 NULL）──
    resignation_date              date,                   -- 离职花名册：离职日期
    resignation_reason            text,                   -- 离职花名册：离职原因
    resignation_handover_complete boolean,                -- 离职花名册：离职手续是否完成
    resignation_cert_issued       boolean,                -- 离职花名册：离职证明是否已开具
    resignation_notes             text,                   -- 离职花名册：离职备注

    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employees_company_id    ON employees(company_id);
CREATE INDEX idx_employees_department_id ON employees(department_id);
CREATE INDEX idx_employees_status        ON employees(status);
CREATE INDEX idx_employees_name          ON employees(name);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 4. contracts — 合同
-- 合并「劳动合同」「劳务合同」「实习协议」「合作协议」四个 Sheet
-- 用 type 字段区分合同类型
-- ============================================================
CREATE TABLE contracts (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,  -- 关联员工
    type           text        NOT NULL,   -- 合同类型：劳动合同 / 劳务合同 / 实习协议 / 合作协议
    sequence       integer,               -- 第几份合同（第1份、第2份……）
    sign_date      date,                  -- 合同签订日期
    duration_years integer,               -- 合同期限（年）
    start_date     date,                  -- 合同开始日期
    expiry_date    date,                  -- 合同到期日期
    is_permanent   boolean     DEFAULT false,  -- 是否无固定期限合同
    scan_file_url  text,                  -- 纸质合同扫描件 URL（Supabase Storage）
    notes          text,                  -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contracts_employee_id ON contracts(employee_id);
CREATE INDEX idx_contracts_type        ON contracts(type);
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 5. performance_reviews — 绩效考核
-- 对应 Excel「绩效考核」Sheet
-- ============================================================
CREATE TABLE performance_reviews (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id               uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    review_date               date,       -- 考核日期（对应 Excel 月份/季度）
    self_score                numeric,    -- 自评得分
    supervisor_score          numeric,    -- 上级评分
    final_score               numeric,    -- 最终综合得分
    performance_ratio         numeric,    -- 绩效系数/比例
    performance_salary        numeric,    -- 绩效工资目标额（元）
    actual_performance_salary numeric,    -- 实际发放绩效工资（元）
    performance_adjustment    numeric,    -- 绩效调整额（实发 - 目标，可为负）
    notes                     text,       -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_performance_employee_id ON performance_reviews(employee_id);
CREATE TRIGGER performance_reviews_updated_at BEFORE UPDATE ON performance_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 6. insurance_changes — 社医保增减员
-- 对应 Excel「社医保增减员」Sheet
-- 每条记录代表一次参保状态变更（新增参保或停保）
-- ============================================================
CREATE TABLE insurance_changes (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id           uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    change_date           date,       -- 变更日期（本次操作日期）
    hire_date             date,       -- 入职日期（表中冗余记录，方便核对）
    probation_end_date    date,       -- 转正日期（表中冗余记录）
    resignation_date      date,       -- 离职日期（停保时填写）
    insurance_add_date    date,       -- 参保日期（新增参保时填写）
    insurance_remove_date date,       -- 停保日期（离职停保时填写）
    status                text,       -- 状态，如：在职新增 / 离职停保 / 转正新增
    signed_upload         text[],     -- 纸质签字版扫描件 URL 数组（Supabase Storage: hr-documents）
    hr_clerk              text,       -- 经办 HR 专员
    notes                 text,       -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_insurance_employee_id ON insurance_changes(employee_id);
CREATE TRIGGER insurance_changes_updated_at BEFORE UPDATE ON insurance_changes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 7. personnel_changes — 人事异动
-- 对应 Excel「人事异动」Sheet
-- 记录调岗、调薪、晋升、转正等变动
-- ============================================================
CREATE TABLE personnel_changes (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id          uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    current_department   text,       -- 异动前部门
    current_position     text,       -- 异动前职位
    probation_salary     numeric,    -- 试用期工资（元）
    regular_salary       numeric,    -- 转正工资（元）
    new_department       text,       -- 异动后部门（调岗时填写）
    new_position         text,       -- 异动后职位（调岗/晋升时填写）
    change_reason        text,       -- 变动原因，如：晋升 / 调薪 / 调岗 / 转正
    salary_before        numeric,    -- 调薪前工资（元）
    salary_after         numeric,    -- 调薪后工资（元）
    effective_date       date,       -- 生效日期
    procedures_complete  boolean,    -- 手续是否办理完毕
    signed_upload        text[],     -- 纸质签字审批表 URL 数组（Supabase Storage: hr-documents）
    hr_clerk             text,       -- 经办 HR 专员
    notes                text,       -- 备注（提前转正、合作协议、生效说明等补充信息）
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_personnel_employee_id ON personnel_changes(employee_id);
CREATE TRIGGER personnel_changes_updated_at BEFORE UPDATE ON personnel_changes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 8. disciplinary_records — 奖惩记录
-- 对应 Excel「奖惩记录」Sheet
-- 记录警告、处分、通报批评等纪律处理
-- ============================================================
CREATE TABLE disciplinary_records (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    incident_date  date,       -- 事件/处罚发生日期
    penalty_type   text,       -- 处罚类型，如：书面警告 / 记过 / 降薪 / 辞退
    penalty_reason text,       -- 处罚原因/事件描述
    signed_upload  text[],     -- 纸质处分文件 URL 数组（Supabase Storage: hr-documents）
    hr_clerk       text,       -- 经办 HR 专员
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_disciplinary_employee_id ON disciplinary_records(employee_id);
CREATE TRIGGER disciplinary_records_updated_at BEFORE UPDATE ON disciplinary_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 9. seal_usage — 用章登记表
-- 对应 Excel「用章登记表」Sheet
-- 注意：有两个员工外键，含义不同
-- ============================================================
CREATE TABLE seal_usage (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        uuid        NOT NULL REFERENCES companies(id),   -- 使用哪家公司的印章
    usage_date        date,       -- 用章日期
    applicant_id      uuid        REFERENCES employees(id),            -- 申请人（提交用章申请的员工）
    seal_applicant_id uuid        REFERENCES employees(id),            -- 用章人（实际使用印章的员工，可与申请人不同）
    reason            text,       -- 用章事由，如：合同盖章 / 证明文件
    attachments       text[],     -- 相关附件 URL 数组（Supabase Storage: hr-documents）
    notes             text,       -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_seal_usage_company_id   ON seal_usage(company_id);
CREATE INDEX idx_seal_usage_applicant_id ON seal_usage(applicant_id);
CREATE TRIGGER seal_usage_updated_at BEFORE UPDATE ON seal_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 10. overtime_records — 加班记录
-- 对应 Excel「加班记录」Sheet
-- 按月汇总，一条记录 = 某员工某月的加班情况
-- ============================================================
CREATE TABLE overtime_records (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id        uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    overtime_month     text,       -- 加班月份，格式 YYYY-MM，如：2025-03
    actual_hours       numeric,    -- 实际加班小时数
    overtime_pay       numeric,    -- 加班费（元）
    compensatory_hours numeric,    -- 调休小时数（以调休代替加班费的部分）
    hr_clerk           text,       -- 经办 HR 专员
    notes              text,       -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_overtime_employee_id ON overtime_records(employee_id);
CREATE TRIGGER overtime_records_updated_at BEFORE UPDATE ON overtime_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 11. work_injuries — 工伤申报
-- 对应 Excel「工伤」Sheet
-- 文书类字段支持双模式：_text（直接录入文字）+ _files（上传扫描件）
-- ============================================================
CREATE TABLE work_injuries (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id               uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    determination_result      text,       -- 工伤认定结果（认定为工伤 / 不认定）
    id_card_number            text,       -- 申请人身份证号（代理申请时为代理人证件号）
    relationship              text,       -- 申请人与伤者关系（本人/配偶/子女…）
    applicant_address         text,       -- 申请人联系地址
    injured_part              text,       -- 受伤部位描述
    job_description           text,       -- 受伤时所从事的工作描述
    contact_phone             text,       -- 申请人联系电话
    injury_time               text,       -- 受伤时间（文本，可含"上午""下班途中"等描述）
    application_date          date,       -- 工伤认定申请日期
    accident_type             text,       -- 事故类型，如：工作事故 / 上下班途中 / 职业病
    company_report            text,       -- 单位事故情况陈述
    personal_report           text,       -- 个人事故情况陈述
    route_map                 text,       -- 上下班路线说明（上下班途中工伤时填写）

    -- 授权委托书（Excel 中可以是文字也可以是图片）
    power_of_attorney_text    text,       -- 授权委托书——文字内容
    power_of_attorney_files   text[],     -- 授权委托书——扫描件 URL（Supabase Storage: work-injury-docs）

    -- 情况说明书
    situation_statement_text  text,       -- 情况说明书——文字内容
    situation_statement_files text[],     -- 情况说明书——扫描件 URL

    -- 证人证词
    witness_testimony_text    text,       -- 证人证词——文字内容
    witness_testimony_files   text[],     -- 证人证词——扫描件 URL

    injury_category           text,       -- 伤害类别（骨折/软组织损伤/…）
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_work_injuries_employee_id ON work_injuries(employee_id);
CREATE TRIGGER work_injuries_updated_at BEFORE UPDATE ON work_injuries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 12. job_postings — 招聘岗位
-- 对应 Excel「招聘信息」Sheet 的岗位部分
-- 面试记录通过 interview_records 关联到此表
-- ============================================================
CREATE TABLE job_postings (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       uuid        NOT NULL REFERENCES companies(id),  -- 招聘所属公司
    position_name    text        NOT NULL,  -- 招聘岗位名称，如：人事专员、会计
    headcount        integer,               -- 招聘人数
    job_type         text,                  -- 岗位类型，如：全职 / 兼职 / 实习
    responsibilities text,                  -- 岗位职责描述
    requirements     text,                  -- 岗位任职要求
    work_hours       text,                  -- 工作时间（如：朝九晚六、排班制）
    work_location    text,                  -- 工作地点
    salary_range     text,                  -- 薪资范围，如：5000-8000元/月
    benefits         text,                  -- 福利待遇描述
    notes            text,                  -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_postings_company_id ON job_postings(company_id);
CREATE TRIGGER job_postings_updated_at BEFORE UPDATE ON job_postings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 13. interview_records — 面试邀约记录
-- 对应 Excel「招聘信息」Sheet 的面试候选人部分
-- 必须先有 job_postings 记录，再建立面试记录
-- ============================================================
CREATE TABLE interview_records (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_posting_id  uuid        NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,  -- 应聘的岗位
    candidate_name  text,       -- 候选人姓名
    gender          text,       -- 候选人性别
    age             integer,    -- 候选人年龄
    phone           text,       -- 候选人联系电话
    source_platform text,       -- 来源渠道，如：BOSS直聘 / 猎聘 / 内推
    interview_date  date,       -- 面试日期
    interview_time  time,       -- 面试时间
    attended        boolean,    -- 是否到场参加面试
    result          text,       -- 面试结果，如：通过 / 不通过 / 待定
    hired           boolean,    -- 是否最终录用
    hire_date       date,       -- 录用后实际入职日期
    recruiter       text,       -- 负责招聘的 HR 专员
    notes           text,       -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_interview_job_posting_id ON interview_records(job_posting_id);
CREATE TRIGGER interview_records_updated_at BEFORE UPDATE ON interview_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 14. training_records — 培训记录
-- 对应 Excel「培训记录」Sheet
-- 参与人员以文本列表存储，不关联 employees 外键
-- ============================================================
CREATE TABLE training_records (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid        NOT NULL REFERENCES companies(id),  -- 组织培训的公司
    topic           text,       -- 培训主题/课程名称
    trainer         text,       -- 讲师/培训师姓名
    training_date   date,       -- 培训日期
    location        text,       -- 培训地点
    department      text,       -- 培训面向部门（文本，非外键）
    attendee_names  text,       -- 参与人员名单（逗号或换行分隔的姓名列表）
    expected_count  integer,    -- 应到人数
    actual_count    integer,    -- 实到人数
    attachments     text[],     -- 培训资料附件 URL 数组（Supabase Storage: training-assets）
    photos          text[],     -- 培训现场照片 URL 数组（Supabase Storage: training-assets）
    notes           text,       -- 备注
    created_by  uuid        REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES auth.users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_training_company_id ON training_records(company_id);
CREATE TRIGGER training_records_updated_at BEFORE UPDATE ON training_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- RLS（行级安全策略）— 所有表允许已认证用户读写
-- ============================================================
ALTER TABLE companies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_changes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE personnel_changes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE seal_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_injuries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_postings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records   ENABLE ROW LEVEL SECURITY;

-- 统一策略：已认证用户可查询 / 插入 / 更新（不开放 DELETE）
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'companies','departments','employees','contracts',
        'performance_reviews','insurance_changes','personnel_changes',
        'disciplinary_records','seal_usage','overtime_records',
        'work_injuries','job_postings','interview_records','training_records'
    ]
    LOOP
        EXECUTE format('CREATE POLICY "authenticated_read"   ON %I FOR SELECT TO authenticated USING (true)', t);
        EXECUTE format('CREATE POLICY "authenticated_insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);
        EXECUTE format('CREATE POLICY "authenticated_update" ON %I FOR UPDATE TO authenticated USING (true)', t);
    END LOOP;
END $$;
