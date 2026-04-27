import {
  SPREAD_CLASSES,
  SPREAD_DISTANCES,
  escapeHtml,
  fetchManifest,
  fetchWeaponByFile,
  formatNumber,
  getCategoryWeapons,
  getGridStep,
  getSpreadBounds,
  resolveEffectiveSpreadInputs,
  shotColor,
  simulateSpreadPanel,
} from "./shared.js";

const classSelect = document.getElementById("classSelect");
const weaponSelect = document.getElementById("weaponSelect");
const compareEnabledInput = document.getElementById("compareEnabled");
const compareClassSelect = document.getElementById("compareClassSelect");
const compareWeaponSelect = document.getElementById("compareWeaponSelect");
const spreadStatus = document.getElementById("spreadStatus");
const spreadMeta = document.getElementById("spreadMeta");
const spreadGrid = document.getElementById("spreadGrid");

const groups = {
  primary: {
    label: "무기 A",
    shotCount: document.getElementById("primaryShotCount"),
    container: document.getElementById("primaryControlGroup"),
    inputs: {
      adsBaseSpread: document.getElementById("primaryAdsBaseSpread"),
      adsBaseMax: document.getElementById("primaryAdsBaseMax"),
      adsSpreadInc: document.getElementById("primaryAdsSpreadInc"),
      rpm: document.getElementById("primaryRpm"),
      firingDecCoef: document.getElementById("primaryFiringDecCoef"),
      firingDecExp: document.getElementById("primaryFiringDecExp"),
      firingDecOffset: document.getElementById("primaryFiringDecOffset"),
      recoilAmount: document.getElementById("primaryRecoilAmount"),
      recoilDirection: document.getElementById("primaryRecoilDirection"),
      recoilVariation: document.getElementById("primaryRecoilVariation"),
      recoilCompensation: document.getElementById("primaryRecoilCompensation"),
    },
  },
  compare: {
    label: "무기 B",
    fieldset: document.getElementById("compareFieldset"),
    shotCount: document.getElementById("compareShotCount"),
    container: document.getElementById("compareControlGroup"),
    inputs: {
      adsBaseSpread: document.getElementById("compareAdsBaseSpread"),
      adsBaseMax: document.getElementById("compareAdsBaseMax"),
      adsSpreadInc: document.getElementById("compareAdsSpreadInc"),
      rpm: document.getElementById("compareRpm"),
      firingDecCoef: document.getElementById("compareFiringDecCoef"),
      firingDecExp: document.getElementById("compareFiringDecExp"),
      firingDecOffset: document.getElementById("compareFiringDecOffset"),
      recoilAmount: document.getElementById("compareRecoilAmount"),
      recoilDirection: document.getElementById("compareRecoilDirection"),
      recoilVariation: document.getElementById("compareRecoilVariation"),
      recoilCompensation: document.getElementById("compareRecoilCompensation"),
    },
  },
};

let manifest = null;
let currentPrimaryWeapon = null;
let currentPrimaryCategory = "";
let currentCompareWeapon = null;
let currentCompareCategory = "";

function setStatus(message, isError = false) {
  spreadStatus.textContent = message;
  spreadStatus.classList.toggle("is-error", isError);
}

function fillClassOptions(selectEl) {
  const options = SPREAD_CLASSES.map((category) => `<option value="${category}">${category}</option>`);
  selectEl.insertAdjacentHTML("beforeend", options.join(""));
}

function fillWeaponOptions(selectEl, category, placeholder) {
  selectEl.innerHTML = `<option value="">${placeholder}</option>`;
  const items = getCategoryWeapons(manifest, category);
  const options = items
    .map((item) => {
      const fileName = item.file.replace(/\\/g, "/").split("/").pop();
      return `<option value="${escapeHtml(fileName)}">${escapeHtml(item.displayname)}</option>`;
    })
    .join("");
  selectEl.insertAdjacentHTML("beforeend", options);
  selectEl.disabled = false;
}

function setGroupEnabled(groupKey, enabled) {
  const group = groups[groupKey];
  group.shotCount.disabled = !enabled;
  group.container.classList.toggle("is-disabled", !enabled);
  Object.values(group.inputs).forEach((input) => {
    input.disabled = !enabled;
  });
  if (group.fieldset) {
    group.fieldset.classList.toggle("is-disabled", !enabled);
  }
}

