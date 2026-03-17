import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlparse

import pandas as pd
import requests
from gspread_pandas import Spread


REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = REPO_ROOT / ".env.local"

DEFAULT_SPREADSHEET_KEY = "104iQDWPH91r24qiYZX27NfPRjma3RrEv01-g-PZRGzA"
DEFAULT_SHEET_NAME = "QuizTemplate"

RESOURCE_TYPE = "quiz_template"
RESOURCE_SUBTYPE = "Quiz Template"
RESOURCE_SOURCE = "cms"

REQUIRED_COLUMNS = [
    "test_name",
    "grade",
    "course",
    "stream",
    "test_format",
    "test_purpose",
    "test_type",
    "optional_limits",
    "test_code",
    "cms_link",
    "question_pdf",
    "solution_pdf",
    "ranking_cutoff_date",
]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env(ENV_PATH)
os.environ.setdefault("GSPREAD_PANDAS_CONFIG_DIR", ".")


def require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def normalize_header(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def clean_cell(value: Any, default: str = "") -> Any:
    if value is None:
        return default
    if isinstance(value, float) and pd.isna(value):
        return default
    if pd.isna(value):
        return default
    if isinstance(value, str):
        return value.strip()
    return value


def normalize_grade(value: Any, test_code: str) -> int:
    raw = clean_cell(value, "")
    if raw == "":
        raise ValueError(f"Missing grade for test_code={test_code}")

    try:
        return int(float(str(raw)))
    except ValueError as exc:
        raise ValueError(f"Invalid grade '{raw}' for test_code={test_code}") from exc


def normalize_date(value: Any) -> str:
    raw = clean_cell(value, "")
    if raw == "":
        return ""

    if isinstance(raw, pd.Timestamp):
        return raw.strftime("%Y-%m-%d")
    if isinstance(raw, (datetime, date)):
        return raw.strftime("%Y-%m-%d")

    text = str(raw).strip()
    if not text:
        return ""

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(text).strftime("%Y-%m-%d")
    except ValueError:
        return text


def extract_cms_test_id(cms_link: str, test_code: str) -> str:
    parsed = urlparse(cms_link)
    segments = [segment for segment in parsed.path.split("/") if segment]
    if not segments:
        raise ValueError(f"Could not extract cms_test_id for test_code={test_code}")
    return segments[-1]


def load_sheet_dataframe(spreadsheet_key: str, sheet_name: str) -> pd.DataFrame:
    spread = Spread(spreadsheet_key)
    df = spread.sheet_to_df(sheet=sheet_name, header_rows=1, index=0)
    df = df.rename(columns=lambda col: normalize_header(col))
    df = df.reset_index().rename(columns={df.index.name or "index": "sheet_row_no"})

    if "sheet_row_no" not in df.columns:
        df["sheet_row_no"] = [str(i + 1) for i in range(len(df))]

    missing = [column for column in REQUIRED_COLUMNS if column not in df.columns]
    if missing:
        raise RuntimeError(f"Missing required sheet columns: {', '.join(missing)}")

    return df


def build_resource_payload(row: dict[str, Any], sheet_name: str) -> dict[str, Any]:
    test_code = str(clean_cell(row.get("test_code", ""), "")).strip()
    if not test_code:
        raise ValueError("Missing test_code")

    test_name = str(clean_cell(row.get("test_name", ""), "")).strip()
    if not test_name:
        raise ValueError(f"Missing test_name for test_code={test_code}")

    cms_link = str(clean_cell(row.get("cms_link", ""), "")).strip()
    if not cms_link:
        raise ValueError(f"Missing cms_link for test_code={test_code}")

    payload = {
        "name": [{"resource": test_name, "lang_code": "en"}],
        "type": RESOURCE_TYPE,
        "subtype": RESOURCE_SUBTYPE,
        "source": RESOURCE_SOURCE,
        "code": test_code,
        "type_params": {
            "sheet_row_no": str(clean_cell(row.get("sheet_row_no", ""), "")),
            "sheet_name": sheet_name,
            "test_name": test_name,
            "grade": normalize_grade(row.get("grade"), test_code),
            "course": str(clean_cell(row.get("course", ""), "")),
            "stream": str(clean_cell(row.get("stream", ""), "")),
            "test_format": str(clean_cell(row.get("test_format", ""), "")),
            "test_purpose": str(clean_cell(row.get("test_purpose", ""), "")),
            "test_type": str(clean_cell(row.get("test_type", ""), "")),
            "optional_limits": str(clean_cell(row.get("optional_limits", ""), "")),
            "test_code": test_code,
            "src_link": cms_link,
            "cms_link": cms_link,
            "cms_test_id": extract_cms_test_id(cms_link, test_code),
            "question_pdf": str(clean_cell(row.get("question_pdf", ""), "")),
            "solution_pdf": str(clean_cell(row.get("solution_pdf", ""), "")),
            "ranking_cutoff_date": normalize_date(row.get("ranking_cutoff_date")),
            "is_active": True,
        },
    }
    return payload


class DbServiceClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "accept": "application/json",
            }
        )

    def get_resource_by_code(self, code: str) -> Optional[dict[str, Any]]:
        response = self.session.get(f"{self.base_url}/resource?code={quote(code)}", timeout=30)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list):
            return payload[0] if payload else None
        return payload

    def create_resource(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(f"{self.base_url}/resource", json=payload, timeout=30)
        response.raise_for_status()
        return response.json()

    def update_resource(self, resource_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.patch(
            f"{self.base_url}/resource/{resource_id}",
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()


def upsert_resource(client: DbServiceClient, payload: dict[str, Any]) -> str:
    code = payload["code"]
    existing = client.get_resource_by_code(code)
    if not existing:
        created = client.create_resource(payload)
        return f"created resource_id={created['id']} code={code}"

    if existing.get("type") != RESOURCE_TYPE:
        raise RuntimeError(
            f"Existing resource code={code} has type={existing.get('type')}, "
            f"expected {RESOURCE_TYPE}"
        )

    updated = client.update_resource(existing["id"], payload)
    return f"updated resource_id={updated['id']} code={code}"


def main() -> None:
    spreadsheet_key = os.getenv("ASSESSMENT_TEMPLATE_SHEET_KEY", DEFAULT_SPREADSHEET_KEY)
    sheet_name = os.getenv("ASSESSMENT_TEMPLATE_SHEET_NAME", DEFAULT_SHEET_NAME)

    client = DbServiceClient(
        require_env("DB_SERVICE_URL"),
        require_env("DB_SERVICE_TOKEN"),
    )

    df = load_sheet_dataframe(spreadsheet_key, sheet_name)

    created_or_updated = 0
    skipped = 0

    for _, row in df.iterrows():
        row_dict = row.to_dict()
        test_name = str(clean_cell(row_dict.get("test_name", ""), ""))
        test_code = str(clean_cell(row_dict.get("test_code", ""), ""))
        if not test_name and not test_code:
            skipped += 1
            continue

        payload = build_resource_payload(row_dict, sheet_name)
        result = upsert_resource(client, payload)
        created_or_updated += 1
        print(result)

    print(f"done. upserted={created_or_updated} skipped_blank_rows={skipped}")


if __name__ == "__main__":
    main()
