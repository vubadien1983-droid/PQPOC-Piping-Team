// skyline.js — "Handover and Skyline" tab
// ITR-A S-curve: Actual (complete_date) vs Skyline DAC Plan (skyline-data.js) + KPI / Punchlist / ITR detail tables.
// Chart = DAILY, x-axis scaled to the most recent 2 weeks. Clicking any figure on the right panel
// opens a full-screen modal with the underlying detail. Uses window.PrecomDB (itr_a, precom_summary). LAZY.
(function () {
  'use strict';

  var DISCS = ['ELECTRICAL', 'INSTRUMENT', 'PIPING', 'MECHANICAL', 'HVAC', 'TELECOM', 'SAFETY', 'ARCHITECTURE', 'STRUCTURE'];
  var WINDOW_DAYS = 14; // last 2 weeks
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = { inited: false, sel: 'ALL', itrMap: null, chart: null };

  function el(id) { return document.getElementById(id); }
  function esc(v) { return (v == null ? '' : String(v)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(d, t) { return t > 0 ? (d / t * 100) : 0; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function discLabel(d) { return d.charAt(0) + d.slice(1).toLowerCase(); }

  // ---- date helpers (ISO 'YYYY-MM-DD') ----
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shiftISO(iso, n) { var p = iso.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtDay(iso) { var p = iso.split('-'); if (p.length !== 3) return iso; return p[2] + '-' + MO[(+p[1]) - 1]; }

  var CSS =
    '<style id="skyline-css">' +
    // ===== LIGHT THEME for the whole Handover tab (cool blue-tint, distinct from the app's dark tabs) =====
    '#skyline-view-container{background:#e7eef7;}' +
    '#skyline-view-container .dash-zone.card{background:#f4f8fc;color:#1f2d3d;border:1px solid #c9d6e6;}' +
    '#skyline-view-container .dash-zone-header{border-bottom:1px solid #d3deea;}' +
    '#skyline-view-container .dash-zone-header h2{color:#12324f;}' +
    '#skyline-view-container .dash-zone-tag{background:#0ea5e9;color:#fff;}' +
    '#skyline-view-container .no-selection-message{color:#33465b;}' +
    '#skyline-view-container #skyline-meta{color:#5b6b7d;}' +
    '#skyline-view-container #skyline-export-btn{background:#fff;color:#0369a1;border:1px solid #0ea5e9;}' +
    '#skyline-body{font-size:0.78rem;color:#1f2d3d;}' +
    '.sky-left{flex:0 0 300px;min-width:260px;overflow-y:auto;border-right:1px solid #d3deea;padding-right:6px;}' +
    '.sky-right{flex:1;min-width:0;overflow-y:auto;padding:0 4px 20px;}' +
    '.sky-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;margin-bottom:4px;border:1px solid #dbe4ee;background:#ffffff;}' +
    '.sky-row:hover{background:#eaf4fd;border-color:#bcd9f0;}' +
    '.sky-row.active{background:#dcecfb;border-color:#5aa9e6;}' +
    '.sky-row .nm{font-weight:600;color:#1f2d3d;}' +
    '.sky-row .sub{font-size:0.66rem;color:#6b7a8b;}' +
    '.sky-row .prog{font-size:0.72rem;font-weight:700;min-width:52px;text-align:right;}' +
    '.sky-hi{color:#16a34a;}.sky-mid{color:#ca8a04;}.sky-lo{color:#dc2626;}' +
    '.sky-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:6px 0 12px;}' +
    '.sky-kpi{background:#ffffff;border:1px solid #dbe4ee;border-radius:8px;padding:10px 12px;cursor:pointer;transition:.15s;}' +
    '.sky-kpi:hover{background:#eaf4fd;border-color:#8fc3ea;box-shadow:0 1px 4px rgba(14,165,233,0.18);}' +
    '.sky-kpi .lab{font-size:0.64rem;color:#6b7a8b;text-transform:uppercase;letter-spacing:.4px;}' +
    '.sky-kpi .val{font-size:1.25rem;font-weight:800;margin-top:2px;color:#12324f;}' +
    '.sky-chartbox{position:relative;height:380px;background:#ffffff;border:1px solid #d3deea;border-radius:8px;padding:6px;margin-bottom:14px;cursor:pointer;}' +
    '.sky-sec-title{font-size:0.8rem;font-weight:700;margin:14px 0 6px;color:#12324f;border-left:3px solid #0ea5e9;padding-left:8px;}' +
    // panel summary tables (light)
    'table.sky-tbl{width:100%;border-collapse:collapse;font-size:0.72rem;margin-bottom:8px;background:#fff;}' +
    'table.sky-tbl th,table.sky-tbl td{border:1px solid #dbe4ee;padding:5px 8px;text-align:center;color:#1f2d3d;}' +
    'table.sky-tbl th{background:#e8f1fb;font-weight:700;color:#12324f;}' +
    'table.sky-tbl td.l{text-align:left;font-weight:600;}' +
    'table.sky-tbl tr.tot td{background:#dcecfb;font-weight:800;}' +
    'table.sky-tbl.clickable tbody tr{cursor:pointer;}table.sky-tbl.clickable tbody tr:hover td{background:#eaf4fd;}' +
    '.sky-clk{cursor:pointer;}' +
    '.sky-var-pos{color:#16a34a;font-weight:800;}.sky-var-neg{color:#dc2626;font-weight:800;}' +
    '.sky-catA{background:rgba(22,163,74,0.09);}.sky-catB{background:rgba(202,138,4,0.11);}.sky-catC{background:rgba(220,38,38,0.09);}' +
    // ===== Full-screen detail modal (light) =====
    '.sky-modal{position:fixed;inset:0;z-index:1400;background:rgba(15,32,55,0.35);display:none;}' +
    '.sky-modal.open{display:flex;}' +
    '.sky-win{position:absolute;inset:0;width:100vw;height:100vh;background:#eef3f9;display:flex;flex-direction:column;}' +
    '.sky-win-head{display:flex;align-items:center;gap:10px;padding:11px 18px;border-bottom:2px solid #0ea5e9;background:#f8fbff;box-shadow:0 1px 3px rgba(15,32,55,0.08);}' +
    '.sky-win-head h3{margin:0;font-size:0.98rem;font-weight:700;flex:1;color:#12324f;}' +
    '.sky-win-head .btn-secondary{background:#fff;color:#0369a1;border:1px solid #0ea5e9;}' +
    '.sky-win-body{flex:1;min-height:0;overflow:auto;padding:0;background:#eef3f9;}' +
    '.sky-rt-note{padding:9px 16px;color:#5b6b7d;font-size:0.72rem;font-weight:600;}' +
    '.sky-x{cursor:pointer;font-size:1.5rem;line-height:1;background:none;border:none;color:#64748b;padding:0 6px;}' +
    '.sky-x:hover{color:#dc2626;}' +
    '.sky-badge-done{background:#dcfce7;color:#15803d;padding:1px 8px;border-radius:10px;font-size:0.66rem;font-weight:700;}' +
    '.sky-badge-open{background:#eef2f7;color:#64748b;padding:1px 8px;border-radius:10px;font-size:0.66rem;font-weight:700;}' +
    // ===== Report table with FROZEN (sticky) header =====
    '.sky-rtbl{width:100%;border-collapse:separate;border-spacing:0;font-size:0.72rem;background:#fff;}' +
    '.sky-rtbl thead th{position:sticky;top:0;z-index:2;background:#12324f;color:#fff;white-space:nowrap;padding:9px 11px;border-right:1px solid #24425f;border-bottom:2px solid #0ea5e9;text-align:center;font-weight:700;text-transform:uppercase;font-size:0.66rem;letter-spacing:.3px;}' +
    '.sky-rtbl tbody td{padding:6px 11px;border-bottom:1px solid #e4eaf1;border-right:1px solid #eef2f7;color:#22303f;vertical-align:top;text-align:center;white-space:nowrap;}' +
    '.sky-rtbl tbody tr:nth-child(even){background:#f6f9fc;}' +
    '.sky-rtbl tbody tr:hover{background:#eaf4fd;}' +
    '.sky-rtbl td.l{text-align:left;white-space:normal;min-width:280px;}' +
    '.sky-rtbl td.mono{font-family:ui-monospace,Consolas,monospace;font-weight:600;}' +
    '.sky-rtbl tbody tr.sky-rrow{cursor:pointer;}' +
    '.sky-rtbl tbody tr.sky-rrow:hover{background:#dcecfb;}' +
    // header summary strip (Actual vs Skyline plan)
    '.sky-sumwrap{padding:10px 16px 4px;}' +
    '.sky-sum{border-collapse:collapse;font-size:0.72rem;background:#fff;box-shadow:0 1px 3px rgba(15,32,55,0.07);}' +
    '.sky-sum th,.sky-sum td{border:1px solid #dbe4ee;padding:5px 13px;text-align:center;white-space:nowrap;color:#22303f;}' +
    '.sky-sum th{background:#12324f;color:#fff;text-transform:uppercase;font-size:0.61rem;letter-spacing:.3px;}' +
    '.sky-sum td.l{text-align:left;font-weight:700;color:#12324f;}' +
    '.sky-sum .aC{color:#16a34a;font-weight:700;}.sky-sum .aO{color:#dc2626;font-weight:700;}.sky-sum .plan{color:#0369a1;font-weight:700;}' +
    // level-2 detail modal (stacks above level-1)
    '.sky-modal2{position:fixed;inset:0;z-index:1500;background:rgba(15,32,55,0.42);display:none;}' +
    '.sky-modal2.open{display:flex;}' +
    '.sky-drillhint{font-size:0.66rem;color:#0369a1;font-weight:600;margin-left:6px;}' +
    '</style>';

  function clsProg(p) { return p >= 75 ? 'sky-hi' : p >= 40 ? 'sky-mid' : 'sky-lo'; }
  function discWhere(disc) { return disc ? " AND UPPER(discipline)='" + disc.replace(/'/g, "''") + "'" : ''; }

  function scopeTotals(disc) {
    var t = (window.PrecomDB.query("SELECT COUNT(*) c FROM itr_a WHERE 1=1" + discWhere(disc))[0] || {}).c || 0;
    var d = (window.PrecomDB.query("SELECT COUNT(*) c FROM itr_a WHERE complete_date IS NOT NULL AND TRIM(complete_date)<>''" + discWhere(disc))[0] || {}).c || 0;
    return { total: t, done: d, remain: t - d };
  }

  function ensureItrMap() {
    if (state.itrMap) return state.itrMap;
    var m = {};
    window.PrecomDB.query("SELECT subsystem, discipline, itr_total FROM precom_summary").forEach(function (r) {
      m[r.subsystem + '|' + r.discipline] = r.itr_total || 0;
    });
    state.itrMap = m; return m;
  }

  // ---- Daily S-curve data, windowed to the last 2 weeks ----
  function buildDaily(disc) {
    var map = ensureItrMap();
    var plan = (window.DAC_SKYLINE && window.DAC_SKYLINE.plan) || [];
    var planByDay = {};
    plan.forEach(function (p) {
      if (!p.dac) return; if (disc && p.disc !== disc) return;
      planByDay[p.dac] = (planByDay[p.dac] || 0) + (map[p.ss + '|' + p.disc] || 0);
    });
    var actRows = window.PrecomDB.query(
      "SELECT substr(complete_date,1,10) d, COUNT(*) c FROM itr_a" +
      " WHERE complete_date IS NOT NULL AND TRIM(complete_date)<>''" + discWhere(disc) +
      " GROUP BY d ORDER BY d");
    var actByDay = {}; actRows.forEach(function (r) { actByDay[r.d] = r.c; });

    var tot = scopeTotals(disc), denom = tot.total || 1;
    var today = todayISO();
    // Reference day = latest day (plan or actual) that is <= today; fallback today.
    var allDays = Object.keys(planByDay).concat(Object.keys(actByDay)).filter(function (d) { return d <= today; });
    var end = allDays.length ? allDays.sort().pop() : today;
    var start = shiftISO(end, -(WINDOW_DAYS - 1));

    // Cumulative up to a given day (over ALL history, so cum% is true-to-date)
    function cumUpto(byDay, day) { var s = 0; for (var k in byDay) { if (k <= day) s += byDay[k]; } return s; }

    var days = [], planDay = [], actDay = [], planCum = [], actCum = [];
    // Chart spans 2 weeks; the KPI summary "period" only reflects the LAST 1 WEEK (7 days).
    var periodPlan = 0, periodAct = 0, planWk1 = 0, actWk1 = 0;
    for (var i = 0; i < WINDOW_DAYS; i++) {
      var d = shiftISO(start, i);
      var pd = planByDay[d] || 0, ad = actByDay[d] || 0;
      days.push(d); planDay.push(pd); actDay.push(ad);
      periodPlan += pd; periodAct += ad;
      if (i >= WINDOW_DAYS - 7) { planWk1 += pd; actWk1 += ad; } // last 7 days only
      planCum.push(pct(cumUpto(planByDay, d), denom));
      actCum.push(pct(cumUpto(actByDay, d), denom));
    }
    return {
      days: days, planDay: planDay, actDay: actDay, planCum: planCum, actCum: actCum,
      totals: tot, end: end, denom: denom, disc: disc || null,
      periodPlan: periodPlan, periodAct: periodAct,
      planWk1: planWk1, actWk1: actWk1, wk1Start: shiftISO(start, WINDOW_DAYS - 7),
      planCumEnd: pct(cumUpto(planByDay, end), denom), actCumEnd: pct(cumUpto(actByDay, end), denom)
    };
  }

  function drawChart(cv, cur, label) {
    if (!cv || typeof Chart === 'undefined') return null;
    if (state.chart) { try { state.chart.destroy(); } catch (e) {} state.chart = null; }
    state.chart = new Chart(cv, {
      data: {
        labels: cur.days.map(fmtDay),
        datasets: [
          { type: 'bar', label: 'KPI PLAN (ITR/day)', data: cur.planDay, backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y', order: 3 },
          { type: 'bar', label: 'ACTUAL (ITR/day)', data: cur.actDay, backgroundColor: 'rgba(34,197,94,0.85)', yAxisID: 'y', order: 2 },
          { type: 'line', label: 'KPI PLAN CUM %', data: cur.planCum, borderColor: '#ef4444', backgroundColor: '#ef4444', borderWidth: 2, pointRadius: 2, tension: 0.25, yAxisID: 'y1', order: 1 },
          { type: 'line', label: 'ACTUAL CUM %', data: cur.actCum, borderColor: '#a855f7', backgroundColor: '#a855f7', borderWidth: 2, pointRadius: 2, tension: 0.25, yAxisID: 'y1', order: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 10 }, color: '#334155' } },
          title: { display: true, text: 'ITR-A S-Curve — ' + label + ' (daily, last 2 weeks)', color: '#0f172a', font: { size: 13, weight: 'bold' } },
          datalabels: { display: false }
        },
        scales: {
          x: { ticks: { color: '#475569', font: { size: 9 }, maxRotation: 90, minRotation: 90 }, grid: { display: false } },
          y: { position: 'left', beginAtZero: true, title: { display: true, text: 'ITR / day', color: '#475569' }, ticks: { color: '#475569', precision: 0 } },
          y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'Cumulative %', color: '#475569' }, grid: { drawOnChartArea: false }, ticks: { color: '#475569', callback: function (v) { return v + '%'; } } }
        }
      }
    });
    return state.chart;
  }

  function kpiTable(cur) {
    var denom = cur.denom;
    var vr = cur.actCumEnd - cur.planCumEnd;
    var wk = esc(fmtDay(cur.wk1Start)) + ' → ' + esc(fmtDay(cur.end));
    return '<table class="sky-tbl"><thead><tr><th class="l">Metric</th><th>Value</th></tr></thead><tbody>' +
      '<tr><td class="l">1. KPI PLAN (this week · ' + wk + ')</td><td>' + f1(pct(cur.planWk1, denom)) + '% (' + cur.planWk1 + ')</td></tr>' +
      '<tr><td class="l">2. KPI PLAN CUM (to date)</td><td>' + f1(cur.planCumEnd) + '%</td></tr>' +
      '<tr><td class="l">3. ACTUAL (this week · ' + wk + ')</td><td>' + f1(pct(cur.actWk1, denom)) + '% (' + cur.actWk1 + ')</td></tr>' +
      '<tr><td class="l">4. ACTUAL CUM (to date)</td><td>' + f1(cur.actCumEnd) + '%</td></tr>' +
      '<tr class="tot"><td class="l">VAR (Actual − Plan, cum)</td><td class="' + (vr >= 0 ? 'sky-var-pos' : 'sky-var-neg') + '">' + (vr >= 0 ? '+' : '') + f1(vr) + '%</td></tr>' +
      '</tbody></table>';
  }

  function punchAgg(disc) {
    var w = disc ? " WHERE UPPER(discipline)='" + disc.replace(/'/g, "''") + "'" : '';
    return window.PrecomDB.query(
      "SELECT COALESCE(SUM(punch_a_total),0) at, COALESCE(SUM(punch_a_open),0) ao," +
      " COALESCE(SUM(punch_b_total),0) bt, COALESCE(SUM(punch_b_open),0) bo," +
      " COALESCE(SUM(punch_c_total),0) ct, COALESCE(SUM(punch_c_open),0) co FROM precom_summary" + w)[0] || {};
  }
  function punchTable(disc) {
    var r = punchAgg(disc);
    function row(cat, t, o, cls) { return '<tr class="' + cls + '"><td class="l">CAT ' + cat + '</td><td>' + t + '</td><td>' + (t - o) + '</td><td>' + o + '</td></tr>'; }
    var tot = (r.at + r.bt + r.ct), open = (r.ao + r.bo + r.co);
    return '<table class="sky-tbl clickable"><thead><tr><th class="l">Punchlist</th><th>Total</th><th>Closed</th><th>Open</th></tr></thead><tbody>' +
      row('A', r.at, r.ao, 'sky-catA') + row('B', r.bt, r.bo, 'sky-catB') + row('C', r.ct, r.co, 'sky-catC') +
      '<tr class="tot"><td class="l">TOTAL</td><td>' + tot + '</td><td>' + (tot - open) + '</td><td>' + open + '</td></tr>' +
      '</tbody></table>';
  }

  function itrDetailByDisc() {
    var rows = window.PrecomDB.query(
      "SELECT discipline, COUNT(*) total," +
      " SUM(CASE WHEN complete_date IS NOT NULL AND TRIM(complete_date)<>'' THEN 1 ELSE 0 END) done" +
      " FROM itr_a GROUP BY discipline");
    var m = {}; rows.forEach(function (r) { m[(r.discipline || '').toUpperCase()] = r; });
    var body = '', gt = 0, gd = 0;
    DISCS.forEach(function (d) {
      var r = m[d]; if (!r || !r.total) return;
      gt += r.total; gd += r.done; var p = pct(r.done, r.total);
      body += '<tr data-disc="' + d + '"><td class="l">' + discLabel(d) + '</td><td>' + r.total + '</td><td>' + r.done +
        '</td><td class="' + clsProg(p) + '">' + f1(p) + '%</td><td>' + (r.total - r.done) + '</td></tr>';
    });
    body += '<tr class="tot"><td class="l">TOTAL</td><td>' + gt + '</td><td>' + gd + '</td><td>' + f1(pct(gd, gt)) + '%</td><td>' + (gt - gd) + '</td></tr>';
    return '<table class="sky-tbl clickable"><thead><tr><th class="l">Discipline</th><th>Total</th><th>Complete</th><th>% Comp</th><th>Remain</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  // ================= FULL-SCREEN DETAIL MODAL =================
  function ensureModal() {
    if (el('sky-modal')) return;
    var d = document.createElement('div');
    d.id = 'sky-modal'; d.className = 'sky-modal';
    d.innerHTML = '<div class="sky-win"><div class="sky-win-head"><h3 id="sky-modal-title"></h3>' +
      '<button class="btn btn-secondary" id="sky-modal-export" style="padding:0.3rem 0.6rem;font-size:0.7rem;min-height:auto;">Export</button>' +
      '<button class="sky-x" id="sky-modal-x" title="Close">&times;</button></div>' +
      '<div class="sky-win-body" id="sky-modal-body"></div></div>';
    document.body.appendChild(d);
    el('sky-modal-x').onclick = closeModal;
    d.addEventListener('click', function (e) { if (e.target === d) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (el('sky-modal2') && el('sky-modal2').classList.contains('open')) closeModal2();
      else closeModal();
    });
  }
  function closeModal() { var m = el('sky-modal'); if (m) m.classList.remove('open'); }
  function openModal(title, html, exportRows, exportName) {
    ensureModal();
    el('sky-modal-title').textContent = title;
    el('sky-modal-body').innerHTML = html;
    var xb = el('sky-modal-export');
    if (exportRows && exportRows.length) {
      xb.style.display = ''; xb.onclick = function () { exportTable(exportRows, exportName || 'detail'); };
    } else { xb.style.display = 'none'; }
    el('sky-modal').classList.add('open');
  }
  function bigTable(head, rows, note) {
    return (note ? '<div class="sky-rt-note">' + esc(note) + '</div>' : '') +
      '<table class="sky-rtbl"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows + '</tbody></table>';
  }

  var LIMIT = 6000;

  function fmtDMY(iso) { var p = iso.split('-'); if (p.length !== 3) return iso; return p[2] + '-' + MO[(+p[1]) - 1] + '-' + p[0].slice(2); }

  // Aggregate ITR / Punch / DAC for a scope (Actual + Skyline plan). DAC = 100% ITR-A done + Punch A closed.
  function scopeSummary(disc, ss) {
    var w = ' WHERE 1=1', params = [];
    if (disc) w += " AND UPPER(discipline)='" + disc.replace(/'/g, "''") + "'";
    if (ss) { w += ' AND subsystem=?'; params.push(ss); }
    var rows = window.PrecomDB.query(
      "SELECT subsystem, discipline, itr_total, itr_done, COALESCE(punch_a_total,0) pat, COALESCE(punch_a_open,0) pao," +
      " COALESCE(punch_b_total,0) pbt, COALESCE(punch_b_open,0) pbo, COALESCE(punch_c_total,0) pct, COALESCE(punch_c_open,0) pco" +
      " FROM precom_summary" + w, params);
    var plan = (window.DAC_SKYLINE && window.DAC_SKYLINE.plan) || [];
    var planMap = {}; plan.forEach(function (p) { if (p.dac) planMap[p.ss + '|' + p.disc] = p.dac; });
    var today = todayISO();
    var s = { units: 0, itrT: 0, itrD: 0, punT: 0, punO: 0, dacAch: 0, dacPlanTot: 0, dacPlanDue: 0, itrPlanDue: 0, dates: [] };
    rows.forEach(function (r) {
      s.units++; s.itrT += r.itr_total || 0; s.itrD += r.itr_done || 0;
      s.punT += r.pat + r.pbt + r.pct; s.punO += r.pao + r.pbo + r.pco;
      if (r.itr_total > 0 && r.itr_done >= r.itr_total && r.pao === 0) s.dacAch++;   // DAC achieved (actual)
      var pdac = planMap[r.subsystem + '|' + r.discipline];
      if (pdac) { s.dacPlanTot++; s.dates.push(pdac); if (pdac <= today) { s.dacPlanDue++; s.itrPlanDue += r.itr_total || 0; } }
    });
    s.itrO = s.itrT - s.itrD; s.punC = s.punT - s.punO; s.dacOpen = s.units - s.dacAch; s.dates.sort();
    return s;
  }

  // Header summary card: ITR / Punch / DAC — Total · Closed · Open · Actual% · Skyline plan (to-date)
  function summaryHtml(disc, ss) {
    var s = scopeSummary(disc, ss);
    var dacPlan;
    if (ss) dacPlan = s.dates.length ? (esc(fmtDMY(s.dates[0])) + (s.dacPlanDue ? ' · due' : ' · upcoming')) : '—';
    else dacPlan = s.dates.length ? (s.dacPlanDue + '/' + s.dacPlanTot + ' due · ' + esc(fmtDMY(s.dates[0])) + '→' + esc(fmtDMY(s.dates[s.dates.length - 1]))) : '—';
    function r(item, tot, closed, open, planTxt) {
      return '<tr><td class="l">' + item + '</td><td>' + tot + '</td><td class="aC">' + closed + '</td><td class="aO">' + open +
        '</td><td>' + f1(pct(closed, tot)) + '%</td><td class="plan">' + planTxt + '</td></tr>';
    }
    return '<div class="sky-sumwrap"><table class="sky-sum">' +
      '<thead><tr><th>Item</th><th>Total</th><th>Closed</th><th>Open</th><th>Actual %</th><th>Skyline Plan (≤ today)</th></tr></thead><tbody>' +
      r('ITR-A', s.itrT, s.itrD, s.itrO, s.dates.length ? (s.itrPlanDue + ' due') : '—') +
      r('Punch A/B/C', s.punT, s.punC, s.punO, '—') +
      r('DAC (subsys×disc)', s.units, s.dacAch, s.dacOpen, dacPlan) +
      '</tbody></table></div>';
  }

  function itrDetailRows(disc, filter) {
    var w = discWhere(disc);
    if (filter === 'done') w += " AND complete_date IS NOT NULL AND TRIM(complete_date)<>''";
    else if (filter === 'remain') w += " AND (complete_date IS NULL OR TRIM(complete_date)='')";
    return window.PrecomDB.query(
      "SELECT tag_no, subsystem, discipline, cs_type, plan_finish, complete_date FROM itr_a" +
      " WHERE 1=1" + w + " ORDER BY (complete_date IS NOT NULL AND TRIM(complete_date)<>''), subsystem, tag_no LIMIT " + LIMIT);
  }
  function openItrModal(disc, filter, label) {
    var rows = itrDetailRows(disc, filter);
    var exp = [['Tag No', 'Subsystem', 'Discipline', 'CS Type', 'Plan Finish', 'Complete Date', 'Status']];
    var body = rows.map(function (r) {
      var done = r.complete_date && String(r.complete_date).trim();
      exp.push([r.tag_no, r.subsystem, r.discipline, r.cs_type, r.plan_finish || '', r.complete_date || '', done ? 'Complete' : 'Open']);
      return '<tr><td class="mono">' + esc(r.tag_no) + '</td><td class="mono">' + esc(r.subsystem) + '</td><td>' + esc(r.discipline) + '</td><td>' + esc(r.cs_type || '') +
        '</td><td>' + esc(r.plan_finish || '') + '</td><td>' + esc(r.complete_date || '') + '</td><td>' +
        (done ? '<span class="sky-badge-done">Complete</span>' : '<span class="sky-badge-open">Open</span>') + '</td></tr>';
    }).join('');
    var note = rows.length + ' ITR-A checksheet(s)' + (rows.length >= LIMIT ? ' (showing first ' + LIMIT + ')' : '');
    openModal('ITR-A Detail — ' + label, summaryHtml(disc, null) + bigTable(['Tag No', 'Subsystem', 'Discipline', 'CS Type', 'Plan Finish', 'Complete Date', 'Status'], body, note), exp, 'ITR-A_' + label);
  }
  function openPunchModal(disc, label) {
    var rows = window.PrecomDB.query(
      "SELECT punch_no, category, status, discipline, tag_no, subsystem, description FROM punch_list" +
      " WHERE 1=1" + discWhere(disc) + " ORDER BY category, (UPPER(TRIM(status))='CLOSED'), punch_no LIMIT " + LIMIT);
    var exp = [['Punch No', 'Category', 'Status', 'Discipline', 'Tag No', 'Subsystem', 'Description']];
    var body = rows.map(function (r) {
      exp.push([r.punch_no, r.category, r.status, r.discipline, r.tag_no, r.subsystem, r.description]);
      return '<tr><td class="mono">' + esc(r.punch_no) + '</td><td>' + esc(r.category) + '</td><td>' + esc(r.status || '') + '</td><td>' + esc(r.discipline || '') +
        '</td><td class="mono">' + esc(r.tag_no || '') + '</td><td class="mono">' + esc(r.subsystem || '') + '</td><td class="l">' + esc(r.description || '') + '</td></tr>';
    }).join('');
    var note = rows.length + ' punch item(s)' + (rows.length >= LIMIT ? ' (showing first ' + LIMIT + ')' : '');
    openModal('Punchlist Detail — ' + label, summaryHtml(disc, null) + bigTable(['Punch No', 'Category', 'Status', 'Discipline', 'Tag No', 'Subsystem', 'Description'], body, note), exp, 'Punch_' + label);
  }
  function openSubsysModal(disc) {
    var rows = window.PrecomDB.query(
      "SELECT subsystem, subsystem_desc, itr_total, itr_done, COALESCE(punch_a_open,0)+COALESCE(punch_b_open,0)+COALESCE(punch_c_open,0) punch_open" +
      " FROM precom_summary WHERE UPPER(discipline)='" + disc.replace(/'/g, "''") + "' ORDER BY subsystem");
    var exp = [['Subsystem', 'Description', 'ITR Total', 'ITR Done', '% Done', 'Punch Open']];
    var body = rows.map(function (r) {
      var p = pct(r.itr_done, r.itr_total);
      exp.push([r.subsystem, r.subsystem_desc, r.itr_total, r.itr_done, f1(p), r.punch_open]);
      return '<tr class="sky-rrow" data-ss="' + esc(r.subsystem) + '"><td class="mono">' + esc(r.subsystem) + '</td><td class="l">' + esc(r.subsystem_desc || '') + '</td><td>' + r.itr_total +
        '</td><td>' + r.itr_done + '</td><td class="' + clsProg(p) + '">' + f1(p) + '%</td><td>' + r.punch_open + '</td></tr>';
    }).join('');
    openModal('Subsystem Breakdown — ' + discLabel(disc), summaryHtml(disc, null) + bigTable(['Subsystem', 'Description', 'ITR Total', 'ITR Done', '% Done', 'Punch Open'], body, rows.length + ' subsystem(s) · click a row for ITR-A & Punch detail'), exp, 'Subsystems_' + disc);
    // Detail-2: click a subsystem row -> ITR-A + Punch of that subsystem (× discipline)
    el('sky-modal-body').querySelectorAll('tr.sky-rrow').forEach(function (tr) {
      tr.onclick = function () { openSubsysDetail(tr.getAttribute('data-ss'), disc); };
    });
  }
  function openDailyModal(cur, label) {
    var exp = [['Day', 'KPI Plan', 'Actual', 'KPI Plan Cum %', 'Actual Cum %']];
    var body = cur.days.map(function (d, i) {
      exp.push([d, cur.planDay[i], cur.actDay[i], f1(cur.planCum[i]), f1(cur.actCum[i])]);
      return '<tr><td>' + esc(fmtDay(d)) + '</td><td>' + cur.planDay[i] + '</td><td>' + cur.actDay[i] + '</td><td>' + f1(cur.planCum[i]) + '%</td><td>' + f1(cur.actCum[i]) + '%</td></tr>';
    }).join('');
    openModal('S-Curve Daily Data — ' + label, summaryHtml(cur.disc, null) + bigTable(['Day', 'KPI Plan', 'Actual', 'KPI Plan Cum %', 'Actual Cum %'], body, 'Last 2 weeks · daily'), exp, 'SCurve_' + label);
  }

  function exportTable(rows, name) { exportSheets([{ name: name, rows: rows }], name); }
  function exportSheets(sheets, name) {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS is still loading, please retry in a moment.'); return; }
    var wb = new ExcelJS.Workbook();
    sheets.forEach(function (s) {
      var ws = wb.addWorksheet((s.name || 'Sheet').slice(0, 28).replace(/[\\/*?:\[\]]/g, ' '));
      s.rows.forEach(function (r) { ws.addRow(r); });
      if (ws.rowCount) ws.getRow(1).font = { bold: true };
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = name + '.xlsx'; a.click();
    });
  }

  // ===== LEVEL-2 detail modal (stacks above level-1) =====
  function ensureModal2() {
    if (el('sky-modal2')) return;
    var d = document.createElement('div');
    d.id = 'sky-modal2'; d.className = 'sky-modal2';
    d.innerHTML = '<div class="sky-win"><div class="sky-win-head"><h3 id="sky-m2-title"></h3>' +
      '<button class="btn btn-secondary" id="sky-m2-export" style="padding:0.3rem 0.6rem;font-size:0.7rem;min-height:auto;">Export</button>' +
      '<button class="sky-x" id="sky-m2-x" title="Back">&times;</button></div>' +
      '<div class="sky-win-body" id="sky-m2-body"></div></div>';
    document.body.appendChild(d);
    el('sky-m2-x').onclick = closeModal2;
    d.addEventListener('click', function (e) { if (e.target === d) closeModal2(); });
  }
  function closeModal2() { var m = el('sky-modal2'); if (m) m.classList.remove('open'); }
  function openModal2(title, html, onExport) {
    ensureModal2();
    el('sky-m2-title').textContent = title;
    el('sky-m2-body').innerHTML = html;
    var xb = el('sky-m2-export');
    if (onExport) { xb.style.display = ''; xb.onclick = onExport; } else { xb.style.display = 'none'; }
    el('sky-modal2').classList.add('open');
  }

  // Detail-2: ITR-A checksheets + Punch list for one subsystem × discipline (like precom's openSubsystemWindow)
  function openSubsysDetail(ss, disc) {
    var dw = discWhere(disc);
    var itr = window.PrecomDB.query(
      "SELECT tag_no, tag_desc, cs_type, plan_finish, complete_date FROM itr_a" +
      " WHERE subsystem=?" + dw + " ORDER BY (complete_date IS NOT NULL AND TRIM(complete_date)<>''), tag_no LIMIT " + LIMIT, [ss]);
    var pun = window.PrecomDB.query(
      "SELECT punch_no, category, status, tag_no, description FROM punch_list" +
      " WHERE subsystem=?" + dw + " ORDER BY category, (UPPER(TRIM(status))='CLOSED'), punch_no LIMIT " + LIMIT, [ss]);
    var itrDone = itr.filter(function (r) { return r.complete_date && String(r.complete_date).trim(); }).length;
    var punOpen = pun.filter(function (r) { return String(r.status || '').toUpperCase().trim() !== 'CLOSED'; }).length;

    var itrExp = [['Tag No', 'Description', 'CS Type', 'Plan Finish', 'Complete Date', 'Status']];
    var itrBody = itr.map(function (r) {
      var done = r.complete_date && String(r.complete_date).trim();
      itrExp.push([r.tag_no, r.tag_desc, r.cs_type, r.plan_finish || '', r.complete_date || '', done ? 'Complete' : 'Open']);
      return '<tr><td class="mono">' + esc(r.tag_no) + '</td><td class="l">' + esc(r.tag_desc || '') + '</td><td>' + esc(r.cs_type || '') +
        '</td><td>' + esc(r.plan_finish || '') + '</td><td>' + esc(r.complete_date || '') + '</td><td>' +
        (done ? '<span class="sky-badge-done">Complete</span>' : '<span class="sky-badge-open">Open</span>') + '</td></tr>';
    }).join('');
    var punExp = [['Punch No', 'Category', 'Status', 'Tag No', 'Description']];
    var punBody = pun.map(function (r) {
      punExp.push([r.punch_no, r.category, r.status, r.tag_no, r.description]);
      return '<tr><td class="mono">' + esc(r.punch_no) + '</td><td>' + esc(r.category) + '</td><td>' + esc(r.status || '') +
        '</td><td class="mono">' + esc(r.tag_no || '') + '</td><td class="l">' + esc(r.description || '') + '</td></tr>';
    }).join('');

    var html =
      summaryHtml(disc, ss) +
      '<div class="sky-sec-title" style="margin:6px 16px 4px;">ITR-A Checksheets (' + itr.length + ')</div>' +
      bigTable(['Tag No', 'Description', 'CS Type', 'Plan Finish', 'Complete Date', 'Status'], itrBody ||
        '<tr><td colspan="6" style="text-align:center;padding:14px;">No ITR-A.</td></tr>', null) +
      '<div class="sky-sec-title" style="margin:16px 16px 4px;">Punch List (' + pun.length + ')</div>' +
      bigTable(['Punch No', 'Category', 'Status', 'Tag No', 'Description'], punBody ||
        '<tr><td colspan="5" style="text-align:center;padding:14px;">No punch.</td></tr>', null);
    openModal2(ss + ' · ' + discLabel(disc), html, function () {
      exportSheets([{ name: 'ITR-A', rows: itrExp }, { name: 'Punch', rows: punExp }], 'Detail_' + ss + '_' + disc);
    });
  }

  // ---- Right panel ----
  function renderRight(disc) {
    var right = el('sky-right'); if (!right) return;
    var label = disc ? discLabel(disc) : 'Overall CPP Topside';
    var cur = buildDaily(disc);
    var t = cur.totals, prog = pct(t.done, t.total);
    right.innerHTML =
      '<h3 style="margin:2px 0 4px;font-size:0.95rem;">' + esc(label) + '</h3>' +
      '<div class="sky-kpis">' +
      '<div class="sky-kpi" data-act="itr-all"><div class="lab">Total ITR-A</div><div class="val">' + t.total.toLocaleString() + '</div></div>' +
      '<div class="sky-kpi" data-act="itr-done"><div class="lab">Complete</div><div class="val" style="color:#22c55e;">' + t.done.toLocaleString() + '</div></div>' +
      '<div class="sky-kpi" data-act="itr-remain"><div class="lab">Remain</div><div class="val" style="color:#f43f5e;">' + t.remain.toLocaleString() + '</div></div>' +
      '<div class="sky-kpi" data-act="daily"><div class="lab">Progress</div><div class="val ' + clsProg(prog) + '">' + f1(prog) + '%</div></div>' +
      '</div>' +
      '<div class="sky-chartbox" id="sky-chartbox"><canvas id="sky-canvas"></canvas></div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;">' +
      '<div style="flex:1 1 300px;min-width:260px;"><div class="sky-sec-title">KPI Plan vs Actual — click for daily data</div>' +
      '<div id="sky-kpi-tbl" class="sky-clk">' + kpiTable(cur) + '</div></div>' +
      '<div style="flex:1 1 300px;min-width:260px;"><div class="sky-sec-title">Punchlist — click for detail</div>' +
      '<div id="sky-punch-tbl">' + punchTable(disc) + '</div></div>' +
      '</div>' +
      (disc ? '' : ('<div class="sky-sec-title">ITR-A Detail by Discipline — click a row</div><div id="sky-itr-detail">' + itrDetailByDisc() + '</div>'));
    drawChart(el('sky-canvas'), cur, label);

    // wire clicks
    right.querySelectorAll('.sky-kpi').forEach(function (c) {
      c.onclick = function () {
        var a = c.getAttribute('data-act');
        if (a === 'itr-all') openItrModal(disc, 'all', label + ' · All ITR-A');
        else if (a === 'itr-done') openItrModal(disc, 'done', label + ' · Complete');
        else if (a === 'itr-remain') openItrModal(disc, 'remain', label + ' · Remaining');
        else openDailyModal(cur, label);
      };
    });
    var cb = el('sky-chartbox'); if (cb) cb.onclick = function () { openDailyModal(cur, label); };
    var kt = el('sky-kpi-tbl'); if (kt) kt.onclick = function () { openDailyModal(cur, label); };
    var pt = el('sky-punch-tbl'); if (pt) pt.onclick = function () { openPunchModal(disc, label); };
    var idt = el('sky-itr-detail');
    if (idt) idt.querySelectorAll('tr[data-disc]').forEach(function (tr) {
      tr.onclick = function () { openSubsysModal(tr.getAttribute('data-disc')); };
    });
  }

  // ---- Left panel ----
  function buildLeft() {
    var left = el('sky-left'); if (!left) return;
    var items = [{ key: 'ALL', name: 'Overall CPP Topside', disc: null }];
    DISCS.forEach(function (d) { items.push({ key: d, name: discLabel(d), disc: d }); });
    left.innerHTML = items.map(function (it) {
      var t = scopeTotals(it.disc);
      if (!t.total && it.disc) return '';
      var p = pct(t.done, t.total);
      return '<div class="sky-row' + (it.key === state.sel ? ' active' : '') + '" data-key="' + it.key + '">' +
        '<div><div class="nm">' + esc(it.name) + '</div><div class="sub">' + t.done.toLocaleString() + '/' + t.total.toLocaleString() + ' ITR-A</div></div>' +
        '<div class="prog ' + clsProg(p) + '">' + f1(p) + '%</div></div>';
    }).join('');
    left.querySelectorAll('.sky-row').forEach(function (r) {
      r.onclick = function () {
        state.sel = r.getAttribute('data-key');
        left.querySelectorAll('.sky-row').forEach(function (x) { x.classList.remove('active'); });
        r.classList.add('active');
        renderRight(state.sel === 'ALL' ? null : state.sel);
      };
    });
  }

  function layout() { el('skyline-body').innerHTML = '<div class="sky-left" id="sky-left"></div><div class="sky-right" id="sky-right"></div>'; }

  function initOnce() {
    var body = el('skyline-body'); if (!body) return;
    if (!state.inited) body.innerHTML = '<div class="no-selection-message" style="padding:3rem;"><div class="loading-spinner-small"></div><p style="margin-top:1rem;">Loading Skyline data…</p></div>';
    window.PrecomDB.ready().then(function () {
      if (!state.inited) {
        state.inited = true;
        if (!el('skyline-css')) document.head.insertAdjacentHTML('beforeend', CSS);
        var meta = el('skyline-meta');
        if (meta && window.DAC_SKYLINE && window.DAC_SKYLINE.meta) meta.textContent = 'Skyline cutoff ' + window.DAC_SKYLINE.meta.cutoff + ' · ' + window.DAC_SKYLINE.meta.rows + ' subsystem×discipline';
      }
      state.itrMap = null;
      var xb = el('skyline-export-btn'); if (xb) xb.onclick = function () { var disc = state.sel === 'ALL' ? null : state.sel; openDailyModal(buildDaily(disc), disc ? discLabel(disc) : 'Overall CPP Topside'); };
      layout(); buildLeft();
      renderRight(state.sel === 'ALL' ? null : state.sel);
    }).catch(function (e) {
      body.innerHTML = '<div class="no-selection-message"><h3>Failed to load data</h3><p>' + esc(e.message) + '</p></div>';
    });
  }

  window.SkylineInit = initOnce;
})();
