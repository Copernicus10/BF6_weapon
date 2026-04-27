from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


SOURCE_URL = "https://sym.gg/legacy/pages/bf6/data/bf6.json"
PYTHON_DIR = Path(__file__).resolve().parent
BASE_DIR = PYTHON_DIR.parent

CATEGORY_MAP = {
    "assaultrifle": "AR",
    "smg": "SMG",
    "shotgun": "Shotgun",
    "mg": "MG",
    "dmr": "DMR",
    "carbine": "Carbine",
    "boltaction": "BoltAction",
    "secondary": "Secondary",
}

MANAGED_DIRS = set(CATEGORY_MAP.values()) | {"Unknown"}
SUMMARY_FILE = BASE_DIR / "export_summary.json"
RAW_SOURCE_FILE = BASE_DIR / "raw_bf6_source.json"


def fetch_source_json(url: str) -> dict[str, Any]:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; BF6WeaponUpdater/1.0)",
            "Accept": "application/json",
        },
    )
    opener = build_opener(ProxyHandler({}))

    try:
        with opener.open(request, timeout=30) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            payload = response.read().decode(charset)
    except HTTPError as exc:
        raise RuntimeError(f"HTTP error while fetching source JSON: {exc.code} {exc.reason}") from exc
    except URLError as exc:
        try:
            return fetch_source_json_with_node(url)
        except Exception as fallback_exc:  # noqa: BLE001
            raise RuntimeError(
                f"Network error while fetching source JSON: {exc.reason}; "
                f"Node fallback failed: {fallback_exc}"
            ) from exc

    data = json.loads(payload)
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected source JSON structure: root is not an object")
    return data


def fetch_source_json_with_node(url: str) -> dict[str, Any]:
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

    data = json.loads(result.stdout)
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected source JSON structure from Node fallback: root is not an object")
    return data


def is_weapon_entry(entry: Any) -> bool:
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("codename"), str)
        and bool(entry["codename"].strip())
        and isinstance(entry.get("displayname"), str)
        and bool(entry["displayname"].strip())
    )


def sanitize_filename(name: str) -> str:
    invalid_chars = '<>:"/\\|?*'
    sanitized = "".join("_" if ch in invalid_chars or ord(ch) < 32 else ch for ch in name)
    sanitized = " ".join(sanitized.split()).rstrip(". ")
    return sanitized or "unknown_weapon"


def normalize_weapon(entry: dict[str, Any], exported_at: str) -> dict[str, Any]:
    raw_class = entry.get("class")
    if isinstance(raw_class, str):
        raw_class = raw_class.strip()
    else:
        raw_class = ""

    category = CATEGORY_MAP.get(raw_class, "Unknown")

    normalized = {
        "source_url": SOURCE_URL,
        "exported_at": exported_at,
        "category": category,
        "source_class": raw_class or None,
    }
    normalized.update(entry)
    return normalized


def clean_managed_outputs() -> None:
    for directory_name in MANAGED_DIRS:
        target_dir = BASE_DIR / directory_name
        if target_dir.exists():
            shutil.rmtree(target_dir)

    for file_path in (SUMMARY_FILE, RAW_SOURCE_FILE):
        if file_path.exists():
            file_path.unlink()


def write_json(file_path: Path, payload: Any) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def export_weapons(source_data: dict[str, Any]) -> dict[str, Any]:
    exported_at = datetime.now(timezone.utc).isoformat()
    weapons = [entry for entry in source_data.values() if is_weapon_entry(entry)]
    summary: dict[str, Any] = {
        "source_url": SOURCE_URL,
        "exported_at": exported_at,
        "total_weapons": 0,
        "categories": {},
    }
    used_relative_paths: set[str] = set()

    clean_managed_outputs()
    write_json(RAW_SOURCE_FILE, source_data)

    for entry in weapons:
        weapon = normalize_weapon(entry, exported_at)
        category_dir = BASE_DIR / weapon["category"]
        base_name = sanitize_filename(weapon["displayname"])
        file_name = f"{base_name}.json"
        relative_path = str(Path(weapon["category"]) / file_name).lower()

        if relative_path in used_relative_paths:
            file_name = f"{base_name}_{weapon['codename']}.json"
            relative_path = str(Path(weapon["category"]) / file_name).lower()

        used_relative_paths.add(relative_path)

        file_path = category_dir / file_name
        write_json(file_path, weapon)

        summary["total_weapons"] += 1
        summary["categories"].setdefault(weapon["category"], []).append(
            {
                "codename": weapon["codename"],
                "displayname": weapon["displayname"],
                "file": str(file_path.relative_to(BASE_DIR)),
            }
        )

    for category in sorted(summary["categories"]):
        summary["categories"][category].sort(key=lambda item: item["displayname"].casefold())

    write_json(SUMMARY_FILE, summary)
    return summary


def print_summary(summary: dict[str, Any]) -> None:
    print(f"Exported {summary['total_weapons']} weapons.")
    for category in sorted(summary["categories"]):
        print(f"{category}: {len(summary['categories'][category])}")


def main() -> int:
    try:
        source_data = fetch_source_json(SOURCE_URL)
        summary = export_weapons(source_data)
        print_summary(summary)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to update BF6 weapon data: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
