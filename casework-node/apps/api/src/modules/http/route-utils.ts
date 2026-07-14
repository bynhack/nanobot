import type { FastifyReply } from "fastify";
import {
  FieldError,
  GraphNotFoundError,
  QueryClientNotConfiguredError,
} from "@casework/case-graph";
import { AuditNotFoundError } from "@casework/case-audit";

export type JsonObject = Record<string, unknown>;

export function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function requiredText(value: unknown, field: string): string {
  const result = text(value);
  if (!result) throw new FieldError(field);
  return result;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function jsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export function objectList(value: unknown): value is JsonObject[] {
  return Array.isArray(value) && value.every(isJsonObject);
}

export function sendMappedError(
  reply: FastifyReply,
  error: unknown,
  label: string,
  status = 500,
) {
  if (error instanceof QueryClientNotConfiguredError)
    return reply.code(503).send({ error: error.message });
  if (error instanceof AuditNotFoundError)
    return reply.code(404).send({ error: "审计档案不存在" });
  if (error instanceof GraphNotFoundError)
    return reply.code(404).send({ error: "图不存在" });
  if (error instanceof FieldError)
    return reply
      .code(400)
      .send({ error: `缺少或无效的必要字段: ${error.field}` });
  if (error instanceof Error && REQUIRED_FIELDS.has(error.message))
    return reply
      .code(400)
      .send({ error: `缺少或无效的必要字段: ${error.message}` });
  return reply.code(status).send({
    error: `${label}: ${error instanceof Error ? error.message : String(error)}`,
  });
}

const REQUIRED_FIELDS = new Set([
  "caseId",
  "graphId",
  "graphName",
  "tradeCards",
  "auditId",
  "audit_id",
  "case_id",
  "graph_id",
  "victimCondition",
  "sourceCondition",
]);
