from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

from update_bf6_weapons import (
    BASE_DIR,
    CATEGORY_MAP,
    fetch_source_json,
    is_weapon_entry,
    sanitize_filename,
    write_json,
)


IMAGE_BASE_URL = "https://sym.gg/legacy/pages/bf6/img"
PREFERRED_EXTENSIONS = (".avif", ".webp", ".png")
MANAGED_IMAGE_EXTENSIONS = set(PREFERRED_EXTENSIONS) | {".jpg", ".jpeg"}
MANAGED_DIRS = set(CATEGORY_MAP.values()) | {"Unknown"}
SUMMARY_FILE = BASE_DIR / "image_export_summary.json"


def node_head_status(url: str) -> tuple[int, str]:
    node_script = (
        "fetch(process.argv[1], { method: 'HEAD' })"
        ".then((response) => {"
        "  console.log(String(response.status));"
        "  console.log(response.headers.get('content-type') || '');"
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
        stderr = result.stderr.strip() or "unknown node HEAD error"
        raise RuntimeError(stderr)

    lines = [line.strip() for line in result.stdout.splitlines()]
    if not lines:
        raise RuntimeError("Empty response while checking image URL")

    status = int(lines[0])
    content_type = lines[1] if len(lines) > 1 else ""
    return status, content_type


def node_download_file(url: str, destination) -> None:
    node_script = (
        "const fs = require('node:fs');"
        "fetch(process.argv[1])"
        ".then(async (response) => {"
        "  if (!response.ok) {"
        "    throw new Error(`HTTP ${response.status} ${response.statusText}`);"
        "  }"
        "  const buffer = Buffer.from(await response.arrayBuffer());"
        "  fs.writeFileSync(process.argv[2], buffer);"
        "})"
        ".catch((error) => {"
        "  console.error(String(error));"
        "  process.exit(1);"
        "});"
    )
    result = subprocess.run(
        ["node", "-e", node_script, url, str(destination)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or "unknown node download error"
        raise RuntimeError(stderr)


def clean_managed_images() -> None:
    for directory_name in MANAGED_DIRS:
        target_dir = BASE_DIR / directory_name
        if not target_dir.exists():
            continue

        for file_path in target_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in MANAGED_IMAGE_EXTENSIONS:
                file_path.unlink()

    if SUMMARY_FILE.exists():
        SUMMARY_FILE.unlink()


def resolve_category(raw_class: Any) -> str:
    if isinstance(raw_class, str):
        return CATEGORY_MAP.get(raw_class.strip(), "Unknown")
    return "Unknown"


def resolve_image_url(codename: str) -> tuple[str | None, str | None]:
    for extension in PREFERRED_EXTENSIONS:
        url = f"{IMAGE_BASE_URL}/{codename}{extension}"
        status, _ = node_head_status(url)
        if status == 200:
            return url, extension
    return None, None


def export_weapon_images(source_data: dict[str, Any]) -> dict[str, Any]:
    clean_managed_images()

    weapons = [entry for entry in source_data.values() if is_weapon_entry(entry)]
    exported_at = datetime.now(timezone.utc).isoformat()
    summary: dict[str, Any] = {
        "source_url": IMAGE_BASE_URL,
        "exported_at": exported_at,
        "total_weapons": len(weapons),
        "downloaded_images": 0,
        "missing_images": [],
        "categories": {},
    }

    for entry in weapons:
        category = resolve_category(entry.get("class"))
        category_dir = BASE_DIR / category
        category_dir.mkdir(parents=True, exist_ok=True)

        image_url, extension = resolve_image_url(entry["codename"])
        if not image_url or not extension:
            summary["missing_images"].append(
                {
                    "codename": entry["codename"],
                    "displayname": entry["displayname"],
                    "category": category,
                }
            )
            continue

        file_name = f"{sanitize_filename(entry['displayname'])}{extension}"
        destination = category_dir / file_name
        node_download_file(image_url, destination)

        summary["downloaded_images"] += 1
        summary["categories"].setdefault(category, []).append(
            {
                "codename": entry["codename"],
                "displayname": entry["displayname"],
                "file": str(destination.relative_to(BASE_DIR)),
                "image_url": image_url,
            }
        )

    for category in sorted(summary["categories"]):
        summary["categories"][category].sort(key=lambda item: item["displayname"].casefold())

    summary["missing_images"].sort(key=lambda item: item["displayname"].casefold())
    write_json(SUMMARY_FILE, summary)
    return summary


def print_summary(summary: dict[str, Any]) -> None:
    print(f"Downloaded {summary['downloaded_images']} images.")
    for category in sorted(summary["categories"]):
        print(f"{category}: {len(summary['categories'][category])}")
    if summary["missing_images"]:
        print(f"Missing: {len(summary['missing_images'])}")


def main() -> int:
    try:
        source_data = fetch_source_json("https://sym.gg/legacy/pages/bf6/data/bf6.json")
        summary = export_weapon_images(source_data)
        print_summary(summary)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to update BF6 weapon images: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
