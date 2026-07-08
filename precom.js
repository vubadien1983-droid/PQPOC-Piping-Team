/* precom.js -- Tab "Precom": DAC / CSSC dashboard (ITR-A + Punch A/B).
 *
 * Nghiep vu: DAC = discipline cua subsystem co 100% ITR-A done (CompleteDate co ngay)
 * VA 100% Punch A closed. CSSC = subsystem khi TAT CA discipline da DAC.
 * UI (user chot):
 *  - Bang theo mau: header 2 tang, moi discipline 3 cot con ITR-A/PunchA/PunchB (%duoi so),
 *    khong co Description, Subsystem No bo prefix CPPT- (export van giu du + description).
 *  - THEME SANG (trang diu) rieng tab nay de phan biet voi app cu; header bang co dinh (sticky).
 *  - Click o/ten subsystem -> table CHI hien du lieu do + chart theo pham vi; nut Clear filter.
 *  - Chart: truc thoi gian LIEN TUC (ngay khong co du lieu = 0), bar closed/ngay + line luy ke
 *    Actual + Plan (dashed).
 *  - Export Excel: highlight mau nhu app (DAC xanh, CSSC xanh dam, header toi).
 */
(function () {
  'use strict';

  var state = { system: '__ALL__', q: '', onlyPending: false, inited: false,
                disciplines: [], sel: { type: 'all', ss: null, disc: null }, kpiSel: null };
  var _chart = null;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function pct(d, t) { return t > 0 ? Math.round(d * 100 / t) : 0; }
  function pctCls(p) { return p >= 80 ? 'pcm-hi' : (p >= 40 ? 'pcm-mid' : 'pcm-lo'); }

  var DISC_ORDER = ['MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT', 'TELECOM',
                    'STRUCTURE', 'ARCHITECTURE', 'HVAC', 'SAFETY'];

  // ---- THEME SANG rieng cho tab Precom (trang diu #e9edf2, chu toi tuong phan) ----
  var CSS = '<style id="precom-css">' +
    '#precom-view-container .card{background:#e9edf2;color:#17233b;border:1px solid #d3dae3;}' +
    '#precom-view-container .dash-zone-header h2{color:#17233b;}' +
    '#precom-view-container .stat-card{background:#f7f9fb;border:1px solid #d9e0e9;}' +
    '#precom-view-container .stat-card-label{color:#5b6b80;}' +
    '#precom-view-container .stat-frac{color:#17233b;}' +
    '#precom-view-container .stat-pct{color:#334155;}' +
    '#precom-view-container .stat-card-sub{color:#5b6b80;}' +
    '#precom-view-container .stat-bar{background:#dde4ec;}' +
    '#precom-view-container select,#precom-view-container input[type=text]{background:#fff!important;color:#17233b!important;border:1px solid #c4cedb!important;}' +
    '#precom-view-container label{color:#40506a!important;}' +
    '.pcm-hint{font-size:.66rem;color:#5b6b80;margin:2px 0 4px;}' +
    '.pcm-hi{color:#059669!important;}.pcm-mid{color:#b45309!important;}.pcm-lo{color:#dc2626!important;}' +
    '#precom-body .table-container{background:#fdfdfe;border:1px solid #d3dae3;border-radius:6px;}' +
    '#precom-body table{border-collapse:separate;border-spacing:0;width:100%;}' +
    '#precom-body th,#precom-body td{border-right:1px solid #d9e0e9;border-bottom:1px solid #d9e0e9;color:#17233b;}' +
    // Sticky 2-tang header: tang 1 top:0 (cao 24px), tang 2 top:24px
    '#precom-body thead th{position:sticky;z-index:6;background:#c9d3e0!important;color:#17233b!important;text-shadow:none!important;}' +
    '#precom-body thead tr:first-child th{top:0;height:24px;}' +
    '#precom-body thead tr:nth-child(2) th{top:24px;background:#d7dee8!important;}' +
    '.pcm-dh{font-size:.62rem!important;letter-spacing:.03em;text-align:center!important;padding:2px!important;color:#17233b!important;font-weight:800!important;}' +
    '.pcm-sh{font-size:.56rem!important;color:#5b6b80!important;text-align:center!important;padding:2px!important;font-weight:700!important;}' +
    '.pcm-c{min-width:50px;max-width:74px;text-align:center;font-size:.66rem;font-weight:700;padding:2px 3px!important;vertical-align:middle;cursor:pointer;background:#fff;}' +
    '.pcm-c .pp{font-size:.58rem;font-weight:700;margin-top:1px;}' +
    '.pcm-c.na{color:#94a3b8;font-weight:400;cursor:default;}' +
    '#precom-body td.dac-ok{background:#cdeeda!important;}' +
    '#precom-body td.sel{box-shadow:inset 0 0 0 2px #0369a1;}' +
    '.pcm-ssname{cursor:pointer;font-size:.7rem;padding:2px 6px!important;white-space:nowrap;background:#f2f5f8;}' +
    '.pcm-ssname strong{color:#0f3568!important;}' +
    '.pcm-gt{min-width:80px;text-align:center;font-size:.68rem;font-weight:800;padding:2px 4px!important;background:#eef2f6;}' +
    '.pcm-sys-row td{background:#dcd7f5!important;color:#4c3d99!important;font-weight:800;font-size:.7rem;letter-spacing:.04em;padding:3px 8px!important;}' +
    '#precom-body tr.pcm-cssc td{background:#dff3e7;}' +
    '.pcm-badge{font-size:.56rem;padding:1px 6px;border-radius:8px;font-weight:800;letter-spacing:.03em;display:inline-block;margin-top:1px;}' +
    '.pcm-badge.cssc{background:#b7e6c9;color:#047857;border:1px solid #34d399;}' +
    '.pcm-badge.no{background:#e2e8f0;color:#64748b;}' +
    // Layout: #precom-body CUON DOC ca trang; chart LON 420px; moi bang detail co
    // khung cuon rieng (.det-wrap) de header sticky hoat dong dung tung bang.
    '#precom-body{overflow-y:auto!important;overflow-x:hidden;}' +
    '#precom-chart-wrap{flex:0 0 auto;height:420px;min-height:420px;position:relative;border-top:1px solid #d3dae3;padding:4px;background:#f7f9fb;border-radius:6px;margin-top:6px;}' +
    '#precom-detail{flex:0 0 auto;background:#fdfdfe;border:1px solid #d3dae3;border-radius:6px;margin-top:6px;padding:4px 8px;}' +
    '#precom-detail h3{font-size:.72rem;color:#17233b;margin:6px 0 3px;display:flex;align-items:center;gap:8px;}' +
    '.det-wrap{max-height:320px;overflow:auto;position:relative;border:1px solid #e5eaf0;border-radius:4px;margin-bottom:6px;}' +
    '.det-wrap table{border-collapse:separate;border-spacing:0;width:100%;}' +
    '.det-wrap thead th{position:sticky!important;top:0!important;height:auto!important;background:#d7dee8!important;color:#17233b!important;font-size:.58rem;padding:3px 4px;text-align:left;z-index:3;}' +
    '#precom-detail td{font-size:.64rem;color:#17233b;padding:2px 4px;border-bottom:1px solid #e5eaf0;vertical-align:top;}' +
    '#precom-detail tr.done td{background:#e9f7ef;}' +
    '#precom-detail tr.opa td{background:#fde8e8;}' +
    '.pcm-det-btn{padding:2px 10px;font-size:.6rem;border-radius:5px;border:1px solid #0369a1;color:#0369a1;background:#fff;cursor:pointer;font-weight:700;}' +
    '</style>';

  function ssShort(ss) { return String(ss || '').replace(/^CPPT-/i, ''); }
  function discSort(a, b) {
    var ia = DISC_ORDER.indexOf(a.toUpperCase()), ib = DISC_ORDER.indexOf(b.toUpperCase());
    if (ia < 0) ia = 99; if (ib < 0) ib = 99;
    return ia - ib || a.localeCompare(b);
  }
  function hasFilter() {
    return state.system !== '__ALL__' || state.q !== '' || state.onlyPending ||
           state.sel.type !== 'all' || !!state.kpiSel;
  }

  // ---- Hook duoc app.js goi khi mo tab -------------------------------------------
  function initOnce() {
    var body = el('precom-body');
    if (!state.inited) {
      body.innerHTML = '<div class="no-selection-message" style="padding:3rem;"><div class="loading-spinner-small"></div>' +
        '<p style="margin-top:1rem;">Đang tải dữ liệu Precom (ITR-A)…</p></div>';
    }
    window.PrecomDB.ready().then(function () {
      if (!state.inited) {
        state.inited = true;
        if (!el('precom-css')) document.head.insertAdjacentHTML('beforeend', CSS);
        state.disciplines = window.PrecomDB.query(
          "SELECT DISTINCT discipline FROM precom_summary WHERE discipline<>'' ORDER BY discipline")
          .map(function (r) { return r.discipline; }).sort(discSort);
        buildToolbar();
      }
      render();
    }).catch(function (e) {
      body.innerHTML = '<div class="no-selection-message"><h3>Không tải được dữ liệu Precom</h3><p>' + esc(e.message) +
        '</p><p>Chạy <b>Precom\\Build_Precom_Local.bat</b> rồi bấm lại tab này (không cần F5).</p></div>';
    });
  }

  function buildToolbar() {
    var systems = window.PrecomDB.query(
      "SELECT system_no, COUNT(DISTINCT subsystem) ss FROM precom_summary WHERE system_no IS NOT NULL GROUP BY system_no ORDER BY system_no");
    var sel = el('precom-system-filter');
    sel.innerHTML = '<option value="__ALL__">Tất cả systems (' + systems.length + ')</option>' +
      systems.map(function (s) { return '<option value="' + esc(s.system_no) + '">' + esc(s.system_no) + ' (' + s.ss + ')</option>'; }).join('');
    sel.onchange = function () { state.system = sel.value; state.sel = { type: 'all' }; render(); };
    el('precom-search').oninput = function (e) { state.q = e.target.value.trim().toUpperCase(); render(); };
    el('precom-pending-toggle').onchange = function (e) { state.onlyPending = e.target.checked; render(); };
    el('precom-export-btn').onclick = function () { exportData(false); };
    var allBtn = el('precom-export-all-btn');
    if (allBtn) allBtn.onclick = function () { exportData(true); };
    var clr = el('precom-clear-btn');
    if (clr) clr.onclick = function () {
      state.system = '__ALL__'; state.q = ''; state.onlyPending = false;
      state.sel = { type: 'all' }; state.kpiSel = null;
      sel.value = '__ALL__'; el('precom-search').value = ''; el('precom-pending-toggle').checked = false;
      render();
    };
    window.addEventListener('precomdb-updated', function () { render(); });
  }

  // ---- Data -----------------------------------------------------------------------
  function loadRows() {
    var where = [], params = [];
    if (state.system !== '__ALL__') { where.push('system_no = ?'); params.push(state.system); }
    var rows = window.PrecomDB.query(
      'SELECT subsystem, subsystem_desc, system_no, discipline, itr_total, itr_done,' +
      ' COALESCE(punch_a_total,0) pa_t, COALESCE(punch_a_open,0) pa_o,' +
      ' COALESCE(punch_b_total,0) pb_t, COALESCE(punch_b_open,0) pb_o' +
      ' FROM precom_summary' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY system_no, subsystem', params);
    var byss = {};
    rows.forEach(function (r) {
      r.dac = (r.itr_done >= r.itr_total && r.pa_o === 0) ? 1 : 0;
      var g = byss[r.subsystem] || (byss[r.subsystem] = {
        subsystem: r.subsystem, desc: r.subsystem_desc || '', system: r.system_no || '',
        total: 0, done: 0, paT: 0, paO: 0, pbT: 0, pbO: 0, discN: 0, dacN: 0, disc: {}
      });
      g.total += r.itr_total; g.done += r.itr_done;
      g.paT += r.pa_t; g.paO += r.pa_o; g.pbT += r.pb_t; g.pbO += r.pb_o;
      g.discN += 1; g.dacN += r.dac;
      g.disc[r.discipline] = r;
    });
    var list = Object.keys(byss).map(function (k) { return byss[k]; });
    list.forEach(function (g) { g.cssc = (g.discN > 0 && g.dacN >= g.discN) ? 1 : 0; });
    list.sort(function (a, b) { return (a.system + a.subsystem).localeCompare(b.system + b.subsystem); });
    if (state.q) list = list.filter(function (g) {
      return g.subsystem.indexOf(state.q) >= 0 || (g.desc || '').toUpperCase().indexOf(state.q) >= 0;
    });
    if (state.onlyPending) list = list.filter(function (g) { return !g.cssc; });
    // LUU Y: KHONG loc bang chinh theo click nua (user chot): bang chinh giu nguyen,
    // lua chon chi highlight o + hien DETAIL o preview ben duoi + doi pham vi chart.
    return list;
  }

  // ---- Render ----------------------------------------------------------------------
  function render() {
    var list = loadRows(), meta = window.PrecomDB.meta();
    var tot = 0, don = 0, paT = 0, paO = 0, dacN = 0, dacT = 0, csscN = 0;
    list.forEach(function (g) {
      tot += g.total; don += g.done; paT += g.paT; paO += g.paO;
      dacN += g.dacN; dacT += g.discN; csscN += g.cssc;
    });

    var clr = el('precom-clear-btn');
    if (clr) clr.style.display = hasFilter() ? '' : 'none';

    el('precom-kpis').innerHTML =
      kpi('ITR-A Done', don.toLocaleString() + ' / ' + tot.toLocaleString(), pct(don, tot), '#0369a1', 'itr') +
      kpi('Punch A Closed', paT ? ((paT - paO).toLocaleString() + ' / ' + paT.toLocaleString()) : 'Chưa có dữ liệu', paT ? pct(paT - paO, paT) : 0, '#dc2626', 'pa') +
      kpi('DAC (Discipline Ready)', dacN + ' / ' + dacT, pct(dacN, dacT), '#7c3aed', 'dac') +
      kpi('CSSC (Subsystem)', csscN + ' / ' + list.length, pct(csscN, list.length), '#059669', 'cssc');
    el('precom-kpis').querySelectorAll('[data-kpi]').forEach(function (card) {
      card.onclick = function () { state.kpiSel = card.getAttribute('data-kpi'); state.sel = { type: 'all' }; render(); };
    });

    var discs = state.disciplines;   // bang chinh LUON hien du cac discipline
    var nCols = 1 + discs.length * 3 + 1;
    var thead =
      '<tr><th rowspan="2" style="min-width:86px;">Subsystem No</th>' +
      discs.map(function (d) { return '<th colspan="3" class="pcm-dh">' + esc(d.toUpperCase()) + '</th>'; }).join('') +
      '<th rowspan="2" class="pcm-gt">Grand Total</th></tr>' +
      '<tr>' + discs.map(function () { return '<th class="pcm-sh">ITR-A</th><th class="pcm-sh">Punch A</th><th class="pcm-sh">Punch B</th>'; }).join('') + '</tr>';

    function subCell(g, d, val, p, extraCls) {
      var selCls = (state.sel.type === 'cell' && state.sel.ss === g.subsystem && state.sel.disc === d) ? ' sel' : '';
      return '<td class="pcm-c' + (extraCls || '') + selCls + '" data-ss="' + esc(g.subsystem) +
        '" data-disc="' + esc(d) + '" title="' + esc(g.subsystem) + ' · ' + esc(d) + ' — click: lọc + chart · double-click: danh sách tag">' +
        val + (p === null ? '' : '<div class="pp ' + pctCls(p) + '">' + p + '%</div>') + '</td>';
    }

    var lastSys = null, html = '';
    list.forEach(function (g) {
      if (g.system !== lastSys) {
        lastSys = g.system;
        html += '<tr class="pcm-sys-row"><td colspan="' + nCols + '">SYSTEM ' + esc(g.system || '?') + '</td></tr>';
      }
      var p = pct(g.done, g.total);
      var cells = discs.map(function (d) {
        var r = g.disc[d];
        // Hien o khi co BAT KY du lieu (ITR-A hoac Punch) - subsystem chi co punch van thay
        if (!r || (!r.itr_total && !r.pa_t && !r.pb_t)) {
          return '<td class="pcm-c na">–</td><td class="pcm-c na">–</td><td class="pcm-c na">–</td>';
        }
        var dac = r.dac ? ' dac-ok' : '';
        var itr = r.itr_total ? subCell(g, d, r.itr_done + '/' + r.itr_total, pct(r.itr_done, r.itr_total), dac)
                              : '<td class="pcm-c na' + dac + '">–</td>';
        var pa = r.pa_t ? subCell(g, d, (r.pa_t - r.pa_o) + '/' + r.pa_t, pct(r.pa_t - r.pa_o, r.pa_t), dac)
                        : '<td class="pcm-c na' + dac + '">–</td>';
        var pb = r.pb_t ? subCell(g, d, (r.pb_t - r.pb_o) + '/' + r.pb_t, pct(r.pb_t - r.pb_o, r.pb_t), dac)
                        : '<td class="pcm-c na' + dac + '">–</td>';
        return itr + pa + pb;
      }).join('');
      html += '<tr class="' + (g.cssc ? 'pcm-cssc' : '') + '">' +
        '<td class="pcm-ssname" data-ssname="' + esc(g.subsystem) + '" title="' + esc(g.subsystem) + ' — ' + esc(g.desc) + ' · Click: lọc + chart · Double-click: danh sách tag">' +
        '<strong>' + esc(ssShort(g.subsystem)) + '</strong></td>' +
        cells +
        '<td class="pcm-gt">' + g.done + '/' + g.total +
        '<div class="pp ' + pctCls(p) + '">' + p + '%</div>' +
        '<span class="pcm-badge ' + (g.cssc ? 'cssc' : 'no') + '">' + (g.cssc ? 'CSSC' : g.dacN + '/' + g.discN + ' DAC') + '</span></td></tr>';
    });

    el('precom-body').innerHTML =
      '<div class="pcm-hint">Click ô discipline / tên subsystem để LỌC bảng + xem biểu đồ · Double-click: danh sách tag · Ô xanh = đạt DAC · Nút "Xoá lọc" để hiện lại tất cả</div>' +
      '<div class="table-container" style="flex:0 0 auto;max-height:56vh;overflow:auto;min-height:120px;">' +
      '<table><thead>' + thead + '</thead><tbody>' +
      (html || '<tr><td colspan="' + nCols + '" class="text-center" style="padding:2rem;">Không có subsystem nào khớp bộ lọc.</td></tr>') +
      '</tbody></table></div>' +
      '<div id="precom-detail" style="display:none;"></div>' +
      '<div id="precom-chart-wrap"><canvas id="precom-chart"></canvas></div>';

    el('precom-body').querySelectorAll('td[data-ss][data-disc]').forEach(function (td) {
      td.onclick = function () { state.kpiSel = null; state.sel = { type: 'cell', ss: td.getAttribute('data-ss'), disc: td.getAttribute('data-disc') }; render(); };
      td.ondblclick = function () { showDetail(td.getAttribute('data-ss'), td.getAttribute('data-disc')); };
    });
    el('precom-body').querySelectorAll('[data-ssname]').forEach(function (td) {
      td.onclick = function () { state.kpiSel = null; state.sel = { type: 'ss', ss: td.getAttribute('data-ssname') }; render(); };
      td.ondblclick = function () { showDetail(td.getAttribute('data-ssname'), null); };
    });

    renderDetail();
    renderChart();
    // Cuon detail vao tam nhin khi user vua chon (bang chinh giu nguyen, chart van o duoi)
    if (state.kpiSel || state.sel.type !== 'all') {
      var det = el('precom-detail');
      if (det && det.style.display !== 'none') {
        try { det.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      }
    }
  }

  // ---- PREVIEW DETAIL: click o/subsystem -> bang chi tiet tu DU LIEU NGUON -------
  function detailQueries() {
    var sc = scopeWhere();
    var itr = window.PrecomDB.query(
      'SELECT system_no, subsystem, tag_no, tag_desc, discipline, cs_type, plan_start, plan_finish, complete_date, norm, location' +
      ' FROM itr_a WHERE 1=1' + sc.sql +
      " ORDER BY (complete_date IS NOT NULL AND TRIM(complete_date)<>''), discipline, tag_no", sc.params);
    var pun = [];
    try {
      pun = window.PrecomDB.query(
        'SELECT punch_no, punch_raised_no, category, status, discipline, tag_no, drawing_no, description,' +
        ' corrective_action, action_by, raise_by, open_date, closed_date, expected_date, phase, package, subsystem' +
        ' FROM punch_list WHERE 1=1' + sc.sql +
        " ORDER BY (UPPER(TRIM(status))='CLOSED'), category, punch_no", sc.params);
    } catch (e) { /* chua co du lieu punch / thieu cot */ }
    return { itr: itr, pun: pun };
  }

  // ---- KPI detail: click the ITR-A / Punch A / DAC / CSSC -> danh sach tuong ung ----
  function tableHtml(head, rows, cap) {
    var capped = cap && rows.length > cap;
    var body = (capped ? rows.slice(0, cap) : rows).join('');
    return '<div class="det-wrap"><table><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="' + head.length + '">Không có dữ liệu.</td></tr>') +
      '</tbody></table></div>' +
      (capped ? '<div class="pcm-hint">Hiển thị ' + cap + '/' + rows.length + ' dòng — Export Excel để lấy đầy đủ.</div>' : '');
  }

  function renderKpiDetail(box) {
    var d = detailQueries();          // theo bo loc system hien tai (sel = all)
    var day = function (v) { return esc(String(v || '').slice(0, 10)); };
    var list = loadRows();
    var title = { itr: 'ITR-A Checksheets', pa: 'Punch Category A', dac: 'DAC theo Subsystem × Discipline', cssc: 'CSSC theo Subsystem' }[state.kpiSel];
    var html = '<h3>Chi tiết KPI: ' + title +
      ' <button class="pcm-det-btn" id="precom-det-export">Export detail Excel</button></h3>';

    if (state.kpiSel === 'itr') {
      html += tableHtml(['#', 'Subsystem', 'TagNo', 'Description', 'Disc', 'ITR', 'PlanFinish', 'Complete'],
        d.itr.map(function (r, i) {
          var done = r.complete_date && String(r.complete_date).trim() !== '';
          return '<tr class="' + (done ? 'done' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
            '<td><b>' + esc(r.tag_no) + '</b></td><td>' + esc(r.tag_desc) + '</td><td>' + esc(r.discipline) + '</td>' +
            '<td>' + esc(r.cs_type) + '</td><td>' + day(r.plan_finish) + '</td>' +
            '<td>' + (done ? day(r.complete_date) : 'PENDING') + '</td></tr>';
        }), 800);
    } else if (state.kpiSel === 'pa') {
      var pa = d.pun.filter(function (r) { return String(r.category || '').trim().toUpperCase() === 'A'; });
      html += tableHtml(['#', 'Subsystem', 'PunchNo', 'Status', 'Disc', 'TagNo', 'Defect Description', 'ActionBy', 'Open', 'Closed'],
        pa.map(function (r, i) {
          var closed = String(r.status || '').trim().toUpperCase() === 'CLOSED';
          return '<tr class="' + (closed ? 'done' : 'opa') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
            '<td><b>' + esc(r.punch_no) + '</b></td><td>' + esc(r.status) + '</td><td>' + esc(r.discipline) + '</td>' +
            '<td>' + esc(r.tag_no) + '</td><td style="max-width:360px;white-space:normal;">' + esc(String(r.description || '').slice(0, 200)) + '</td>' +
            '<td>' + esc(r.action_by) + '</td><td>' + day(r.open_date) + '</td><td>' + day(r.closed_date) + '</td></tr>';
        }), 800);
    } else if (state.kpiSel === 'dac') {
      var cells = [];
      list.forEach(function (g) {
        Object.keys(g.disc).forEach(function (dk) {
          var r = g.disc[dk];
          cells.push('<tr class="' + (r.dac ? 'done' : '') + '"><td>' + (cells.length + 1) + '</td>' +
            '<td>' + esc(ssShort(g.subsystem)) + '</td><td>' + esc(g.desc) + '</td><td>' + esc(dk) + '</td>' +
            '<td>' + r.itr_done + '/' + r.itr_total + '</td><td>' + (r.pa_t ? (r.pa_t - r.pa_o) + '/' + r.pa_t : '–') + '</td>' +
            '<td>' + (r.pa_o || 0) + '</td><td><b>' + (r.dac ? 'DAC ✓' : '-') + '</b></td></tr>');
        });
      });
      html += tableHtml(['#', 'Subsystem', 'Description', 'Discipline', 'ITR-A done/total', 'PunchA closed/total', 'PunchA OPEN', 'DAC'], cells, 1000);
    } else {   // cssc
      html += tableHtml(['#', 'Subsystem', 'Description', 'System', 'ITR-A', 'PunchA open', 'DAC đạt', 'CSSC'],
        list.map(function (g, i) {
          return '<tr class="' + (g.cssc ? 'done' : '') + '"><td>' + (i + 1) + '</td>' +
            '<td><b>' + esc(ssShort(g.subsystem)) + '</b></td><td>' + esc(g.desc) + '</td><td>' + esc(g.system) + '</td>' +
            '<td>' + g.done + '/' + g.total + '</td><td>' + (g.paO || 0) + '</td>' +
            '<td>' + g.dacN + '/' + g.discN + '</td><td><b>' + (g.cssc ? 'CSSC ✓' : '-') + '</b></td></tr>';
        }), 1000);
    }
    box.innerHTML = html;
    box.style.display = '';
    var b = el('precom-det-export');
    if (b) b.onclick = exportDetail;   // export ITR-A + Punch theo pham vi loc hien tai
  }

  function renderDetail() {
    var box = el('precom-detail');
    if (!box) return;
    if (state.kpiSel) { renderKpiDetail(box); return; }
    if (state.sel.type === 'all') { box.style.display = 'none'; box.innerHTML = ''; return; }
    var d = detailQueries();
    var day = function (v) { return esc(String(v || '').slice(0, 10)); };

    var itrRows = d.itr.map(function (r, i) {
      var done = r.complete_date && String(r.complete_date).trim() !== '';
      return '<tr class="' + (done ? 'done' : '') + '"><td>' + (i + 1) + '</td><td><b>' + esc(r.tag_no) + '</b></td>' +
        '<td>' + esc(r.tag_desc) + '</td><td>' + esc(r.discipline) + '</td><td>' + esc(r.cs_type) + '</td>' +
        '<td>' + day(r.plan_start) + '</td><td>' + day(r.plan_finish) + '</td>' +
        '<td>' + (done ? day(r.complete_date) : 'PENDING') + '</td><td>' + esc(r.norm) + '</td></tr>';
    }).join('');

    var punRows = d.pun.map(function (r, i) {
      var closed = String(r.status || '').trim().toUpperCase() === 'CLOSED';
      var openA = !closed && String(r.category || '').trim().toUpperCase() === 'A';
      return '<tr class="' + (closed ? 'done' : (openA ? 'opa' : '')) + '"><td>' + (i + 1) + '</td>' +
        '<td><b>' + esc(r.punch_no) + '</b></td><td>' + esc(r.punch_raised_no) + '</td>' +
        '<td style="text-align:center;font-weight:800;">' + esc(r.category) + '</td>' +
        '<td>' + esc(r.status) + '</td><td>' + esc(r.discipline) + '</td><td>' + esc(r.tag_no) + '</td>' +
        '<td style="max-width:340px;white-space:normal;">' + esc(String(r.description || '').slice(0, 220)) + '</td>' +
        '<td>' + esc(r.action_by) + '</td><td>' + day(r.open_date) + '</td><td>' + day(r.closed_date) + '</td>' +
        '<td>' + day(r.expected_date) + '</td><td>' + esc(r.phase) + '</td></tr>';
    }).join('');

    box.innerHTML =
      '<h3>Chi tiết: ' + esc(scopeLabel()) +
      ' <button class="pcm-det-btn" id="precom-det-export">Export detail Excel</button>' +
      ' <span style="font-weight:400;color:#5b6b80;">(ITR-A: ' + d.itr.length + ' dòng · Punch: ' + d.pun.length + ' dòng)</span></h3>' +
      '<h3>ITR-A Checksheets</h3>' +
      '<div class="det-wrap"><table><thead><tr><th>#</th><th>TagNo</th><th>Description</th><th>Disc</th><th>ITR</th><th>PlanStart</th><th>PlanFinish</th><th>Complete</th><th>Norm</th></tr></thead>' +
      '<tbody>' + (itrRows || '<tr><td colspan="9">Không có ITR-A trong phạm vi này.</td></tr>') + '</tbody></table></div>' +
      '<h3 style="margin-top:8px;">Punch List <span style="font-weight:400;color:#5b6b80;">(đỏ = Cat A đang Open, xanh = Closed)</span></h3>' +
      '<div class="det-wrap"><table><thead><tr><th>#</th><th>PunchNo</th><th>RaisedNo</th><th>Cat</th><th>Status</th><th>Disc</th><th>TagNo</th><th>Defect Description</th><th>ActionBy</th><th>Open</th><th>Closed</th><th>Expected</th><th>Phase</th></tr></thead>' +
      '<tbody>' + (punRows || '<tr><td colspan="13">Không có punch trong phạm vi này.</td></tr>') + '</tbody></table></div>';
    box.style.display = '';
    var b = el('precom-det-export');
    if (b) b.onclick = exportDetail;
  }

  function exportDetail() {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS chưa sẵn sàng.'); return; }
    var d = detailQueries(), wb = new ExcelJS.Workbook();
    function sheet(name, rows, doneFn, alertFn) {
      var ws = wb.addWorksheet(name);
      if (!rows.length) return ws;
      var cols = Object.keys(rows[0]);
      ws.addRow(cols);
      rows.forEach(function (r) {
        var xr = ws.addRow(cols.map(function (c) { return r[c]; }));
        if (doneFn && doneFn(r)) xr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }; });
        else if (alertFn && alertFn(r)) xr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; });
      });
      ws.getRow(1).eachCell(function (c) { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      return ws;
    }
    sheet('ITR-A_' + scopeLabel().replace(/[^\w-]+/g, '_').slice(0, 20), d.itr,
      function (r) { return r.complete_date && String(r.complete_date).trim() !== ''; });
    sheet('Punch_' + scopeLabel().replace(/[^\w-]+/g, '_').slice(0, 20), d.pun,
      function (r) { return String(r.status || '').toUpperCase().trim() === 'CLOSED'; },
      function (r) { return String(r.category || '').trim().toUpperCase() === 'A'; });
    wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = 'Precom_Detail_' + scopeLabel().replace(/[^\w-]+/g, '_') + '.xlsx';
      a.click(); URL.revokeObjectURL(a.href);
    });
  }

  function kpi(label, frac, p, color, key) {
    var selCls = (state.kpiSel === key) ? 'box-shadow:0 0 0 2px ' + color + ';' : '';
    return '<div class="stat-card" data-kpi="' + key + '" style="cursor:pointer;' + selCls + '" title="Click: xem danh sách chi tiết bên dưới">' +
      '<span class="stat-card-label">' + esc(label) + '</span>' +
      '<div class="stat-card-main"><span class="stat-frac">' + frac + '</span>' +
      '<span class="stat-pct">' + p + '%</span></div>' +
      '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + p + '%;background:' + color + '"></div></div></div>';
  }

  // ---- Chart: truc thoi gian LIEN TUC ------------------------------------------------
  function scopeWhere() {
    var w = [], p = [];
    if (state.sel.type === 'cell') { w.push('UPPER(TRIM(subsystem))=?'); p.push(state.sel.ss); w.push('UPPER(TRIM(discipline))=?'); p.push(state.sel.disc.toUpperCase()); }
    else if (state.sel.type === 'ss') { w.push('UPPER(TRIM(subsystem))=?'); p.push(state.sel.ss); }
    else if (state.system !== '__ALL__') { w.push('system_no=?'); p.push(state.system); }
    return { sql: w.length ? (' AND ' + w.join(' AND ')) : '', params: p };
  }
  function scopeLabel() {
    if (state.sel.type === 'cell') return state.sel.ss + ' · ' + state.sel.disc;
    if (state.sel.type === 'ss') return state.sel.ss;
    return state.system === '__ALL__' ? 'Toàn dự án' : 'System ' + state.system;
  }
  function addDays(dstr, n) {
    var d = new Date(dstr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dayRange(a, b) {
    var out = [], d = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
    if (isNaN(d) || isNaN(e) || d > e) return [a];
    var guard = 0;
    while (d <= e && guard++ < 3000) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }

  function renderChart() {
    var sc = scopeWhere();
    var act = window.PrecomDB.query(
      "SELECT substr(complete_date,1,10) d, COUNT(*) c FROM itr_a WHERE complete_date IS NOT NULL AND TRIM(complete_date)<>''" +
      sc.sql + ' GROUP BY d ORDER BY d', sc.params);
    var plan = window.PrecomDB.query(
      "SELECT substr(plan_finish,1,10) d, COUNT(*) c FROM itr_a WHERE plan_finish IS NOT NULL AND TRIM(plan_finish)<>''" +
      sc.sql + ' GROUP BY d ORDER BY d', sc.params);
    var total = (window.PrecomDB.query('SELECT COUNT(*) c FROM itr_a WHERE 1=1' + sc.sql, sc.params)[0] || {}).c || 0;
    var pclo = [];
    try {
      pclo = window.PrecomDB.query(
        "SELECT substr(closed_date,1,10) d, COUNT(*) c FROM punch_list WHERE closed_date IS NOT NULL AND TRIM(closed_date)<>''" +
        sc.sql + ' GROUP BY d ORDER BY d', sc.params);
    } catch (e) {}

    var mAct = {}, mPlan = {}, mPun = {}, all = [];
    act.forEach(function (r) { mAct[r.d] = r.c; all.push(r.d); });
    plan.forEach(function (r) { mPlan[r.d] = r.c; all.push(r.d); });
    pclo.forEach(function (r) { mPun[r.d] = r.c; all.push(r.d); });
    all.sort();
    // Truc thoi gian lien tuc tu min -> max (ngay trong = 0). 1 ngay duy nhat -> mo rong +/-3.
    var labels;
    if (!all.length) labels = [];
    else {
      var lo = all[0], hi = all[all.length - 1];
      if (lo === hi) { lo = addDays(lo, -3); hi = addDays(hi, 3); }
      labels = dayRange(lo, hi);
    }
    var daily = labels.map(function (d) { return mAct[d] || 0; });
    var pDaily = labels.map(function (d) { return mPun[d] || 0; });
    var cum = 0, cumAct = labels.map(function (d) { cum += (mAct[d] || 0); return cum; });
    var cp = 0, cumPlan = labels.map(function (d) { cp += (mPlan[d] || 0); return cp; });

    var ctx = el('precom-chart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }
    _chart = new Chart(ctx, {
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'ITR-A closed / ngày', data: daily, backgroundColor: 'rgba(5,150,105,.55)',
            yAxisID: 'y1', order: 3, barPercentage: 1, categoryPercentage: .9 },
          { type: 'bar', label: 'Punch closed / ngày', data: pDaily, backgroundColor: 'rgba(220,38,38,.5)',
            yAxisID: 'y1', order: 4, barPercentage: 1, categoryPercentage: .9 },
          { type: 'line', label: 'Lũy kế Actual', data: cumAct, borderColor: '#0369a1', backgroundColor: 'transparent',
            pointRadius: 0, borderWidth: 2, tension: .25, yAxisID: 'y', order: 1 },
          { type: 'line', label: 'Lũy kế Plan', data: cumPlan, borderColor: '#d97706', borderDash: [6, 4],
            backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5, tension: .25, yAxisID: 'y', order: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#334155', boxWidth: 12, font: { size: 10 } } },
          title: { display: true, color: '#17233b', font: { size: 12, weight: '700' },
                   text: 'S-Curve ITR-A — ' + scopeLabel() + ' — done ' + (cumAct[cumAct.length - 1] || 0) + '/' + total.toLocaleString() },
          datalabels: { display: false }
        },
        scales: {
          x: { ticks: { color: '#475569', maxTicksLimit: 16, font: { size: 9 } }, grid: { color: 'rgba(23,35,59,.06)' } },
          y: { position: 'left', min: 0, suggestedMax: total || undefined,
               ticks: { color: '#475569', font: { size: 9 } }, grid: { color: 'rgba(23,35,59,.1)' },
               title: { display: true, text: 'Lũy kế / ' + total.toLocaleString(), color: '#5b6b80', font: { size: 9 } } },
          y1: { position: 'right', min: 0, ticks: { color: '#059669', font: { size: 9 } }, grid: { display: false } }
        }
      }
    });
  }

  // ---- Drill-down modal (double-click) -----------------------------------------------
  function showDetail(ss, disc) {
    var w = " WHERE UPPER(TRIM(subsystem))=?", p = [ss];
    if (disc) { w += " AND UPPER(TRIM(discipline))=?"; p.push(disc.toUpperCase()); }
    var rows = window.PrecomDB.query(
      "SELECT tag_no, tag_desc, discipline, cs_type, plan_finish, complete_date FROM itr_a" + w +
      " ORDER BY (complete_date IS NOT NULL AND TRIM(complete_date)<>''), discipline, tag_no", p);
    var pending = rows.filter(function (r) { return !r.complete_date || String(r.complete_date).trim() === ''; });
    var modal = el('tp-detail-modal'), title = el('modal-tp-title'), bodyC = el('modal-body-content');
    if (!modal) return;
    title.textContent = 'ITR-A: ' + ss + (disc ? ' · ' + disc : '') + ' — pending ' + pending.length + '/' + rows.length;
    bodyC.innerHTML = '<div class="table-container" style="max-height:60vh;overflow:auto;">' +
      '<table class="summary-table"><thead><tr><th>#</th><th>TagNo</th><th>Description</th><th>Disc</th><th>ITR</th><th>Plan Finish</th><th>Complete</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var done = r.complete_date && String(r.complete_date).trim() !== '';
        return '<tr class="' + (done ? 'row-status-done' : '') + '"><td>' + (i + 1) + '</td>' +
          '<td><strong>' + esc(r.tag_no) + '</strong></td><td style="font-size:.72rem;">' + esc(r.tag_desc) + '</td>' +
          '<td>' + esc(r.discipline) + '</td><td>' + esc(r.cs_type) + '</td>' +
          '<td>' + esc(String(r.plan_finish || '').slice(0, 10)) + '</td>' +
          '<td>' + (done ? '<span class="status-badge done">' + esc(String(r.complete_date).slice(0, 10)) + '</span>' : '<span class="status-badge not-yet">Pending</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    modal.style.display = 'flex';
  }

  // ---- Export Excel: highlight mau nhu app --------------------------------------------
  var XL = { header: 'FF0F172A', headerFont: 'FFFFFFFF', dac: 'FFC6EFCE', dacFont: 'FF047857',
             cssc: 'FFB7E6C9', sysRow: 'FFDCD7F5' };
  function exportData(all) {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS chưa sẵn sàng.'); return; }
    var wb = new ExcelJS.Workbook();

    var keepSys = state.system, keepSel = state.sel;
    if (all) { state.system = '__ALL__'; state.sel = { type: 'all' }; }
    var list = loadRows(), discs = state.disciplines;
    state.system = keepSys; state.sel = keepSel;

    // Sheet 1: Summary DAC/CSSC — SubSystem DAY DU + Description (yeu cau user)
    var ws = wb.addWorksheet('DAC_CSSC_Summary');
    var head = ['System', 'SubSystemNo', 'SubSystem Description'];
    discs.forEach(function (d) { head.push(d + ' ITR-A', d + ' PunchA', d + ' PunchB'); });
    head.push('ITR done', 'ITR total', '%ITR', 'PunchA closed/total', 'PunchB closed/total', 'DAC', 'CSSC');
    ws.addRow(head);
    list.forEach(function (g) {
      var row = [g.system, g.subsystem, g.desc];
      var dacCols = [];   // vi tri cot can to xanh DAC (1-based)
      discs.forEach(function (d, di) {
        var r = g.disc[d], base = 4 + di * 3;
        if (r && r.itr_total) {
          row.push(r.itr_done + '/' + r.itr_total + ' (' + pct(r.itr_done, r.itr_total) + '%)');
          row.push(r.pa_t ? (r.pa_t - r.pa_o) + '/' + r.pa_t : '-');
          row.push(r.pb_t ? (r.pb_t - r.pb_o) + '/' + r.pb_t : '-');
          if (r.dac) dacCols.push(base, base + 1, base + 2);
        } else { row.push('', '', ''); }
      });
      row.push(g.done, g.total, pct(g.done, g.total) + '%',
               g.paT ? (g.paT - g.paO) + '/' + g.paT : '-',
               g.pbT ? (g.pbT - g.pbO) + '/' + g.pbT : '-',
               g.dacN + '/' + g.discN, g.cssc ? 'CSSC' : '');
      var xr = ws.addRow(row);
      // Highlight: o DAC xanh nhat; ca hang xanh khi CSSC (giong app)
      if (g.cssc) xr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.cssc } }; });
      dacCols.forEach(function (ci) {
        var c = xr.getCell(ci);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.dac } };
        c.font = { color: { argb: XL.dacFont }, bold: true };
      });
    });

    // Sheet 2: raw ITR-A theo pham vi (all -> toan bo); dong done to xanh nhat
    var sc = all ? { sql: '', params: [] } : scopeWhere();
    var raw = window.PrecomDB.query(
      'SELECT system_no, subsystem, subsystem_desc, tag_no, tag_desc, discipline, cs_type,' +
      ' plan_start, plan_finish, complete_date, norm, location FROM itr_a WHERE 1=1' + sc.sql +
      ' ORDER BY subsystem, discipline, tag_no', sc.params);
    var ws2 = wb.addWorksheet('ITR-A_Data');
    if (raw.length) {
      var cols = Object.keys(raw[0]);
      ws2.addRow(cols);
      raw.forEach(function (r) {
        var xr = ws2.addRow(cols.map(function (c) { return r[c]; }));
        if (r.complete_date && String(r.complete_date).trim() !== '') {
          xr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.dac } }; });
        }
      });
    }
    [ws, ws2].forEach(function (w) {
      w.getRow(1).eachCell(function (c) {
        c.font = { bold: true, color: { argb: XL.headerFont } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.header } };
      });
      w.views = [{ state: 'frozen', ySplit: 1 }];
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = all ? 'Precom_All.xlsx' : ('Precom_' + scopeLabel().replace(/[^\w-]+/g, '_') + '.xlsx');
      a.click(); URL.revokeObjectURL(a.href);
    });
  }

  window.PrecomInit = initOnce;

  // ---- Overview card tren PROJECT DASHBOARD (nap nen, khong lam cham khoi dong) ----
  function ovRow(label, done, total, color) {
    var p = pct(done, total);
    return '<div><div style="display:flex;justify-content:space-between;font-size:.72rem;">' +
      '<span style="color:var(--text-muted);font-weight:600;">' + esc(label) + '</span>' +
      '<span style="font-weight:800;">' + done.toLocaleString() + ' / ' + total.toLocaleString() +
      ' <span style="color:' + color + ';">' + p + '%</span></span></div>' +
      '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + p + '%;background:' + color + '"></div></div></div>';
  }

  function fillDashboardCard() {
    var body = document.getElementById('precom-ov-body');
    if (!body || !window.PrecomDB) return;
    window.PrecomDB.ready().then(function () {
      var t = window.PrecomDB.query(
        'SELECT SUM(itr_total) it, SUM(itr_done) id, SUM(COALESCE(punch_a_total,0)) pat,' +
        ' SUM(COALESCE(punch_a_open,0)) pao, SUM(COALESCE(punch_b_total,0)) pbt, SUM(COALESCE(punch_b_open,0)) pbo,' +
        ' COUNT(*) cells, SUM(CASE WHEN itr_done>=itr_total AND COALESCE(punch_a_open,0)=0 THEN 1 ELSE 0 END) dac' +
        ' FROM precom_summary')[0] || {};
      var cssc = (window.PrecomDB.query(
        'SELECT COUNT(*) c FROM (SELECT subsystem FROM precom_summary GROUP BY subsystem' +
        ' HAVING SUM(CASE WHEN itr_done>=itr_total AND COALESCE(punch_a_open,0)=0 THEN 1 ELSE 0 END)=COUNT(*))')[0] || {}).c || 0;
      var nss = (window.PrecomDB.query('SELECT COUNT(DISTINCT subsystem) c FROM precom_summary')[0] || {}).c || 0;
      var meta = window.PrecomDB.meta();
      body.innerHTML =
        ovRow('ITR-A Checksheets', t.id || 0, t.it || 0, '#0ea5e9') +
        ovRow('Punch A Closed', (t.pat || 0) - (t.pao || 0), t.pat || 0, '#ef4444') +
        ovRow('Punch B Closed', (t.pbt || 0) - (t.pbo || 0), t.pbt || 0, '#f59e0b') +
        ovRow('DAC (Discipline)', t.dac || 0, t.cells || 0, '#8b5cf6') +
        ovRow('CSSC (Subsystem)', cssc, nss, '#10b981') +
        '<span class="stat-card-sub" style="margin-top:2px;">' + esc(meta.filename || '') +
        (meta.fileTime ? ' · ' + esc(meta.fileTime) : '') + ' — click để mở tab Precom</span>';
    }).catch(function () {
      body.innerHTML = '<span class="stat-card-sub" style="font-style:italic;">Chưa có dữ liệu Precom — chạy Precom\\Build_Precom_Local.bat.</span>';
    });
  }

  function wireOvCard() {
    var card = document.getElementById('zone-precom-ov');
    if (card) card.addEventListener('click', function () {
      var btn = document.getElementById('tab-precom-view');
      if (btn) btn.click();
    });
    // Nap nen sau khi app da hien Dashboard (khong chan khoi dong)
    setTimeout(fillDashboardCard, 3500);
    window.addEventListener('precomdb-updated', fillDashboardCard);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireOvCard);
  else wireOvCard();
})();
