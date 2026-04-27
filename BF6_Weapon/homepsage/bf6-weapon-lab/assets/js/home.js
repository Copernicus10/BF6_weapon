import {
  HOME_CLASSES,
  buildPictureHtml,
  escapeHtml,
  fetchManifest,
  fetchWeaponByFile,
  formatNumber,
  getCategoryWeapons,
  resolveEffectiveSpreadInputs,
} from "./shared.js";

const statusEl = document.getElementById("homeStatus");
const sectionsEl = document.getElementById("homeSections");
const visibleCountEl = document.getElementById("visibleWeaponCount");

function buildRecoilFanSvg(direction, variation) {
  const RAD = Math.PI / 180;
  const width = 110;
  const height = 66;
  const cx = width / 2;
  const cy = height - 2;
  const radius = 52;

  // 홈 부채꼴 기준: 음수 방향은 오른쪽, 양수 방향은 왼쪽
  const centerDeg = -90 - direction;
  const fanStart = Math.max(-180, centerDeg - variation);
  const fanEnd = Math.min(0, centerDeg + variation);

  const toXY = (deg, r = radius) => [
    cx + r * Math.cos(deg * RAD),
    cy + r * Math.sin(deg * RAD),
  ];
  const pt = (deg, r = radius) => toXY(deg, r).map((value) => value.toFixed(2)).join(",");

  const bgPath = `M ${cx},${cy} L ${pt(-180)} A ${radius},${radius} 0 0,1 ${pt(0)} Z`;
  const fanPath =
    `M ${cx},${cy} L ${pt(fanStart)} ` +
    `A ${radius},${radius} 0 ${fanEnd - fanStart > 180 ? 1 : 0},1 ${pt(fanEnd)} Z`;

  const [lineX, lineY] = toXY(centerDeg, radius - 5);
  const [dotX, dotY] = toXY(centerDeg, radius);

  const tickLine = (deg) => {
    const [x1, y1] = toXY(deg, radius);
    const [x2, y2] = toXY(deg, radius - 6);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(255,255,255,0.2)" stroke-width="0.8"/>`;
  };

  const topY = cy - radius + 10;
  const edgeY = cy - 4;

  return `<svg class="recoil-fan-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${bgPath}" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.13)" stroke-width="0.6"/>
    <path d="${fanPath}" fill="rgba(255,150,50,0.28)" stroke="rgba(255,150,50,0.7)" stroke-width="0.8"/>
    ${tickLine(-180)} ${tickLine(-90)} ${tickLine(0)}
    <line x1="${cx}" y1="${cy}" x2="${lineX.toFixed(2)}" y2="${lineY.toFixed(2)}"
          stroke="#ffaa30" stroke-width="2" stroke-linecap="round"/>
    <circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="2.4" fill="#ffaa30"/>
    <circle cx="${cx}" cy="${cy}" r="2" fill="rgba(255,255,255,0.35)"/>
    <text x="${cx}" y="${topY}" font-size="6" fill="rgba(255,255,255,0.3)" text-anchor="middle">0°</text>
    <text x="6" y="${edgeY}" font-size="5.5" fill="rgba(255,255,255,0.2)" text-anchor="start">-90°</text>
    <text x="${width - 6}" y="${edgeY}" font-size="5.5" fill="rgba(255,255,255,0.2)" text-anchor="end">+90°</text>
  </svg>`;
}

async function buildWeaponCard(category, item) {
  const fileName = item.file.replace(/\\/g, "/").split("/").pop();
  const weapon = await fetchWeaponByFile(category, fileName);

  const velocity = Number(weapon.velocity);
  const rpm = Number(weapon.rof?.RoF);
  const magSize = Number(weapon.mags?.MagSize);
  const recoil = resolveEffectiveSpreadInputs(weapon);
  const fanSvg = buildRecoilFanSvg(recoil.recoilDirection, recoil.recoilVariation);

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
          <span class="stat-label">탄속</span>
          <span class="stat-value">${formatNumber(velocity, 0)} m/s</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">장탄수</span>
          <span class="stat-value">${formatNumber(magSize, 0)}</span>
        </div>
      </div>
      <div class="recoil-block">
        <p class="eyebrow recoil-block-head">반동</p>
        ${fanSvg}
        <div class="recoil-nums">
          <div class="recoil-num-item">
            <span class="stat-label">방향</span>
            <span class="stat-value">${formatNumber(recoil.recoilDirection, 1)}°</span>
          </div>
          <div class="recoil-num-item">
            <span class="stat-label">강도</span>
            <span class="stat-value">${formatNumber(recoil.recoilAmount, 3)}°</span>
          </div>
          <div class="recoil-num-item">
            <span class="stat-label">변동</span>
            <span class="stat-value">±${formatNumber(recoil.recoilVariation, 1)}°</span>
          </div>
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
          <h2>${category} 무기</h2>
          <p class="section-note">홈 카드에는 기본 무기 정보와 ADS 기준 반동 정보가 표시됩니다.</p>
        </div>
        <div class="meta-chip">
          <span class="meta-value">${items.length}</span>
          <span class="meta-label">무기</span>
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
    statusEl.textContent = "홈 카드에는 무기 기본 정보와 ADS 기준 반동 정보가 표시됩니다.";
  } catch (error) {
    statusEl.textContent = `홈 페이지 초기화 실패: ${error.message}`;
    statusEl.classList.add("is-error");
  }
}

init();
