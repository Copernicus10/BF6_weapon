from __future__ import annotations

import csv
import json
import subprocess
import sys
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


SPREADSHEET_ID = "1MjVBuyM_5N6VRMoUq7S_Ur0CNVKmVMuRLiUvubVnX2E"
SHARE_URL = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit?usp=sharing"

# Verified from the current shared spreadsheet on 2026-04-23.
TARGET_SHEETS = [
    {"category": "AR", "gid": "0"},
    {"category": "Carbine", "gid": "1740585242"},
    {"category": "MG", "gid": "1994224149"},
    {"category": "SMG", "gid": "1546275384"},
]

MANUAL_NAME_ALIASES = {
    "sor556": "SOR-556 MK2",
}

PYTHON_DIR = Path(__file__).resolve().parent
BASE_DIR = PYTHON_DIR.parent
HOMEPAGE_DATA_DIR = BASE_DIR / "homepsage" / "data"
EXPORT_SUMMARY_FILE = BASE_DIR / "export_summary.json"
TTK_SUMMARY_FILE = BASE_DIR / "ttk_sheet_export_summary.json"

SUMMARY_COLUMN_INDEXES = {
    "weapon_name": 0,
    "aim_time_ms": 1,
    "headshot_multiplier": 2,
    "bullet_velocity_mps": 3,
    "rpm": 4,
    "recoil_strength": 5,
    "recoil_variation": 6,
    "damage_start": 7,
    "damage_end": 11,
    "ttk_start": 12,
    "ttk_end": 16,
}


def sheet_csv_url(gid: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export?format=csv&gid={gid}"


def fetch_text(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; BF6WeaponTTKUpdater/1.0)",
            "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.8",
        },
    )
    opener = build_opener(ProxyHandler({}))

    try:
        with opener.open(request, timeout=30) as response:
            payload = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
    except HTTPError as exc:
        raise RuntimeError(f"HTTP error while fetching TTK sheet: {exc.code} {exc.reason}") from exc
    except URLError as exc:
        try:
            return fetch_text_with_node(url)
        except Exception as fallback_exc:  # noqa: BLE001
            raise RuntimeError(
                f"Network error while fetching TTK sheet: {exc.reason}; "
                f"Node fallback failed: {fallback_exc}"
            ) from exc

    return payload.decode(charset, errors="replace")


def fetch_text_with_node(url: str) -> str:
    node_script = (
        "fetch(process.argv[1])"
        ".then(async (response) => {"
        "  if (!response.ok) {"
        "    throw new Error(`HTTP ${response.status} ${response.statusText}`);"
        "  }"
        "  process.stdout.write(await response.text());"
        "})"
        ".catch((error) => {"
        "  console.error(String(error));"
        "  process.exit(1);"
        "});"
    )

    result = subprocess.run(
        ["node", "-e", node_script, url],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or "unknown node error"
        raise RuntimeError(stderr)
    return result.stdout


def write_json(file_path: Path, payload: Any) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def parse_number(value: str) -> int | float | None:
    text = value.strip()
    if not text:
        return None
    number = float(text)
    if number.is_integer():
        return int(number)
    return number


def normalize_name(value: str) -> str:
    return "".join(ch.lower() for ch in value if ch.isalnum())


def csv_cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) else ""


def load_weapon_manifest() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not EXPORT_SUMMARY_FILE.exists():
        raise RuntimeError("export_summary.json was not found. Run update_bf6_weapons.py first.")

    summary = json.loads(EXPORT_SUMMARY_FILE.read_text(encoding="utf-8"))
    categories = summary.get("categories")
    if not isinstance(categories, dict):
        raise RuntimeError("export_summary.json has an unexpected structure.")

    manifest: dict[str, dict[str, Any]] = {}
    for category, items in categories.items():
        if not isinstance(items, list):
            continue

        for item in items:
            if not isinstance(item, dict):
                continue

            displayname = str(item.get("displayname") or "").strip()
            relative_file = str(item.get("file") or "").replace("\\", "/").strip()
            if not displayname or not relative_file:
                continue

            source_path = Path(relative_file)
            record = {
                "category": category,
                "displayname": displayname,
                "codename": item.get("codename"),
                "source_file": relative_file,
                "source_stem": source_path.stem,
                "ttk_path": Path(category) / f"{source_path.stem}_ttk.json",
            }

            for alias in {displayname, source_path.stem, str(item.get("codename") or "")}:
                alias = alias.strip()
                if alias:
                    manifest.setdefault(normalize_name(alias), record)

    for alias, target_name in MANUAL_NAME_ALIASES.items():
        target_record = manifest.get(normalize_name(target_name))
        if target_record:
            manifest.setdefault(normalize_name(alias), target_record)

    return manifest, summary


