#!/usr/bin/env node
import fs from "node:fs";
import { authorizeHrCommand, loadAccessPolicy, scopedCompanyList } from "./access_policy.mjs";
import { HrRepository } from "./hr_repository.mjs";

const repo = new HrRepository();
const AUTO_SCOPED_COMPANY_COMMANDS = new Set([
  "list-departments",
  "find-department",
  "find-employee",
  "find-employee-like",
  "list-employees",
  "employee-detail",
  "employee-timeline",
  "contracts-by-employee",
  "performance-by-employee",
  "performance-by-month",
  "insurance-by-employee",
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
  "employee-summary"
]);

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  let { command, options } = parsed;
  if (command === "business") {
    if (options.help) {
      return printBusinessHelp(parsed.positionals);
    }
    ({ command, options } = normalizeBusinessCommand(parsed));
  }
  if (options.help) {
    return printCommandHelp(command);
  }
  const policy = loadAccessPolicy();
  applyScopedCompanyDefault({ command, options, policy });

  if (command === "list-companies") {
    const scoped = scopedCompanyList(policy);
    if (scoped) return print(scoped);
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return printHelp();
    case "count-all":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.countAllTables());
    case "clear-business-data":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.clearBusinessData({ confirm: options.confirm }));
    case "list-companies":
      return print(await repo.listCompanies());
    case "find-company":
      authorizeHrCommand({ command, options: { ...options, company: options.name }, policy });
      return print(await repo.findCompanyByName(options.name));
    case "list-departments":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.listDepartments({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "find-department":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.findDepartment({
        companyName: options.company,
        departmentName: options.department
      }));
    case "find-employee":
      authorizeHrCommand({ command, options, policy });
      return print(await findEmployee(options, policy));
    case "find-employee-like":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.findEmployeeNameLike({
        name: options.name,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "list-employees":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.listEmployees({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options),
        status: options.status
      }));
    case "employee-detail":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.employeeDetail(employeeLookupOptions(options, policy)));
    case "employee-timeline":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.employeeTimeline(employeeLookupOptions(options, policy)));
    case "contracts-by-employee":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.contractsByEmployee(employeeLookupOptions(options, policy)));
    case "performance-by-employee":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.performanceByEmployee(employeeLookupOptions(options, policy)));
    case "performance-by-month":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.performanceByMonth({
        month: options.month,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "insurance-by-employee":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.insuranceChangesByEmployee(employeeLookupOptions(options, policy)));
    case "insurance-by-month":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.insuranceChangesByMonth({
        month: options.month,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "personnel-changes-by-employee":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.personnelChangesByEmployee(employeeLookupOptions(options, policy)));
    case "personnel-changes-list":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.personnelChangesList({
        year: options.year,
        changeReason: options.reason,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "disciplinary-by-employee":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.disciplinaryRecordsByEmployee(employeeLookupOptions(options, policy)));
    case "seal-usage-list":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.sealUsageList({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options),
        dateFrom: options.from,
        dateTo: options.to,
        employeeName: options.name
      }));
    case "pending-review-list":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.pendingReviewList());
    case "data-quality-check":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.dataQualityCheck());
    case "analyze-headcount":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeHeadcount({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "analyze-contract-coverage":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeContractCoverage({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "analyze-contract-expiry":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeContractExpiry({
        days: options.days,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "analyze-performance-month":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzePerformanceMonth({
        month: options.month,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "analyze-low-performance":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeLowPerformance({
        month: options.month,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options),
        threshold: options.threshold
      }));
    case "analyze-insurance-month":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeInsuranceMonth({
        month: options.month,
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "analyze-disciplinary":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeDisciplinary({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "analyze-hr-risk-dashboard":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.analyzeHrRiskDashboard());
    case "employee-summary":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.employeeSummary({
        companyName: options.company,
        companyNames: scopedCompanyNames(policy, options)
      }));
    case "employees-without-contracts":
      authorizeHrCommand({ command, options, policy });
      return print(await repo.employeesWithoutContracts());
    case "preview-org-seeds":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewOrgSeeds({
        plan: readJson(options.input),
        companyName: options.company
      }));
    case "apply-org-seeds":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyOrgSeeds({
        plan: readJson(options.input),
        companyName: options.company,
        confirm: options.confirm
      }));
    case "verify-org-seeds":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyOrgSeeds({
        plan: readJson(options.input),
        companyName: options.company
      }));
    case "delete-empty-departments":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.deleteEmptyDepartments({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "preview-employees":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewEmployeeSeeds({
        plan: readJson(options.input)
      }));
    case "apply-employees":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyEmployeeSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-employees":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyEmployeeSeeds({
        plan: readJson(options.input)
      }));
    case "delete-employee-records":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.deleteEmployeeRecords({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-employee-deletions":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyEmployeeDeletions({
        plan: readJson(options.input)
      }));
    case "preview-contracts":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewContractSeeds({
        plan: readJson(options.input)
      }));
    case "apply-contracts":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyContractSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-contracts":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyContractSeeds({
        plan: readJson(options.input)
      }));
    case "preview-performance-reviews":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewPerformanceReviewSeeds({
        plan: readJson(options.input)
      }));
    case "apply-performance-reviews":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyPerformanceReviewSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-performance-reviews":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyPerformanceReviewSeeds({
        plan: readJson(options.input)
      }));
    case "preview-insurance-changes":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewInsuranceChangeSeeds({
        plan: readJson(options.input)
      }));
    case "apply-insurance-changes":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyInsuranceChangeSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-insurance-changes":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyInsuranceChangeSeeds({
        plan: readJson(options.input)
      }));
    case "preview-personnel-changes":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewPersonnelChangeSeeds({
        plan: readJson(options.input)
      }));
    case "apply-personnel-changes":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyPersonnelChangeSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-personnel-changes":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyPersonnelChangeSeeds({
        plan: readJson(options.input)
      }));
    case "apply-employee-nickname-cleanup":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyEmployeeNicknameCleanup({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-employee-nickname-cleanup":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyEmployeeNicknameCleanup({
        plan: readJson(options.input)
      }));
    case "preview-disciplinary-records":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewDisciplinaryRecordSeeds({
        plan: readJson(options.input)
      }));
    case "apply-disciplinary-records":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyDisciplinaryRecordSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-disciplinary-records":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyDisciplinaryRecordSeeds({
        plan: readJson(options.input)
      }));
    case "apply-disciplinary-attachments":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applyDisciplinaryAttachments({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-disciplinary-attachments":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifyDisciplinaryAttachments({
        plan: readJson(options.input)
      }));
    case "preview-seal-usage":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.previewSealUsageSeeds({
        plan: readJson(options.input)
      }));
    case "apply-seal-usage":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.applySealUsageSeeds({
        plan: readJson(options.input),
        confirm: options.confirm
      }));
    case "verify-seal-usage":
      authorizeHrCommand({ command, options, plan: readJson(options.input), policy });
      return print(await repo.verifySealUsageSeeds({
        plan: readJson(options.input)
      }));
    default:
      throw new Error(`Unknown command: ${command || "(empty)"}. Run "help" to list commands.`);
  }
}

