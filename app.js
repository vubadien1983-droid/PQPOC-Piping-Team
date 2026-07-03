/**
 * Block B CPP Topside - Piping Fabrication & Testing Dashboard
 * Author: Antigravity
 * Date: 2026-06-08
 */

// Helper to construct API URL (makes local file:/// connections robust)
function getApiUrl(path) {
  if (window.location.protocol === 'file:') {
    return `http://localhost:3000${path}`;
  }
  return path;
}

// Helper to calculate capped progress percentage
function getProgressPct(done, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

// Value-aware colour band for a percentage: low (<40) / mid (40-79) / high (>=80)
function pctClass(pct) {
  if (pct >= 80) return 'pct-high';
  if (pct >= 40) return 'pct-mid';
  return 'pct-low';
}

// Helper to escape HTML characters
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper to auto-expand an input width based on text length
function autoExpandInput(inputEl, minWidth = 180, maxWidth = 600) {
  if (!inputEl) return;
  
  const tempSpan = document.createElement('span');
  tempSpan.style.visibility = 'hidden';
  tempSpan.style.position = 'absolute';
  tempSpan.style.whiteSpace = 'pre';
  tempSpan.style.fontFamily = window.getComputedStyle(inputEl).fontFamily;
  tempSpan.style.fontSize = window.getComputedStyle(inputEl).fontSize;
  tempSpan.style.fontWeight = window.getComputedStyle(inputEl).fontWeight;
  tempSpan.style.letterSpacing = window.getComputedStyle(inputEl).letterSpacing;
  
  // Use placeholder if empty, or a default space to ensure padding space
  tempSpan.textContent = inputEl.value || inputEl.placeholder || ' ';
  document.body.appendChild(tempSpan);
  
  // Calculate width plus some safety padding (e.g. 24px)
  const measuredWidth = tempSpan.getBoundingClientRect().width + 24;
  document.body.removeChild(tempSpan);
  
  const finalWidth = Math.min(maxWidth, Math.max(minWidth, measuredWidth));
  inputEl.style.width = `${finalWidth}px`;
}

// Helper to populate and update column filter dropdown list
function updateFilterDropdown(colKey, query = '') {
  const dropdown = document.getElementById('excel-filter-dropdown');
  if (!dropdown) return;
  
  if (!state.cachedColUniqueValues) state.cachedColUniqueValues = {};
  
  // If we don't have the cached unique values, ask the Server.
  if (!state.cachedColUniqueValues[colKey]) {
    dropdown.innerHTML = '<div class="excel-filter-dropdown-item" style="color: var(--text-muted); cursor: default; padding: 6px 10px; font-size: 0.8rem;">Loading...</div>';
    dropdown.style.display = 'block';
    
    fetch(getApiUrl(`/api/dropdowns?colKey=${colKey}`))
      .then(res => res.json())
      .then(data => {
        if (!state.cachedColUniqueValues) state.cachedColUniqueValues = {};
        state.cachedColUniqueValues[colKey] = data.values || [];
        
        if (typeof currentFilterColKey !== 'undefined' && currentFilterColKey === colKey) {
          const input = document.getElementById('excel-filter-input');
          updateFilterDropdown(colKey, input ? input.value : '');
        }
      })
      .catch(err => {
        console.error("Failed to load unique values", err);
        dropdown.innerHTML = '<div class="excel-filter-dropdown-item" style="color: var(--accent-red); cursor: default; padding: 6px 10px; font-size: 0.8rem;">Error loading</div>';
      });
    return;
  }
  
  const allValues = state.cachedColUniqueValues[colKey];
  const lowerQuery = query.toLowerCase().trim();
  
  // Filter matching values
  const matching = lowerQuery === '' 
    ? allValues 
    : allValues.filter(val => val.toLowerCase().includes(lowerQuery));
    
  if (matching.length === 0) {
    dropdown.innerHTML = '<div class="excel-filter-dropdown-item" style="color: var(--text-muted); cursor: default; padding: 6px 10px; font-size: 0.8rem;">No matches</div>';
    dropdown.style.display = 'block';
    return;
  }
  
  // Limit displayed items to 100 to keep DOM rendering extremely fast and smooth
  const displayLimit = 100;
  const toDisplay = matching.slice(0, displayLimit);
  
  let html = toDisplay.map(val => {
    return `<div class="excel-filter-dropdown-item" data-val="${escapeHtml(val)}" title="${escapeHtml(val)}">${escapeHtml(val)}</div>`;
  }).join('');
  
  if (matching.length > displayLimit) {
    html += `<div class="excel-filter-dropdown-item" style="color: var(--text-muted); cursor: default; text-align: center; font-size: 0.75rem; padding: 6px 10px;">+ ${matching.length - displayLimit} more...</div>`;
  }
  
  dropdown.innerHTML = html;
  dropdown.style.display = 'block';
  
  // Attach click listeners to dropdown items
  const items = dropdown.querySelectorAll('.excel-filter-dropdown-item[data-val]');
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      const selectedVal = e.target.getAttribute('data-val');
      const input = document.getElementById('excel-filter-input');
      input.value = selectedVal;
      
      // Update state filter
      state.dbColFilters[colKey] = selectedVal.toLowerCase();
      dropdown.style.display = 'none'; // hide dropdown after selection
      
      // Trigger table refresh
      state.dbPage = 1;
      filterDatabaseTable();
      autoExpandInput(input, 180, 350);
    });
  });
}

// Global State
const state = {
  systemsList: [],
  selectedSystem: null,
  selectedSystemPackages: [], // Loaded from /api/joints?sys=...
  activeDeckFilter: 'all',
  systemSearchQuery: '',
  packageSearchQuery: '',
  // Zoom & Pan state for 3D visualizer
  zoomScale: 1.0,
  panX: 0,
  panY: 0,
  activePackage: null,
  
  // Database Tab state
  dbRawData: [],
  dbFilteredData: [],
  dbPage: 1,
  dbPageSize: 100,
  dbColumnSearch: '',
  dbUniversalSearch: '',
  dbColFilters: {},
  cachedSystems: {}, // systemName -> packages array
  selectedStatusFilter: null,
  potentialWeldThreshold: null,
  potentialNdtThreshold: null
};

// DOM Elements
const systemSearch = document.getElementById('system-search');
const systemsTableBody = document.getElementById('systems-table-body');
const connectionStatus = document.getElementById('connection-status');
const deckSelectors = document.getElementById('deck-selectors');
const deckLayoutContainer = document.getElementById('deck-layout-container');
const detailedPanelTitle = document.getElementById('detailed-panel-title');
const detailedActionsBar = document.getElementById('detailed-actions-bar');
const detailedTableContainer = document.getElementById('detailed-table-container');
const tpFilterInput = document.getElementById('tp-filter-input');
const exportBtn = document.getElementById('export-btn');

// ==========================================
// 1. INITIALIZATION & DATA FETCHING
// ==========================================
// Global Analytics State
let currentTab = 'analytics-view';
let sCurveChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  setDataStatus('loading', 'Loading data…');
  initResizablePanels();
  fetchSystemsSummary();
  initTabs();
  setupEventListeners();
  loadAnalyticsDashboard();
  fetchDatabase();
  loadSyncMeta();
  startFreshnessWatcher();
});

// ---- Header data-status (replaces the static "Database Connected") -----------
// Reflects what data the app is actually using: loading it, up-to-date, pulling
// NEW data that just synced from the server, or disconnected.
let FRESH_CB = '';   // appended to data fetches to bypass the CDN cache on a refresh
function setDataStatus(kind, text) {
  const el = document.getElementById('connection-status');
  const dot = document.querySelector('.status-indicator .pulse-dot');
  if (el) el.textContent = text;
  if (dot) {
    dot.classList.remove('green', 'amber', 'red');
    dot.classList.add(kind === 'ready' ? 'green' : kind === 'error' ? 'red' : 'amber');
  }
}

// Poll the tiny sync-meta endpoint; when the server reports a NEWER sync (a fresh
// upload just landed), pull the new data in and show the progress -- so the user
// is never silently left looking at stale data.
function startFreshnessWatcher() {
  setInterval(async () => {
    try {
      const res = await fetch(getApiUrl('/api/dashboard-summary?view=syncmeta&_cb=' + Date.now()));
      if (!res.ok) return;
      const d = await res.json();
      if (d && d.syncedAt && state.lastSyncedAt && d.syncedAt !== state.lastSyncedAt) {
        setDataStatus('loading', 'Loading new data from server…');
        await reloadFreshData();
        state.lastSyncedAt = d.syncedAt;
        setDataStatus('ready', 'Data up to date');
      }
    } catch (e) { /* ignore transient errors */ }
  }, 90000);   // every 90 s
}

// Re-fetch dashboard data bypassing the CDN cache, then refresh the current view.
async function reloadFreshData() {
  FRESH_CB = '&_cb=' + Date.now();
  try {
    state.cachedSystems = {};                                  // force fresh per-system joints
    await Promise.all([fetchSystemsSummary(), loadAnalyticsDashboard(), loadSyncMeta()]);
    if (state.selectedSystem) await selectSystem(state.selectedSystem);   // refresh the open view
  } finally {
    FRESH_CB = '';
  }
}

// Header label: "PMS data updated from <source file> - <file export time>".
// The timestamp is the source file's OS modified-time (captured by the ETL),
// NOT the upload/run time.
async function loadSyncMeta() {
  const el = document.getElementById('header-sync-info');
  if (!el) return;
  try {
    const res = await fetch(getApiUrl('/api/dashboard-summary?view=syncmeta' + FRESH_CB));
    if (!res.ok) return;
    const d = await res.json();
    if (d && d.syncedAt) state.lastSyncedAt = d.syncedAt;   // version key for the freshness watcher
    if (d && d.filename && d.fileTime) {
      el.textContent = `PMS data updated from ${d.filename} - ${d.fileTime}`;
      el.title = `Fabrication (PMS) source file: ${d.filename}  •  created ${d.fileTime}`;
    } else {
      // Not populated yet -> show a hint so the element is visible and the user
      // knows to run the ETL (which writes the source-file metadata).
      el.textContent = 'PMS data: not synced yet — run the upload tool';
      el.title = 'Run etl_delta_sync.py (or Upload_Data.bat) once with the Excel file to populate this';
    }
  } catch (e) {
    el.textContent = '';   // network error -> stay quiet
  }
}

