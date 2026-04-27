from __future__ import annotations

import sys

from update_bf6_weapon_images import export_weapon_images, print_summary as print_image_summary
from update_bf6_weapons import SOURCE_URL, export_weapons, fetch_source_json, print_summary as print_weapon_summary


def main() -> int:
    try:
        source_data = fetch_source_json(SOURCE_URL)

        weapon_summary = export_weapons(source_data)
        print_weapon_summary(weapon_summary)
        print("")

        image_summary = export_weapon_images(source_data)
        print_image_summary(image_summary)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to update BF6 weapon data and images: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