def parse_summary_row(header: list[str], row: list[str]) -> dict[str, Any]:
    damage_by_range = []
    ttk_by_range = []

    for index in range(SUMMARY_COLUMN_INDEXES["damage_start"], SUMMARY_COLUMN_INDEXES["damage_end"] + 1):
      damage_by_range.append(
            {
                "label": csv_cell(header, index),
                "damage": parse_number(csv_cell(row, index)),
            }
        )

    for index in range(SUMMARY_COLUMN_INDEXES["ttk_start"], SUMMARY_COLUMN_INDEXES["ttk_end"] + 1):
        ttk_by_range.append(
            {
                "label": csv_cell(header, index),
                "ttk_ms": parse_number(csv_cell(row, index)),
            }
        )

    return {
        "weapon_name": csv_cell(row, SUMMARY_COLUMN_INDEXES["weapon_name"]),
        "aim_time_ms": parse_number(csv_cell(row, SUMMARY_COLUMN_INDEXES["aim_time_ms"])),
        "headshot_multiplier": csv_cell(row, SUMMARY_COLUMN_INDEXES["headshot_multiplier"]),
        "headshot_multiplier_value": parse_number(
            csv_cell(row, SUMMARY_COLUMN_INDEXES["headshot_multiplier"]).removeprefix("x")
        ),
        "bullet_velocity_mps": parse_number(csv_cell(row, SUMMARY_COLUMN_INDEXES["bullet_velocity_mps"])),
        "rpm": parse_number(csv_cell(row, SUMMARY_COLUMN_INDEXES["rpm"])),
        "recoil_strength": parse_number(csv_cell(row, SUMMARY_COLUMN_INDEXES["recoil_strength"])),
        "recoil_variation": parse_number(csv_cell(row, SUMMARY_COLUMN_INDEXES["recoil_variation"])),
        "damage_by_range": damage_by_range,
        "ttk_by_range": ttk_by_range,
    }


def parse_detail_sections(rows: list[list[str]], start_index: int) -> dict[str, list[dict[str, Any]]]:
    detail_map: dict[str, list[dict[str, Any]]] = {}
    index = start_index

    while index < len(rows):
        row = rows[index]
        if not any(cell.strip() for cell in row):
            index += 1
            continue

        starts = [column for column, cell in enumerate(row) if cell.strip() == "거리"]
        if not starts:
            index += 1
            continue

        block_rows: list[list[str]] = []
        cursor = index + 1
        while cursor < len(rows) and any(cell.strip() for cell in rows[cursor]):
            block_rows.append(rows[cursor])
            cursor += 1

        for start in starts:
            weapon_name = csv_cell(row, start + 1)
            if not weapon_name:
                continue

            entries: list[dict[str, Any]] = []
            for block_row in block_rows:
                distance = parse_number(csv_cell(block_row, start))
                ttk_ms = parse_number(csv_cell(block_row, start + 1))
                average_ttk_ms = parse_number(csv_cell(block_row, start + 2))
                if distance is None and ttk_ms is None and average_ttk_ms is None:
                    continue
                entries.append(
                    {
                        "distance_m": distance,
                        "ttk_ms": ttk_ms,
                        "average_ttk_ms": average_ttk_ms,
                    }
                )

            detail_map[weapon_name] = entries

        index = cursor + 1

    return detail_map


def parse_ttk_sheet(csv_text: str) -> dict[str, dict[str, Any]]:
    rows = list(csv.reader(StringIO(csv_text)))
    if not rows:
        raise RuntimeError("The TTK sheet is empty.")

    header_index = next((idx for idx, row in enumerate(rows) if any(cell.strip() for cell in row)), None)
    if header_index is None:
        raise RuntimeError("The TTK sheet does not contain a header row.")

    header = [cell.strip() for cell in rows[header_index]]
    summary_rows: dict[str, dict[str, Any]] = {}

    index = header_index + 1
    while index < len(rows) and any(cell.strip() for cell in rows[index]):
        parsed = parse_summary_row(header, rows[index])
        weapon_name = str(parsed["weapon_name"]).strip()
        if weapon_name:
            summary_rows[weapon_name] = parsed
        index += 1

    detail_rows = parse_detail_sections(rows, index)
    parsed_weapons: dict[str, dict[str, Any]] = {}
    for weapon_name, summary in summary_rows.items():
        parsed_weapons[weapon_name] = {
            "summary": summary,
            "distance_ttk": detail_rows.get(weapon_name, []),
        }

    return parsed_weapons