function applyScopedCompanyDefault({ command, options, policy }) {
  if (!command || !options || options.company || !policy || policy.unrestricted) return;
  if (!AUTO_SCOPED_COMPANY_COMMANDS.has(command)) return;
  if ((policy.companyScope ?? []).length !== 1) return;
  options.company = policy.companyScope[0];
}

function scopedCompanyNames(policy, options) {
  if (!policy || policy.unrestricted || options.company) return null;
  return policy.companyScope ?? null;
}

function printHelp() {
  return printBusinessHelp();
}

function printBusinessHelp(positionals = []) {
  const catalog = [
    {
      group: "Business query",
      commands: [
        "business query companies",
        "business query employee [--company <company>] [--status <status>]",
        "business get employee --name <name> [--company <company>]",
        "business query employee-contracts --name <name> [--company <company>]",
        "business query employee-timeline --name <name> [--company <company>]",
        "business query departments [--company <company>]",
        "business get department --company <company> --department <department>",
        "business query performance --month YYYY-MM [--company <company>]",
        "business query performance-by-employee --name <name> [--company <company>]",
        "business query insurance --month YYYY-MM [--company <company>]",
        "business query insurance-by-employee --name <name> [--company <company>]",
        "business query personnel-change [--year YYYY] [--reason <reason>] [--company <company>]",
        "business query personnel-changes [--year YYYY] [--reason <reason>] [--company <company>]",
        "business query personnel-change-by-employee --name <name> [--company <company>]",
        "business query disciplinary [--name <name>] [--company <company>]",
        "business query seal-usage [--company <company>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--name <name>]"
      ]
    },
    {
      group: "Business analysis",
      commands: [
        "business analyze headcount",
        "business analyze employee-summary",
        "business analyze contract-coverage",
        "business analyze contract-expiry [--days 180]",
        "business analyze performance --month YYYY-MM [--company <company>]",
        "business analyze low-performance --month YYYY-MM [--threshold 60] [--company <company>]",
        "business analyze insurance --month YYYY-MM [--company <company>]",
        "business analyze disciplinary [--company <company>]"
      ]
    },
    {
      group: "Business writes with confirmation",
      commands: [
        "business preview employee --input <plan.json>",
        "business create employee --input <plan.json>",
        "business preview contract --input <plan.json>",
        "business create contract --input <plan.json>",
        "business preview performance --input <raw.json>",
        "business create performance --input <plan.json>",
        "business preview insurance --input <raw.json>",
        "business create insurance --input <plan.json>",
        "business preview personnel-change --input <plan.json>",
        "business create personnel-change --input <plan.json>",
        "business preview disciplinary --input <plan.json>",
        "business create disciplinary --input <plan.json>",
        "business create disciplinary-attachment --input <plan.json>",
        "business preview seal-usage --input <plan.json>",
        "business create seal-usage --input <plan.json>",
        "business preview organization --input <plan.json>",
        "business create organization --input <plan.json>",
        "business preview departments --input <plan.json>",
        "business create departments --input <plan.json>",
        "business update employee-nickname --input <plan.json>",
        "business delete employee --input <plan.json>"
      ]
    }
  ];
  const filter = positionals.join(" ").trim();
  const groups = filter
    ? catalog
        .map((group) => ({
          ...group,
          commands: group.commands.filter((command) => command.includes(`business ${filter}`))
        }))
        .filter((group) => group.commands.length)
    : catalog;
  return print({
    usage: "nanobot-webui-business hr business <query|get|analyze> <resource|topic> [options]",
    rules: [
      "This is the scoped business command surface for WebUI tenant sessions.",
      "Run from workspace root: cd <workspace> && nanobot-webui-business hr business ...",
      "Omit --company to use the current account's authorized company scope automatically."
    ],
    groups
  });
}

