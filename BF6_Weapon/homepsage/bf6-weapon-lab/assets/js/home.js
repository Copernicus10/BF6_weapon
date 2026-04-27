import {
  HOME_CLASSES,
  buildPictureHtml,
  computeTtkAtDistance,
  escapeHtml,
  fetchManifest,
  fetchWeaponByFile,
  formatNumber,
  getCategoryWeapons,
  resolveEffectiveSpreadInputs,
} from "./shared.js";

const RECOIL_AMOUNT_MAX = 2.0;
const RECOIL_VARIATION_MAX = 50;

const statusEl = document.getElementById("homeStatus");
const sectionsEl = document.getElementById("homeSections");
const visibleCountEl = document.getElementById("visibleWeaponCount");

function buildRecoilBar(value, max, modifierClass) {
  const pct = Math.min(100, (value / max) * 100).toFixed(1);
  return `<div class="stat-bar-track"><div class="stat-bar-fill ${modifierClass}" style="width:${pct}%"></div></div>`;
}

async function buildWeaponCard(category, item) {
  const fileName = item.file.replace(/\\/g, "/").split("/").pop();
  const weapon = await fetchWeaponByFile(category, fileName);

  const velocity = Number(weapon.velocity);
  const rpm = Number(weapon.rof?.RoF);
  const magSize = Number(weapon.mags?.MagSize);

  const recoil = resolveEffectiveSpreadInputs(weapon);
  const ttk10 = computeTtkAtDistance(weapon, 10);

  const ttk10Html = ttk10
    ? `<span class="stat-value">${formatNumber(ttk10.ttkMs, 0)} ms</span><span class="stat-sublabel">${ttk10.bulletsToKill}발</span>`
    : `<span class="stat-value">-</span>`;

  return `
    <article class="weapon-card">
      <div class="weapon-card-header">
        <div>
          <h3 class="weapon-name">${escapeHtml(weapon.displayname)}</h3>
          <div class="weapon-codename">${escapeHtml(weapon.codename)}</div>
        </div>
        <div class="weapon-badge">${escapeHtml(category)}</div>
      </div>
      <div class="weapon-visual">${buildPictureHtml(category, item)}</div>
      <div class="stat-grid">
        <div class="stat-box">
          <span class="stat-label">RPM</span>
          <span class="stat-value">${formatNumber(rpm, 0)}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">Velocity</span>
          <span class="stat-value">${formatNumber(velocity, 0)} m/s</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">Magazine</span>
          <span class="stat-value">${formatNumber(magSize, 0)}</span>
        </div>
      </div>
      <div class="recoil-block">
        <p class="eyebrow recoil-block-head">반동 · TTK</p>
        <div class="stat-bar-row">
          <span class="stat-bar-label">반동강도</span>
          ${buildRecoilBar(recoil.recoilAmount, RECOIL_AMOUNT_MAX, "stat-bar-fill--recoil")}
          <span class="stat-bar-value">${formatNumber(recoil.recoilAmount, 3)}°</span>
        </div>
        <div class="stat-bar-row">
          <span class="stat-bar-label">반동변동</span>
          ${buildRecoilBar(recoil.recoilVariation, RECOIL_VARIATION_MAX, "stat-bar-fill--variation")}
          <span class="stat-bar-value">${formatNumber(recoil.recoilVariation, 1)}°</span>
        </div>
        <div class="stat-box stat-box--ttk10">
          <span class="stat-label">TTK 10m</span>
          <div class="ttk10-values">${ttk10Html}</div>
        </div>
      </div>
    </article>
  `;
}

async function renderCategorySection(manifest, category) {
  const items = getCategoryWeapons(manifest, category);
  const cards = await Promise.all(items.map((item) => buildWeaponCard(category, item)));
  return `
    <section class="class-section" id="${category}">
      <div class="class-section-header">
        <div>
          <p class="eyebrow">${category}</p>
          <h2>${category} Weapons</h2>
          <p class="section-note">
            반동강도 · 반동변동은 ADS 기준 유효값이며, TTK 10m는 무기 데이터에서 직접 계산합니다.
          </p>
        </div>
        <div class="meta-chip">
          <span class="meta-value">${items.length}</span>
          <span class="meta-label">Weapons</span>
        </div>
      </div>
      <div class="weapon-grid">${cards.join("")}</div>
    </section>
  `;
}

async function init() {
  try {
    const manifest = await fetchManifest();
    const sections = await Promise.all(HOME_CLASSES.map((category) => renderCategorySection(manifest, category)));
    const weaponCount = HOME_CLASSES.reduce(
      (total, category) => total + (manifest.categories?.[category]?.length ?? 0),
      0
    );

    sectionsEl.innerHTML = sections.join("");
    visibleCountEl.textContent = String(weaponCount);
    statusEl.textContent = "무기 카드의 반동강도·반동변동은 ADS 유효 반동값 기준이며, TTK 10m는 sym.gg 데이터로 직접 계산합니다.";
  } catch (error) {
    statusEl.textContent = `메인 페이지 초기화 실패: ${error.message}`;
    statusEl.classList.add("is-error");
  }
}

init();
