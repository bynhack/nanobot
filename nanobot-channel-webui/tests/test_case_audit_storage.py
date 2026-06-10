from __future__ import annotations

from pathlib import Path
import sys


SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from nanobot_channel_webui.case_audit.storage import CaseAuditStorage


def test_case_audit_storage_persists_identity_settings_and_last_result(tmp_path: Path) -> None:
    storage = CaseAuditStorage(workspace=tmp_path)

    created = storage.create_audit(
        case_id="37",
        audit_name="第一次金额认定",
        conditions={
            "victimCards": ["V1", "V1"],
            "suspectNames": "嫌疑人甲\n嫌疑人乙",
        },
        filters={"minAmount": "100"},
    )

    assert created["auditName"] == "第一次金额认定"
    assert created["conditions"]["victimCards"] == ["V1"]
    assert created["conditions"]["suspectNames"] == ["嫌疑人甲", "嫌疑人乙"]
    assert created["filters"]["minAmount"] == "100"

    updated = storage.update_audit(
        created["auditId"],
        {
            "caseId": "37",
            "conditions": {"victimNames": ["被害人甲"]},
            "filters": {"startTime": "2024-01-01T00:00"},
        },
    )

    assert updated["conditions"]["victimNames"] == ["被害人甲"]
    assert updated["conditions"]["victimCards"] == []
    assert updated["filters"]["startTime"] == "2024-01-01T00:00"

    after_run = storage.save_run_result(
        created["auditId"],
        run_payload={
            "caseId": "37",
            "victimNames": ["被害人甲"],
            "suspectCards": ["S1"],
            "startTime": "2024-01-01 00:00:00",
        },
        result={
            "summary": {"confirmAmount": "80.00"},
            "suspectResults": [{"suspectName": "嫌疑人甲"}],
            "quality": {"warnings": ["需要人工核验"]},
            "trades": [{"id": "t1"}],
        },
    )

    assert after_run["lastRun"]["summary"]["confirmAmount"] == "80.00"
    assert after_run["lastRun"]["warningCount"] == 1
    assert after_run["lastRun"]["tradeCount"] == 1
    assert Path(after_run["lastRun"]["resultFile"]).exists()
    assert storage.list_audits("37")[0]["auditId"] == created["auditId"]


def test_case_audit_storage_default_file_is_reused(tmp_path: Path) -> None:
    storage = CaseAuditStorage(workspace=tmp_path)

    first = storage.get_or_create_default("1000")
    second = storage.get_or_create_default("1000")

    assert second["auditId"] == first["auditId"]
    assert [item["auditId"] for item in storage.list_audits("1000")] == [first["auditId"]]
