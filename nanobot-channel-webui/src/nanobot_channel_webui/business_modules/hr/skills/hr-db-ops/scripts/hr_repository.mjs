import fs from "node:fs";
import { allowedCompanyNames } from "./access_policy.mjs";
if (!process.env.NANOBOT_WEBUI_SUPABASE_CONNECTOR) {
  throw new Error("NANOBOT_WEBUI_SUPABASE_CONNECTOR is required; use nanobot-webui-business hr as the entrypoint.");
}
const { SupabaseConnector } = await import(process.env.NANOBOT_WEBUI_SUPABASE_CONNECTOR);

export const BUSINESS_TABLES = [
  { table: "companies", label: "公司" },
  { table: "departments", label: "部门" },
  { table: "employees", label: "员工" },
  { table: "contracts", label: "合同" },
  { table: "performance_reviews", label: "绩效" },
  { table: "insurance_changes", label: "社医保" },
  { table: "personnel_changes", label: "人事异动" },
  { table: "disciplinary_records", label: "奖惩" },
  { table: "seal_usage", label: "用章" },
  { table: "overtime_records", label: "加班" },
  { table: "work_injuries", label: "工伤" },
  { table: "job_postings", label: "招聘岗位" },
  { table: "interview_records", label: "面试" },
  { table: "training_records", label: "培训" }
];

export const CLEAR_ORDER = [
  { table: "interview_records", label: "面试" },
  { table: "job_postings", label: "招聘岗位" },
  { table: "training_records", label: "培训" },
  { table: "seal_usage", label: "用章" },
  { table: "work_injuries", label: "工伤" },
  { table: "overtime_records", label: "加班" },
  { table: "disciplinary_records", label: "奖惩" },
  { table: "personnel_changes", label: "人事异动" },
  { table: "insurance_changes", label: "社医保" },
  { table: "performance_reviews", label: "绩效" },
  { table: "contracts", label: "合同" },
  { table: "employees", label: "员工" },
  { table: "departments", label: "部门" },
  { table: "companies", label: "公司" }
];