async function fetchSystemsSummary() {
  try {
    const response = await hybridFetch('/api/dashboard-summary?view=systems' + FRESH_CB);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    const data = await response.json();
    state.systemsList = data;

    // Header status: data is loaded and current. (During a freshness reload the
    // watcher manages the status, so don't flip it here.)
    if (!FRESH_CB) setDataStatus('ready', 'Data up to date');

    renderSystemsTable(data);

    // Default view on FIRST load = the whole project ("View all packages"). On a
    // freshness reload we keep the user's current selection (re-applied elsewhere).
    if (!state.selectedSystem) selectSystem('__ALL__');
  } catch (error) {
    console.error('Error fetching systems summary:', error);
    setDataStatus('error', 'Server disconnected');

    systemsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="color: var(--accent-red); padding: 2rem; font-size: 0.9rem; line-height: 1.5;">
          Failed to connect to backend. Please ensure the local server is running (Start_Dashboard.bat) and access the dashboard via http://localhost:3000 (or http://[shared-machine-ip]:3000) instead of double-clicking index.html directly.
        </td>
      </tr>
    `;
  }
}

// ==========================================
// 2. LEFT PANEL: GENERAL INFORMATION TABLE
// ==========================================
function renderSystemsTable(systems) {
  if (systems.length === 0) {
    systemsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="padding: 2rem; color: var(--text-faded);">
          No systems found.
        </td>
      </tr>
    `;
    return;
  }
  
  const htmlRows = systems.map(sys => {
    // Calculate percentages
    const hydroPct = getProgressPct(sys.hydrotestDone, sys.hydrotestTotal);
    const weldPct = getProgressPct(sys.weldingDone, sys.weldingTotal);
    const ndtPct = getProgressPct(sys.ndtDone, sys.ndtTotal);
    const reinstPct = getProgressPct(sys.reinstDone, sys.reinstTotal);
    
    const isSelected = state.selectedSystem === sys.system ? 'selected-row' : '';
    
    return `
      <tr class="${isSelected}" data-sys="${sys.system}">
        <td><strong>${sys.system}</strong></td>
        <td class="data-bar-cell" style="--pct: ${weldPct}%">
          <div class="progress-cell-wrapper">
            <span class="fraction-text">${sys.weldingDone}/${sys.weldingTotal}</span>
            <span class="percentage-text ${pctClass(weldPct)}">${weldPct}%</span>
          </div>
        </td>
        <td class="data-bar-cell" style="--pct: ${ndtPct}%">
          <div class="progress-cell-wrapper">
            <span class="fraction-text">${sys.ndtDone}/${sys.ndtTotal}</span>
            <span class="percentage-text ${pctClass(ndtPct)}">${ndtPct}%</span>
          </div>
        </td>
        <td class="data-bar-cell" style="--pct: ${hydroPct}%">
          <div class="progress-cell-wrapper">
            <span class="fraction-text">${sys.hydrotestDone}/${sys.hydrotestTotal}</span>
            <span class="percentage-text ${pctClass(hydroPct)}">${hydroPct}%</span>
          </div>
        </td>
        <td class="data-bar-cell" style="--pct: ${reinstPct}%">
          <div class="progress-cell-wrapper">
            <span class="fraction-text">${sys.reinstDone}/${sys.reinstTotal}</span>
            <span class="percentage-text ${pctClass(reinstPct)}">${reinstPct}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  systemsTableBody.innerHTML = htmlRows;
  
  // Attach select handlers
  const rows = systemsTableBody.querySelectorAll('tr');
  rows.forEach(row => {
    row.addEventListener('click', () => {
      // Highlight row
      rows.forEach(r => r.classList.remove('selected-row'));
      row.classList.add('selected-row');
      
      const sysName = row.getAttribute('data-sys');
      selectSystem(sysName);
    });
  });

  // Make systems table columns resizable by user drag
  makeTableResizable(document.getElementById('systems-table'));
}

function handleSystemSearch(e) {
  const query = e.target.value.trim().toLowerCase();
  state.systemSearchQuery = query;
  
  // Filter character-by-character based on system code only
  const filtered = state.systemsList.filter(sys => {
    return sys.system.toLowerCase().includes(query);
  });
  
  renderSystemsTable(filtered);
}

// ==========================================
// 3. SYSTEM SELECTION & DETAILS LOADING
// ==========================================
function applyGlobalStatsToPackages(packages) {
  if (!window.globalFabricationStats || !window.globalFabricationStats.groups) return;
  packages.forEach(p => {
    if (window.globalFabricationStats.groups[p.testPackageNo]) {
      const gTP = window.globalFabricationStats.groups[p.testPackageNo];
      let wDone = 0, wTotal = 0;
      Object.keys(gTP.lines).forEach(lineKey => {
        const lObj = gTP.lines[lineKey];
        wDone += lObj.weldingDone || 0;
        wTotal += lObj.actual || 0;
      });
      p.weldingDoneCount = wDone;
      p.totalJoints = wTotal;
      p.ndtDoneCount = gTP.designNdtDone || 0;
      p.ndtRequiredCount = gTP.designNdtReq || 0;
      
      // Specific NDT methods
      p.rtRequiredCount = gTP.rtReq || 0;
      p.rtDoneCount = gTP.rtDone || 0;
      p.pautRequiredCount = gTP.pautReq || 0;
      p.pautDoneCount = gTP.pautDone || 0;
      p.mtRequiredCount = gTP.mtReq || 0;
      p.mtDoneCount = gTP.mtDone || 0;
      p.ptRequiredCount = gTP.ptReq || 0;
      p.ptDoneCount = gTP.ptDone || 0;
    }
  });
}

async function selectSystem(sysName) {
  state.selectedSystem = sysName;
  const isAll = sysName === '__ALL__';
  detailedPanelTitle.innerHTML = isAll
    ? `System Detailed: <span class="glow-text">All Packages</span> <span class="unselected-text" style="font-weight:400;">(Project-wide)</span>`
    : `System Detailed: <span class="glow-text">${sysName}</span>`;
  detailedActionsBar.style.display = 'flex';
  // Clear the left-panel system highlight when showing the project-wide view.
  if (isAll && systemsTableBody) {
    systemsTableBody.querySelectorAll('tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  }
  
  // Reset donut and potential and global filters
  state.selectedStatusFilter = null;
  state.potentialWeldThreshold = null;
  state.potentialNdtThreshold = null;
  const potWeldInput = document.getElementById('potential-weld-input');
  const potNdtInput = document.getElementById('potential-ndt-input');
  if (potWeldInput) potWeldInput.value = '90';
  if (potNdtInput) potNdtInput.value = '90';
  const potClearBtn = document.getElementById('potential-clear-btn');
  if (potClearBtn) potClearBtn.style.display = 'none';
  
  const clearAllBtn = document.getElementById('clear-all-filters-btn');
  if (clearAllBtn) clearAllBtn.style.display = 'none';
  
  // Reset package search filter
  if (tpFilterInput) tpFilterInput.value = '';
  state.packageSearchQuery = '';
  const tpClearBtn = document.getElementById('tp-search-clear-btn');
  if (tpClearBtn) tpClearBtn.style.display = 'none';
  
  // Check if system packages are already cached
  if (state.cachedSystems[sysName]) {
    console.log(`[Cache] Loading system '${sysName}' from memory...`);
    state.selectedSystemPackages = state.cachedSystems[sysName];
    renderPieChart();
    renderDetailedTable();
    return;
  }
  
  // Clear layout and tables, show spinners
  deckLayoutContainer.innerHTML = `
    <div class="no-selection-message">
      <div class="loading-spinner-small"></div>
      <p>Loading Hydrotest Status Chart...</p>
    </div>
  `;
  
  detailedTableContainer.innerHTML = `
    <div class="no-selection-message">
      <div class="loading-spinner-small"></div>
      <p>Loading Test Package detailed database...</p>
    </div>
  `;
  
  try {
    const response = await hybridFetch(`/api/joints?sys=${sysName}`);
    if (!response.ok) {
      throw new Error(`Failed to load system details: HTTP ${response.status}`);
    }
    const packages = await response.json();
    state.selectedSystemPackages = packages;
    
    // Cache the packages
    state.cachedSystems[sysName] = packages;
    
    // Render components
    renderPieChart();
    renderDetailedTable();
  } catch (error) {
    console.error('Error loading selected system details:', error);
    deckLayoutContainer.innerHTML = `
      <div class="no-selection-message" style="color: var(--accent-red)">
        <p>Failed to load Hydrotest Status Chart.</p>
      </div>
    `;
    detailedTableContainer.innerHTML = `
      <div class="no-selection-message" style="color: var(--accent-red)">
        <p>Failed to load Detailed Joint Log.</p>
      </div>
    `;
  }
}

// ==========================================
// 4. TOP RIGHT PANEL: TEST PACKAGE HYDROTEST STATUS DONUT CHART
// ==========================================
// A single NDT method (RT/PAUT/MT/PT) is "cleared" for hydro-readiness when it
// is either NOT required (required = 0 -> shown as "N/A") or fully done.
function ndtMethodCleared(done, req) {
  return (req || 0) === 0 || (done || 0) >= (req || 0);
}

// "Ready for Hydrotest" condition (the SINGLE definition used everywhere):
//   - % Welding is EXACTLY 100% (every joint welded), AND
//   - every NDT method (RT/PAUT/MT/PT) is 100% done OR N/A (not required).
// NOTE: this deliberately does NOT use the Sheet's "Ready for Hydrotest" column
// (p.readyForHydrotest) -- that column was the old bug: it flagged packages as
// Ready even when welding was only ~78%.
function isHydroReady(p) {
  const total = p.totalJoints || 0;
  if (total <= 0) return false;
  // Non-metallic exception (GRE/CPVC/PPR): welding-date & NDT are NOT required.
  // Ready iff EVERY joint has VisualACC = 'ACC' AND FitUpACC = 'ACC'
  // (weldingDoneCount counts VisualACC='ACC'; fitupDoneCount counts FitUpACC='ACC').
  if (p.isNonMetallic) {
    return (p.weldingDoneCount || 0) >= total && (p.fitupDoneCount || 0) >= total;
  }
  const weldCleared = (p.weldingDoneCount || 0) >= total;
  const ndtCleared =
    ndtMethodCleared(p.rtDoneCount,   p.rtRequiredCount) &&
    ndtMethodCleared(p.pautDoneCount, p.pautRequiredCount) &&
    ndtMethodCleared(p.mtDoneCount,   p.mtRequiredCount) &&
    ndtMethodCleared(p.ptDoneCount,   p.ptRequiredCount);
  return weldCleared && ndtCleared;
}

// CANONICAL status for a Test Package. This is the ONE function the donut chart,
// the table's Hydrotest Status column, the row colour AND the sort order all use,
// so the chart and the table can never disagree again.
function getPackageStatus(p) {
  if (p.reinstStatus === "Done") return "reinst";   // reinstated (workflow complete)
  if (p.hydroStatus  === "Done") return "done";     // Sheet col Z has a hydro date
  if (isHydroReady(p))           return "ready";    // welding 100% + all NDT cleared
  if ((p.weldingDoneCount || 0) > 0 || (p.ndtDoneCount || 0) > 0) return "progress";
  return "pending";
}

// Hydrotest Status label shown in the System Detailed table -- DERIVED from the
// canonical status so it always matches the donut chart and the row colour.
//   Done  <- done / reinst    Ready <- ready    "-" <- progress / pending
function computeHydroDisplay(p) {
  const s = getPackageStatus(p);
  if (s === "done" || s === "reinst") return "Done";
  if (s === "ready") return "Ready";
  return "-";
}

// One NDT progress cell for the System Detailed table. Shows "N/A" when the
// method is not required for this Test Pack, otherwise the done/required bar.
function ndtCellHtml(done, req) {
  if ((req || 0) === 0) {
    return `<td class="text-center ndt-na-cell">N/A</td>`;
  }
  const pct = getProgressPct(done || 0, req || 0);
  return `<td class="data-bar-cell ndt-bar" style="--pct: ${pct}%">
        <div class="progress-cell-wrapper">
          <span class="fraction-text">${done || 0}/${req || 0}</span>
          <span class="percentage-text ${pctClass(pct)}">${pct}%</span>
        </div>
      </td>`;
}

function getStatusColor(status) {
  const colors = {
    done: '#10b981',       // Green
    ready: '#0ea5e9',      // Blue/Cyan
    progress: '#6366f1',   // Indigo
    reinst: '#f97316',     // Orange
    leak: '#a855f7',       // Purple
    pending: '#475569'     // Slate Gray
  };
  return colors[status] || colors.pending;
}

function getStatusLabel(status) {
  const labels = {
    done: 'Done Hydrotest',
    ready: 'Ready for Hydrotest',
    progress: 'Welding/NDT In-Progress',
    reinst: 'Reinstated',
    leak: 'Ready for Leak Test',
    pending: 'Pending'
  };
  return labels[status] || labels.pending;
}

function getDonutSlicePath(cx, cy, rIn, rOut, startAngle, endAngle) {
  const angleDiff = endAngle - startAngle;
  if (angleDiff >= 360) {
    return `M ${cx} ${cy - rOut} A ${rOut} ${rOut} 0 1 0 ${cx} ${cy + rOut} A ${rOut} ${rOut} 0 1 0 ${cx} ${cy - rOut} Z M ${cx} ${cy - rIn} A ${rIn} ${rIn} 0 1 1 ${cx} ${cy + rIn} A ${rIn} ${rIn} 0 1 1 ${cx} ${cy - rIn} Z`;
  }
  
  const rad1 = (startAngle - 90) * Math.PI / 180;
  const rad2 = (endAngle - 90) * Math.PI / 180;
  
  const xos = cx + rOut * Math.cos(rad1);
  const yos = cy + rOut * Math.sin(rad1);
  const xoe = cx + rOut * Math.cos(rad2);
  const yoe = cy + rOut * Math.sin(rad2);
  
  const xie = cx + rIn * Math.cos(rad2);
  const yie = cy + rIn * Math.sin(rad2);
  const xis = cx + rIn * Math.cos(rad1);
  const yis = cy + rIn * Math.sin(rad1);
  
  const largeArc = angleDiff > 180 ? 1 : 0;
  
  return `M ${xos} ${yos} A ${rOut} ${rOut} 0 ${largeArc} 1 ${xoe} ${yoe} L ${xie} ${yie} A ${rIn} ${rIn} 0 ${largeArc} 0 ${xis} ${yis} Z`;
}

function renderPieChart() {
  const packages = state.selectedSystemPackages;
  if (!packages || packages.length === 0) {
    deckLayoutContainer.innerHTML = `
      <div class="no-selection-message">
        <p>No Test Packages in this System.</p>
      </div>
    `;
    return;
  }

  // Ensure the layout container stretches children and fits panel height
  deckLayoutContainer.innerHTML = '';
  deckLayoutContainer.style.height = '100%';
  deckLayoutContainer.style.display = 'flex';
  deckLayoutContainer.style.flexDirection = 'column';
  deckLayoutContainer.style.flexWrap = 'nowrap';

  // 1. Create Split Container layout
  const container = document.createElement('div');
  container.className = 'overview-split-container';

  const chartSection = document.createElement('div');
  chartSection.className = 'overview-chart-section';

  const tableSection = document.createElement('div');
  tableSection.className = 'overview-table-section';

  // 2. Prepare SVG Donut Chart
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "-142 -142 284 284");
  svg.style.width = "100%";
  svg.style.height = "100%";
  // No maxWidth/maxHeight constraints, so it expands dynamically to fit parent panel height

  // Create or reuse global tooltip directly on document.body
  let tooltip = document.getElementById('svg-global-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'svg-global-tooltip';
    tooltip.className = 'svg-tooltip';
    document.body.appendChild(tooltip);
  }

  chartSection.appendChild(svg);

  // 3. Group and draw slices
  const statusGroups = {
    done: [],
    ready: [],
    progress: [],
    reinst: [],
    leak: [],
    pending: []
  };

  packages.forEach(p => {
    const status = getPackageStatus(p);
    if (statusGroups[status]) {
      statusGroups[status].push(p);
    } else {
      statusGroups.pending.push(p);
    }
  });

  const activeGroups = Object.entries(statusGroups).filter(([status, list]) => list.length > 0);
  const statusOrder = ['done', 'ready', 'progress', 'reinst', 'leak', 'pending'];
  activeGroups.sort((a, b) => statusOrder.indexOf(a[0]) - statusOrder.indexOf(b[0]));

  const N = packages.length;
  let startAngle = 0;

  activeGroups.forEach(([status, list]) => {
    const count = list.length;
    const groupAngle = 360 * (count / N);
    const endAngle = startAngle + groupAngle;

    const pathD = getDonutSlicePath(0, 0, 75, 125, startAngle, endAngle);

    const bisector = (startAngle + endAngle) / 2 - 90;
    const bisectorRad = bisector * Math.PI / 180;
    const dx = 8 * Math.cos(bisectorRad);
    const dy = 8 * Math.sin(bisectorRad);

    // Group to hold both path and text so they translate together on hover
    const isFiltered = state.selectedStatusFilter === status;
    const isAnyFilterActive = state.selectedStatusFilter !== null;

    const sliceGroup = document.createElementNS(svgNS, "g");
    sliceGroup.style.cursor = "pointer";
    sliceGroup.style.transition = "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s ease, opacity 0.25s ease";
    
    if (isFiltered) {
      sliceGroup.style.transform = `translate(${dx}px, ${dy}px)`;
      sliceGroup.style.filter = "drop-shadow(0 0 12px rgba(255,255,255,0.25)) brightness(1.15)";
      sliceGroup.style.opacity = "1";
    } else if (isAnyFilterActive) {
      sliceGroup.style.opacity = "0.3";
    } else {
      sliceGroup.style.opacity = "1";
    }

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathD);

    const color = getStatusColor(status);
    path.setAttribute("fill", color);
    path.setAttribute("stroke", "var(--bg-panel)");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linejoin", "round");

    sliceGroup.appendChild(path);

    const statusLabel = getStatusLabel(status);
    const pct = Math.round((count / N) * 100);

    // Add % label directly on the slice if it occupies at least 2%
    if (pct >= 2) {
      const lx = 100 * Math.cos(bisectorRad);
      const ly = 100 * Math.sin(bisectorRad);
      const textLabel = document.createElementNS(svgNS, "text");
      textLabel.setAttribute("x", lx);
      textLabel.setAttribute("y", ly);
      textLabel.setAttribute("text-anchor", "middle");
      textLabel.setAttribute("dominant-baseline", "central");
      textLabel.setAttribute("class", "donut-label");
      textLabel.textContent = `${pct}%`;
      sliceGroup.appendChild(textLabel);
    }

    // Minimal tooltip: status name + total packages + percentage only.
    const tooltipContent = `
      <strong>${statusLabel}</strong>
      <div style="font-weight: 700; color: ${color}; margin-top: 0.2rem;">
        ${count} Packages (${pct}%)
      </div>
    `;

    sliceGroup.addEventListener('mouseenter', () => {
      if (!isFiltered) {
        sliceGroup.style.transform = `translate(${dx}px, ${dy}px)`;
        sliceGroup.style.filter = "drop-shadow(0 0 10px rgba(255,255,255,0.15)) brightness(1.1)";
        sliceGroup.style.opacity = "1";
      }
      tooltip.innerHTML = tooltipContent;
      tooltip.style.opacity = '1';
    });

    sliceGroup.addEventListener('mousemove', (e) => {
      // Safe positioning using estimated dimensions to keep tooltip on-screen
      const tooltipWidth = 220;
      const tooltipHeight = 64;
      let x = e.clientX + 15;
      let y = e.clientY + 15;
      if (x + tooltipWidth > window.innerWidth) {
        x = e.clientX - tooltipWidth - 15;
      }
      if (y + tooltipHeight > window.innerHeight) {
        y = e.clientY - tooltipHeight - 15;
      }
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    });

    sliceGroup.addEventListener('mouseleave', () => {
      if (!isFiltered) {
        sliceGroup.style.transform = "translate(0px, 0px)";
        sliceGroup.style.filter = "none";
        if (isAnyFilterActive) {
          sliceGroup.style.opacity = "0.3";
        }
      }
      tooltip.style.opacity = '0';
    });

    // Handle click to filter detailed table
    sliceGroup.addEventListener('click', () => {
      if (state.selectedStatusFilter === status) {
        state.selectedStatusFilter = null; // Toggle off
      } else {
        state.selectedStatusFilter = status; // Toggle on
      }
      renderPieChart();
      renderDetailedTable();
    });

    svg.appendChild(sliceGroup);

    startAngle = endAngle;
  });

  // Render text inside donut hole
  const textGroup = document.createElementNS(svgNS, "g");
  textGroup.setAttribute("text-anchor", "middle");
  if (state.selectedStatusFilter !== null) {
    textGroup.style.cursor = "pointer";
    textGroup.style.pointerEvents = "auto";
    textGroup.addEventListener('click', () => {
      state.selectedStatusFilter = null;
      renderPieChart();
      renderDetailedTable();
    });
  } else {
    textGroup.style.pointerEvents = "none";
  }
  
  const countText = document.createElementNS(svgNS, "text");
  countText.setAttribute("y", "-12");
  countText.setAttribute("fill", "#ffffff");
  countText.setAttribute("font-size", "48");
  countText.setAttribute("font-weight", "800");
  countText.setAttribute("font-family", "var(--font-display)");
  countText.textContent = N;
  
  const labelText = document.createElementNS(svgNS, "text");
  labelText.setAttribute("y", "22");
  labelText.setAttribute("fill", "var(--text-muted)");
  labelText.setAttribute("font-size", "12");
  labelText.setAttribute("font-weight", "600");
  labelText.setAttribute("text-transform", "uppercase");
  labelText.setAttribute("letter-spacing", "0.05em");
  labelText.setAttribute("font-family", "var(--font-sans)");
  if (state.selectedStatusFilter !== null) {
    labelText.textContent = "CLEAR FILTER";
    labelText.setAttribute("fill", "var(--status-rej)");
  } else {
    labelText.textContent = N > 1 ? "Test Packages" : "Test Package";
  }
  
  const sysLabelText = document.createElementNS(svgNS, "text");
  sysLabelText.setAttribute("y", "45");
  sysLabelText.setAttribute("fill", "var(--status-ready)");
  sysLabelText.setAttribute("font-size", "15");
  sysLabelText.setAttribute("font-weight", "700");
  sysLabelText.setAttribute("font-family", "var(--font-display)");
  sysLabelText.textContent = `System: ${state.selectedSystem}`;
  
  textGroup.appendChild(countText);
  textGroup.appendChild(labelText);
  textGroup.appendChild(sysLabelText);
  svg.appendChild(textGroup);

  // 4. Calculate stats for the Status Table
  const totalPkgs = packages.length;
  const doneHydroPkgs = packages.filter(p => p.hydroStatus === "Done").length;
  const doneReinstPkgs = packages.filter(p => p.reinstStatus === "Done").length;
  
  let totalJoints = 0;
  let weldedJoints = 0;
  let ndtRequiredJoints = 0;
  let ndtDoneJoints = 0;
  
  packages.forEach(p => {
    totalJoints += p.totalJoints;
    weldedJoints += p.weldingDoneCount;
    ndtRequiredJoints += p.ndtRequiredCount;
    ndtDoneJoints += p.ndtDoneCount;
  });
  
  const weldPct = getProgressPct(weldedJoints, totalJoints);
  const ndtPct = getProgressPct(ndtDoneJoints, ndtRequiredJoints);
  const hydroPct = getProgressPct(doneHydroPkgs, totalPkgs);
  const reinstPct = getProgressPct(doneReinstPkgs, totalPkgs);

  tableSection.innerHTML = `
    <h4 style="font-family: var(--font-display); font-size: 0.8rem; color: #ffffff; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">System Summary</h4>
    <table class="overview-status-table">
      <thead>
        <tr>
          <th>Activity</th>
          <th>Progress</th>
          <th style="text-align: center;">% Done</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Welding</strong></td>
          <td>${weldedJoints} / ${totalJoints} Joints</td>
          <td style="text-align: center; color: var(--status-ready); font-weight: 700;">${weldPct}%</td>
        </tr>
        <tr>
          <td><strong>NDT Progress</strong></td>
          <td>${ndtDoneJoints} / ${ndtRequiredJoints} Joints</td>
          <td style="text-align: center; color: var(--status-progress); font-weight: 700;">${ndtPct}%</td>
        </tr>
        <tr>
          <td><strong>Hydrotest</strong></td>
          <td>${doneHydroPkgs} / ${totalPkgs} Packages</td>
          <td style="text-align: center; color: var(--status-done); font-weight: 700;">${hydroPct}%</td>
        </tr>
        <tr>
          <td><strong>Reinstatement</strong></td>
          <td>${doneReinstPkgs} / ${totalPkgs} Packages</td>
          <td style="text-align: center; color: var(--status-reinst); font-weight: 700;">${reinstPct}%</td>
        </tr>
      </tbody>
    </table>
  `;

  // 5. Assemble layout
  container.appendChild(chartSection);
  container.appendChild(tableSection);
  deckLayoutContainer.appendChild(container);
}

// ==========================================
// 5. BOTTOM RIGHT PANEL: DETAILED TABLE
// ==========================================
function renderDetailedTable() {
  const packages = state.selectedSystemPackages;
  
  // Filter based on search query in detailed actions, checking testPackageNo, lineNo, leakPkgNo AND uniqueLines!
  let filtered = state.packageSearchQuery === ''
    ? packages
    : packages.filter(p => {
        const query = state.packageSearchQuery;
        return p.testPackageNo.toLowerCase().includes(query) ||
               (p.lineNo && p.lineNo.toLowerCase().includes(query)) ||
               (p.uniqueLines && p.uniqueLines.some(l => l.toLowerCase().includes(query))) ||
               (p.leakPkgNo && p.leakPkgNo.toLowerCase().includes(query));
      });
      
  // Apply donut chart status filter
  if (state.selectedStatusFilter) {
    filtered = filtered.filter(p => getPackageStatus(p) === state.selectedStatusFilter);
  }

  // Apply potential hydrotest percentage filter
  if (state.potentialWeldThreshold !== null && state.potentialNdtThreshold !== null) {
    filtered = filtered.filter(p => {
      // Exclude packages that have already completed hydrotest or reinstatement
      if (p.hydroStatus === "Done" || p.reinstStatus === "Done") {
        return false;
      }
      
      let sWeldDone = p.weldingDoneCount || 0;
      let sWeldTotal = p.totalJoints || 0;
      let sNdtDone = p.ndtDoneCount || 0;
      let sNdtTotal = p.ndtRequiredCount || 0;
      
      const weldingPct = getProgressPct(sWeldDone, sWeldTotal);
      const ndtPct = getProgressPct(sNdtDone, sNdtTotal);
      
      return weldingPct >= state.potentialWeldThreshold && ndtPct >= state.potentialNdtThreshold;
    });
  }
      
  // Show / Hide Clear All Filters Button
  const clearAllBtn = document.getElementById('clear-all-filters-btn');
  const isAnyFilterActive = state.packageSearchQuery !== '' || 
                            state.selectedStatusFilter !== null || 
                            state.potentialWeldThreshold !== null || 
                            state.potentialNdtThreshold !== null;
  if (clearAllBtn) {
    clearAllBtn.style.display = isAnyFilterActive ? 'block' : 'none';
  }

  if (filtered.length === 0) {
    state.detailedVisiblePackages = [];   // nothing shown -> nothing to export
    detailedTableContainer.innerHTML = `
      <div class="no-selection-message">
        <p>No matching Test Packages found in this System.</p>
      </div>
    `;
    return;
  }

  // Group + sort rows by status: Done (and reinstated) on top, then Ready, then
  // the on-going packages -- and alphabetically by test package within each group.
  const statusPriority = {
    reinst: 0,    // reinstated (fully complete)
    done: 1,      // hydrotest done
    ready: 2,     // ready for hydrotest (welding 100% + NDT cleared)
    leak: 3,
    progress: 4,  // welding / NDT on-going
    pending: 5    // nothing started yet
  };

  filtered.sort((a, b) => {
    const pa = statusPriority[getPackageStatus(a)] ?? 99;
    const pb = statusPriority[getPackageStatus(b)] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.testPackageNo.localeCompare(b.testPackageNo);
  });

  // Exact set currently shown (search + pie-chart status + potential filters,
  // in display order) -> the "Export System Excel" button exports THIS (WYSIWYG).
  state.detailedVisiblePackages = filtered;

  // Build table shell (using auto-adjust column width by setting width: 1% on non-stretch columns)
  detailedTableContainer.innerHTML = `
    <table class="detailed-table">
      <thead>
        <tr>
          <th style="width: 1%; text-align: center;">#</th>
          <th style="width: 1%;">Test Package No</th>
          <th style="width: 1%; text-align: center;">Spools</th>
          <th style="width: 1%; text-align: center;">Joints</th>
          <th style="text-align: center;">% Welding</th>
          <th style="text-align: center; width: 8%;">RT</th>
          <th style="text-align: center; width: 8%;">PAUT</th>
          <th style="text-align: center; width: 8%;">MT</th>
          <th style="text-align: center; width: 8%;">PT</th>
          <th style="width: 1%; text-align: center;">Hydrotest Status</th>
          <th style="width: 1%;">Hydrotest Date</th>
          <th style="width: 1%; text-align: center;">Reins Status</th>
          <th style="width: 1%;">Re-ins Date</th>
          <th style="width: 200px;">Note</th>
        </tr>
      </thead>
      <tbody id="detailed-table-body">
      </tbody>
    </table>
  `;
  
  const tbody = document.getElementById('detailed-table-body');
  
  filtered.forEach((p, idx) => {
    let sWeldDone = p.weldingDoneCount || 0;
    let sWeldTotal = p.totalJoints || 0;

    // 1. Calculate % Welding
    const weldingPct = getProgressPct(sWeldDone, sWeldTotal);
    
    // 2. NDT cells (RT/PAUT/MT/PT) — each shows "N/A" when that method is not
    //    required for this Test Pack (required = 0), else a done/required bar.
    // Non-metallic (GRE/CPVC/PPR) packs don't require NDT -> force "N/A".
    const naCell = `<td class="text-center ndt-na-cell">N/A</td>`;
    const rtCell   = p.isNonMetallic ? naCell : ndtCellHtml(p.rtDoneCount,   p.rtRequiredCount);
    const pautCell = p.isNonMetallic ? naCell : ndtCellHtml(p.pautDoneCount, p.pautRequiredCount);
    const mtCell   = p.isNonMetallic ? naCell : ndtCellHtml(p.mtDoneCount,   p.mtRequiredCount);
    const ptCell   = p.isNonMetallic ? naCell : ndtCellHtml(p.ptDoneCount,   p.ptRequiredCount);

    // 3. Hydrotest status (Test-Pack level): Done > Ready > "-"
    const hydroDisplay = computeHydroDisplay(p);
    const hydroBadge = hydroDisplay === "Done" ? 'done' : (hydroDisplay === "Ready" ? 'ready' : 'not-yet');
    const hydroCellInner = hydroDisplay === "-"
      ? `<span class="hydro-dash">-</span>`
      : `<span class="status-badge ${hydroBadge}">${hydroDisplay}</span>`;
    const hydroDateText = (hydroDisplay === "Done" && p.hydroDate) ? formatDate(p.hydroDate) : "-";
    
    // 4. Reins status badge
    const reinstBadge = p.reinstStatus === "Done" ? 'done' : 'not-yet';
    const reinstDateText = p.reinstDate ? formatDate(p.reinstDate) : "-";
    
    // 5. Note column — "Inform: Drawing/Joint No./Component to Component" (column M)
    //    of the NDT Tracking Google Sheet (live); multi-line, sheet errors blanked.
    const noteRaw = (p.note || '').trim();
    const noteHtml = noteRaw ? escapeHtml(noteRaw).replace(/\n/g, '<br>') : '-';

    // 6. Status class — use shared getPackageStatus() to stay consistent with donut
    const statusClass = getPackageStatus(p);
    // Row tint, aligned with the donut/badge colours: Done (& reinstated) green,
    // Ready blue, everything on-going neutral.
    const rowTint = (statusClass === 'done' || statusClass === 'reinst') ? 'row-status-done'
                  : statusClass === 'ready' ? 'row-status-ready'
                  : 'row-status-ongoing';

    const rowId = `tp-row-${p.testPackageNo.replace(/\s+/g, '_')}`;

    const trHeader = document.createElement('tr');
    trHeader.id = rowId;
    trHeader.className = `tp-header-row ${rowTint}`;
    trHeader.setAttribute('data-tp', p.testPackageNo);
    trHeader.innerHTML = `
      <td class="text-center" style="color:var(--text-muted); font-weight:600;">${idx + 1}</td>
      <td><strong class="status-text ${statusClass}">${p.testPackageNo}</strong></td>
      <td class="text-center">${p.spoolsCount}</td>
      <td class="text-center">${p.totalJoints}</td>
      <td class="data-bar-cell weld-bar" style="--pct: ${weldingPct}%">
        <div class="progress-cell-wrapper">
          <span class="fraction-text">${sWeldDone}/${p.totalJoints}</span>
          <span class="percentage-text ${pctClass(weldingPct)}">${weldingPct}%</span>
        </div>
      </td>
      ${rtCell}
      ${pautCell}
      ${mtCell}
      ${ptCell}
      <td class="text-center">${hydroCellInner}</td>
      <td>${hydroDateText}</td>
      <td class="text-center"><span class="status-badge ${reinstBadge}">${p.reinstStatus}</span></td>
      <td>${reinstDateText}</td>
      <td class="note-cell" title="${escapeHtml(noteRaw)}" style="max-width:320px;"><div style="max-height:84px; overflow-y:auto; white-space:normal; word-break:break-word; font-size:0.72rem; line-height:1.35; color:var(--text-muted);">${noteHtml}</div></td>
    `;
    
    tbody.appendChild(trHeader);
    
    // Click on row pops up detail modal directly instead of expanding the table
    trHeader.addEventListener('click', () => {
      showTPDetailModal(p);
    });
  });

  // Make table columns resizable by user drag
  const detTable = detailedTableContainer.querySelector('table');
  if (detTable) makeTableResizable(detTable);
}



// Cross-panel link: Scroll to row and highlight detailed row
function highlightDetailedRow(tpName) {
  const rowId = `tp-row-${tpName.replace(/\s+/g, '_')}`;
  const rowEl = document.getElementById(rowId);
  
  if (rowEl) {
    // Scroll row into view
    rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Add brief flash animation class
    rowEl.style.transition = 'background 0.1s';
    rowEl.style.backgroundColor = 'rgba(14, 165, 233, 0.25)';
    
    setTimeout(() => {
      rowEl.style.transition = 'background 0.5s';
      rowEl.style.backgroundColor = '';
    }, 1000);
  }
}

// ==========================================
// 6. FILTERS & EVENT HANDLERS
// ==========================================
function setupEventListeners() {
  // "View all packages" -> reset filters and show the project-wide view.
  const viewAllBtn = document.getElementById('view-all-packages-btn');
  if (viewAllBtn) viewAllBtn.addEventListener('click', () => selectSystem('__ALL__'));

  // "Re-sync data" -> rebuild the dashboard precompute tables (incl. cold data)
  // straight from the current DB (Node/SQL equivalent of `etl --recheck-cold`).
  const resyncBtn = document.getElementById('resync-data-btn');
  if (resyncBtn) {
    resyncBtn.addEventListener('click', async () => {
      if (!confirm('Re-sync dashboard data?\n\nRebuilds the pre-computed tables (welding/NDT summary + S-curve, including cold / hydro-done packages) from the current database. Takes a few seconds.')) return;
      const label = document.getElementById('resync-data-label');
      const prev = label ? label.textContent : 'Re-sync data';
      resyncBtn.disabled = true;
      if (label) label.textContent = 'Re-syncing…';
      setDataStatus('loading', 'Re-syncing data…');
      try {
        const res = await fetch(getApiUrl('/api/resync'), { method: 'POST' });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || ('HTTP ' + res.status));
        await reloadFreshData();
        setDataStatus('ready', 'Data re-synced');
      } catch (e) {
        console.error('Re-sync failed:', e);
        setDataStatus('error', 'Re-sync failed');
        alert('Re-sync data failed:\n' + e.message);
      } finally {
        resyncBtn.disabled = false;
        if (label) label.textContent = prev;
      }
    });
  }

  // Search systems
  systemSearch.addEventListener('input', (e) => {
    handleSystemSearch(e);
    autoExpandInput(systemSearch, 180, 350);
  });
  autoExpandInput(systemSearch, 180, 350);
  
  // Search packages inside selected system
  const tpClearBtn = document.getElementById('tp-search-clear-btn');
  if (tpFilterInput && tpClearBtn) {
    tpFilterInput.addEventListener('input', (e) => {
      const val = e.target.value;
      state.packageSearchQuery = val.trim().toLowerCase();
      tpClearBtn.style.display = val.length > 0 ? 'flex' : 'none';
      autoExpandInput(tpFilterInput, 150, 350);
      renderDetailedTable();
    });
    
    tpClearBtn.addEventListener('click', () => {
      tpFilterInput.value = '';
      state.packageSearchQuery = '';
      tpClearBtn.style.display = 'none';
      autoExpandInput(tpFilterInput, 150, 350);
      renderDetailedTable();
      tpFilterInput.focus();
    });
    autoExpandInput(tpFilterInput, 150, 350);
  }
  
  // Potential Hydrotest Filter Event Handlers
  const potentialFilterBtn = document.getElementById('potential-filter-btn');
  const potentialClearBtn = document.getElementById('potential-clear-btn');
  const potentialWeldInput = document.getElementById('potential-weld-input');
  const potentialNdtInput = document.getElementById('potential-ndt-input');
  const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');

  if (potentialFilterBtn && potentialClearBtn && potentialWeldInput && potentialNdtInput) {
    potentialFilterBtn.addEventListener('click', () => {
      const weldVal = parseInt(potentialWeldInput.value, 10);
      const ndtVal = parseInt(potentialNdtInput.value, 10);
      
      state.potentialWeldThreshold = isNaN(weldVal) ? 90 : weldVal;
      state.potentialNdtThreshold = isNaN(ndtVal) ? 90 : ndtVal;
      
      potentialClearBtn.style.display = 'block';
      renderDetailedTable();
    });
    
    potentialClearBtn.addEventListener('click', () => {
      state.potentialWeldThreshold = null;
      state.potentialNdtThreshold = null;
      potentialWeldInput.value = '90';
      potentialNdtInput.value = '90';
      potentialClearBtn.style.display = 'none';
      renderDetailedTable();
    });
  }

  // Clear All Filters Button Click Listener
  if (clearAllFiltersBtn) {
    clearAllFiltersBtn.addEventListener('click', () => {
      // Clear quick filter search
      state.packageSearchQuery = '';
      if (tpFilterInput) {
        tpFilterInput.value = '';
        autoExpandInput(tpFilterInput, 150, 350);
      }
      const tpClearBtn = document.getElementById('tp-search-clear-btn');
      if (tpClearBtn) tpClearBtn.style.display = 'none';
      
      // Clear donut slice status filter
      state.selectedStatusFilter = null;
      
      // Clear potential filter
      state.potentialWeldThreshold = null;
      state.potentialNdtThreshold = null;
      if (potentialWeldInput) potentialWeldInput.value = '90';
      if (potentialNdtInput) potentialNdtInput.value = '90';
      if (potentialClearBtn) potentialClearBtn.style.display = 'none';
      
      // Re-render
      renderPieChart();
      renderDetailedTable();
    });
  }

  // Export CSV
  if (exportBtn) {
    exportBtn.addEventListener('click', exportSystemToCSV);
  }

  // Excel exports
  const exportGeneralBtn = document.getElementById('export-general-excel-btn');
  if (exportGeneralBtn) {
    exportGeneralBtn.addEventListener('click', () => {
      let dataToExport = state.systemsList;
      if (state.systemSearchQuery) {
        dataToExport = state.systemsList.filter(sys =>
          sys.system.toLowerCase().includes(state.systemSearchQuery)
        );
      }
      exportToExcel('general', dataToExport);
    });
  }

  const exportExcelBtn = document.getElementById('export-excel-btn');
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', () => {
      // WYSIWYG: export exactly the rows currently shown in System Detailed
      // (after the search box, pie-chart status filter and potential filter),
      // in the same order -- not the full original system data.
      const dataToExport = state.detailedVisiblePackages || [];
      if (dataToExport.length === 0) return;
      exportToExcel('detailed', dataToExport);
    });
  }

  const modalExportExcelBtn = document.getElementById('modal-export-excel-btn');
  if (modalExportExcelBtn) {
    modalExportExcelBtn.addEventListener('click', () => {
      if (!state.activePackage) return;
      exportToExcel('modal', state.activePackage);
    });
  }

  const modalExportBacklogBtn = document.getElementById('modal-export-backlog-btn');
  if (modalExportBacklogBtn) {
    modalExportBacklogBtn.addEventListener('click', () => {
      if (!state.activePackage) return;
      exportToExcel('modal-backlog', state.activePackage);
    });
  }

  const analyticsExportBtn = document.getElementById('analytics-export-excel-btn');
  if (analyticsExportBtn) {
    analyticsExportBtn.addEventListener('click', () => {
      exportToExcel('analytics', state.systemsList);
    });
  }
}

// ==========================================
// 7. CSV EXPORT & FORMATTING UTILITIES
// ==========================================
function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const day = String(date.getDate()).padStart(2, '0');
      const month = months[date.getMonth()];
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}
  return dateStr;
}

function exportSystemToCSV() {
  if (state.selectedSystemPackages.length === 0) return;
  
  // Headers
  const headers = [
    "System", "TestPackageNo", "Deck", "LeakPkgNo", "HydrotestStatus", "HydrotestDate",
    "ReinstatementStatus", "ReinstatementDate", "LeakStatus",
    "SpoolNo", "JointNo", "FitupACC", "WeldingCompletedDate",
    "RT", "RTResult", "PAUT", "PAUTResult", "UT", "UTResult",
    "MT", "MTResult", "PT", "PTResult", "PMI", "PMIReportDate",
    "PWHT", "PWHTResult", "Hardness", "HardnessTestReportDate",
    "MRIR01", "MRIR02"
  ];
  
  const csvRows = [];
  csvRows.push(headers.join(","));
  
  state.selectedSystemPackages.forEach(p => {
    const joints = p.joints || [];
    
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = val.toString().replace(/"/g, '""');
      return `"${str}"`;
    };
    
    const commonFields = [
      escapeCsv(state.selectedSystem),
      escapeCsv(p.testPackageNo),
      escapeCsv(p.deck),
      escapeCsv(p.leakPkgNo),
      escapeCsv(p.hydroStatus),
      escapeCsv(p.hydroDate),
      escapeCsv(p.reinstStatus),
      escapeCsv(p.reinstDate),
      escapeCsv(p.leakStatus)
    ];
    
    if (joints.length === 0) {
      // Package row only if no joints
      const emptyJointFields = Array(22).fill('""');
      csvRows.push([...commonFields, ...emptyJointFields].join(","));
    } else {
      joints.forEach(j => {
        const jointFields = [
          escapeCsv(j.spoolNo),
          escapeCsv(j.jointNo),
          escapeCsv(j.fitupAcc),
          escapeCsv(j.weldingCompletedDate),
          escapeCsv(j.rt),
          escapeCsv(j.rtResult),
          escapeCsv(j.paut),
          escapeCsv(j.pautResult),
          escapeCsv(j.ut),
          escapeCsv(j.utResult),
          escapeCsv(j.mt),
          escapeCsv(j.mtResult),
          escapeCsv(j.pt),
          escapeCsv(j.ptResult),
          escapeCsv(j.pmi),
          escapeCsv(j.pmiReportDate),
          escapeCsv(j.pwht),
          escapeCsv(j.pwhtResult),
          escapeCsv(j.hardness),
          escapeCsv(j.hardnessTestReportDate),
          escapeCsv(j.mrir01),
          escapeCsv(j.mrir02)
        ];
        csvRows.push([...commonFields, ...jointFields].join(","));
      });
    }
  });
  
  // Download trigger
  const csvContent = "\ufeff" + csvRows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = `${state.selectedSystem}_fabrication_export.csv`;
  
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Styled Excel Export using ExcelJS
 */
async function exportToExcel(tableType, data) {
  try {
    if (typeof ExcelJS === 'undefined') {
      alert("ExcelJS library is not loaded. Please check your internet connection and try again.");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    let worksheetName = 'Sheet1';
    let filename = 'export.xlsx';

    if (tableType === 'general' || tableType === 'analytics') {
      if (tableType === 'general') {
        worksheetName = 'General Info';
        filename = 'block_b_general_info.xlsx';
      } else {
        worksheetName = 'Project Progress Dashboard';
        filename = 'block_b_project_analytics.xlsx';
      }
    } else if (tableType === 'detailed') {
      worksheetName = `Detailed System ${state.selectedSystem}`;
      filename = `block_b_system_detailed_${state.selectedSystem}.xlsx`;
    } else if (tableType === 'modal' || tableType === 'modal-backlog') {
      const tpClean = data.testPackageNo.replace(/[^a-zA-Z0-9-_]/g, '_');
      if (tableType === 'modal-backlog') {
        worksheetName = 'Backlog Joints';
        filename = `block_b_backlog_${tpClean}.xlsx`;
      } else {
        worksheetName = 'Test Package Details';
        filename = `block_b_test_pack_${tpClean}.xlsx`;
      }
    } else if (tableType === 'database') {
      worksheetName = 'Fabrication & Testing Database';
      filename = 'block_b_piping_fabrication_database.xlsx';
    }

    const worksheet = workbook.addWorksheet(worksheetName, {
      views: [{ showGridLines: true }]
    });

    // Styles & Formatting Definitions
    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };

    const headerFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' } // Dark blue
    };

    const headerFont = {
      name: 'Segoe UI',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };

    const dataFont = {
      name: 'Segoe UI',
      size: 10,
      color: { argb: 'FF334155' }
    };

    const cellAlignment = {
      vertical: 'middle',
      horizontal: 'left'
    };

    const centerAlignment = {
      vertical: 'middle',
      horizontal: 'center'
    };

    if (tableType === 'general' || tableType === 'analytics') {
      // General Information Table
      worksheet.columns = [
        { header: 'System', key: 'system', width: 15 },
        { header: 'Welding Progress', key: 'weldProg', width: 20 },
        { header: 'Welding %', key: 'weldPct', width: 15 },
        { header: 'NDT Progress', key: 'ndtProg', width: 20 },
        { header: 'NDT %', key: 'ndtPct', width: 15 },
        { header: 'Hydrotest Progress', key: 'hydroProg', width: 20 },
        { header: 'Hydrotest %', key: 'hydroPct', width: 15 },
        { header: 'Reins Progress', key: 'reinstProg', width: 20 },
        { header: 'Reins %', key: 'reinstPct', width: 15 }
      ];

      data.forEach(sys => {
        const hydroPct = sys.hydrotestTotal > 0 ? (sys.hydrotestDone / sys.hydrotestTotal) : 0;
        const weldPct = sys.weldingTotal > 0 ? (sys.weldingDone / sys.weldingTotal) : 0;
        const ndtPct = sys.ndtTotal > 0 ? (sys.ndtDone / sys.ndtTotal) : 0;
        const reinstPct = sys.reinstTotal > 0 ? (sys.reinstDone / sys.reinstTotal) : 0;

        worksheet.addRow({
          system: sys.system,
          weldProg: `${sys.weldingDone}/${sys.weldingTotal}`,
          weldPct: weldPct,
          ndtProg: `${sys.ndtDone}/${sys.ndtTotal}`,
          ndtPct: ndtPct,
          hydroProg: `${sys.hydrotestDone}/${sys.hydrotestTotal}`,
          hydroPct: hydroPct,
          reinstProg: `${sys.reinstDone}/${sys.reinstTotal}`,
          reinstPct: reinstPct
        });
      });

      // Style Table
      worksheet.getRow(1).eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.border = thinBorder;
        cell.alignment = centerAlignment;
      });

      const getColorForPct = (val) => {
        if (val >= 1.0) {
          return { fill: 'FFE2F0D9', font: 'FF385723' }; // Soft Green
        } else if (val > 0.5) {
          return { fill: 'FFFFF2CC', font: 'FF7F6000' }; // Soft Yellow
        } else {
          return { fill: 'FFFCE4D6', font: 'FFC65911' }; // Soft Red
        }
      };

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        
        row.eachCell((cell, colNumber) => {
          cell.font = dataFont;
          cell.border = thinBorder;
          cell.alignment = (colNumber === 1) ? cellAlignment : centerAlignment;

          // Format percentage columns
          if ([3, 5, 7, 9].includes(colNumber)) {
            cell.numFmt ='0%';
            
            const colorScheme = getColorForPct(cell.value);
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: colorScheme.fill }
            };
            cell.font = {
              name: 'Segoe UI',
              size: 10,
              bold: true,
              color: { argb: colorScheme.font }
            };
          }
        });
      });

    } else if (tableType === 'detailed') {
      // System Detailed Table
      worksheet.columns = [
        { header: 'Test Package No', key: 'tpNo', width: 25 },
        { header: 'Line No', key: 'lineNo', width: 35 },
        { header: 'Spools', key: 'spools', width: 10 },
        { header: 'Joints', key: 'joints', width: 10 },
        { header: '% Welding', key: 'weldPct', width: 12 },
        { header: 'NDT Progress', key: 'ndtStatus', width: 15 },
        { header: 'Hydrotest Status', key: 'hydroStatus', width: 18 },
        { header: 'Hydrotest Date', key: 'hydroDate', width: 15 },
        { header: 'Reins Status', key: 'reinstStatus', width: 15 },
        { header: 'Re-ins Date', key: 'reinstDate', width: 15 },
        { header: 'Leak Status', key: 'leakStatus', width: 15 },
        { header: 'Leak Package No', key: 'leakPkgNo', width: 20 },
        { header: 'Note (Inform)', key: 'note', width: 50 }
      ];

      data.forEach(p => {
        const jointsList = p.joints || [];
        // Project-wide export ships metadata only (no joints) -> fall back to the
        // package-level welding count so the % is still populated.
        const weldPct = jointsList.length > 0
          ? (p.totalJoints > 0 ? jointsList.filter(j => j.weldingDone && j.ndtDone).length / p.totalJoints : 0)
          : (p.totalJoints > 0 ? (p.weldingDoneCount || 0) / p.totalJoints : 0);
        const ndtPct = p.ndtRequiredCount > 0 ? (p.ndtDoneCount / p.ndtRequiredCount) : 0;
        const reinstDateVal = p.reinstDate ? new Date(p.reinstDate) : null;
        const hydroDateVal = p.hydroDate ? new Date(p.hydroDate) : null;

        worksheet.addRow({
          tpNo: p.testPackageNo,
          lineNo: p.lineNo,
          spools: p.spoolsCount,
          joints: p.totalJoints,
          weldPct: weldPct,
          ndtStatus: p.isNonMetallic ? 'N/A' : ndtPct,
          hydroStatus: computeHydroDisplay(p),
          hydroDate: hydroDateVal,
          reinstStatus: p.reinstStatus,
          reinstDate: reinstDateVal,
          leakStatus: p.leakStatus || '-',
          leakPkgNo: p.leakPkgNo || '-',
          note: (p.note || '').trim() || '-'
        });
      });

      // Style Table
      worksheet.getRow(1).eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.border = thinBorder;
        cell.alignment = centerAlignment;
      });

      const statusColors = {
        done: 'FF10B981',       // Green
        ready: 'FF0EA5E9',      // Blue/Cyan
        progress: 'FF6366F1',   // Indigo
        reinst: 'FFF97316',     // Orange
        leak: 'FFA855F7',       // Purple
        pending: 'FF475569'     // Slate Gray
      };

      const getPctColor = (val) => {
        if (val >= 1.0) {
          return { fill: 'FFE2F0D9', font: 'FF385723' }; // Soft Green
        } else if (val > 0.5) {
          return { fill: 'FFFFF2CC', font: 'FF7F6000' }; // Soft Yellow
        } else {
          return { fill: 'FFFCE4D6', font: 'FFC65911' }; // Soft Red
        }
      };

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;

        const packageObj = data[rowNumber - 2];
        let statusKey = "pending";
        if (packageObj.leakStatus === "Ready for testing") statusKey = "leak";
        else if (packageObj.reinstStatus === "Done") statusKey = "reinst";
        else if (packageObj.hydroStatus === "Done") statusKey = "done";
        else if (packageObj.hydroStatus === "Ready for Test") statusKey = "ready";
        else if (packageObj.weldingDoneCount > 0 || packageObj.ndtDoneCount > 0) statusKey = "progress";

        const statusColorHex = statusColors[statusKey] || statusColors.pending;

        row.eachCell((cell, colNumber) => {
          cell.font = dataFont;
          cell.border = thinBorder;
          // No row background fills anymore (clean rows)

          // 1. Color only the Test Package No (col 1) font
          if (colNumber === 1) {
            cell.font = {
              name: 'Segoe UI',
              size: 10,
              bold: true,
              color: { argb: statusColorHex }
            };
          }

          // 2. Color only the Welding & NDT Progress cells (cols 5 and 6).
          //    Skip when the value isn't numeric (non-metallic NDT shows "N/A").
          if ([5, 6].includes(colNumber) && typeof cell.value === 'number') {
            cell.numFmt ='0%';
            const pctColor = getPctColor(cell.value);
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: pctColor.fill }
            };
            cell.font = {
              name: 'Segoe UI',
              size: 10,
              bold: true,
              color: { argb: pctColor.font }
            };
          }

          // Alignment
          if (colNumber === 13) {
            // Note (Inform): multi-line -> wrap so every joint line is visible.
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
          } else if ([1, 2, 12].includes(colNumber)) {
            cell.alignment = cellAlignment;
          } else {
            cell.alignment = centerAlignment;
          }

          // Date formats
          if ([8, 10].includes(colNumber)) {
            cell.numFmt ='dd-mmm-yyyy';
          }
        });
      });

    } else if (tableType === 'modal' || tableType === 'modal-backlog') {
      // Test Package Details (Modal) Joints Table
      // Non-metallic (GRE/CPVC/PPR): Welding -> Visual (raw VisualACC), methods -> N/A.
      const nm = !!data.isNonMetallic;
      worksheet.columns = [
        { header: 'Spool No', key: 'spoolNo', width: 20 },
        { header: 'Line No', key: 'lineNo', width: 30 },
        { header: 'Joint No', key: 'jointNo', width: 10 },
        { header: 'Fit Up', key: 'fitUp', width: 12 },
        { header: nm ? 'Visual' : 'Welding', key: 'welding', width: 12 },
        { header: 'RT', key: 'rt', width: 10 },
        { header: 'PAUT', key: 'paut', width: 10 },
        { header: 'UT', key: 'ut', width: 10 },
        { header: 'MT', key: 'mt', width: 10 },
        { header: 'PT', key: 'pt', width: 10 },
        { header: 'PMI', key: 'pmi', width: 10 },
        { header: 'PWHT', key: 'pwht', width: 10 },
        { header: 'Hardness', key: 'hardness', width: 10 }
      ];

      let joints = data.joints || [];
      if (tableType === 'modal-backlog') {
        joints = joints.filter(j => isJointBacklog(computeJointStatus(j)));
      }

      const cell = (v) => (v === null || v === undefined || v === '') ? '-' : v;
      const na = (v) => nm ? 'N/A' : cell(v);   // non-metallic: NDT/test methods are N/A
      joints.forEach(j => {
        const s = computeJointStatus(j);
        worksheet.addRow({
          spoolNo: j.spoolNo || '-',
          lineNo: j.line || '-',
          jointNo: j.jointNo || '-',
          fitUp: cell(s.fitUp),
          welding: nm ? cell(j.visualAcc) : cell(s.welding),
          rt: na(s.rt),
          paut: na(s.paut),
          ut: na(s.ut),
          mt: na(s.mt),
          pt: na(s.pt),
          pmi: na(s.pmi),
          pwht: na(s.pwht),
          hardness: na(s.hardness)
        });
      });

      if (joints.length === 0) {
        worksheet.addRow({ spoolNo: 'No backlog joints in this Test Package.' });
      }

      // Style Table
      worksheet.getRow(1).eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.border = thinBorder;
        cell.alignment = centerAlignment;
      });

      const cellColors = {
        done: { fill: 'FFE2F0D9', font: 'FF385723' },       // Soft Green
        req: { fill: 'FFDDEBF7', font: 'FF1F4E78' },        // Soft Blue
        rej: { fill: 'FFF8D7DA', font: 'FF721C24' },        // Soft Red
        backlog: { fill: 'FFFFF2CC', font: 'FF7F6000' },    // Soft Amber
        pending: { fill: 'FFF2F2F2', font: 'FF595959' }     // Soft Gray
      };

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;

        row.eachCell((cell, colNumber) => {
          cell.font = dataFont;
          cell.border = thinBorder;
          cell.alignment = (colNumber <= 2) ? cellAlignment : centerAlignment;

          // Color code test cells in columns 4 to 13
          if (colNumber >= 4) {
            const val = cell.value ? cell.value.toString().trim().toUpperCase() : '';
            let scheme = cellColors.pending;

            if (val === 'ACC' || val === 'DONE') {
              scheme = cellColors.done;
            } else if (val === 'BACKLOG') {
              scheme = cellColors.backlog;
            } else if (val === 'REQ' || val === 'X') {
              scheme = cellColors.req;
            } else if (val === 'REJ') {
              scheme = cellColors.rej;
            } else if (val === '-' || val === 'N/A' || val === 'PENDING' || val === 'NY') {
              scheme = cellColors.pending;
            }

            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: scheme.fill }
            };
            cell.font = {
              name: 'Segoe UI',
              size: 10,
              bold: (scheme !== cellColors.pending),
              color: { argb: scheme.font }
            };
          }
        });
      });
    } else if (tableType === 'database') {
      worksheet.columns = DB_COLUMNS.map(col => ({
        header: col.name,
        key: col.key,
        width: 15
      }));

      data.forEach(row => {
        const rowData = {};
        DB_COLUMNS.forEach(col => {
          rowData[col.key] = row[col.key] !== null && row[col.key] !== undefined ? row[col.key] : '-';
        });
        worksheet.addRow(rowData);
      });

      // Style Table
      worksheet.getRow(1).eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.border = thinBorder;
        cell.alignment = centerAlignment;
      });

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell, colNumber) => {
          cell.font = dataFont;
          cell.border = thinBorder;
          if (colNumber <= 6) {
            cell.alignment = cellAlignment;
          } else {
            cell.alignment = centerAlignment;
          }
        });
      });
    }

    // Auto-fit column widths
    if (tableType !== 'database') {
      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          let valStr = '';
          if (cell.value !== null && cell.value !== undefined) {
            if (cell.value instanceof Date) {
              valStr = '12-Dec-2026'; // Mock standard date length
            } else {
              valStr = cell.value.toString();
            }
          }
          if (valStr.length > maxLength) {
            maxLength = valStr.length;
          }
        });
        column.width = Math.max(maxLength + 4, 12);
      });
    } else {
      // For large database, use static predefined widths to ensure high-performance export
      worksheet.columns.forEach(column => {
        const colKey = column.key;
        const pixelWidth = getColWidth(colKey);
        column.width = Math.max(Math.round(pixelWidth / 8) + 2, 10);
      });
    }

    // Download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

  } catch (error) {
    console.error("Excel generation failed:", error);
    alert("Error generating Excel: " + error.message);
  }
}

// ==========================================
// 8. TEST PACKAGE DETAILS PREVIEW MODAL
// ==========================================
// Per-joint status per the business definitions (shared by the modal display and
// both Excel exports so they never diverge).
//   Welding : Done if WeldingCompletedDate set; Backlog if Visual Done (VisualACC=ACC)
//             but no welding date; else Pending.
//   RT/PAUT/UT/MT/PT : Done if Result=ACC; REJ if rejected; Backlog if required
//             (=x) and Visual Done but Result empty; Req if required but not ready.
//   PMI/PWHT/Hardness : Done if ReportNo set; else Req (no backlog state).
//   Returns null for a method that is not required ('-').
// REPAIR JOINTS (RT/PAUT REJ -> '<base>#R1' -> max '<base>#R2'): "virtual" status
// inheritance. A weld superseded by a LATER repair (a higher #R exists for the same
// base, scoped by drawing) virtually counts as ACC; only the latest generation's real
// result counts. The UI still shows the RAW result (REJ stays visible). Mutates each
// joint, adding virtualRTResult / virtualPAUTResult.
//   NOTE: %RT/%PAUT + Hydrotest-Ready in the Testing Status table and Dashboard Zone 2
//   are computed SERVER-side from testpack_summary, which applies the SAME rule in SQL
//   (rep_idx < max_idx). This client copy keeps the modal's per-joint view consistent
//   and is the reusable Vanilla-JS implementation of the state machine.
function applyVirtualRepairResults(joints) {
  if (!Array.isArray(joints)) return joints;
  const parse = (jn) => {
    // Correction generation so a later fix supersedes an earlier one (matches build_sqlite.py /
    // etl_delta_sync.py): original 0 ; #R1/#RW/#RS 1 ; #R2/#RWR1/#RSR1 2. Reweld #RW and reshoot
    // #RS count like repair #R (all suffixes start with '#R'); a bare #PWHT recheck stays its base.
    const s = String(jn == null ? '' : jn);
    const at = s.search(/#R/i);                      // first '#R' (all corrections start with it)
    if (at < 0) return { base: s, idx: 0 };
    const suf = s.slice(at + 1).toUpperCase().replace(/PWHT$/, '');   // e.g. R1, RW, RWR1, R2, RS
    const rdig = (suf.match(/R\d+/g) || []).reduce((a, t) => a + parseInt(t.slice(1), 10), 0);
    let idx = rdig + (suf.match(/[WS]/g) || []).length;
    if (idx === 0 && suf !== '') idx = 1;
    return { base: s.slice(0, at), idx };
  };
  const maxIdx = {};
  for (const j of joints) {
    const { base, idx } = parse(j.jointNo);
    const key = (j.drawingNo || '') + ' ' + base;
    if (!(key in maxIdx) || idx > maxIdx[key]) maxIdx[key] = idx;
  }
  for (const j of joints) {
    const { base, idx } = parse(j.jointNo);
    const key = (j.drawingNo || '') + ' ' + base;
    const superseded = idx < maxIdx[key];   // a newer repair exists -> virtually ACC
    j.virtualRTResult   = superseded ? 'ACC' : (j.rtResult   || '');
    j.virtualPAUTResult = superseded ? 'ACC' : (j.pautResult || '');
  }
  return joints;
}

function computeJointStatus(j) {
  const up = (v) => (v === null || v === undefined ? '' : v.toString().trim().toUpperCase());
  const has = (v) => v !== null && v !== undefined && v.toString().trim() !== '';
  const visualDone = up(j.visualAcc) === 'ACC';

  let welding;
  if (has(j.weldingCompletedDate)) welding = 'Done';
  else if (visualDone) welding = 'Backlog';
  else welding = 'Pending';

  const resultStatus = (required, result) => {
    if (up(required) !== 'X') return null;            // not required
    const r = up(result);
    if (r === 'ACC') return 'Done';
    if (r === 'REJ') return 'REJ';
    // required but no result: Backlog if the joint is visual-accepted (ready),
    // otherwise NY (not yet — joint not ready for this NDT).
    if (!has(result)) return visualDone ? 'Backlog' : 'NY';
    return result;                                    // any other raw value
  };
  const reportStatus = (required, reportNo) => {
    if (up(required) !== 'X') return null;
    return has(reportNo) ? 'Done' : 'Req';
  };

  return {
    fitUp: has(j.fitupAcc) ? j.fitupAcc : null,
    welding,
    rt: resultStatus(j.rt, j.rtResult),
    paut: resultStatus(j.paut, j.pautResult),
    ut: resultStatus(j.ut, j.utResult),
    mt: resultStatus(j.mt, j.mtResult),
    pt: resultStatus(j.pt, j.ptResult),
    pmi: reportStatus(j.pmi, j.pmiReportNo),
    pwht: reportStatus(j.pwht, j.pwhtReportNo),
    hardness: reportStatus(j.hardness, j.hardnessTestReportNo),
  };
}

// A joint is "backlog" when any backlog-capable column is in the Backlog state
// (Welding, RT, PAUT, UT, MT, PT -- per the business definitions).
function isJointBacklog(status) {
  return ['welding', 'rt', 'paut', 'ut', 'mt', 'pt'].some(k => status[k] === 'Backlog');
}

// Lazy-load a package's joints. The project-wide ("View all packages") view ships
// package metadata only (no joint arrays), so on first open we fetch the package's
// system once, cache it, and copy the joints onto the package object.
async function ensurePackageJoints(p) {
  if (Array.isArray(p.joints) && p.joints.length > 0) return;
  if (!p.system || p.system === '__ALL__' || !p.testPackageNo) return;
  try {
    // Lean drill-down: fetch ONLY this package's joints (a few dozen rows) instead of
    // the whole system. The package list ships without joints (precompute).
    const res = await fetch(getApiUrl(
      `/api/joints?sys=${encodeURIComponent(p.system)}&pkg=${encodeURIComponent(p.testPackageNo)}`));
    if (!res.ok) return;
    const joints = await res.json();
    if (!Array.isArray(joints)) return;
    p.joints = joints;
    // Line info isn't in the package list -> derive it from the joints for the modal.
    const lines = [...new Set(joints.map(j => j.line).filter(l => l && String(l).trim() !== ''))].sort();
    if (lines.length) { p.uniqueLines = lines; if (!p.lineNo) p.lineNo = lines[0]; }
  } catch (e) {
    console.error('Lazy joints load failed:', e.message);
  }
}

async function showTPDetailModal(p) {
  state.activePackage = p;
  const modal = document.getElementById('tp-detail-modal');
  const modalTitle = document.getElementById('modal-tp-title');
  const modalBody = document.getElementById('modal-body-content');

  modalTitle.textContent = `Test Package Details: ${p.testPackageNo}`;

  // In the project-wide view joints aren't preloaded -> fetch them on demand.
  if ((!Array.isArray(p.joints) || p.joints.length === 0) && p.system && p.system !== '__ALL__') {
    modal.style.display = 'flex';
    modalBody.innerHTML = `<div class="no-selection-message" style="padding:3rem;"><div class="loading-spinner-small"></div><p>Loading joint details…</p></div>`;
    await ensurePackageJoints(p);
  }

  // Repair joints: annotate virtual RT/PAUT (superseded -> ACC). The per-joint view
  // below still shows the RAW result; this just flags superseded REJ welds with ↻.
  applyVirtualRepairResults(p.joints || []);

  // Calculate percentages
  const weldPct = getProgressPct(p.weldingDoneCount, p.totalJoints);
  const ndtPct = getProgressPct(p.ndtDoneCount, p.ndtRequiredCount);

  // Aggregate backlog / NY counts from the joints (shared definitions)
  const _joints = p.joints || [];
  let weldBacklogCount = 0, nyFitupCount = 0;
  const ndtBacklog = { rt: 0, paut: 0, mt: 0, pt: 0 };
  _joints.forEach(j => {
    const s = computeJointStatus(j);
    if (s.welding === 'Backlog') weldBacklogCount++;
    // NY Fit-up = FitUpACC is not 'ACC' (blank or REJ)
    if ((j.fitupAcc || '').toString().trim().toUpperCase() !== 'ACC') nyFitupCount++;
    ['rt', 'paut', 'mt', 'pt'].forEach(m => { if (s[m] === 'Backlog') ndtBacklog[m]++; });
  });
  const ndtBacklogTotal = ndtBacklog.rt + ndtBacklog.paut + ndtBacklog.mt + ndtBacklog.pt;

  // Format line number with tooltip badge if there are multiple lines
  const uniqueLines = p.uniqueLines || [];
  let lineValueHtml = p.lineNo;
  if (uniqueLines.length > 1) {
    const tooltipText = uniqueLines.join('\n');
    lineValueHtml = `${uniqueLines[0]} <span class="lines-count-badge" title="${tooltipText}">(+${uniqueLines.length - 1} lines)</span>`;
  }
  
  // Non-metallic (GRE/CPVC/PPR): no welding-date / NDT required. Drives the meta grid,
  // the joint table, and the warning banner.
  const nm = !!p.isNonMetallic;
  const nmMat = p.nonMetallicMaterial || 'Non-metallic';
  const naMethodCell = `<td class="text-center" style="color:var(--text-faded);">N/A</td>`;

  // Render metadata grid
  let metaGridHtml = `
    <div class="modal-meta-grid">
      <div class="meta-item">
        <span class="meta-label">System</span>
        <span class="meta-value">${p.system}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Leak Package No</span>
        <span class="meta-value">${p.leakPkgNo || 'N/A'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Fabrication Information</span>
        <span class="meta-value">
          Spools: ${p.spoolsCount} &bull; Joints: ${p.totalJoints}
        </span>
      </div>
      <div class="meta-item">
        <span class="meta-label">${nm ? 'Visual Progress' : 'Welding Progress'}</span>
        <span class="meta-value">
          ${p.weldingDoneCount}/${p.totalJoints} (${weldPct}%)<br/>
          <small style="color: var(--text-faded);">
            ${nm ? '' : `Backlog: <span style="color:#fbbf24; font-weight:700;">${weldBacklogCount}</span> &bull; `}NY Fit-up: <span style="color:#cbd5e1; font-weight:700;">${nyFitupCount}</span>
          </small>
        </span>
      </div>
      <div class="meta-item">
        <span class="meta-label">NDT Complete</span>
        <span class="meta-value">
          ${nm ? `<span style="color:var(--text-faded);">N/A — not required for ${escapeHtml(nmMat)}</span>` : `${p.ndtDoneCount}/${p.ndtRequiredCount} (${ndtPct}%)<br/>
          <small style="color: var(--text-faded);">
            Backlog <span style="color:#fbbf24; font-weight:700;">${ndtBacklogTotal}</span>
            <span style="font-size:0.92em;">(RT:${ndtBacklog.rt} PAUT:${ndtBacklog.paut} MT:${ndtBacklog.mt} PT:${ndtBacklog.pt})</span>
          </small>`}
        </span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Testing Dates</span>
        <span class="meta-value">
          Hydro: <small>${p.hydroDate ? formatDate(p.hydroDate) : 'Pending'}</small><br/>
          Reins: <small>${p.reinstDate ? formatDate(p.reinstDate) : 'Not Yet'}</small>
        </span>
      </div>
    </div>
  `;

  
  // Render joint table body
  const getBadgeClass = (val) => {
    if (!val) return "tag pending-tag";
    const cleanVal = val.toString().trim().toUpperCase();
    if (cleanVal === "ACC" || cleanVal === "DONE") return "tag done-tag";
    if (cleanVal === "REJ") return "tag rej-tag";
    if (cleanVal === "BACKLOG") return "tag backlog-tag";
    if (cleanVal === "NY") return "tag ny-tag";
    if (cleanVal === "X" || cleanVal === "REQ") return "tag req-tag";
    return "tag";
  };

  const formatCell = (val) => {
    if (val === null || val === undefined || val === "" ||
        (typeof val === "number" && isNaN(val)) ||
        String(val).trim().toLowerCase() === "nan") return "";
    return val;
  };

  const joints = p.joints || [];
  let jointsRows = joints.map(j => {
    const s = computeJointStatus(j);
    const weldingCell = nm
      ? `<td class="text-center"><span class="${getBadgeClass(j.visualAcc)}">${formatCell(j.visualAcc)}</span></td>`
      : `<td class="text-center"><span class="${getBadgeClass(s.welding)}">${formatCell(s.welding)}</span></td>`;
    const methodCell = (st) => nm ? naMethodCell
      : `<td class="text-center"><span class="${getBadgeClass(st)}">${formatCell(st)}</span></td>`;
    // RT/PAUT: show the RAW result, but flag a weld superseded by a repair (#R) with a
    // ↻ -- it reads REJ yet counts as ACC for %/Ready (matches the server rule).
    const repTag = (raw, virt) => (virt === 'ACC' && ['REJ', 'RS'].includes(String(raw || '').toUpperCase()))
      ? ' <span title="Superseded by a repair/reweld/reshoot joint (#R/#RW/#RS) — counts as ACC for %/Ready" style="color:#22c55e;font-weight:800;">↻</span>' : '';
    const rtPautCell = (st, raw, virt) => nm ? naMethodCell
      : `<td class="text-center"><span class="${getBadgeClass(st)}">${formatCell(st)}</span>${repTag(raw, virt)}</td>`;
    return `
      <tr>
        <td><strong>${formatCell(j.spoolNo)}</strong></td>
        <td><small style="color: var(--text-muted); font-size: 0.65rem;">${formatCell(j.line)}</small></td>
        <td class="text-center">${formatCell(j.jointNo)}</td>
        <td class="text-center"><span class="${getBadgeClass(s.fitUp)}">${formatCell(s.fitUp)}</span></td>
        ${weldingCell}
        ${rtPautCell(s.rt, j.rtResult, j.virtualRTResult)}
        ${rtPautCell(s.paut, j.pautResult, j.virtualPAUTResult)}
        ${methodCell(s.ut)}
        ${methodCell(s.mt)}
        ${methodCell(s.pt)}
        ${methodCell(s.pmi)}
        ${methodCell(s.pwht)}
        ${methodCell(s.hardness)}
      </tr>
    `;
  }).join('');
  
  let jointsTableHtml = `
    <h4 style="font-family: var(--font-display); font-size: 0.85rem; color: #ffffff; margin-bottom: 0.6rem; text-transform: uppercase;">Joint-by-Joint Detailed Log</h4>
    <div class="table-container" style="border-top: 1px solid rgba(255, 255, 255, 0.05); max-height: 72vh;">
      <table class="joints-detail-table">
        <thead>
          <tr>
            <th style="width: 20%;">Spool No</th>
            <th style="width: 20%;">Line No</th>
            <th style="width: 6%; text-align: center;">Joint</th>
            <th style="width: 7%; text-align: center;">Fit Up</th>
            <th style="width: 7%; text-align: center;">${nm ? 'Visual' : 'Welding'}</th>
            <th class="ndt-subhead" style="width: 5%;">RT</th>
            <th class="ndt-subhead" style="width: 5%;">PAUT</th>
            <th class="ndt-subhead" style="width: 5%;">UT</th>
            <th class="ndt-subhead" style="width: 5%;">MT</th>
            <th class="ndt-subhead" style="width: 5%;">PT</th>
            <th class="ndt-subhead" style="width: 5%;">PMI</th>
            <th class="ndt-subhead" style="width: 5%;">PWHT</th>
            <th class="ndt-subhead" style="width: 5%;">Hard</th>
          </tr>
        </thead>
        <tbody>
          ${jointsRows}
        </tbody>
      </table>
    </div>
  `;
  
  // Non-metallic warning banner at the top of the modal body.
  const nonMetallicBanner = nm ? `
    <div class="nonmetal-banner" style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.8rem; padding:0.5rem 0.8rem; background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.4); border-radius:6px; color:#d8b4fe; font-size:0.8rem; font-weight:600;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
      Material ${escapeHtml(nmMat)} not required Welding nor NDT.
    </div>` : '';
  modalBody.innerHTML = nonMetallicBanner + metaGridHtml + jointsTableHtml;
  
  // Make the modal table columns resizable by user drag
  const modalTable = modalBody.querySelector('table');
  if (modalTable) makeTableResizable(modalTable);
  modal.style.display = 'flex';
  
  // Handle closing
  const closeBtn = document.getElementById('modal-close-btn');
  const closeModal = () => {
    modal.style.display = 'none';
  };
  
  closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
}

// ==========================================
// 9. RESIZABLE SPLITTERS & HELPERS
// ==========================================
function extractLineSize(lineNo) {
  if (!lineNo) return null;
  const parts = lineNo.replace(/\s+/g, '').split('-');
  for (const part of parts) {
    if (part.includes('"')) {
      return part;
    }
  }
  return null;
}

function initResizablePanels() {
  const leftPanelWidth = localStorage.getItem('--left-panel-width');
  const topPanelHeight = localStorage.getItem('--top-panel-height');
  const dbLeftPanelWidth = localStorage.getItem('--db-left-panel-width');
  
  if (leftPanelWidth) {
    document.documentElement.style.setProperty('--left-panel-width', leftPanelWidth);
  }
  if (topPanelHeight) {
    document.documentElement.style.setProperty('--top-panel-height', topPanelHeight);
  }
  if (dbLeftPanelWidth) {
    document.documentElement.style.setProperty('--db-left-panel-width', dbLeftPanelWidth);
  }
  
  setupSplitters();
}

function setupSplitters() {
  const mainSplitter = document.getElementById('main-splitter');
  const rightSplitter = document.getElementById('right-splitter');
  const dbMainSplitter = document.getElementById('db-main-splitter');

  if (mainSplitter) {
    mainSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--left-panel-width') || '360px');
      
      const onMouseMove = (moveEvent) => {
        let newWidth = startWidth + (moveEvent.clientX - startX);
        if (newWidth < 280) newWidth = 280;
        if (newWidth > 600) newWidth = 600;
        document.documentElement.style.setProperty('--left-panel-width', `${newWidth}px`);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const finalWidth = getComputedStyle(document.documentElement).getPropertyValue('--left-panel-width');
        localStorage.setItem('--left-panel-width', finalWidth);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  if (dbMainSplitter) {
    dbMainSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--db-left-panel-width') || '280px');
      
      const onMouseMove = (moveEvent) => {
        let newWidth = startWidth + (moveEvent.clientX - startX);
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 500) newWidth = 500;
        document.documentElement.style.setProperty('--db-left-panel-width', `${newWidth}px`);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const finalWidth = getComputedStyle(document.documentElement).getPropertyValue('--db-left-panel-width');
        localStorage.setItem('--db-left-panel-width', finalWidth);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  if (rightSplitter) {
    rightSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-panel-height') || '280px');
      
      const onMouseMove = (moveEvent) => {
        let newHeight = startHeight + (moveEvent.clientY - startY);
        const maxHeight = window.innerHeight - 200;
        if (newHeight < 180) newHeight = 180;
        if (newHeight > maxHeight) newHeight = maxHeight;
        document.documentElement.style.setProperty('--top-panel-height', `${newHeight}px`);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const finalHeight = getComputedStyle(document.documentElement).getPropertyValue('--top-panel-height');
        localStorage.setItem('--top-panel-height', finalHeight);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

// ==========================================
// 10. DRAG-RESIZE TABLE COLUMNS UTILITY
// ==========================================
function makeTableResizable(tableEl) {
  if (!tableEl) return;
  const cols = tableEl.querySelectorAll('th');
  const isDbTable = tableEl.classList.contains('database-table');
  cols.forEach((col) => {
    // Check if resizer already exists to prevent duplicates
    if (col.querySelector('.col-resizer')) return;
    // The wrapped identity columns in the Database table are auto-fit (not resizable).
    if (isDbTable && WRAP_COL_KEYS.has(col.getAttribute('data-col-key'))) return;
    
    // Create resizer element
    const resizer = document.createElement('div');
    resizer.classList.add('col-resizer');
    col.appendChild(resizer);
    
    let startX, startWidth, startTableWidth;
    
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = col.offsetWidth;
      startTableWidth = tableEl.offsetWidth;
      
      // Convert all headers of this table to explicit pixel widths.
      // This locks the columns in place and prevents browser percentage-scaling bugs.
      cols.forEach((c) => {
        c.style.width = `${c.offsetWidth}px`;
      });
      
      // Lock table width in pixels to prevent column squishing during drag
      tableEl.style.width = `${startTableWidth}px`;
      
      let rafId;
      const onMouseMove = (moveEvent) => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const delta = moveEvent.clientX - startX;
          const newWidth = Math.max(40, startWidth + delta);
          col.style.width = `${newWidth}px`;
          
          // Lock minimum table width to the container size, allow expansion
          const containerWidth = tableEl.parentElement.clientWidth;
          const newTableWidth = Math.max(containerWidth, startTableWidth + (newWidth - startWidth));
          tableEl.style.width = `${newTableWidth}px`;
          if (typeof updateStickyOffsets === 'function') {
            updateStickyOffsets(tableEl);
          }
        });
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const colKey = col.getAttribute('data-col-key');
        if (colKey && typeof customColWidths !== 'undefined') {
          customColWidths[colKey] = parseFloat(col.style.width);
          localStorage.setItem('dbColWidths', JSON.stringify(customColWidths));
        }
        // Re-align the virtual rows + frozen-column offsets with the new widths.
        if (isDbTable && typeof renderVirtualWindow === 'function') renderVirtualWindow();
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

// ==========================================
// 11. TAB & PROJECT ANALYTICS DASHBOARD
// ==========================================
function initTabs() {
  const tabs = [
    { btn: 'tab-analytics-view', container: 'analytics-view-container', name: 'analytics-view' },
    { btn: 'tab-fab-view', container: 'fab-view-container', name: 'fab-view' },
    { btn: 'tab-database-view', container: 'database-view-container', name: 'database-view' },
    { btn: 'tab-testingdata-view', container: 'testingdata-view-container', name: 'testingdata-view' },
    { btn: 'tab-ai-view', container: 'ai-view-container', name: 'ai-view' }
  ];

  tabs.forEach(tab => {
    const btnEl = document.getElementById(tab.btn);
    if (!btnEl) return;
    
    btnEl.addEventListener('click', () => {
      if (currentTab === tab.name) return;
      currentTab = tab.name;
      
      tabs.forEach(t => {
        const tBtn = document.getElementById(t.btn);
        const tCont = document.getElementById(t.container);
        if (tBtn) {
            if (t.name === tab.name) tBtn.classList.add('active');
            else tBtn.classList.remove('active');
        }
        if (tCont) {
            if (t.name === tab.name) tCont.style.display = 'flex';
            else tCont.style.display = 'none';
        }
      });
      
      if (tab.name === 'analytics-view') loadAnalyticsDashboard();
      if (tab.name === 'database-view') initDatabaseTab();
      if (tab.name === 'fab-view') {
        // Testing Status tab: systems table is loaded at app init; the donut +
        // System Detailed load on demand via /api/joints. (Removed a legacy
        // Firebase fetch that parsed a big blob and rendered nothing.)
        initResizablePanels();
      }
      if (tab.name === 'testingdata-view') {
        // Embedded live Google Sheet -- lazy-load only when first opened (it's a
        // full Sheets editor, so we don't load it on every app start).
        const ifr = document.getElementById('testingdata-iframe');
        if (ifr && !ifr.src && ifr.dataset.src) ifr.src = ifr.dataset.src;
      }
    });
  });
}

// Project Dashboard (3-zone) shared state + metric metadata
const DASH = {
  totals: null,
  scurve: null,
  chartMode: 'testing',   // 'testing' | 'fabrication' | 'material'
  activeMetric: null,     // 'weld'|'rt'|'paut'|'mt'|'pt'
  activeMaterial: null,   // e.g. 'SS' -- a clicked material row (drives the chart)
  materialMetric: 'joints', // 'joints' | 'dia' -- which series of the active material
  gran: 'day',            // 'day' | 'week' | 'month' (zoom level) -- Day is the default (most-viewed)
  chart: null,
  wired: false
};

// Re-bucket sorted daily deltas into day/week/month buckets + running cumulative.
function bucketDaily(dates, deltaArr, gran) {
  const keyOf = (ds) => {
    if (gran === 'day') return ds;
    if (gran === 'week') {
      const d = new Date(ds + 'T00:00:00');
      const dow = (d.getDay() + 6) % 7;                 // Monday = 0
      d.setDate(d.getDate() - dow);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return ds.slice(0, 7);                               // month YYYY-MM
  };
  const order = [], sums = {};
  for (let i = 0; i < dates.length; i++) {
    const k = keyOf(dates[i]);
    if (!(k in sums)) { sums[k] = 0; order.push(k); }
    sums[k] += deltaArr[i] || 0;
  }
  const perBucket = order.map(k => sums[k]);   // count done IN each bucket (per day/week/month)
  let cum = 0;
  const cumulative = order.map(k => (cum += sums[k]));
  return { labels: order, perBucket, cumulative };
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtBucketLabel(key, gran) {
  if (gran === 'month') { const [y, m] = key.split('-'); return `${MONTH_SHORT[(+m) - 1]} '${y.slice(2)}`; }
  const [, m, d] = key.split('-');                       // YYYY-MM-DD
  return `${d}/${m}`;                                     // DD/MM
}
const DASH_METRICS = {
  weld:  { label: 'Welding',   color: '#0ea5e9' },
  rt:    { label: 'RT',        color: '#3b82f6' },
  paut:  { label: 'PAUT',      color: '#8b5cf6' },
  mt:    { label: 'MT',        color: '#f59e0b' },
  pt:    { label: 'PT',        color: '#ef4444' },
  hydro: { label: 'Hydrotest', color: '#10b981' },
  leak:  { label: 'Leak Test', color: '#a855f7' }
};

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

async function loadAnalyticsDashboard() {
  // Driven entirely by PostgreSQL via the consolidated /api/dashboard-summary.
  try {
    const [tRes, sRes] = await Promise.all([
      hybridFetch('/api/dashboard-summary?view=totals' + FRESH_CB),
      hybridFetch('/api/dashboard-summary?view=scurve' + FRESH_CB)
    ]);
    if (tRes.ok) {
      const tData = await tRes.json();
      DASH.totals = (tData && tData.projectTotals) ? tData.projectTotals : {};
      window.globalFabricationStats = window.globalFabricationStats || {};
      window.globalFabricationStats.projectTotals = DASH.totals;
    }
    if (sRes.ok) DASH.scurve = await sRes.json();
  } catch (err) {
    console.error('Failed to load Project Dashboard data:', err);
  }

  renderDashboardZones();
  setupDashboardInteractions();
  renderDashboardChart();
}

// Zone 1 (General Info) + Zone 2 (Fabrication) cards
function renderDashboardZones() {
  const pt = DASH.totals || {};
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setBar  = (id, p) => { const el = document.getElementById(id); if (el) el.style.width = p + '%'; };
  const setPct  = (id, p, base) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = p + '%'; el.className = base + ' ' + pctClass(p); }
  };
  const fmt = (n) => (n || 0).toLocaleString();

  // ----- Zone 1: General Information -----
  setText('z1-systems', fmt(pt.systemCount));

  // Hydrotest: done + total both from the Google Sheet (test_packages),
  // so the denominator follows the Sheet (e.g. 1022) not the fab Excel (923).
  const hydro = pt.hydro || { done: 0, notInFab: 0 };
  const hydroTotal = hydro.sheetTotal || pt.tpTotal || 0;
  const hydroPct = getProgressPct(hydro.done, hydroTotal);
  setText('z1-hydro-val', `${fmt(hydro.done)} / ${fmt(hydroTotal)}`);
  setPct('z1-hydro-pct', hydroPct, 'stat-pct'); setBar('z1-hydro-bar', hydroPct);
  const hNote = document.getElementById('z1-hydro-note');
  const hNoteCount = document.getElementById('z1-hydro-note-count');
  if (hNote && hNoteCount) {
    if (hydro.notInFab > 0) { hNoteCount.textContent = hydro.notInFab; hNote.style.display = 'block'; }
    else { hNote.style.display = 'none'; }
  }

  // Leak Test: not tracked in the data source yet -> placeholder
  const leak = pt.leak || { done: 0, tracked: false };
  const leakNote = document.getElementById('z1-leak-note');
  if (leak.tracked === false) {
    setText('z1-leak-val', '—');
    const lp = document.getElementById('z1-leak-pct'); if (lp) lp.style.display = 'none';
    const lbar = document.getElementById('z1-leak-bar'); if (lbar && lbar.parentElement) lbar.parentElement.style.display = 'none';
    if (leakNote) leakNote.style.display = 'block';
  } else {
    const leakPct = getProgressPct(leak.done, pt.tpTotal);
    setText('z1-leak-val', `${fmt(leak.done)} / ${fmt(pt.tpTotal)}`);
    setPct('z1-leak-pct', leakPct, 'stat-pct'); setBar('z1-leak-bar', leakPct);
    if (leakNote) leakNote.style.display = 'none';
  }

  // ----- Zone 2: Fabrication Information -----
  const weldPct = getProgressPct(pt.weldDone, pt.joints);
  setText('z2-weld-val', `${fmt(pt.weldDone)} / ${fmt(pt.joints)}`);
  setPct('z2-weld-pct', weldPct, 'metric-pct'); setBar('z2-weld-bar', weldPct);

  ['rt', 'paut', 'mt', 'pt'].forEach(m => {
    const d = pt[m] || { done: 0, req: 0 };
    const p = getProgressPct(d.done, d.req);
    setText(`z2-${m}-val`, `${fmt(d.done)} / ${fmt(d.req)}`);
    setPct(`z2-${m}-pct`, p, 'metric-pct'); setBar(`z2-${m}-bar`, p);
  });

  // Dia Inch (Hydrotest): total dia-inch of hydro-done packages / total project dia-inch.
  // (Only populated by the local-first build; the static-JSON app leaves it as 0 / 0.)
  const dia = pt.diaInch || { done: 0, total: 0 };
  const diaPct = getProgressPct(dia.done, dia.total);
  setText('z2-dia-val', `${fmt(Math.round(dia.done))} / ${fmt(Math.round(dia.total))}`);
  setPct('z2-dia-pct', diaPct, 'metric-pct'); setBar('z2-dia-bar', diaPct);

  renderMaterialProgress();
}

