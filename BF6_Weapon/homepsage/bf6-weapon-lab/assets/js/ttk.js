import {
  TTK_CLASSES,
  escapeHtml,
  fetchManifest,
  fetchWeaponByFile,
  fetchWeaponTtkByFile,
  formatNumber,
  getCategoryWeapons,
  resolveEffectiveSpreadInputs,
} from "./shared.js";

const statusEl = document.getElementById("ttkStatus");
const weaponCountEl = document.getElementById("ttkWeaponCount");
const sortHintEl = document.getElementById("ttkSortHint");
const filterGroupsEl = document.getElementById("ttkFilterGroups");
const tableHeadEl = document.getElementById("ttkTableHead");
const tableBodyEl = document.getElementById("ttkTableBody");

const state = {
  allRows: [],
  distanceColumns: [],
  selectedWeaponIds: new Set(),
  sortKey: "category",
  sortDirection: "asc",
};

function normalizeDistanceLabel(label) {
  return String(label ?? "").replace(/\s*TTK$/i, "").trim();
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getDistanceKey(label) {
  return `distance:${normalizeDistanceLabel(label)}`;
}

function getVisibleRows() {
  return state.allRows.filter((row) => state.selectedWeaponIds.has(row.id));
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function buildColumns(distanceColumns) {
  return [
    { key: "category", label: "계열", type: "text" },
    { key: "weaponName", label: "총이름", type: "text" },
    { key: "velocity", label: "탄속", type: "number", digits: 0, suffix: " m/s" },
    { key: "rpm", label: "연사력", type: "number", digits: 0 },
    { key: "recoil", label: "반동강도", type: "number", digits: 3 },
    { key: "variation", label: "반동변동", type: "number", digits: 3 },
    ...distanceColumns.map((label) => ({
      key: getDistanceKey(label),
      label: normalizeDistanceLabel(label),
      type: "number",
      digits: 0,
      suffix: " ms",
    })),
  ];
}

function getCellValue(row, key) {
  if (key.startsWith("distance:")) {
    const label = key.split(":")[1];
    return row.distanceValues[label] ?? null;
  }
  return row[key] ?? null;
}

function compareValues(left, right, type) {
  if (left === right) {
    return 0;
  }
  if (left === null || left === undefined) {
    return 1;
  }
  if (right === null || right === undefined) {
    return -1;
  }

  if (type === "text") {
    return String(left).localeCompare(String(right), "ko-KR", {
      numeric: true,
      sensitivity: "base",
    });
  }

  return Number(left) - Number(right);
}

function sortRows(rows, columns) {
  const column = columns.find((item) => item.key === state.sortKey) ?? columns[0];
  const directionFactor = state.sortDirection === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const primary = compareValues(getCellValue(a, column.key), getCellValue(b, column.key), column.type);
    if (primary !== 0) {
      return primary * directionFactor;
    }

    const categoryTie = compareValues(a.category, b.category, "text");
    if (categoryTie !== 0) {
      return categoryTie;
    }

    return compareValues(a.weaponName, b.weaponName, "text");
  });
}

function formatCell(row, column) {
  const value = getCellValue(row, column.key);

  if (column.key === "category") {
    return `<span class="class-pill">${escapeHtml(String(value ?? "-"))}</span>`;
  }

  if (column.key === "weaponName") {
    return `
      <div class="weapon-cell">
        <strong>${escapeHtml(row.weaponName)}</strong>
        <span>${escapeHtml(row.codename)}</span>
      </div>
    `;
  }

  if (value === null || value === undefined) {
    return '<span class="cell-muted">-</span>';
  }

  return `${formatNumber(value, column.digits ?? 2)}${column.suffix ?? ""}`;
}

function renderTable() {
  const columns = buildColumns(state.distanceColumns);
  const visibleRows = getVisibleRows();
  const sortedRows = sortRows(visibleRows, columns);

  tableHeadEl.innerHTML = `
    <tr>
      ${columns
        .map((column) => {
          const isActive = column.key === state.sortKey;
          const directionMark = !isActive ? "" : state.sortDirection === "asc" ? " ▲" : " ▼";
          const thClass = column.type === "number" ? "align-right" : "";
          return `
            <th scope="col" class="${thClass}">
              <button class="sort-button ${isActive ? "is-active" : ""}" type="button" data-sort-key="${column.key}">
                ${escapeHtml(column.label)}${directionMark}
              </button>
            </th>
          `;
        })
        .join("")}
    </tr>
  `;

  if (!sortedRows.length) {
    tableBodyEl.innerHTML = `
      <tr>
        <td colspan="${columns.length}">
          <span class="cell-muted">선택된 무기가 없습니다. 체크박스를 다시 켜서 표에 표시하세요.</span>
        </td>
      </tr>
    `;
  } else {
    tableBodyEl.innerHTML = sortedRows
      .map(
        (row) => `
          <tr>
            ${columns
              .map((column) => {
                const tdClass = column.type === "number" ? "align-right" : "";
                return `<td class="${tdClass}">${formatCell(row, column)}</td>`;
              })
              .join("")}
          </tr>
        `
      )
      .join("");
  }

  const activeColumn = columns.find((column) => column.key === state.sortKey) ?? columns[0];
  sortHintEl.textContent = `현재 정렬: ${activeColumn.label} ${
    state.sortDirection === "asc" ? "오름차순" : "내림차순"
  }`;
  weaponCountEl.textContent = String(visibleRows.length);
}