function printCommandHelp(command) {
  const catalog = [
    {
      group: "Read and match",
      commands: [
        "count-all",
        "list-companies",
        "find-company --name <company>",
        "list-departments --company <company>",
        "find-department --company <company> --department <department>",
        "find-employee --id-card <id-card>",
        "find-employee --phone <phone>",
        "find-employee --name <name> [--company <company>] [--department <department>]",
        "find-employee-like --name <name> [--company <company>]",
        "list-employees [--company <company>] [--status <status>]",
        "employee-detail --name <name> --company <company>",
        "employee-timeline --name <name> --company <company>",
        "pending-review-list"
      ]
    },
    {
      group: "Employee lifecycle queries",
      commands: [
        "contracts-by-employee --name <name> --company <company>",
        "performance-by-employee --name <name> --company <company>",
        "performance-by-month --month YYYY-MM [--company <company>]",
        "insurance-by-employee --name <name> --company <company>",
        "insurance-by-month --month YYYY-MM [--company <company>]",
        "personnel-changes-by-employee --name <name> --company <company>",
        "personnel-changes-list [--year YYYY] [--reason <reason>] [--company <company>]",
        "disciplinary-by-employee --name <name> --company <company>",
        "seal-usage-list [--company <company>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--name <name>]"
      ]
    },
    {
      group: "Analysis",
      commands: [
        "data-quality-check",
        "employee-summary",
        "employees-without-contracts",
        "analyze-headcount",
        "analyze-contract-coverage",
        "analyze-contract-expiry [--days 90]",
        "analyze-performance-month --month YYYY-MM [--company <company>]",
        "analyze-low-performance --month YYYY-MM [--threshold 60] [--company <company>]",
        "analyze-insurance-month --month YYYY-MM [--company <company>]",
        "analyze-disciplinary [--company <company>]",
        "analyze-hr-risk-dashboard"
      ]
    },
    {
      group: "Confirmed writes and verification",
      commands: [
        "preview-org-seeds --input <plan.json>",
        "apply-org-seeds --input <plan.json> --confirm 创建公司和部门",
        "verify-org-seeds --input <plan.json>",
        "delete-empty-departments --input <plan.json> --confirm 删除空部门",
        "apply-employees --input <plan.json> --confirm 导入员工主档",
        "verify-employees --input <plan.json>",
        "delete-employee-records --input <plan.json> --confirm 删除员工记录",
        "verify-employee-deletions --input <plan.json>",
        "apply-contracts --input <plan.json> --confirm 导入合同",
        "verify-contracts --input <plan.json>",
        "preview-performance-reviews --input <raw.json>",
        "apply-performance-reviews --input <plan.json> --confirm 导入绩效",
        "verify-performance-reviews --input <plan.json>",
        "preview-insurance-changes --input <raw.json>",
        "apply-insurance-changes --input <plan.json> --confirm 导入社医保异动",
        "verify-insurance-changes --input <plan.json>",
        "apply-personnel-changes --input <plan.json> --confirm 导入人事异动",
        "verify-personnel-changes --input <plan.json>",
        "apply-employee-nickname-cleanup --input <plan.json> --confirm 清理员工姓名花名",
        "verify-employee-nickname-cleanup --input <plan.json>",
        "apply-disciplinary-records --input <plan.json> --confirm 导入奖惩记录",
        "verify-disciplinary-records --input <plan.json>",
        "apply-disciplinary-attachments --input <plan.json> --confirm 回填奖惩附件",
        "verify-disciplinary-attachments --input <plan.json>",
        "apply-seal-usage --input <plan.json> --confirm 导入用章记录",
        "verify-seal-usage --input <plan.json>",
        "clear-business-data --confirm 清空人事业务数据"
      ]
    }
  ];
  const groups = command
    ? catalog
        .map((group) => ({
          ...group,
          commands: group.commands.filter((item) => item.split(/\s+/)[0] === command)
        }))
        .filter((group) => group.commands.length)
    : catalog;
  return print({
    usage: "nanobot-webui-business hr <command> [options]",
    rules: [
      "--help only prints command usage and never runs a business query or write.",
      "Read commands can run directly.",
      "Write/delete/import commands require explicit user confirmation first."
    ],
    groups
  });
}

