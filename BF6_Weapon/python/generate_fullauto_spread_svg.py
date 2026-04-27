from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_WEAPON_JSON = BASE_DIR / "AR" / "M433.json"
DEFAULT_OUTPUT = BASE_DIR / "M433_fullauto_spread_ads_10m_20m_30m.svg"
DEFAULT_DISTANCES = (10, 20, 30)
RANDOM_SEED = 433


@dataclass
class ShotImpact:
    shot_number: int
    x_cm: float
    y_cm: float


def load_weapon(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def recoil_stats(weapon: dict) -> tuple[float, float, float]:
    spread = weapon["spread"]
    recoil_amount = spread["ADSRecoilAmount"] * (
        spread["ADSRecoilAmountMultiplier"] ** spread["ADSRecoilAmountMultiplierExponent"]
    )
    recoil_direction = spread["ADSRecoilDirection"]
    recoil_variation = spread["ADSRecoilDirectionVariation"] * (
        spread["ADSRecoilDirectionVariationMultiplier"]
        ** spread["ADSRecoilDirectionVariationMultiplierExponent"]
    )
    return recoil_amount, recoil_direction, recoil_variation


def simulate_impacts(weapon: dict, distance_m: int, seed: int) -> list[ShotImpact]:
    spread = weapon["spread"]
    mag_size = int(weapon["mags"]["MagSize"])
    base_spread_deg = float(spread["ADSStandBaseMin"])
    spread_inc_deg = float(spread["ADSBaseSpreadInc"])
    recoil_amount_deg, recoil_direction_deg, recoil_variation_deg = recoil_stats(weapon)

    rng = random.Random(seed + distance_m)
    center_x_deg = 0.0
    center_y_deg = 0.0
    impacts: list[ShotImpact] = []

    for shot_number in range(1, mag_size + 1):
        recoil_angle_deg = recoil_direction_deg + rng.uniform(-recoil_variation_deg, recoil_variation_deg)
        recoil_angle_rad = math.radians(recoil_angle_deg)

        # Sign convention:
        # negative recoil direction -> spread drifts right
        # positive recoil direction -> spread drifts left
        center_x_deg -= math.sin(recoil_angle_rad) * recoil_amount_deg
        center_y_deg -= math.cos(recoil_angle_rad) * recoil_amount_deg

        current_spread_deg = base_spread_deg + spread_inc_deg * (shot_number - 1)
        spread_radius_deg = math.sqrt(rng.random()) * current_spread_deg
        spread_angle_rad = rng.uniform(0.0, math.tau)

        impact_x_deg = center_x_deg + math.cos(spread_angle_rad) * spread_radius_deg
        impact_y_deg = center_y_deg + math.sin(spread_angle_rad) * spread_radius_deg

        x_cm = math.tan(math.radians(impact_x_deg)) * distance_m * 100.0
        y_cm = math.tan(math.radians(impact_y_deg)) * distance_m * 100.0
        impacts.append(ShotImpact(shot_number=shot_number, x_cm=x_cm, y_cm=y_cm))

    return impacts


def bounds_for_panels(panel_impacts: dict[int, list[ShotImpact]]) -> float:
    max_abs = 0.0
    for impacts in panel_impacts.values():
        for impact in impacts:
            max_abs = max(max_abs, abs(impact.x_cm), abs(impact.y_cm))
    return max(35.0, math.ceil(max_abs / 10.0) * 10.0 + 10.0)


def shot_color(shot_number: int, total_shots: int) -> str:
    ratio = (shot_number - 1) / max(1, total_shots - 1)
    start = (59, 130, 246)
    end = (239, 68, 68)
    rgb = tuple(round(start[i] + (end[i] - start[i]) * ratio) for i in range(3))
    return f"rgb({rgb[0]}, {rgb[1]}, {rgb[2]})"


def svg_header(width: int, height: int) -> str:
    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' "
        f"viewBox='0 0 {width} {height}'>"
    )


def grid_and_labels(cx: float, cy: float, px_per_cm: float, limit_cm: float) -> str:
    parts: list[str] = []
    if limit_cm <= 80:
        ring_step = 10
    elif limit_cm <= 160:
        ring_step = 20
    elif limit_cm <= 400:
        ring_step = 50
    elif limit_cm <= 800:
        ring_step = 100
    else:
        ring_step = 200
    for ring_cm in range(ring_step, int(limit_cm) + 1, ring_step):
        radius_px = ring_cm * px_per_cm
        stroke = "#334155" if ring_cm < limit_cm else "#475569"
        parts.append(
            f"<circle cx='{cx:.1f}' cy='{cy:.1f}' r='{radius_px:.1f}' fill='none' stroke='{stroke}' stroke-width='1'/>"
        )
        parts.append(
            f"<text x='{cx + radius_px + 6:.1f}' y='{cy - 4:.1f}' fill='#94a3b8' font-size='11'>{ring_cm}cm</text>"
        )

    crosshair = [
        f"<line x1='{cx - limit_cm * px_per_cm:.1f}' y1='{cy:.1f}' x2='{cx + limit_cm * px_per_cm:.1f}' y2='{cy:.1f}' stroke='#64748b' stroke-width='1'/>",
        f"<line x1='{cx:.1f}' y1='{cy - limit_cm * px_per_cm:.1f}' x2='{cx:.1f}' y2='{cy + limit_cm * px_per_cm:.1f}' stroke='#64748b' stroke-width='1'/>",
        f"<circle cx='{cx:.1f}' cy='{cy:.1f}' r='3.5' fill='#e2e8f0' stroke='none'/>",
    ]
    parts.extend(crosshair)
    return "".join(parts)


