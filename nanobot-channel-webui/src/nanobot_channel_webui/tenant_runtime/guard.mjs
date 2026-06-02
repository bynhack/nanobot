import fs from "node:fs";

export class TenantAccessDenied extends Error {
  constructor(reason = "tenant_scope_denied") {
    super(reason);
    this.name = "TenantAccessDenied";
    this.code = reason;
  }
}

function asList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .replaceAll("，", ",")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

export function loadPolicyFromFile(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function loadPolicyFromEnv(env = process.env) {
  const policyFile = String(env.NANOBOT_WEBUI_POLICY_FILE || "").trim();
  if (policyFile) return loadPolicyFromFile(policyFile);
  return {
    version: "tenant-runtime/v1",
    subject: {
      user_id: String(env.NANOBOT_WEBUI_USER_ID || ""),
      email: String(env.NANOBOT_WEBUI_USER_EMAIL || ""),
      role: String(env.NANOBOT_WEBUI_ROLE || "user"),
      business_role: String(env.NANOBOT_WEBUI_BUSINESS_ROLE || "scoped"),
    },
    resources: [],
    scopes: {},
  };
}

export function isUnrestricted(policy) {
  const subject = policy?.subject || policy || {};
  return subject.role === "admin" || subject.business_role === "admin" || subject.businessRole === "admin";
}

function resourcePermission(policy, resource) {
  if (isUnrestricted(policy)) return { resource, actions: ["*"], scopes: [{ key: "*", values: ["*"] }] };
  return (Array.isArray(policy?.resources) ? policy.resources : []).find((item) => item?.resource === resource) || null;
}

export function scopeValues(policy, resource, scopeKey) {
  if (isUnrestricted(policy)) return ["*"];
  const permission = resourcePermission(policy, resource);
  const scope = (permission?.scopes || []).find((item) => item?.key === scopeKey);
  return asList(scope?.values);
}

export function allows(policy, { resource, action, scopeKey = "", scopeValue = "" }) {
  if (isUnrestricted(policy)) return true;
  const permission = resourcePermission(policy, resource);
  if (!permission) return false;
  const actions = asList(permission.actions);
  if (!actions.includes("*") && !actions.includes(action)) return false;
  if (!scopeKey) return true;
  const values = scopeValues(policy, resource, scopeKey);
  if (values.includes("*")) return true;
  const normalizedValue = String(scopeValue || "").trim();
  return Boolean(normalizedValue) && values.includes(normalizedValue);
}

export function assertAllowed(policy, requirement) {
  if (!allows(policy, requirement)) throw new TenantAccessDenied("tenant_scope_denied");
}

export function filterAllowedValues(policy, resource, action, values, { scopeKey }) {
  return values.filter((value) => allows(policy, { resource, action, scopeKey, scopeValue: value }));
}

export function scopeRows(policy, resource, action, rows, { scopeKey, field = scopeKey, getValue } = {}) {
  return rows.filter((row) => {
    const value = getValue ? getValue(row) : row?.[field];
    return allows(policy, { resource, action, scopeKey, scopeValue: value });
  });
}