function normalizeBusinessCommand(parsed) {
  const [action, resource] = parsed.positionals;
  const options = { ...parsed.options };
  const key = `${action ?? ""}:${resource ?? ""}`;
  const aliases = new Map([
    ["query:company", "list-companies"],
    ["query:companies", "list-companies"],
    ["query:employee", "list-employees"],
    ["query:employees", "list-employees"],
    ["get:employee", "employee-detail"],
    ["query:employee-contracts", "contracts-by-employee"],
    ["query:employee-timeline", "employee-timeline"],
    ["query:departments", "list-departments"],
    ["get:department", "find-department"],
    ["query:performance", "performance-by-month"],
    ["query:performance-by-employee", "performance-by-employee"],
    ["query:insurance", "insurance-by-month"],
    ["query:insurance-by-employee", "insurance-by-employee"],
    ["query:personnel-change", "personnel-changes-list"],
    ["query:personnel-changes", "personnel-changes-list"],
    ["query:personnel-change-by-employee", "personnel-changes-by-employee"],
    ["query:disciplinary", options.name ? "disciplinary-by-employee" : "analyze-disciplinary"],
    ["query:seal-usage", "seal-usage-list"],
    ["analyze:headcount", "analyze-headcount"],
    ["analyze:employee-summary", "employee-summary"],
    ["analyze:contract-coverage", "analyze-contract-coverage"],
    ["analyze:contract-expiry", "analyze-contract-expiry"],
    ["analyze:performance", "analyze-performance-month"],
    ["analyze:low-performance", "analyze-low-performance"],
    ["analyze:insurance", "analyze-insurance-month"],
    ["analyze:disciplinary", "analyze-disciplinary"],
    ["preview:employee", "preview-employees"],
    ["preview:employees", "preview-employees"],
    ["create:employee", "apply-employees"],
    ["create:employees", "apply-employees"],
    ["verify:employee", "verify-employees"],
    ["verify:employees", "verify-employees"],
    ["preview:contract", "preview-contracts"],
    ["preview:contracts", "preview-contracts"],
    ["create:contract", "apply-contracts"],
    ["create:contracts", "apply-contracts"],
    ["verify:contract", "verify-contracts"],
    ["verify:contracts", "verify-contracts"],
    ["preview:performance", "preview-performance-reviews"],
    ["create:performance", "apply-performance-reviews"],
    ["verify:performance", "verify-performance-reviews"],
    ["preview:insurance", "preview-insurance-changes"],
    ["create:insurance", "apply-insurance-changes"],
    ["verify:insurance", "verify-insurance-changes"],
    ["preview:personnel-change", "preview-personnel-changes"],
    ["preview:personnel-changes", "preview-personnel-changes"],
    ["create:personnel-change", "apply-personnel-changes"],
    ["create:personnel-changes", "apply-personnel-changes"],
    ["verify:personnel-change", "verify-personnel-changes"],
    ["verify:personnel-changes", "verify-personnel-changes"],
    ["preview:disciplinary", "preview-disciplinary-records"],
    ["create:disciplinary", "apply-disciplinary-records"],
    ["verify:disciplinary", "verify-disciplinary-records"],
    ["create:disciplinary-attachment", "apply-disciplinary-attachments"],
    ["create:disciplinary-attachments", "apply-disciplinary-attachments"],
    ["verify:disciplinary-attachment", "verify-disciplinary-attachments"],
    ["verify:disciplinary-attachments", "verify-disciplinary-attachments"],
    ["preview:seal-usage", "preview-seal-usage"],
    ["create:seal-usage", "apply-seal-usage"],
    ["verify:seal-usage", "verify-seal-usage"],
    ["preview:organization", "preview-org-seeds"],
    ["preview:organizations", "preview-org-seeds"],
    ["preview:department", "preview-org-seeds"],
    ["preview:departments", "preview-org-seeds"],
    ["create:organization", "apply-org-seeds"],
    ["create:organizations", "apply-org-seeds"],
    ["create:department", "apply-org-seeds"],
    ["create:departments", "apply-org-seeds"],
    ["verify:organization", "verify-org-seeds"],
    ["verify:organizations", "verify-org-seeds"],
    ["verify:department", "verify-org-seeds"],
    ["verify:departments", "verify-org-seeds"],
    ["update:employee-nickname", "apply-employee-nickname-cleanup"],
    ["delete:employee", "delete-employee-records"],
    ["delete:employees", "delete-employee-records"]
  ]);
  const command = aliases.get(key);
  if (!command) {
    throw new Error(`Unknown business command: business ${parsed.positionals.join(" ")}`);
  }
  if (action === "create" || action === "update" || action === "delete") {
    options.confirm = options.confirm ?? businessConfirmationFor(command);
  }
  return { command, options };
}

