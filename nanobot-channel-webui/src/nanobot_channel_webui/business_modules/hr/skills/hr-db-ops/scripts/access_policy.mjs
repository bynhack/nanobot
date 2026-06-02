import fs from "node:fs";

const COMPANY_KEYS = new Set(["company", "companyName", "company_name", "company_full_name"]);
const HR_SCOPE_RESOURCES = [
  "hr.company",
  "hr.organization",
  "hr.department",
  "hr.employee",
  "hr.contract",
  "hr.performance",
  "hr.insurance",
  "hr.personnel_change",
  "hr.disciplinary",
  "hr.seal_usage"
];
const HR_COMMAND_RULES = new Map([
  ["list-companies", { resource: "hr.company", action: "read" }],
  ["find-company", { resource: "hr.company", action: "read", optionKey: "name" }],
  ["list-departments", { resource: "hr.department", action: "query" }],
  ["find-department", { resource: "hr.department", action: "read" }],
  ["find-employee", { resource: "hr.employee", action: "query" }],
  ["find-employee-like", { resource: "hr.employee", action: "query" }],
  ["list-employees", { resource: "hr.employee", action: "query" }],
  ["employee-detail", { resource: "hr.employee", action: "read" }],
  ["employee-timeline", { resource: "hr.employee", action: "read" }],
  ["contracts-by-employee", { resource: "hr.contract", action: "read" }],
  ["performance-by-employee", { resource: "hr.performance", action: "read" }],
  ["performance-by-month", { resource: "hr.performance", action: "query" }],
  ["insurance-by-employee", { resource: "hr.insurance", action: "read" }],
  ["insurance-by-month", { resource: "hr.insurance", action: "query" }],
  ["personnel-changes-by-employee", { resource: "hr.personnel_change", action: "read" }],
  ["personnel-changes-list", { resource: "hr.personnel_change", action: "query" }],
  ["disciplinary-by-employee", { resource: "hr.disciplinary", action: "read" }],
  ["seal-usage-list", { resource: "hr.seal_usage", action: "query" }],
  ["analyze-headcount", { resource: "hr.employee", action: "analyze" }],
  ["analyze-contract-coverage", { resource: "hr.contract", action: "analyze" }],
  ["analyze-contract-expiry", { resource: "hr.contract", action: "analyze" }],
  ["analyze-performance-month", { resource: "hr.performance", action: "analyze" }],
  ["analyze-low-performance", { resource: "hr.performance", action: "analyze" }],
  ["analyze-insurance-month", { resource: "hr.insurance", action: "analyze" }],
  ["analyze-disciplinary", { resource: "hr.disciplinary", action: "analyze" }],
  ["employee-summary", { resource: "hr.employee", action: "analyze" }],
  ["preview-org-seeds", { resource: "hr.organization", action: "write" }],
  ["apply-org-seeds", { resource: "hr.organization", action: "write" }],
  ["verify-org-seeds", { resource: "hr.organization", action: "read" }],
  ["delete-empty-departments", { resource: "hr.department", action: "write" }],
  ["preview-employees", { resource: "hr.employee", action: "write" }],
  ["apply-employees", { resource: "hr.employee", action: "write" }],
  ["verify-employees", { resource: "hr.employee", action: "read" }],
  ["verify-employee-deletions", { resource: "hr.employee", action: "read" }],
  ["preview-contracts", { resource: "hr.contract", action: "write" }],
  ["apply-contracts", { resource: "hr.contract", action: "write" }],
  ["verify-contracts", { resource: "hr.contract", action: "read" }],
  ["preview-performance-reviews", { resource: "hr.performance", action: "write" }],
  ["apply-performance-reviews", { resource: "hr.performance", action: "write" }],
  ["verify-performance-reviews", { resource: "hr.performance", action: "read" }],
  ["preview-insurance-changes", { resource: "hr.insurance", action: "write" }],
  ["apply-insurance-changes", { resource: "hr.insurance", action: "write" }],
  ["verify-insurance-changes", { resource: "hr.insurance", action: "read" }],
  ["preview-personnel-changes", { resource: "hr.personnel_change", action: "write" }],
  ["apply-personnel-changes", { resource: "hr.personnel_change", action: "write" }],
  ["verify-personnel-changes", { resource: "hr.personnel_change", action: "read" }],
  ["apply-employee-nickname-cleanup", { resource: "hr.employee", action: "write" }],
  ["verify-employee-nickname-cleanup", { resource: "hr.employee", action: "read" }],
  ["preview-disciplinary-records", { resource: "hr.disciplinary", action: "write" }],
  ["apply-disciplinary-records", { resource: "hr.disciplinary", action: "write" }],
  ["verify-disciplinary-records", { resource: "hr.disciplinary", action: "read" }],
  ["apply-disciplinary-attachments", { resource: "hr.disciplinary", action: "write" }],
  ["verify-disciplinary-attachments", { resource: "hr.disciplinary", action: "read" }],
  ["preview-seal-usage", { resource: "hr.seal_usage", action: "write" }],
  ["apply-seal-usage", { resource: "hr.seal_usage", action: "write" }],
  ["verify-seal-usage", { resource: "hr.seal_usage", action: "read" }]
]);
const SCOPED_GLOBAL_DENY_COMMANDS = new Set([
  "count-all",
  "pending-review-list",
  "data-quality-check",
  "analyze-hr-risk-dashboard",
  "employees-without-contracts"
]);
const SCOPED_MULTI_COMPANY_COMMANDS = new Set([
  "find-employee",
  "find-employee-like",
  "list-departments",
  "list-employees",
  "employee-detail",
  "employee-timeline",
  "contracts-by-employee",
  "performance-by-employee",
  "insurance-by-employee",
  "performance-by-month",
  "insurance-by-month",
  "personnel-changes-by-employee",
  "personnel-changes-list",
  "disciplinary-by-employee",
  "seal-usage-list",
  "analyze-headcount",
  "analyze-contract-coverage",
  "analyze-contract-expiry",
  "analyze-performance-month",
  "analyze-low-performance",
  "analyze-insurance-month",
  "analyze-disciplinary",
  "employee-summary",
]);