def panel_svg(
    x: int,
    y: int,
    width: int,
    height: int,
    distance_m: int,
    impacts: list[ShotImpact],
    limit_cm: float,
) -> str:
    padding = 28
    title_y = y + 28
    plot_top = y + 56
    plot_height = height - 88
    plot_width = width - padding * 2
    cx = x + width / 2
    cy = plot_top + plot_height / 2
    px_per_cm = min(plot_width, plot_height) / (limit_cm * 2.0)

    parts = [
        f"<rect x='{x}' y='{y}' width='{width}' height='{height}' rx='20' fill='#111827' stroke='#1f2937' stroke-width='2'/>",
        f"<text x='{x + 22}' y='{title_y}' fill='#f8fafc' font-size='22' font-weight='700'>{distance_m}m</text>",
        f"<text x='{x + 22}' y='{title_y + 22}' fill='#94a3b8' font-size='12'>31-shot full-auto, ADS standing, no recoil compensation</text>",
        grid_and_labels(cx, cy, px_per_cm, limit_cm),
    ]

    total_shots = len(impacts)
    for impact in impacts:
        px = cx + impact.x_cm * px_per_cm
        py = cy + impact.y_cm * px_per_cm
        parts.append(
            f"<circle cx='{px:.1f}' cy='{py:.1f}' r='5.2' fill='{shot_color(impact.shot_number, total_shots)}' "
            f"fill-opacity='0.86' stroke='#020617' stroke-width='1.3'/>"
        )
        parts.append(
            f"<text x='{px + 7:.1f}' y='{py - 7:.1f}' fill='#cbd5e1' font-size='10'>{impact.shot_number}</text>"
        )

    return "".join(parts)


def build_svg(weapon: dict, panel_impacts: dict[int, list[ShotImpact]]) -> str:
    width = 1500
    height = 620
    panel_width = 460
    panel_height = 500
    panel_y = 92
    panel_positions = [20, 520, 1020]
    limit_cm = bounds_for_panels(panel_impacts)

    parts = [
        svg_header(width, height),
        "<rect width='100%' height='100%' fill='#020617'/>",
        f"<text x='24' y='42' fill='#f8fafc' font-size='30' font-weight='700'>{weapon['displayname']} Full-Auto Spread Visualization</text>",
        "<text x='24' y='68' fill='#94a3b8' font-size='14'>Based on Sym.gg BF6 stats: ADS standing spread + ADS recoil. Deterministic seed for reproducible output.</text>",
    ]

    for x, distance_m in zip(panel_positions, DEFAULT_DISTANCES):
        parts.append(panel_svg(x, panel_y, panel_width, panel_height, distance_m, panel_impacts[distance_m], limit_cm))

    footer_y = 606
    recoil_amount, recoil_direction, recoil_variation = recoil_stats(weapon)
    parts.append(
        "<text x='24' y='{y}' fill='#94a3b8' font-size='12'>"
        "Assumptions: 31 shots, ADS stand base spread {base:.2f}deg, ADS spread increase {inc:.2f}deg/shot, "
        "ADS recoil {recoil:.3f}deg/shot around {direction:.1f}deg with +/-{variation:.1f}deg variation."
        "</text>".format(
            y=footer_y,
            base=weapon["spread"]["ADSStandBaseMin"],
            inc=weapon["spread"]["ADSBaseSpreadInc"],
            recoil=recoil_amount,
            direction=recoil_direction,
            variation=recoil_variation,
        )
    )
    parts.append("</svg>")
    return "".join(parts)


def main() -> int:
    weapon = load_weapon(DEFAULT_WEAPON_JSON)
    panel_impacts = {
        distance_m: simulate_impacts(weapon, distance_m=distance_m, seed=RANDOM_SEED)
        for distance_m in DEFAULT_DISTANCES
    }
    svg = build_svg(weapon, panel_impacts)
    DEFAULT_OUTPUT.write_text(svg, encoding="utf-8")
    print(DEFAULT_OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
