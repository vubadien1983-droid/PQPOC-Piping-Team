// skyline.js — Tab "Handover and Skyline"
// S-curve ITR-A: Actual (complete_date) vs Skyline DAC Plan (skyline-data.js), + bang KPI / Punchlist / ITR detail.
// Dung chung window.PrecomDB (bang itr_a, precom_summary) — LAZY, chi chay khi mo tab.
(function () {
  'use strict';

  // ---- Thu tu discipline hien thi (theo PDF CMS report) ----
  var DISCS = ['ELECTRICAL', 'INSTRUMENT', 'PIPING', 'MECHANICAL', 'HVAC', 'TELECOM', 'SAFETY', 'ARCHITECTURE', 'STRUCTURE'];

  var state = { inited: false, sel: 'ALL', itrMap: null, chart: null };

  function el(id) { return document.getElementById(id); }
  function esc(v) { return (v == null ? '' : String(v)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(d, t) { return t > 0 ? (d / t * 100) : 0; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

  var CSS =
    '<style id="skyline-css">' +
    '#skyline-body{font-size:0.78rem;}' +
    '.sky-left{flex:0 0 300px;min-width:260px;overflow-y:auto;border-right:1px solid rgba(255,255,255,0.07);padding-right:6px;}' +
    '.sky-right{flex:1;min-width:0;overflow-y:auto;padding:0 4px 20px;}' +
    '.sky-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;margin-bottom:4px;border:1px solid transparent;background:rgba(255,255,255,0.02);}' +
    '.sky-row:hover{background:rgba(56,189,248,0.08);}' +
    '.sky-row.active{background:rgba(56,189,248,0.16);border-color:rgba(56,189,248,0.5);}' +
    '.sky-row .nm{font-weight:600;}' +
    '.sky-row .sub{font-size:0.66rem;color:var(--text-muted);}' +
    '.sky-row .prog{font-size:0.72rem;font-weight:700;min-width:52px;text-align:right;}' +
    '.sky-hi{color:#22c55e;}.sky-mid{color:#eab308;}.sky-lo{color:#f43f5e;}' +
    '.sky-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:6px 0 12px;}' +
    '.sky-kpi{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 12px;}' +
    '.sky-kpi .lab{font-size:0.64rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;}' +
    '.sky-kpi .val{font-size:1.25rem;font-weight:800;margin-top:2px;}' +
    '.sky-chartbox{position:relative;height:380px;background:#f7f9fb;border:1px solid #d3dae3;border-radius:8px;padding:6px;margin-bottom:14px;}' +
    '.sky-sec-title{font-size:0.8rem;font-weight:700;margin:14px 0 6px;color:var(--text-main);border-left:3px solid #38bdf8;padding-left:8px;}' +
    'table.sky-tbl{width:100%;border-collapse:collapse;font-size:0.72rem;margin-bottom:8px;}' +
    'table.sky-tbl th,table.sky-tbl td{border:1px solid rgba(255,255,255,0.08);padding:4px 7px;text-align:center;}' +
    'table.sky-tbl th{background:rgba(56,189,248,0.12);font-weight:700;}' +
    'table.sky-tbl td.l{text-align:left;font-weight:600;}' +
    'table.sky-tbl tr.tot td{background:rgba(56,189,248,0.10);font-weight:800;}' +
    '.sky-var-pos{color:#22c55e;font-weight:800;}.sky-var-neg{color:#f43f5e;font-weight:800;}' +
    '.sky-catA{background:rgba(34,197,94,0.10);}.sky-catB{background:rgba(234,179,8,0.10);}.sky-catC{background:rgba(244,63,94,0.10);}' +
    '</style>';

  function clsProg(p) { return p >= 75 ? 'sky-hi' : p >= 40 ? 'sky-mid' : 'sky-lo'; }

  // ---- Truy van co ban theo scope (disc=null => toan bo) ----
  function discWhere(disc) { return disc ? " AND UPPER(discipline)='" + disc.replace(/'/g, "''") + "'" : ''; }

  function scopeTotals(disc) {
    var t = (window.PrecomDB.query("SELECT COUNT(*) c FROM itr_a WHERE 1=1" + discWhere(disc))[0] || {}).c || 0;
    var d = (window.PrecomDB.query("SELECT COUNT(*) c FROM itr_a WHERE complete_date IS NOT NULL AND TRIM(complete_date)<>''" + discWhere(disc))[0] || {}).c || 0;
    return { total: t, done: d, remain: t - d };
  }

  // Map (subsystem|discipline) -> itr_total, tu precom_summary (dung cho duong PLAN skyline)
  function ensureItrMap() {
    if (state.itrMap) return state.itrMap;
    var m = {};
    window.PrecomDB.query("SELECT subsystem, discipline, itr_total FROM precom_summary").forEach(function (r) {
      m[r.subsystem + '|' + r.discipline] = r.itr_total || 0;
    });
    state.itrMap = m;
    return m;
  }

  // ---- Dung du lieu S-curve theo tuan cho scope ----
  function buildCurve(disc) {
    var map = ensureItrMap();
    var plan = (window.DAC_SKYLINE && window.DAC_SKYLINE.plan) || [];
    // PLAN theo tuan: gom theo dac date, cong itr_total (chi row co dac va dung discipline)
    var planWk = {};
    plan.forEach(function (p) {
      if (!p.dac) return;
      if (disc && p.disc !== disc) return;
      planWk[p.dac] = (planWk[p.dac] || 0) + (map[p.ss + '|' + p.disc] || 0);
    });
    // ACTUAL theo ngay
    var actRows = window.PrecomDB.query(
      "SELECT substr(complete_date,1,10) d, COUNT(*) c FROM itr_a" +
      " WHERE complete_date IS NOT NULL AND TRIM(complete_date)<>''" + discWhere(disc) +
      " GROUP BY d ORDER BY d");
    // Timeline = cac tuan skyline (sorted). Bucket actual vao tuan ket thuc >= ngay hoan thanh.
    var weeks = Object.keys(planWk).sort();
    if (!weeks.length && actRows.length) {
      // Chua co plan: van ve theo tuan tu actual (moi 7 ngay)
      weeks = [];
    }
    // Neu actual co ngay truoc tuan dau -> them 1 moc dau
    var firstAct = actRows.length ? actRows[0].d : null;
    if (firstAct && (!weeks.length || firstAct < weeks[0])) weeks.unshift(firstAct);
    weeks = weeks.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();

    var actWk = {};
    weeks.forEach(function (w) { actWk[w] = 0; });
    actRows.forEach(function (r) {
      // tim tuan nho nhat >= r.d
      var w = null;
      for (var i = 0; i < weeks.length; i++) { if (weeks[i] >= r.d) { w = weeks[i]; break; } }
      if (w == null) w = weeks[weeks.length - 1];
      if (w != null) actWk[w] += r.c;
    });

    var tot = scopeTotals(disc);
    var denom = tot.total || 1;
    var planWeekly = [], actWeekly = [], planCum = [], actCum = [], cp = 0, ca = 0;
    weeks.forEach(function (w) {
      var pw = planWk[w] || 0, aw = actWk[w] || 0;
      cp += pw; ca += aw;
      planWeekly.push(pw); actWeekly.push(aw);
      planCum.push(pct(cp, denom)); actCum.push(pct(ca, denom));
    });
    return { weeks: weeks, planWeekly: planWeekly, actWeekly: actWeekly, planCum: planCum, actCum: actCum, totals: tot };
  }

  function fmtWeek(iso) { // 2026-08-09 -> 09-Aug
    var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = iso.split('-'); if (p.length !== 3) return iso;
    return p[2] + '-' + mo[(+p[1]) - 1] + '-' + p[0].slice(2);
  }

  function drawChart(cv, cur, label) {
    if (!cv || typeof Chart === 'undefined') return null;
    if (state.chart) { try { state.chart.destroy(); } catch (e) {} state.chart = null; }
    var labels = cur.weeks.map(fmtWeek);
    state.chart = new Chart(cv, {
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'KPI PLAN (ITR/tuần)', data: cur.planWeekly, backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y', order: 3 },
          { type: 'bar', label: 'ACTUAL (ITR/tuần)', data: cur.actWeekly, backgroundColor: 'rgba(34,197,94,0.8)', yAxisID: 'y', order: 2 },
          { type: 'line', label: 'KPI PLAN CUM %', data: cur.planCum, borderColor: '#ef4444', backgroundColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1', order: 1 },
          { type: 'line', label: 'ACTUAL CUM %', data: cur.actCum, borderColor: '#a855f7', backgroundColor: '#a855f7', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1', order: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 10 }, color: '#334155' } },
          title: { display: true, text: 'S-Curve ITR-A — ' + label, color: '#0f172a', font: { size: 13, weight: 'bold' } },
          datalabels: { display: false }
        },
        scales: {
          x: { ticks: { color: '#475569', font: { size: 8 }, maxRotation: 90, minRotation: 90 }, grid: { display: false } },
          y: { position: 'left', beginAtZero: true, title: { display: true, text: 'ITR / tuần', color: '#475569' }, ticks: { color: '#475569' } },
          y1: { position: 'right', beginAtZero: true, max: 100, title: { display: true, text: 'Lũy kế %', color: '#475569' }, grid: { drawOnChartArea: false }, ticks: { color: '#475569', callback: function (v) { return v + '%'; } } }
        }
      }
    });
    return state.chart;
  }

  // ---- Bang thong ke ----
  function kpiSummaryTable(cur) {
    var w = cur.weeks.length;
    var pCum = w ? cur.planCum[w - 1] : 0, aCum = w ? cur.actCum[w - 1] : 0;
    var pw = w ? cur.planWeekly[w - 1] : 0, aw = cur.actWeekly[w - 1] || 0;
    var denom = cur.totals.total || 1;
    var vr = aCum - pCum;
    return '<table class="sky-tbl"><thead><tr><th class="l">Chỉ số (lũy kế đến hiện tại)</th><th>Giá trị</th></tr></thead><tbody>' +
      '<tr><td class="l">1. KPI PLAN (tuần cuối)</td><td>' + f1(pct(pw, denom)) + '%</td></tr>' +
      '<tr><td class="l">2. KPI PLAN CUM</td><td>' + f1(pCum) + '%</td></tr>' +
      '<tr><td class="l">3. ACTUAL (tuần cuối)</td><td>' + f1(pct(aw, denom)) + '%</td></tr>' +
      '<tr><td class="l">4. ACTUAL CUM</td><td>' + f1(aCum) + '%</td></tr>' +
      '<tr class="tot"><td class="l">VAR (Actual − Plan)</td><td class="' + (vr >= 0 ? 'sky-var-pos' : 'sky-var-neg') + '">' + (vr >= 0 ? '+' : '') + f1(vr) + '%</td></tr>' +
      '</tbody></table>';
  }

  function punchTable(disc) {
    var w = disc ? " WHERE UPPER(discipline)='" + disc.replace(/'/g, "''") + "'" : '';
    var r = window.PrecomDB.query(
      "SELECT COALESCE(SUM(punch_a_total),0) at, COALESCE(SUM(punch_a_open),0) ao," +
      " COALESCE(SUM(punch_b_total),0) bt, COALESCE(SUM(punch_b_open),0) bo," +
      " COALESCE(SUM(punch_c_total),0) ct, COALESCE(SUM(punch_c_open),0) co FROM precom_summary" + w)[0] || {};
    function row(cat, t, o, cls) { return '<tr class="' + cls + '"><td class="l">CAT ' + cat + '</td><td>' + t + '</td><td>' + (t - o) + '</td><td>' + o + '</td></tr>'; }
    var tot = (r.at + r.bt + r.ct), open = (r.ao + r.bo + r.co);
    return '<table class="sky-tbl"><thead><tr><th class="l">Punchlist</th><th>Total</th><th>Closed</th><th>Open</th></tr></thead><tbody>' +
      row('A', r.at, r.ao, 'sky-catA') + row('B', r.bt, r.bo, 'sky-catB') + row('C', r.ct, r.co, 'sky-catC') +
      '<tr class="tot"><td class="l">TỔNG</td><td>' + tot + '</td><td>' + (tot - open) + '</td><td>' + open + '</td></tr>' +
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
      gt += r.total; gd += r.done;
      var p = pct(r.done, r.total);
      body += '<tr><td class="l">' + d.charAt(0) + d.slice(1).toLowerCase() + '</td><td>' + r.total + '</td><td>' + r.done +
        '</td><td class="' + clsProg(p) + '">' + f1(p) + '%</td><td>' + (r.total - r.done) + '</td></tr>';
    });
    body += '<tr class="tot"><td class="l">TỔNG</td><td>' + gt + '</td><td>' + gd + '</td><td>' + f1(pct(gd, gt)) + '%</td><td>' + (gt - gd) + '</td></tr>';
    return '<table class="sky-tbl"><thead><tr><th class="l">Discipline</th><th>Total</th><th>Complete</th><th>% Comp</th><th>Remain</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  // ---- Render panel phai ----
  function renderRight(disc) {
    var right = el('sky-right'); if (!right) return;
    var label = disc ? (disc.charAt(0) + disc.slice(1).toLowerCase()) : 'Overall CPP Topside';
    var cur = buildCurve(disc);
    var t = cur.totals;
    var prog = pct(t.done, t.total);
    var kpis =
      '<div class="sky-kpis">' +
      '<div class="sky-kpi"><div class="lab">Total ITR-A</div><div class="val">' + t.total.toLocaleString() + '</div></div>' +
      '<div class="sky-kpi"><div class="lab">Complete</div><div class="val" style="color:#22c55e;">' + t.done.toLocaleString() + '</div></div>' +
      '<div class="sky-kpi"><div class="lab">Remain</div><div class="val" style="color:#f43f5e;">' + t.remain.toLocaleString() + '</div></div>' +
      '<div class="sky-kpi"><div class="lab">Progress</div><div class="val ' + clsProg(prog) + '">' + f1(prog) + '%</div></div>' +
      '</div>';
    var detail = disc ? '' : ('<div class="sky-sec-title">ITR-A Detail theo Discipline</div>' + itrDetailByDisc());
    right.innerHTML =
      '<h3 style="margin:2px 0 4px;font-size:0.95rem;">' + esc(label) + '</h3>' +
      kpis +
      '<div class="sky-chartbox"><canvas id="sky-canvas"></canvas></div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;">' +
      '<div style="flex:1 1 280px;min-width:260px;"><div class="sky-sec-title">KPI Plan vs Actual</div>' + kpiSummaryTable(cur) + '</div>' +
      '<div style="flex:1 1 280px;min-width:260px;"><div class="sky-sec-title">Punchlist</div>' + punchTable(disc) + '</div>' +
      '</div>' +
      detail;
    drawChart(el('sky-canvas'), cur, label);
  }

  // ---- Panel trai ----
  function buildLeft() {
    var left = el('sky-left'); if (!left) return;
    var items = [{ key: 'ALL', name: 'Overall CPP Topside', disc: null }];
    DISCS.forEach(function (d) { items.push({ key: d, name: d.charAt(0) + d.slice(1).toLowerCase(), disc: d }); });
    var html = items.map(function (it) {
      var t = scopeTotals(it.disc);
      if (!t.total && it.disc) return '';   // bo discipline khong co ITR
      var p = pct(t.done, t.total);
      return '<div class="sky-row' + (it.key === state.sel ? ' active' : '') + '" data-key="' + it.key + '">' +
        '<div><div class="nm">' + esc(it.name) + '</div><div class="sub">' + t.done.toLocaleString() + '/' + t.total.toLocaleString() + ' ITR-A</div></div>' +
        '<div class="prog ' + clsProg(p) + '">' + f1(p) + '%</div></div>';
    }).join('');
    left.innerHTML = html;
    left.querySelectorAll('.sky-row').forEach(function (r) {
      r.onclick = function () {
        state.sel = r.getAttribute('data-key');
        left.querySelectorAll('.sky-row').forEach(function (x) { x.classList.remove('active'); });
        r.classList.add('active');
        renderRight(state.sel === 'ALL' ? null : state.sel);
      };
    });
  }

  function layout() {
    var body = el('skyline-body');
    body.innerHTML = '<div class="sky-left" id="sky-left"></div><div class="sky-right" id="sky-right"></div>';
  }

  function initOnce() {
    var body = el('skyline-body');
    if (!body) return;
    if (!state.inited) {
      body.innerHTML = '<div class="no-selection-message" style="padding:3rem;"><div class="loading-spinner-small"></div><p style="margin-top:1rem;">Đang tải dữ liệu Skyline…</p></div>';
    }
    window.PrecomDB.ready().then(function () {
      if (!state.inited) {
        state.inited = true;
        if (!el('skyline-css')) document.head.insertAdjacentHTML('beforeend', CSS);
        var meta = el('skyline-meta');
        if (meta && window.DAC_SKYLINE && window.DAC_SKYLINE.meta) {
          meta.textContent = 'Skyline cutoff ' + window.DAC_SKYLINE.meta.cutoff + ' · ' + window.DAC_SKYLINE.meta.rows + ' subsystem×discipline';
        }
      }
      state.itrMap = null; // reset cache moi lan mo (DB co the da refresh)
      var xb = el('skyline-export-btn'); if (xb) xb.onclick = exportCur;
      layout();
      buildLeft();
      renderRight(state.sel === 'ALL' ? null : state.sel);
    }).catch(function (e) {
      body.innerHTML = '<div class="no-selection-message"><h3>Không tải được dữ liệu</h3><p>' + esc(e.message) + '</p></div>';
    });
  }

  // Export nhanh S-curve + KPI scope dang chon
  function exportCur() {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS chưa tải xong, thử lại sau vài giây.'); return; }
    var disc = state.sel === 'ALL' ? null : state.sel;
    var label = disc ? (disc.charAt(0) + disc.slice(1).toLowerCase()) : 'Overall';
    var cur = buildCurve(disc);
    var wb = new ExcelJS.Workbook(); var ws = wb.addWorksheet('Skyline ' + label);
    ws.addRow(['Week', 'KPI PLAN', 'ACTUAL', 'KPI PLAN CUM %', 'ACTUAL CUM %']);
    cur.weeks.forEach(function (w, i) {
      ws.addRow([fmtWeek(w), cur.planWeekly[i], cur.actWeekly[i], +f1(cur.planCum[i]), +f1(cur.actCum[i])]);
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = 'Skyline_SCurve_' + label + '.xlsx'; a.click();
    });
  }

  window.SkylineInit = initOnce;
  document.addEventListener('DOMContentLoaded', function () {
    var b = el('skyline-export-btn'); if (b) b.onclick = exportCur;
  });
})();