// Preferred display order for the Material Progress table; others appended after.
const MATERIAL_ORDER = ['SS', 'CS', 'GRE', 'CUNI', 'CPVC', 'DSS', 'LTCS', 'PPR'];
const NON_METALLIC_MATERIALS = ['GRE', 'CPVC', 'PPR'];

// Render Material Progress table (Zone 1): per material, completion by JointNo + Dia-Inch.
// Each metric cell is clickable -> plots that material's s-curve on the Zone 3 chart.
function renderMaterialProgress() {
  const tbody = document.getElementById('material-progress-body');
  if (!tbody) return;

  // Hide the whole section when there's no material data (e.g. the static-JSON build).
  const wrapper = document.getElementById('zone-material');
  const list = ((DASH.totals && DASH.totals.materialProgress) || []).slice();
  if (!list.length) {
    if (wrapper) wrapper.style.display = 'none';
    return;
  }
  if (wrapper) wrapper.style.display = '';

  // Sort by the preferred order; unknown materials go to the end (alphabetical).
  list.sort((a, b) => {
    const ia = MATERIAL_ORDER.indexOf(a.material), ib = MATERIAL_ORDER.indexOf(b.material);
    const ra = ia === -1 ? 999 : ia, rb = ib === -1 ? 999 : ib;
    return ra - rb || String(a.material).localeCompare(String(b.material));
  });

  const fmt = (n) => (Math.round(n) || 0).toLocaleString();
  const cls = (p) => p >= 80 ? 'high' : p >= 50 ? 'mid' : 'low';
  tbody.innerHTML = '';

  list.forEach((m) => {
    const mat = m.material || 'Unknown';
    const jDone = m.done || 0, jTotal = m.total || 0, jPct = getProgressPct(jDone, jTotal);
    const dDone = m.done_dia || 0, dTotal = m.total_dia || 0, dPct = getProgressPct(dDone, dTotal);
    const nm = NON_METALLIC_MATERIALS.includes(mat);
    const safeMat = escapeHtml(mat);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="material-name">${safeMat}${nm ? '<span class="mat-tag">bonding</span>' : ''}</td>
      <td class="mat-metric" data-material="${safeMat}" data-metric="joints" title="Click to plot ${safeMat} JointNo progress">
        ${fmt(jDone)} / ${fmt(jTotal)} <span class="material-pct ${cls(jPct)}">${jPct}%</span>
      </td>
      <td class="mat-metric" data-material="${safeMat}" data-metric="dia" title="Click to plot ${safeMat} Dia-Inch progress">
        ${fmt(dDone)} / ${fmt(dTotal)} <span class="material-pct ${cls(dPct)}">${dPct}%</span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateMaterialRowActive();
}

// Highlight the currently selected material metric cell.
function updateMaterialRowActive() {
  document.querySelectorAll('#material-progress-table .mat-metric').forEach((cell) => {
    const on = DASH.activeMaterial === cell.getAttribute('data-material') &&
               DASH.materialMetric === cell.getAttribute('data-metric');
    cell.classList.toggle('active', on);
  });
}

// Wire Zone 2 cards + chart-mode toggle (only once)
function setupDashboardInteractions() {
  if (DASH.wired) { updateMetricCardActive(); updateChartModeButtons(); return; }
  DASH.wired = true;

  document.querySelectorAll('#zone-fab .metric-card').forEach(card => {
    card.addEventListener('click', () => {
      const m = card.getAttribute('data-metric');
      if (!m) return;   // info-only cards (e.g. Dia Inch) don't drive the chart
      DASH.chartMode = 'fabrication';
      DASH.activeMaterial = null;   // clear any active material selection
      DASH.activeMetric = (DASH.activeMetric === m) ? null : m; // click again = deselect
      updateChartModeButtons();
      updateMetricCardActive();
      updateMaterialRowActive();
      renderDashboardChart();
    });
  });

  document.querySelectorAll('#chart-mode-toggle .chart-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      DASH.chartMode = btn.getAttribute('data-mode');
      DASH.activeMetric = null;
      DASH.activeMaterial = null;
      updateChartModeButtons();
      updateMetricCardActive();
      updateMaterialRowActive();
      renderDashboardChart();
    });
  });

  // Material Progress table: click a JointNo / Dia-Inch cell -> plot that material's s-curve.
  const matTable = document.getElementById('material-progress-table');
  if (matTable) {
    matTable.addEventListener('click', (e) => {
      const cell = e.target.closest('.mat-metric');
      if (!cell) return;
      const mat = cell.getAttribute('data-material');
      const metric = cell.getAttribute('data-metric') || 'joints';
      if (DASH.activeMaterial === mat && DASH.materialMetric === metric) {
        DASH.activeMaterial = null;   // click the active cell again = deselect
      } else {
        DASH.activeMaterial = mat;
        DASH.materialMetric = metric;
        DASH.activeMetric = null;     // clear Zone 2 selection
        DASH.chartMode = 'material';
      }
      updateChartModeButtons();
      updateMetricCardActive();
      updateMaterialRowActive();
      renderDashboardChart();
    });
  }

  // Red note -> export the hydro packages that are in the Sheet but not in fab
  const hNote = document.getElementById('z1-hydro-note');
  if (hNote) hNote.addEventListener('click', exportHydroNotInFab);

  // Zoom level buttons (Day / Week / Month)
  document.querySelectorAll('#chart-gran-toggle .gran-btn').forEach(btn => {
    btn.addEventListener('click', () => setChartGran(btn.getAttribute('data-gran')));
  });

  // (Mouse-wheel granularity switching removed -- the wheel now scrolls the page normally;
  //  use the Day / Week / Month buttons to change the zoom level.)
}

