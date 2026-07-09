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
  var _click = false;   // TRUE chi khi user vua click -> cho phep auto-cuon 1 lan (refresh 3' KHONG cuon)

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
    // MOT vung cuon duy nhat (#precom-body) - bang ma tran KHONG cuon rieng nua
    // (2 vung cuon long nhau lam ket banh xe chuot, khong ve dau trang duoc).
    '#precom-body{overflow-y:auto!important;overflow-x:auto;}' +
    '#precom-body>.table-container{max-height:none!important;overflow:visible!important;}' +
    // KPI chips: nho gon, moi so lieu = label + closed/total + % ben duoi
    '#precom-kpis{display:flex!important;gap:6px;align-items:stretch;}' +
    '#precom-kpis .pk-card{flex:1 1 0;background:#f7f9fb;border:1px solid #d9e0e9;border-radius:8px;padding:4px 6px;min-width:0;max-height:128px;overflow-y:auto;}' +
    '#precom-kpis .pk-card.sel{box-shadow:0 0 0 2px #0369a1;}' +
    '.pk-title{font-size:.62rem;font-weight:800;color:#40506a;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;display:flex;justify-content:space-between;gap:4px;position:sticky;top:0;background:#f7f9fb;padding-bottom:2px;}' +
    '.pk-title .pk-sum{color:#0369a1;}' +
    '.pk-grid{display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;}' +
    '.pk-chip{flex:1 0 62px;max-width:96px;background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:2px 3px;text-align:center;}' +
    '.pk-chip .l{font-size:.52rem;font-weight:700;color:#5b6b80;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.pk-chip .f{font-size:.62rem;font-weight:800;color:#17233b;white-space:nowrap;}' +
    '.pk-chip .p{font-size:.56rem;font-weight:800;}' +
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
    // ---- FULL-SCREEN MODAL + bang bao cao chuyen nghiep ----
    '.pcm-modal{position:fixed;inset:0;z-index:99999;display:none;background:rgba(15,23,42,.55);}' +
    '.pcm-modal.show{display:flex;}' +
    '.pcm-win{margin:auto;width:96vw;height:94vh;background:#eef1f5;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);}' +
    '.pcm-head{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:10px 16px;background:linear-gradient(90deg,#0f2647,#1e3a63);color:#fff;}' +
    '.pcm-head h2{font-size:1rem;margin:0;font-weight:800;letter-spacing:.02em;white-space:nowrap;}' +
    '.pcm-head .pcm-sub{flex:1;font-size:.72rem;color:#c7d4e6;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.pcm-btn{padding:6px 14px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f2647;font-weight:700;font-size:.72rem;cursor:pointer;}' +
    '.pcm-btn:hover{background:#e8f0fe;}' +
    '.pcm-btn.x{background:transparent;color:#fff;border-color:#5b7196;font-size:.95rem;padding:3px 11px;font-weight:800;}' +
    '.pcm-body{flex:1 1 auto;overflow:auto;padding:14px 16px;}' +
    '.pcm-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;}' +
    '.pcm-kbox{flex:1 1 130px;background:#fff;border:1px solid #dbe2ea;border-radius:8px;padding:8px 10px;box-shadow:0 1px 2px rgba(0,0,0,.05);}' +
    '.pcm-kbox .kl{font-size:.62rem;color:#5b6b80;font-weight:700;text-transform:uppercase;letter-spacing:.03em;}' +
    '.pcm-kbox .kf{font-size:1.05rem;font-weight:800;color:#0f2647;}' +
    '.pcm-kbox .kp{font-size:.72rem;font-weight:800;}' +
    '.pcm-chartbox{background:#fff;border:1px solid #dbe2ea;border-radius:8px;padding:8px;height:320px;margin-bottom:14px;}' +
    '.pcm-rpt{width:100%;border-collapse:collapse;background:#fff;margin:4px 0 18px;font-size:.7rem;box-shadow:0 1px 4px rgba(15,38,71,.1);}' +
    '.pcm-rpt caption{caption-side:top;text-align:left;font-weight:800;color:#0f2647;font-size:.82rem;padding:8px 2px 6px;}' +
    '.pcm-rpt thead th{position:sticky;top:0;background:#0f2647;color:#fff;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:6px 8px;text-align:left;border:1px solid #24406b;z-index:2;}' +
    '.pcm-rpt tbody td{padding:4px 8px;border:1px solid #e2e8f0;color:#17233b;vertical-align:top;}' +
    '.pcm-rpt tbody tr:nth-child(even) td{background:#f4f7fb;}' +
    '.pcm-rpt tbody tr.done td{background:#e6f6ec;}' +
    '.pcm-rpt tbody tr.opa td{background:#fdeaea;}' +
    '.pcm-rpt tbody tr:hover td{background:#e8f0fe;}' +
    '.pcm-gt{cursor:pointer;}.pcm-sys-row td{cursor:pointer;}' +
    // Nut discipline tren header (theme sang)
    '#precom-disc-btns .pcm-lbl{font-size:.64rem;color:#5b6b80;font-weight:800;text-transform:uppercase;letter-spacing:.03em;margin-right:2px;}' +
    '.pcm-disc-btn{background:#fff!important;border:1px solid #c4cedb!important;color:#17233b!important;border-radius:14px;padding:.28rem .7rem!important;font-size:.68rem;font-weight:700;cursor:pointer;min-height:auto!important;white-space:nowrap;}' +
    '.pcm-disc-btn:hover{background:#0f2647!important;border-color:#0f2647!important;color:#fff!important;}' +
    '.pcm-disc-btn .n{color:#0369a1;font-weight:800;margin-left:3px;}' +
    '.pcm-disc-btn:hover .n{color:#8ec5ff;}' +
    // Chip click duoc (Punch Status) + chip overview discipline (ITR-A Done)
    '.pk-chip.clk{cursor:pointer;}' +
    '.pk-chip.clk:hover{background:#0f2647!important;border-color:#0f2647!important;}' +
    '.pk-chip.clk:hover .l,.pk-chip.clk:hover .f,.pk-chip.clk:hover .ab{color:#fff!important;}' +
    '.pk-chip .f .g{color:#059669;font-weight:800;}' +
    '.pk-chip .ab{font-size:.52rem;font-weight:700;color:#5b6b80;white-space:nowrap;margin-top:1px;}' +
    // KPI box trong modal click duoc; Done xanh la; Total click duoc
    '.pcm-kbox.clk{cursor:pointer;}' +
    '.pcm-kbox.clk:hover{box-shadow:0 0 0 2px #0369a1;}' +
    '.pcm-kbox.sel{box-shadow:0 0 0 2px #0f2647;background:#eef4ff;}' +
    '.pcm-kbox .kdone{color:#059669;cursor:pointer;font-weight:800;}' +
    '.pcm-kbox .ktot{cursor:pointer;}' +
    '.pcm-kbox .kdone:hover,.pcm-kbox .ktot:hover{text-decoration:underline;}' +
    // Dropdown system tuy bien (theme sang) - hien CSSC-ready(xanh)/tong subsystem
    '.pcm-dd{position:relative;display:inline-block;}' +
    '.pcm-dd-btn{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #c4cedb;border-radius:6px;color:#17233b;padding:.3rem .6rem;font-size:.72rem;cursor:pointer;font-weight:600;}' +
    '.pcm-dd-btn:hover{border-color:#0369a1;}' +
    '.pcm-dd-cssc{font-size:.66rem;color:#5b6b80;}' +
    '.pcm-dd-caret{color:#5b6b80;font-size:.6rem;}' +
    '.pcm-dd-panel{position:fixed;z-index:100000;background:#fff;border:1px solid #c4cedb;border-radius:6px;box-shadow:0 8px 24px rgba(15,38,71,.22);max-height:340px;overflow-y:auto;min-width:230px;}' +
    '.pcm-dd-opt{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:4px 10px;font-size:.72rem;color:#17233b;cursor:pointer;white-space:nowrap;}' +
    '.pcm-dd-opt:hover{background:#e8f0fe;}' +
    '.pcm-dd-opt.sel{background:#eef4ff;font-weight:800;}' +
    '.pcm-dd-ct{font-size:.68rem;color:#5b6b80;}' +
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
    buildSystemDD();   // dropdown system tuy bien: hien CSSC-ready(xanh)/tong subsystem
    el('precom-search').oninput = function (e) { state.q = e.target.value.trim().toUpperCase(); render(); };
    el('precom-pending-toggle').onchange = function (e) { state.onlyPending = e.target.checked; render(); };
    el('precom-export-btn').onclick = function () { exportData(false); };
    var allBtn = el('precom-export-all-btn');
    if (allBtn) allBtn.onclick = function () { exportData(true); };
    var clr = el('precom-clear-btn');
    if (clr) clr.onclick = function () {
      state.system = '__ALL__'; state.q = ''; state.onlyPending = false;
      state.sel = { type: 'all' }; state.kpiSel = null;
      el('precom-search').value = ''; el('precom-pending-toggle').checked = false;
      render(); buildSystemDD();
    };
    document.addEventListener('click', function () { var p = el('precom-dd-panel'); if (p) p.style.display = 'none'; });
    window.addEventListener('precomdb-updated', function () { render(); });
  }

  // ---- Dropdown system tuy bien: moi option hien CSSC-ready(xanh)/tong subsystem ----
  function systemStats() {
    return window.PrecomDB.query(
      "SELECT system_no, COUNT(*) tot, SUM(cssc) cssc FROM (" +
      " SELECT system_no, subsystem, CASE WHEN SUM(CASE WHEN itr_done>=itr_total AND COALESCE(punch_a_open,0)=0 THEN 1 ELSE 0 END)=COUNT(*) THEN 1 ELSE 0 END cssc" +
      " FROM precom_summary WHERE system_no IS NOT NULL GROUP BY system_no, subsystem)" +
      " GROUP BY system_no ORDER BY system_no");
  }
  function setSystem(v) { state.system = v; state.sel = { type: 'all' }; render(); buildSystemDD(); }
  function buildSystemDD() {
    var dd = el('precom-system-dd'); if (!dd) return;
    var stats = systemStats(), totAll = 0, csscAll = 0;
    stats.forEach(function (s) { totAll += s.tot; csscAll += s.cssc; });
    var opts = [{ v: '__ALL__', label: 'Tất cả systems', n: stats.length, cssc: csscAll, tot: totAll }]
      .concat(stats.map(function (s) { return { v: s.system_no, label: s.system_no, n: null, cssc: s.cssc, tot: s.tot }; }));
    var cur = opts.filter(function (o) { return o.v === state.system; })[0] || opts[0];
    dd.innerHTML =
      '<button type="button" class="pcm-dd-btn" id="precom-dd-btn" title="Chọn system — số CSSC-ready (xanh) / tổng subsystem">' +
        '<span class="pcm-dd-cur">' + esc(cur.label) + (cur.n != null ? ' (' + cur.n + ')' : '') + '</span>' +
        '<span class="pcm-dd-cssc"><b style="color:#059669;">' + cur.cssc + '</b>/' + cur.tot + ' CSSC</span>' +
        '<span class="pcm-dd-caret">▾</span></button>' +
      '<div class="pcm-dd-panel" id="precom-dd-panel" style="display:none;">' +
        opts.map(function (o) {
          return '<div class="pcm-dd-opt' + (o.v === state.system ? ' sel' : '') + '" data-sysv="' + esc(o.v) + '">' +
            '<span class="pcm-dd-nm">' + esc(o.label) + (o.n != null ? ' (' + o.n + ')' : '') + '</span>' +
            '<span class="pcm-dd-ct"><b style="color:#059669;">' + o.cssc + '</b> / ' + o.tot + '</span></div>';
        }).join('') + '</div>';
    var btn = el('precom-dd-btn'), panel = el('precom-dd-panel');
    btn.onclick = function (e) {
      e.stopPropagation();
      if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
      var r = btn.getBoundingClientRect();
      panel.style.left = r.left + 'px'; panel.style.top = (r.bottom + 2) + 'px'; panel.style.display = 'block';
    };
    panel.querySelectorAll('[data-sysv]').forEach(function (o) {
      o.onclick = function (e) { e.stopPropagation(); setSystem(o.getAttribute('data-sysv')); };
    });
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

    // ---- 4 khoi KPI dang CHIP (nho gon, moi so lieu = Closed/Total + % duoi) --------
    var discs2 = state.disciplines;
    // ITR-A done/total + DAC theo tung discipline (tu list DA loc)
    var dAgg = {};
    discs2.forEach(function (d) { dAgg[d] = { done: 0, tot: 0, dacN: 0, cellN: 0, paC: 0, paT: 0, pbC: 0, pbT: 0 }; });
    list.forEach(function (g) {
      discs2.forEach(function (d) {
        var r = g.disc[d]; if (!r) return;
        var a = dAgg[d];
        a.done += r.itr_done; a.tot += r.itr_total;
        a.paC += (r.pa_t - r.pa_o); a.paT += r.pa_t; a.pbC += (r.pb_t - r.pb_o); a.pbT += r.pb_t;
        if (r.itr_total || r.pa_t || r.pb_t) { a.cellN += 1; a.dacN += r.dac; }
      });
    });
    var ph = punchByPhase();   // Punch A/B theo Phase (FAT/COM/OSD/CON/N-A) tu punch_list

    el('precom-kpis').innerHTML =
      kpiCard('itr', 'ITR-A Done (theo discipline)', don, tot, '#0369a1',
        discs2.filter(function (d) { return dAgg[d].tot || dAgg[d].paT || dAgg[d].pbT; })
              .map(function (d) { return discOvChip(d, dAgg[d]); })) +
      kpiCard('pa', 'Punch Status', ph.totClosed, ph.tot, '#dc2626', ph.chips) +
      kpiCard('dac', 'DAC (Discipline)', dacN, dacT,'#7c3aed',
        discs2.filter(function (d) { return dAgg[d].cellN; })
              .map(function (d) { return chip(shortDisc(d), dAgg[d].dacN, dAgg[d].cellN); })) +
      kpiCard('cssc', 'CSSC (Subsystem)', csscN, list.length, '#059669', csscBySystem(list));
    // Card DAC/CSSC: click ca card -> modal KPI. Card ITR-A/Punch: click tung chip.
    el('precom-kpis').querySelectorAll('[data-kpi="dac"],[data-kpi="cssc"]').forEach(function (card) {
      card.onclick = function () { openKpiModal(card.getAttribute('data-kpi')); };
    });
    el('precom-kpis').querySelectorAll('[data-discov]').forEach(function (c) {
      c.onclick = function (e) { e.stopPropagation(); openDisciplineModal(c.getAttribute('data-discov')); };
    });
    el('precom-kpis').querySelectorAll('[data-punph]').forEach(function (c) {
      c.onclick = function (e) { e.stopPropagation(); openPunchPhaseModal(c.getAttribute('data-punph'), c.getAttribute('data-puncat')); };
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
        '" data-disc="' + esc(d) + '" title="' + esc(g.subsystem) + ' · ' + esc(d) + ' — Click: xem chi tiết (toàn màn hình)">' +
        val + (p === null ? '' : '<div class="pp ' + pctCls(p) + '">' + p + '%</div>') + '</td>';
    }

    var lastSys = null, html = '';
    list.forEach(function (g) {
      if (g.system !== lastSys) {
        lastSys = g.system;
        html += '<tr class="pcm-sys-row"><td colspan="' + nCols + '" data-sys="' + esc(g.system || '') + '" title="Click: xem chi tiết cả system">SYSTEM ' + esc(g.system || '?') + '</td></tr>';
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
        '<td class="pcm-ssname" data-ssname="' + esc(g.subsystem) + '" title="' + esc(g.subsystem) + ' — ' + esc(g.desc) + ' · Click: xem chi tiết (toàn màn hình)">' +
        '<strong>' + esc(ssShort(g.subsystem)) + '</strong></td>' +
        cells +
        '<td class="pcm-gt" data-ssname="' + esc(g.subsystem) + '" title="Click: xem chi tiết subsystem">' + g.done + '/' + g.total +
        '<div class="pp ' + pctCls(p) + '">' + p + '%</div>' +
        '<span class="pcm-badge ' + (g.cssc ? 'cssc' : 'no') + '">' + (g.cssc ? 'CSSC' : g.dacN + '/' + g.discN + ' DAC') + '</span></td></tr>';
    });

    el('precom-body').innerHTML =
      '<div class="pcm-hint">Click ô discipline / tên subsystem / system / thẻ KPI → mở cửa sổ chi tiết toàn màn hình (có Export Excel) · Ô xanh = đạt DAC</div>' +
      '<div class="table-container" style="flex:0 0 auto;min-height:120px;">' +
      '<table><thead>' + thead + '</thead><tbody>' +
      (html || '<tr><td colspan="' + nCols + '" class="text-center" style="padding:2rem;">Không có subsystem nào khớp bộ lọc.</td></tr>') +
      '</tbody></table></div>' +
      '<div id="precom-detail" style="display:none;"></div>' +
      '<div id="precom-chart-wrap"><canvas id="precom-chart"></canvas></div>';

    // Click BAT KY thong tin tong hop nao -> mo modal full-screen chi tiet (yeu cau user)
    el('precom-body').querySelectorAll('td[data-ss][data-disc]').forEach(function (td) {
      td.onclick = function () { openScopeModal({ type: 'cell', ss: td.getAttribute('data-ss'), disc: td.getAttribute('data-disc') }); };
    });
    el('precom-body').querySelectorAll('[data-ssname]').forEach(function (td) {
      td.onclick = function () { openScopeModal({ type: 'ss', ss: td.getAttribute('data-ssname') }); };
    });
    el('precom-body').querySelectorAll('[data-sys]').forEach(function (td) {
      td.onclick = function () { openScopeModal({ type: 'sys', sys: td.getAttribute('data-sys') }); };
    });

    renderDetail();
    renderChart();
    // Auto-cuon detail vao tam nhin CHI khi user vua CLICK (refresh 3' KHONG cuon ->
    // fix bug "cuon xuong roi khong ve dau trang duoc").
    if (_click && (state.kpiSel || state.sel.type !== 'all')) {
      var det = el('precom-detail');
      if (det && det.style.display !== 'none') {
        try { det.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      }
    }
    _click = false;
  }

  // ---- PREVIEW DETAIL: click o/subsystem -> bang chi tiet tu DU LIEU NGUON -------
  function detailQueries(sc) {
    sc = sc || scopeWhere();
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
    var title = { itr: 'ITR-A Checksheets', pa: 'Punch Status (Cat A & B theo Phase)', dac: 'DAC theo Subsystem × Discipline', cssc: 'CSSC theo Subsystem' }[state.kpiSel];
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
      var pab = d.pun.filter(function (r) {
        var c = String(r.category || '').trim().toUpperCase(); return c === 'A' || c === 'B';
      }).sort(function (a, b) {
        return String(a.category || '').toUpperCase().localeCompare(String(b.category || '').toUpperCase()) ||
               String(a.phase || '').toUpperCase().localeCompare(String(b.phase || '').toUpperCase());
      });
      html += tableHtml(['#', 'Subsystem', 'PunchNo', 'Cat', 'Phase', 'Status', 'Disc', 'TagNo', 'Defect Description', 'ActionBy', 'Open', 'Closed'],
        pab.map(function (r, i) {
          var closed = String(r.status || '').trim().toUpperCase() === 'CLOSED';
          return '<tr class="' + (closed ? 'done' : 'opa') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
            '<td><b>' + esc(r.punch_no) + '</b></td><td style="text-align:center;font-weight:800;">' + esc(r.category) + '</td>' +
            '<td>' + esc(r.phase) + '</td><td>' + esc(r.status) + '</td><td>' + esc(r.discipline) + '</td>' +
            '<td>' + esc(r.tag_no) + '</td><td style="max-width:340px;white-space:normal;">' + esc(String(r.description || '').slice(0, 200)) + '</td>' +
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

  // ---- KPI dang CHIP: 1 card = tieu de (label + tong Closed/Total + %) + luoi chip ----
  function shortDisc(d) {
    d = String(d || '').toUpperCase();
    var m = { MECHANICAL: 'MECH', ELECTRICAL: 'ELEC', INSTRUMENT: 'INST', STRUCTURE: 'STRU',
              ARCHITECTURE: 'ARCH', TELECOM: 'TELE', PIPING: 'PIPE', SAFETY: 'SAFE' };
    return m[d] || d.slice(0, 4);
  }
  function chip(label, closed, total) {
    var p = pct(closed, total);
    return '<div class="pk-chip" title="' + esc(label) + ': ' + closed + '/' + total + '">' +
      '<div class="l">' + esc(label) + '</div>' +
      '<div class="f">' + closed.toLocaleString() + '/' + total.toLocaleString() + '</div>' +
      '<div class="p ' + pctCls(p) + '">' + p + '%</div></div>';
  }
  // Chip OVERVIEW cho card ITR-A Done: 1 discipline = ITR-A + Punch A + Punch B, click mo modal
  function discOvChip(d, a) {
    var p = pct(a.done, a.tot);
    return '<div class="pk-chip clk" data-discov="' + esc(d) + '" title="Click: mở chi tiết discipline ' + esc(d) + '">' +
      '<div class="l">' + esc(shortDisc(d)) + '</div>' +
      '<div class="f"><span class="g">' + a.done.toLocaleString() + '</span>/' + a.tot.toLocaleString() +
      ' <span class="' + pctCls(p) + '">' + p + '%</span></div>' +
      '<div class="ab">A ' + a.paC + '/' + a.paT + ' · B ' + a.pbC + '/' + a.pbT + '</div></div>';
  }
  function kpiCard(key, label, closed, total, color, chips) {
    var p = pct(closed, total), selCls = (state.kpiSel === key) ? ' sel' : '';
    var body = (chips && chips.length) ? chips.join('') :
      '<div class="pk-chip" style="flex:1 0 100%;"><div class="l">Chưa có dữ liệu</div></div>';
    return '<div class="pk-card' + selCls + '" data-kpi="' + key + '" style="cursor:pointer;" ' +
      'title="Click: xem danh sách chi tiết bên dưới">' +
      '<div class="pk-title"><span style="border-left:3px solid ' + color + ';padding-left:4px;">' + esc(label) + '</span>' +
      '<span class="pk-sum">' + closed.toLocaleString() + '/' + total.toLocaleString() + ' · ' + p + '%</span></div>' +
      '<div class="pk-grid">' + body + '</div></div>';
  }
  // Chuan hoa phase: bo tien to 'CPP-', bo hau to '-CLOSED', rong -> 'N/A'.
  function phaseBucket(ph) {
    var p = String(ph || '').toUpperCase().trim().replace(/^CPP-/, '').replace(/-CLOSED$/, '');
    return p === '' ? 'N/A' : p;
  }
  // Punch A & B gom theo PHASE (thu tu co dinh FAT/COM/OSD/CON/N-A), nhan PHASE_CAT, click duoc.
  function punchByPhase() {
    var PH = ['FAT', 'COM', 'OSD', 'CON', 'N/A'];   // thu tu co dinh (user chot)
    var out = { chips: [], tot: 0, totClosed: 0 };
    var agg = {};
    try {
      var w = '', p = [];
      if (state.system !== '__ALL__') { w = ' AND system_no=?'; p.push(state.system); }
      var rows = window.PrecomDB.query(
        "SELECT COALESCE(phase,'') ph, UPPER(TRIM(COALESCE(category,''))) cat," +
        " COUNT(*) t, SUM(CASE WHEN UPPER(TRIM(status))='CLOSED' THEN 1 ELSE 0 END) c" +
        " FROM punch_list WHERE 1=1" + w + " GROUP BY ph, cat", p);
      rows.forEach(function (r) {
        if (r.cat !== 'A' && r.cat !== 'B') return;   // chi A & B
        var b = phaseBucket(r.ph);
        if (PH.indexOf(b) < 0) PH.push(b);            // phase la -> them cuoi
        var m = agg[b] || (agg[b] = {}), v = m[r.cat] || (m[r.cat] = { t: 0, c: 0 });
        v.t += r.t; v.c += r.c; out.tot += r.t; out.totClosed += r.c;
      });
    } catch (e) { return out; }   // chua co du lieu punch
    PH.forEach(function (b) {
      ['A', 'B'].forEach(function (cat) {
        var v = (agg[b] && agg[b][cat]) || { t: 0, c: 0 };
        out.chips.push(punchChip(b, cat, v.c, v.t));
      });
    });
    return out;
  }
  function punchChip(phase, cat, closed, total) {
    var p = pct(closed, total), lab = phase + '_' + cat;
    return '<div class="pk-chip clk" data-punph="' + esc(phase) + '" data-puncat="' + cat +
      '" title="Click: chi tiết Punch ' + esc(lab) + '">' +
      '<div class="l">' + esc(lab) + '</div>' +
      '<div class="f"><span class="g">' + closed.toLocaleString() + '</span>/' + total.toLocaleString() + '</div>' +
      '<div class="p ' + pctCls(p) + '">' + p + '%</div></div>';
  }
  // CSSC: so subsystem dat CSSC / tong subsystem theo tung system.
  function csscBySystem(list) {
    var bySys = {};
    list.forEach(function (g) {
      var s = g.system || '?', a = bySys[s] || (bySys[s] = { c: 0, t: 0 });
      a.t += 1; a.c += g.cssc;
    });
    return Object.keys(bySys).sort().map(function (s) { return chip(ssShort(s), bySys[s].c, bySys[s].t); });
  }

  // ---- Chart: truc thoi gian LIEN TUC ------------------------------------------------
  function scopeWhereFor(sel, system) {
    var w = [], p = [];
    if (sel && sel.type === 'cell') { w.push('UPPER(TRIM(subsystem))=?'); p.push(sel.ss); w.push('UPPER(TRIM(discipline))=?'); p.push(sel.disc.toUpperCase()); }
    else if (sel && sel.type === 'ss') { w.push('UPPER(TRIM(subsystem))=?'); p.push(sel.ss); }
    else if (sel && sel.type === 'sys') { w.push('system_no=?'); p.push(sel.sys); }
    else if (sel && sel.type === 'disc') {
      w.push('UPPER(TRIM(discipline))=?'); p.push(sel.disc.toUpperCase());
      if (system && system !== '__ALL__') { w.push('system_no=?'); p.push(system); }
    }
    else if (system && system !== '__ALL__') { w.push('system_no=?'); p.push(system); }
    return { sql: w.length ? (' AND ' + w.join(' AND ')) : '', params: p };
  }
  function scopeWhere() { return scopeWhereFor(state.sel, state.system); }
  function scopeLabelFor(sel) {
    if (sel && sel.type === 'cell') return ssShort(sel.ss) + ' · ' + sel.disc;
    if (sel && sel.type === 'ss') return ssShort(sel.ss);
    if (sel && sel.type === 'sys') return 'SYSTEM ' + sel.sys;
    if (sel && sel.type === 'disc') return 'Discipline ' + sel.disc + (state.system !== '__ALL__' ? ' · System ' + state.system : '');
    return state.system === '__ALL__' ? 'Toàn dự án' : 'System ' + state.system;
  }
  function scopeLabel() { return scopeLabelFor(state.sel); }
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
    var ctx = el('precom-chart');
    if (!ctx) return;
    if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }
    _chart = drawSCurve(ctx, scopeWhere());
  }
  // S-curve tai-su-dung cho ca tab chinh lan modal. Tra ve Chart (hoac null).
  function drawSCurve(ctx, sc) {
    if (!ctx || typeof Chart === 'undefined') return null;
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

    return new Chart(ctx, {
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

  // ---- Export Excel tab (Summary DAC/CSSC + ITR-A raw) - dinh dang bao cao ----
  function exportData(all) {
    var keepSys = state.system, keepSel = state.sel;
    if (all) { state.system = '__ALL__'; state.sel = { type: 'all' }; }
    var list = loadRows(), discs = state.disciplines;
    state.system = keepSys; state.sel = keepSel;

    // Sheet 1: ma tran DAC/CSSC (disc x [ITR-A|PunchA|PunchB]); o DAC to xanh, hang CSSC to xanh
    var head = ['System', 'SubSystemNo', 'Description'];
    discs.forEach(function (d) { head.push(d + ' ITR-A', d + ' PunchA', d + ' PunchB'); });
    head.push('ITR done/total', '%ITR', 'PunchA closed/total', 'PunchB closed/total', 'DAC', 'CSSC');
    var dacMark = [];   // dacMark[ri][ci 0-based] = 1 -> to xanh DAC
    var rows = list.map(function (g) {
      var row = [g.system, g.subsystem, g.desc], mark = {};
      discs.forEach(function (d, di) {
        var r = g.disc[d], base = 3 + di * 3;   // cot dau (0-based) cua discipline nay
        if (r && (r.itr_total || r.pa_t || r.pb_t)) {
          row.push(r.itr_total ? (r.itr_done + '/' + r.itr_total + ' (' + pct(r.itr_done, r.itr_total) + '%)') : '-');
          row.push(r.pa_t ? (r.pa_t - r.pa_o) + '/' + r.pa_t : '-');
          row.push(r.pb_t ? (r.pb_t - r.pb_o) + '/' + r.pb_t : '-');
          if (r.dac) { mark[base] = 1; mark[base + 1] = 1; mark[base + 2] = 1; }
        } else { row.push('', '', ''); }
      });
      row.push(g.done + '/' + g.total, pct(g.done, g.total) + '%',
               g.paT ? (g.paT - g.paO) + '/' + g.paT : '-',
               g.pbT ? (g.pbT - g.pbO) + '/' + g.pbT : '-',
               g.dacN + '/' + g.discN, g.cssc ? 'CSSC' : '');
      dacMark.push(mark);
      return row;
    });
    var sub = _rptSub(all ? 'Toàn dự án (tất cả)' : scopeLabel());

    // Sheet 2: ITR-A raw theo pham vi
    var sc = all ? { sql: '', params: [] } : scopeWhere();
    var raw = window.PrecomDB.query(
      'SELECT system_no, subsystem, subsystem_desc, tag_no, tag_desc, discipline, cs_type,' +
      ' plan_start, plan_finish, complete_date, norm, location FROM itr_a WHERE 1=1' + sc.sql +
      ' ORDER BY subsystem, discipline, tag_no', sc.params);
    var rawHead = ['System', 'Subsystem', 'Description', 'TagNo', 'Tag Description', 'Discipline', 'ITR', 'Plan Start', 'Plan Finish', 'Complete', 'Norm', 'Location'];
    var rawRows = raw.map(function (r) { return [r.system_no, r.subsystem, r.subsystem_desc, r.tag_no, r.tag_desc, r.discipline, r.cs_type, _day(r.plan_start), _day(r.plan_finish), _day(r.complete_date), r.norm, r.location]; });

    writeReport(all ? 'Precom_All.xlsx' : ('Precom_' + scopeLabel().replace(/[^\w-]+/g, '_') + '.xlsx'),
      'BÁO CÁO PRECOM — DAC / CSSC', [
        { name: 'DAC_CSSC_Summary', head: head, rows: rows, subtitle: sub,
          rowFill: function (ri) { return list[ri].cssc ? 'FFDFF3E7' : null; },
          cellFill: function (ri, ci) { return dacMark[ri][ci] ? 'FFC6EFCE' : null; } },
        { name: 'ITR-A_Data', head: rawHead, rows: rawRows, subtitle: sub,
          rowFill: function (ri) { return (raw[ri].complete_date && String(raw[ri].complete_date).trim() !== '') ? 'FFE6F6EC' : null; } }
      ]);
  }

  // ==================== FULL-SCREEN MODAL (click summary -> chi tiet) ====================
  var _mchart = null;                       // chart trong modal
  var RB = { top:    { style: 'thin', color: { argb: 'FFD3DAE3' } },
             left:   { style: 'thin', color: { argb: 'FFD3DAE3' } },
             bottom: { style: 'thin', color: { argb: 'FFD3DAE3' } },
             right:  { style: 'thin', color: { argb: 'FFD3DAE3' } } };

  function ensureModal() {
    if (el('pcm-modal')) return;
    var m = document.createElement('div');
    m.id = 'pcm-modal'; m.className = 'pcm-modal';
    m.innerHTML =
      '<div class="pcm-win">' +
        '<div class="pcm-head">' +
          '<h2 id="pcm-title">Chi tiết</h2>' +
          '<span class="pcm-sub" id="pcm-sub"></span>' +
          '<button class="pcm-btn" id="pcm-export">⬇ Export Excel</button>' +
          '<button class="pcm-btn x" id="pcm-close" title="Đóng (Esc)">✕</button>' +
        '</div>' +
        '<div class="pcm-body" id="pcm-body"></div>' +
      '</div>';
    document.body.appendChild(m);
    el('pcm-close').onclick = closeModal;
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el('pcm-modal') && el('pcm-modal').classList.contains('show')) closeModal(); });
  }
  function showModal() { ensureModal(); el('pcm-modal').classList.add('show'); }
  function closeModal() {
    var m = el('pcm-modal'); if (m) m.classList.remove('show');
    if (_mchart) { try { _mchart.destroy(); } catch (e) {} _mchart = null; }
  }
  function _day(v) { return esc(String(v || '').slice(0, 10)); }
  function kbox(label, closed, total, color) {
    var p = pct(closed, total);
    return '<div class="pcm-kbox" style="border-top:3px solid ' + color + ';">' +
      '<div class="kl">' + esc(label) + '</div>' +
      '<div class="kf">' + closed.toLocaleString() + ' / ' + total.toLocaleString() + '</div>' +
      '<div class="kp ' + pctCls(p) + '">' + p + '%</div></div>';
  }
  function reportTable(caption, head, rows) {
    return '<table class="pcm-rpt"><caption>' + esc(caption) + '</caption><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="' + head.length + '" style="text-align:center;padding:1rem;">Không có dữ liệu.</td></tr>') +
      '</tbody></table>';
  }

  // ---- Modal cho 1 PHAM VI (o discipline / subsystem / system) ----
  function openScopeModal(sel) {
    var sc = scopeWhereFor(sel, state.system), d = detailQueries(sc), label = scopeLabelFor(sel);
    var itDone = 0; d.itr.forEach(function (r) { if (r.complete_date && String(r.complete_date).trim() !== '') itDone++; });
    var paT = 0, paC = 0, pbT = 0, pbC = 0;
    d.pun.forEach(function (r) {
      var cat = String(r.category || '').trim().toUpperCase(), cl = String(r.status || '').trim().toUpperCase() === 'CLOSED';
      if (cat === 'A') { paT++; if (cl) paC++; } else if (cat === 'B') { pbT++; if (cl) pbC++; }
    });
    var itrRows = d.itr.map(function (r, i) {
      var done = r.complete_date && String(r.complete_date).trim() !== '';
      return '<tr class="' + (done ? 'done' : '') + '"><td>' + (i + 1) + '</td><td><b>' + esc(r.tag_no) + '</b></td>' +
        '<td>' + esc(r.tag_desc) + '</td><td>' + esc(r.discipline) + '</td><td>' + esc(r.cs_type) + '</td>' +
        '<td>' + _day(r.plan_start) + '</td><td>' + _day(r.plan_finish) + '</td>' +
        '<td>' + (done ? _day(r.complete_date) : 'PENDING') + '</td><td>' + esc(r.norm) + '</td></tr>';
    });
    var punRows = d.pun.map(function (r, i) {
      var closed = String(r.status || '').trim().toUpperCase() === 'CLOSED';
      var openA = !closed && String(r.category || '').trim().toUpperCase() === 'A';
      return '<tr class="' + (closed ? 'done' : (openA ? 'opa' : '')) + '"><td>' + (i + 1) + '</td>' +
        '<td><b>' + esc(r.punch_no) + '</b></td><td style="text-align:center;font-weight:800;">' + esc(r.category) + '</td>' +
        '<td>' + esc(r.phase) + '</td><td>' + esc(r.status) + '</td><td>' + esc(r.discipline) + '</td><td>' + esc(r.tag_no) + '</td>' +
        '<td style="min-width:220px;white-space:normal;">' + esc(String(r.description || '')) + '</td>' +
        '<td>' + esc(r.action_by) + '</td><td>' + _day(r.open_date) + '</td><td>' + _day(r.closed_date) + '</td><td>' + _day(r.expected_date) + '</td></tr>';
    });
    showModal();
    el('pcm-title').textContent = 'Chi tiết: ' + label;
    el('pcm-sub').textContent = 'ITR-A ' + d.itr.length + ' dòng · Punch ' + d.pun.length + ' dòng';
    el('pcm-body').innerHTML =
      '<div class="pcm-kpis">' +
        kbox('ITR-A Done', itDone, d.itr.length, '#0369a1') +
        kbox('Punch A Closed', paC, paT, '#dc2626') +
        kbox('Punch B Closed', pbC, pbT, '#d97706') + '</div>' +
      '<div class="pcm-chartbox"><canvas id="pcm-chart"></canvas></div>' +
      reportTable('ITR-A Checksheets', ['#', 'TagNo', 'Description', 'Disc', 'ITR', 'Plan Start', 'Plan Finish', 'Complete', 'Norm'], itrRows) +
      reportTable('Punch List  (đỏ = Cat A Open · xanh = Closed)', ['#', 'PunchNo', 'Cat', 'Phase', 'Status', 'Disc', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed', 'Expected'], punRows);
    if (_mchart) { try { _mchart.destroy(); } catch (e) {} _mchart = null; }
    _mchart = drawSCurve(el('pcm-chart'), sc);
    el('pcm-export').onclick = function () { exportScope(label, d); };
  }

  // ---- Modal cho 1 KPI (itr / pa / dac / cssc) ----
  function openKpiModal(key) {
    var sc = scopeWhereFor(null, state.system), d = detailQueries(sc), list = loadRows();
    var titleMap = { itr: 'ITR-A Checksheets', pa: 'Punch Status (Cat A & B theo Phase)',
                     dac: 'DAC — Subsystem × Discipline', cssc: 'CSSC — Subsystem' };
    var cap = titleMap[key], head, rows;
    if (key === 'itr') {
      head = ['#', 'Subsystem', 'TagNo', 'Description', 'Disc', 'ITR', 'Plan Finish', 'Complete'];
      rows = d.itr.map(function (r, i) {
        var done = r.complete_date && String(r.complete_date).trim() !== '';
        return '<tr class="' + (done ? 'done' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
          '<td><b>' + esc(r.tag_no) + '</b></td><td>' + esc(r.tag_desc) + '</td><td>' + esc(r.discipline) + '</td>' +
          '<td>' + esc(r.cs_type) + '</td><td>' + _day(r.plan_finish) + '</td><td>' + (done ? _day(r.complete_date) : 'PENDING') + '</td></tr>';
      });
    } else if (key === 'pa') {
      head = ['#', 'Subsystem', 'PunchNo', 'Cat', 'Phase', 'Status', 'Disc', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed'];
      var pab = d.pun.filter(function (r) { var c = String(r.category || '').trim().toUpperCase(); return c === 'A' || c === 'B'; })
        .sort(function (a, b) { return String(a.category || '').toUpperCase().localeCompare(String(b.category || '').toUpperCase()) || String(a.phase || '').toUpperCase().localeCompare(String(b.phase || '').toUpperCase()); });
      rows = pab.map(function (r, i) {
        var cl = String(r.status || '').trim().toUpperCase() === 'CLOSED';
        return '<tr class="' + (cl ? 'done' : 'opa') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
          '<td><b>' + esc(r.punch_no) + '</b></td><td style="text-align:center;font-weight:800;">' + esc(r.category) + '</td>' +
          '<td>' + esc(r.phase) + '</td><td>' + esc(r.status) + '</td><td>' + esc(r.discipline) + '</td><td>' + esc(r.tag_no) + '</td>' +
          '<td style="min-width:220px;white-space:normal;">' + esc(String(r.description || '')) + '</td>' +
          '<td>' + esc(r.action_by) + '</td><td>' + _day(r.open_date) + '</td><td>' + _day(r.closed_date) + '</td></tr>';
      });
    } else if (key === 'dac') {
      head = ['#', 'Subsystem', 'Description', 'Discipline', 'ITR-A done/total', 'PunchA closed/total', 'PunchA OPEN', 'DAC'];
      rows = [];
      list.forEach(function (g) {
        Object.keys(g.disc).forEach(function (dk) {
          var r = g.disc[dk];
          rows.push('<tr class="' + (r.dac ? 'done' : '') + '"><td>' + (rows.length + 1) + '</td><td>' + esc(ssShort(g.subsystem)) + '</td>' +
            '<td>' + esc(g.desc) + '</td><td>' + esc(dk) + '</td><td>' + r.itr_done + '/' + r.itr_total + '</td>' +
            '<td>' + (r.pa_t ? (r.pa_t - r.pa_o) + '/' + r.pa_t : '–') + '</td><td>' + (r.pa_o || 0) + '</td><td><b>' + (r.dac ? 'DAC ✓' : '-') + '</b></td></tr>');
        });
      });
    } else {
      head = ['#', 'Subsystem', 'Description', 'System', 'ITR-A', 'PunchA open', 'DAC đạt', 'CSSC'];
      rows = list.map(function (g, i) {
        return '<tr class="' + (g.cssc ? 'done' : '') + '"><td>' + (i + 1) + '</td><td><b>' + esc(ssShort(g.subsystem)) + '</b></td>' +
          '<td>' + esc(g.desc) + '</td><td>' + esc(g.system) + '</td><td>' + g.done + '/' + g.total + '</td>' +
          '<td>' + (g.paO || 0) + '</td><td>' + g.dacN + '/' + g.discN + '</td><td><b>' + (g.cssc ? 'CSSC ✓' : '-') + '</b></td></tr>';
      });
    }
    showModal();
    el('pcm-title').textContent = cap;
    el('pcm-sub').textContent = (state.system === '__ALL__' ? 'Toàn dự án' : 'System ' + state.system) + ' · ' + rows.length + ' dòng';
    el('pcm-body').innerHTML = reportTable(cap, head, rows);
    if (_mchart) { try { _mchart.destroy(); } catch (e) {} _mchart = null; }
    el('pcm-export').onclick = function () { exportKpi(key, cap, d, list); };
  }

  // ---- Modal cho 1 DISCIPLINE (nut header): tong hop chi tiet + export ----
  function discRows(disc) {
    var params = [disc.toUpperCase()], w = "UPPER(TRIM(discipline))=?";
    if (state.system !== '__ALL__') { w += " AND system_no=?"; params.push(state.system); }
    return window.PrecomDB.query(
      'SELECT subsystem, subsystem_desc, system_no, itr_total, itr_done,' +
      ' COALESCE(norm_total,0) nt, COALESCE(norm_done,0) nd,' +
      ' COALESCE(punch_a_total,0) pat, COALESCE(punch_a_open,0) pao,' +
      ' COALESCE(punch_b_total,0) pbt, COALESCE(punch_b_open,0) pbo' +
      ' FROM precom_summary WHERE ' + w + ' ORDER BY system_no, subsystem', params);
  }
  var _discCtx = null;   // ghi nho du lieu discipline modal de KPI box loc bang duoi
  function openDisciplineModal(disc) {
    var sel = { type: 'disc', disc: disc };
    var sc = scopeWhereFor(sel, state.system), d = detailQueries(sc), srows = discRows(disc);
    var itDone = 0, itTot = 0, paC = 0, paT = 0, pbC = 0, pbT = 0, dacN = 0;
    srows.forEach(function (r) {
      itDone += r.itr_done; itTot += r.itr_total;
      paC += (r.pat - r.pao); paT += r.pat; pbC += (r.pbt - r.pbo); pbT += r.pbt;
      if (r.itr_done >= r.itr_total && r.pao === 0) dacN += 1;
    });
    var nSub = srows.length;
    _discCtx = { disc: disc, sc: sc, d: d, srows: srows };
    showModal();
    el('pcm-title').textContent = 'Discipline: ' + disc;
    el('pcm-sub').textContent = (state.system === '__ALL__' ? 'Toàn dự án' : 'System ' + state.system) +
      ' · ' + nSub + ' subsystem · ITR-A ' + d.itr.length + ' dòng · Punch ' + d.pun.length + ' dòng · Click ô KPI để lọc bảng dưới';
    el('pcm-body').innerHTML =
      '<div class="pcm-kpis">' +
        discKbox('itr', 'ITR-A Done', itDone, itTot, '#0369a1') +
        discKbox('pa', 'Punch A Closed', paC, paT, '#dc2626') +
        discKbox('pb', 'Punch B Closed', pbC, pbT, '#d97706') +
        discKbox('dac', 'DAC (Subsystem)', dacN, nSub, '#7c3aed') + '</div>' +
      '<div class="pcm-chartbox"><canvas id="pcm-chart"></canvas></div>' +
      '<div id="pcm-disc-table"></div>';
    renderDiscTable('dac', false);   // mac dinh: Tong hop theo Subsystem
    wireDiscKpi();
    if (_mchart) { try { _mchart.destroy(); } catch (e) {} _mchart = null; }
    _mchart = drawSCurve(el('pcm-chart'), sc);
    el('pcm-export').onclick = function () { exportDiscipline(disc, srows, d); };
  }
  // 1 KPI box trong discipline modal: click box = toan bo; click so Done (xanh) = loc done-only.
  function discKbox(metric, label, closed, total, color) {
    var p = pct(closed, total);
    return '<div class="pcm-kbox clk" data-dm="' + metric + '" style="border-top:3px solid ' + color + ';" title="Click: lọc bảng dưới theo ' + esc(label) + '">' +
      '<div class="kl">' + esc(label) + '</div>' +
      '<div class="kf"><span class="kdone" data-dm="' + metric + '" data-only="1" title="Chỉ hiện mục đã Done/Closed">' + closed.toLocaleString() + '</span> / ' +
      '<span class="ktot" data-dm="' + metric + '" data-only="0" title="Hiện toàn bộ">' + total.toLocaleString() + '</span></div>' +
      '<div class="kp ' + pctCls(p) + '">' + p + '%</div></div>';
  }
  function wireDiscKpi() {
    var box = el('pcm-body'); if (!box) return;
    box.querySelectorAll('.pcm-kbox[data-dm]').forEach(function (b) {
      b.onclick = function () { renderDiscTable(b.getAttribute('data-dm'), false); };
    });
    box.querySelectorAll('.kdone[data-dm]').forEach(function (s) {
      s.onclick = function (e) { e.stopPropagation(); renderDiscTable(s.getAttribute('data-dm'), true); };
    });
    box.querySelectorAll('.ktot[data-dm]').forEach(function (s) {
      s.onclick = function (e) { e.stopPropagation(); renderDiscTable(s.getAttribute('data-dm'), false); };
    });
  }
  // Bang dong duoi chart: doi noi dung theo KPI box duoc chon. Gia tri Done = xanh la.
  function renderDiscTable(metric, doneOnly) {
    if (!_discCtx) return;
    var d = _discCtx.d, srows = _discCtx.srows, head, rows, cap;
    var box = el('pcm-body');
    if (box) box.querySelectorAll('.pcm-kbox[data-dm]').forEach(function (b) {
      b.classList.toggle('sel', b.getAttribute('data-dm') === metric);
    });
    var G = function (v) { return '<span style="color:#059669;font-weight:700;">' + v + '</span>'; };
    if (metric === 'itr') {
      var it = doneOnly ? d.itr.filter(function (r) { return r.complete_date && String(r.complete_date).trim() !== ''; }) : d.itr;
      cap = 'ITR-A Checksheets' + (doneOnly ? ' — đã DONE' : '') + ' (' + it.length + ')';
      head = ['#', 'Subsystem', 'TagNo', 'Description', 'CS Type', 'Plan Finish', 'Complete'];
      rows = it.map(function (r, i) {
        var done = r.complete_date && String(r.complete_date).trim() !== '';
        return '<tr class="' + (done ? 'done' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
          '<td><b>' + esc(r.tag_no) + '</b></td><td>' + esc(r.tag_desc) + '</td><td>' + esc(r.cs_type) + '</td>' +
          '<td>' + _day(r.plan_finish) + '</td><td>' + (done ? G(_day(r.complete_date)) : 'PENDING') + '</td></tr>';
      });
    } else if (metric === 'pa' || metric === 'pb') {
      var cat = metric === 'pa' ? 'A' : 'B';
      var pu = d.pun.filter(function (r) { return String(r.category || '').trim().toUpperCase() === cat; });
      if (doneOnly) pu = pu.filter(function (r) { return String(r.status || '').trim().toUpperCase() === 'CLOSED'; });
      cap = 'Punch ' + cat + (doneOnly ? ' — đã CLOSED' : '') + ' (' + pu.length + ')';
      head = ['#', 'Subsystem', 'PunchNo', 'Phase', 'Status', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed'];
      rows = pu.map(function (r, i) {
        var cl = String(r.status || '').trim().toUpperCase() === 'CLOSED';
        return '<tr class="' + (cl ? 'done' : 'opa') + '"><td>' + (i + 1) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
          '<td><b>' + esc(r.punch_no) + '</b></td><td>' + esc(r.phase) + '</td><td>' + (cl ? G(esc(r.status)) : esc(r.status)) + '</td>' +
          '<td>' + esc(r.tag_no) + '</td><td style="min-width:220px;white-space:normal;">' + esc(String(r.description || '')) + '</td>' +
          '<td>' + esc(r.action_by) + '</td><td>' + _day(r.open_date) + '</td><td>' + _day(r.closed_date) + '</td></tr>';
      });
    } else {   // dac -> per-subsystem (mac dinh = Tong hop theo Subsystem)
      var sr = doneOnly ? srows.filter(function (r) { return r.itr_done >= r.itr_total && r.pao === 0; }) : srows;
      cap = (doneOnly ? 'Subsystem đã đạt DAC' : 'Tổng hợp theo Subsystem') + ' (' + sr.length + ')';
      head = ['#', 'System', 'Subsystem', 'Description', 'ITR done/total', '%ITR', 'PunchA', 'PunchB', 'DAC'];
      rows = sr.map(function (r, i) {
        var dac = (r.itr_done >= r.itr_total && r.pao === 0);
        return '<tr class="' + (dac ? 'done' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(r.system_no) + '</td>' +
          '<td><b>' + esc(ssShort(r.subsystem)) + '</b></td><td>' + esc(r.subsystem_desc) + '</td>' +
          '<td>' + G(r.itr_done) + '/' + r.itr_total + '</td><td class="' + pctCls(pct(r.itr_done, r.itr_total)) + '">' + pct(r.itr_done, r.itr_total) + '%</td>' +
          '<td>' + (r.pat ? G(r.pat - r.pao) + '/' + r.pat : '–') + '</td><td>' + (r.pbt ? G(r.pbt - r.pbo) + '/' + r.pbt : '–') + '</td>' +
          '<td><b>' + (dac ? G('DAC ✓') : '-') + '</b></td></tr>';
      });
    }
    var t = el('pcm-disc-table');
    if (t) t.innerHTML = reportTable(cap, head, rows);
  }
  function exportDiscipline(disc, srows, d) {
    var sub = _rptSub('Discipline ' + disc + (state.system === '__ALL__' ? '' : ' · System ' + state.system));
    var sHead = ['#', 'System', 'Subsystem', 'Description', 'ITR done', 'ITR total', '%ITR', 'PunchA closed/total', 'PunchB closed/total', 'DAC'];
    var sRows = srows.map(function (r, i) {
      var dac = (r.itr_done >= r.itr_total && r.pao === 0);
      return [i + 1, r.system_no, r.subsystem, r.subsystem_desc, r.itr_done, r.itr_total, pct(r.itr_done, r.itr_total) + '%',
        r.pat ? (r.pat - r.pao) + '/' + r.pat : '-', r.pbt ? (r.pbt - r.pbo) + '/' + r.pbt : '-', dac ? 'DAC' : ''];
    });
    var iHead = ['#', 'System', 'Subsystem', 'TagNo', 'Description', 'CS Type', 'Plan Start', 'Plan Finish', 'Complete', 'Location'];
    var iRows = d.itr.map(function (r, i) { return [i + 1, r.system_no, r.subsystem, r.tag_no, r.tag_desc, r.cs_type, _day(r.plan_start), _day(r.plan_finish), _day(r.complete_date), r.location]; });
    var pHead = ['#', 'Subsystem', 'PunchNo', 'Cat', 'Phase', 'Status', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed', 'Expected'];
    var pRows = d.pun.map(function (r, i) { return [i + 1, r.subsystem, r.punch_no, r.category, r.phase, r.status, r.tag_no, r.description, r.action_by, _day(r.open_date), _day(r.closed_date), _day(r.expected_date)]; });
    writeReport('Precom_Discipline_' + disc.replace(/[^\w-]+/g, '_') + '.xlsx', 'BÁO CÁO PRECOM — Discipline ' + disc, [
      { name: 'Summary', head: sHead, rows: sRows, subtitle: sub, rowFill: function (ri) { var r = srows[ri]; return (r.itr_done >= r.itr_total && r.pao === 0) ? 'FFE6F6EC' : null; } },
      { name: 'ITR-A', head: iHead, rows: iRows, subtitle: sub, rowFill: function (ri) { var r = d.itr[ri]; return (r.complete_date && String(r.complete_date).trim() !== '') ? 'FFE6F6EC' : null; } },
      { name: 'Punch', head: pHead, rows: pRows, subtitle: sub, rowFill: function (ri) { var r = d.pun[ri]; if (String(r.status || '').trim().toUpperCase() === 'CLOSED') return 'FFE6F6EC'; if (String(r.category || '').trim().toUpperCase() === 'A') return 'FFFDEAEA'; return null; } }
    ]);
  }

  // ---- Modal khi click 1 chip Punch Status (phase + cat) ----
  function openPunchPhaseModal(phase, cat) {
    var w = "UPPER(TRIM(COALESCE(category,'')))=?", params = [cat];
    if (state.system !== '__ALL__') { w += " AND system_no=?"; params.push(state.system); }
    var all = [];
    try {
      all = window.PrecomDB.query(
        'SELECT punch_no, punch_raised_no, category, status, discipline, tag_no, tag_desc, drawing_no, description,' +
        ' corrective_action, action_by, raise_by, open_date, closed_date, expected_date, phase, subsystem, system_no' +
        ' FROM punch_list WHERE ' + w + " ORDER BY (UPPER(TRIM(status))='CLOSED'), system_no, subsystem, punch_no", params);
    } catch (e) {}
    var rows = all.filter(function (r) { return phaseBucket(r.phase) === phase; });
    var closed = rows.filter(function (r) { return String(r.status || '').trim().toUpperCase() === 'CLOSED'; }).length;
    showModal();
    el('pcm-title').textContent = 'Punch ' + phase + '_' + cat;
    el('pcm-sub').textContent = (state.system === '__ALL__' ? 'Toàn dự án' : 'System ' + state.system) +
      ' · Cat ' + cat + ' · Phase ' + phase + ' · ' + rows.length + ' punch (Closed ' + closed + ')';
    el('pcm-body').innerHTML =
      '<div class="pcm-kpis">' +
        kbox('Đã Closed', closed, rows.length, '#059669') +
        kbox('Còn Open', rows.length - closed, rows.length, '#dc2626') + '</div>' +
      reportTable('Punch ' + phase + '_' + cat + '  (đỏ = Open · xanh = Closed)',
        ['#', 'System', 'Subsystem', 'PunchNo', 'Discipline', 'Phase', 'Status', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed', 'Expected'],
        rows.map(function (r, i) {
          var cl = String(r.status || '').trim().toUpperCase() === 'CLOSED';
          return '<tr class="' + (cl ? 'done' : 'opa') + '"><td>' + (i + 1) + '</td><td>' + esc(r.system_no) + '</td><td>' + esc(ssShort(r.subsystem)) + '</td>' +
            '<td><b>' + esc(r.punch_no) + '</b></td><td>' + esc(r.discipline) + '</td><td>' + esc(r.phase) + '</td>' +
            '<td>' + (cl ? '<span style="color:#059669;font-weight:700;">' + esc(r.status) + '</span>' : esc(r.status)) + '</td>' +
            '<td>' + esc(r.tag_no) + '</td><td style="min-width:220px;white-space:normal;">' + esc(String(r.description || '')) + '</td>' +
            '<td>' + esc(r.action_by) + '</td><td>' + _day(r.open_date) + '</td><td>' + _day(r.closed_date) + '</td><td>' + _day(r.expected_date) + '</td></tr>';
        }));
    if (_mchart) { try { _mchart.destroy(); } catch (e) {} _mchart = null; }
    el('pcm-export').onclick = function () { exportPunchPhase(phase, cat, rows); };
  }
  function exportPunchPhase(phase, cat, rows) {
    var sub = _rptSub('Punch ' + phase + '_' + cat + (state.system === '__ALL__' ? '' : ' · System ' + state.system));
    var head = ['#', 'System', 'Subsystem', 'PunchNo', 'RaisedNo', 'Cat', 'Phase', 'Status', 'Discipline', 'TagNo', 'Defect Description', 'Corrective Action', 'Action By', 'Open', 'Closed', 'Expected'];
    var xr = rows.map(function (r, i) { return [i + 1, r.system_no, r.subsystem, r.punch_no, r.punch_raised_no, r.category, r.phase, r.status, r.discipline, r.tag_no, r.description, r.corrective_action, r.action_by, _day(r.open_date), _day(r.closed_date), _day(r.expected_date)]; });
    writeReport('Precom_Punch_' + (phase + '_' + cat).replace(/[^\w-]+/g, '_') + '.xlsx', 'BÁO CÁO PUNCH — ' + phase + '_' + cat, [
      { name: 'Punch', head: head, rows: xr, subtitle: sub, rowFill: function (ri) { return String(rows[ri].status || '').trim().toUpperCase() === 'CLOSED' ? 'FFE6F6EC' : 'FFFDEAEA'; } }
    ]);
  }

  // ==================== EXCEL BAO CAO CHUYEN NGHIEP ====================
  // sheets: [{ name, head:[...], rows:[[...]], subtitle, rowFill:fn(ri)->argb|null }]
  function writeReport(filename, title, sheets) {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS chưa sẵn sàng.'); return; }
    var wb = new ExcelJS.Workbook();
    sheets.forEach(function (s) {
      var ws = wb.addWorksheet(s.name.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 30) || 'Sheet');
      var nc = s.head.length;
      ws.mergeCells(1, 1, 1, nc);
      var tc = ws.getCell(1, 1); tc.value = title;
      tc.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      tc.alignment = { vertical: 'middle', horizontal: 'left' };
      tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2647' } };
      ws.getRow(1).height = 26;
      ws.mergeCells(2, 1, 2, nc);
      var stc = ws.getCell(2, 1); stc.value = s.subtitle || '';
      stc.font = { italic: true, size: 9, color: { argb: 'FF5B6B80' } };
      var hr = ws.getRow(3);
      s.head.forEach(function (h, i) {
        var c = hr.getCell(i + 1); c.value = h;
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A63' } };
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = RB;
      });
      hr.height = 20;
      s.rows.forEach(function (row, ri) {
        var xr = ws.getRow(4 + ri);
        row.forEach(function (v, ci) { var c = xr.getCell(ci + 1); c.value = v; c.border = RB; c.alignment = { vertical: 'top' }; });
        var fill = s.rowFill && s.rowFill(ri);
        if (fill) { for (var a = 1; a <= nc; a++) xr.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; }
        else if (ri % 2 === 1) { for (var b = 1; b <= nc; b++) xr.getCell(b).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FB' } }; }
        if (s.cellFill) { row.forEach(function (v, ci) { var af = s.cellFill(ri, ci); if (af) xr.getCell(ci + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: af } }; }); }
      });
      s.head.forEach(function (h, i) {
        var w = String(h).length;
        s.rows.forEach(function (row) { var v = row[i] == null ? '' : String(row[i]); if (v.length > w) w = v.length; });
        ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 50);
      });
      ws.views = [{ state: 'frozen', ySplit: 3 }];
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: nc } };
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = filename; a.click(); URL.revokeObjectURL(a.href);
    });
  }
  function _rptSub(scopeTxt) {
    var meta = window.PrecomDB.meta();
    return 'Phạm vi: ' + scopeTxt + '   ·   Nguồn: ' + (meta.filename || '') +
      (meta.fileTime ? ' (' + meta.fileTime + ')' : '') + '   ·   Xuất: ' + new Date().toLocaleString();
  }

  // ---- Export tu MODAL PHAM VI (ITR-A + Punch) ----
  function exportScope(label, d) {
    var sub = _rptSub(label);
    var itrHead = ['#', 'System', 'Subsystem', 'TagNo', 'Description', 'Discipline', 'ITR', 'Plan Start', 'Plan Finish', 'Complete', 'Norm', 'Location'];
    var itrRows = d.itr.map(function (r, i) { return [i + 1, r.system_no, r.subsystem, r.tag_no, r.tag_desc, r.discipline, r.cs_type, _day(r.plan_start), _day(r.plan_finish), _day(r.complete_date), r.norm, r.location]; });
    var punHead = ['#', 'Subsystem', 'PunchNo', 'RaisedNo', 'Cat', 'Phase', 'Status', 'Discipline', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed', 'Expected'];
    var punRows = d.pun.map(function (r, i) { return [i + 1, r.subsystem, r.punch_no, r.punch_raised_no, r.category, r.phase, r.status, r.discipline, r.tag_no, r.description, r.action_by, _day(r.open_date), _day(r.closed_date), _day(r.expected_date)]; });
    writeReport('Precom_' + label.replace(/[^\w-]+/g, '_') + '.xlsx', 'BÁO CÁO PRECOM — ' + label, [
      { name: 'ITR-A', head: itrHead, rows: itrRows, subtitle: sub,
        rowFill: function (ri) { var r = d.itr[ri]; return (r.complete_date && String(r.complete_date).trim() !== '') ? 'FFE6F6EC' : null; } },
      { name: 'Punch', head: punHead, rows: punRows, subtitle: sub,
        rowFill: function (ri) { var r = d.pun[ri]; if (String(r.status || '').trim().toUpperCase() === 'CLOSED') return 'FFE6F6EC'; if (String(r.category || '').trim().toUpperCase() === 'A') return 'FFFDEAEA'; return null; } }
    ]);
  }

  // ---- Export tu MODAL KPI ----
  function exportKpi(key, cap, d, list) {
    var sub = _rptSub(state.system === '__ALL__' ? 'Toàn dự án' : 'System ' + state.system);
    var head, rows, fill;
    if (key === 'itr') {
      head = ['#', 'Subsystem', 'TagNo', 'Description', 'Disc', 'ITR', 'Plan Finish', 'Complete'];
      rows = d.itr.map(function (r, i) { return [i + 1, r.subsystem, r.tag_no, r.tag_desc, r.discipline, r.cs_type, _day(r.plan_finish), (r.complete_date && String(r.complete_date).trim() !== '') ? _day(r.complete_date) : 'PENDING']; });
      fill = function (ri) { var r = d.itr[ri]; return (r.complete_date && String(r.complete_date).trim() !== '') ? 'FFE6F6EC' : null; };
    } else if (key === 'pa') {
      head = ['#', 'Subsystem', 'PunchNo', 'Cat', 'Phase', 'Status', 'Disc', 'TagNo', 'Defect Description', 'Action By', 'Open', 'Closed'];
      var pab = d.pun.filter(function (r) { var c = String(r.category || '').trim().toUpperCase(); return c === 'A' || c === 'B'; });
      rows = pab.map(function (r, i) { return [i + 1, r.subsystem, r.punch_no, r.category, r.phase, r.status, r.discipline, r.tag_no, r.description, r.action_by, _day(r.open_date), _day(r.closed_date)]; });
      fill = function (ri) { return String(pab[ri].status || '').trim().toUpperCase() === 'CLOSED' ? 'FFE6F6EC' : 'FFFDEAEA'; };
    } else if (key === 'dac') {
      head = ['#', 'Subsystem', 'Description', 'Discipline', 'ITR-A done/total', 'PunchA closed/total', 'PunchA OPEN', 'DAC'];
      rows = []; var flags = [];
      list.forEach(function (g) { Object.keys(g.disc).forEach(function (dk) { var r = g.disc[dk]; rows.push([rows.length + 1, g.subsystem, g.desc, dk, r.itr_done + '/' + r.itr_total, r.pa_t ? (r.pa_t - r.pa_o) + '/' + r.pa_t : '-', r.pa_o || 0, r.dac ? 'DAC' : '']); flags.push(!!r.dac); }); });
      fill = function (ri) { return flags[ri] ? 'FFE6F6EC' : null; };
    } else {
      head = ['#', 'Subsystem', 'Description', 'System', 'ITR done/total', 'PunchA open', 'DAC đạt', 'CSSC'];
      rows = list.map(function (g, i) { return [i + 1, g.subsystem, g.desc, g.system, g.done + '/' + g.total, g.paO || 0, g.dacN + '/' + g.discN, g.cssc ? 'CSSC' : '']; });
      fill = function (ri) { return list[ri].cssc ? 'FFE6F6EC' : null; };
    }
    writeReport('Precom_' + key.toUpperCase() + '.xlsx', 'BÁO CÁO PRECOM — ' + cap, [{ name: cap, head: head, rows: rows, subtitle: sub, rowFill: fill }]);
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