function updateAvailability() {
  const hasPrimary = Boolean(currentPrimaryWeapon && currentPrimaryCategory);
  setGroupEnabled("primary", hasPrimary);

  compareEnabledInput.disabled = !hasPrimary;
  compareClassSelect.disabled = !hasPrimary || !compareEnabledInput.checked;

  const compareReady = Boolean(compareEnabledInput.checked && currentCompareWeapon && currentCompareCategory);
  compareWeaponSelect.disabled = !(compareEnabledInput.checked && currentCompareCategory);
  setGroupEnabled("compare", compareReady);
}

function resetPrimarySelection() {
  weaponSelect.innerHTML = "<option value=''>먼저 계열을 선택하세요</option>";
  weaponSelect.disabled = true;
  currentPrimaryWeapon = null;
  currentPrimaryCategory = "";
}

function resetCompareSelection() {
  compareClassSelect.value = "";
  compareWeaponSelect.innerHTML = "<option value=''>먼저 비교 계열을 선택하세요</option>";
  compareWeaponSelect.disabled = true;
  currentCompareWeapon = null;
  currentCompareCategory = "";
}

function getShotCount(input) {
  const requestedShots = Number(input.value);
  if (!Number.isFinite(requestedShots) || requestedShots < 1) {
    return 1;
  }
  return Math.floor(requestedShots);
}

function getGroupInputs(groupKey) {
  const group = groups[groupKey];
  return {
    shotCount: getShotCount(group.shotCount),
    adsBaseSpread: Number(group.inputs.adsBaseSpread.value),
    adsBaseMax: Number(group.inputs.adsBaseMax.value),
    adsSpreadInc: Number(group.inputs.adsSpreadInc.value),
    rpm: Number(group.inputs.rpm.value),
    firingDecCoef: Number(group.inputs.firingDecCoef.value),
    firingDecExp: Number(group.inputs.firingDecExp.value),
    firingDecOffset: Number(group.inputs.firingDecOffset.value),
    recoilAmount: Number(group.inputs.recoilAmount.value),
    recoilDirection: Number(group.inputs.recoilDirection.value),
    recoilVariation: Number(group.inputs.recoilVariation.value),
    recoilCompensation: Number(group.inputs.recoilCompensation.value),
  };
}

function renderMeta(primaryWeapon, compareWeapon, primaryInputs, compareInputs) {
  const bits = [
    `무기 A: ${primaryWeapon.displayname}`,
    `무기 A 발사 수: ${primaryInputs.shotCount}`,
  ];

  if (compareWeapon && compareInputs) {
    bits.push(`무기 B: ${compareWeapon.displayname}`);
    bits.push(`무기 B 발사 수: ${compareInputs.shotCount}`);
  }

  spreadMeta.innerHTML = bits
    .map((value) => `<span class="spread-meta-chip">${escapeHtml(value)}</span>`)
    .join("");
  spreadMeta.hidden = false;
}

function ringMarkup(center, radiusPx, label) {
  return `
    <circle cx="${center}" cy="${center}" r="${radiusPx}" fill="none" stroke="#334155" stroke-width="1" />
    <text x="${center + radiusPx + 6}" y="${center - 4}" fill="#94a3b8" font-size="10">${label}</text>
  `;
}

function spreadDiameterM(impacts) {
  const maxR = impacts.reduce((max, { xCm, yCm }) => Math.max(max, Math.sqrt(xCm ** 2 + yCm ** 2)), 0);
  return (maxR * 2 / 100).toFixed(2);
}

function renderPanelSvg(impacts, limitCm) {
  const size = 280;
  const center = size / 2;
  const pxPerCm = (size - 44) / (limitCm * 2);
  const step = getGridStep(limitCm);
  const rings = [];
  for (let ring = step; ring <= limitCm; ring += step) {
    rings.push(ringMarkup(center, ring * pxPerCm, `${ring}cm`));
  }

  const points = impacts
    .map((impact, index) => {
      const x = center + impact.xCm * pxPerCm;
      const y = center + impact.yCm * pxPerCm;
      return `
        <circle cx="${x}" cy="${y}" r="4.6" fill="${shotColor(index, impacts.length)}" fill-opacity="0.86" stroke="#020617" stroke-width="1.2" />
        <text x="${x + 6}" y="${y - 5}" fill="#cbd5e1" font-size="9">${impact.shot}</text>
      `;
    })
    .join("");

  return `
    <svg class="spread-svg" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <rect width="${size}" height="${size}" rx="18" fill="#07100f"></rect>
      ${rings.join("")}
      <line x1="18" y1="${center}" x2="${size - 18}" y2="${center}" stroke="#64748b" stroke-width="1" />
      <line x1="${center}" y1="18" x2="${center}" y2="${size - 18}" stroke="#64748b" stroke-width="1" />
      <circle cx="${center}" cy="${center}" r="3.5" fill="#e2e8f0" />
      ${points}
    </svg>
  `;
}

