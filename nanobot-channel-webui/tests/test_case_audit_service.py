from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import pytest


SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from nanobot_channel_webui.case_audit.service import CaseAuditService


class FakeAuditQueryClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.query_payloads: list[dict[str, Any]] = []

    def list_cases(self) -> list[dict[str, Any]]:
        return [{"id": "37", "caseName": "测试案件"}]

    def case_audit_overview(self, case_id: str) -> dict[str, Any]:
        return {
            "tradeCount": len(self.rows),
            "sourceFileCount": len({row.get("file_id") for row in self.rows if row.get("file_id")}),
            "balanceMissingCount": 0,
            "minTradeTime": "",
            "maxTradeTime": "",
            "totalTradeAmount": "0",
        }

    def query_case_audit_trades(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self.query_payloads.append(payload)
        return self.rows


def _ppt_trade(
    trade_id: str,
    *,
    amount: str,
    jd_flag: str,
    trade_time: str,
    payer_name: str,
    payer_card: str,
    payee_name: str,
    payee_card: str,
    payer_balance: str | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": trade_id,
        "file_id": "ppt-baseline",
        "file_name": "审计算法流程.pptx",
        "trade_amount": amount,
        "trade_time": trade_time,
        "jd_flag": jd_flag,
        "payer_account_name": payer_name,
        "payer_trade_card": payer_card,
        "payee_account_name": payee_name,
        "payee_trade_card": payee_card,
    }
    if payer_balance is not None:
        row["payer_trade_balance"] = payer_balance
    return row


def test_case_audit_requires_victim_condition() -> None:
    client = FakeAuditQueryClient([])
    service = CaseAuditService(client)

    with pytest.raises(ValueError) as exc:
        service.run_case_audit({"caseId": "37"})

    assert exc.value.args[0] == "victimCondition"
    assert client.query_payloads == []


def test_case_audit_uses_legacy_file_algorithm_across_case_files() -> None:
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                {
                    "id": "in-1",
                    "file_id": "file-a",
                    "file_name": "被害人流水.xlsx",
                    "trade_amount": "100",
                    "trade_time": "2024-01-01 10:00:00",
                    "jd_flag": "贷",
                    "payer_account_name": "被害人甲",
                    "payer_trade_card": "V1",
                    "payee_account_name": "中转账户",
                    "payee_trade_card": "A1",
                },
                {
                    "id": "out-1",
                    "file_id": "file-b",
                    "file_name": "嫌疑人流水.xlsx",
                    "trade_amount": "80",
                    "trade_time": "2024-01-02 10:00:00",
                    "jd_flag": "借",
                    "payer_account_name": "中转账户",
                    "payer_trade_card": "A1",
                    "payer_trade_balance": "20",
                    "payee_account_name": "嫌疑人X",
                    "payee_trade_card": "S1",
                },
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "37",
            "victimCards": ["V1"],
            "suspectCards": ["S1"],
        }
    )

    assert result["summary"]["sourceFileCount"] == 2
    assert result["summary"]["confirmAmount"] == "80.00"
    assert result["summary"]["caseAmount"] == "80.00"
    assert result["summary"]["fraudAmount"] == "100.00"
    assert result["summary"]["recognizedTradeCount"] == 2
    assert result["suspectResults"] == [
        {
            "suspectName": "嫌疑人X",
            "suspectCard": "S1",
            "confirmAmount": "80.00",
            "confirmAmountNumber": 80.0,
            "caseAmount": "80.00",
            "caseAmountNumber": 80.0,
            "fraudAmount": "100.00",
            "fraudAmountNumber": 100.0,
            "tradeIds": ["out-1"],
            "relatedTradeIds": ["in-1"],
            "confirmedRelatedTradeIds": ["in-1"],
            "balanceExcludedTradeIds": [],
            "reasoningStepIds": ["reason:A1:1", "reason:A1:2"],
        }
    ]


def test_case_audit_discovers_suspect_when_suspect_condition_is_empty() -> None:
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                {
                    "id": "in-1",
                    "file_id": "file-a",
                    "file_name": "被害人流水.xlsx",
                    "trade_amount": "100",
                    "trade_time": "2024-01-01 10:00:00",
                    "jd_flag": "贷",
                    "payer_account_name": "被害人甲",
                    "payer_trade_card": "V1",
                    "payee_account_name": "中转账户",
                    "payee_trade_card": "A1",
                },
                {
                    "id": "out-1",
                    "file_id": "file-b",
                    "file_name": "嫌疑人流水.xlsx",
                    "trade_amount": "80",
                    "trade_time": "2024-01-02 10:00:00",
                    "jd_flag": "借",
                    "payer_account_name": "中转账户",
                    "payer_trade_card": "A1",
                    "payer_trade_balance": "20",
                    "payee_account_name": "嫌疑人X",
                    "payee_trade_card": "S1",
                },
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "37",
            "victimCards": ["V1"],
        }
    )

    assert result["summary"]["suspectInputCount"] == 0
    assert result["summary"]["confirmAmount"] == "80.00"
    assert result["suspectResults"][0]["suspectName"] == "嫌疑人X"
    assert "发现模式" in result["quality"]["warnings"][0]