function attachSortHandlers() {
  tableHeadEl.querySelectorAll("[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextKey = button.getAttribute("data-sort-key");
      if (!nextKey) {
        return;
      }

      if (state.sortKey === nextKey) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = nextKey;
        state.sortDirection = "asc";
      }

      renderTable();
      attachSortHandlers();
    });
  });
}

function renderFilters() {
  const groupedRows = TTK_CLASSES.map((category) => ({
    category,
    rows: state.allRows.filter((row) => row.category === category),
  })).filter((group) => group.rows.length);

  filterGroupsEl.innerHTML = groupedRows
    .map(
      (group) => `
        <section class="ttk-filter-group">
          <div class="ttk-filter-group-head">
            <label class="ttk-group-toggle">
              <input
                type="checkbox"
                data-group-category="${escapeHtml(group.category)}"
                ${group.rows.every((row) => state.selectedWeaponIds.has(row.id)) ? "checked" : ""}
              />
              <span>${escapeHtml(group.category)}</span>
            </label>
            <span>${group.rows.length}개</span>
          </div>
          <div class="ttk-filter-list">
            ${group.rows
              .map(
                (row) => `
                  <label class="ttk-check">
                    <input type="checkbox" data-weapon-id="${escapeHtml(row.id)}" ${
                      state.selectedWeaponIds.has(row.id) ? "checked" : ""
                    } />
                    <span>${escapeHtml(row.weaponName)}</span>
                  </label>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function attachFilterHandlers() {
  filterGroupsEl.querySelectorAll("[data-group-category]").forEach((input) => {
    input.addEventListener("change", () => {
      const category = input.getAttribute("data-group-category");
      if (!category) {
        return;
      }

      const rows = state.allRows.filter((row) => row.category === category);
      rows.forEach((row) => {
        if (input.checked) {
          state.selectedWeaponIds.add(row.id);
        } else {
          state.selectedWeaponIds.delete(row.id);
        }
      });

      renderFilters();
      attachFilterHandlers();
      renderTable();
      attachSortHandlers();
      setStatus(
        `Google Sheet 기반 _ttk.json 데이터를 사용 중입니다. 현재 ${state.allRows.length}개 중 ${getVisibleRows().length}개 무기를 표시합니다.`
      );
    });
  });

  filterGroupsEl.querySelectorAll("[data-weapon-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const weaponId = input.getAttribute("data-weapon-id");
      if (!weaponId) {
        return;
      }

      if (input.checked) {
        state.selectedWeaponIds.add(weaponId);
      } else {
        state.selectedWeaponIds.delete(weaponId);
      }

      renderFilters();
      attachFilterHandlers();
      renderTable();
      attachSortHandlers();
      setStatus(
        `Google Sheet 기반 _ttk.json 데이터를 사용 중입니다. 현재 ${state.allRows.length}개 중 ${getVisibleRows().length}개 무기를 표시합니다.`
      );
    });
  });
}

async function buildRows() {
  const manifest = await fetchManifest();
  const rows = [];
  const distanceSet = new Set();

  for (const category of TTK_CLASSES) {
    const items = getCategoryWeapons(manifest, category);
    for (const item of items) {
      const fileName = item.file.replace(/\\/g, "/").split("/").pop();
      const [weapon, ttkData] = await Promise.all([
        fetchWeaponByFile(category, fileName),
        fetchWeaponTtkByFile(category, fileName),
      ]);

      if (!ttkData?.summary?.ttk_by_range?.length) {
        continue;
      }

      const spreadInputs = resolveEffectiveSpreadInputs(weapon);
      const distanceValues = {};
      ttkData.summary.ttk_by_range.forEach((entry) => {
        const label = normalizeDistanceLabel(entry.label);
        distanceSet.add(label);
        distanceValues[label] = Number(entry.ttk_ms);
      });

      rows.push({
        id: `${category}/${fileName}`,
        category,
        weaponName: weapon.displayname,
        codename: weapon.codename,
        velocity: ttkData.summary.bullet_velocity_mps ?? numberOrNull(weapon.velocity),
        rpm: ttkData.summary.rpm ?? numberOrNull(weapon.rof?.RoF),
        recoil: ttkData.summary.recoil_strength ?? numberOrNull(spreadInputs.recoilAmount),
        variation: ttkData.summary.recoil_variation ?? numberOrNull(spreadInputs.recoilVariation),
        distanceValues,
      });
    }
  }

  return {
    rows,
    distanceColumns: [...distanceSet],
  };
}

async function init() {
  try {
    const { rows, distanceColumns } = await buildRows();
    state.allRows = rows;
    state.distanceColumns = distanceColumns;
    state.selectedWeaponIds = new Set(rows.map((row) => row.id));

    renderFilters();
    attachFilterHandlers();
    renderTable();
    attachSortHandlers();

    setStatus(`Google Sheet 기반 _ttk.json 데이터를 사용 중입니다. 현재 ${rows.length}개 무기를 모두 표시합니다.`);
  } catch (error) {
    setStatus(`TTK 페이지 초기화 실패: ${error.message}`, true);
  }
}

init();