// Export the test packages hydrotested in the Sheet but missing from fab data
async function exportHydroNotInFab() {
  try {
    const res = await fetch(getApiUrl('/api/dashboard-summary?view=hydro-not-in-fab'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    if (!list.length) { alert('No discrepancy: all hydrotested packages exist in Fabrication Data.'); return; }
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS not loaded.'); return; }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hydro Not In Fab');
    ws.columns = [
      { header: 'Number', key: 'number', width: 10 },
      { header: 'Test Package', key: 'testPackageNo', width: 36 }
    ];
    list.forEach(r => ws.addRow({ number: r.number, testPackageNo: r.testPackageNo }));
    ws.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      c.alignment = { horizontal: 'center' };
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Hydrotest_packages_not_in_Fabrication_Data.xlsx';
    a.click(); URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export hydro-not-in-fab failed:', err);
    alert('Export failed: ' + err.message);
  }
}

function updateChartModeButtons() {
  document.querySelectorAll('#chart-mode-toggle .chart-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === DASH.chartMode);
  });
}

function updateMetricCardActive() {
  document.querySelectorAll('#zone-fab .metric-card').forEach(card => {
    const m = card.getAttribute('data-metric');
    const on = (DASH.chartMode === 'fabrication') &&
               (DASH.activeMetric === m || DASH.activeMetric === null);
    card.classList.toggle('selected', on);
  });
}