function buildPanels(weapon, inputs) {
  return SPREAD_DISTANCES.map((distance) =>
    simulateSpreadPanel({
      distanceM: distance,
      shots: inputs.shotCount,
      inputs,
      seed: weapon.codename.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0),
    })
  );
}

function renderSpreadPanels(primaryWeapon, primaryInputs, compareWeapon, compareInputs) {
  const primaryPanels = buildPanels(primaryWeapon, primaryInputs);
  const comparePanels = compareWeapon && compareInputs ? buildPanels(compareWeapon, compareInputs) : null;
  const limitCm = getSpreadBounds(comparePanels ? [...primaryPanels, ...comparePanels] : primaryPanels);

  spreadGrid.innerHTML = SPREAD_DISTANCES.map((distance, index) => {
    const primaryDiam = spreadDiameterM(primaryPanels[index]);
    const primaryPanel = `
      <article class="spread-panel">
        <div class="spread-panel-head">
          <h3>${distance}m <span class="spread-diam">${primaryDiam}m</span></h3>
          <span>${groups.primary.label} / ${primaryWeapon.displayname}</span>
        </div>
        ${renderPanelSvg(primaryPanels[index], limitCm)}
        <div class="spread-legend">${primaryInputs.shotCount}발 기준</div>
      </article>
    `;

    const comparePanel = comparePanels
      ? (() => {
          const compareDiam = spreadDiameterM(comparePanels[index]);
          return `
        <article class="spread-panel spread-panel-compare">
          <div class="spread-panel-head">
            <h3>${distance}m <span class="spread-diam">${compareDiam}m</span></h3>
            <span>${groups.compare.label} / ${compareWeapon.displayname}</span>
          </div>
          ${renderPanelSvg(comparePanels[index], limitCm)}
          <div class="spread-legend">${compareInputs.shotCount}발 기준</div>
        </article>
          `;
        })()
      : "";

    return `
      <section class="spread-distance-group${comparePanels ? " spread-distance-group--compare" : ""}">
        ${primaryPanel}
        ${comparePanel}
      </section>
    `;
  }).join("");

  spreadGrid.hidden = false;
}

function applyDefaultsToGroup(groupKey, weapon) {
  const group = groups[groupKey];
  const defaults = resolveEffectiveSpreadInputs(weapon);
  const magSize = Number(weapon.mags?.MagSize);

  group.shotCount.value = String(Number.isFinite(magSize) && magSize > 0 ? Math.floor(magSize) : 30);
  group.inputs.adsBaseSpread.value = String(defaults.adsBaseSpread);
  group.inputs.adsBaseMax.value = String(defaults.adsBaseMax);
  group.inputs.adsSpreadInc.value = String(defaults.adsSpreadInc);
  group.inputs.rpm.value = String(Math.round(defaults.rpm));
  group.inputs.firingDecCoef.value = String(defaults.firingDecCoef);
  group.inputs.firingDecExp.value = String(defaults.firingDecExp);
  group.inputs.firingDecOffset.value = String(defaults.firingDecOffset);
  group.inputs.recoilAmount.value = String(defaults.recoilAmount);
  group.inputs.recoilDirection.value = String(defaults.recoilDirection);
  group.inputs.recoilVariation.value = String(defaults.recoilVariation);
  group.inputs.recoilCompensation.value = "0";
}

function renderSpread() {
  if (!currentPrimaryWeapon) {
    spreadGrid.hidden = true;
    spreadMeta.hidden = true;
    return;
  }

  const primaryInputs = getGroupInputs("primary");
  const compareInputs =
    compareEnabledInput.checked && currentCompareWeapon ? getGroupInputs("compare") : null;

  renderMeta(currentPrimaryWeapon, currentCompareWeapon, primaryInputs, compareInputs);
  renderSpreadPanels(currentPrimaryWeapon, primaryInputs, currentCompareWeapon, compareInputs);

  if (compareEnabledInput.checked && !currentCompareWeapon) {
    setStatus("비교가 켜져 있습니다. 무기 B를 선택하면 무기 A와 무기 B의 탄퍼짐을 거리별로 함께 표시합니다.");
  } else if (compareInputs) {
    setStatus("무기 A와 무기 B 탄퍼짐 결과를 거리별로 비교 중입니다.");
  } else {
    setStatus("선택한 무기 기준 탄퍼짐 결과를 계산했습니다.");
  }
}

