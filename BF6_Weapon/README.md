# BF6 Weapon Updater

This folder stores Battlefield 6 weapon data and images exported from Sym.gg.

## Structure

- Python scripts: `BF6_Weapon\python`
- Local virtual environment: `BF6_Weapon\.venv`
- Exported weapon folders: `AR`, `SMG`, `MG`, `DMR`, `Carbine`, `BoltAction`, `Shotgun`, `Secondary`

## Commands

Run from `BF6_Weapon\python`:

```powershell
..\.venv\Scripts\python.exe .\update_bf6_weapons.py
..\.venv\Scripts\python.exe .\update_bf6_weapon_images.py
..\.venv\Scripts\python.exe .\update_bf6_weapon_ttk.py
..\.venv\Scripts\python.exe .\update_all.py
```

## What gets written

- Weapon JSON files are recreated in each category folder as `weapon-name.json`
- Weapon images are recreated in each category folder as `weapon-name.avif`, `weapon-name.webp`, or `weapon-name.png`
- TTK sheet JSON files are written as `weapon-name_ttk.json`
- `export_summary.json`
- `image_export_summary.json`
- `ttk_sheet_export_summary.json`
- `raw_bf6_source.json`

## Notes

- The scripts always write output to the parent `BF6_Weapon` folder, even when run inside `python`
- The local `.venv` is a portable Python copy because the machine's available Python build does not provide standard `venv`
- If direct Python HTTPS fails in this environment, the JSON fetch automatically falls back to Node.js
- Weapon images are checked in this order: `.avif` -> `.webp` -> `.png`
- The TTK updater reads the shared Google Sheet URL and pulls AR, Carbine, MG, and SMG tabs by their current sheet `gid`
- The TTK updater also mirrors written `_ttk.json` files into `BF6_Weapon\homepsage\data` for the GitHub Pages site