def test_case_audit_preserves_non_suspect_debit_offset_rule() -> None:
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                {
                    "id": "in-1",
                    "file_id": "file-a",
                    "trade_amount": "100",
                    "trade_time": "2024-01-01 10:00:00",
                    "jd_flag": "贷",
                    "payer_account_name": "被害人甲",
                    "payer_trade_card": "V1",
                    "payee_account_name": "中转账户",
                    "payee_trade_card": "A1",
                },
                {
                    "id": "offset-1",
                    "file_id": "file-a",
                    "trade_amount": "120",
                    "trade_time": "2024-01-01 11:00:00",
                    "jd_flag": "借",
                    "payer_account_name": "中转账户",
                    "payer_trade_card": "A1",
                    "payer_trade_balance": "20",
                    "payee_account_name": "普通商户",
                    "payee_trade_card": "N1",
                },
                {
                    "id": "out-1",
                    "file_id": "file-b",
                    "trade_amount": "80",
                    "trade_time": "2024-01-02 10:00:00",
                    "jd_flag": "借",
                    "payer_account_name": "中转账户",
                    "payer_trade_card": "A1",
                    "payer_trade_balance": "0",
                    "payee_account_name": "嫌疑人X",
                    "payee_trade_card": "S1",
                },
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "37",
            "victimCards": ["V1"],
            "suspectCards": ["S1"],
        }
    )

    assert result["summary"]["confirmAmount"] == "0.00"
    assert result["summary"]["caseAmount"] == "0.00"
    assert result["summary"]["recognizedTradeCount"] == 0


def test_case_audit_requires_payer_balance_for_confirm_amount() -> None:
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                {
                    "id": "in-1",
                    "file_id": "file-a",
                    "trade_amount": "100",
                    "trade_time": "2024-01-01 10:00:00",
                    "jd_flag": "贷",
                    "payer_account_name": "被害人甲",
                    "payer_trade_card": "V1",
                    "payee_account_name": "中转账户",
                    "payee_trade_card": "A1",
                },
                {
                    "id": "out-1",
                    "file_id": "file-b",
                    "trade_amount": "80",
                    "trade_time": "2024-01-02 10:00:00",
                    "jd_flag": "借",
                    "payer_account_name": "中转账户",
                    "payer_trade_card": "A1",
                    "payee_account_name": "嫌疑人X",
                    "payee_trade_card": "S1",
                },
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "37",
            "victimCards": ["V1"],
            "suspectCards": ["S1"],
        }
    )

    assert result["summary"]["confirmAmount"] == "0.00"
    assert result["summary"]["balanceMissingCount"] == 1
    assert "缺少转出后余额" in result["quality"]["warnings"][0]


def test_case_audit_matches_ppt_first_slide_cumulative_confirm_amount() -> None:
    # PPT slide 1: 1,899 + 288.88 + 15,000 + 43,776 = 60,963.88;
    # suspect debit balance is 29,036.50, so the minimum confirmable amount is 31,927.38.
    account_card = "6214680070353295"
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                _ppt_trade(
                    "ppt-s1-in-155",
                    amount="1899.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:14:19",
                    payer_name="谢文平",
                    payer_card="6217007200097678836",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-in-152",
                    amount="288.88",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:15:30",
                    payer_name="林洋",
                    payer_card="6228482668427614179",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-in-150",
                    amount="15000.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:16:12",
                    payer_name="张小港",
                    payer_card="6222081107001238467",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-in-149",
                    amount="43776.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:16:28",
                    payer_name="雷华荣",
                    payer_card="6236682280000081064",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-out-144",
                    amount="49900.00",
                    jd_flag="借",
                    trade_time="2021-07-03 10:17:47",
                    payer_name="李再勇",
                    payer_card=account_card,
                    payee_name="王正云",
                    payee_card="6252261010054096",
                    payer_balance="29036.50",
                ),
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "ppt",
            "victimCards": [
                "6217007200097678836",
                "6228482668427614179",
                "6222081107001238467",
                "6236682280000081064",
            ],
            "suspectCards": ["6252261010054096"],
        }
    )

    assert result["summary"]["confirmAmount"] == "31927.38"
    assert result["summary"]["caseAmount"] == "49900.00"
    assert result["summary"]["fraudAmount"] == "60963.88"
    assert result["summary"]["recognizedTradeCount"] == 5
    assert result["suspectResults"][0]["suspectName"] == "王正云"
    assert result["suspectResults"][0]["confirmAmount"] == "31927.38"
    assert result["suspectResults"][0]["fraudAmount"] == "60963.88"
    assert result["suspectResults"][0]["tradeIds"] == ["ppt-s1-out-144"]
    assert result["suspectResults"][0]["relatedTradeIds"] == [
        "ppt-s1-in-155",
        "ppt-s1-in-152",
        "ppt-s1-in-150",
        "ppt-s1-in-149",
    ]
    assert result["suspectResults"][0]["confirmedRelatedTradeIds"] == ["ppt-s1-in-149"]
    assert result["suspectResults"][0]["balanceExcludedTradeIds"] == [
        "ppt-s1-in-155",
        "ppt-s1-in-152",
        "ppt-s1-in-150",
    ]
    trade_statuses = {trade["id"]: trade["flowStatus"] for trade in result["trades"]}
    assert trade_statuses["ppt-s1-in-155"] == "balance_excluded"
    assert trade_statuses["ppt-s1-in-152"] == "balance_excluded"
    assert trade_statuses["ppt-s1-in-150"] == "balance_excluded"
    assert trade_statuses["ppt-s1-in-149"] == "confirmed_flow"
    assert trade_statuses["ppt-s1-out-144"] == "suspect_outflow"