// Zone 3: Total vs Done bars + trend line, re-bucketed to day/week/month with
// horizontal scroll + data labels on the Done bars.
function renderDashboardChart() {
  const data = DASH.scurve;
  const totals = DASH.totals || {};
  const canvas = document.getElementById('analyticsChart');
  if (!canvas) return;

  const reqOf = (m) => (totals[m] && totals[m].req) ? totals[m].req : 0;
  const sumNdtReq = reqOf('rt') + reqOf('paut') + reqOf('mt') + reqOf('pt');

  // Resolve the active metric -> data key, constant total, labels, colour
  let key, totalConst, totalLabel, doneLabel, color, title;
  if (DASH.activeMaterial) {
    const mat = DASH.activeMaterial;
    const mp = (totals.materialProgress || []).find(x => x.material === mat) || {};
    if (DASH.materialMetric === 'dia') {
      key = 'matd:' + mat;
      totalConst = Math.round(mp.total_dia || 0);
      totalLabel = 'Total Dia-Inch'; doneLabel = 'Dia-Inch Done';
      color = '#14b8a6'; title = mat + ' — Dia-Inch';
    } else {
      key = 'matj:' + mat;
      totalConst = mp.total || 0;
      totalLabel = 'Total JointNo'; doneLabel = 'JointNo Done (Visual ACC)';
      color = '#6366f1'; title = mat + ' — JointNo';
    }
  } else if (DASH.chartMode === 'testing') {
    key = 'hydro';
    totalConst = (totals.hydro && totals.hydro.sheetTotal) ? totals.hydro.sheetTotal : (totals.tpTotal || 0);
    totalLabel = 'Total Hydrotest Packages'; doneLabel = 'Hydrotest Done';
    color = DASH_METRICS.hydro.color; title = 'Hydrotest';
  } else if (DASH.activeMetric === 'weld') {
    key = 'weld'; totalConst = totals.joints || 0;
    totalLabel = 'Total JointNo'; doneLabel = 'Visual Done';
    color = DASH_METRICS.weld.color; title = 'Welding (Visual Done)';
  } else if (['rt', 'paut', 'mt', 'pt'].includes(DASH.activeMetric)) {
    key = DASH.activeMetric; totalConst = reqOf(key);
    const lbl = DASH_METRICS[key].label;
    totalLabel = `${lbl} Required`; doneLabel = `${lbl} Done`;
    color = DASH_METRICS[key].color; title = lbl;
  } else if (DASH.activeMetric === 'dia') {
    key = 'dia';
    totalConst = (totals.diaInch && totals.diaInch.total) ? Math.round(totals.diaInch.total) : 0;
    totalLabel = 'Total Dia-Inch'; doneLabel = 'Dia-Inch Welded';
    color = '#14b8a6'; title = 'Dia Inch (Welded)';
  } else {
    key = 'ndt'; totalConst = sumNdtReq;
    totalLabel = 'NDT Required (RT+PAUT+MT+PT)'; doneLabel = 'NDT Done';
    color = '#22d3ee'; title = 'Total NDT (RT+PAUT+MT+PT)';
  }

  const labelEl = document.getElementById('chart-current-label');
  if (labelEl) labelEl.textContent = `Showing: ${title} — by ${DASH.gran}`;
  updateGranButtons();

  if (!data || !data.dates) return;

  // Re-bucket the daily deltas at the current zoom level.
  //  - bars  = PER-BUCKET count actually done in that day/week/month (matches col Z)
  //  - line  = cumulative done (the trend), on a 2nd axis scaled 0..Total
  const bucket = bucketDaily(data.dates, data.deltas[key] || [], DASH.gran);
  const labels = bucket.labels.map(k => fmtBucketLabel(k, DASH.gran));
  const dailySeries = bucket.perBucket;
  const cumSeries = bucket.cumulative;
  const doneTotal = cumSeries.length ? cumSeries[cumSeries.length - 1] : 0;
  const pct = totalConst ? Math.round((doneTotal / totalConst) * 100) : 0;

  if (labelEl) {
    labelEl.textContent = `Showing: ${title} — by ${DASH.gran} — ${doneTotal.toLocaleString()} / ${totalConst.toLocaleString()} (${pct}%)`;
  }

  const LINE_COLOR = '#fde047';
  const dl = window.ChartDataLabels;
  const datasets = [
    {
      // Cumulative done -> the trend, scaled against the Total on the right axis
      // Order 0 = render FIRST (underneath bars), but visually on top due to Z-index in mixed chart
      type: 'line', label: `Cumulative (of ${totalConst.toLocaleString()})`, data: cumSeries, yAxisID: 'y1',
      borderColor: LINE_COLOR, backgroundColor: LINE_COLOR, borderWidth: 2.5, tension: 0.35,
      pointRadius: 2.5, pointHoverRadius: 5, pointBackgroundColor: LINE_COLOR, fill: false, order: 0,
      datalabels: dl ? {
        display: 'auto', anchor: 'end', align: 'top', offset: 4, clamp: true,
        color: '#fde047', font: { size: 10, weight: 'bold' },
        formatter: (v) => (v > 0 ? Math.round(v).toLocaleString() : '')
      } : { display: false }
    },
    {
      // Count actually DONE in each bucket (per day / week / month)
      type: 'bar', label: `${doneLabel} (per ${DASH.gran})`, data: dailySeries, yAxisID: 'y',
      backgroundColor: hexToRgba(color, 0.9), borderColor: color,
      borderWidth: 1, order: 1, categoryPercentage: 0.8, barPercentage: 0.96,
      datalabels: dl ? {
        display: 'auto', anchor: 'end', align: 'end', offset: 2, clamp: true,
        color: '#e2e8f0', font: { size: 10, weight: 'bold' },
        formatter: (v) => (v > 0 ? v.toLocaleString() : '')
      } : undefined
    }
  ];

  // Uniform per-bucket width for ALL zoom levels so Day/Week bars are exactly as
  // large as Month. Total canvas width is capped to stay within browser canvas
  // limits (keeps the frame/height identical at every granularity).
  const PX_PER_BUCKET = 76;
  const MAX_CANVAS_W = 24000;
  const wrap = document.getElementById('s-curve-chart');
  let scrollHost = null;
  if (wrap) {
    scrollHost = wrap.parentElement;            // chart-body (scroll container)
    const avail = scrollHost ? scrollHost.clientWidth - 4 : 800;
    const wanted = Math.max(avail, labels.length * PX_PER_BUCKET);
    wrap.style.width = Math.min(MAX_CANVAS_W, wanted) + 'px';
    // Height is CSS-driven (calc(100% - 18px)) so the x (date) axis always clears the
    // horizontal scrollbar and keeps tracking the container even if the layout reflows later.
  }

  if (DASH.chart) DASH.chart.destroy();
  DASH.chart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    plugins: dl ? [dl] : [],
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 18, bottom: 8 } },
      plugins: {
        legend: { position: 'top', labels: { color: '#e2e8f0', font: { family: 'Inter', size: 13 }, usePointStyle: true, pointStyleWidth: 12, padding: 16 } },
        tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.95)', titleColor: '#fff', bodyColor: '#e2e8f0', borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, padding: 10, titleFont: { size: 13 }, bodyFont: { size: 13 } },
        datalabels: { display: false }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.06)', drawBorder: false }, ticks: { color: '#94a3b8', autoSkip: true, maxRotation: 0, font: { size: 11 } } },
        // Stacked y-axes: the cumulative LINE gets its own UPPER band, the per-bucket BARS a
        // LOWER band, so the two never overlap regardless of the % complete.
        y: {    // per-bucket bars -> BOTTOM band (defined FIRST = bottom of the stack)
          type: 'linear', position: 'left', stack: 'dash', stackWeight: 1, offset: true,
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.06)', drawBorder: false },
          ticks: { color: '#94a3b8', precision: 0, font: { size: 11 } },
          title: { display: true, text: `Per ${DASH.gran}`, color: '#cbd5e1', font: { size: 11 } }
        },
        y1: {   // cumulative line -> TOP band (defined LAST = top of the stack)
          type: 'linear', position: 'left', stack: 'dash', stackWeight: 1.2,
          beginAtZero: true, max: totalConst || undefined,
          grid: { color: 'rgba(253,224,71,0.07)', drawBorder: false },
          ticks: { color: '#fde047', font: { size: 11 } },
          title: { display: true, text: 'Cumulative / Total', color: '#fde047', font: { size: 11 } }
        }
      }
    }
  });

  // Always start at the most recent date (scroll fully right); user scrolls left for history
  if (scrollHost) requestAnimationFrame(() => { scrollHost.scrollLeft = scrollHost.scrollWidth; });
}

