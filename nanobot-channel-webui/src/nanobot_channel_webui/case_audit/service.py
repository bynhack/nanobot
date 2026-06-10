"""Case-level fraud fund audit using the legacy notarized amount rules."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


MONEY_ZERO = Decimal("0")
MONEY_QUANT = Decimal("0.01")
JD_FLAG_DEBIT = "借"
JD_FLAG_CREDIT = "贷"
FLOW_STATUS_CONFIRMED = "confirmed_flow"
FLOW_STATUS_BALANCE_EXCLUDED = "balance_excluded"
FLOW_STATUS_SUSPECT_OUTFLOW = "suspect_outflow"
AUDIT_SOURCE_RECOGNIZED = "recognized"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value).replace(",", ""))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _money(value: Decimal | None) -> str:
    amount = value if value is not None else MONEY_ZERO
    return str(amount.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP))


def _number(value: Decimal | None) -> float:
    amount = value if value is not None else MONEY_ZERO
    return float(amount.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP))


def _parse_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_items = value.replace("，", ",").replace("\n", ",").split(",")
        return list(dict.fromkeys(item.strip() for item in raw_items if item.strip()))
    if isinstance(value, list):
        return list(dict.fromkeys(_text(item) for item in value if _text(item)))
    return []


def _require_case_id(payload: dict[str, Any]) -> str:
    case_id = _text(payload.get("caseId"))
    if not case_id:
        raise ValueError("caseId")
    return case_id


def _require_victim_condition(victim_cards: list[str], victim_names: list[str]) -> None:
    if not victim_cards and not victim_names:
        raise ValueError("victimCondition")


def _has_source_condition(source_cards: list[str], source_names: list[str], source_amount: Decimal | None) -> bool:
    return bool(source_amount is not None and source_amount > MONEY_ZERO and (source_cards or source_names))


def _trade_id(trade: dict[str, Any]) -> str:
    return _text(trade.get("id") or trade.get("tradeRowId"))


def _party_key(prefix: str, trade: dict[str, Any]) -> str:
    account_id = _text(trade.get(f"{prefix}AccountId"))
    card = _text(trade.get(f"{prefix}TradeCard"))
    name = _text(trade.get(f"{prefix}AccountName"))
    return account_id or card or name or f"{prefix}:{_trade_id(trade)}"


def _party_label(prefix: str, trade: dict[str, Any]) -> str:
    name = _text(trade.get(f"{prefix}AccountName"))
    card = _text(trade.get(f"{prefix}TradeCard"))
    return name or card or "未知主体"


def _reasoning_step(
    *,
    step_id: str,
    kind: str,
    trade: dict[str, Any],
    account_card: str,
    pool_before: Decimal,
    pool_after: Decimal,
    confirm_amount: Decimal | None = None,
) -> dict[str, Any]:
    return {
        "id": step_id,
        "kind": kind,
        "tradeId": _trade_id(trade),
        "serialNumber": _text(trade.get("serialNumber")),
        "tradeTime": _text(trade.get("tradeTime")),
        "accountCard": _text(account_card),
        "payerName": _text(trade.get("payerAccountName")),
        "payerCard": _text(trade.get("payerTradeCard")),
        "payeeName": _text(trade.get("payeeAccountName")),
        "payeeCard": _text(trade.get("payeeTradeCard")),
        "amount": _money(trade.get("tradeAmount")),
        "amountNumber": _number(trade.get("tradeAmount")),
        "poolBefore": _money(pool_before),
        "poolBeforeNumber": _number(pool_before),
        "poolAfter": _money(pool_after),
        "poolAfterNumber": _number(pool_after),
        "payerTradeBalance": _money(trade.get("payerTradeBalance")),
        "payerTradeBalanceNumber": _number(trade.get("payerTradeBalance")),
        "confirmAmount": _money(confirm_amount),
        "confirmAmountNumber": _number(confirm_amount),
        "fileName": _text(trade.get("fileName") or trade.get("fileId")),
    }


def _source_reasoning_step(
    *,
    step_id: str,
    account_card: str,
    account_name: str,
    source_amount: Decimal,
    source_label: str,
    trade: dict[str, Any] | None,
) -> dict[str, Any]:
    context_trade = trade or {}
    return {
        "id": step_id,
        "kind": "source_carryover",
        "tradeId": step_id,
        "serialNumber": "上一层认定",
        "tradeTime": _text(context_trade.get("tradeTime")),
        "accountCard": _text(account_card),
        "payerName": _text(source_label) or "上一层认定金额",
        "payerCard": "",
        "payeeName": _text(account_name),
        "payeeCard": _text(account_card),
        "amount": _money(source_amount),
        "amountNumber": _number(source_amount),
        "poolBefore": _money(MONEY_ZERO),
        "poolBeforeNumber": _number(MONEY_ZERO),
        "poolAfter": _money(source_amount),
        "poolAfterNumber": _number(source_amount),
        "payerTradeBalance": _money(None),
        "payerTradeBalanceNumber": _number(None),
        "confirmAmount": _money(None),
        "confirmAmountNumber": _number(None),
        "fileName": "上一层审计结果",
    }


def _as_audit_trade(row: dict[str, Any]) -> dict[str, Any]:
    amount = _decimal(row.get("trade_amount") if "trade_amount" in row else row.get("tradeAmount"))
    payer_balance = _decimal(
        row.get("payer_trade_balance") if "payer_trade_balance" in row else row.get("payerTradeBalance")
    )
    trade_balance = _decimal(row.get("trade_balance") if "trade_balance" in row else row.get("tradeBalance"))
    row_id = _text(row.get("row_id") or row.get("tradeRowId"))
    trade_id = _text(row.get("id")) or row_id
    return {
        "id": trade_id,
        "tradeRowId": row_id,
        "fileId": _text(row.get("file_id") if "file_id" in row else row.get("fileId")),
        "fileName": _text(row.get("file_name") if "file_name" in row else row.get("fileName")),
        "serialNumber": _text(row.get("serial_number") if "serial_number" in row else row.get("serialNumber")),
        "tradeAmount": amount if amount is not None else MONEY_ZERO,
        "tradeAmountText": _money(amount),
        "tradeTime": _text(row.get("trade_time") if "trade_time" in row else row.get("tradeTime")),
        "jdFlag": _text(row.get("jd_flag") if "jd_flag" in row else row.get("jdFlag")),
        "payerSuspectId": _text(row.get("payer_suspect_id") if "payer_suspect_id" in row else row.get("payerSuspectId")),
        "payerAccountId": _text(row.get("payer_account_id") if "payer_account_id" in row else row.get("payerAccountId")),
        "payerAccountName": _text(row.get("payer_account_name") if "payer_account_name" in row else row.get("payerAccountName")),
        "payerTradeCard": _text(row.get("payer_trade_card") if "payer_trade_card" in row else row.get("payerTradeCard")),
        "payerTradeBalance": payer_balance,
        "payeeSuspectId": _text(row.get("payee_suspect_id") if "payee_suspect_id" in row else row.get("payeeSuspectId")),
        "payeeAccountId": _text(row.get("payee_account_id") if "payee_account_id" in row else row.get("payeeAccountId")),
        "payeeAccountName": _text(row.get("payee_account_name") if "payee_account_name" in row else row.get("payeeAccountName")),
        "payeeTradeCard": _text(row.get("payee_trade_card") if "payee_trade_card" in row else row.get("payeeTradeCard")),
        "tradeBalance": trade_balance,
        "relationId": "",
        "flowStatus": "",
        "flowStatusText": "",
        "faultAmount": None,
        "confirmAmount": None,
        "caseAmount": None,
    }


def _audit_trade_sort_key(trade: dict[str, Any]) -> tuple[str, int, str, str]:
    trade_time = _text(trade.get("tradeTime"))
    serial_number = _text(trade.get("serialNumber"))
    row_id = _text(trade.get("tradeRowId"))
    try:
        numeric_serial = int(serial_number)
    except (TypeError, ValueError):
        numeric_serial = 0
    return (trade_time, numeric_serial, row_id, _trade_id(trade))


@dataclass
class _AuditResult:
    confirm_amount: Decimal = MONEY_ZERO
    fraud_amount: Decimal = MONEY_ZERO
    case_amount: Decimal = MONEY_ZERO
    suspect_names: list[str] = field(default_factory=list)
    trade_map: dict[str, dict[str, Any]] = field(default_factory=dict)
    recognition_events: list[dict[str, Any]] = field(default_factory=list)
    reasoning_steps: list[dict[str, Any]] = field(default_factory=list)

    def add_suspect_names(self, names: list[str]) -> None:
        for name in names:
            if name and name not in self.suspect_names:
                self.suspect_names.append(name)


@dataclass
class _PayeeAuditInfo:
    payee_trades: list[dict[str, Any]] = field(default_factory=list)
    suspect_names: list[str] = field(default_factory=list)
    reasoning_step_ids: list[str] = field(default_factory=list)
    victim_amount: Decimal = MONEY_ZERO
    fault_amount: Decimal = MONEY_ZERO
    confirm_amount: Decimal = MONEY_ZERO
    case_amount: Decimal = MONEY_ZERO
    source_amount: Decimal = MONEY_ZERO

    def audit(self, result: _AuditResult) -> None:
        result.fraud_amount += self.fault_amount or self.source_amount
        result.confirm_amount += self.confirm_amount
        result.case_amount += self.case_amount
        result.add_suspect_names(self.suspect_names)
        for payee_trade in self.payee_trades:
            if _text(payee_trade.get("relationId")):
                result.trade_map[_trade_id(payee_trade)] = payee_trade


class CaseAuditService:
    """Runs the legacy file audit amount-recognition logic over case trades."""

    def __init__(self, query_client: Any) -> None:
        self._query_client = query_client

    def list_cases(self) -> list[dict[str, Any]]:
        return self._query_client.list_cases()

    def overview(self, case_id: str) -> dict[str, Any]:
        if not _text(case_id):
            raise ValueError("caseId")
        overview = self._query_client.case_audit_overview(case_id)
        return {
            "caseId": _text(case_id),
            "tradeCount": int(overview.get("tradeCount") or 0),
            "sourceFileCount": int(overview.get("sourceFileCount") or 0),
            "balanceMissingCount": int(overview.get("balanceMissingCount") or 0),
            "minTradeTime": _text(overview.get("minTradeTime")),
            "maxTradeTime": _text(overview.get("maxTradeTime")),
            "totalTradeAmount": _money(_decimal(overview.get("totalTradeAmount"))),
        }

    def run_case_audit(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = _require_case_id(payload)
        victim_cards = _parse_text_list(payload.get("victimCards") or payload.get("victims"))
        victim_names = _parse_text_list(payload.get("victimNames"))
        suspect_cards = _parse_text_list(payload.get("suspectCards") or payload.get("suspects"))
        suspect_names = _parse_text_list(payload.get("suspectNames"))
        source_account_cards = _parse_text_list(payload.get("sourceAccountCards"))
        source_account_names = _parse_text_list(payload.get("sourceAccountNames"))
        source_amount = _decimal(payload.get("sourceAmount"))
        source_mode = _text(payload.get("sourceMode"))
        source_label = _text(payload.get("sourceLabel"))
        if source_mode == AUDIT_SOURCE_RECOGNIZED:
            if not _has_source_condition(source_account_cards, source_account_names, source_amount):
                raise ValueError("sourceCondition")
        else:
            _require_victim_condition(victim_cards, victim_names)
        rows = self._query_client.query_case_audit_trades(dict(payload))
        trades = sorted((_as_audit_trade(row) for row in rows), key=_audit_trade_sort_key)

        result, stats = self._run_legacy_algorithm(
            trades,
            victim_cards=victim_cards,
            victim_names=victim_names,
            suspect_cards=suspect_cards,
            suspect_names=suspect_names,
            source_account_cards=source_account_cards,
            source_account_names=source_account_names,
            source_amount=source_amount if source_mode == AUDIT_SOURCE_RECOGNIZED else None,
            source_label=source_label,
        )
        recognized_trades = [self._serialize_trade(trade) for trade in result.trade_map.values()]
        audit_trades = [self._serialize_trade(trade) for trade in trades]
        suspect_results = self._build_suspect_results(result, recognized_trades)
        graph = self._build_graph(recognized_trades, victim_cards, victim_names, suspect_cards, suspect_names)
        warnings = self._build_warnings(
            stats,
            victim_cards=victim_cards,
            victim_names=victim_names,
            suspect_cards=suspect_cards,
            suspect_names=suspect_names,
            source_mode=source_mode,
        )

        return {
            "schemaVersion": "case-audit.v1",
            "caseId": case_id,
            "scope": "case",
            "algorithm": {
                "id": "legacyFileAuditAlgorithm",
                "source": "GaTradeServiceImpl.doAudit",
                "inputMode": "caseTrades",
                "rules": [
                    "贷方流水命中被害人后累计被害入账金额",
                    "上一层已认定金额可作为下一层账号的待判断资金池起点",
                    "借方流水未命中嫌疑人时按交易金额冲减累计入账",
                    "借方流水命中嫌疑人时用累计入账减转出后余额计算可认定金额",
                ],
            },
            "summary": {
                "tradeCount": len(trades),
                "sourceFileCount": stats["source_file_count"],
                "accountGroupCount": stats["account_group_count"],
                "recognizedTradeCount": len(recognized_trades),
                "suspectCount": len(suspect_results),
                "fraudAmount": _money(result.fraud_amount),
                "fraudAmountNumber": _number(result.fraud_amount),
                "confirmAmount": _money(result.confirm_amount),
                "confirmAmountNumber": _number(result.confirm_amount),
                "caseAmount": _money(result.case_amount),
                "caseAmountNumber": _number(result.case_amount),
                "balanceMissingCount": stats["balance_missing_count"],
                "unknownDirectionCount": stats["unknown_direction_count"],
                "missingGroupCardCount": stats["missing_group_card_count"],
                "victimInputCount": len(victim_cards) + len(victim_names),
                "suspectInputCount": len(suspect_cards) + len(suspect_names),
                "sourceInputCount": len(source_account_cards) + len(source_account_names),
            },
            "quality": {"warnings": warnings},
            "suspectNames": result.suspect_names,
            "suspectResults": suspect_results,
            "reasoningSteps": result.reasoning_steps,
            "graph": graph,
            "trades": audit_trades,
        }

    def _run_legacy_algorithm(
        self,
        trades: list[dict[str, Any]],
        *,
        victim_cards: list[str],
        victim_names: list[str],
        suspect_cards: list[str],
        suspect_names: list[str],
        source_account_cards: list[str],
        source_account_names: list[str],
        source_amount: Decimal | None,
        source_label: str,
    ) -> tuple[_AuditResult, dict[str, int]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        source_file_ids: set[str] = set()
        unknown_direction_count = 0
        missing_group_card_count = 0
        balance_missing_count = 0
        for trade in trades:
            if trade["fileId"]:
                source_file_ids.add(trade["fileId"])
            key = ""
            if trade["jdFlag"] == JD_FLAG_DEBIT:
                key = trade["payerTradeCard"]
            elif trade["jdFlag"] == JD_FLAG_CREDIT:
                key = trade["payeeTradeCard"]
            else:
                unknown_direction_count += 1
                continue
            if not key:
                missing_group_card_count += 1
                continue
            grouped.setdefault(key, []).append(trade)

        result = _AuditResult()
        step_index = 0
        for account_card, base_trades in grouped.items():
            payee_audit_info = _PayeeAuditInfo()
            if self._is_source_account(account_card, base_trades, source_account_cards, source_account_names, source_amount):
                step_index += 1
                step_id = f"reason:{account_card}:source:{step_index}"
                source_pool = source_amount or MONEY_ZERO
                payee_audit_info.victim_amount = source_pool
                payee_audit_info.source_amount = source_pool
                payee_audit_info.reasoning_step_ids.append(step_id)
                result.reasoning_steps.append(
                    _source_reasoning_step(
                        step_id=step_id,
                        account_card=account_card,
                        account_name=self._account_name_for_group(account_card, base_trades),
                        source_amount=source_pool,
                        source_label=source_label,
                        trade=base_trades[0] if base_trades else None,
                    )
                )
            for trade in base_trades:
                amount = trade["tradeAmount"]
                if trade["jdFlag"] == JD_FLAG_CREDIT:
                    if (victim_cards or victim_names) and self._is_victim(trade, victim_cards, victim_names):
                        step_index += 1
                        step_id = f"reason:{account_card}:{step_index}"
                        pool_before = payee_audit_info.victim_amount
                        payee_audit_info.payee_trades.append(trade)
                        payee_audit_info.victim_amount += amount
                        payee_audit_info.reasoning_step_ids.append(step_id)
                        result.reasoning_steps.append(
                            _reasoning_step(
                                step_id=step_id,
                                kind="victim_credit",
                                trade=trade,
                                account_card=account_card,
                                pool_before=pool_before,
                                pool_after=payee_audit_info.victim_amount,
                            )
                        )
                    continue

                if trade["jdFlag"] != JD_FLAG_DEBIT:
                    continue

                if not self._is_suspect(trade, suspect_cards, suspect_names):
                    step_index += 1
                    step_id = f"reason:{account_card}:{step_index}"
                    pool_before = payee_audit_info.victim_amount
                    last_victim_amount = payee_audit_info.victim_amount - amount
                    if last_victim_amount > MONEY_ZERO:
                        payee_audit_info.victim_amount = last_victim_amount
                        payee_audit_info.reasoning_step_ids.append(step_id)
                        result.reasoning_steps.append(
                            _reasoning_step(
                                step_id=step_id,
                                kind="worst_case_offset",
                                trade=trade,
                                account_card=account_card,
                                pool_before=pool_before,
                                pool_after=payee_audit_info.victim_amount,
                            )
                        )
                        payee_audit_info.payee_trades.clear()
                    else:
                        if payee_audit_info.victim_amount > MONEY_ZERO:
                            segment_step_ids = [*payee_audit_info.reasoning_step_ids, step_id]
                            result.reasoning_steps.append(
                                _reasoning_step(
                                    step_id=step_id,
                                    kind="worst_case_clear",
                                    trade=trade,
                                    account_card=account_card,
                                    pool_before=pool_before,
                                    pool_after=MONEY_ZERO,
                                )
                                | {"segmentStepIds": segment_step_ids}
                            )
                        payee_audit_info = _PayeeAuditInfo()
                    continue

                trade["caseAmount"] = amount
                trade["flowStatus"] = FLOW_STATUS_SUSPECT_OUTFLOW
                trade["flowStatusText"] = "嫌疑人收款，计算最低可认定"
                payee_audit_info.case_amount += amount
                payer_trade_balance = trade.get("payerTradeBalance")
                if payer_trade_balance is None:
                    balance_missing_count += 1
                    continue
                confirm_amount = payee_audit_info.victim_amount - payer_trade_balance
                if confirm_amount <= MONEY_ZERO:
                    step_index += 1
                    step_id = f"reason:{account_card}:{step_index}"
                    payee_audit_info.reasoning_step_ids.append(step_id)
                    result.reasoning_steps.append(
                        _reasoning_step(
                            step_id=step_id,
                            kind="suspect_no_confirm",
                            trade=trade,
                            account_card=account_card,
                            pool_before=payee_audit_info.victim_amount,
                            pool_after=payee_audit_info.victim_amount,
                            confirm_amount=confirm_amount,
                        )
                    )
                    continue

                step_index += 1
                step_id = f"reason:{account_card}:{step_index}"
                segment_step_ids = [*payee_audit_info.reasoning_step_ids, step_id]
                result.reasoning_steps.append(
                    _reasoning_step(
                        step_id=step_id,
                        kind="suspect_recognition",
                        trade=trade,
                        account_card=account_card,
                        pool_before=payee_audit_info.victim_amount,
                        pool_after=confirm_amount,
                        confirm_amount=confirm_amount,
                    )
                    | {"segmentStepIds": segment_step_ids}
                )
                trade["confirmAmount"] = confirm_amount
                payee_audit_info.confirm_amount += confirm_amount
                suspect_name = trade["payeeAccountName"]
                if suspect_name:
                    payee_audit_info.suspect_names.append(suspect_name)
                related_payee_trade_ids: list[str] = []
                confirmed_related_trade_ids: list[str] = []
                balance_excluded_trade_ids: list[str] = []
                for payee_trade in payee_audit_info.payee_trades:
                    payee_trade["relationId"] = _trade_id(trade)
                    if payee_trade["tradeAmount"] > payer_trade_balance:
                        payee_trade["flowStatus"] = FLOW_STATUS_CONFIRMED
                        payee_trade["flowStatusText"] = "余额无法完全包含，可标识具体流向"
                        confirmed_related_trade_ids.append(_trade_id(payee_trade))
                    else:
                        payee_trade["flowStatus"] = FLOW_STATUS_BALANCE_EXCLUDED
                        payee_trade["flowStatusText"] = "余额可包含，应排除具体流向"
                        balance_excluded_trade_ids.append(_trade_id(payee_trade))
                    payee_trade["faultAmount"] = payee_trade["tradeAmount"]
                    payee_audit_info.fault_amount += payee_trade["faultAmount"]
                    result.trade_map.setdefault(_trade_id(trade), trade)
                    related_payee_trade_ids.append(_trade_id(payee_trade))
                result.recognition_events.append(
                    {
                        "tradeId": _trade_id(trade),
                        "suspectName": suspect_name,
                        "suspectCard": trade["payeeTradeCard"],
                        "confirmAmount": confirm_amount,
                        "caseAmount": amount,
                        "faultAmount": payee_audit_info.fault_amount,
                        "sourceAmount": payee_audit_info.source_amount,
                        "relatedTradeIds": related_payee_trade_ids,
                        "confirmedRelatedTradeIds": confirmed_related_trade_ids,
                        "balanceExcludedTradeIds": balance_excluded_trade_ids,
                        "reasoningStepIds": segment_step_ids,
                    }
                )
                payee_audit_info.audit(result)
                payee_audit_info = _PayeeAuditInfo()

        return result, {
            "source_file_count": len(source_file_ids),
            "account_group_count": len(grouped),
            "unknown_direction_count": unknown_direction_count,
            "missing_group_card_count": missing_group_card_count,
            "balance_missing_count": balance_missing_count,
        }

    @staticmethod
    def _is_victim(trade: dict[str, Any], victim_cards: list[str], victim_names: list[str]) -> bool:
        if not victim_cards and not victim_names:
            return True
        return trade["payerTradeCard"] in victim_cards or trade["payerAccountName"] in victim_names

    @staticmethod
    def _account_name_for_group(account_card: str, trades: list[dict[str, Any]]) -> str:
        for trade in trades:
            if trade.get("payerTradeCard") == account_card and _text(trade.get("payerAccountName")):
                return _text(trade.get("payerAccountName"))
            if trade.get("payeeTradeCard") == account_card and _text(trade.get("payeeAccountName")):
                return _text(trade.get("payeeAccountName"))
        return account_card

    @staticmethod
    def _is_source_account(
        account_card: str,
        trades: list[dict[str, Any]],
        source_cards: list[str],
        source_names: list[str],
        source_amount: Decimal | None,
    ) -> bool:
        if not _has_source_condition(source_cards, source_names, source_amount):
            return False
        if account_card in source_cards:
            return True
        if not source_names:
            return False
        for trade in trades:
            if trade.get("payerTradeCard") == account_card and trade.get("payerAccountName") in source_names:
                return True
            if trade.get("payeeTradeCard") == account_card and trade.get("payeeAccountName") in source_names:
                return True
        return False

    @staticmethod
    def _is_suspect(trade: dict[str, Any], suspect_cards: list[str], suspect_names: list[str]) -> bool:
        if not suspect_cards and not suspect_names:
            return True
        return trade["payeeTradeCard"] in suspect_cards or trade["payeeAccountName"] in suspect_names

    @staticmethod
    def _serialize_trade(trade: dict[str, Any]) -> dict[str, Any]:
        keys = [
            "id",
            "tradeRowId",
            "fileId",
            "fileName",
            "serialNumber",
            "tradeTime",
            "jdFlag",
            "payerSuspectId",
            "payerAccountId",
            "payerAccountName",
            "payerTradeCard",
            "payeeSuspectId",
            "payeeAccountId",
            "payeeAccountName",
            "payeeTradeCard",
            "relationId",
            "flowStatus",
            "flowStatusText",
        ]
        serialized = {key: trade.get(key) for key in keys}
        for key in ("tradeAmount", "payerTradeBalance", "tradeBalance", "faultAmount", "confirmAmount", "caseAmount"):
            serialized[key] = _money(trade.get(key))
            serialized[f"{key}Number"] = _number(trade.get(key))
        return serialized

    @staticmethod
    def _build_suspect_results(result: _AuditResult, trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
        related_fault_amounts: dict[str, Decimal] = {}
        for trade in trades:
            relation_id = _text(trade.get("relationId"))
            if relation_id:
                related_fault_amounts[relation_id] = related_fault_amounts.get(relation_id, MONEY_ZERO) + (
                    _decimal(trade.get("faultAmount")) or MONEY_ZERO
                )

        by_suspect: dict[str, dict[str, Any]] = {}
        for event in result.recognition_events:
            name = _text(event.get("suspectName")) or _text(event.get("suspectCard")) or "未知嫌疑人"
            item = by_suspect.setdefault(
                name,
                {
                    "suspectName": name,
                    "suspectCard": _text(event.get("suspectCard")),
                    "confirmAmount": MONEY_ZERO,
                    "caseAmount": MONEY_ZERO,
                    "fraudAmount": MONEY_ZERO,
                    "tradeIds": [],
                    "relatedTradeIds": [],
                    "confirmedRelatedTradeIds": [],
                    "balanceExcludedTradeIds": [],
                    "reasoningStepIds": [],
                },
            )
            trade_id = _text(event.get("tradeId"))
            item["confirmAmount"] += event.get("confirmAmount") or MONEY_ZERO
            item["caseAmount"] += event.get("caseAmount") or MONEY_ZERO
            item["fraudAmount"] += related_fault_amounts.get(trade_id, MONEY_ZERO) or event.get("sourceAmount") or MONEY_ZERO
            if trade_id:
                item["tradeIds"].append(trade_id)
            item["relatedTradeIds"].extend(event.get("relatedTradeIds") or [])
            item["confirmedRelatedTradeIds"].extend(event.get("confirmedRelatedTradeIds") or [])
            item["balanceExcludedTradeIds"].extend(event.get("balanceExcludedTradeIds") or [])
            item["reasoningStepIds"].extend(event.get("reasoningStepIds") or [])

        return [
            {
                "suspectName": item["suspectName"],
                "suspectCard": item["suspectCard"],
                "confirmAmount": _money(item["confirmAmount"]),
                "confirmAmountNumber": _number(item["confirmAmount"]),
                "caseAmount": _money(item["caseAmount"]),
                "caseAmountNumber": _number(item["caseAmount"]),
                "fraudAmount": _money(item["fraudAmount"]),
                "fraudAmountNumber": _number(item["fraudAmount"]),
                "tradeIds": list(dict.fromkeys(item["tradeIds"])),
                "relatedTradeIds": list(dict.fromkeys(item["relatedTradeIds"])),
                "confirmedRelatedTradeIds": list(dict.fromkeys(item["confirmedRelatedTradeIds"])),
                "balanceExcludedTradeIds": list(dict.fromkeys(item["balanceExcludedTradeIds"])),
                "reasoningStepIds": list(dict.fromkeys(item["reasoningStepIds"])),
            }
            for item in sorted(by_suspect.values(), key=lambda value: value["confirmAmount"], reverse=True)
        ]

    @staticmethod
    def _build_graph(
        trades: list[dict[str, Any]],
        victim_cards: list[str],
        victim_names: list[str],
        suspect_cards: list[str],
        suspect_names: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        for trade in trades:
            payer_id = f"account:{_party_key('payer', trade)}"
            payee_id = f"account:{_party_key('payee', trade)}"
            payer_label = _party_label("payer", trade)
            payee_label = _party_label("payee", trade)
            nodes.setdefault(
                payer_id,
                {
                    "id": payer_id,
                    "label": payer_label,
                    "card": _text(trade.get("payerTradeCard")),
                    "role": "victim" if (
                        not victim_cards and not victim_names
                        or trade.get("payerTradeCard") in victim_cards
                        or trade.get("payerAccountName") in victim_names
                    ) else "transfer",
                },
            )
            nodes.setdefault(
                payee_id,
                {
                    "id": payee_id,
                    "label": payee_label,
                    "card": _text(trade.get("payeeTradeCard")),
                    "role": "suspect" if (
                        not suspect_cards and not suspect_names
                        or trade.get("payeeTradeCard") in suspect_cards
                        or trade.get("payeeAccountName") in suspect_names
                    ) else "transfer",
                },
            )
            edges.append(
                {
                    "id": f"audit:{_trade_id(trade)}",
                    "source": payer_id,
                    "target": payee_id,
                    "tradeId": _trade_id(trade),
                    "amount": trade.get("tradeAmount") or "0.00",
                    "amountNumber": trade.get("tradeAmountNumber") or 0,
                    "confirmAmount": trade.get("confirmAmount") or "0.00",
                    "confirmAmountNumber": trade.get("confirmAmountNumber") or 0,
                    "flowStatus": trade.get("flowStatus") or "",
                    "flowStatusText": trade.get("flowStatusText") or "",
                    "fileName": trade.get("fileName") or "",
                }
            )
        return {"nodes": list(nodes.values()), "edges": edges}

    @staticmethod
    def _build_warnings(
        stats: dict[str, int],
        *,
        victim_cards: list[str],
        victim_names: list[str],
        suspect_cards: list[str],
        suspect_names: list[str],
        source_mode: str = "",
    ) -> list[str]:
        warnings: list[str] = []
        if source_mode == AUDIT_SOURCE_RECOGNIZED:
            warnings.append("本轮以上一层已认定金额作为资金池起点，继续按原版规则追踪该账号向下级转出的最低可认定金额。")
        elif not victim_cards and not victim_names:
            warnings.append("缺少被害人条件，涉诈资金审计需要以被害人入账作为追踪起点。")
        if not suspect_cards and not suspect_names:
            warnings.append("未限定嫌疑人条件，本次按发现模式从被害人资金链的出账端识别候选嫌疑人，最终认定需由办案人员核验。")
        if stats.get("balance_missing_count", 0) > 0:
            warnings.append(
                f"有 {stats['balance_missing_count']} 笔嫌疑人出账缺少转出后余额，原版算法无法计算可认定金额，已按原规则跳过。"
            )
        if stats.get("unknown_direction_count", 0) > 0:
            warnings.append(f"有 {stats['unknown_direction_count']} 笔流水的借贷标识不是“借/贷”，未进入原版审计分组。")
        if stats.get("missing_group_card_count", 0) > 0:
            warnings.append(f"有 {stats['missing_group_card_count']} 笔流水缺少用于分组的交易账号，未进入原版审计分组。")
        return warnings