async function handlePrimaryWeaponChange() {
  if (!weaponSelect.value) {
    currentPrimaryWeapon = null;
    compareEnabledInput.checked = false;
    resetCompareSelection();
    updateAvailability();
    spreadGrid.hidden = true;
    spreadMeta.hidden = true;
    setStatus("무기를 선택해야 결과가 표시됩니다.");
    return;
  }

  currentPrimaryWeapon = await fetchWeaponByFile(currentPrimaryCategory, weaponSelect.value);
  applyDefaultsToGroup("primary", currentPrimaryWeapon);
  compareEnabledInput.checked = false;
  resetCompareSelection();
  updateAvailability();
  renderSpread();
}

async function handleCompareWeaponChange() {
  if (!compareWeaponSelect.value) {
    currentCompareWeapon = null;
    updateAvailability();
    renderSpread();
    return;
  }

  currentCompareWeapon = await fetchWeaponByFile(currentCompareCategory, compareWeaponSelect.value);
  applyDefaultsToGroup("compare", currentCompareWeapon);
  updateAvailability();
  renderSpread();
}

function attachGroupInputs(groupKey) {
  const group = groups[groupKey];
  group.shotCount.addEventListener("input", () => {
    if (groupKey === "primary" && currentPrimaryWeapon) {
      renderSpread();
    }
    if (groupKey === "compare" && compareEnabledInput.checked && currentCompareWeapon) {
      renderSpread();
    }
  });

  Object.values(group.inputs).forEach((input) => {
    input.addEventListener("input", () => {
      if (groupKey === "primary" && currentPrimaryWeapon) {
        renderSpread();
      }
      if (groupKey === "compare" && compareEnabledInput.checked && currentCompareWeapon) {
        renderSpread();
      }
    });
  });
}

async function init() {
  try {
    manifest = await fetchManifest();
    fillClassOptions(classSelect);
    fillClassOptions(compareClassSelect);
    updateAvailability();
    setStatus("AR, Carbine, SMG, MG 중 하나를 선택하고 무기를 고르세요.");

    classSelect.addEventListener("change", () => {
      currentPrimaryCategory = classSelect.value;
      currentPrimaryWeapon = null;
      compareEnabledInput.checked = false;
      resetCompareSelection();
      spreadGrid.hidden = true;
      spreadMeta.hidden = true;

      if (!currentPrimaryCategory) {
        resetPrimarySelection();
        updateAvailability();
        setStatus("AR, Carbine, SMG, MG 중 하나를 선택해야 결과가 나옵니다.");
        return;
      }

      fillWeaponOptions(weaponSelect, currentPrimaryCategory, "무기 선택");
      updateAvailability();
      setStatus(`${currentPrimaryCategory} 무기 목록을 불러왔습니다. 무기를 선택하세요.`);
    });

    weaponSelect.addEventListener("change", () => {
      handlePrimaryWeaponChange().catch((error) => setStatus(`무기 로드 실패: ${error.message}`, true));
    });

    compareEnabledInput.addEventListener("change", () => {
      if (!compareEnabledInput.checked) {
        resetCompareSelection();
        currentCompareWeapon = null;
      }
      updateAvailability();
      renderSpread();
    });

    compareClassSelect.addEventListener("change", () => {
      currentCompareCategory = compareClassSelect.value;
      currentCompareWeapon = null;

      if (!currentCompareCategory) {
        compareWeaponSelect.innerHTML = "<option value=''>먼저 비교 계열을 선택하세요</option>";
        compareWeaponSelect.disabled = true;
        updateAvailability();
        renderSpread();
        return;
      }

      fillWeaponOptions(compareWeaponSelect, currentCompareCategory, "비교 무기 선택");
      updateAvailability();
      renderSpread();
    });

    compareWeaponSelect.addEventListener("change", () => {
      handleCompareWeaponChange().catch((error) => setStatus(`비교 무기 로드 실패: ${error.message}`, true));
    });

    attachGroupInputs("primary");
    attachGroupInputs("compare");
  } catch (error) {
    setStatus(`탄퍼짐 페이지 초기화 실패: ${error.message}`, true);
  }
}

init();