// Highlight the active day/week/month button
function updateGranButtons() {
  document.querySelectorAll('#chart-gran-toggle .gran-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-gran') === DASH.gran);
  });
}

// Change zoom level (day <-> week <-> month) and re-render
function setChartGran(gran) {
  if (!['day', 'week', 'month'].includes(gran) || gran === DASH.gran) return;
  DASH.gran = gran;
  renderDashboardChart();
}
const GRAN_ORDER = ['month', 'week', 'day'];      // coarse -> fine (zoom in)
function zoomChartGran(dir) {                      // dir +1 = zoom in (finer)
  const i = GRAN_ORDER.indexOf(DASH.gran);
  const ni = Math.min(GRAN_ORDER.length - 1, Math.max(0, i + dir));
  if (ni !== i) setChartGran(GRAN_ORDER[ni]);
}

// ==========================================
// 12. DATABASE VIEW: UPLOAD & MERGE LOGIC
// ==========================================

// Global static metadata of the 66 Columns
// Fabrication columns 1-80 mirror the ETL allowed-columns list (COLUMNS_MAP /
// init_db.py). Columns dropped from the schema (WelderID, WPSNo, Item01/02,
// SerialNo01/02, PenaltyRemark, Boroscope, ParameterNo) are no longer listed.
const DB_COLUMNS = [
  { num: 1,  name: 'System', key: 'system', type: 'fab' },
  { num: 2,  name: 'DrawingNo', key: 'drawingNo', type: 'fab' },
  { num: 3,  name: 'JointNo', key: 'jointNo', type: 'fab' },
  { num: 4,  name: 'WeldType', key: 'weldType', type: 'fab' },
  { num: 5,  name: 'RevisionNo', key: 'revisionNo', type: 'fab' },
  { num: 6,  name: 'Sheet', key: 'sheet', type: 'fab' },
  { num: 7,  name: 'SpoolNo', key: 'spoolNo', type: 'fab' },
  { num: 8,  name: 'Line', key: 'line', type: 'fab' },
  { num: 9,  name: 'Material', key: 'material', type: 'fab' },
  { num: 10, name: 'Spec', key: 'spec', type: 'fab' },
  { num: 11, name: 'FitUpRequestNo', key: 'fitUpRequestNo', type: 'fab' },
  { num: 12, name: 'FitUpRequestDate', key: 'fitUpRequestDate', type: 'fab' },
  { num: 13, name: 'FitUpReportNo', key: 'fitUpReportNo', type: 'fab' },
  { num: 14, name: 'FitUpReportDate', key: 'fitUpReportDate', type: 'fab' },
  { num: 15, name: 'FitUpACC', key: 'fitupAcc', type: 'fab' },
  { num: 16, name: 'PieceDescription1', key: 'pieceDescription1', type: 'fab' },
  { num: 17, name: 'PieceDescription2', key: 'pieceDescription2', type: 'fab' },
  { num: 18, name: 'Size', key: 'size', type: 'fab' },
  { num: 19, name: 'DiaIn', key: 'diaIn', type: 'fab' },
  { num: 20, name: 'Schedule', key: 'schedule', type: 'fab' },
  { num: 21, name: 'RevForJointNo', key: 'revForJointNo', type: 'fab' },
  { num: 22, name: 'Class', key: 'class', type: 'fab' },
  { num: 23, name: 'WeldingCompletedDate', key: 'weldingCompletedDate', type: 'fab' },
  { num: 24, name: 'VisualRequestNo', key: 'visualRequestNo', type: 'fab' },
  { num: 25, name: 'VisualRequestDate', key: 'visualRequestDate', type: 'fab' },
  { num: 26, name: 'VisualReportNo', key: 'visualReportNo', type: 'fab' },
  { num: 27, name: 'VisualReportDate', key: 'visualReportDate', type: 'fab' },
  { num: 28, name: 'VisualACC', key: 'visualAcc', type: 'fab' },
  { num: 29, name: 'NDTReportNo', key: 'ndtReportNo', type: 'fab' },
  { num: 30, name: 'NDTReportDate', key: 'ndtReportDate', type: 'fab' },
  { num: 31, name: 'TV', key: 'tv', type: 'fab' },
  { num: 32, name: 'PWHTEntryDate', key: 'pwhtEntryDate', type: 'fab' },
  { num: 33, name: 'NDTRequest', key: 'ndtRequest', type: 'fab' },
  { num: 34, name: 'RT', key: 'rt', type: 'fab' },
  { num: 35, name: 'PAUT', key: 'paut', type: 'fab' },
  { num: 36, name: 'UT', key: 'ut', type: 'fab' },
  { num: 37, name: 'MT', key: 'mt', type: 'fab' },
  { num: 38, name: 'PT', key: 'pt', type: 'fab' },
  { num: 39, name: 'PMI', key: 'pmi', type: 'fab' },
  { num: 40, name: 'MTAG', key: 'mtag', type: 'fab' },
  { num: 41, name: 'PWHT', key: 'pwht', type: 'fab' },
  { num: 42, name: 'Hardness', key: 'hardness', type: 'fab' },
  { num: 43, name: 'RTReportNo', key: 'rtReportNo', type: 'fab' },
  { num: 44, name: 'RTResult', key: 'rtResult', type: 'fab' },
  { num: 45, name: 'RTReportDate', key: 'rtReportDate', type: 'fab' },
  { num: 46, name: 'RTEntryDate', key: 'rtEntryDate', type: 'fab' },
  { num: 47, name: 'PAUTReportNo', key: 'pautReportNo', type: 'fab' },
  { num: 48, name: 'PAUTResult', key: 'pautResult', type: 'fab' },
  { num: 49, name: 'PAUTReportDate', key: 'pautReportDate', type: 'fab' },
  { num: 50, name: 'PAUTEntryDate', key: 'pautEntryDate', type: 'fab' },
  { num: 51, name: 'UTReportNo', key: 'utReportNo', type: 'fab' },
  { num: 52, name: 'UTResult', key: 'utResult', type: 'fab' },
  { num: 53, name: 'UTReportDate', key: 'utReportDate', type: 'fab' },
  { num: 54, name: 'UTEntryDate', key: 'utEntryDate', type: 'fab' },
  { num: 55, name: 'MTReportNo', key: 'mtReportNo', type: 'fab' },
  { num: 56, name: 'MTResult', key: 'mtResult', type: 'fab' },
  { num: 57, name: 'MTReportDate', key: 'mtReportDate', type: 'fab' },
  { num: 58, name: 'PTReportNo', key: 'ptReportNo', type: 'fab' },
  { num: 59, name: 'PTResult', key: 'ptResult', type: 'fab' },
  { num: 60, name: 'PTReportDate', key: 'ptReportDate', type: 'fab' },
  { num: 61, name: 'PWHTReportNo', key: 'pwhtReportNo', type: 'fab' },
  { num: 62, name: 'PWHTResult', key: 'pwhtResult', type: 'fab' },
  { num: 63, name: 'PWHTReportDate', key: 'pwhtReportDate', type: 'fab' },
  { num: 64, name: 'PMIReportNo', key: 'pmiReportNo', type: 'fab' },
  { num: 65, name: 'PMIReportDate', key: 'pmiReportDate', type: 'fab' },
  { num: 66, name: 'HardnessTestReportNo', key: 'hardnessTestReportNo', type: 'fab' },
  { num: 67, name: 'HardnessTestReportDate', key: 'hardnessTestReportDate', type: 'fab' },
  { num: 68, name: 'FerriteTestReportNo', key: 'ferriteTestReportNo', type: 'fab' },
  { num: 69, name: 'FerriteTestReportDate', key: 'ferriteTestReportDate', type: 'fab' },
  { num: 70, name: 'InsulationReportNo', key: 'insulationReportNo', type: 'fab' },
  { num: 71, name: 'TestPackageNo', key: 'testPackageNo', type: 'fab' },
  { num: 72, name: 'SummaryReportNo', key: 'summaryReportNo', type: 'fab' },
  { num: 73, name: 'SummaryReportDate', key: 'summaryReportDate', type: 'fab' },
  { num: 74, name: 'SummaryReportRemark', key: 'summaryReportRemark', type: 'fab' },
  { num: 75, name: 'ReleaseNotesReportNo', key: 'releaseNotesReportNo', type: 'fab' },
  { num: 76, name: 'ReleaseNotesReportDate', key: 'releaseNotesReportDate', type: 'fab' },
  { num: 77, name: 'Thick', key: 'thick', type: 'fab' },
  { num: 78, name: 'ISOMETRIC', key: 'isometric', type: 'fab' },
  { num: 79, name: 'Status', key: 'status', type: 'fab' },
  { num: 80, name: 'ModifiedDate', key: 'modifiedDate', type: 'fab' },

  // Google sheet columns (test_packages)
  { num: 81, name: 'SKYLINE', key: 'skyline', type: 'test' },
  { num: 82, name: 'Test Plan', key: 'testPlan', type: 'test' },
  { num: 83, name: 'Ready for Hydrotest', key: 'readyForHydrotest', type: 'test' },
  { num: 84, name: 'Review Weld SUM', key: 'reviewWeldSum', type: 'test' },
  { num: 85, name: 'Line check', key: 'lineCheck', type: 'test' },
  { num: 86, name: 'Sign P02A', key: 'signP02A', type: 'test' },
  { num: 87, name: 'Flushing', key: 'flushing', type: 'test' },
  { num: 88, name: 'Sign P03A', key: 'signP03A', type: 'test' },
  { num: 89, name: 'Hydrotest App', key: 'hydroTest', type: 'test' },
  { num: 90, name: 'Sign P04A', key: 'signP04A', type: 'test' },
  { num: 91, name: 'Bolting Completion', key: 'boltingCompletion', type: 'test' },
  { num: 92, name: 'Re-instatement', key: 'reinstatement', type: 'test' },
  { num: 93, name: 'Sign P05A', key: 'signP05A', type: 'test' },
  { num: 94, name: 'Sign P06A', key: 'signP06A', type: 'test' },
  { num: 95, name: 'Sign P07A', key: 'signP07A', type: 'test' },
  { num: 96, name: 'Inspector', key: 'inspector', type: 'test' }
];

