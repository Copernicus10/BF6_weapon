const DATA_ROOT = "../data";
const HOME_CLASSES = ["AR", "Carbine", "SMG", "MG"];
const TTK_CLASSES = ["AR", "Carbine", "SMG", "MG"];
const SPREAD_CLASSES = ["AR", "Carbine", "SMG", "MG"];
const SPREAD_DISTANCES = [10, 20, 30, 40, 50];
const SPREAD_SHOTS = 30;

let manifestCache = null;
const weaponCache = new Map();
const weaponTtkCache = new Map();

export async function fetchManifest() {
  if (manifestCache) {
    return manifestCache;
  }

  const response = await fetch(`${DATA_ROOT}/export_summary.json`);
  if (!response.ok) {
    throw new Error(`Failed to load export_summary.json (${response.status})`);
  }

  manifestCache = await response.json();
  return manifestCache;
}

export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(digits);
}

export function formatDistance(distance) {
  return `${formatNumber(distance, Number.isInteger(distance) ? 0 : 2)}m`;
}

export function getCategoryWeapons(manifest, category) {
  return [...(manifest.categories?.[category] ?? [])];
}

export async function fetchWeaponByFile(category, fileName) {
  const cacheKey = `${category}/${fileName}`;
  if (weaponCache.has(cacheKey)) {
    return weaponCache.get(cacheKey);
  }

  const url = `${DATA_ROOT}/${encodePathSegment(category)}/${encodePathSegment(fileName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load weapon JSON: ${category}/${fileName}`);
  }

  const weapon = await response.json();
  weaponCache.set(cacheKey, weapon);
  return weapon;
}