export function loadAccessPolicy() {
  const file = process.env.NANOBOT_WEBUI_POLICY_FILE;
  if (!file) {
    return {
      unrestricted: false,
      missingPolicyFile: true,
      userId: "",
      email: "",
      role: "",
      businessRole: "",
      companyScope: [],
      resources: []
    };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const subject = payload.subject && typeof payload.subject === "object" ? payload.subject : payload;
    const resources = Array.isArray(payload.resources) ? payload.resources : [];
    const scope = scopeValuesForResources(resources, HR_SCOPE_RESOURCES, "company") ?? [];
    return {
      version: String(payload.version ?? ""),
      unrestricted: subject.role === "admin" || subject.business_role === "admin" || scope.includes("*"),
      userId: String(subject.user_id ?? ""),
      email: String(subject.email ?? ""),
      role: String(subject.role ?? ""),
      businessRole: String(subject.business_role ?? ""),
      companyScope: scope,
      resources
    };
  } catch (error) {
    throw new Error(`读取 WebUI 权限文件失败: ${error.message}`);
  }
}

export function authorizeHrCommand({ command, options = {}, plan = null, policy = loadAccessPolicy() } = {}) {
  if (!policy || policy.unrestricted) return;
  if (command === "help" || command === "--help" || command === "-h" || command === undefined) return;
  if (policy.missingPolicyFile) {
    throw new Error("当前账号缺少 WebUI 权限文件，拒绝执行 HR 业务命令");
  }

  if (!policy.companyScope?.length) {
    throw new Error("当前账号未配置可访问公司范围，请联系管理员配置 HR 数据权限");
  }

  if (command === "clear-business-data" || command === "delete-employee-records") {
    throw new Error("当前账号无权执行危险 HR 命令");
  }

  if (SCOPED_GLOBAL_DENY_COMMANDS.has(command)) {
    throw new Error(`当前账号无权执行全局 HR 命令: ${command}`);
  }

  const rule = HR_COMMAND_RULES.get(command) ?? { resource: "hr.employee", action: "query" };
  assertTenantResourceAllowed(policy, rule.resource, rule.action);

  const company = clean(options.company) || clean(options[rule.optionKey]);
  if (company) {
    assertTenantScopeAllowed(policy, rule.resource, rule.action, "company", company);
    return;
  }

  if (SCOPED_MULTI_COMPANY_COMMANDS.has(command)) {
    return;
  }

  const companiesFromPlan = plan ? collectCompanies(plan) : [];
  if (companiesFromPlan.length) {
    for (const item of companiesFromPlan) {
      assertTenantScopeAllowed(policy, rule.resource, rule.action, "company", item);
    }
    return;
  }

  if (requiresCompanyScope(command)) {
    throw new Error(`当前账号执行 ${command} 时必须指定 --company，或提供包含公司字段的导入计划`);
  }
}