let isDatabaseTabInitialized = false;

// Global column width map
let customColWidths = JSON.parse(localStorage.getItem('dbColWidths') || '{}');
// Widths derived from the actual cell DATA (recomputed each render). This makes
// columns fit their content instead of their (often longer) header text.
let dbDataWidths = {};
function computeDbDataWidths(visibleCols, data) {
  dbDataWidths = {};
  const N = Math.min(data.length, 250);          // sample for speed
  const CHAR = 6.6, PAD = 16, MINW = 46, MAXW = 220;
  for (const col of visibleCols) {
    let maxLen = 1;
    for (let i = 0; i < N; i++) {
      const v = data[i] ? data[i][col.key] : null;
      if (v != null) { const len = String(v).length; if (len > maxLen) maxLen = len; }
    }
    if (WRAP_COL_KEYS.has(col.key)) {
      // value wraps to 2 lines -> size to ~half the longest value (+ a little room)
      const px = Math.ceil(maxLen / 2) * CHAR + PAD + 8;
      dbDataWidths[col.key] = Math.round(Math.max(72, Math.min(150, px)));
    } else {
      dbDataWidths[col.key] = Math.round(Math.max(MINW, Math.min(MAXW, maxLen * CHAR + PAD)));
    }
  }
}
function getColWidth(colKey) {
  // The wrapped identity columns are ALWAYS auto-fit to their (2-line) content, so
  // a stale saved width can never make them wide. They are not user-resizable.
  if (WRAP_COL_KEYS.has(colKey) && dbDataWidths[colKey]) return dbDataWidths[colKey];

  const oldDefaults = { system: 50, testPackageNo: 140, line: 180, drawingNo: 160, spoolNo: 120, jointNo: 70 };
  const newDefaults = { system: 40, testPackageNo: 100, line: 110, drawingNo: 100, spoolNo: 80, jointNo: 55 };

  if (customColWidths[colKey]) {
    if (newDefaults[colKey] && customColWidths[colKey] === oldDefaults[colKey]) {
      return newDefaults[colKey];
    }
    return customColWidths[colKey];
  }
  // Default width fits the cell DATA (computed per render), never the header text.
  if (dbDataWidths[colKey]) return dbDataWidths[colKey];
  const widths = {
    system: 40,
    testPackageNo: 100,
    line: 110,
    drawingNo: 100,
    spoolNo: 80,
    jointNo: 55,
    weldType: 70,
    item01: 150,
    serialNo01: 100,
    item02: 150,
    serialNo02: 100,
    size: 60,
    schedule: 70,
    material: 100,
    spec: 100,
    fitUpRequestNo: 130,
    fitUpRequestDate: 100,
    fitupAcc: 70,
    welderId: 80,
    wpsNo: 80,
    weldingCompletedDate: 105,
    visualRequestNo: 110,
    visualReportNo: 110,
    visualAcc: 70,
    penaltyRemark: 160,
    tv: 60,
    ndtRequest: 90,
    rt: 60,
    paut: 60,
    mt: 60,
    pt: 60,
    pmi: 60,
    mtag: 70,
    pwht: 60,
    hardness: 60,
    boroscope: 80,
    rtReportNo: 110,
    rtResult: 70,
    pautResult: 70,
    pautReportDate: 100,
    mtReportNo: 110,
    mtResult: 70,
    ptResult: 70,
    ptReportDate: 100,
    pwhtReportNo: 110,
    pwhtResult: 70,
    pmiReportNo: 110,
    hardnessTestReportNo: 110,
    ferriteTestReportNo: 130,
    parameterNo: 130,
    summaryReportNo: 130,
    releaseNotesReportNo: 130,
    
    // Google Sheet columns (testing)
    skyline: 120,
    testPlan: 100,
    readyForHydrotest: 95,
    reviewWeldSum: 110,
    lineCheck: 95,
    signP02A: 85,
    flushing: 95,
    signP03A: 85,
    hydroTest: 95,
    signP04A: 85,
    boltingCompletion: 110,
    reinstatement: 95,
    signP05A: 85,
    signP06A: 85,
    signP07A: 85,
    inspector: 110
  };
  return widths[colKey] || 120;
}

// Global active selection index (0-based)
state.highlightedColumnIndex = null;
state.dbRenderedRowsCount = 0;

function updateColumnHighlight() {
  const container = document.getElementById('db-table-container');
  if (!container) return;
  const table = container.querySelector('table');
  if (!table) return;

  const highlightedIdx = state.highlightedColumnIndex;
  const colList = document.getElementById('db-column-list');
  
  // 1. Update left panel list items active class
  if (colList) {
    colList.querySelectorAll('li').forEach(li => {
      const colNum = parseInt(li.getAttribute('data-col-num'), 10);
      const zeroIdx = colNum - 1;
      if (highlightedIdx !== null && highlightedIdx === zeroIdx) {
        li.classList.add('active-selected-col');
      } else {
        li.classList.remove('active-selected-col');
      }
    });
  }
  
  // Update header highlighting
  const headers = table.querySelectorAll('thead tr:first-child th');
  headers.forEach((th, idx) => {
    if (idx === highlightedIdx) {
      th.classList.add('selected-column-header');
    } else {
      th.classList.remove('selected-column-header');
    }
  });

  // Update body cells highlighting
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    cells.forEach((cell, idx) => {
      if (idx === highlightedIdx) {
        cell.classList.add('selected-column-cell');
      } else {
        cell.classList.remove('selected-column-cell');
      }
    });
  });
}

function scrollToTableColumn(colIndex1Based) {
  const container = document.getElementById('db-table-container');
  if (!container) return;
  const table = container.querySelector('table');
  if (!table) return;
  
  const targetTh = table.querySelector(`thead tr:first-child th:nth-child(${colIndex1Based})`);
  if (targetTh) {
    let fixedColumnsWidth = 0;
    const thList = table.querySelectorAll('thead tr:first-child th');
    for (let i = 0; i < thList.length; i++) {
      if (thList[i].classList.contains('sticky-col')) {
        fixedColumnsWidth += thList[i].offsetWidth;
      }
    }

    const offset = targetTh.offsetLeft;
    const targetScrollLeft = (offset + targetTh.offsetWidth / 2) - fixedColumnsWidth - ((container.clientWidth - fixedColumnsWidth) / 2);
    
    container.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: 'smooth'
    });
  }
}

function scrollToColumn(colKey) {
  const colIdx = DB_COLUMNS.findIndex(c => c.key === colKey);
  if (colIdx >= 0) {
    scrollToTableColumn(colIdx + 1);
  }
}

// ==========================================
// EXCEL-LIKE FILTER POPUP
// ==========================================
let currentFilterColKey = null;

function openFilterPopup(event, colKey) {
  event.stopPropagation(); // prevent column selection

  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const popup = document.getElementById('excel-filter-popup');
  const input = document.getElementById('excel-filter-input');

  currentFilterColKey = colKey;

  // Reveal off-screen first so we can measure the real width, then place it with
  // boundary-collision detection (anchor right if it would overflow, flip up if
  // there isn't enough room below).
  popup.style.visibility = 'hidden';
  popup.style.display = 'flex';
  popup.style.left = '-9999px';
  popup.style.top = '0px';
  popup.style.bottom = 'auto';
  const pw = popup.offsetWidth || 260;
  const PH = 320;                 // bounded by the dropdown's max-height
  const m = 8, vw = window.innerWidth, vh = window.innerHeight;

  // Horizontal: left-align to the button; if that overflows the right edge,
  // right-align the popup to the button, then clamp inside the viewport.
  let left = rect.left;
  if (left + pw > vw - m) left = rect.right - pw;
  left = Math.min(Math.max(m, left), vw - pw - m);
  popup.style.left = `${left}px`;

  // Vertical: open below; if not enough room below and more room above, flip up
  // and anchor the popup's BOTTOM just above the button so it grows upward as the
  // async suggestion list fills in (never covering the rows you're reading).
  const roomBelow = vh - rect.bottom;
  if (roomBelow < PH && rect.top > roomBelow) {
    popup.style.top = 'auto';
    popup.style.bottom = `${vh - rect.top + m}px`;
  } else {
    popup.style.bottom = 'auto';
    popup.style.top = `${rect.bottom + m}px`;
  }

  popup.style.visibility = 'visible';

  // Pre-fill input
  if (!state.dbColFilters) state.dbColFilters = {};
  input.value = state.dbColFilters[colKey] || '';

  // Populate dropdown and expand input width
  updateFilterDropdown(colKey, input.value);
  autoExpandInput(input, 180, 350);

  input.focus();
}

// Initialize global popup listeners
document.addEventListener('DOMContentLoaded', () => {
  const popup = document.getElementById('excel-filter-popup');
  const input = document.getElementById('excel-filter-input');
  const clearBtn = document.getElementById('excel-filter-clear');
  
  if (!popup) return;
  
  // Close popup if clicking outside
  document.addEventListener('click', (e) => {
    if (popup.style.display === 'flex' && !popup.contains(e.target) && !e.target.closest('.filter-icon-btn')) {
      popup.style.display = 'none';
    }
  });
  
  // Input trigger
  input.addEventListener('input', (e) => {
    if (!currentFilterColKey) return;
    
    const val = e.target.value;
    if (!state.dbColFilters) state.dbColFilters = {};
    state.dbColFilters[currentFilterColKey] = val.toLowerCase();
    
    // Update dropdown matching list & auto-expand input width
    updateFilterDropdown(currentFilterColKey, val);
    autoExpandInput(input, 180, 350);
    
    clearTimeout(window.dbColFilterTimeout);
    window.dbColFilterTimeout = setTimeout(() => {
      state.dbPage = 1;
      filterDatabaseTable();
    }, 300);
  });
  
  // Clear trigger
  clearBtn.addEventListener('click', () => {
    if (!currentFilterColKey) return;
    input.value = '';
    state.dbColFilters[currentFilterColKey] = '';
    
    // Reset dropdown and input width
    updateFilterDropdown(currentFilterColKey, '');
    autoExpandInput(input, 180, 350);
    
    clearTimeout(window.dbColFilterTimeout);
    window.dbColFilterTimeout = setTimeout(() => {
      state.dbPage = 1;
      filterDatabaseTable();
    }, 300);
    input.focus();
  });
});

function updateDbPreviewSubtitle() {
  const subtitleEl = document.getElementById('db-preview-subtitle');
  if (subtitleEl) {
    const loaded = (state.dbFilteredData || []).length;
    const total = (state.dbTotalCount != null) ? state.dbTotalCount : loaded;
    subtitleEl.textContent = (loaded < total)
      ? `${loaded.toLocaleString()} of ${total.toLocaleString()} records (scroll to load more)`
      : `${total.toLocaleString()} records`;
  }
}

// Show the Database "Clear filters" button only when a search or column filter is active
function updateDbClearAllVisibility() {
  const btn = document.getElementById('db-clear-all-filters-btn');
  if (!btn) return;
  const hasSearch = !!(state.dbUniversalSearch && state.dbUniversalSearch.length > 0);
  const colFilters = state.dbColFilters || {};
  const hasColFilter = Object.values(colFilters).some(v => v && String(v).length > 0);
  btn.style.display = (hasSearch || hasColFilter) ? 'block' : 'none';
}

function appendMoreDatabaseRows() {
  // No-op: the Database Preview is now fully virtual-scrolled (see
  // renderVirtualWindow), so there are no extra pages to append.
  return;
}

function initDatabaseTab() {
  if (isDatabaseTabInitialized) return;
  isDatabaseTabInitialized = true;
  
  console.log('Initializing Database Tab event handlers...');
  
  // DOM selectors
  // const uploadBtn = document.getElementById('db-upload-trigger-btn');
  // const fileInput = document.getElementById('db-upload-input');
  const colSearchInput = document.getElementById('db-column-search');
  const uniSearchInput = document.getElementById('db-universal-search');
  const uniSearchClearBtn = document.getElementById('db-search-clear-btn');
  
  // Right panel filter elements
  const rightFilterInput = document.getElementById('db-right-panel-filter');
  const rightFilterClearBtn = document.getElementById('db-right-panel-filter-clear-btn');
  const exportExcelBtn = document.getElementById('db-export-excel-btn');
  
  const tableContainer = document.getElementById('db-table-container');


  // Column list search
  if (colSearchInput) {
    colSearchInput.addEventListener('input', (e) => {
      state.dbColumnSearch = e.target.value.trim().toLowerCase();
      renderDatabaseColumns();
    });
  }

  // Data Source Buttons
  const btnAll = document.getElementById('btn-source-all');
  const btnPms = document.getElementById('btn-source-pms');
  const btnTesting = document.getElementById('btn-source-testing');

  function updateSourceButtons(activeId) {
    [btnAll, btnPms, btnTesting].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) activeBtn.classList.add('active');
  }

  if (btnAll) btnAll.addEventListener('click', () => { state.dbActiveSource = 'all'; updateSourceButtons('btn-source-all'); renderDatabaseColumns(); renderDatabaseTable(); });
  if (btnPms) btnPms.addEventListener('click', () => { state.dbActiveSource = 'fab'; updateSourceButtons('btn-source-pms'); renderDatabaseColumns(); renderDatabaseTable(); });
  if (btnTesting) btnTesting.addEventListener('click', () => { state.dbActiveSource = 'testing'; updateSourceButtons('btn-source-testing'); renderDatabaseColumns(); renderDatabaseTable(); });

  // Unified Search Synced Filter logic
  let filterTimeout = null;
  function syncFilters(query) {
    state.dbUniversalSearch = query;
    
    if (uniSearchInput && uniSearchInput.value !== query) {
      uniSearchInput.value = query;
    }
    if (rightFilterInput && rightFilterInput.value !== query) {
      rightFilterInput.value = query;
    }
    
    if (uniSearchInput) autoExpandInput(uniSearchInput, 250, 500);
    if (rightFilterInput) autoExpandInput(rightFilterInput, 200, 500);
    
    if (uniSearchClearBtn) uniSearchClearBtn.style.display = query.length > 0 ? 'block' : 'none';
    if (rightFilterClearBtn) rightFilterClearBtn.style.display = query.length > 0 ? 'block' : 'none';
    updateDbClearAllVisibility();

    if (filterTimeout) clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      filterDatabaseTable();
    }, 300);
  }

  if (uniSearchInput) {
    uniSearchInput.addEventListener('input', (e) => syncFilters(e.target.value.trim().toLowerCase()));
    autoExpandInput(uniSearchInput, 250, 500);
  }
  if (rightFilterInput) {
    rightFilterInput.addEventListener('input', (e) => syncFilters(e.target.value.trim().toLowerCase()));
    autoExpandInput(rightFilterInput, 200, 500);
  }
  if (uniSearchClearBtn) {
    uniSearchClearBtn.addEventListener('click', () => syncFilters(''));
  }
  if (rightFilterClearBtn) {
    rightFilterClearBtn.addEventListener('click', () => syncFilters(''));
  }

  // Clear All Filters (Database tab): wipes universal search + per-column filters
  const dbClearAllBtn = document.getElementById('db-clear-all-filters-btn');
  if (dbClearAllBtn) {
    dbClearAllBtn.addEventListener('click', () => {
      state.dbColFilters = {};
      state.dbUniversalSearch = '';
      if (uniSearchInput) uniSearchInput.value = '';
      if (rightFilterInput) rightFilterInput.value = '';
      if (uniSearchClearBtn) uniSearchClearBtn.style.display = 'none';
      if (rightFilterClearBtn) rightFilterClearBtn.style.display = 'none';
      state.dbPage = 1;
      updateDbClearAllVisibility();
      filterDatabaseTable();
    });
  }

  // Export Filtered Table ExcelJS. The grid is now infinite-scrolled, so finish
  // loading every remaining page before building the file (export = the whole set).
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', async () => {
      if (state.dbHasMore) {
        exportExcelBtn.disabled = true;          // grab every remaining page first
        try { await loadAllDatabaseRows(); }
        finally { exportExcelBtn.disabled = false; }
      }
      if (!state.dbFilteredData || state.dbFilteredData.length === 0) {
        alert("No database records to export.");
        return;
      }
      exportToExcel('database', state.dbFilteredData);
    });
  }

  // Virtual scroll: re-render the visible window on scroll (rAF-throttled) and pull
  // the next server page when the user nears the bottom (infinite scroll).
  if (tableContainer) {
    let dbScrollRaf = null;
    tableContainer.addEventListener('scroll', () => {
      if (dbScrollRaf) return;
      dbScrollRaf = requestAnimationFrame(() => {
        dbScrollRaf = null;
        renderVirtualWindow();
        if (state.dbHasMore && !state.dbLoading) {
          const el = tableContainer;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1200) {
            loadMoreDatabaseRows(state.dbLoadToken, false);
          }
        }
      });
    });
  }

  // Handle Refresh Data Button
  const refreshBtn = document.getElementById('db-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchDatabase(true); // force refresh
    });
  }

  // Load existing database
  fetchDatabase();
}


