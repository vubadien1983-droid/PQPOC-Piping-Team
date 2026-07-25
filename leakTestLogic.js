/* ==========================================================================
 * leakTestLogic.js  —  Tab "Leak Test"  (Piping Fab Management, Vanilla JS)
 * --------------------------------------------------------------------------
 * Mối quan hệ: 1 Leak Test package = N Hydrotest package (TestPackageNo).
 * Nguồn dữ liệu (DÙNG CHUNG database với tab Testing Status — app đỡ đơ):
 *   - Hydrotest + 5 cột Google Sheet:  window.hybridFetch('/api/joints?sys=__ALL__')
 *       -> signP02A(W), flushing(X), signP03A(Y), signP04A(AA), signP05A(AD)
 *   - Flange (ĐK C):  window.LocalDB.query -> flange_joints (tightened_date)
 *   - Punch A (ĐK B): window.PrecomDB.query -> punch_list (join cột package=TestPackNo,
 *                     fallback spool_no; category='A' & status<>'CLOSED')
 *
 * TỐI ƯU: mọi tra cứu O(1) qua Map (Hash Table). buildLeakTestLookupMap() chạy
 * ĐÚNG 1 LẦN khi load; render chỉ .get() vào Map, KHÔNG Array.filter() lặp lại.
 * Không dùng nested loop O(n^2).
 * ======================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------- *
   * 0. DỮ LIỆU TĨNH — thay bằng mảng thật từ file Excel LeakTest sau.
   *    Shape bắt buộc: { leakTestNo, subsystem, testPackages: [TestPackageNo...] }
   * ---------------------------------------------------------------------- */
  window.LEAK_TEST_DATA = window.LEAK_TEST_DATA || [
    // { leakTestNo: 'LT-AB-001', subsystem: 'AB-01', testPackages: ['TP-AB-001','TP-AB-002'] },
  ];

  // 5 cột Google Sheet quyết định ĐK A (đủ ngày = hoàn thành).
  var SHEET_COLS = ['signP02A', 'flushing', 'signP03A', 'signP04A', 'signP05A'];

  var state = {
    loaded: false,
    leakRows: [],          // kết quả đã tính cho từng LeakTest (dùng để render)
    filtered: [],          // đang hiển thị (sau search/filter) -> Export lấy đúng mảng này
    subsystemFilter: '',
    searchQuery: '',
    readinessFilter: 'all',// all | ready | pending
    chartSel: null,        // null | 'ready' | 'pending' (slice biểu đồ đang chọn)
    pieChart: null,
    // Maps (Hash Table)
    hydroMap: null,        // Map(TP_UPPER -> pkg{signP02A,...})
    flangeMap: null,       // Map(TP_UPPER -> {done,total})
    punchMap: null,        // Map(TP_UPPER -> {aTotal,aOpen})
    evalMap: null          // Map(TP_UPPER -> {condA,condB,condC,ready,flangeDone,flangeTotal,punchAOpen,punchATotal,pkg})
  };
  window.LeakTestState = state;

  /* --------------------------- helpers ---------------------------------- */
  var _pct = window.getProgressPct || function (d, t) { return t > 0 ? Math.round((d / t) * 100) : 0; };
  var _esc = window.escapeHtml || function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  function hasDate(v) { return String(v == null ? '' : v).trim() !== ''; }   // cột có ngày = hoàn thành
  function U(s) { return String(s == null ? '' : s).trim().toUpperCase(); }  // chuẩn hoá key TP

  /* ---------------------------------------------------------------------- *
   * 1. BUILD LOOKUP MAPS — chạy 1 lần. Trả Promise (chờ các DB lazy sẵn sàng).
   * ---------------------------------------------------------------------- */
  function buildLeakTestLookupMap() {
    var hydroP  = _loadHydroMap();
    var flangeP = _loadFlangeMap();
    var punchP  = _loadPunchMap();
    return Promise.all([hydroP, flangeP, punchP]).then(function (res) {
      state.hydroMap  = res[0];
      state.flangeMap = res[1];
      state.punchMap  = res[2];
      state.evalMap   = _buildEvalMap(state.hydroMap, state.flangeMap, state.punchMap);
      return state.evalMap;
    });
  }

  // (a) Hydrotest package + 5 cột Sheet -> Map. Dùng chung /api/joints (hybridFetch = LocalDB offline / server).
  function _loadHydroMap() {
    var fetchFn = window.hybridFetch
      ? window.hybridFetch('/api/joints?sys=__ALL__')
      : fetch((window.getApiUrl ? window.getApiUrl('/api/joints?sys=__ALL__') : '/api/joints?sys=__ALL__'));
    return Promise.resolve(fetchFn)
      .then(function (r) { return r.json(); })
      .then(function (arr) {
        var m = new Map();
        (arr || []).forEach(function (p) { m.set(U(p.testPackageNo), p); });
        return m;
      })
      .catch(function (e) { console.warn('[LeakTest] hydro map fail:', e && e.message); return new Map(); });
  }

  // (b) Flange -> Map(TP -> {done,total}) trong 1 query GROUP BY (không quét lại từng gói).
  function _loadFlangeMap() {
    if (!window.LocalDB) return Promise.resolve(new Map());
    return window.LocalDB.ready().then(function () {
      var m = new Map();
      try {
        var rows = window.LocalDB.query(
          "SELECT UPPER(TRIM(test_package_no)) tp, COUNT(*) total, " +
          " SUM(CASE WHEN TRIM(COALESCE(tightened_date,''))<>'' THEN 1 ELSE 0 END) done " +
          "FROM flange_joints WHERE TRIM(COALESCE(test_package_no,''))<>'' GROUP BY UPPER(TRIM(test_package_no))");
        rows.forEach(function (r) { m.set(r.tp, { done: +r.done || 0, total: +r.total || 0 }); });
      } catch (e) { /* DB cũ chưa có flange_joints -> ĐK C mặc định pass */ }
      return m;
    }).catch(function () { return new Map(); });
  }

  // (c) Punch A -> Map(SUBSYSTEM -> {aTotal,aOpen}). DB thứ 2 lazy: PrecomDB.ready().
  //     THỰC TẾ dữ liệu: punch_list.package = tên gói Precom (KHÔNG phải hydrotest TP), không có spool.
  //     Punch được track theo cột `subsystem` (vd "CPPT-13-02"). Hydrotest pack suy subsystem từ
  //     TestPackageNo: "TP-<prefix>-<sysNo>-<subNo>-..." -> key = "<prefix>-<sysNo>-<subNo>".
  //     Chỉ lấy discipline Piping, category A.
  function _loadPunchMap() {
    if (!window.PrecomDB) return Promise.resolve(new Map());
    return window.PrecomDB.ready().then(function () {
      var m = new Map();
      try {
        var cols = window.PrecomDB.query('PRAGMA table_info(punch_list)').map(function (c) { return c.name; });
        var subCol  = _pick(cols, ['subsystem', 'sub_system', 'subsystem_no', 'subsys']);
        var catCol  = _pick(cols, ['category', 'cat']);
        var stCol   = _pick(cols, ['status']);
        var discCol = _pick(cols, ['discipline', 'disc']);
        if (!subCol || !catCol || !stCol) return m;
        var discCl = discCol ? " AND UPPER(TRIM(" + discCol + ")) LIKE 'PIP%'" : "";
        var q = "SELECT UPPER(TRIM(" + subCol + ")) sub, " +
          "SUM(CASE WHEN UPPER(TRIM(" + catCol + "))='A'" + discCl + " THEN 1 ELSE 0 END) a_total, " +
          "SUM(CASE WHEN UPPER(TRIM(" + catCol + "))='A'" + discCl + " AND UPPER(TRIM(" + stCol + "))<>'CLOSED' THEN 1 ELSE 0 END) a_open " +
          "FROM punch_list WHERE TRIM(COALESCE(" + subCol + ",''))<>'' GROUP BY UPPER(TRIM(" + subCol + "))";
        window.PrecomDB.query(q).forEach(function (r) {
          if ((+r.a_total || 0) > 0) m.set(r.sub, { aTotal: +r.a_total || 0, aOpen: +r.a_open || 0 });
        });
      } catch (e) { /* chưa có punch_list -> ĐK B mặc định pass */ }
      return m;
    }).catch(function () { return new Map(); });
  }

  // Suy subsystem key (khớp punch_list.subsystem) từ TestPackageNo: "TP-CPPT-13-02-G-001-V" -> "CPPT-13-02".
  function _subsysKeyFromTP(tp) {
    var t = String(tp || '').split('-');
    return (t[1] && t[2] && t[3]) ? U(t[1] + '-' + t[2] + '-' + t[3]) : '';
  }

  function _pick(cols, cands) {
    var low = cols.map(function (c) { return c.toLowerCase(); });
    for (var i = 0; i < cands.length; i++) { var k = low.indexOf(cands[i]); if (k >= 0) return cols[k]; }
    return null;
  }

  /* ---------------------------------------------------------------------- *
   * 2. ĐÁNH GIÁ 3 ĐIỀU KIỆN cho TỪNG Hydrotest package -> evalMap (O(1) tra sau).
   * ---------------------------------------------------------------------- */
  function _buildEvalMap(hydroMap, flangeMap, punchMap) {
    var em = new Map();
    hydroMap.forEach(function (pkg, tp) {
      // ĐK A (ITR-A): đếm số checksheet đã done trong 5 cột; đủ 5 -> hoàn thành.
      var sheetDone = 0;
      SHEET_COLS.forEach(function (c) { if (hasDate(pkg[c])) sheetDone++; });
      var condA = sheetDone === SHEET_COLS.length;
      // ĐK B: Punch A (Piping) của SUBSYSTEM chứa gói này phải hết open (không có punch -> pass).
      var pu = punchMap.get(_subsysKeyFromTP(tp)) || { aTotal: 0, aOpen: 0 };
      var condB = (pu.aOpen || 0) === 0;
      // ĐK C: Flange 100% (không có flange -> pass).
      var fl = flangeMap.get(tp) || { done: 0, total: 0 };
      var condC = (fl.total || 0) === 0 ? true : (fl.done >= fl.total);

      em.set(tp, {
        pkg: pkg, condA: condA, condB: condB, condC: condC,
        ready: condA && condB && condC,
        sheetDone: sheetDone, sheetTotal: SHEET_COLS.length,
        flangeDone: fl.done || 0, flangeTotal: fl.total || 0,
        punchATotal: pu.aTotal || 0, punchAOpen: pu.aOpen || 0
      });
    });
    return em;
  }

  // Fallback eval khi TP có trong JSON nhưng KHÔNG có trong hydroMap (dữ liệu lệch).
  function _evalOf(tp) {
    return state.evalMap.get(U(tp)) || {
      pkg: { testPackageNo: tp }, condA: false, condB: false, condC: false, ready: false,
      sheetDone: 0, sheetTotal: SHEET_COLS.length,
      flangeDone: 0, flangeTotal: 0, punchATotal: 0, punchAOpen: 0, missing: true
    };
  }

  // Tách System / System No / Subsystem No. Ưu tiên field trong JSON tĩnh; nếu thiếu -> tách
  // best-effort từ TestPackageNo mẫu "TP-CPPT-11-01-AV-001-V" (t[2]=SystemNo, t[3]=SubNo, t[4]=System).
  function _parseLoc(lt) {
    var tp = (Array.isArray(lt.testPackages) && lt.testPackages[0]) ? String(lt.testPackages[0]) : '';
    var t = tp.split('-');
    var pSysNo = t[2] || '', pSub = t[3] || '', pSys = t[4] || '';
    var system = lt.system || pSys || (lt.subsystem || '?');
    var systemNo = lt.systemNo || pSysNo || '';
    var subsystemNo = lt.subsystemNo ||
      (lt.subsystem && lt.subsystem.indexOf('-') >= 0 ? lt.subsystem
        : (pSysNo && pSub ? (pSysNo + '-' + pSub) : (lt.subsystem || '?')));
    return { system: system, systemNo: systemNo, subsystemNo: subsystemNo };
  }

  // Leak Test coi là đã "test xong" khi cột Testing có dữ liệu (Done). Hiện chưa có -> false.
  function _testingDone(v) { var s = String(v == null ? '' : v).trim().toUpperCase(); return s !== '' && s !== '-' && s !== 'N/A'; }

  // ---- Ngày kế hoạch (LTP Timeline): Start (dd-Mmm-yy) + Days -> Finish = Start + Days ----
  var _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var _MON_I = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function _parseDate(s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : s;
    if (typeof s === 'number') { var e = new Date(Date.UTC(1899, 11, 30) + s * 86400000); return isNaN(e) ? null : e; } // Excel serial
    var str = String(s).trim();
    var m = str.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{2,4})$/);           // 10-Nov-26
    if (m) { var y = +m[3]; if (y < 100) y += 2000; var mi = _MON_I[m[2].toLowerCase()]; if (mi != null) return new Date(y, mi, +m[1]); }
    var d = new Date(str); return isNaN(d) ? null : d;
  }
  function _fmtDate(d) {
    if (!d || isNaN(d)) return '';
    var dd = d.getDate();
    return (dd < 10 ? '0' : '') + dd + '-' + _MON[d.getMonth()] + '-' + String(d.getFullYear()).slice(-2);
  }
  function _addDays(d, n) { if (!d) return null; var x = new Date(d.getTime()); x.setDate(x.getDate() + (+n || 0)); return x; }

  /* ---------------------------------------------------------------------- *
   * 3. TỔNG HỢP theo từng Leak Test package.
   * ---------------------------------------------------------------------- */
  function computeLeakRows() {
    return (window.LEAK_TEST_DATA || []).map(function (lt, i) {
      var tps = Array.isArray(lt.testPackages) ? lt.testPackages : [];
      var readyCount = 0, flDone = 0, flTotal = 0, members = [];
      tps.forEach(function (tp) {                 // O(1) mỗi lần .get() vào evalMap
        var ev = _evalOf(tp);
        if (ev.ready) readyCount++;
        flDone += ev.flangeDone; flTotal += ev.flangeTotal;
        members.push({ testPackageNo: tp, ev: ev });
      });
      var total = tps.length;
      // Punch A tính theo SUBSYSTEM (dedupe) — tránh nhân bản khi 1 subsystem có nhiều pack.
      var puSeen = {}, puClosed = 0, puTotal = 0, puKey = '';
      members.forEach(function (m) {
        var k = _subsysKeyFromTP(m.testPackageNo); puKey = puKey || k;
        if (!puSeen[k]) { puSeen[k] = 1; puTotal += m.ev.punchATotal; puClosed += (m.ev.punchATotal - m.ev.punchAOpen); }
      });
      var loc = _parseLoc(lt);
      var testing = lt.testing || '';   // chưa có dữ liệu thực hiện Leak Test
      // Kế hoạch từ LTP Timeline: planStart (Start) + days (Days) -> finish = start + days.
      var _ps = _parseDate(lt.planStart);
      var _days = (lt.days != null && lt.days !== '') ? (+lt.days || 0) : null;
      var planStartStr = _ps ? _fmtDate(_ps) : (lt.planStart || '');
      var finishStr = (_ps && _days != null) ? _fmtDate(_addDays(_ps, _days)) : '';
      return {
        no: i + 1,
        leakTestNo: lt.leakTestNo || ('LT-' + (i + 1)),
        system: loc.system, systemNo: loc.systemNo, subsystemNo: loc.subsystemNo,
        subsystem: loc.subsystemNo,   // dùng làm group/filter key
        members: members,
        readyCount: readyCount, totalCount: total,
        readyPct: _pct(readyCount, total),
        flangeDone: flDone, flangeTotal: flTotal,
        flangePct: _pct(flDone, flTotal),
        punchClosed: puClosed, punchTotal: puTotal,
        punchPct: _pct(puClosed, puTotal),
        punchSubsysKey: puKey,
        // Readiness: TẤT CẢ hydrotest con đều Ready (đủ 3 ĐK) và có ít nhất 1 gói.
        readiness: total > 0 && readyCount === total,
        testing: testing,
        testingDone: _testingDone(testing),
        planStart: planStartStr, days: _days, finishDate: finishStr
      };
    });
  }

  /* ---------------------------------------------------------------------- *
   * 4. RENDER  (sidebar group-by-subsystem · pie chart · preview table)
   * ---------------------------------------------------------------------- */
  function applyFilters() {
    var q = state.searchQuery, sub = state.subsystemFilter, rf = state.readinessFilter;
    state.filtered = state.leakRows.filter(function (r) {
      if (sub && r.subsystemNo !== sub) return false;
      if (rf === 'ready' && !r.readiness) return false;
      if (rf === 'pending' && r.readiness) return false;
      if (q) {
        var hay = (r.leakTestNo + ' ' + r.system + ' ' + r.systemNo + ' ' + r.subsystemNo).toLowerCase();
        var inMembers = r.members.some(function (m) { return m.testPackageNo.toLowerCase().indexOf(q) >= 0; });
        if (hay.indexOf(q) < 0 && !inMembers) return false;
      }
      return true;
    });
  }

  function renderAll() {
    applyFilters();
    renderSidebar();
    renderChart();
    renderDetailPanel();
    renderTable();
    updateLeakDashCard();
  }

  // Tổng quan cho ô "Leak Test Packages" ở Dashboard Zone 1: Done (đã test xong) / tổng + %.
  function _leakSummary() {
    if (state.leakRows && state.leakRows.length) {
      var done = state.leakRows.filter(function (r) { return r.testingDone; }).length;
      return { done: done, total: state.leakRows.length, pct: _pct(done, state.leakRows.length) };
    }
    var d = window.LEAK_TEST_DATA;
    if (d && d.length) {
      var dn = d.filter(function (lt) { return _testingDone(lt.testing); }).length;
      return { done: dn, total: d.length, pct: _pct(dn, d.length) };
    }
    return null;
  }
  window.LeakTestSummary = _leakSummary;

  function updateLeakDashCard() {
    var s = _leakSummary(); if (!s) return;
    var val = document.getElementById('z1-leak-val');
    var pctEl = document.getElementById('z1-leak-pct');
    var bar = document.getElementById('z1-leak-bar');
    var note = document.getElementById('z1-leak-note');
    if (val) val.textContent = s.done.toLocaleString() + ' / ' + s.total.toLocaleString();
    if (pctEl) { pctEl.style.display = ''; pctEl.textContent = s.pct + '%'; pctEl.className = 'stat-pct ' + (window.pctClass ? window.pctClass(s.pct) : ''); }
    if (bar) { if (bar.parentElement) bar.parentElement.style.display = ''; bar.style.width = s.pct + '%'; }
    if (note) note.style.display = 'none';
  }
  window.updateLeakDashCard = updateLeakDashCard;

  // Bảo đảm ô Dashboard "Leak Test Packages" có số liệu NGAY cả khi CHƯA mở tab Leak Test.
  // Chỉ cần total (số gói) + done (testing) -> nhẹ: dùng LEAK_TEST_DATA tĩnh nếu có; nếu chưa,
  // tự sinh demo từ danh sách Hydrotest (hydroMap) — KHÔNG cần build flange/punch/PrecomDB.
  var _ensuredLeak = false;
  function ensureLeakSummaryData() {
    if (window.LEAK_TEST_DATA && window.LEAK_TEST_DATA.length) { updateLeakDashCard(); return; }
    if (state.leakRows && state.leakRows.length) { updateLeakDashCard(); return; }
    if (_ensuredLeak) return; _ensuredLeak = true;
    (window.LocalDB && window.LocalDB.ready ? window.LocalDB.ready() : Promise.resolve())
      .then(function () { return _loadHydroMap(); })
      .then(function (hm) {
        state.hydroMap = state.hydroMap || hm;
        if ((!window.LEAK_TEST_DATA || !window.LEAK_TEST_DATA.length) && state.hydroMap && state.hydroMap.size) {
          window.LEAK_TEST_DATA = _demoFromHydro();
        }
        updateLeakDashCard();   // _leakSummary đọc LEAK_TEST_DATA (total + testingDone)
      }).catch(function () { _ensuredLeak = false; });
  }
  window.ensureLeakSummaryData = ensureLeakSummaryData;

  // Sidebar: BẢNG theo Subsystem — cột System / System No / Subsystem No / Test pack (Done/Total + %).
  // Test pack Done = số leak test đã test xong (Testing done) trong subsystem đó. Gom O(n) bằng Map.
  function renderSidebar() {
    var el = document.getElementById('lt-sidebar-body'); if (!el) return;
    var groups = new Map();
    state.leakRows.forEach(function (r) {
      if (!groups.has(r.subsystemNo)) groups.set(r.subsystemNo, { system: r.system, systemNo: r.systemNo, subNo: r.subsystemNo, rows: [] });
      groups.get(r.subsystemNo).rows.push(r);
    });
    var body = '';
    groups.forEach(function (g) {
      var done = g.rows.filter(function (x) { return x.testingDone; }).length;
      var tot = g.rows.length;
      var active = state.subsystemFilter === g.subNo ? ' selected-row' : '';
      body += '<tr class="lt-sub-row' + active + '" data-sub="' + _esc(g.subNo) + '">' +
        '<td>' + _esc(g.system) + '</td>' +
        '<td class="text-center">' + _esc(g.systemNo) + '</td>' +
        '<td class="text-center">' + _esc(g.subNo) + '</td>' +
        _fracCell(done, tot, 'hydro-bar') +
        '</tr>';
    });
    el.innerHTML = tot0(groups) ? (
      '<table class="summary-table lt-sidebar-table"><thead><tr>' +
      '<th>System</th><th class="text-center">System No</th><th class="text-center">Subsystem No</th>' +
      '<th class="text-center" title="Số Leak Test đã test xong / tổng của subsystem">Test pack</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>'
    ) : '<div class="lt-empty">Chưa có dữ liệu Leak Test.</div>';
    el.querySelectorAll('.lt-sub-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var s = tr.getAttribute('data-sub');
        state.subsystemFilter = (state.subsystemFilter === s) ? '' : s;   // toggle
        renderAll();
      });
    });
  }
  function tot0(map) { return map && map.size > 0; }

  // Pie chart tổng quan Ready vs Pending; click slice -> lọc panel detail (Ready/Pending), click lại = bỏ.
  function renderChart() {
    var canvas = document.getElementById('lt-pie-chart'); if (!canvas || !window.Chart) return;
    var ready = state.filtered.filter(function (r) { return r.readiness; }).length;
    var pending = state.filtered.length - ready;
    if (state.pieChart) state.pieChart.destroy();
    state.pieChart = new window.Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Ready for test', 'Pending'],
        datasets: [{ data: [ready, pending], backgroundColor: ['#10b981', '#475569'], borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        onClick: function (e, els) {
          if (els && els.length) {
            var sel = els[0].index === 0 ? 'ready' : 'pending';
            state.chartSel = (state.chartSel === sel) ? null : sel;
          } else { state.chartSel = null; }
          renderDetailPanel();
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { size: 11 } } },
          datalabels: { color: '#fff', font: { weight: '700', size: 13 }, formatter: function (v) { return v || ''; } }
        }
      }
    });
  }

  // Panel detail bên phải biểu đồ: summary Ready/Pending + % + breakdown ITR-A / Punch A / Flange.
  // Phạm vi = state.filtered, thu hẹp theo slice đang chọn (state.chartSel).
  function renderDetailPanel() {
    var el = document.getElementById('lt-detail-panel'); if (!el) return;
    var scope = state.filtered;
    if (state.chartSel === 'ready') scope = scope.filter(function (r) { return r.readiness; });
    else if (state.chartSel === 'pending') scope = scope.filter(function (r) { return !r.readiness; });
    var label = state.chartSel === 'ready' ? 'Ready for test' : state.chartSel === 'pending' ? 'Pending' : 'Tất cả';

    var ltTotal = scope.length;
    var ltReady = scope.filter(function (r) { return r.readiness; }).length;
    // Breakdown TỔNG HỢP (khớp đúng cột bảng): cộng dồn số done/total, KHÔNG đếm theo điều kiện boolean.
    var pkgTot = 0, itDone = 0, itTot = 0, puCl = 0, puTot = 0, flDone = 0, flTot = 0, puSeen = {};
    scope.forEach(function (r) {
      pkgTot += r.members.length;
      if (r.punchSubsysKey && !puSeen[r.punchSubsysKey]) { puSeen[r.punchSubsysKey] = 1; puCl += r.punchClosed; puTot += r.punchTotal; }
      flDone += r.flangeDone; flTot += r.flangeTotal;
      r.members.forEach(function (m) { itDone += m.ev.sheetDone; itTot += m.ev.sheetTotal; });
    });
    function stat(lbl, d, t) {
      var p = _pct(d, t);
      return '<div class="lt-stat">' +
        '<span class="lt-stat-label">' + lbl + '</span>' +
        '<span class="lt-stat-val"><b>' + d + '/' + t + '</b> <span class="percentage-text ' + _pctBand(p) + '">' + p + '%</span></span>' +
        '<span class="lt-stat-bar"><span class="lt-stat-fill ' + _pctBand(p) + '" style="width:' + p + '%"></span></span>' +
        '</div>';
    }
    el.innerHTML =
      '<div class="lt-detail-head">' + _esc(label) +
        (state.chartSel ? ' <button id="lt-detail-clear" class="lt-detail-clear" title="Bỏ chọn">&times;</button>' : '') + '</div>' +
      stat('Leak Test Ready', ltReady, ltTotal) +
      '<div class="lt-detail-sub">Theo ' + pkgTot + ' gói Hydrotest</div>' +
      stat('ITR-A', itDone, itTot) +
      stat('Punch A closed', puCl, puTot) +
      stat('Flange done', flDone, flTot);
    var clr = document.getElementById('lt-detail-clear');
    if (clr) clr.addEventListener('click', function () { state.chartSel = null; renderDetailPanel(); });
  }

  function badge(ok) { return ok ? '<span class="lt-chip ok">✓</span>' : '<span class="lt-chip no">–</span>'; }

  function renderTable() {
    var tb = document.getElementById('lt-table-body'); if (!tb) return;
    if (!state.filtered.length) {
      tb.innerHTML = '<tr><td colspan="9" class="lt-empty" style="padding:2rem;">Không có Leak Test nào khớp bộ lọc.</td></tr>';
      return;
    }
    var rows = state.filtered.map(function (r, idx) {
      var readyCell = r.readiness
        ? '<span class="lt-ready-badge">Ready</span>' : '';
      return '<tr class="lt-row" data-idx="' + idx + '">' +
        '<td class="text-center">' + (idx + 1) + '</td>' +
        '<td><strong>' + _esc(r.leakTestNo) + '</strong><div class="lt-sub-tag">' + _esc(r.subsystem) + '</div></td>' +
        _fracCell(r.readyCount, r.totalCount, 'weld-bar') +      // Sum Hydrotest: ready/total
        _fracCell(r.punchClosed, r.punchTotal, 'hydro-bar') +    // Punch A: closed/total
        _fracCell(r.flangeDone, r.flangeTotal, 'ndt-bar') +      // Flange management: done/total
        '<td class="text-center">' + readyCell + '</td>' +
        '<td class="text-center">' + (r.planStart || '-') + '</td>' +
        '<td class="text-center">' + (r.finishDate || '-') + '</td>' +
        '<td class="text-center">' + (r.testing || '-') + '</td>' +
        '</tr>';
    }).join('');
    tb.innerHTML = rows;
    tb.querySelectorAll('.lt-row').forEach(function (tr) {
      tr.addEventListener('click', function () { openModal(state.filtered[+tr.getAttribute('data-idx')]); });
    });
  }
  function _pctCls(p) { return p >= 100 ? 'p-done' : p >= 50 ? 'p-mid' : 'p-low'; }
  // Màu % theo band giống Testing Status: >=80 xanh, 40-79 vàng, <40 đỏ.
  var _pctBand = window.pctClass || function (p) { return p >= 80 ? 'pct-high' : p >= 40 ? 'pct-mid' : 'pct-low'; };
  // Ô <td> chuẩn "done/total" + % + thanh gradient màu — DÙNG LẠI class của Testing Status.
  // barClass: 'weld-bar'(xanh dương) | 'ndt-bar'(tím) | 'hydro-bar'(xanh lá) | 'reinst-bar'(cam).
  function _fracCell(done, total, barClass) {
    if (!total || total <= 0) return '<td class="text-center"><span class="hydro-dash">-</span></td>';
    var p = _pct(done, total);
    return '<td class="data-bar-cell ' + (barClass || 'ndt-bar') + '" style="--pct: ' + p + '%">' +
      '<div class="progress-cell-wrapper">' +
      '<span class="fraction-text">' + done + '/' + total + '</span>' +
      '<span class="percentage-text ' + _pctBand(p) + '">' + p + '%</span>' +
      '</div></td>';
  }

  /* ------------------------------ Modal --------------------------------- */
  function openModal(r) {
    var modal = document.getElementById('leaktest-detail-modal');
    var body = document.getElementById('lt-modal-body');
    var title = document.getElementById('lt-modal-title');
    if (!modal || !body) return;
    state.modalRow = r;
    title.textContent = r.leakTestNo + '  —  ' + r.subsystem + '  (' + r.readyCount + '/' + r.totalCount + ' ready)';
    var rowsHtml = r.members.map(function (m, i) {
      var ev = m.ev;
      var miss = ev.missing ? ' <small style="color:#f59e0b;">(no data)</small>' : '';
      return '<tr class="lt-hpkg-row" data-i="' + i + '" title="Click xem chi tiết ITR-A / Punch A / Flange">' +
        '<td class="text-center">' + (i + 1) + '</td>' +
        '<td><strong>' + _esc(m.testPackageNo) + '</strong>' + miss + '</td>' +
        _fracCell(ev.sheetDone, ev.sheetTotal, 'weld-bar') +                        // ITR-A: done/5
        _fracCell(ev.punchATotal - ev.punchAOpen, ev.punchATotal, 'hydro-bar') +   // Punch A: closed/total
        _fracCell(ev.flangeDone, ev.flangeTotal, 'ndt-bar') +                      // Flange: done/total
        '<td class="text-center">' + (ev.ready ? '<span class="lt-ready-badge">Ready</span>' : '') + '</td>' +
        '</tr>';
    }).join('');
    body.innerHTML =
      '<table class="lt-modal-table"><thead><tr>' +
      '<th>#</th><th>Hydrotest No</th>' +
      '<th title="Số checksheet ITR-A (P02A/Flushing/P03A/P04A/P05A) đã done / 5">ITR-A</th>' +
      '<th title="Punch A đã Closed / tổng Punch A">Punch A</th>' +
      '<th title="Flange joint đã Done / tổng">Flange</th><th>Ready</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    modal.style.display = 'flex';
    // Click 1 gói Hydrotest -> mở modal cấp 2 (drill-down chi tiết).
    body.querySelectorAll('.lt-hpkg-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var mm = r.members[+tr.getAttribute('data-i')];
        if (mm) openPkgModal(mm.testPackageNo, mm.ev.pkg);
      });
    });
  }
  function closeModal() { var m = document.getElementById('leaktest-detail-modal'); if (m) m.style.display = 'none'; }

  /* ------- Drill-down modal cấp 2: liệt kê CHI TIẾT ITR-A / Punch A / Flange 1 gói ------- */
  var _punchColCache = null;
  function _punchCols() {
    if (_punchColCache) return _punchColCache;
    _punchColCache = { sub: null, cat: null, st: null, disc: null };
    try {
      var cols = window.PrecomDB.query('PRAGMA table_info(punch_list)').map(function (c) { return c.name; });
      _punchColCache = {
        sub: _pick(cols, ['subsystem', 'sub_system', 'subsystem_no', 'subsys']),
        cat: _pick(cols, ['category', 'cat']),
        st: _pick(cols, ['status']),
        disc: _pick(cols, ['discipline', 'disc'])
      };
    } catch (e) {}
    return _punchColCache;
  }
  // Liệt kê punch A (Piping) của SUBSYSTEM chứa gói hydrotest tp.
  function _punchRowsFor(tp) {
    if (!window.PrecomDB || !(window.PrecomDB.loaded && window.PrecomDB.loaded())) return [];
    var c = _punchCols(); if (!c.sub || !c.cat || !c.st) return [];
    var key = _subsysKeyFromTP(tp); if (!key) return [];
    var discCl = c.disc ? " AND UPPER(TRIM(" + c.disc + ")) LIKE 'PIP%'" : "";
    try {
      return window.PrecomDB.query(
        "SELECT * FROM punch_list WHERE UPPER(TRIM(" + c.sub + "))=? AND UPPER(TRIM(" + c.cat + "))='A'" + discCl + " " +
        "ORDER BY (UPPER(TRIM(" + c.st + "))='CLOSED')", [key]);
    } catch (e) { return []; }
  }
  function _flangeRowsFor(tp) {
    if (!window.LocalDB) return [];
    try {
      return window.LocalDB.query(
        "SELECT spool_no, flange_joint_no, flange_size, flange_rating, flange_type, assembled_date, tightened_date " +
        "FROM flange_joints WHERE UPPER(TRIM(test_package_no))=UPPER(TRIM(?)) ORDER BY spool_no, flange_joint_no", [tp]);
    } catch (e) { return []; }
  }
  function _fmtD(v) { return (window.formatDate && v) ? window.formatDate(v) : (v || ''); }

  var SHEET_DEFS = [
    ['Sign P02A', 'signP02A'], ['Flushing', 'flushing'], ['Sign P03A', 'signP03A'],
    ['Sign P04A', 'signP04A'], ['Sign P05A', 'signP05A']
  ];

  function openPkgModal(tp, pkg) {
    pkg = pkg || {};
    var modal = document.getElementById('leaktest-pkg-modal');
    var body = document.getElementById('lt-pkg-modal-body');
    var title = document.getElementById('lt-pkg-modal-title');
    if (!modal || !body) return;
    state.pkgModalTp = tp; state.pkgModalPkg = pkg;
    title.textContent = 'Hydrotest ' + tp + ' — chi tiết ITR-A / Punch A / Flange';

    // 1) ITR-A: 5 checksheet.
    var itraDone = 0;
    var itraRows = SHEET_DEFS.map(function (d, i) {
      var v = pkg[d[1]]; var ok = String(v == null ? '' : v).trim() !== ''; if (ok) itraDone++;
      return '<tr><td class="text-center">' + (i + 1) + '</td><td>' + d[0] + '</td>' +
        '<td class="text-center">' + (_fmtD(v) || '-') + '</td>' +
        '<td class="text-center">' + (ok ? '<span class="lt-chip ok">✓</span>' : '<span class="lt-chip no">–</span>') + '</td></tr>';
    }).join('');

    // 2) Punch A (từ PrecomDB).
    var pr = _punchRowsFor(tp);
    var puClosed = pr.filter(function (r) { return String(r.status || '').trim().toUpperCase() === 'CLOSED'; }).length;
    var puRows = pr.length ? pr.map(function (r, i) {
      var cl = String(r.status || '').trim().toUpperCase() === 'CLOSED';
      return '<tr><td class="text-center">' + (i + 1) + '</td>' +
        '<td><strong>' + _esc(r.punch_no || r.punch_raised_no || '') + '</strong></td>' +
        '<td class="text-center">' + _esc(r.discipline || '') + '</td>' +
        '<td class="wrap">' + _esc(r.description || r.defect_description || '') + '</td>' +
        '<td class="text-center">' + (cl ? '<span class="lt-chip ok">Closed</span>' : '<span class="lt-chip no">Open</span>') + '</td>' +
        '<td class="text-center">' + _fmtD(r.closed_date) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="lt-empty" style="padding:1rem;">Không có Punch A cho gói này.</td></tr>';

    // 3) Flange (từ LocalDB).
    var fr = _flangeRowsFor(tp);
    var flDone = fr.filter(function (r) { return String(r.tightened_date || '').trim() !== ''; }).length;
    var flRows = fr.length ? fr.map(function (r, i) {
      var dn = String(r.tightened_date || '').trim() !== '';
      return '<tr><td class="text-center">' + (i + 1) + '</td>' +
        '<td class="wrap"><strong>' + _esc(r.spool_no || '') + '</strong></td>' +
        '<td class="text-center">' + _esc(r.flange_joint_no || '') + '</td>' +
        '<td class="text-center">' + _esc(r.flange_size || '') + '</td>' +
        '<td class="text-center">' + _esc(r.flange_rating || '') + '</td>' +
        '<td class="text-center">' + _esc(r.flange_type || '') + '</td>' +
        '<td class="text-center">' + _fmtD(r.assembled_date) + '</td>' +
        '<td class="text-center">' + (dn ? '<span style="color:#10b981;font-weight:700;white-space:nowrap;">' + _fmtD(r.tightened_date) + '</span>' : '<span style="color:#94a3b8;">–</span>') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="lt-empty" style="padding:1rem;">Không có Flange joint cho gói này.</td></tr>';

    body.innerHTML =
      '<h4 class="lt-sec-h">ITR-A checksheet (' + itraDone + '/5 done)</h4>' +
      '<table class="lt-modal-table"><thead><tr><th>#</th><th>Checksheet</th><th>Ngày</th><th>Status</th></tr></thead><tbody>' + itraRows + '</tbody></table>' +
      '<h4 class="lt-sec-h">Punch A (' + puClosed + '/' + pr.length + ' closed)</h4>' +
      '<table class="lt-modal-table"><thead><tr><th>#</th><th>Punch No</th><th>Discipline</th><th class="wrap">Mô tả</th><th>Status</th><th>Closed date</th></tr></thead><tbody>' + puRows + '</tbody></table>' +
      '<h4 class="lt-sec-h">Flange (' + flDone + '/' + fr.length + ' tightened)</h4>' +
      '<table class="lt-modal-table"><thead><tr><th>#</th><th class="wrap">Spool</th><th>Flange</th><th>Size</th><th>Rating</th><th>Type</th><th>Assembled</th><th>Tightened</th></tr></thead><tbody>' + flRows + '</tbody></table>';
    modal.style.display = 'flex';
  }
  function closePkgModal() { var m = document.getElementById('leaktest-pkg-modal'); if (m) m.style.display = 'none'; }

  /* ------------------------------ Export (ExcelJS, có màu) ------------------ */
  function _ts() {
    var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + 'h' + p(d.getMinutes());
  }
  function _safe(s) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }
  var _XL_THIN = { top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  function _pctColor(v) { return v >= 1 ? { fill: 'FFE2F0D9', font: 'FF385723' } : v >= 0.4 ? { fill: 'FFFFF2CC', font: 'FF7F6000' } : { fill: 'FFFCE4D6', font: 'FFC65911' }; }

  // sheets: [{ name, columns:[{header,key,width,type:'pct'|'status'|undefined}], rows:[obj] }]
  function _ltExport(sheets, filename) {
    if (typeof ExcelJS === 'undefined') { alert('Thư viện ExcelJS chưa sẵn sàng, thử lại sau vài giây.'); return; }
    var wb = new ExcelJS.Workbook();
    sheets.forEach(function (sh) {
      var ws = wb.addWorksheet((sh.name || 'Sheet').substr(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = sh.columns.map(function (c) { return { header: c.header, key: c.key, width: c.width || 14 }; });
      sh.rows.forEach(function (r) { ws.addRow(r); });
      ws.getRow(1).eachCell(function (cell) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.border = _XL_THIN; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      ws.eachRow({ includeEmpty: false }, function (row, rn) {
        if (rn === 1) return;
        row.eachCell(function (cell, cn) {
          var col = sh.columns[cn - 1]; cell.border = _XL_THIN;
          cell.alignment = { vertical: 'middle', horizontal: (col && col.type) ? 'center' : 'left', wrapText: true };
          cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF334155' } };
          if (col && col.type === 'pct') {
            var v = +cell.value || 0; cell.numFmt = '0%'; var c = _pctColor(v);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } };
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: c.font } };
          } else if (col && col.type === 'status') {
            var s = String(cell.value || '').toUpperCase(); var ok = s === 'CLOSED' || s === 'DONE' || s === 'READY';
            var c2 = (s === '' || s === '-') ? { fill: 'FFF3F4F6', font: 'FF6B7280' } : (ok ? { fill: 'FFE2F0D9', font: 'FF385723' } : { fill: 'FFFCE4D6', font: 'FFC65911' });
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c2.fill } };
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: c2.font } };
          }
        });
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sh.columns.length } };
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
    });
  }

  // (A) Bảng chính — export đúng dòng đang hiển thị; tên file phản ánh bộ lọc + ngày giờ.
  function exportVisible() {
    var data = state.filtered;
    if (!data.length) { alert('Không có dòng nào để export.'); return; }
    var cols = [
      { header: 'No', key: 'no', width: 5 }, { header: 'Leak Test No', key: 'lt', width: 16 },
      { header: 'System', key: 'sys', width: 8 }, { header: 'System No', key: 'sysno', width: 9 }, { header: 'Subsystem No', key: 'subno', width: 13 },
      { header: 'Sum Hydrotest', key: 'sum', width: 13 }, { header: '% Ready', key: 'rpct', width: 9, type: 'pct' },
      { header: 'Punch A', key: 'pu', width: 12 }, { header: '% Punch A', key: 'ppct', width: 10, type: 'pct' },
      { header: 'Flange', key: 'fl', width: 12 }, { header: '% Flange', key: 'fpct', width: 9, type: 'pct' },
      { header: 'Readiness', key: 'ready', width: 11, type: 'status' },
      { header: 'Plan Start', key: 'pstart', width: 12 }, { header: 'Days', key: 'days', width: 6 }, { header: 'Finish Date', key: 'finish', width: 12 },
      { header: 'Testing', key: 'testing', width: 10 }
    ];
    var rows = data.map(function (r, i) {
      return { no: i + 1, lt: r.leakTestNo, sys: r.system, sysno: r.systemNo, subno: r.subsystemNo,
        sum: r.readyCount + '/' + r.totalCount, rpct: r.readyPct / 100,
        pu: r.punchClosed + '/' + r.punchTotal, ppct: r.punchPct / 100,
        fl: r.flangeDone + '/' + r.flangeTotal, fpct: r.flangePct / 100,
        ready: r.readiness ? 'Ready' : '', pstart: r.planStart || '', days: (r.days != null ? r.days : ''), finish: r.finishDate || '', testing: r.testing || '' };
    });
    var parts = ['LeakTest'];
    if (state.subsystemFilter) parts.push(_safe(state.subsystemFilter));
    if (state.readinessFilter !== 'all') parts.push(state.readinessFilter);
    if (state.chartSel) parts.push(state.chartSel);
    if (state.searchQuery) parts.push('find-' + _safe(state.searchQuery));
    if (parts.length === 1) parts.push('All');
    _ltExport([{ name: 'Leak Test', columns: cols, rows: rows }], parts.join('_') + '_' + _ts() + '.xlsx');
  }

  // (B) Modal cấp 1 — export các gói Hydrotest của 1 Leak Test.
  function exportModalMembers() {
    var r = state.modalRow; if (!r) return;
    var cols = [
      { header: '#', key: 'no', width: 5 }, { header: 'Hydrotest No', key: 'tp', width: 24 },
      { header: 'ITR-A', key: 'it', width: 8 }, { header: '% ITR-A', key: 'itp', width: 9, type: 'pct' },
      { header: 'Punch A', key: 'pu', width: 8 }, { header: '% Punch A', key: 'pup', width: 10, type: 'pct' },
      { header: 'Flange', key: 'fl', width: 8 }, { header: '% Flange', key: 'flp', width: 9, type: 'pct' },
      { header: 'Ready', key: 'ready', width: 9, type: 'status' }
    ];
    var rows = r.members.map(function (m, i) {
      var e = m.ev;
      return { no: i + 1, tp: m.testPackageNo,
        it: e.sheetDone + '/' + e.sheetTotal, itp: (e.sheetTotal ? e.sheetDone / e.sheetTotal : 0),
        pu: (e.punchATotal - e.punchAOpen) + '/' + e.punchATotal, pup: (e.punchATotal ? (e.punchATotal - e.punchAOpen) / e.punchATotal : 0),
        fl: e.flangeDone + '/' + e.flangeTotal, flp: (e.flangeTotal ? e.flangeDone / e.flangeTotal : 0),
        ready: e.ready ? 'Ready' : '' };
    });
    _ltExport([{ name: 'LeakTest members', columns: cols, rows: rows }],
      'LeakTest_' + _safe(r.leakTestNo) + '_members_' + _ts() + '.xlsx');
  }

  // (C) Modal cấp 2 — export chi tiết ITR-A / Punch A / Flange của 1 gói Hydrotest (3 sheet).
  function exportPkgDetail() {
    var tp = state.pkgModalTp, pkg = state.pkgModalPkg || {}; if (!tp) return;
    var itra = { name: 'ITR-A', columns: [
      { header: '#', key: 'no', width: 5 }, { header: 'Checksheet', key: 'cs', width: 22 },
      { header: 'Ngày', key: 'd', width: 16 }, { header: 'Status', key: 'st', width: 12, type: 'status' }
    ], rows: SHEET_DEFS.map(function (d, i) {
      var v = pkg[d[1]]; var ok = String(v == null ? '' : v).trim() !== '';
      return { no: i + 1, cs: d[0], d: _fmtD(v) || '', st: ok ? 'Done' : '' };
    }) };
    var pr = _punchRowsFor(tp);
    var punch = { name: 'Punch A', columns: [
      { header: '#', key: 'no', width: 5 }, { header: 'Punch No', key: 'pn', width: 14 },
      { header: 'Discipline', key: 'disc', width: 12 }, { header: 'Mô tả', key: 'desc', width: 55 },
      { header: 'Status', key: 'st', width: 10, type: 'status' }, { header: 'Closed Date', key: 'cd', width: 14 }
    ], rows: pr.map(function (r, i) {
      return { no: i + 1, pn: r.punch_no || r.punch_raised_no || '', disc: r.discipline || '',
        desc: r.description || r.defect_description || '', st: (String(r.status || '').toUpperCase() === 'CLOSED' ? 'Closed' : 'Open'), cd: _fmtD(r.closed_date) };
    }) };
    var fr = _flangeRowsFor(tp);
    var flange = { name: 'Flange', columns: [
      { header: '#', key: 'no', width: 5 }, { header: 'Spool', key: 'sp', width: 30 },
      { header: 'Flange', key: 'fj', width: 10 }, { header: 'Size', key: 'sz', width: 8 }, { header: 'Rating', key: 'rt', width: 9 },
      { header: 'Type', key: 'ty', width: 8 }, { header: 'Assembled', key: 'as', width: 14 },
      { header: 'Tightened', key: 'ti', width: 14 }, { header: 'Status', key: 'st', width: 10, type: 'status' }
    ], rows: fr.map(function (r, i) {
      var dn = String(r.tightened_date || '').trim() !== '';
      return { no: i + 1, sp: r.spool_no || '', fj: r.flange_joint_no || '', sz: r.flange_size || '', rt: r.flange_rating || '',
        ty: r.flange_type || '', as: _fmtD(r.assembled_date), ti: _fmtD(r.tightened_date), st: dn ? 'Done' : '' };
    }) };
    _ltExport([itra, punch, flange], 'Hydrotest_' + _safe(tp) + '_detail_' + _ts() + '.xlsx');
  }

  /* ---------------------------------------------------------------------- *
   * 5. INIT — lazy, gọi 1 lần khi mở tab (giống PrecomInit).
   * ---------------------------------------------------------------------- */
  function wireControls() {
    var s = document.getElementById('lt-search');
    if (s) s.addEventListener('input', function () { state.searchQuery = this.value.trim().toLowerCase(); renderAll(); });
    var rf = document.getElementById('lt-readiness-filter');
    if (rf) rf.addEventListener('change', function () { state.readinessFilter = this.value; renderAll(); });
    var clr = document.getElementById('lt-clear-btn');
    if (clr) clr.addEventListener('click', function () {
      state.searchQuery = ''; state.subsystemFilter = ''; state.readinessFilter = 'all'; state.chartSel = null;
      if (s) s.value = ''; if (rf) rf.value = 'all'; renderAll();
    });
    var ex = document.getElementById('lt-export-btn');
    if (ex) ex.addEventListener('click', exportVisible);
    var mc = document.getElementById('lt-modal-close'); if (mc) mc.addEventListener('click', closeModal);
    var mb = document.getElementById('leaktest-detail-modal');
    if (mb) mb.addEventListener('click', function (e) { if (e.target === mb) closeModal(); });
    var pc = document.getElementById('lt-pkg-modal-close'); if (pc) pc.addEventListener('click', closePkgModal);
    var pb = document.getElementById('leaktest-pkg-modal');
    if (pb) pb.addEventListener('click', function (e) { if (e.target === pb) closePkgModal(); });
    var me = document.getElementById('lt-modal-export'); if (me) me.addEventListener('click', exportModalMembers);
    var pe = document.getElementById('lt-pkg-modal-export'); if (pe) pe.addEventListener('click', exportPkgDetail);
  }

  window.LeakTestInit = function () {
    if (state.loaded) return;
    state.loaded = true;
    wireControls();
    var body = document.getElementById('lt-table-body');
    if (body) body.innerHTML = '<tr><td colspan="9" class="lt-empty" style="padding:2rem;"><div class="loading-spinner-small"></div><p style="margin-top:.6rem;">Đang dựng lookup Maps…</p></td></tr>';
    buildLeakTestLookupMap().then(function () {
      // DEMO: chưa nạp LEAK_TEST_DATA thật -> tự gom Hydrotest theo prefix system để test UI.
      // Xoá/không dùng khi đã có window.LEAK_TEST_DATA thật.
      if (!window.LEAK_TEST_DATA || !window.LEAK_TEST_DATA.length) {
        window.LEAK_TEST_DATA = _demoFromHydro();
        console.warn('[LeakTest] Dùng DEMO data (' + window.LEAK_TEST_DATA.length + ' gói) — thay bằng window.LEAK_TEST_DATA thật rồi gọi LeakTestReload().');
      }
      state.leakRows = computeLeakRows();
      renderAll();
    }).catch(function (e) {
      console.error('[LeakTest] init fail:', e);
      if (body) body.innerHTML = '<tr><td colspan="9" class="lt-empty" style="padding:2rem;color:#f43f5e;">Lỗi tải dữ liệu Leak Test.</td></tr>';
    });
  };

  // Cho phép nạp/đổi dữ liệu tĩnh rồi vẽ lại mà không rebuild Map.
  window.LeakTestReload = function (data) {
    if (Array.isArray(data)) window.LEAK_TEST_DATA = data;
    if (!state.evalMap) { state.loaded = false; window.LeakTestInit(); return; }
    state.leakRows = computeLeakRows(); renderAll();
  };

  // DEMO generator: gom các Hydrotest package thật thành Leak Test ảo (theo system),
  // mỗi Leak Test tối đa 4 gói. Chỉ để test giao diện khi chưa có dữ liệu tĩnh.
  function _demoFromHydro() {
    var bySys = new Map();
    state.hydroMap.forEach(function (pkg) {
      var sys = String(pkg.system || 'NA').trim() || 'NA';
      if (!bySys.has(sys)) bySys.set(sys, []);
      bySys.get(sys).push(pkg.testPackageNo);
    });
    var out = [], n = 1;
    bySys.forEach(function (tps, sys) {
      for (var i = 0; i < tps.length; i += 4) {
        var chunk = tps.slice(i, i + 4);
        out.push({ leakTestNo: 'LT-' + sys + '-' + String(n++).padStart(3, '0'), subsystem: sys, testPackages: chunk });
      }
    });
    return out;
  }

  // Export cho test/console.
  window.LeakTestLogic = {
    buildLeakTestLookupMap: buildLeakTestLookupMap,
    computeLeakRows: computeLeakRows,
    _evalOf: _evalOf, state: state
  };

  // Nạp số liệu cho ô Dashboard "Leak Test Packages" sớm (deferred, không chặn khởi động).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(ensureLeakSummaryData, 1500); });
  else setTimeout(ensureLeakSummaryData, 1500);
})();