export async function fetchWeaponTtkByFile(category, fileName) {
  const ttkFileName = fileName.replace(/\.json$/i, "_ttk.json");
  const cacheKey = `${category}/${ttkFileName}`;
  if (weaponTtkCache.has(cacheKey)) {
    return weaponTtkCache.get(cacheKey);
  }

  const url = `${DATA_ROOT}/${encodePathSegment(category)}/${encodePathSegment(ttkFileName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    weaponTtkCache.set(cacheKey, null);
    return null;
  }

  const payload = await response.json();
  weaponTtkCache.set(cacheKey, payload);
  return payload;
}

export function computeExactJsonTtkPoints(weapon) {
  const dmgs = weapon.damage?.dmgs ?? [];
  const dists = weapon.damage?.dists ?? [];
  const rpm = Number(weapon.rof?.RoF);
  if (!Array.isArray(dmgs) || !Array.isArray(dists) || dmgs.length !== dists.length || !rpm) {
    return [];
  }

  const msPerShot = 60000 / rpm;
  return dmgs.map((damage, index) => {
    const bulletsToKill = Math.ceil(100 / Number(damage));
    return {
      distance: Number(dists[index]),
      damage: Number(damage),
      bulletsToKill,
      ttkMs: (bulletsToKill - 1) * msPerShot,
    };
  });
}

export function getMaxDamageDistance(weapon) {
  const dists = weapon.damage?.dists ?? [];
  if (!Array.isArray(dists) || !dists.length) {
    return 0;
  }

  return Math.max(...dists.map((value) => Number(value) || 0));
}

export function buildTtkDistanceSteps(maxDistance) {
  const limit = Math.max(10, Math.ceil(Math.max(maxDistance, 10) / 10) * 10);
  const steps = [];
  for (let distance = 10; distance <= limit; distance += 10) {
    steps.push(distance);
  }
  return steps;
}

export function getDamageAtDistance(weapon, distance) {
  const dmgs = weapon.damage?.dmgs ?? [];
  const dists = weapon.damage?.dists ?? [];
  if (!Array.isArray(dmgs) || !Array.isArray(dists) || dmgs.length !== dists.length || !dmgs.length) {
    return null;
  }

  let resolvedDamage = null;
  for (let index = 0; index < dmgs.length; index += 1) {
    if (Number(dists[index]) <= distance) {
      resolvedDamage = Number(dmgs[index]);
    }
  }

  return resolvedDamage;
}

export function getTtkFromSheetAtDistance(ttkPayload, distance) {
  const numericDistance = Number(distance);
  const distanceRows = ttkPayload?.distance_ttk;

  if (Number.isFinite(numericDistance) && Array.isArray(distanceRows) && distanceRows.length > 0) {
    const exactRow = distanceRows.find((entry) => Number(entry.distance_m) === numericDistance);
    if (exactRow) {
      return {
        distance: numericDistance,
        ttkMs: Number(exactRow.ttk_ms),
        bulletsToKill: null,
        fromSheet: true,
        sourceDistance: Number(exactRow.distance_m),
      };
    }

    // The home card labels 9.5m spreadsheet rows as 10m for UI display.
    const roundedRow = distanceRows.find((entry) => Math.round(Number(entry.distance_m)) === numericDistance);
    if (roundedRow) {
      return {
        distance: numericDistance,
        ttkMs: Number(roundedRow.ttk_ms),
        bulletsToKill: null,
        fromSheet: true,
        sourceDistance: Number(roundedRow.distance_m),
      };
    }
  }

  // Fallback for older payloads that only expose summary.ttk_by_range labels.
  const ranges = ttkPayload?.summary?.ttk_by_range;
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return null;
  }

  // Some sheet exports only keep summary buckets like "<9.5m TTK".
  // The home card displays that breakpoint as "10m", so map rounded labels first.
  for (const entry of ranges) {
    const label = String(entry.label ?? "");
    const ltMatch = label.match(/^<([\d.]+)m/);
    if (!ltMatch) {
      continue;
    }

    const upperBound = Number(ltMatch[1]);
    if (Math.round(upperBound) === numericDistance && upperBound <= numericDistance) {
      return {
        distance: numericDistance,
        ttkMs: Number(entry.ttk_ms),
        bulletsToKill: null,
        fromSheet: true,
        sourceDistance: upperBound,
      };
    }
  }

  let prevBound = 0;
  for (const entry of ranges) {
    const label = String(entry.label ?? "");
    const ltMatch = label.match(/^<([\d.]+)m/);
    const gtMatch = label.match(/^>([\d.]+)m/);

    if (ltMatch) {
      const upperBound = Number(ltMatch[1]);
      if (numericDistance >= prevBound && numericDistance < upperBound) {
        return { distance: numericDistance, ttkMs: Number(entry.ttk_ms), bulletsToKill: null, fromSheet: true };
      }
      prevBound = upperBound;
    } else if (gtMatch) {
      const lowerBound = Number(gtMatch[1]);
      if (numericDistance >= lowerBound) {
        return { distance: numericDistance, ttkMs: Number(entry.ttk_ms), bulletsToKill: null, fromSheet: true };
      }
    }
  }
  return null;
}

export function computeTtkAtDistance(weapon, distance) {
  const rpm = Number(weapon.rof?.RoF);
  const damage = getDamageAtDistance(weapon, distance);
  if (!rpm || !damage) {
    return null;
  }

  const bulletsToKill = Math.ceil(100 / damage);
  return {
    distance,
    damage,
    bulletsToKill,
    ttkMs: (bulletsToKill - 1) * (60000 / rpm),
  };
}

export function sanitizeFileBase(name) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

export function encodePathSegment(segment) {
  return segment
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function buildPictureHtml(category, item) {
  const baseFile = item.file.replace(/\\/g, "/").split("/").pop().replace(/\.json$/i, "");
  const safeCategory = encodePathSegment(category);
  const avif = `${DATA_ROOT}/${safeCategory}/${encodePathSegment(`${baseFile}.avif`)}`;
  const webp = `${DATA_ROOT}/${safeCategory}/${encodePathSegment(`${baseFile}.webp`)}`;
  const png = `${DATA_ROOT}/${safeCategory}/${encodePathSegment(`${baseFile}.png`)}`;

  return `
    <picture>
      <source srcset="${avif}" type="image/avif" />
      <source srcset="${webp}" type="image/webp" />
      <img src="${png}" alt="${escapeHtml(item.displayname)} weapon image" loading="lazy" />
    </picture>
  `;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function resolveEffectiveSpreadInputs(weapon) {
  const spread = weapon.spread ?? {};
  const rof = Number(weapon.rof?.RoF);

  const recoilAmount =
    Number(spread.ADSRecoilAmount) *
    Number(spread.ADSRecoilAmountMultiplier) ** Number(spread.ADSRecoilAmountMultiplierExponent);
  const recoilVariation =
    Number(spread.ADSRecoilDirectionVariation) *
    Number(spread.ADSRecoilDirectionVariationMultiplier) **
      Number(spread.ADSRecoilDirectionVariationMultiplierExponent);

  return {
    adsBaseSpread: Number(spread.ADSStandBaseMin),
    adsBaseMax: Number(spread.ADSStandBaseMax),
    adsSpreadInc: Number(spread.ADSBaseSpreadInc),
    firingDecCoef: Number(spread.ADSBaseSpreadFiringDecCoef),
    firingDecExp: Number(spread.ADSBaseSpreadFiringDecExp),
    firingDecOffset: Number(spread.ADSBaseSpreadFiringDecOffset),
    rpm: Math.round(rof),
    recoilAmount,
    recoilDirection: Number(spread.ADSRecoilDirection),
    recoilVariation,
  };
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let result = Math.imul(t ^ (t >>> 15), 1 | t);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function computeSpreadPerShot(inputs, shots) {
  const { adsBaseSpread, adsBaseMax, adsSpreadInc, firingDecCoef, firingDecExp, firingDecOffset, rpm } =
    inputs;
  const SIM_RATE = 60;
  const frameBetweenShots = rpm > 0 ? (SIM_RATE * 60) / rpm : 0;
  const decayFrames = Math.floor(frameBetweenShots);
  const spreadAtShot = [];
  let spread = Math.max(0, adsBaseSpread);

  for (let shot = 1; shot <= shots; shot += 1) {
    spreadAtShot.push(spread);
    spread = Math.min(Math.max(0, adsBaseMax), spread + Math.max(0, adsSpreadInc));
    for (let frame = 0; frame < decayFrames; frame += 1) {
      const excess = Math.max(0, spread - adsBaseSpread);
      const decrement =
        (1 / SIM_RATE) *
        (Math.max(0, firingDecCoef) * Math.pow(excess, Math.max(0, firingDecExp)) +
          Math.max(0, firingDecOffset));
      spread = Math.max(adsBaseSpread, spread - decrement);
    }
  }

  return spreadAtShot;
}

export function simulateSpreadPanel({ distanceM, shots, inputs, seed }) {
  const random = mulberry32(seed + distanceM * 97);
  let centerXDeg = 0;
  let centerYDeg = 0;
  const impacts = [];
  const recoilCompensation = Math.min(100, Math.max(0, Number(inputs.recoilCompensation ?? 0)));
  const effectiveRecoilAmount = Math.max(inputs.recoilAmount, 0) * (1 - recoilCompensation / 100);

  const spreadAtShot = computeSpreadPerShot(inputs, shots);

  for (let shot = 1; shot <= shots; shot += 1) {
    const recoilAngleDeg =
      inputs.recoilDirection + (random() * 2 - 1) * Math.max(inputs.recoilVariation, 0);
    const recoilAngleRad = (recoilAngleDeg * Math.PI) / 180;

    // Sign convention for the UI:
    // negative recoil direction -> spread drifts right
    // positive recoil direction -> spread drifts left
    centerXDeg -= Math.sin(recoilAngleRad) * effectiveRecoilAmount;
    centerYDeg -= Math.cos(recoilAngleRad) * effectiveRecoilAmount;

    const currentSpreadDeg = spreadAtShot[shot - 1];
    const spreadRadiusDeg = Math.sqrt(random()) * Math.max(currentSpreadDeg, 0);
    const spreadAngle = random() * Math.PI * 2;

    const finalXDeg = centerXDeg + Math.cos(spreadAngle) * spreadRadiusDeg;
    const finalYDeg = centerYDeg + Math.sin(spreadAngle) * spreadRadiusDeg;

    impacts.push({
      shot,
      xCm: Math.tan((finalXDeg * Math.PI) / 180) * distanceM * 100,
      yCm: Math.tan((finalYDeg * Math.PI) / 180) * distanceM * 100,
    });
  }

  return impacts;
}

export function getSpreadBounds(panels) {
  let maxAbs = 0;
  panels.forEach((panel) => {
    panel.forEach((impact) => {
      maxAbs = Math.max(maxAbs, Math.abs(impact.xCm), Math.abs(impact.yCm));
    });
  });
  return Math.max(35, Math.ceil(maxAbs / 10) * 10 + 10);
}

export function getGridStep(limitCm) {
  if (limitCm <= 80) return 10;
  if (limitCm <= 160) return 20;
  if (limitCm <= 400) return 50;
  if (limitCm <= 800) return 100;
  return 200;
}

export function shotColor(index, total) {
  const ratio = total <= 1 ? 0 : index / (total - 1);
  const from = [59, 130, 246];
  const to = [239, 68, 68];
  const rgb = from.map((value, idx) => Math.round(value + (to[idx] - value) * ratio));
  return `rgb(${rgb.join(", ")})`;
}

export { DATA_ROOT, HOME_CLASSES, SPREAD_CLASSES, SPREAD_DISTANCES, SPREAD_SHOTS };
export { TTK_CLASSES };