def test_case_audit_matches_ppt_first_slide_second_suspect_branch() -> None:
    # PPT slide 1: 900 + 1,299 + 15,000 + 6,000 = 23,199;
    # suspect debit balance is 208.50, so the minimum confirmable amount is 22,990.50.
    account_card = "6214680070353295"
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                _ppt_trade(
                    "ppt-s1-in-134",
                    amount="900.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:23:59",
                    payer_name="胡淑燕",
                    payer_card="6230520680061846777",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-in-133",
                    amount="1299.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:24:49",
                    payer_name="唐建旭",
                    payer_card="6222034000011897984",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-in-132",
                    amount="15000.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:24:57",
                    payer_name="孙全收",
                    payer_card="6228430716903933473",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-in-135",
                    amount="6000.00",
                    jd_flag="贷",
                    trade_time="2021-07-03 10:23:45",
                    payer_name="黄洋波",
                    payer_card="6228480838176394974",
                    payee_name="李再勇",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s1-out-131",
                    amount="26000.00",
                    jd_flag="借",
                    trade_time="2021-07-03 10:25:42",
                    payer_name="李再勇",
                    payer_card=account_card,
                    payee_name="袁学建",
                    payee_card="6252261010184281",
                    payer_balance="208.50",
                ),
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "ppt",
            "victimCards": [
                "6230520680061846777",
                "6222034000011897984",
                "6228430716903933473",
                "6228480838176394974",
            ],
            "suspectCards": ["6252261010184281"],
        }
    )

    assert result["summary"]["confirmAmount"] == "22990.50"
    assert result["summary"]["caseAmount"] == "26000.00"
    assert result["summary"]["fraudAmount"] == "23199.00"
    assert result["suspectResults"][0]["suspectName"] == "袁学建"
    assert result["suspectResults"][0]["confirmAmount"] == "22990.50"


def test_case_audit_continues_from_prior_recognized_amount_as_next_layer_pool() -> None:
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                _ppt_trade(
                    "ppt-chain-out-1",
                    amount="20000.00",
                    jd_flag="借",
                    trade_time="2021-07-03 10:40:00",
                    payer_name="袁学建",
                    payer_card="6252261010184281",
                    payee_name="下级嫌疑人甲",
                    payee_card="7000000000000001",
                    payer_balance="3000.50",
                ),
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "ppt-chain",
            "sourceMode": "recognized",
            "sourceAccountCards": ["6252261010184281"],
            "sourceAccountNames": ["袁学建"],
            "sourceAmount": "22990.50",
            "sourceLabel": "袁学建 上一层可认定 22,990.50",
            "suspectCards": ["7000000000000001"],
        }
    )

    assert result["summary"]["victimInputCount"] == 0
    assert result["summary"]["sourceInputCount"] == 2
    assert result["summary"]["confirmAmount"] == "19990.00"
    assert result["summary"]["caseAmount"] == "20000.00"
    assert result["summary"]["fraudAmount"] == "22990.50"
    assert result["suspectResults"][0]["suspectName"] == "下级嫌疑人甲"
    assert result["suspectResults"][0]["confirmAmount"] == "19990.00"
    assert result["suspectResults"][0]["fraudAmount"] == "22990.50"
    assert [step["kind"] for step in result["reasoningSteps"]] == ["source_carryover", "suspect_recognition"]
    assert result["quality"]["warnings"][0].startswith("本轮以上一层已认定金额作为资金池起点")