def load_previous_written_files(summary_key: str, base_dir: Path) -> list[Path]:
    if not TTK_SUMMARY_FILE.exists():
        return []

    try:
        previous_summary = json.loads(TTK_SUMMARY_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    file_entries = previous_summary.get(summary_key)
    if not isinstance(file_entries, list):
        return []

    previous_files = []
    for entry in file_entries:
        if not isinstance(entry, str):
            continue
        candidate = base_dir / Path(entry.replace("\\", "/"))
        try:
            candidate.resolve().relative_to(base_dir.resolve())
        except ValueError:
            continue
        previous_files.append(candidate)
    return previous_files


def clean_previous_outputs() -> None:
    for file_path in load_previous_written_files("written_files", BASE_DIR):
        if file_path.exists():
            file_path.unlink()

    for file_path in load_previous_written_files("homepage_written_files", HOMEPAGE_DATA_DIR):
        if file_path.exists():
            file_path.unlink()


def export_ttk_json() -> dict[str, Any]:
    manifest, export_summary = load_weapon_manifest()
    exported_at = datetime.now(timezone.utc).isoformat()

    clean_previous_outputs()

    result_summary: dict[str, Any] = {
        "source_share_url": SHARE_URL,
        "spreadsheet_id": SPREADSHEET_ID,
        "exported_at": exported_at,
        "target_sheets": TARGET_SHEETS,
        "written_files": [],
        "homepage_written_files": [],
        "written_weapons": [],
        "unmatched_weapons": [],
        "sheet_weapon_count": 0,
        "manifest_total_weapons": export_summary.get("total_weapons"),
    }

    for sheet in TARGET_SHEETS:
        csv_text = fetch_text(sheet_csv_url(sheet["gid"]))
        parsed_weapons = parse_ttk_sheet(csv_text)
        result_summary["sheet_weapon_count"] += len(parsed_weapons)

        for weapon_name in sorted(parsed_weapons, key=str.casefold):
            weapon_payload = parsed_weapons[weapon_name]
            match = manifest.get(normalize_name(weapon_name))
            if not match:
                result_summary["unmatched_weapons"].append(
                    {
                        "sheet_category": sheet["category"],
                        "weapon_name": weapon_name,
                        "gid": sheet["gid"],
                    }
                )
                continue

            output_path = BASE_DIR / match["ttk_path"]
            homepage_output_path = HOMEPAGE_DATA_DIR / match["ttk_path"]
            payload = {
                "source_share_url": SHARE_URL,
                "source_csv_url": sheet_csv_url(sheet["gid"]),
                "spreadsheet_id": SPREADSHEET_ID,
                "sheet_gid": sheet["gid"],
                "sheet_category": sheet["category"],
                "exported_at": exported_at,
                "weapon_name": weapon_name,
                "matched_weapon": {
                    "displayname": match["displayname"],
                    "category": match["category"],
                    "codename": match["codename"],
                    "source_file": match["source_file"],
                    "ttk_file": str(match["ttk_path"]).replace("/", "\\"),
                },
                "summary": weapon_payload["summary"],
                "distance_ttk": weapon_payload["distance_ttk"],
            }

            write_json(output_path, payload)
            write_json(homepage_output_path, payload)

            relative_output = str(output_path.relative_to(BASE_DIR))
            relative_homepage_output = str(homepage_output_path.relative_to(HOMEPAGE_DATA_DIR))
            result_summary["written_files"].append(relative_output)
            result_summary["homepage_written_files"].append(relative_homepage_output)
            result_summary["written_weapons"].append(
                {
                    "sheet_category": sheet["category"],
                    "weapon_name": weapon_name,
                    "category": match["category"],
                    "file": relative_output,
                }
            )

    write_json(TTK_SUMMARY_FILE, result_summary)
    return result_summary


def print_summary(summary: dict[str, Any]) -> None:
    print(f"Sheet weapons: {summary['sheet_weapon_count']}")
    print(f"Written TTK files: {len(summary['written_files'])}")
    if summary["unmatched_weapons"]:
        print("Unmatched weapons:")
        for item in summary["unmatched_weapons"]:
            print(f"- {item['sheet_category']}: {item['weapon_name']} (gid={item['gid']})")


def main() -> int:
    try:
        summary = export_ttk_json()
        print_summary(summary)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to update BF6 TTK sheet data: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