// Fetch database with server-side pagination
async function fetchDatabase(forceRefresh = false) {
  const container = document.getElementById('db-table-container');
  container.innerHTML = `
    <div class="no-selection-message">
      <div class="loading-spinner-small"></div>
      <p>Loading database from Server...</p>
    </div>
  `;

  state.dbColumns = [...DB_COLUMNS];
  state.dbColumns.sort((a, b) => {
    if (a.key === 'system') return -1;
    if (b.key === 'system') return 1;
    if (a.key === 'testPackageNo') return -1;
    if (b.key === 'testPackageNo') return 1;
    if (a.type === b.type) return 0;
    return a.type === 'fab' ? -1 : 1;
  });

  let fabCount = 0; let testCount = 0;
  state.dbColumns.forEach((col, idx) => {
    col.num = idx + 1;
    if (col.type === 'fab') fabCount++;
    else testCount++;
  });
  
  const dbColsSubtitle = document.getElementById('db-columns-subtitle');
  if (dbColsSubtitle) {
    dbColsSubtitle.textContent = `Columns 1-${fabCount} (Fab) & ${fabCount + 1}-${fabCount + testCount} (Test)`;
  }
  
  // Restore columns
  const savedVisible = localStorage.getItem('dbVisibleColumns');
  const coreKeys = [
    'system', 'testPackageNo', 'line', 'drawingNo', 'spoolNo', 'jointNo',
    'material', 'spec', 'fitupAcc', 'weldingCompletedDate', 'visualAcc',
    'rt', 'rtResult', 'paut', 'pautResult', 'ut', 'utResult', 'mt', 'mtResult', 'pt', 'ptResult',
    'pmi', 'pmiReportDate', 'pwht', 'pwhtResult', 'hardness', 'hardnessTestReportDate',
    'leakPkgNo', 'hydrotestDate', 'reinstatementDate'
  ];
  let parsedVisible = null;
  if (savedVisible) {
    try { parsedVisible = JSON.parse(savedVisible); } catch(e) {}
  }
  
  if (!savedVisible || (parsedVisible && parsedVisible.length > 50)) {
    const allKeys = state.dbColumns.map(c => c.key);
    state.dbVisibleColumns = allKeys.filter(k => coreKeys.includes(k));
    localStorage.setItem('dbVisibleColumns', JSON.stringify(state.dbVisibleColumns));
  } else {
    state.dbVisibleColumns = parsedVisible;
  }

  const activeSource = localStorage.getItem('dbActiveSource') || 'all';
  state.dbActiveSource = activeSource;
  
  renderDatabaseColumns();
  filterDatabaseTable(); 
}

const DB_CHUNK = 1000;   // rows per server page (keyset-paginated, infinite scroll)

// Load only the FIRST page of the current filter; the scroll handler pulls more on
// demand. The browser holds only what the user has actually scrolled to -- never the
// whole ~100k-row table again (that crushed egress and OOM'd the 1GB Nano DB).
async function filterDatabaseTable() {
  const container = document.getElementById('db-table-container');
  if (container) {
    container.innerHTML = `
      <div class="no-selection-message">
        <div class="loading-spinner-small"></div>
        <p>Loading database…</p>
      </div>
    `;
  }
  const token = (state.dbLoadToken = (state.dbLoadToken || 0) + 1);
  state.dbFilteredData = [];
  state.dbCursor = null;
  state.dbHasMore = true;
  state.dbLoading = false;
  try {
    await loadMoreDatabaseRows(token, true);             // first page
    if (token !== state.dbLoadToken) return;
    if (state.dbFilteredData.length === 0) renderDatabaseTable();   // 0 rows -> empty state
  } catch (err) {
    if (token !== state.dbLoadToken) return;
    if (container) {
      container.innerHTML = `
        <div class="no-selection-message" style="color: var(--accent-red)">
          <p>Database Error: ${err.message}</p>
        </div>
      `;
    }
  }
}

// Fetch the next keyset page for the active filter and append it. Guarded so only one
// request is in flight and a newer filter aborts stale responses.
async function loadMoreDatabaseRows(token, isFirst) {
  if (token == null) token = state.dbLoadToken;
  if (state.dbLoading || !state.dbHasMore || token !== state.dbLoadToken) return;
  state.dbLoading = true;
  try {
    const payload = {
      query: state.dbUniversalSearch || '',
      columnFilters: state.dbColFilters || {},
      activeSource: state.dbActiveSource || 'all',
      sortBy: 'id', sortDesc: false,
      page: 1, pageSize: DB_CHUNK, afterId: state.dbCursor
    };
    const res = await fetch(getApiUrl('/api/database-query'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to fetch from API');
    const data = await res.json();
    if (token !== state.dbLoadToken) return;             // a newer filter started -> drop
    const chunk = data.data || [];
    state.dbFilteredData.push(...chunk);
    if (data.totalCount != null) state.dbTotalCount = data.totalCount;
    state.dbHasMore = chunk.length >= DB_CHUNK;
    if (chunk.length) state.dbCursor = chunk[chunk.length - 1].id;

    if (isFirst) {
      const c = document.getElementById('db-table-container');
      if (c) c.style.opacity = '1';
      renderDatabaseTable();
      updateDbClearAllVisibility();
    } else if (dbVirtual) {
      dbVirtual.total = state.dbFilteredData.length;
      renderVirtualWindow();
    }
    updateDbPreviewSubtitle();
  } finally {
    state.dbLoading = false;
  }
}

// Export needs the WHOLE filtered set -> finish loading every remaining page first.
async function loadAllDatabaseRows() {
  const token = state.dbLoadToken;
  let guard = 0;
  while (state.dbHasMore && token === state.dbLoadToken && guard++ < 100000) {
    await loadMoreDatabaseRows(token, false);
  }
}
function highlightSearchText(text, search) {
  if (text === null || text === undefined || text === '') return '';
  const str = String(text);
  if (!search) return str;

  // Escape special regex characters
  const escSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(${escSearch})`, 'gi');
  return str.replace(regex, '<span class="highlight-search-match">$1</span>');
}

function splitIntoTwoLines(str) {
  if (!str || typeof str !== 'string') return str;
  if (str.length <= 10) return str;
  
  const seps = ['-', '/', '_', ' '];
  const mid = Math.floor(str.length / 2);
  let bestIdx = -1;
  let minDiff = Infinity;
  
  for (let i = 0; i < str.length; i++) {
    if (seps.includes(str[i])) {
      const diff = Math.abs(i - mid);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
  }
  
  if (bestIdx !== -1) {
    const char = str[bestIdx];
    if (char === ' ') {
      return str.substring(0, bestIdx) + '<br>' + str.substring(bestIdx + 1);
    } else {
      return str.substring(0, bestIdx + 1) + '<br>' + str.substring(bestIdx + 1);
    }
  }
  
  return str;
}

// Headers are always a SINGLE line and clipped with an ellipsis if too long
// (see CSS). The long identity columns are narrowed instead by wrapping their
// CELL DATA to 2 lines (WRAP_COL_KEYS), not by wrapping the header.
function formatHeaderName(name) {
  return name;
}

// Columns whose CELL VALUES wrap to 2 lines so the column can be narrow.
const WRAP_COL_KEYS = new Set(['testPackageNo', 'line', 'drawingNo', 'spoolNo']);

function renderDatabaseColumns() {
  const listEl = document.getElementById('db-column-list');
  if (!listEl) return;

  const searchQuery = (state.dbColumnSearch || '').trim().toLowerCase();
  
  const cols = state.dbColumns && state.dbColumns.length > 0 ? state.dbColumns : DB_COLUMNS;
  const filteredCols = cols.filter(col => {
    if (searchQuery && !col.name.toLowerCase().includes(searchQuery)) return false;
    
    if (col.key !== 'testPackageNo') {
      if (state.dbActiveSource === 'fab' && col.type !== 'fab') return false;
      if (state.dbActiveSource === 'testing' && col.type !== 'test') return false;
    }
    
    return true;
  });

  const html = filteredCols.map(col => {
    const isVisible = state.dbVisibleColumns.includes(col.key);
    const isRequired = col.key === 'testPackageNo';
    const checkedAttr = isVisible ? 'checked' : '';
    const disabledAttr = isRequired ? 'disabled' : '';
    const tooltipText = isRequired ? 'Cột bắt buộc hiển thị' : 'Ẩn/hiện cột';
    const typeIndicator = col.type === 'fab' 
      ? '<span style="font-size: 0.6rem; padding: 2px 4px; border-radius: 3px; background: rgba(59, 130, 246, 0.2); color: #60a5fa;">PMS</span>'
      : '<span style="font-size: 0.6rem; padding: 2px 4px; border-radius: 3px; background: rgba(16, 185, 129, 0.2); color: #34d399;">Test</span>';
      
    const bgClass = col.type === 'fab' ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)';
    const bgAttr = isVisible ? bgClass : 'transparent';

    return `
      <li data-col-key="${col.key}" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.02); cursor: pointer; border-left: 3px solid ${col.type === 'fab' ? '#3b82f6' : '#10b981'}; background: ${bgAttr};">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <input type="checkbox" class="col-visibility-checkbox" data-col-key="${col.key}" ${checkedAttr} ${disabledAttr} title="${tooltipText}" style="cursor: pointer;" />
          <span style="font-size: 0.8rem; color: var(--text-main); font-weight: ${isVisible ? '600' : '400'};">${col.name}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${typeIndicator}
          <span class="col-num" style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace;">${col.num}</span>
        </div>
      </li>
    `;
  }).join('');

  listEl.innerHTML = html;

  listEl.querySelectorAll('li').forEach(li => {
    const colKey = li.getAttribute('data-col-key');
    const checkbox = li.querySelector('.col-visibility-checkbox');

    // Click on the column NAME (anywhere on the row except the checkbox) brings
    // that column into view on the right-hand table -- it does NOT toggle.
    li.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;   // checkbox handles show/hide itself
      scrollToDbColumn(colKey);
    });

    // The checkbox ONLY toggles show/hide of the column.
    checkbox.addEventListener('change', (e) => {
      handleCheckboxChange(colKey, e.target.checked);
    });
  });
}

// Bring a column into view on the right-hand data table: scroll it to roughly the
// middle of the space between the frozen JointNo column and the right edge, so it
// can be compared against JointNo without manual horizontal scrolling.
function scrollToDbColumn(colKey) {
  if (colKey === 'testPackageNo') return;       // always-visible frozen column
  // Auto-show the column if it is currently hidden, then re-render the table.
  if (!state.dbVisibleColumns.includes(colKey)) {
    state.dbVisibleColumns.push(colKey);
    localStorage.setItem('dbVisibleColumns', JSON.stringify(state.dbVisibleColumns));
    renderDatabaseColumns();
    renderDatabaseTable();
  }
  const container = document.getElementById('db-table-container');
  if (!container) return;
  const colsList = (state.dbColumns && state.dbColumns.length > 0) ? state.dbColumns : DB_COLUMNS;

  const th = container.querySelector(`thead th[data-col-key="${colKey}"]`);
  if (!th) return;
  // Width of the frozen (sticky) block = sum of the first-6 visible column widths.
  let frozenW = 0;
  colsList.filter(c => state.dbVisibleColumns.includes(c.key)).forEach(c => {
    const oi = DB_COLUMNS.findIndex(d => d.key === c.key);
    if (oi >= 0 && oi < 6) frozenW += getColWidth(c.key);
  });
  const colCenter = th.offsetLeft + th.offsetWidth / 2;
  const viewMid = frozenW + (container.clientWidth - frozenW) / 2;
  let target = colCenter - viewMid;
  target = Math.max(0, Math.min(target, container.scrollWidth - container.clientWidth));
  container.scrollTo({ left: target, behavior: 'smooth' });
}

function handleCheckboxChange(colKey, isChecked) {
  if (colKey === 'testPackageNo') return;

  if (isChecked) {
    if (!state.dbVisibleColumns.includes(colKey)) {
      state.dbVisibleColumns.push(colKey);
    }
  } else {
    state.dbVisibleColumns = state.dbVisibleColumns.filter(k => k !== colKey);
  }

  localStorage.setItem('dbVisibleColumns', JSON.stringify(state.dbVisibleColumns));
  renderDatabaseTable();
}

// ----- Virtual scrolling (windowing) for the Database Preview -----
// The full result set lives in state.dbFilteredData (could be ~100k rows).
// We only ever put the visible window of <tr>s in the DOM, with two spacer rows
// above/below that reserve the true scroll height, so the scrollbar is accurate
// and scrolling stays smooth without flooding the DOM.
const DB_ROW_H = 44;             // fixed row height (px) -- fits 2-line wrap cells; required for windowing
let dbVirtual = null;

function renderDatabaseTable() {
  const container = document.getElementById('db-table-container');
  const data = state.dbFilteredData || [];

  if (data.length === 0) {
    container.innerHTML = `<div class="no-selection-message"><p>No matching database records found.</p></div>`;
    state.dbRenderedRowsCount = 0;
    dbVirtual = null;
    updateDbPreviewSubtitle();
    return;
  }

  const cols = (state.dbColumns && state.dbColumns.length > 0) ? state.dbColumns : DB_COLUMNS;
  const visibleCols = cols.filter(col => state.dbVisibleColumns.includes(col.key));

  // Size every column to fit its cell data (not the header text) for this render.
  computeDbDataWidths(visibleCols, data);

  // Sticky left offsets for the first-6 frozen columns, from known widths
  const stickyLefts = {};
  let runLeft = 0;
  visibleCols.forEach(col => {
    const oi = DB_COLUMNS.findIndex(c => c.key === col.key);
    if (oi >= 0 && oi < 6) { stickyLefts[col.key] = runLeft; runLeft += getColWidth(col.key); }
  });

  const filters = state.dbColFilters || {};
  const headerCellsHtml = visibleCols.map(col => {
    const oi = DB_COLUMNS.findIndex(c => c.key === col.key);
    const isSticky = oi >= 0 && oi < 6;
    const stickyClass = isSticky ? 'sticky-col' : '';
    const headerColorClass = col.type === 'fab' ? 'fab-header' : 'test-header';
    const width = getColWidth(col.key);
    const filterActive = filters[col.key] && filters[col.key].trim() !== '';
    const iconClass = filterActive ? 'filter-icon-btn active' : 'filter-icon-btn';
    const leftStyle = isSticky ? ` left:${stickyLefts[col.key]}px;` : '';
    return `<th class="${stickyClass} ${headerColorClass} resizable-th" style="min-width:${width}px; width:${width}px;${leftStyle}" data-col-key="${col.key}" title="${escapeHtml(col.name)}">
      <div class="th-content"><span>${formatHeaderName(col.name)}</span>
      <button class="${iconClass}" onclick="openFilterPopup(event, '${col.key}')" title="Filter this column">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
      </button></div></th>`;
  }).join('');

  container.innerHTML = `
    <table class="summary-table database-table db-virtual" style="table-layout:fixed; min-width:100%; width:auto;">
      <thead><tr>${headerCellsHtml}</tr></thead>
      <tbody id="db-vbody"></tbody>
    </table>
  `;

  dbVirtual = { visibleCols, stickyLefts, total: data.length };

  const tableEl = container.querySelector('table');
  if (typeof makeTableResizable === 'function') makeTableResizable(tableEl);
  // (Clicking a header no longer "selects" the column / turns it red.)

  container.scrollTop = 0;
  renderVirtualWindow();
}

function renderVirtualWindow() {
  if (!dbVirtual) return;
  const container = document.getElementById('db-table-container');
  const tbody = document.getElementById('db-vbody');
  if (!container || !tbody) return;

  const data = state.dbFilteredData || [];
  const { visibleCols, total } = dbVirtual;
  // Recompute the frozen-column offsets from the CURRENT widths on every render so
  // resizing a column keeps the sticky columns aligned (header + body together).
  const stickySet = {};
  const stickyLefts = {};
  let runLeft = 0;
  visibleCols.forEach(col => {
    const oi = DB_COLUMNS.findIndex(c => c.key === col.key);
    if (oi >= 0 && oi < 6) { stickySet[col.key] = true; stickyLefts[col.key] = runLeft; runLeft += getColWidth(col.key); }
  });

  const viewportH = container.clientHeight || 400;
  const buffer = 10;
  const start = Math.max(0, Math.floor(container.scrollTop / DB_ROW_H) - buffer);
  const end = Math.min(total, Math.ceil((container.scrollTop + viewportH) / DB_ROW_H) + buffer);

  const query = state.dbUniversalSearch;
  const ncol = visibleCols.length;

  let rowsHtml = '';
  for (let i = start; i < end; i++) {
    const row = data[i];
    let cells = '';
    for (const col of visibleCols) {
      const isSticky = !!stickySet[col.key];
      const isWrap = WRAP_COL_KEYS.has(col.key);
      let v = row[col.key];
      if (!v || v.toString().trim().toLowerCase() === 'pending') v = '';
      const text = highlightSearchText(v, query);
      const cls = [isSticky ? 'sticky-col' : '', isWrap ? 'wrap-col' : ''].filter(Boolean).join(' ');
      const leftStyle = isSticky ? ` style="left:${stickyLefts[col.key]}px"` : '';
      // Long identity columns: wrap the value to (max) 2 lines so the column stays narrow.
      const inner = isWrap ? `<div class="cell-clamp2">${text}</div>` : text;
      cells += `<td${cls ? ` class="${cls}"` : ''}${leftStyle}>${inner}</td>`;
    }
    rowsHtml += `<tr style="height:${DB_ROW_H}px">${cells}</tr>`;
  }

  const topH = start * DB_ROW_H;
  const botH = (total - end) * DB_ROW_H;
  tbody.innerHTML =
    `<tr style="height:${topH}px"><td colspan="${ncol}" style="padding:0;border:none"></td></tr>` +
    rowsHtml +
    `<tr style="height:${botH}px"><td colspan="${ncol}" style="padding:0;border:none"></td></tr>`;

  state.dbRenderedRowsCount = total;
  updateDbPreviewSubtitle();
}

// Compute and lock left offsets of the first 6 frozen columns
function updateStickyOffsets(tableEl) {
  if (!tableEl) return;
  if (!tableEl.classList.contains('database-table')) return;
  const headerRows = tableEl.querySelectorAll('thead tr');
  const rows = tableEl.querySelectorAll('tbody tr');
  
  let cumulativeLeft = 0;
  const firstRowHeaders = headerRows[0] ? headerRows[0].querySelectorAll('th') : [];
  
  for (let i = 0; i < firstRowHeaders.length; i++) {
    const th1 = firstRowHeaders[i];
    if (!th1 || !th1.classList.contains('sticky-col')) break;
    
    headerRows.forEach(tr => {
       const th = tr.children[i];
       if (th) {
         th.style.left = `${cumulativeLeft}px`;
       }
    });
    
    rows.forEach(row => {
      const td = row.cells[i];
      if (td) {
        td.style.left = `${cumulativeLeft}px`;
      }
    });
    
    cumulativeLeft += th1.offsetWidth;
  }
}