export function scopedCompanyList(policy = loadAccessPolicy()) {
  if (policy?.missingPolicyFile) {
    throw new Error("当前账号缺少 WebUI 权限文件，拒绝读取 HR 公司范围");
  }
  if (!policy || policy.unrestricted) return null;
  return (policy.companyScope ?? []).map((name) => ({ name, short_name: "", scoped: true }));
}

export function allowedCompanyNames(policy = loadAccessPolicy(), resource = "hr.employee", action = "query") {
  if (policy?.missingPolicyFile) {
    throw new Error("当前账号缺少 WebUI 权限文件，拒绝读取 HR 公司范围");
  }
  if (!policy || policy.unrestricted) return null;
  assertTenantResourceAllowed(policy, resource, action);
  return policy.companyScope ?? [];
}

function requiresCompanyScope(command) {
  return !new Set([
    "help",
    "--help",
    "-h"
  ]).has(command);
}

function assertTenantResourceAllowed(policy, resource, action) {
  if (policy.unrestricted) return;
  const permission = resourcePermission(policy, resource);
  if (!permission || !allowsAction(permission, action)) {
    throw new Error(`当前账号无权执行 HR 资源动作: ${resource}:${action}`);
  }
}

function assertTenantScopeAllowed(policy, resource, action, scopeKey, scopeValue) {
  assertTenantResourceAllowed(policy, resource, action);
  if (policy.unrestricted || policy.companyScope.includes("*")) return;
  const permission = resourcePermission(policy, resource);
  const values = scopeValuesForPermission(permission, scopeKey) ?? policy.companyScope ?? [];
  if (!values.includes(scopeValue)) {
    throw new Error(`当前账号无权访问公司数据: ${scopeValue}`);
  }
}

function resourcePermission(policy, resource) {
  return (policy.resources ?? []).find((item) => item?.resource === resource);
}

function allowsAction(permission, action) {
  const actions = Array.isArray(permission?.actions) ? permission.actions : [];
  return actions.includes("*") || actions.includes(action);
}

function scopeValues(resources, resource, key) {
  const permission = (resources ?? []).find((item) => item?.resource === resource);
  return scopeValuesForPermission(permission, key);
}

function scopeValuesForResources(resources, resourceNames, key) {
  const values = [];
  for (const resource of resourceNames) {
    const scoped = scopeValues(resources, resource, key);
    if (scoped?.length) values.push(...scoped);
  }
  return values.length ? unique(values) : null;
}

function scopeValuesForPermission(permission, key) {
  const scopes = Array.isArray(permission?.scopes) ? permission.scopes : [];
  const scope = scopes.find((item) => item?.key === key);
  if (!scope || !Array.isArray(scope.values)) return null;
  return scope.values.map((item) => String(item).trim()).filter(Boolean);
}

function collectCompanies(value, parentKey = "") {
  const results = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      results.push(...collectCompanies(item, parentKey));
    }
    return unique(results);
  }
  if (!value || typeof value !== "object") return [];

  if (parentKey === "companies" && clean(value.name)) {
    results.push(clean(value.name));
  }

  for (const [key, child] of Object.entries(value)) {
    if (COMPANY_KEYS.has(key) && clean(child)) {
      results.push(clean(child));
      continue;
    }
    results.push(...collectCompanies(child, key));
  }
  return unique(results);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