function businessConfirmationFor(command) {
  return new Map([
    ["apply-org-seeds", "创建公司和部门"],
    ["apply-employees", "导入员工主档"],
    ["apply-contracts", "导入合同"],
    ["apply-performance-reviews", "导入绩效"],
    ["apply-insurance-changes", "导入社医保异动"],
    ["apply-personnel-changes", "导入人事异动"],
    ["apply-disciplinary-records", "导入奖惩记录"],
    ["apply-disciplinary-attachments", "回填奖惩附件"],
    ["apply-seal-usage", "导入用章记录"],
    ["apply-employee-nickname-cleanup", "清理员工姓名花名"],
    ["delete-employee-records", "删除员工记录"]
  ]).get(command);
}

async function findEmployee(options, policy) {
  const lookupOptions = employeeLookupOptions(options, policy);
  if (lookupOptions.companyNames?.length) {
    return repo.resolveEmployeeLookup(lookupOptions);
  }
  if (options["id-card"]) {
    return repo.findEmployeeByIdCard(options["id-card"], {
      companyName: options.company,
      companyNames: scopedCompanyNames(policy, options)
    });
  }
  if (options.phone) {
    return repo.findEmployeeByPhone(options.phone, {
      companyName: options.company,
      companyNames: scopedCompanyNames(policy, options)
    });
  }
  return repo.findEmployeeCandidates({
    name: options.name,
    companyName: options.company,
    companyNames: scopedCompanyNames(policy, options),
    departmentName: options.department
  });
}

function employeeLookupOptions(options, policy) {
  return {
    idCard: options["id-card"],
    phone: options.phone,
    name: options.name,
    companyName: options.company,
    companyNames: scopedCompanyNames(policy, options),
    departmentName: options.department
  };
}

function parseArgs(argv) {
  const normalizedArgv = normalizeQuotedBusinessArgv(argv);
  const [command, ...rest] = normalizedArgv;
  const options = {};
  const positionals = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { command, positionals, options };
}

function normalizeQuotedBusinessArgv(argv) {
  const [first, ...rest] = argv;
  if (typeof first !== "string" || !first.startsWith("business ")) return argv;
  return [...first.split(/\s+/).filter(Boolean), ...rest];
}

function print(value) {
  console.log(JSON.stringify({ ok: true, data: value }, null, 2));
}

function readJson(filePath) {
  if (!filePath) throw new Error("--input is required");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