def test_case_audit_matches_ppt_second_slide_worst_case_offsets_without_trade_mapping() -> None:
    # PPT slide 2:
    # 217,199 - 50,000 + 7,588 - 130,900 = 43,887;
    # suspect debit balance is 26,298, so the minimum confirmable amount is 17,589.
    # The PPT notes this can continue reducing the balance but cannot map to a specific case,
    # which matches the legacy behavior where confirmAmount exists but no related credit trade remains.
    account_card = "6214680083993376"
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                _ppt_trade(
                    "ppt-s2-in-217199",
                    amount="217199.00",
                    jd_flag="贷",
                    trade_time="2021-06-29 17:52:56",
                    payer_name="涉诈入账合计",
                    payer_card="VICTIM-S2-A",
                    payee_name="周淌松",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s2-offset-50000",
                    amount="50000.00",
                    jd_flag="借",
                    trade_time="2021-06-29 17:53:43",
                    payer_name="周淌松",
                    payer_card=account_card,
                    payee_name="非本案对象",
                    payee_card="OTHER-S2-A",
                    payer_balance="90990.00",
                ),
                _ppt_trade(
                    "ppt-s2-in-7588",
                    amount="7588.00",
                    jd_flag="贷",
                    trade_time="2021-06-29 17:54:29",
                    payer_name="继续入账",
                    payer_card="VICTIM-S2-B",
                    payee_name="周淌松",
                    payee_card=account_card,
                ),
                _ppt_trade(
                    "ppt-s2-offset-130900",
                    amount="130900.00",
                    jd_flag="借",
                    trade_time="2021-06-29 17:57:24",
                    payer_name="周淌松",
                    payer_card=account_card,
                    payee_name="无法对应具体案件",
                    payee_card="OTHER-S2-B",
                    payer_balance="125000.00",
                ),
                _ppt_trade(
                    "ppt-s2-out-86",
                    amount="49800.00",
                    jd_flag="借",
                    trade_time="2021-06-29 18:00:02",
                    payer_name="周淌松",
                    payer_card=account_card,
                    payee_name="袁学建",
                    payee_card="6252261010184281",
                    payer_balance="26298.00",
                ),
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "ppt",
            "victimCards": ["VICTIM-S2-A", "VICTIM-S2-B"],
            "suspectCards": ["6252261010184281"],
        }
    )

    assert result["summary"]["confirmAmount"] == "17589.00"
    assert result["summary"]["caseAmount"] == "49800.00"
    assert result["summary"]["recognizedTradeCount"] == 0
    assert result["suspectResults"][0]["suspectName"] == "袁学建"
    assert result["suspectResults"][0]["confirmAmount"] == "17589.00"
    assert result["suspectResults"][0]["relatedTradeIds"] == []
    assert [step["kind"] for step in result["reasoningSteps"]] == [
        "victim_credit",
        "worst_case_offset",
        "victim_credit",
        "worst_case_offset",
        "suspect_recognition",
    ]
    assert result["reasoningSteps"][-1]["poolBefore"] == "43887.00"
    assert result["reasoningSteps"][-1]["payerTradeBalance"] == "26298.00"
    assert result["reasoningSteps"][-1]["confirmAmount"] == "17589.00"


def test_case_audit_returns_full_audit_scope_trades_for_evidence_table() -> None:
    service = CaseAuditService(
        FakeAuditQueryClient(
            [
                _ppt_trade(
                    "scope-unrelated",
                    amount="5.00",
                    jd_flag="贷",
                    trade_time="2024-01-01 10:20:00",
                    payer_name="无关人员",
                    payer_card="U1",
                    payee_name="其他账户",
                    payee_card="O1",
                ),
                _ppt_trade(
                    "scope-out-1",
                    amount="80.00",
                    jd_flag="借",
                    trade_time="2024-01-01 10:10:00",
                    payer_name="中转账户",
                    payer_card="A1",
                    payee_name="嫌疑人甲",
                    payee_card="S1",
                    payer_balance="20.00",
                ),
                _ppt_trade(
                    "scope-in-1",
                    amount="100.00",
                    jd_flag="贷",
                    trade_time="2024-01-01 10:00:00",
                    payer_name="被害人甲",
                    payer_card="V1",
                    payee_name="中转账户",
                    payee_card="A1",
                ),
            ]
        )
    )

    result = service.run_case_audit(
        {
            "caseId": "scope",
            "victimCards": ["V1"],
            "suspectCards": ["S1"],
        }
    )

    assert result["summary"]["tradeCount"] == 3
    assert result["summary"]["recognizedTradeCount"] == 2
    assert [trade["id"] for trade in result["trades"]] == ["scope-in-1", "scope-out-1", "scope-unrelated"]
    assert result["trades"][-1]["flowStatus"] == ""