const CLEAR_CONFIRMATION = "清空人事业务数据";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export class HrRepository {
  constructor({ connector = new SupabaseConnector() } = {}) {
    this.db = connector;
  }

  assertPlanCompanyScope({ plan, companyName = null, resource, action = "write" } = {}) {
    const allowed = repositoryAllowedCompanyNames(resource, action);
    if (!allowed || allowed.includes("*")) return;
    const companies = collectScopeCompanyNames(plan, companyName);
    for (const company of companies) {
      if (!allowed.includes(company)) {
        throw new Error(`当前账号无权写入或验证公司数据: ${company}`);
      }
    }
  }

  async countTable(table) {
    const { count, error } = await this.db
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.message}`);
    return count ?? 0;
  }

  async countAllTables() {
    const rows = [];
    for (const item of BUSINESS_TABLES) {
      rows.push({ ...item, count: await this.countTable(item.table) });
    }
    return rows;
  }

  async listCompanies() {
    const { data, error } = await this.db
      .from("companies")
      .select("id,name,short_name")
      .order("name");
    if (error) throw new Error(`list companies failed: ${error.message}`);
    return data ?? [];
  }

  async findCompanyByName(name) {
    const companyName = normalizeRequired(name, "company name");
    const { data, error } = await this.db
      .from("companies")
      .select("id,name,short_name")
      .eq("name", companyName)
      .limit(2);
    if (error) throw new Error(`find company failed: ${error.message}`);
    return data ?? [];
  }

  async ensureCompany({ name, shortName = null }) {
    const companyName = normalizeRequired(name, "company name");
    const matches = await this.findCompanyByName(companyName);
    if (matches.length > 1) throw new Error(`multiple companies matched: ${companyName}`);
    if (matches.length === 1) return { action: "existing", record: matches[0] };

    const { data, error } = await this.db
      .from("companies")
      .insert({ name: companyName, short_name: cleanOptional(shortName) })
      .select("id,name,short_name")
      .single();
    if (error) throw new Error(`create company failed (${companyName}): ${error.message}`);
    return { action: "created", record: data };
  }

  async listDepartments(options = {}) {
    const normalizedCompany = typeof options === "string" ? cleanOptional(options) : cleanOptional(options.companyName);
    const normalizedCompanies = typeof options === "object" && Array.isArray(options.companyNames)
      ? options.companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    const companyIds = await this.scopedCompanyIds({
      companyName: normalizedCompany,
      companyNames: normalizedCompanies
    });
    let companyMatches = [];
    let query = this.db
      .from("departments")
      .select("id,name,companies(name)")
      .order("name");
    if (companyIds !== null) {
      if (!companyIds.length) return { companyMatches: [], departments: [] };
      query = query.in("company_id", companyIds);
      const { data: companies, error: companyError } = await this.db
        .from("companies")
        .select("id,name,short_name")
        .in("id", companyIds);
      if (companyError) throw new Error(`list department companies failed: ${companyError.message}`);
      companyMatches = companies ?? [];
    }
    const { data, error } = await query;
    if (error) throw new Error(`list departments failed: ${error.message}`);
    return { companyMatches, departments: data ?? [] };
  }

  async findDepartment({ companyName, departmentName }) {
    const department = normalizeRequired(departmentName, "department name");
    const { companyMatches, departments } = await this.listDepartments({ companyName });
    if (companyMatches.length !== 1) return { companyMatches, departmentMatches: [] };
    return {
      companyMatches,
      departmentMatches: departments.filter((row) => row.name === department)
    };
  }

  async ensureDepartment({ companyName, departmentName }) {
    const department = normalizeRequired(departmentName, "department name");
    const companyResult = await this.ensureCompany({ name: companyName });
    const company = companyResult.record;

    const { data: existing, error: readError } = await this.db
      .from("departments")
      .select("id,name,company_id")
      .eq("company_id", company.id)
      .eq("name", department)
      .limit(2);
    if (readError) throw new Error(`find department failed (${department}): ${readError.message}`);
    if ((existing ?? []).length > 1) throw new Error(`multiple departments matched: ${company.name} / ${department}`);
    if ((existing ?? []).length === 1) return { action: "existing", record: existing[0], company };

    const { data, error } = await this.db
      .from("departments")
      .insert({ company_id: company.id, name: department })
      .select("id,name,company_id")
      .single();
    if (error) throw new Error(`create department failed (${company.name} / ${department}): ${error.message}`);
    return { action: "created", record: data, company };
  }

  async applyOrgSeeds({ plan, confirm, companyName = null } = {}) {
    if (confirm !== "创建公司和部门") {
      throw new Error("applyOrgSeeds requires confirm: 创建公司和部门");
    }
    plan = normalizeOrgPlan(plan, companyName);
    this.assertPlanCompanyScope({ plan, companyName, resource: "hr.organization", action: "write" });

    const results = {
      companies: [],
      departments: []
    };

    for (const company of plan?.companies ?? []) {
      const companyResult = await this.ensureCompany({
        name: company.name,
        shortName: company.short_name ?? null
      });
      results.companies.push({
        name: companyResult.record.name,
        action: companyResult.action
      });

      for (const department of company.departments ?? []) {
        const departmentName = typeof department === "string" ? department : department.name;
        if (!cleanOptional(departmentName)) continue;
        const departmentResult = await this.ensureDepartment({
          companyName: companyResult.record.name,
          departmentName
        });
        results.departments.push({
          company: companyResult.record.name,
          name: departmentResult.record.name,
          action: departmentResult.action
        });
      }
    }

    return {
      write: results,
      verification: await this.verifyOrgSeeds({ plan })
    };
  }

  async previewOrgSeeds({ plan, companyName = null } = {}) {
    plan = normalizeOrgPlan(plan, companyName);
    assertNonEmptyOrgPlan(plan);
    this.assertPlanCompanyScope({ plan, companyName, resource: "hr.organization", action: "write" });
    const results = {
      companies: [],
      departments: []
    };

    for (const company of plan?.companies ?? []) {
      const companyName = normalizeRequired(company.name, "company name");
      const companyMatches = await this.findCompanyByName(companyName);
      results.companies.push({
        name: companyName,
        action: companyMatches.length === 0 ? "would_create" : companyMatches.length === 1 ? "existing" : "ambiguous"
      });

      for (const department of company.departments ?? []) {
        const departmentName = typeof department === "string" ? department : department.name;
        if (!cleanOptional(departmentName)) continue;
        const lookup = await this.findDepartment({ companyName, departmentName });
        results.departments.push({
          company: companyName,
          name: departmentName,
          action: lookup.departmentMatches.length === 0 ? "would_create" : lookup.departmentMatches.length === 1 ? "existing" : "ambiguous"
        });
      }
    }

    return results;
  }

  async verifyOrgSeeds({ plan, companyName = null } = {}) {
    plan = normalizeOrgPlan(plan, companyName);
    assertNonEmptyOrgPlan(plan);
    this.assertPlanCompanyScope({ plan, companyName, resource: "hr.organization", action: "read" });
    const results = {
      companies: [],
      departments: []
    };

    for (const company of plan?.companies ?? []) {
      const companyName = normalizeRequired(company.name, "company name");
      const companyMatches = await this.findCompanyByName(companyName);
      results.companies.push({
        name: companyName,
        ok: companyMatches.length === 1,
        diffs: companyMatches.length === 1 ? [] : [`expected exactly one company, found ${companyMatches.length}`]
      });

      for (const department of company.departments ?? []) {
        const departmentName = typeof department === "string" ? department : department.name;
        if (!cleanOptional(departmentName)) continue;
        const lookup = await this.findDepartment({ companyName, departmentName });
        results.departments.push({
          company: companyName,
          name: departmentName,
          ok: lookup.departmentMatches.length === 1,
          diffs: lookup.departmentMatches.length === 1 ? [] : [`expected exactly one department, found ${lookup.departmentMatches.length}`]
        });
      }
    }

    return results;
  }

  async deleteEmptyDepartments({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.department", action: "write" });
    if (confirm !== "删除空部门") {
      throw new Error("deleteEmptyDepartments requires confirm: 删除空部门");
    }

    const results = [];
    for (const item of plan?.departments ?? []) {
      const companyName = normalizeRequired(item.company, "company name");
      const departmentName = normalizeRequired(item.name, "department name");
      const lookup = await this.findDepartment({ companyName, departmentName });

      if (lookup.companyMatches?.length !== 1) {
        results.push({ company: companyName, name: departmentName, action: "skipped", reason: "company not uniquely matched" });
        continue;
      }
      if (lookup.departmentMatches.length === 0) {
        results.push({ company: companyName, name: departmentName, action: "skipped", reason: "department not found" });
        continue;
      }
      if (lookup.departmentMatches.length > 1) {
        results.push({ company: companyName, name: departmentName, action: "skipped", reason: "department not uniquely matched" });
        continue;
      }

      const department = lookup.departmentMatches[0];
      const { count, error: countError } = await this.db
        .from("employees")
        .select("*", { count: "exact", head: true })
        .eq("department_id", department.id);
      if (countError) throw new Error(`count employees failed (${companyName} / ${departmentName}): ${countError.message}`);
      if ((count ?? 0) > 0) {
        results.push({ company: companyName, name: departmentName, action: "skipped", reason: `department has ${count} employees` });
        continue;
      }

      const { error } = await this.db.from("departments").delete().eq("id", department.id);
      if (error) throw new Error(`delete department failed (${companyName} / ${departmentName}): ${error.message}`);
      results.push({ company: companyName, name: departmentName, action: "deleted" });
    }

    return results;
  }

  async findEmployeeByIdCard(idCardNumber, { companyName, companyNames } = {}) {
    const value = normalizeRequired(idCardNumber, "identity document number");
    let query = this.db
      .from("employees")
      .select(employeeSelect())
      .eq("id_card_number", value);
    query = await this.applyCompanyScope(query, { companyName, companyNames });
    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find employee by id card failed: ${error.message}`);
    return data ?? [];
  }

  async findEmployeeByPhone(phone, { companyName, companyNames } = {}) {
    const value = normalizeRequired(phone, "phone number");
    let query = this.db
      .from("employees")
      .select(employeeSelect())
      .eq("phone", value);
    query = await this.applyCompanyScope(query, { companyName, companyNames });
    const { data, error } = await query.limit(10);
    if (error) throw new Error(`find employee by phone failed: ${error.message}`);
    return data ?? [];
  }

  async applyCompanyScope(query, { companyName, companyNames } = {}) {
    const scopedCompanyNames = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    if (companyName) {
      const companies = await this.findCompanyByName(companyName);
      if (companies.length !== 1) return query.eq("company_id", "00000000-0000-0000-0000-000000000000");
      if (scopedCompanyNames.length && !scopedCompanyNames.includes(companies[0].name)) {
        return query.eq("company_id", "00000000-0000-0000-0000-000000000000");
      }
      return query.eq("company_id", companies[0].id);
    }
    if (scopedCompanyNames.length) {
      const companyIds = await this.companyIdsByNames(scopedCompanyNames);
      if (companyIds.length === 0) return query.eq("company_id", "00000000-0000-0000-0000-000000000000");
      return query.in("company_id", companyIds);
    }
    return query;
  }

  async findEmployeeCandidates({ name, companyName, companyNames, departmentName } = {}) {
    const employeeName = normalizeRequired(name, "employee name");
    let query = this.db
      .from("employees")
      .select(employeeSelect())
      .eq("name", employeeName);

    const scopedCompanyNames = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    if (companyName) {
      const companies = await this.findCompanyByName(companyName);
      if (companies.length !== 1) return { companyMatches: companies, candidates: [] };
      query = query.eq("company_id", companies[0].id);
    } else if (scopedCompanyNames.length) {
      const companyIds = await this.companyIdsByNames(scopedCompanyNames);
      if (companyIds.length === 0) return { companyMatches: [], candidates: [] };
      query = query.in("company_id", companyIds);
    }

    if (departmentName) {
      if (!companyName) throw new Error("company name is required when matching by department");
      const departments = await this.findDepartment({ companyName, departmentName });
      if (departments.departmentMatches.length !== 1) {
        return {
          companyMatches: departments.companyMatches,
          departmentMatches: departments.departmentMatches,
          candidates: []
        };
      }
      query = query.eq("department_id", departments.departmentMatches[0].id);
    }

    const { data, error } = await query.limit(20);
    if (error) throw new Error(`find employee candidates failed: ${error.message}`);
    return { candidates: data ?? [] };
  }

  async findEmployeeNameLike({ name, companyName, companyNames } = {}) {
    const employeeName = normalizeRequired(name, "employee name");
    let query = this.db
      .from("employees")
      .select(employeeSelect())
      .ilike("name", `%${employeeName}%`)
      .order("name", { ascending: true });

    const scopedCompanyNames = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    if (companyName) {
      const companies = await this.findCompanyByName(companyName);
      if (companies.length !== 1) return { companyMatches: companies, candidates: [] };
      query = query.eq("company_id", companies[0].id);
    } else if (scopedCompanyNames.length) {
      const companyIds = await this.companyIdsByNames(scopedCompanyNames);
      if (companyIds.length === 0) return { companyMatches: [], candidates: [] };
      query = query.in("company_id", companyIds);
    }

    const { data, error } = await query.limit(50);
    if (error) throw new Error(`find employee name like failed: ${error.message}`);
    return { candidates: data ?? [] };
  }

  async resolveEmployeeLookup({ idCard, phone, name, companyName, companyNames, departmentName } = {}) {
    let candidates = [];
    let strategy = null;
    const scopedCompanyNames = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];

    if (cleanOptional(idCard)) {
      candidates = await this.findEmployeeByIdCard(idCard, { companyName, companyNames });
      strategy = "id_card";
    } else if (cleanOptional(phone)) {
      candidates = await this.findEmployeeByPhone(phone, { companyName, companyNames });
      strategy = "phone";
    } else {
      const result = await this.findEmployeeCandidates({ name, companyName, companyNames, departmentName });
      candidates = result.candidates ?? [];
      strategy = departmentName ? "name+company+department" : companyName ? "name+company" : scopedCompanyNames.length ? "name+scoped_companies" : "name";
    }

    return {
      strategy,
      status: candidates.length === 1 ? "matched" : candidates.length > 1 ? "ambiguous" : "unmatched",
      candidates
    };
  }

  async requireUniqueEmployee(options = {}) {
    const lookup = await this.resolveEmployeeLookup(options);
    if (lookup.candidates.length !== 1) {
      return {
        ok: false,
        lookup: {
          strategy: lookup.strategy,
          status: lookup.status,
          candidates: lookup.candidates.map(employeeBusinessRow)
        }
      };
    }
    return { ok: true, employee: lookup.candidates[0], strategy: lookup.strategy };
  }

  async employeeDetail(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;

    const { data, error } = await this.db
      .from("employees")
      .select(employeeDetailSelect())
      .eq("id", resolved.employee.id)
      .single();
    if (error) throw new Error(`employee detail failed: ${error.message}`);

    return employeeDetailBusinessRow(data);
  }

  async employeeTimeline(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;
    const employee = resolved.employee;

    const [
      contracts,
      performanceReviews,
      insuranceChanges,
      personnelChanges,
      disciplinaryRecords
    ] = await Promise.all([
      this.contractsByEmployeeId(employee.id),
      this.performanceByEmployeeId(employee.id),
      this.insuranceChangesByEmployeeId(employee.id),
      this.personnelChangesByEmployeeId(employee.id),
      this.disciplinaryRecordsByEmployeeId(employee.id)
    ]);

    return {
      employee: employeeBusinessRow(employee),
      counts: {
        contracts: contracts.length,
        performance_reviews: performanceReviews.length,
        insurance_changes: insuranceChanges.length,
        personnel_changes: personnelChanges.length,
        disciplinary_records: disciplinaryRecords.length
      },
      contracts,
      performance_reviews: performanceReviews,
      insurance_changes: insuranceChanges,
      personnel_changes: personnelChanges,
      disciplinary_records: disciplinaryRecords
    };
  }

  async contractsByEmployee(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;
    return {
      employee: employeeBusinessRow(resolved.employee),
      records: await this.contractsByEmployeeId(resolved.employee.id)
    };
  }

  async performanceByEmployee(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;
    return {
      employee: employeeBusinessRow(resolved.employee),
      records: await this.performanceByEmployeeId(resolved.employee.id)
    };
  }

  async insuranceChangesByEmployee(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;
    return {
      employee: employeeBusinessRow(resolved.employee),
      records: await this.insuranceChangesByEmployeeId(resolved.employee.id)
    };
  }

  async personnelChangesByEmployee(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;
    return {
      employee: employeeBusinessRow(resolved.employee),
      records: await this.personnelChangesByEmployeeId(resolved.employee.id)
    };
  }

  async personnelChangesList({ year, changeReason, companyName, companyNames } = {}) {
    const { from, to, label } = yearRange(year);
    let query = this.db
      .from("personnel_changes")
      .select(personnelChangeSelect())
      .gte("effective_date", from)
      .lte("effective_date", to)
      .order("effective_date", { ascending: true });
    const reason = cleanOptional(changeReason);
    if (reason) query = query.ilike("change_reason", `%${reason}%`);
    const scopedEmployeeIds = await this.scopedEmployeeIds({ companyName, companyNames });
    if (scopedEmployeeIds !== null) {
      if (!scopedEmployeeIds.length) {
        return { year: label, reason: reason ?? null, company: scopeLabel(companyName, companyNames), records: [] };
      }
      query = query.in("employee_id", scopedEmployeeIds);
    }
    const { data, error } = await query;
    if (error) throw new Error(`personnel changes list failed: ${error.message}`);
    return {
      year: label,
      reason: reason ?? null,
      company: scopeLabel(companyName, companyNames),
      records: (data ?? []).map(personnelChangeBusinessRow)
    };
  }

  async disciplinaryRecordsByEmployee(options = {}) {
    const resolved = await this.requireUniqueEmployee(options);
    if (!resolved.ok) return resolved.lookup;
    return {
      employee: employeeBusinessRow(resolved.employee),
      records: await this.disciplinaryRecordsByEmployeeId(resolved.employee.id)
    };
  }

  async performanceByMonth({ month, companyName, companyNames } = {}) {
    const reviewDate = monthToReviewDate(month);
    let query = this.db
      .from("performance_reviews")
      .select(performanceReviewSelect())
      .eq("review_date", reviewDate)
      .order("final_score", { ascending: true });
    const scopedEmployeeIds = await this.scopedEmployeeIds({ companyName, companyNames });
    if (scopedEmployeeIds !== null) {
      if (!scopedEmployeeIds.length) return { month: reviewDate.slice(0, 7), company: scopeLabel(companyName, companyNames), records: [] };
      query = query.in("employee_id", scopedEmployeeIds);
    }
    const { data, error } = await query;
    if (error) throw new Error(`performance by month failed: ${error.message}`);
    return {
      month: reviewDate.slice(0, 7),
      company: scopeLabel(companyName, companyNames),
      records: (data ?? []).map(performanceBusinessRow)
    };
  }

  async insuranceChangesByMonth({ month, companyName, companyNames } = {}) {
    const { from, to } = monthRange(month);
    let query = this.db
      .from("insurance_changes")
      .select(insuranceChangeSelect())
      .gte("change_date", from)
      .lte("change_date", to)
      .order("change_date", { ascending: true });
    const scopedEmployeeIds = await this.scopedEmployeeIds({ companyName, companyNames });
    if (scopedEmployeeIds !== null) {
      if (!scopedEmployeeIds.length) return { month: from.slice(0, 7), company: scopeLabel(companyName, companyNames), records: [] };
      query = query.in("employee_id", scopedEmployeeIds);
    }
    const { data, error } = await query;
    if (error) throw new Error(`insurance changes by month failed: ${error.message}`);
    return {
      month: from.slice(0, 7),
      company: scopeLabel(companyName, companyNames),
      records: (data ?? []).map(insuranceChangeBusinessRow)
    };
  }

  async sealUsageList({ companyName, companyNames, dateFrom, dateTo, employeeName } = {}) {
    let query = this.db
      .from("seal_usage")
      .select(sealUsageSelect())
      .order("usage_date", { ascending: false });
    const companyIds = await this.scopedCompanyIds({ companyName, companyNames });
    if (companyIds !== null) {
      if (!companyIds.length) return { company: scopeLabel(companyName, companyNames), records: [] };
      query = query.in("company_id", companyIds);
    }
    if (cleanOptional(dateFrom)) query = query.gte("usage_date", dateFrom);
    if (cleanOptional(dateTo)) query = query.lte("usage_date", dateTo);

    const { data, error } = await query.limit(200);
    if (error) throw new Error(`seal usage list failed: ${error.message}`);
    let records = (data ?? []).map(sealUsageBusinessRow);
    const name = cleanOptional(employeeName);
    if (name) {
      records = records.filter((row) => row.applicant === name || row.seal_applicant === name);
    }
    return { records };
  }

  async pendingReviewList() {
    const files = [
      ["社医保异动", "import_work/insurance/insurance_unmatched_for_hr_review.json"],
      ["人事异动", "import_work/personnel_changes/personnel_changes_review_required.json"],
      ["奖惩记录", "import_work/disciplinary_records/disciplinary_review_required.json"],
      ["绩效", "import_work/performance_reviews/performance_review_required.json"]
    ];
    const results = [];
    for (const [label, file] of files) {
      if (!fs.existsSync(file)) {
        results.push({ module: label, count: 0, records: [], source: file, missing_file: true });
        continue;
      }
      const content = JSON.parse(fs.readFileSync(file, "utf8"));
      const records = Array.isArray(content) ? content : content.records ?? [];
      results.push({
        module: label,
        count: records.length,
        source: file,
        records: records.map(pendingReviewBusinessRow)
      });
    }
    return results;
  }

  async dataQualityCheck() {
    const [counts, employeeSummary, employeesWithoutContracts, pendingReviews] = await Promise.all([
      this.countAllTables(),
      this.employeeSummary(),
      this.employeesWithoutContracts(),
      this.pendingReviewList()
    ]);
    return {
      counts,
      employee_checks: employeeSummary.checks,
      employees_without_contracts: employeesWithoutContracts,
      pending_reviews: pendingReviews.map((item) => ({
        module: item.module,
        count: item.count,
        source: item.source
      }))
    };
  }

  async analyzeHeadcount({ companyName, companyNames } = {}) {
    const summary = await this.employeeSummary({ companyName, companyNames });
    const activeStatuses = new Set(["正式", "试用", "合作协议", "实习"]);
    const byCompany = summary.byCompany.map((item) => {
      const active = Object.entries(item.statuses)
        .filter(([status]) => activeStatuses.has(status))
        .reduce((sum, [, count]) => sum + count, 0);
      const resigned = item.statuses["离职"] ?? 0;
      return {
        company: item.company,
        total: item.total,
        active,
        resigned,
        statuses: item.statuses
      };
    });
    return {
      total: summary.total,
      company: summary.company ?? null,
      active: byCompany.reduce((sum, row) => sum + row.active, 0),
      resigned: byCompany.reduce((sum, row) => sum + row.resigned, 0),
      by_company: byCompany,
      by_department: summary.byDepartment,
      quality_flags: {
        empty_department_count: summary.checks.emptyDepartment.length,
        empty_id_card_count: summary.checks.emptyIdCard.length,
        duplicate_id_card_groups: summary.checks.duplicateIdCards.length,
        duplicate_phone_groups: summary.checks.duplicatePhones.length
      }
    };
  }

  async analyzeContractCoverage({ companyName, companyNames } = {}) {
    let employeesQuery = this.db
      .from("employees")
      .select("id,name,status,phone,id_card_number,companies(name),departments(name)")
      .order("name");
    const scopedEmployeeIds = await this.scopedEmployeeIds({ companyName, companyNames });
    if (scopedEmployeeIds !== null) {
      if (!scopedEmployeeIds.length) {
        return {
          employees_total: 0,
          active_employees: 0,
          contract_records: 0,
          active_with_contracts: 0,
          active_without_contracts: 0,
          active_contract_coverage_rate: null,
          contract_type_distribution: {},
          active_without_contract_records: []
        };
      }
      employeesQuery = employeesQuery.in("id", scopedEmployeeIds);
    }
    const { data: employees, error: employeesError } = await employeesQuery;
    if (employeesError) throw new Error(`list employees failed: ${employeesError.message}`);

    let contractsQuery = this.db
      .from("contracts")
      .select("employee_id,type,expiry_date,is_permanent");
    if (scopedEmployeeIds !== null && scopedEmployeeIds.length) {
      contractsQuery = contractsQuery.in("employee_id", scopedEmployeeIds);
    }
    const { data: contracts, error: contractsError } = await contractsQuery;
    if (contractsError) throw new Error(`list contracts failed: ${contractsError.message}`);

    const employeeIdsWithContracts = new Set((contracts ?? []).map((row) => row.employee_id));
    const activeEmployees = (employees ?? []).filter((row) => row.status !== "离职");
    const activeWithoutContracts = activeEmployees
      .filter((row) => !employeeIdsWithContracts.has(row.id))
      .map(employeeBusinessRow);
    const byType = countBy(contracts ?? [], "type");
    return {
      employees_total: (employees ?? []).length,
      active_employees: activeEmployees.length,
      contract_records: (contracts ?? []).length,
      active_with_contracts: activeEmployees.length - activeWithoutContracts.length,
      active_without_contracts: activeWithoutContracts.length,
      active_contract_coverage_rate: activeEmployees.length
        ? Number(((activeEmployees.length - activeWithoutContracts.length) / activeEmployees.length).toFixed(4))
        : null,
      contract_type_distribution: byType,
      active_without_contract_records: activeWithoutContracts
    };
  }

  async analyzeContractExpiry({ days, companyName, companyNames } = {}) {
    const rangeDays = Number(cleanOptional(days) ?? 90);
    if (!Number.isFinite(rangeDays) || rangeDays < 0) throw new Error(`days must be a positive number: ${days}`);
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + rangeDays);
    const from = today.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    let query = this.db
      .from("contracts")
      .select(contractSelect())
      .eq("is_permanent", false)
      .gte("expiry_date", from)
      .lte("expiry_date", to)
      .order("expiry_date", { ascending: true });
    const scopedEmployeeIds = await this.scopedEmployeeIds({ companyName, companyNames });
    if (scopedEmployeeIds !== null) {
      if (!scopedEmployeeIds.length) {
        return {
          days: rangeDays,
          from,
          to,
          count: 0,
          records: []
        };
      }
      query = query.in("employee_id", scopedEmployeeIds);
    }
    const { data, error } = await query;
    if (error) throw new Error(`contract expiry analysis failed: ${error.message}`);
    return {
      days: rangeDays,
      from,
      to,
      count: (data ?? []).length,
      records: (data ?? []).map(contractBusinessRow)
    };
  }

  async analyzePerformanceMonth({ month, companyName, companyNames } = {}) {
    const result = await this.performanceByMonth({ month, companyName, companyNames });
    const records = result.records;
    const scores = records.map((row) => Number(row.final_score)).filter((value) => Number.isFinite(value));
    const byCompany = summarizePerformanceBy(records, "company");
    return {
      month: result.month,
      company: result.company,
      count: records.length,
      average_final_score: average(scores),
      min_final_score: scores.length ? Math.min(...scores) : null,
      max_final_score: scores.length ? Math.max(...scores) : null,
      low_score_count_below_60: records.filter((row) => Number(row.final_score) < 60).length,
      performance_salary_total: sumNumeric(records, "performance_salary"),
      actual_performance_salary_total: sumNumeric(records, "actual_performance_salary"),
      performance_adjustment_total: sumNumeric(records, "performance_adjustment"),
      by_company: byCompany,
      records
    };
  }

  async analyzeLowPerformance({ month, companyName, companyNames, threshold } = {}) {
    const limit = Number(cleanOptional(threshold) ?? 60);
    const result = await this.performanceByMonth({ month, companyName, companyNames });
    const records = result.records
      .filter((row) => Number(row.final_score) < limit)
      .sort((a, b) => Number(a.final_score) - Number(b.final_score));
    return {
      month: result.month,
      company: result.company,
      threshold: limit,
      count: records.length,
      records
    };
  }

  async analyzeInsuranceMonth({ month, companyName, companyNames } = {}) {
    const result = await this.insuranceChangesByMonth({ month, companyName, companyNames });
    return {
      month: result.month,
      company: result.company,
      count: result.records.length,
      by_status: countBy(result.records, "status"),
      by_company: countBy(result.records, "company"),
      add_count: result.records.filter((row) => cleanOptional(row.insurance_add_date)).length,
      remove_count: result.records.filter((row) => cleanOptional(row.insurance_remove_date)).length,
      records: result.records
    };
  }

  async analyzeDisciplinary({ companyName, companyNames } = {}) {
    let query = this.db
      .from("disciplinary_records")
      .select(disciplinaryRecordSelect())
      .order("incident_date", { ascending: false });
    const scopedEmployeeIds = await this.scopedEmployeeIds({ companyName, companyNames });
    if (scopedEmployeeIds !== null) {
      if (!scopedEmployeeIds.length) return { company: scopeLabel(companyName, companyNames), count: 0, records: [] };
      query = query.in("employee_id", scopedEmployeeIds);
    }
    const { data, error } = await query;
    if (error) throw new Error(`disciplinary analysis failed: ${error.message}`);
    const records = (data ?? []).map(disciplinaryRecordBusinessRow);
    return {
      company: scopeLabel(companyName, companyNames),
      count: records.length,
      by_company: countBy(records, "company"),
      by_penalty_type: countBy(records, "penalty_type"),
      missing_signed_upload_count: records.filter((row) => !Array.isArray(row.signed_upload) || row.signed_upload.length === 0).length,
      records
    };
  }

  async analyzeHrRiskDashboard() {
    const [
      counts,
      headcount,
      contractCoverage,
      contractExpiry,
      pendingReviews,
      disciplinary
    ] = await Promise.all([
      this.countAllTables(),
      this.analyzeHeadcount(),
      this.analyzeContractCoverage(),
      this.analyzeContractExpiry({ days: 90 }),
      this.pendingReviewList(),
      this.analyzeDisciplinary()
    ]);
    return {
      counts,
      headcount_summary: {
        total: headcount.total,
        active: headcount.active,
        resigned: headcount.resigned,
        quality_flags: headcount.quality_flags
      },
      contract_summary: {
        active_contract_coverage_rate: contractCoverage.active_contract_coverage_rate,
        active_without_contracts: contractCoverage.active_without_contracts,
        expiring_in_90_days: contractExpiry.count
      },
      disciplinary_summary: {
        total: disciplinary.count,
        missing_signed_upload_count: disciplinary.missing_signed_upload_count,
        by_penalty_type: disciplinary.by_penalty_type
      },
      pending_reviews: pendingReviews.map((item) => ({
        module: item.module,
        count: item.count,
        source: item.source
      })),
      recommended_actions: hrRiskRecommendedActions({
        headcount,
        contractCoverage,
        contractExpiry,
        disciplinary,
        pendingReviews
      })
    };
  }

  async uniqueCompany(companyName) {
    const matches = await this.findCompanyByName(companyName);
    return matches.length === 1 ? matches[0] : null;
  }

  async companyIdsByNames(companyNames = []) {
    const ids = [];
    for (const name of companyNames) {
      const company = await this.uniqueCompany(name);
      if (company) ids.push(company.id);
    }
    return ids;
  }

  async scopedCompanyIds({ companyName, companyNames } = {}) {
    const normalizedCompany = cleanOptional(companyName);
    const normalizedCompanies = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    if (!normalizedCompany && !normalizedCompanies.length) return null;
    return normalizedCompany
      ? this.companyIdsByNames([normalizedCompany])
      : this.companyIdsByNames(normalizedCompanies);
  }

  async scopedEmployeeIds({ companyName, companyNames } = {}) {
    const normalizedCompany = cleanOptional(companyName);
    const normalizedCompanies = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    if (!normalizedCompany && !normalizedCompanies.length) return null;
    const companyIds = normalizedCompany
      ? await this.companyIdsByNames([normalizedCompany])
      : await this.companyIdsByNames(normalizedCompanies);
    if (!companyIds.length) return [];
    const { data, error } = await this.db
      .from("employees")
      .select("id")
      .in("company_id", companyIds);
    if (error) throw new Error(`scoped employee ids failed: ${error.message}`);
    return (data ?? []).map((row) => row.id);
  }

  async employeeIdsByCompany(companyName) {
    const company = await this.uniqueCompany(companyName);
    if (!company) return [];
    const { data, error } = await this.db
      .from("employees")
      .select("id")
      .eq("company_id", company.id);
    if (error) throw new Error(`employee ids by company failed: ${error.message}`);
    return (data ?? []).map((row) => row.id);
  }

  async contractsByEmployeeId(employeeId) {
    const { data, error } = await this.db
      .from("contracts")
      .select(contractSelect())
      .eq("employee_id", employeeId)
      .order("start_date", { ascending: false });
    if (error) throw new Error(`contracts by employee failed: ${error.message}`);
    return (data ?? []).map(contractBusinessRow);
  }

  async performanceByEmployeeId(employeeId) {
    const { data, error } = await this.db
      .from("performance_reviews")
      .select(performanceReviewSelect())
      .eq("employee_id", employeeId)
      .order("review_date", { ascending: false });
    if (error) throw new Error(`performance by employee failed: ${error.message}`);
    return (data ?? []).map(performanceBusinessRow);
  }

  async insuranceChangesByEmployeeId(employeeId) {
    const { data, error } = await this.db
      .from("insurance_changes")
      .select(insuranceChangeSelect())
      .eq("employee_id", employeeId)
      .order("change_date", { ascending: false });
    if (error) throw new Error(`insurance by employee failed: ${error.message}`);
    return (data ?? []).map(insuranceChangeBusinessRow);
  }

  async personnelChangesByEmployeeId(employeeId) {
    const { data, error } = await this.db
      .from("personnel_changes")
      .select(personnelChangeSelect())
      .eq("employee_id", employeeId)
      .order("effective_date", { ascending: false });
    if (error) throw new Error(`personnel changes by employee failed: ${error.message}`);
    return (data ?? []).map(personnelChangeBusinessRow);
  }

  async disciplinaryRecordsByEmployeeId(employeeId) {
    const { data, error } = await this.db
      .from("disciplinary_records")
      .select(disciplinaryRecordSelect())
      .eq("employee_id", employeeId)
      .order("incident_date", { ascending: false });
    if (error) throw new Error(`disciplinary records by employee failed: ${error.message}`);
    return (data ?? []).map(disciplinaryRecordBusinessRow);
  }

  async applyEmployeeSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "write" });
    if (confirm !== "导入员工主档") {
      throw new Error("applyEmployeeSeeds requires confirm: 导入员工主档");
    }
    plan = normalizeRecordsPlan(plan, normalizeEmployeeSeedRecord);

    const results = [];
    for (const record of plan?.records ?? []) {
      const companyName = normalizeRequired(record.company, "company name");
      const employeeName = normalizeRequired(record.name, "employee name");
      const departmentName = cleanOptional(record.department);

      const companyMatches = await this.findCompanyByName(companyName);
      if (companyMatches.length !== 1) {
        results.push({ name: employeeName, action: "skipped", reason: "company not uniquely matched" });
        continue;
      }
      const company = companyMatches[0];

      let department = null;
      if (departmentName) {
        const departmentLookup = await this.findDepartment({ companyName, departmentName });
        if (departmentLookup.departmentMatches.length !== 1) {
          results.push({ name: employeeName, action: "skipped", reason: "department not uniquely matched", department: departmentName });
          continue;
        }
        department = departmentLookup.departmentMatches[0];
      }

      const existing = await this.findExistingEmployee(record);
      if (existing.length > 1) {
        results.push({ name: employeeName, action: "skipped", reason: "multiple existing employees matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ name: employeeName, action: "existing", reason: "employee already exists" });
        continue;
      }

      const payload = employeePayload(record, company.id, department?.id ?? null);
      const { data, error } = await this.db
        .from("employees")
        .insert(payload)
        .select(employeeSelect())
        .single();
      if (error) throw new Error(`create employee failed (${employeeName}): ${error.message}`);
      results.push({ name: employeeName, action: "created", status: data.status, department: department?.name ?? null });
    }

    return {
      write: results,
      verification: await this.verifyEmployeeSeeds({ plan })
    };
  }

  async verifyEmployeeSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "read" });
    plan = normalizeRecordsPlan(plan, normalizeEmployeeSeedRecord);
    const fields = [
      "name",
      "gender",
      "birth_date",
      "position",
      "hire_date",
      "probation_end_date",
      "status",
      "phone",
      "id_card_number",
      "id_card_expiry",
      "education",
      "school",
      "graduation_date",
      "major",
      "current_address",
      "hukou_address",
      "bank_account",
      "bank_name",
      "resignation_date",
      "resignation_reason",
      "notes"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingEmployee(record);
      if (matches.length !== 1) {
        results.push({
          name: record.name,
          id_card_number: cleanOptional(record.id_card_number),
          ok: false,
          diffs: [{ field: "employee", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("employees")
        .select("*,companies(name),departments(name)")
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify employee failed (${record.name}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "company", record.company, data.companies?.name);
      compareField(diffs, "department", record.department, data.departments?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        name: record.name,
        id_card_number: cleanOptional(record.id_card_number),
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async previewEmployeeSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "write" });
    plan = normalizeRecordsPlan(plan, normalizeEmployeeSeedRecord);
    const records = [];
    for (const record of plan.records) {
      const previewRecord = { ...record };
      previewRecord.match = {
        company: await this.findCompanyByName(record.company),
        department: record.department
          ? await this.findDepartment({ companyName: record.company, departmentName: record.department })
          : null,
        existing_employee_count: (await this.findExistingEmployee(record)).length
      };
      records.push(previewRecord);
    }
    return {
      summary: {
        records: records.length,
        with_existing_employee: records.filter((record) => record.match.existing_employee_count > 0).length,
        by_company: countBy(records, "company")
      },
      records
    };
  }

  async deleteEmployeeRecords({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "delete" });
    if (confirm !== "删除员工记录") {
      throw new Error("deleteEmployeeRecords requires confirm: 删除员工记录");
    }

    const results = [];
    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingEmployee(record);
      const exactMatches = matches.filter((row) => employeeMatchesExpected(row, record));
      if (exactMatches.length !== 1) {
        results.push({
          name: record.name,
          action: "skipped",
          reason: `expected one exact employee match, found ${exactMatches.length}`,
          match_count: matches.length
        });
        continue;
      }

      const employee = exactMatches[0];
      const childCounts = await this.employeeChildRecordCounts(employee.id);
      const nonZeroChildren = Object.entries(childCounts).filter(([, count]) => count > 0);
      if (nonZeroChildren.length > 0 && record.allow_child_delete !== true) {
        results.push({
          name: employee.name,
          action: "skipped",
          reason: "employee has child records",
          child_counts: Object.fromEntries(nonZeroChildren)
        });
        continue;
      }

      const { error } = await this.db.from("employees").delete().eq("id", employee.id);
      if (error) throw new Error(`delete employee failed (${employee.name}): ${error.message}`);
      results.push({
        name: employee.name,
        action: "deleted",
        company: employee.companies?.name ?? null,
        department: employee.departments?.name ?? null,
        child_counts: childCounts
      });
    }

    return results;
  }

  async verifyEmployeeDeletions({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "read" });
    const results = [];
    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingEmployee(record);
      const exactMatches = matches.filter((row) => employeeMatchesExpected(row, record));
      results.push({
        name: record.name,
        ok: exactMatches.length === 0,
        remaining_matches: exactMatches.map((row) => ({
          name: row.name,
          company: row.companies?.name ?? null,
          department: row.departments?.name ?? null,
          phone: row.phone ?? null,
          id_card_number: row.id_card_number ?? null
        }))
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async employeeChildRecordCounts(employeeId) {
    const employee = normalizeRequired(employeeId, "employee id");
    const childTables = [
      "contracts",
      "performance_reviews",
      "insurance_changes",
      "personnel_changes",
      "disciplinary_records",
      "overtime_records",
      "work_injuries"
    ];
    const counts = {};
    for (const table of childTables) {
      const { count, error } = await this.db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("employee_id", employee);
      if (error) throw new Error(`count ${table} failed for employee: ${error.message}`);
      counts[table] = count ?? 0;
    }

    for (const [label, column] of Object.entries({ seal_usage_applicant: "applicant_id", seal_usage_user: "seal_applicant_id" })) {
      const { count, error } = await this.db
        .from("seal_usage")
        .select("*", { count: "exact", head: true })
        .eq(column, employee);
      if (error) throw new Error(`count ${label} failed for employee: ${error.message}`);
      counts[label] = count ?? 0;
    }
    return counts;
  }

  async applyContractSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.contract", action: "write" });
    if (confirm !== "导入合同") {
      throw new Error("applyContractSeeds requires confirm: 导入合同");
    }
    plan = await this.prepareContractPlan(plan);

    const results = [];
    for (const record of plan?.records ?? []) {
      const employee = contractEmployee(record);
      if (!employee?.id) {
        results.push({ name: record.employee_name, action: "skipped", reason: "employee not matched" });
        continue;
      }

      const existing = await this.findExistingContract(record);
      if (existing.length > 1) {
        results.push({ name: record.employee_name, action: "skipped", reason: "multiple existing contracts matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ name: record.employee_name, action: "existing", reason: "contract already exists", type: record.type });
        continue;
      }

      const payload = contractPayload(record, employee.id);
      const { data, error } = await this.db
        .from("contracts")
        .insert(payload)
        .select(contractSelect())
        .single();
      if (error) throw new Error(`create contract failed (${record.employee_name} / ${record.type}): ${error.message}`);
      results.push({
        name: data.employees?.name ?? record.employee_name,
        action: "created",
        type: data.type,
        start_date: data.start_date,
        expiry_date: data.expiry_date,
        is_permanent: data.is_permanent
      });
    }

    return {
      write: results,
      verification: await this.verifyContractSeeds({ plan })
    };
  }

  async verifyContractSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.contract", action: "read" });
    plan = await this.prepareContractPlan(plan);
    const fields = [
      "type",
      "sequence",
      "sign_date",
      "duration_years",
      "start_date",
      "expiry_date",
      "is_permanent",
      "notes"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingContract(record);
      if (matches.length !== 1) {
        results.push({
          name: record.employee_name,
          type: record.type,
          ok: false,
          diffs: [{ field: "contract", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("contracts")
        .select(contractSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify contract failed (${record.employee_name} / ${record.type}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "employee", contractEmployee(record)?.name, data.employees?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        name: record.employee_name,
        type: record.type,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async previewContractSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.contract", action: "write" });
    plan = await this.prepareContractPlan(plan);
    const records = plan.records.map((record) => ({
      ...record,
      match: record.match ?? null
    }));
    return {
      summary: previewSummary(records, "employee_name"),
      records
    };
  }

  async prepareContractPlan(plan) {
    plan = normalizeRecordsPlan(plan, normalizeContractSeedRecord);
    const records = [];
    for (const record of plan.records) {
      const prepared = { ...record };
      prepared.match = prepared.match ?? { employee: await this.matchEmployeeByNameAndCompany(prepared.employee_name, prepared.company) };
      records.push(prepared);
    }
    return { ...plan, records };
  }

  async previewPerformanceReviewSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.performance", action: "write" });
    plan = normalizeRecordsPlan(plan, normalizePerformanceReviewSeedRecord);
    const records = [];
    for (const record of plan?.records ?? []) {
      const previewRecord = { ...record };
      previewRecord.employee_name = performanceReviewName(record);
      previewRecord.match = await this.matchPerformanceReviewEmployee(record);
      records.push(previewRecord);
    }

    return {
      summary: {
        records: records.length,
        matched: records.filter((record) => record.match?.status === "matched").length,
        unmatched: records.filter((record) => record.match?.status === "unmatched").length,
        ambiguous: records.filter((record) => record.match?.status === "ambiguous").length,
        by_company: countBy(records, "company"),
        by_month: countBy(records, "review_date")
      },
      records
    };
  }

  async matchPerformanceReviewEmployee(record) {
    const employeeName = performanceReviewName(record);
    if (!employeeName) return { status: "unmatched", reason: "missing employee name" };

    const result = await this.findEmployeeCandidates({
      name: employeeName,
      companyName: record.company
    });
    const candidates = result.candidates ?? [];
    if (candidates.length === 1) {
      return { status: "matched", strategy: "name+company", employee: insuranceEmployee(candidates[0]) };
    }
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        strategy: "name+company",
        candidates: candidates.map(insuranceEmployee)
      };
    }
    return { status: "unmatched", strategy: "name+company", reason: "employee not found in master data" };
  }

  async applyPerformanceReviewSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.performance", action: "write" });
    if (confirm !== "导入绩效") {
      throw new Error("applyPerformanceReviewSeeds requires confirm: 导入绩效");
    }
    plan = await this.preparePerformanceReviewPlan(plan);

    const results = [];
    for (const record of plan?.records ?? []) {
      const employee = performanceReviewEmployee(record);
      if (!employee?.id) {
        results.push({ name: performanceReviewName(record), action: "skipped", reason: "employee not matched" });
        continue;
      }

      const existing = await this.findExistingPerformanceReview(record);
      if (existing.length > 1) {
        results.push({ name: performanceReviewName(record), action: "skipped", reason: "multiple existing performance reviews matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ name: performanceReviewName(record), action: "existing", review_date: record.review_date });
        continue;
      }

      const payload = performanceReviewPayload(record, employee.id);
      const { data, error } = await this.db
        .from("performance_reviews")
        .insert(payload)
        .select(performanceReviewSelect())
        .single();
      if (error) throw new Error(`create performance review failed (${performanceReviewName(record)}): ${error.message}`);
      results.push({
        name: data.employees?.name ?? performanceReviewName(record),
        action: "created",
        review_date: data.review_date,
        final_score: data.final_score
      });
    }

    return {
      write: results,
      verification: await this.verifyPerformanceReviewSeeds({ plan })
    };
  }

  async verifyPerformanceReviewSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.performance", action: "read" });
    plan = await this.preparePerformanceReviewPlan(plan);
    const fields = [
      "review_date",
      "self_score",
      "supervisor_score",
      "final_score",
      "performance_ratio",
      "performance_salary",
      "actual_performance_salary",
      "performance_adjustment",
      "notes"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingPerformanceReview(record);
      if (matches.length !== 1) {
        results.push({
          name: performanceReviewName(record),
          review_date: record.review_date,
          ok: false,
          diffs: [{ field: "performance_review", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("performance_reviews")
        .select(performanceReviewSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify performance review failed (${performanceReviewName(record)}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "employee", performanceReviewEmployee(record)?.name, data.employees?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        name: performanceReviewName(record),
        review_date: record.review_date,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async preparePerformanceReviewPlan(plan) {
    plan = normalizeRecordsPlan(plan, normalizePerformanceReviewSeedRecord);
    const preview = await this.previewPerformanceReviewSeeds({ plan });
    return { ...plan, records: preview.records };
  }

  async findExistingPerformanceReview(record) {
    const employee = performanceReviewEmployee(record);
    if (!employee?.id) return [];

    let query = this.db
      .from("performance_reviews")
      .select(performanceReviewSelect())
      .eq("employee_id", employee.id);

    const reviewDate = cleanOptional(record.review_date);
    query = reviewDate ? query.eq("review_date", reviewDate) : query.is("review_date", null);

    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find performance review failed (${performanceReviewName(record)}): ${error.message}`);
    return data ?? [];
  }

  async previewInsuranceChangeSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.insurance", action: "write" });
    plan = normalizeRecordsPlan(plan, normalizeInsuranceChangeSeedRecord);
    const records = [];
    for (const record of plan?.records ?? []) {
      const previewRecord = { ...record };
      previewRecord.match = await this.matchInsuranceChangeEmployee(record);
      records.push(previewRecord);
    }

    return {
      summary: {
        records: records.length,
        matched: records.filter((record) => record.match?.status === "matched").length,
        unmatched: records.filter((record) => record.match?.status === "unmatched").length,
        ambiguous: records.filter((record) => record.match?.status === "ambiguous").length,
        with_issues: records.filter((record) => (record.preview_issues ?? []).length > 0).length,
        by_company: countBy(records, "company"),
        by_status: countBy(records, "status")
      },
      records
    };
  }

  async matchInsuranceChangeEmployee(record) {
    const employeeName = cleanOptional(record.employee_name);
    if (!employeeName) return { status: "unmatched", reason: "missing employee name" };
    if (employeeName === "全体") return { status: "unmatched", reason: "batch row, not an individual employee" };

    const result = await this.findEmployeeCandidates({
      name: employeeName,
      companyName: record.company
    });
    const candidates = result.candidates ?? [];
    if (candidates.length === 1) {
      return { status: "matched", strategy: "name+company", employee: insuranceEmployee(candidates[0]) };
    }
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        strategy: "name+company",
        candidates: candidates.map(insuranceEmployee)
      };
    }
    return { status: "unmatched", strategy: "name+company", reason: "employee not found in master data" };
  }

  async applyInsuranceChangeSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.insurance", action: "write" });
    if (confirm !== "导入社医保异动") {
      throw new Error("applyInsuranceChangeSeeds requires confirm: 导入社医保异动");
    }
    plan = await this.prepareInsuranceChangePlan(plan);

    const results = [];
    for (const record of plan?.records ?? []) {
      const employee = insuranceChangeEmployee(record);
      if (!employee?.id) {
        results.push({ name: record.employee_name, action: "skipped", reason: "employee not matched" });
        continue;
      }

      const existing = await this.findExistingInsuranceChange(record);
      if (existing.length > 1) {
        results.push({ name: record.employee_name, action: "skipped", reason: "multiple existing changes matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ name: record.employee_name, action: "existing", reason: "insurance change already exists", status: record.status });
        continue;
      }

      const payload = insuranceChangePayload(record, employee.id);
      const { data, error } = await this.db
        .from("insurance_changes")
        .insert(payload)
        .select(insuranceChangeSelect())
        .single();
      if (error) throw new Error(`create insurance change failed (${record.employee_name} / ${record.status}): ${error.message}`);
      results.push({
        name: data.employees?.name ?? record.employee_name,
        action: "created",
        status: data.status,
        change_date: data.change_date,
        insurance_add_date: data.insurance_add_date,
        insurance_remove_date: data.insurance_remove_date
      });
    }

    return {
      write: results,
      verification: await this.verifyInsuranceChangeSeeds({ plan })
    };
  }

  async verifyInsuranceChangeSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.insurance", action: "read" });
    plan = await this.prepareInsuranceChangePlan(plan);
    const fields = [
      "change_date",
      "hire_date",
      "probation_end_date",
      "resignation_date",
      "insurance_add_date",
      "insurance_remove_date",
      "status",
      "hr_clerk",
      "notes"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingInsuranceChange(record);
      if (matches.length !== 1) {
        results.push({
          name: record.employee_name,
          status: record.status,
          ok: false,
          diffs: [{ field: "insurance_change", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("insurance_changes")
        .select(insuranceChangeSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify insurance change failed (${record.employee_name} / ${record.status}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "employee", insuranceChangeEmployee(record)?.name, data.employees?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        name: record.employee_name,
        status: record.status,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async prepareInsuranceChangePlan(plan) {
    plan = normalizeRecordsPlan(plan, normalizeInsuranceChangeSeedRecord);
    const preview = await this.previewInsuranceChangeSeeds({ plan });
    return { ...plan, records: preview.records };
  }

  async findExistingInsuranceChange(record) {
    const employee = insuranceChangeEmployee(record);
    if (!employee?.id) return [];

    let query = this.db
      .from("insurance_changes")
      .select(insuranceChangeSelect())
      .eq("employee_id", employee.id)
      .eq("status", normalizeRequired(record.status, "insurance change status"));

    for (const field of ["change_date", "insurance_add_date", "insurance_remove_date"]) {
      const value = cleanOptional(record[field]);
      query = value ? query.eq(field, value) : query.is(field, null);
    }

    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find insurance change failed (${record.employee_name} / ${record.status}): ${error.message}`);
    return data ?? [];
  }

  async applyPersonnelChangeSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.personnel_change", action: "write" });
    if (confirm !== "导入人事异动") {
      throw new Error("applyPersonnelChangeSeeds requires confirm: 导入人事异动");
    }
    plan = await this.preparePersonnelChangePlan(plan);

    const results = [];
    for (const record of plan?.records ?? []) {
      const employee = personnelChangeEmployee(record);
      if (!employee?.id) {
        results.push({ name: record.employee_name, action: "skipped", reason: "employee not matched" });
        continue;
      }

      const existing = await this.findExistingPersonnelChange(record);
      if (existing.length > 1) {
        results.push({ name: record.employee_name, action: "skipped", reason: "multiple existing changes matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ name: record.employee_name, action: "existing", reason: "personnel change already exists", change_reason: record.change_reason });
        continue;
      }

      const payload = personnelChangePayload(record, employee.id);
      const { data, error } = await this.db
        .from("personnel_changes")
        .insert(payload)
        .select(personnelChangeSelect())
        .single();
      if (error) throw new Error(`create personnel change failed (${record.employee_name} / ${record.change_reason}): ${error.message}`);
      results.push({
        name: data.employees?.name ?? record.employee_name,
        action: "created",
        change_reason: data.change_reason,
        effective_date: data.effective_date
      });
    }

    return {
      write: results,
      verification: await this.verifyPersonnelChangeSeeds({ plan })
    };
  }

  async verifyPersonnelChangeSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.personnel_change", action: "read" });
    plan = await this.preparePersonnelChangePlan(plan);
    const fields = [
      "current_department",
      "current_position",
      "probation_salary",
      "regular_salary",
      "new_department",
      "new_position",
      "change_reason",
      "salary_before",
      "salary_after",
      "effective_date",
      "procedures_complete",
      "hr_clerk",
      "notes"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingPersonnelChange(record);
      if (matches.length !== 1) {
        results.push({
          name: record.employee_name,
          change_reason: record.change_reason,
          ok: false,
          diffs: [{ field: "personnel_change", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("personnel_changes")
        .select(personnelChangeSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify personnel change failed (${record.employee_name} / ${record.change_reason}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "employee", personnelChangeEmployee(record)?.name, data.employees?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        name: record.employee_name,
        change_reason: record.change_reason,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async previewPersonnelChangeSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.personnel_change", action: "write" });
    plan = await this.preparePersonnelChangePlan(plan);
    return {
      summary: previewSummary(plan.records, "employee_name"),
      records: plan.records
    };
  }

  async preparePersonnelChangePlan(plan) {
    plan = normalizeRecordsPlan(plan, normalizePersonnelChangeSeedRecord);
    const records = [];
    for (const record of plan.records) {
      const prepared = { ...record };
      prepared.match = prepared.match ?? { employee: await this.matchEmployeeByNameAndCompany(prepared.employee_name, prepared.company) };
      records.push(prepared);
    }
    return { ...plan, records };
  }

  async findExistingPersonnelChange(record) {
    const employee = personnelChangeEmployee(record);
    if (!employee?.id) return [];

    let query = this.db
      .from("personnel_changes")
      .select(personnelChangeSelect())
      .eq("employee_id", employee.id)
      .eq("change_reason", normalizeRequired(record.change_reason, "personnel change reason"));

    for (const field of ["effective_date", "current_department", "current_position"]) {
      const value = cleanOptional(record[field]);
      query = value ? query.eq(field, value) : query.is(field, null);
    }

    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find personnel change failed (${record.employee_name} / ${record.change_reason}): ${error.message}`);
    return data ?? [];
  }

  async applyDisciplinaryRecordSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.disciplinary", action: "write" });
    if (confirm !== "导入奖惩记录") {
      throw new Error("applyDisciplinaryRecordSeeds requires confirm: 导入奖惩记录");
    }
    plan = await this.prepareDisciplinaryRecordPlan(plan);

    const results = [];
    for (const record of plan?.records ?? []) {
      const employee = disciplinaryRecordEmployee(record);
      if (!employee?.id) {
        results.push({ name: record.employee_name, action: "skipped", reason: "employee not matched" });
        continue;
      }

      const existing = await this.findExistingDisciplinaryRecord(record);
      if (existing.length > 1) {
        results.push({ name: record.employee_name, action: "skipped", reason: "multiple existing disciplinary records matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ name: record.employee_name, action: "existing", reason: "disciplinary record already exists", penalty_type: record.penalty_type });
        continue;
      }

      const payload = disciplinaryRecordPayload(record, employee.id);
      const { data, error } = await this.db
        .from("disciplinary_records")
        .insert(payload)
        .select(disciplinaryRecordSelect())
        .single();
      if (error) throw new Error(`create disciplinary record failed (${record.employee_name} / ${record.penalty_type}): ${error.message}`);
      results.push({
        name: data.employees?.name ?? record.employee_name,
        action: "created",
        penalty_type: data.penalty_type,
        incident_date: data.incident_date
      });
    }

    return {
      write: results,
      verification: await this.verifyDisciplinaryRecordSeeds({ plan })
    };
  }

  async verifyDisciplinaryRecordSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.disciplinary", action: "read" });
    plan = await this.prepareDisciplinaryRecordPlan(plan);
    const fields = [
      "incident_date",
      "penalty_type",
      "penalty_reason",
      "signed_upload",
      "hr_clerk"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingDisciplinaryRecord(record);
      if (matches.length !== 1) {
        results.push({
          name: record.employee_name,
          penalty_type: record.penalty_type,
          ok: false,
          diffs: [{ field: "disciplinary_record", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("disciplinary_records")
        .select(disciplinaryRecordSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify disciplinary record failed (${record.employee_name} / ${record.penalty_type}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "employee", disciplinaryRecordEmployee(record)?.name, data.employees?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        name: record.employee_name,
        penalty_type: record.penalty_type,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async previewDisciplinaryRecordSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.disciplinary", action: "write" });
    plan = await this.prepareDisciplinaryRecordPlan(plan);
    return {
      summary: previewSummary(plan.records, "employee_name"),
      records: plan.records
    };
  }

  async prepareDisciplinaryRecordPlan(plan) {
    plan = normalizeRecordsPlan(plan, normalizeDisciplinarySeedRecord);
    const records = [];
    for (const record of plan.records) {
      const prepared = { ...record };
      prepared.match = prepared.match ?? { employee: await this.matchEmployeeByNameAndCompany(prepared.employee_name, prepared.company) };
      records.push(prepared);
    }
    return { ...plan, records };
  }

  async findExistingDisciplinaryRecord(record) {
    const employee = disciplinaryRecordEmployee(record);
    if (!employee?.id) return [];

    let query = this.db
      .from("disciplinary_records")
      .select(disciplinaryRecordSelect())
      .eq("employee_id", employee.id)
      .eq("penalty_type", normalizeRequired(record.penalty_type, "penalty type"))
      .eq("penalty_reason", normalizeRequired(record.penalty_reason, "penalty reason"));

    const incidentDate = cleanOptional(record.incident_date);
    query = incidentDate ? query.eq("incident_date", incidentDate) : query.is("incident_date", null);

    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find disciplinary record failed (${record.employee_name} / ${record.penalty_type}): ${error.message}`);
    return data ?? [];
  }

  async applyDisciplinaryAttachments({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.disciplinary", action: "write" });
    if (confirm !== "回填奖惩附件") {
      throw new Error("applyDisciplinaryAttachments requires confirm: 回填奖惩附件");
    }

    const bucket = "hr-documents";
    await this.ensureStorageBucket(bucket);
    const results = [];

    for (const record of plan?.records ?? []) {
      const localFile = normalizeRequired(record.local_file, "local attachment file");
      const storagePath = normalizeRequired(record.storage_path, "storage path");
      const matches = await this.findExistingDisciplinaryRecord(record);
      if (matches.length !== 1) {
        results.push({ name: record.employee_name, action: "skipped", reason: `${matches.length} matching disciplinary records` });
        continue;
      }

      const bytes = fs.readFileSync(localFile);
      const upload = await this.db.client.storage
        .from(bucket)
        .upload(storagePath, bytes, {
          contentType: contentTypeForPath(localFile),
          upsert: true
        });
      if (upload.error) throw new Error(`upload disciplinary attachment failed (${record.employee_name}): ${upload.error.message}`);

      const publicUrl = this.db.client.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
      const signedUpload = [publicUrl];
      const { error } = await this.db
        .from("disciplinary_records")
        .update({ signed_upload: signedUpload })
        .eq("id", matches[0].id);
      if (error) throw new Error(`update disciplinary attachment failed (${record.employee_name}): ${error.message}`);

      results.push({
        name: record.employee_name,
        action: "uploaded",
        incident_date: record.incident_date,
        penalty_type: record.penalty_type,
        storage_path: storagePath,
        public_url: publicUrl
      });
    }

    return results;
  }

  async verifyDisciplinaryAttachments({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.disciplinary", action: "read" });
    const bucket = "hr-documents";
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingDisciplinaryRecord(record);
      if (matches.length !== 1) {
        results.push({
          name: record.employee_name,
          ok: false,
          diffs: [{ field: "disciplinary_record", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("disciplinary_records")
        .select(disciplinaryRecordSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify disciplinary attachment record failed (${record.employee_name}): ${error.message}`);

      const publicUrl = record.storage_path
        ? this.db.client.storage.from(bucket).getPublicUrl(record.storage_path).data.publicUrl
        : null;
      const expectedUpload = publicUrl ? [publicUrl] : [];
      const diffs = [];
      compareField(diffs, "signed_upload", expectedUpload, data.signed_upload);

      let storageOk = false;
      let storageError = null;
      if (record.storage_path) {
        const downloaded = await this.db.client.storage.from(bucket).download(record.storage_path);
        storageOk = !downloaded.error;
        storageError = downloaded.error?.message ?? null;
      }

      if (record.storage_path && !storageOk) {
        diffs.push({ field: "storage_object", expected: record.storage_path, actual: storageError ?? "missing" });
      }

      results.push({
        name: record.employee_name,
        incident_date: record.incident_date,
        penalty_type: record.penalty_type,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async ensureStorageBucket(bucket) {
    const { data, error } = await this.db.client.storage.getBucket(bucket);
    if (!error && data) {
      if (!data.public) {
        const updated = await this.db.client.storage.updateBucket(bucket, { public: true });
        if (updated.error) throw new Error(`update storage bucket failed (${bucket}): ${updated.error.message}`);
        return { action: "updated-public", bucket: updated.data ?? data };
      }
      return { action: "existing", bucket: data };
    }

    const created = await this.db.client.storage.createBucket(bucket, {
      public: true
    });
    if (created.error && !String(created.error.message).includes("already exists")) {
      throw new Error(`create storage bucket failed (${bucket}): ${created.error.message}`);
    }
    return { action: "created", bucket: created.data ?? null };
  }

  async applySealUsageSeeds({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.seal_usage", action: "write" });
    if (confirm !== "导入用章记录") {
      throw new Error("applySealUsageSeeds requires confirm: 导入用章记录");
    }
    plan = await this.prepareSealUsagePlan(plan);

    const results = [];
    for (const record of plan?.records ?? []) {
      const company = sealUsageCompany(record);
      if (!company?.id) {
        results.push({ reason: record.reason, action: "skipped", detail: "company not matched" });
        continue;
      }

      const existing = await this.findExistingSealUsage(record);
      if (existing.length > 1) {
        results.push({ reason: record.reason, action: "skipped", detail: "multiple existing seal usage records matched" });
        continue;
      }
      if (existing.length === 1) {
        results.push({ reason: record.reason, action: "existing", usage_date: record.usage_date });
        continue;
      }

      const payload = sealUsagePayload(record, company.id);
      const { data, error } = await this.db
        .from("seal_usage")
        .insert(payload)
        .select(sealUsageSelect())
        .single();
      if (error) throw new Error(`create seal usage failed (${record.reason}): ${error.message}`);
      results.push({
        reason: data.reason,
        action: "created",
        usage_date: data.usage_date,
        seal_applicant: data.seal_applicant?.name ?? null
      });
    }

    return {
      write: results,
      verification: await this.verifySealUsageSeeds({ plan })
    };
  }

  async verifySealUsageSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.seal_usage", action: "read" });
    plan = await this.prepareSealUsagePlan(plan);
    const fields = [
      "usage_date",
      "reason",
      "attachments",
      "notes"
    ];
    const results = [];

    for (const record of plan?.records ?? []) {
      const matches = await this.findExistingSealUsage(record);
      if (matches.length !== 1) {
        results.push({
          reason: record.reason,
          ok: false,
          diffs: [{ field: "seal_usage", expected: "unique match", actual: `${matches.length} matches` }]
        });
        continue;
      }

      const { data, error } = await this.db
        .from("seal_usage")
        .select(sealUsageSelect())
        .eq("id", matches[0].id)
        .single();
      if (error) throw new Error(`verify seal usage failed (${record.reason}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "company", record.company, data.companies?.name);
      compareField(diffs, "applicant", sealUsageApplicant(record)?.name, data.applicant?.name);
      compareField(diffs, "seal_applicant", sealUsageSealApplicant(record)?.name, data.seal_applicant?.name);
      for (const field of fields) {
        compareField(diffs, field, record[field], data[field]);
      }
      results.push({
        reason: record.reason,
        usage_date: record.usage_date,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async previewSealUsageSeeds({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.seal_usage", action: "write" });
    plan = await this.prepareSealUsagePlan(plan);
    return {
      summary: {
        records: plan.records.length,
        matched_companies: plan.records.filter((record) => record.match?.company?.company).length
      },
      records: plan.records
    };
  }

  async prepareSealUsagePlan(plan) {
    plan = normalizeRecordsPlan(plan, normalizeSealUsageSeedRecord);
    const records = [];
    for (const record of plan.records) {
      const prepared = { ...record };
      const companyMatches = await this.findCompanyByName(prepared.company);
      prepared.match = prepared.match ?? {};
      prepared.match.company = prepared.match.company ?? {
        status: companyMatches.length === 1 ? "matched" : companyMatches.length > 1 ? "ambiguous" : "unmatched",
        company: companyMatches.length === 1 ? companyMatches[0] : null
      };
      records.push(prepared);
    }
    return { ...plan, records };
  }

  async matchEmployeeByNameAndCompany(name, company) {
    const employeeName = cleanOptional(name);
    if (!employeeName) return null;
    const result = await this.findEmployeeCandidates({
      name: employeeName,
      companyName: company
    });
    const candidates = result.candidates ?? [];
    return candidates.length === 1 ? insuranceEmployee(candidates[0]) : null;
  }

  async findExistingSealUsage(record) {
    const company = sealUsageCompany(record);
    if (!company?.id) return [];

    let query = this.db
      .from("seal_usage")
      .select(sealUsageSelect())
      .eq("company_id", company.id)
      .eq("reason", normalizeRequired(record.reason, "seal usage reason"));

    const usageDate = cleanOptional(record.usage_date);
    query = usageDate ? query.eq("usage_date", usageDate) : query.is("usage_date", null);

    const applicant = sealUsageApplicant(record);
    query = applicant?.id ? query.eq("applicant_id", applicant.id) : query.is("applicant_id", null);

    const sealApplicant = sealUsageSealApplicant(record);
    query = sealApplicant?.id ? query.eq("seal_applicant_id", sealApplicant.id) : query.is("seal_applicant_id", null);

    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find seal usage failed (${record.reason}): ${error.message}`);
    return data ?? [];
  }

  async findExistingContract(record) {
    const employee = contractEmployee(record);
    if (!employee?.id) return [];

    let query = this.db
      .from("contracts")
      .select(contractSelect())
      .eq("employee_id", employee.id)
      .eq("type", normalizeRequired(record.type, "contract type"));

    const startDate = cleanOptional(record.start_date);
    const expiryDate = cleanOptional(record.expiry_date);
    const sequence = cleanOptional(record.sequence);

    query = startDate ? query.eq("start_date", startDate) : query.is("start_date", null);
    query = expiryDate ? query.eq("expiry_date", expiryDate) : query.is("expiry_date", null);
    query = sequence ? query.eq("sequence", Number(sequence)) : query.is("sequence", null);

    const { data, error } = await query.limit(5);
    if (error) throw new Error(`find contract failed (${record.employee_name} / ${record.type}): ${error.message}`);
    return data ?? [];
  }

  async employeeSummary({ companyName, companyNames } = {}) {
    let query = this.db
      .from("employees")
      .select("id,name,status,id_card_number,phone,companies(name),departments(name)")
      .order("name");

    const normalizedCompany = cleanOptional(companyName);
    const normalizedCompanies = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    if (normalizedCompany) {
      const companies = await this.findCompanyByName(normalizedCompany);
      if (companies.length !== 1) {
        return {
          total: 0,
          company: normalizedCompany,
          match_status: companies.length === 0 ? "company_not_found" : "company_ambiguous",
          byCompany: [],
          byDepartment: [],
          checks: {
            emptyDepartment: [],
            emptyIdCard: [],
            duplicateIdCards: [],
            duplicatePhones: []
          }
        };
      }
      query = query.eq("company_id", companies[0].id);
    } else if (normalizedCompanies.length) {
      const companyIds = [];
      const missingCompanies = [];
      for (const item of normalizedCompanies) {
        const companies = await this.findCompanyByName(item);
        if (companies.length === 1) {
          companyIds.push(companies[0].id);
        } else {
          missingCompanies.push({
            company: item,
            match_status: companies.length === 0 ? "company_not_found" : "company_ambiguous"
          });
        }
      }
      if (!companyIds.length) {
        return {
          total: 0,
          company: null,
          company_scope: normalizedCompanies,
          match_status: "no_company_matched",
          missing_companies: missingCompanies,
          byCompany: [],
          byDepartment: [],
          checks: {
            emptyDepartment: [],
            emptyIdCard: [],
            duplicateIdCards: [],
            duplicatePhones: []
          }
        };
      }
      query = query.in("company_id", companyIds);
    }

    const { data, error } = await query;
    if (error) throw new Error(`employee summary failed: ${error.message}`);

    const rows = data ?? [];
    const byCompany = new Map();
    const byDepartment = new Map();
    const byIdCard = new Map();
    const byPhone = new Map();
    const emptyDepartment = [];
    const emptyIdCard = [];

    for (const row of rows) {
      const company = row.companies?.name ?? "(未归属公司)";
      const department = row.departments?.name ?? null;
      const status = row.status ?? "(空状态)";

      const companyItem = ensureSummaryItem(byCompany, company);
      companyItem.total += 1;
      companyItem.statuses[status] = (companyItem.statuses[status] ?? 0) + 1;

      const departmentKey = `${company} / ${department ?? "(空部门)"}`;
      const departmentItem = ensureSummaryItem(byDepartment, departmentKey, {
        company,
        department: department ?? null
      });
      departmentItem.total += 1;
      departmentItem.statuses[status] = (departmentItem.statuses[status] ?? 0) + 1;

      const businessRow = {
        name: row.name,
        company,
        department,
        status,
        id_card_number: row.id_card_number ?? null,
        phone: row.phone ?? null
      };

      if (!cleanOptional(row.departments?.name)) emptyDepartment.push(businessRow);
      if (!cleanOptional(row.id_card_number)) emptyIdCard.push(businessRow);
      pushDuplicateCandidate(byIdCard, row.id_card_number, businessRow);
      pushDuplicateCandidate(byPhone, row.phone, businessRow);
    }

    return {
      total: rows.length,
      company: normalizedCompany ?? null,
      company_scope: normalizedCompanies.length ? normalizedCompanies : null,
      byCompany: [...byCompany.entries()].map(([company, item]) => ({
        company,
        total: item.total,
        statuses: sortObject(item.statuses)
      })),
      byDepartment: [...byDepartment.values()].map((item) => ({
        company: item.company,
        department: item.department,
        total: item.total,
        statuses: sortObject(item.statuses)
      })),
      checks: {
        emptyDepartment,
        emptyIdCard,
        duplicateIdCards: duplicateGroups(byIdCard),
        duplicatePhones: duplicateGroups(byPhone)
      }
    };
  }

  async listEmployees({ companyName, companyNames, status } = {}) {
    let query = this.db
      .from("employees")
      .select(employeeSelect())
      .order("name");

    const normalizedCompany = cleanOptional(companyName);
    const normalizedCompanies = Array.isArray(companyNames)
      ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
      : [];
    const companyIds = await this.scopedCompanyIds({ companyName: normalizedCompany, companyNames: normalizedCompanies });
    if (companyIds !== null) {
      if (!companyIds.length) {
        return {
          company: scopeLabel(normalizedCompany, normalizedCompanies),
          match_status: "company_not_found",
          records: []
        };
      }
      query = query.in("company_id", companyIds);
    }

    const normalizedStatus = cleanOptional(status);
    if (normalizedStatus) query = query.eq("status", normalizedStatus);

    const { data, error } = await query;
    if (error) throw new Error(`list employees failed: ${error.message}`);

    return {
      total: (data ?? []).length,
      company: scopeLabel(normalizedCompany, normalizedCompanies),
      status: normalizedStatus ?? null,
      records: (data ?? []).map(employeeBusinessRow)
    };
  }

  async employeesWithoutContracts() {
    const { data: employees, error: employeesError } = await this.db
      .from("employees")
      .select("id,name,status,phone,id_card_number,companies(name),departments(name)")
      .order("name");
    if (employeesError) throw new Error(`list employees failed: ${employeesError.message}`);

    const { data: contracts, error: contractsError } = await this.db
      .from("contracts")
      .select("employee_id");
    if (contractsError) throw new Error(`list contracts failed: ${contractsError.message}`);

    const employeeIdsWithContracts = new Set((contracts ?? []).map((row) => row.employee_id));
    const rows = (employees ?? [])
      .filter((row) => !employeeIdsWithContracts.has(row.id))
      .map((row) => ({
        name: row.name,
        company: row.companies?.name ?? null,
        department: row.departments?.name ?? null,
        status: row.status ?? null,
        phone: row.phone ?? null,
        id_card_number: row.id_card_number ?? null
      }));

    const byCompany = new Map();
    for (const row of rows) {
      const item = ensureSummaryItem(byCompany, row.company ?? "(未归属公司)");
      item.total += 1;
      item.statuses[row.status ?? "(空状态)"] = (item.statuses[row.status ?? "(空状态)"] ?? 0) + 1;
    }

    return {
      total: rows.length,
      byCompany: [...byCompany.entries()].map(([company, item]) => ({
        company,
        total: item.total,
        statuses: sortObject(item.statuses)
      })),
      rows
    };
  }

  async findExistingEmployee(record) {
    if (record?.allow_duplicate_identity === true) {
      const result = await this.findEmployeeCandidates({
        name: record.name,
        companyName: record.company,
        departmentName: record.department
      });
      return result.candidates ?? [];
    }
    if (cleanOptional(record.id_card_number)) {
      return this.findEmployeeByIdCard(record.id_card_number);
    }
    if (cleanOptional(record.phone)) {
      return this.findEmployeeByPhone(record.phone);
    }
    const result = await this.findEmployeeCandidates({
      name: record.name,
      companyName: record.company,
      departmentName: record.department
    });
    return result.candidates ?? [];
  }

  async applyEmployeeNicknameCleanup({ plan, confirm } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "write" });
    if (confirm !== "清理员工姓名花名") {
      throw new Error("applyEmployeeNicknameCleanup requires confirm: 清理员工姓名花名");
    }

    const results = [];
    for (const record of plan?.records ?? []) {
      const employeeId = normalizeRequired(record.id, "employee id");
      const newName = normalizeRequired(record.new_name, "new employee name");
      const newNotes = cleanOptional(record.new_notes);

      const { data: current, error: readError } = await this.db
        .from("employees")
        .select("id,name,notes,companies(name),departments(name)")
        .eq("id", employeeId)
        .single();
      if (readError) throw new Error(`read employee failed (${record.old_name}): ${readError.message}`);

      if (current.name === newName && normalizeComparable(current.notes) === normalizeComparable(newNotes)) {
        results.push({ name: newName, action: "unchanged" });
        continue;
      }

      const { data, error } = await this.db
        .from("employees")
        .update({ name: newName, notes: newNotes })
        .eq("id", employeeId)
        .select("id,name,notes,companies(name),departments(name)")
        .single();
      if (error) throw new Error(`update employee nickname failed (${record.old_name}): ${error.message}`);
      results.push({
        old_name: record.old_name,
        name: data.name,
        action: "updated",
        company: data.companies?.name ?? null,
        department: data.departments?.name ?? null
      });
    }

    return results;
  }

  async verifyEmployeeNicknameCleanup({ plan } = {}) {
    this.assertPlanCompanyScope({ plan, resource: "hr.employee", action: "read" });
    const results = [];
    for (const record of plan?.records ?? []) {
      const employeeId = normalizeRequired(record.id, "employee id");
      const { data, error } = await this.db
        .from("employees")
        .select("id,name,notes,companies(name),departments(name)")
        .eq("id", employeeId)
        .single();
      if (error) throw new Error(`verify employee nickname cleanup failed (${record.old_name}): ${error.message}`);

      const diffs = [];
      compareField(diffs, "name", record.new_name, data.name);
      compareField(diffs, "notes", record.new_notes, data.notes);
      results.push({
        old_name: record.old_name,
        name: record.new_name,
        ok: diffs.length === 0,
        diffs
      });
    }

    return {
      ok: results.every((result) => result.ok),
      results
    };
  }

  async clearBusinessData({ confirm } = {}) {
    if (confirm !== CLEAR_CONFIRMATION) {
      throw new Error(`clearBusinessData requires confirm: ${CLEAR_CONFIRMATION}`);
    }

    const results = [];
    for (const item of CLEAR_ORDER) {
      const before = await this.countTable(item.table);
      const { error } = await this.db.from(item.table).delete().neq("id", ZERO_UUID);
      if (error) throw new Error(`${item.label} clear failed: ${error.message}`);
      const after = await this.countTable(item.table);
      results.push({ ...item, before, after });
    }
    return results;
  }
}

export function employeeSelect() {
  return [
    "id",
    "name",
    "gender",
    "phone",
    "id_card_number",
    "position",
    "hire_date",
    "status",
    "companies(name,short_name)",
    "departments(name)"
  ].join(",");
}

export function employeeDetailSelect() {
  return [
    "id",
    "name",
    "gender",
    "birth_date",
    "phone",
    "id_card_number",
    "id_card_expiry",
    "position",
    "hire_date",
    "probation_end_date",
    "status",
    "education",
    "school",
    "graduation_date",
    "major",
    "current_address",
    "hukou_address",
    "bank_account",
    "bank_name",
    "resignation_date",
    "resignation_reason",
    "notes",
    "companies(name,short_name)",
    "departments(name)"
  ].join(",");
}

function normalizeRequired(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function cleanOptional(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeOrgPlan(plan, fallbackCompanyName = null) {
  if (Array.isArray(plan)) {
    const companyName = cleanOptional(fallbackCompanyName);
    return companyName ? { companies: [{ name: companyName, departments: plan }] } : { companies: [] };
  }
  if (!plan || typeof plan !== "object") return { companies: [] };

  if (Array.isArray(plan.companies)) {
    const companies = plan.companies.map((company) => ({
      ...company,
      departments: Array.isArray(company.departments) ? [...company.departments] : []
    }));
    for (const department of plan.departments ?? []) {
      const companyName = cleanOptional(department.company) || cleanOptional(department.companyName) || cleanOptional(department.company_name) || cleanOptional(fallbackCompanyName);
      if (!companyName) continue;
      let company = companies.find((item) => cleanOptional(item.name) === companyName);
      if (!company) {
        company = { name: companyName, departments: [] };
        companies.push(company);
      }
      company.departments.push(department);
    }
    return { ...plan, companies };
  }

  const companyName = cleanOptional(plan.company) || cleanOptional(plan.companyName) || cleanOptional(plan.company_name) || cleanOptional(fallbackCompanyName);
  if (!companyName) return { companies: [] };
  const departments = Array.isArray(plan.departments)
    ? plan.departments
    : plan.department && typeof plan.department === "object"
      ? [plan.department]
    : cleanOptional(plan.name)
      ? [{ name: plan.name, remark: plan.remark, notes: plan.notes }]
      : [];
  return { ...plan, companies: [{ name: companyName, departments }] };
}

function assertNonEmptyOrgPlan(plan) {
  const companyCount = Array.isArray(plan?.companies) ? plan.companies.length : 0;
  const departmentCount = (plan?.companies ?? []).reduce((count, company) => count + (company.departments?.length ?? 0), 0);
  if (companyCount === 0 && departmentCount === 0) {
    throw new Error("录入计划未包含公司或部门数据，请先根据用户自然语言生成包含 company/departments 的 JSON");
  }
}

function normalizeRecordsPlan(plan, normalizer = (record) => record) {
  const rawRecords = Array.isArray(plan)
    ? plan
    : Array.isArray(plan?.records)
      ? plan.records
      : plan && typeof plan === "object"
        ? [plan]
        : [];
  const records = rawRecords
    .filter((record) => record && typeof record === "object")
    .map((record) => normalizer(record));
  if (!records.length) {
    throw new Error("录入计划未包含 records 数据，请先根据用户自然语言生成 JSON 对象或 records 数组");
  }
  return {
    ...(plan && !Array.isArray(plan) && typeof plan === "object" ? plan : {}),
    records
  };
}

function normalizeEmployeeSeedRecord(record) {
  return stripUndefined({
    ...record,
    id_card_number: cleanOptional(record.id_card_number) ?? cleanOptional(record.id_card),
    notes: cleanOptional(record.notes) ?? cleanOptional(record.remark)
  });
}

function normalizeContractSeedRecord(record) {
  const contractType = cleanOptional(record.type) ?? cleanOptional(record.contract_type);
  return stripUndefined({
    ...record,
    employee_name: cleanOptional(record.employee_name) ?? cleanOptional(record.name),
    type: contractType,
    start_date: cleanOptional(record.start_date) ?? cleanOptional(record.contract_start),
    expiry_date: cleanOptional(record.expiry_date) ?? cleanOptional(record.contract_end) ?? cleanOptional(record.end_date),
    is_permanent: record.is_permanent ?? (contractType?.includes("无固定期限") ? true : false),
    notes: cleanOptional(record.notes) ?? cleanOptional(record.remark)
  });
}

function normalizePerformanceReviewSeedRecord(record) {
  return stripUndefined({
    ...record,
    employee_name: cleanOptional(record.employee_name) ?? cleanOptional(record.name),
    review_date: cleanOptional(record.review_date) ?? cleanOptional(record.month),
    final_score: cleanOptional(record.final_score) ?? cleanOptional(record.score),
    notes: cleanOptional(record.notes) ?? cleanOptional(record.comment) ?? cleanOptional(record.remark)
  });
}

function normalizeInsuranceChangeSeedRecord(record) {
  return stripUndefined({
    ...record,
    employee_name: cleanOptional(record.employee_name) ?? cleanOptional(record.name),
    notes: cleanOptional(record.notes) ?? cleanOptional(record.remark)
  });
}

function normalizePersonnelChangeSeedRecord(record) {
  return stripUndefined({
    ...record,
    employee_name: cleanOptional(record.employee_name) ?? cleanOptional(record.name),
    notes: cleanOptional(record.notes) ?? cleanOptional(record.remark)
  });
}

function normalizeDisciplinarySeedRecord(record) {
  return stripUndefined({
    ...record,
    employee_name: cleanOptional(record.employee_name) ?? cleanOptional(record.name),
    notes: cleanOptional(record.notes) ?? cleanOptional(record.remark)
  });
}

function normalizeSealUsageSeedRecord(record) {
  return stripUndefined({
    ...record,
    notes: cleanOptional(record.notes) ?? cleanOptional(record.remark)
  });
}

function previewSummary(records, nameField = "name") {
  return {
    records: records.length,
    matched: records.filter((record) => record.match?.employee).length,
    unmatched: records.filter((record) => !record.match?.employee).length,
    by_company: countBy(records, "company"),
    by_name: countBy(records, nameField)
  };
}

function employeePayload(record, companyId, departmentId) {
  return stripUndefined({
    company_id: companyId,
    department_id: departmentId,
    name: normalizeRequired(record.name, "employee name"),
    gender: cleanOptional(record.gender),
    birth_date: cleanOptional(record.birth_date),
    position: cleanOptional(record.position),
    hire_date: cleanOptional(record.hire_date),
    probation_end_date: cleanOptional(record.probation_end_date),
    status: cleanOptional(record.status) ?? "正式",
    id_card_number: cleanOptional(record.id_card_number),
    id_card_expiry: cleanOptional(record.id_card_expiry),
    phone: cleanOptional(record.phone),
    education: cleanOptional(record.education),
    school: cleanOptional(record.school),
    graduation_date: cleanOptional(record.graduation_date),
    major: cleanOptional(record.major),
    current_address: cleanOptional(record.current_address),
    hukou_address: cleanOptional(record.hukou_address),
    bank_account: cleanOptional(record.bank_account),
    bank_name: cleanOptional(record.bank_name),
    resignation_date: cleanOptional(record.resignation_date),
    resignation_reason: cleanOptional(record.resignation_reason),
    notes: cleanOptional(record.notes)
  });
}

function employeeMatchesExpected(row, record) {
  const checks = [
    ["name", row.name, record.name],
    ["company", row.companies?.name, record.company],
    ["department", row.departments?.name, record.department],
    ["phone", row.phone, record.phone],
    ["id_card_number", row.id_card_number, record.id_card_number]
  ];
  return checks.every(([, actual, expected]) => {
    const normalizedExpected = cleanOptional(expected);
    if (!normalizedExpected) return true;
    return normalizeComparable(actual) === normalizedExpected;
  });
}

function employeeBusinessRow(row) {
  return {
    name: row.name,
    company: row.companies?.name ?? null,
    department: row.departments?.name ?? null,
    status: row.status ?? null,
    position: row.position ?? null,
    hire_date: row.hire_date ?? null,
    phone: row.phone ?? null,
    id_card_number: row.id_card_number ?? null
  };
}

function employeeDetailBusinessRow(row) {
  return {
    ...employeeBusinessRow(row),
    gender: row.gender ?? null,
    birth_date: row.birth_date ?? null,
    id_card_expiry: row.id_card_expiry ?? null,
    probation_end_date: row.probation_end_date ?? null,
    education: row.education ?? null,
    school: row.school ?? null,
    graduation_date: row.graduation_date ?? null,
    major: row.major ?? null,
    current_address: row.current_address ?? null,
    hukou_address: row.hukou_address ?? null,
    bank_account: row.bank_account ?? null,
    bank_name: row.bank_name ?? null,
    resignation_date: row.resignation_date ?? null,
    resignation_reason: row.resignation_reason ?? null,
    notes: row.notes ?? null
  };
}

function contractBusinessRow(row) {
  return {
    employee: row.employees?.name ?? null,
    type: row.type ?? null,
    sequence: row.sequence ?? null,
    sign_date: row.sign_date ?? null,
    duration_years: row.duration_years ?? null,
    start_date: row.start_date ?? null,
    expiry_date: row.expiry_date ?? null,
    is_permanent: row.is_permanent ?? null,
    scan_file_url: row.scan_file_url ?? null,
    notes: row.notes ?? null
  };
}

function performanceBusinessRow(row) {
  return {
    employee: row.employees?.name ?? null,
    company: row.employees?.companies?.name ?? null,
    review_date: row.review_date ?? null,
    self_score: row.self_score ?? null,
    supervisor_score: row.supervisor_score ?? null,
    final_score: row.final_score ?? null,
    performance_ratio: row.performance_ratio ?? null,
    performance_salary: row.performance_salary ?? null,
    actual_performance_salary: row.actual_performance_salary ?? null,
    performance_adjustment: row.performance_adjustment ?? null,
    notes: row.notes ?? null
  };
}

function insuranceChangeBusinessRow(row) {
  return {
    employee: row.employees?.name ?? null,
    company: row.employees?.companies?.name ?? null,
    change_date: row.change_date ?? null,
    hire_date: row.hire_date ?? null,
    probation_end_date: row.probation_end_date ?? null,
    resignation_date: row.resignation_date ?? null,
    insurance_add_date: row.insurance_add_date ?? null,
    insurance_remove_date: row.insurance_remove_date ?? null,
    status: row.status ?? null,
    signed_upload: row.signed_upload ?? null,
    hr_clerk: row.hr_clerk ?? null,
    notes: row.notes ?? null
  };
}

function personnelChangeBusinessRow(row) {
  return {
    employee: row.employees?.name ?? null,
    company: row.employees?.companies?.name ?? null,
    current_department: row.current_department ?? null,
    current_position: row.current_position ?? null,
    probation_salary: row.probation_salary ?? null,
    regular_salary: row.regular_salary ?? null,
    new_department: row.new_department ?? null,
    new_position: row.new_position ?? null,
    change_reason: row.change_reason ?? null,
    salary_before: row.salary_before ?? null,
    salary_after: row.salary_after ?? null,
    effective_date: row.effective_date ?? null,
    procedures_complete: row.procedures_complete ?? null,
    signed_upload: row.signed_upload ?? null,
    hr_clerk: row.hr_clerk ?? null,
    notes: row.notes ?? null
  };
}

function disciplinaryRecordBusinessRow(row) {
  return {
    employee: row.employees?.name ?? null,
    company: row.employees?.companies?.name ?? null,
    incident_date: row.incident_date ?? null,
    penalty_type: row.penalty_type ?? null,
    penalty_reason: row.penalty_reason ?? null,
    signed_upload: row.signed_upload ?? null,
    hr_clerk: row.hr_clerk ?? null
  };
}

function sealUsageBusinessRow(row) {
  return {
    company: row.companies?.name ?? null,
    usage_date: row.usage_date ?? null,
    applicant: row.applicant?.name ?? null,
    seal_applicant: row.seal_applicant?.name ?? null,
    reason: row.reason ?? null,
    attachments: row.attachments ?? null,
    notes: row.notes ?? null
  };
}

function pendingReviewBusinessRow(row) {
  const previewReason = (row.preview_issues ?? []).join("；");
  return {
    company: row.company ?? null,
    department: row.department ?? row.current_department ?? null,
    name: row.name ?? row.employee_name ?? null,
    date: row.review_date ?? row.change_date ?? row.effective_date ?? row.incident_date ?? row.source_incident_date ?? null,
    type: row.status ?? row.change_reason ?? row.penalty_type ?? null,
    reason: row.reason ?? (previewReason || "需人事确认"),
    source_file: row.source_file ?? null,
    source_sheet: row.source_sheet ?? null,
    source_row: row.source_row ?? null
  };
}

function monthToReviewDate(value) {
  const normalized = normalizeRequired(value, "month");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d{4}-\d{2}$/.test(normalized)) return `${normalized}-01`;
  const match = normalized.match(/^(\d{4})[年./-]?(\d{1,2})月?$/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-01`;
  throw new Error(`month expected as YYYY-MM: ${value}`);
}

function monthRange(value) {
  const from = monthToReviewDate(value);
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { from, to: date.toISOString().slice(0, 10) };
}

function yearRange(value) {
  const label = String(value ?? new Date().getUTCFullYear()).trim();
  if (!/^\d{4}$/.test(label)) throw new Error(`year expected as YYYY: ${value}`);
  return { label, from: `${label}-01-01`, to: `${label}-12-31` };
}

export function contractSelect() {
  return [
    "id",
    "type",
    "sequence",
    "sign_date",
    "duration_years",
    "start_date",
    "expiry_date",
    "is_permanent",
    "scan_file_url",
    "notes",
    "employees(id,name,phone,id_card_number,companies(name))"
  ].join(",");
}

function contractPayload(record, employeeId) {
  return stripUndefined({
    employee_id: employeeId,
    type: normalizeRequired(record.type, "contract type"),
    sequence: cleanInteger(record.sequence),
    sign_date: cleanOptional(record.sign_date),
    duration_years: cleanInteger(record.duration_years),
    start_date: cleanOptional(record.start_date),
    expiry_date: cleanOptional(record.expiry_date),
    is_permanent: Boolean(record.is_permanent),
    notes: cleanOptional(record.notes)
  });
}

function contractEmployee(record) {
  return record?.match?.employee ?? null;
}

export function performanceReviewSelect() {
  return [
    "id",
    "review_date",
    "self_score",
    "supervisor_score",
    "final_score",
    "performance_ratio",
    "performance_salary",
    "actual_performance_salary",
    "performance_adjustment",
    "notes",
    "employees(id,name,phone,id_card_number,companies(name))"
  ].join(",");
}

function performanceReviewPayload(record, employeeId) {
  return stripUndefined({
    employee_id: employeeId,
    review_date: cleanOptional(record.review_date),
    self_score: cleanNumeric(record.self_score),
    supervisor_score: cleanNumeric(record.supervisor_score),
    final_score: cleanNumeric(record.final_score),
    performance_ratio: cleanNumeric(record.performance_ratio),
    performance_salary: cleanNumeric(record.performance_salary),
    actual_performance_salary: cleanNumeric(record.actual_performance_salary),
    performance_adjustment: cleanNumeric(record.performance_adjustment),
    notes: cleanOptional(record.notes)
  });
}

function performanceReviewEmployee(record) {
  return record?.match?.employee ?? null;
}

function performanceReviewName(record) {
  return cleanOptional(record.employee_name) ?? cleanOptional(record.name);
}

export function insuranceChangeSelect() {
  return [
    "id",
    "change_date",
    "hire_date",
    "probation_end_date",
    "resignation_date",
    "insurance_add_date",
    "insurance_remove_date",
    "status",
    "signed_upload",
    "hr_clerk",
    "notes",
    "employees(id,name,phone,id_card_number,companies(name))"
  ].join(",");
}

function insuranceChangePayload(record, employeeId) {
  return stripUndefined({
    employee_id: employeeId,
    change_date: cleanOptional(record.change_date),
    hire_date: cleanOptional(record.hire_date),
    probation_end_date: cleanOptional(record.probation_end_date),
    resignation_date: cleanOptional(record.resignation_date),
    insurance_add_date: cleanOptional(record.insurance_add_date),
    insurance_remove_date: cleanOptional(record.insurance_remove_date),
    status: cleanOptional(record.status),
    hr_clerk: cleanOptional(record.hr_clerk),
    notes: cleanOptional(record.notes)
  });
}

function insuranceChangeEmployee(record) {
  return record?.match?.employee ?? null;
}

export function personnelChangeSelect() {
  return [
    "id",
    "current_department",
    "current_position",
    "probation_salary",
    "regular_salary",
    "new_department",
    "new_position",
    "change_reason",
    "salary_before",
    "salary_after",
    "effective_date",
    "procedures_complete",
    "signed_upload",
    "hr_clerk",
    "notes",
    "employees(id,name,phone,id_card_number,companies(name))"
  ].join(",");
}

function personnelChangePayload(record, employeeId) {
  return stripUndefined({
    employee_id: employeeId,
    current_department: cleanOptional(record.current_department),
    current_position: cleanOptional(record.current_position),
    probation_salary: cleanNumeric(record.probation_salary),
    regular_salary: cleanNumeric(record.regular_salary),
    new_department: cleanOptional(record.new_department),
    new_position: cleanOptional(record.new_position),
    change_reason: cleanOptional(record.change_reason),
    salary_before: cleanNumeric(record.salary_before),
    salary_after: cleanNumeric(record.salary_after),
    effective_date: cleanOptional(record.effective_date),
    procedures_complete: cleanBoolean(record.procedures_complete),
    hr_clerk: cleanOptional(record.hr_clerk),
    notes: cleanOptional(record.notes)
  });
}

function personnelChangeEmployee(record) {
  return record?.match?.employee ?? null;
}

export function disciplinaryRecordSelect() {
  return [
    "id",
    "incident_date",
    "penalty_type",
    "penalty_reason",
    "signed_upload",
    "hr_clerk",
    "employees(id,name,phone,id_card_number,companies(name))"
  ].join(",");
}

function disciplinaryRecordPayload(record, employeeId) {
  return stripUndefined({
    employee_id: employeeId,
    incident_date: cleanOptional(record.incident_date),
    penalty_type: normalizeRequired(record.penalty_type, "penalty type"),
    penalty_reason: normalizeRequired(record.penalty_reason, "penalty reason"),
    signed_upload: cleanTextArray(record.signed_upload),
    hr_clerk: cleanOptional(record.hr_clerk)
  });
}

function disciplinaryRecordEmployee(record) {
  return record?.match?.employee ?? null;
}

export function sealUsageSelect() {
  return [
    "id",
    "usage_date",
    "reason",
    "attachments",
    "notes",
    "companies(id,name)",
    "applicant:employees!seal_usage_applicant_id_fkey(id,name,phone,id_card_number,companies(name))",
    "seal_applicant:employees!seal_usage_seal_applicant_id_fkey(id,name,phone,id_card_number,companies(name))"
  ].join(",");
}

function sealUsagePayload(record, companyId) {
  return stripUndefined({
    company_id: companyId,
    usage_date: cleanOptional(record.usage_date),
    applicant_id: sealUsageApplicant(record)?.id ?? null,
    seal_applicant_id: sealUsageSealApplicant(record)?.id ?? null,
    reason: normalizeRequired(record.reason, "seal usage reason"),
    attachments: cleanTextArray(record.attachments),
    notes: cleanOptional(record.notes)
  });
}

function sealUsageCompany(record) {
  return record?.match?.company?.company ?? null;
}

function sealUsageApplicant(record) {
  return record?.match?.applicant?.employee ?? null;
}

function sealUsageSealApplicant(record) {
  return record?.match?.seal_applicant?.employee ?? null;
}

function cleanInteger(value) {
  const normalized = cleanOptional(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  if (!Number.isInteger(number)) throw new Error(`integer expected: ${value}`);
  return number;
}

function cleanTextArray(value) {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => cleanOptional(item)).filter(Boolean);
  return items.length ? items : null;
}

function contentTypeForPath(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function cleanNumeric(value) {
  const normalized = cleanOptional(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  if (Number.isNaN(number)) throw new Error(`numeric expected: ${value}`);
  return number;
}

function cleanBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim();
  if (["true", "是", "已完成", "完成", "1"].includes(normalized)) return true;
  if (["false", "否", "未完成", "0"].includes(normalized)) return false;
  throw new Error(`boolean expected: ${value}`);
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function compareField(diffs, field, expected, actual) {
  const normalizedExpected = normalizeComparable(expected);
  const normalizedActual = normalizeComparable(actual);
  if (normalizedExpected !== normalizedActual) {
    diffs.push({ field, expected: normalizedExpected, actual: normalizedActual });
  }
}

function normalizeComparable(value) {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : null;
  return String(value).trim();
}

function ensureSummaryItem(map, key, extra = {}) {
  if (!map.has(key)) map.set(key, { ...extra, total: 0, statuses: {} });
  return map.get(key);
}

function pushDuplicateCandidate(map, value, row) {
  const key = cleanOptional(value);
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(row);
}

function duplicateGroups(map) {
  return [...map.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([value, rows]) => ({ value, rows }));
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = cleanOptional(row[field]) ?? "(空)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortObject(counts);
}

function sumNumeric(rows, field) {
  return Number(rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0).toFixed(2));
}

function average(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
}

function scopeLabel(companyName, companyNames) {
  const normalizedCompany = cleanOptional(companyName);
  if (normalizedCompany) return normalizedCompany;
  const normalizedCompanies = Array.isArray(companyNames)
    ? companyNames.map((item) => cleanOptional(item)).filter(Boolean)
    : [];
  return normalizedCompanies.length ? normalizedCompanies : null;
}

function summarizePerformanceBy(records, field) {
  const groups = new Map();
  for (const record of records) {
    const key = cleanOptional(record[field]) ?? "(空)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({
      [field]: key,
      count: rows.length,
      average_final_score: average(rows.map((row) => Number(row.final_score)).filter((value) => Number.isFinite(value))),
      low_score_count_below_60: rows.filter((row) => Number(row.final_score) < 60).length,
      performance_salary_total: sumNumeric(rows, "performance_salary"),
      actual_performance_salary_total: sumNumeric(rows, "actual_performance_salary"),
      performance_adjustment_total: sumNumeric(rows, "performance_adjustment")
    }))
    .sort((a, b) => String(a[field]).localeCompare(String(b[field]), "zh-Hans-CN"));
}

function hrRiskRecommendedActions({ headcount, contractCoverage, contractExpiry, disciplinary, pendingReviews }) {
  const actions = [];
  if (headcount.quality_flags.empty_department_count > 0) {
    actions.push(`核对 ${headcount.quality_flags.empty_department_count} 名空部门员工`);
  }
  if (contractCoverage.active_without_contracts > 0) {
    actions.push(`补齐 ${contractCoverage.active_without_contracts} 名在职员工合同`);
  }
  if (contractExpiry.count > 0) {
    actions.push(`跟进未来 90 天内到期的 ${contractExpiry.count} 条合同`);
  }
  if (disciplinary.missing_signed_upload_count > 0) {
    actions.push(`补齐 ${disciplinary.missing_signed_upload_count} 条奖惩记录签字附件`);
  }
  const pendingTotal = pendingReviews.reduce((sum, item) => sum + item.count, 0);
  if (pendingTotal > 0) {
    actions.push(`处理 ${pendingTotal} 条待人事确认记录`);
  }
  return actions;
}

function insuranceEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.companies?.name ?? null,
    department: row.departments?.name ?? null,
    status: row.status ?? null,
    phone: row.phone ?? null,
    id_card_number: row.id_card_number ?? null
  };
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

function repositoryAllowedCompanyNames(resource, action) {
  try {
    return allowedCompanyNames(undefined, resource, action);
  } catch (error) {
    if (String(error?.message ?? "").includes("缺少 WebUI 权限文件")) return null;
    throw error;
  }
}

function collectScopeCompanyNames(value, fallbackCompanyName = null, parentKey = "") {
  const results = [];
  const fallback = cleanOptional(fallbackCompanyName);
  if (fallback) results.push(fallback);
  collectScopeCompanyNamesInto(value, parentKey, results);
  return Array.from(new Set(results));
}

function collectScopeCompanyNamesInto(value, parentKey, results) {
  if (Array.isArray(value)) {
    for (const item of value) collectScopeCompanyNamesInto(item, parentKey, results);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (parentKey === "companies" && cleanOptional(value.name)) {
    results.push(cleanOptional(value.name));
  }
  for (const [key, child] of Object.entries(value)) {
    if (["company", "companyName", "company_name", "company_full_name"].includes(key) && cleanOptional(child)) {
      results.push(cleanOptional(child));
      continue;
    }
    collectScopeCompanyNamesInto(child, key, results);
  }
}
