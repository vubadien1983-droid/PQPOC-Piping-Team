/* local-first.js -- the data layer for the PQPOC-Piping-Team (local-first) build.
 *
 * Intercepts every /api/* request the app makes and answers it from the LOCAL SQLite
 * database (window.LocalDB, loaded by db-sqlite.js) -- so app.js runs UNCHANGED but with
 * zero cloud calls. The DB is installed to the device once (db-sqlite.js) and auto-updates.
 *
 * Load order in index.html: db-sqlite.js -> local-first.js -> app.js  (NOT precompute.js).
 */
(function () {
  'use strict';

  // ---- one-time data pull from the local SQLite ------------------------------
  // packages = the joints.js SUMMARY_QUERY (__ALL__) shape, computed locally from
  // testpack_summary (incl. empty-TP rows). daily = the s-curve. live = hydro/reinst from
  // test_packages (as-of-build; updated each upload). meta = app_meta.
  var PACKAGES_SQL =
    "SELECT s.test_package_no AS testPackageNo, s.system AS system, s.spools_count AS spoolsCount," +
    " s.total_joints AS totalJoints, s.weld_done AS weldingDoneCount, s.fitup_done AS fitupDoneCount," +
    " s.is_non_metallic AS isNonMetallic, s.non_metallic_material AS nonMetallicMaterial," +
    " (s.rt_req+s.paut_req+s.mt_req+s.pt_req) AS ndtRequiredCount," +
    " (s.rt_done+s.paut_done+s.mt_done+s.pt_done) AS ndtDoneCount," +
    " s.rt_req AS rtRequiredCount, s.rt_done AS rtDoneCount, s.paut_req AS pautRequiredCount," +
    " s.paut_done AS pautDoneCount, s.mt_req AS mtRequiredCount, s.mt_done AS mtDoneCount," +
    " s.pt_req AS ptRequiredCount, s.pt_done AS ptDoneCount, s.pmi_req AS pmiRequiredCount," +
    " s.pmi_done AS pmiDoneCount, s.pwht_req AS pwhtRequiredCount, s.pwht_done AS pwhtDoneCount," +
    " s.hardness_req AS hardnessRequiredCount, s.hardness_done AS hardnessDoneCount," +
    " CASE WHEN TRIM(COALESCE(tp.hydro_test,''))<>'' THEN 'Done' ELSE '' END AS hydroStatus," +
    " NULLIF(TRIM(COALESCE(tp.hydro_test,'')),'') AS hydroDate," +
    " CASE WHEN TRIM(COALESCE(tp.reinstatement,''))<>'' THEN 'Done' ELSE '' END AS reinstStatus," +
    " NULLIF(TRIM(COALESCE(tp.reinstatement,'')),'') AS reinstDate," +
    " tp.ready_for_hydrotest AS readyForHydrotest, tp.test_plan AS testPlan," +
    " tp.review_weld_sum AS reviewWeldSum, tp.line_check AS lineCheck, tp.sign_p02a AS signP02A," +
    " tp.flushing AS flushing, tp.sign_p03a AS signP03A, tp.sign_p04a AS signP04A," +
    " tp.bolting_completion AS boltingCompletion, tp.sign_p05a AS signP05A, tp.sign_p06a AS signP06A," +
    " tp.sign_p07a AS signP07A, tp.inspector AS inspector" +
    " FROM testpack_summary s LEFT JOIN test_packages tp ON s.test_package_no=tp.test_package_no" +
    " ORDER BY s.system, s.test_package_no";

  var _data = null;   // { packages, daily, live:{ok,list,map}, meta }
  var _origFetch = window.fetch.bind(window);   // native fetch (captured before we override below)
  // REAL-TIME hydro/reinst/note come from the LIVE NDT Google Sheet via the DB-free
  // view=live endpoint (CORS-enabled) -- a static GitHub Pages app can't fetch the sheet
  // directly (CORS), so it calls the Vercel function which fetches it server-side.
  var LIVE_URL = window.LIVE_API_URL ||
    'https://block-b-piping-fab.vercel.app/api/dashboard-summary?view=live';
  var _liveSig = null;   // signature of the last live payload, to detect sheet changes

  function loadData() {
    if (_data) return Promise.resolve(_data);
    return window.LocalDB.ready().then(function () {
      var packages = LocalDB.query(PACKAGES_SQL);
      var daily = LocalDB.query("SELECT day AS d, weld, rt, paut, mt, pt, ndt FROM daily_progress ORDER BY day");
      var meta = LocalDB.meta();
      // Dia-inch: project total, welded (Visual ACC), and per WELDING-day for the s-curve
      // (same date basis as Welding: welding_completed_date -> visual_report_date).
      var diaTotal = 0, weldedDia = 0, diaByDay = [];
      try {
        diaTotal = (LocalDB.query("SELECT SUM(CAST(dia_in AS REAL)) AS d FROM piping_data")[0] || {}).d || 0;
        weldedDia = (LocalDB.query("SELECT SUM(CAST(dia_in AS REAL)) AS d FROM piping_data WHERE UPPER(visual_acc)='ACC'")[0] || {}).d || 0;
        diaByDay = LocalDB.query(
          "SELECT day, SUM(dia) AS dia FROM (SELECT CASE" +
          " WHEN welding_completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN substr(welding_completed_date,1,10)" +
          " WHEN visual_report_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN substr(visual_report_date,1,10)" +
          " ELSE NULL END AS day, CAST(dia_in AS REAL) AS dia FROM piping_data WHERE UPPER(visual_acc)='ACC')" +
          " WHERE day IS NOT NULL GROUP BY day");
      } catch (e) {}
      // Offline fallback for hydro/reinst = the test_packages baked into the SQLite (as-of-build).
      var fallback = [];
      try {
        fallback = LocalDB.query("SELECT test_package_no AS testPackageNo, hydro_test AS hydro, reinstatement AS reinst FROM test_packages")
          .map(function (p) { return { testPackageNo: p.testPackageNo, hydro: p.hydro || '', reinst: p.reinst || '', note: '' }; });
      } catch (e) {}
      // Material Progress: per material, completion by JointNo AND by Dia-Inch.
      // done = Visual ACC (metallic = weld visual; non-metallic GRE/CPVC/PPR = bonding visual).
      var materialProgress = [], materialByDay = [];
      try {
        materialProgress = LocalDB.query(
          "SELECT UPPER(TRIM(material)) AS material," +
          " COUNT(*) AS total," +
          " COUNT(CASE WHEN UPPER(visual_acc)='ACC' THEN 1 END) AS done," +
          " SUM(CAST(dia_in AS REAL)) AS total_dia," +
          " SUM(CASE WHEN UPPER(visual_acc)='ACC' THEN CAST(dia_in AS REAL) ELSE 0 END) AS done_dia" +
          " FROM piping_data WHERE TRIM(COALESCE(material,'')) <> ''" +
          " GROUP BY UPPER(TRIM(material)) ORDER BY material"
        );
        // Per material, per WELDING-day: completed joints + completed dia (drives the s-curves).
        materialByDay = LocalDB.query(
          "SELECT material, day, COUNT(*) AS joints, SUM(dia) AS dia FROM (" +
          " SELECT UPPER(TRIM(material)) AS material, CAST(dia_in AS REAL) AS dia, CASE" +
          " WHEN welding_completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN substr(welding_completed_date,1,10)" +
          " WHEN visual_report_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN substr(visual_report_date,1,10)" +
          " ELSE NULL END AS day" +
          " FROM piping_data WHERE UPPER(visual_acc)='ACC' AND TRIM(COALESCE(material,'')) <> '')" +
          " WHERE day IS NOT NULL GROUP BY material, day"
        );
      } catch (e) {}
      // Pull the LIVE sheet (real-time); fall back to the SQLite copy if it fails (offline).
      // MUST use the native fetch (_origFetch) -- LIVE_URL contains "/api/", which our own
      // fetch override would otherwise intercept and answer from LocalDB.
      return _origFetch(LIVE_URL).then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (liveList) {
          if (liveList) _liveSig = JSON.stringify(liveList);
          var list = (liveList && liveList.length) ? liveList : fallback;
          var map = new Map();
          list.forEach(function (p) { map.set(String(p.testPackageNo).toUpperCase(), { hydro: p.hydro || '', reinst: p.reinst || '', note: p.note || '' }); });
          _data = { packages: packages, daily: daily, live: { ok: list.length > 0, list: list, map: map }, meta: meta, diaTotal: diaTotal, weldedDia: weldedDia, diaByDay: diaByDay, materialProgress: materialProgress, materialByDay: materialByDay };
          return _data;
        });
    });
  }

  // ---- builders (mirror the API shapes; same logic as precompute.js) ---------
  var COUNT_FIELDS = ['spoolsCount', 'totalJoints', 'weldingDoneCount', 'fitupDoneCount',
    'ndtRequiredCount', 'ndtDoneCount', 'rtRequiredCount', 'rtDoneCount', 'pautRequiredCount',
    'pautDoneCount', 'mtRequiredCount', 'mtDoneCount', 'ptRequiredCount', 'ptDoneCount',
    'pmiRequiredCount', 'pmiDoneCount', 'pwhtRequiredCount', 'pwhtDoneCount',
    'hardnessRequiredCount', 'hardnessDoneCount'];

  function hydroDone(p, live) { var v = live.map.get(String(p.testPackageNo).toUpperCase()); return live.ok ? !!(v && v.hydro) : p.hydroStatus === 'Done'; }
  function reinstDone(p, live) { var v = live.map.get(String(p.testPackageNo).toUpperCase()); return live.ok ? !!(v && v.reinst) : p.reinstStatus === 'Done'; }

  function buildPackages(sys, d) {
    var live = d.live, byTP = {};
    d.packages.forEach(function (p) {
      if (!p.testPackageNo) return;
      if (sys !== '__ALL__' && p.system !== sys) return;
      var g = byTP[p.testPackageNo];
      if (!g) { g = byTP[p.testPackageNo] = {}; for (var k in p) g[k] = p[k]; }
      else { COUNT_FIELDS.forEach(function (f) { g[f] = (g[f] || 0) + (p[f] || 0); }); g.isNonMetallic = g.isNonMetallic || p.isNonMetallic; }
    });
    return Object.keys(byTP).map(function (k) {
      var o = byTP[k]; o.joints = [];
      var v = live.ok ? live.map.get(String(o.testPackageNo).toUpperCase()) : null;
      o.hydroStatus = (v && v.hydro) ? 'Done' : (live.ok ? '' : o.hydroStatus);
      o.hydroDate = (v && v.hydro) ? v.hydro : (live.ok ? null : o.hydroDate);
      o.reinstStatus = (v && v.reinst) ? 'Done' : (live.ok ? '' : o.reinstStatus);
      o.reinstDate = (v && v.reinst) ? v.reinst : (live.ok ? null : o.reinstDate);
      o.note = (v && v.note) ? v.note : '';
      return o;
    }).sort(function (a, b) { return String(a.testPackageNo).localeCompare(String(b.testPackageNo)); });
  }

  function buildSystems(d) {
    var by = {}, live = d.live;
    d.packages.forEach(function (p) {
      var s = p.system || ''; if (!s) return;
      var g = by[s] || (by[s] = { system: s, weldingDone: 0, weldingTotal: 0, ndtDone: 0, ndtTotal: 0, hydrotestDone: 0, hydrotestTotal: 0, reinstDone: 0, reinstTotal: 0 });
      g.weldingDone += p.weldingDoneCount || 0; g.weldingTotal += p.totalJoints || 0;
      g.ndtDone += p.ndtDoneCount || 0; g.ndtTotal += p.ndtRequiredCount || 0;
      if (p.testPackageNo) { g.hydrotestTotal += 1; g.reinstTotal += 1; if (hydroDone(p, live)) g.hydrotestDone++; if (reinstDone(p, live)) g.reinstDone++; }
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  function buildTotals(d) {
    var live = d.live, s = { joints: 0, weldDone: 0, rt: { req: 0, done: 0 }, paut: { req: 0, done: 0 }, mt: { req: 0, done: 0 }, pt: { req: 0, done: 0 }, pmi: { req: 0, done: 0 }, pwht: { req: 0, done: 0 }, hardness: { req: 0, done: 0 } };
    var systems = {}, fab = new Set(), sh = 0, sr = 0;
    d.packages.forEach(function (p) {
      if (p.system) systems[p.system] = 1;
      if (p.testPackageNo) fab.add(String(p.testPackageNo).toUpperCase());
      s.joints += p.totalJoints || 0; s.weldDone += p.weldingDoneCount || 0;
      s.rt.req += p.rtRequiredCount || 0; s.rt.done += p.rtDoneCount || 0;
      s.paut.req += p.pautRequiredCount || 0; s.paut.done += p.pautDoneCount || 0;
      s.mt.req += p.mtRequiredCount || 0; s.mt.done += p.mtDoneCount || 0;
      s.pt.req += p.ptRequiredCount || 0; s.pt.done += p.ptDoneCount || 0;
      s.pmi.req += p.pmiRequiredCount || 0; s.pmi.done += p.pmiDoneCount || 0;
      s.pwht.req += p.pwhtRequiredCount || 0; s.pwht.done += p.pwhtDoneCount || 0;
      s.hardness.req += p.hardnessRequiredCount || 0; s.hardness.done += p.hardnessDoneCount || 0;
      if (p.testPackageNo && p.hydroStatus === 'Done') sh++;
      if (p.testPackageNo && p.reinstStatus === 'Done') sr++;
    });
    var tpTotal = fab.size, hd, rd, nif, st;
    if (live.ok) { hd = 0; rd = 0; nif = 0; live.list.forEach(function (p) { var up = String(p.testPackageNo).toUpperCase(); if (p.hydro) hd++; if (p.reinst && fab.has(up)) rd++; if (!fab.has(up)) nif++; }); st = live.list.length; }
    else { hd = sh; rd = sr; nif = 0; st = 0; }
    return { projectTotals: { systemCount: Object.keys(systems).length, joints: s.joints, weldDone: s.weldDone, rt: s.rt, paut: s.paut, ut: { req: 0, done: 0 }, mt: s.mt, pt: s.pt, pmi: s.pmi, pwht: s.pwht, hardness: s.hardness, tpTotal: tpTotal, hydro: { req: tpTotal, done: hd, notInFab: nif, sheetTotal: st, live: live.ok }, reinst: { req: tpTotal, done: rd }, diaInch: { done: d.weldedDia || 0, total: d.diaTotal || 0 }, materialProgress: d.materialProgress || [], leak: { req: tpTotal, done: 0, tracked: false } } };
  }

  function parseDate(str) {
    if (!str) return null; var s = String(str).trim(); if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) { var d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d; }
    var parts = s.split('/'); if (parts.length === 3) { var a = +parts[0], b = +parts[1], y = +parts[2]; if (y < 100) y += 2000; var mo, da; if (a > 12) { da = a; mo = b; } else { mo = a; da = b; } if (mo >= 1 && mo <= 12) { var d2 = new Date(y, mo - 1, da); return isNaN(d2) ? null : d2; } return null; }
    var fb = new Date(s); return isNaN(fb) ? null : fb;
  }

  function buildScurve(d) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    function key(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
    var todayKey = key(today), keyFor = function (dt) { return (dt && dt <= today) ? key(dt) : todayKey; };
    var F = ['weld', 'rt', 'paut', 'mt', 'pt', 'ndt', 'hydro', 'dia'], map = {}, matKeys = {};
    function bump(k, f, n) { if (!map[k]) map[k] = {}; map[k][f] = (map[k][f] || 0) + (n || 0); }
    d.daily.forEach(function (r) { bump(r.d, 'weld', +r.weld || 0); bump(r.d, 'rt', +r.rt || 0); bump(r.d, 'paut', +r.paut || 0); bump(r.d, 'mt', +r.mt || 0); bump(r.d, 'pt', +r.pt || 0); bump(r.d, 'ndt', +r.ndt || 0); });
    (d.live.ok ? d.live.list.map(function (p) { return p.hydro; }) : d.packages.map(function (p) { return p.hydroDate; }))
      .forEach(function (hv) { if (hv) { var dt = parseDate(hv); if (dt) bump(keyFor(dt), 'hydro', 1); } });
    // Dia-inch welded per day (same welding-date basis as the Welding s-curve).
    (d.diaByDay || []).forEach(function (r) { if (r.day) { var dt = parseDate(r.day); if (dt) bump(keyFor(dt), 'dia', r.dia || 0); } });
    // Per-material completed JointNo + Dia-Inch per day -> keys 'matj:<MAT>' and 'matd:<MAT>'.
    (d.materialByDay || []).forEach(function (r) {
      if (!r.material || !r.day) return;
      var dt = parseDate(r.day); if (!dt) return;
      var k = keyFor(dt), jk = 'matj:' + r.material, dk = 'matd:' + r.material;
      matKeys[jk] = 1; matKeys[dk] = 1;
      bump(k, jk, r.joints || 0); bump(k, dk, r.dia || 0);
    });
    var dates = Object.keys(map).sort(), deltas = {};
    F.concat(Object.keys(matKeys)).forEach(function (f) { deltas[f] = dates.map(function (x) { return (map[x] && map[x][f]) || 0; }); });
    return { today: todayKey, minDate: dates[0] || todayKey, dates: dates, deltas: deltas };
  }

  // ---- Database tab / drill-down / dropdowns (raw piping_data) ---------------
  var TP_COLS = ['skyline', 'test_plan', 'ready_for_hydrotest', 'review_weld_sum', 'line_check', 'sign_p02a', 'flushing', 'sign_p03a', 'hydro_test', 'sign_p04a', 'bolting_completion', 'reinstatement', 'sign_p05a', 'sign_p06a', 'sign_p07a', 'inspector'];
  var snake = function (k) { return k.replace(/[A-Z]/g, function (l) { return '_' + l.toLowerCase(); }); };
  var pref = function (c) { return TP_COLS.indexOf(c) >= 0 ? 'tp.' + c : 'j.' + c; };
  var camel = function (o) { var n = {}; for (var k in o) n[k.replace(/_([a-z])/g, function (g) { return g[1].toUpperCase(); })] = o[k]; return n; };

  function databaseQuery(body) {
    return loadData().then(function () {
      body = body || {};
      var pageSize = body.pageSize || 100, page = body.page || 1, where = [], params = [];
      if (body.afterId != null && isFinite(+body.afterId)) { where.push('j.rowid > ?'); params.push(parseInt(body.afterId, 10)); }
      if (body.query && body.query.trim()) {
        var q = '%' + body.query.trim().toLowerCase() + '%';
        var fields = ['system', 'test_package_no', 'line', 'drawing_no', 'spool_no', 'joint_no'];
        where.push('(' + fields.map(function (f) { return 'LOWER(CAST(' + pref(f) + ' AS TEXT)) LIKE ?'; }).join(' OR ') + ')');
        fields.forEach(function () { params.push(q); });
      }
      if (body.columnFilters) for (var ck in body.columnFilters) { var fv = body.columnFilters[ck]; if (fv && fv.trim()) { where.push('LOWER(CAST(' + pref(snake(ck)) + ' AS TEXT)) LIKE ?'); params.push('%' + fv.trim().toLowerCase() + '%'); } }
      if (body.activeSource === 'testing') where.push("j.test_package_no IS NOT NULL AND j.test_package_no <> ''");
      var wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      // SQLite piping_data has no 'id' column (built by pandas to_sql) -> use the implicit
      // rowid for the keyset cursor / sort / count, and expose it AS id for the frontend.
      var sc = snake((body.sortBy || 'id').replace(/[^a-zA-Z0-9_]/g, ''));
      var sortCol = (sc === 'id') ? 'j.rowid' : pref(sc);
      var dir = body.sortDesc ? 'DESC' : 'ASC';
      var total = null;
      if (body.afterId == null) total = (LocalDB.query('SELECT COUNT(*) c FROM piping_data j LEFT JOIN test_packages tp ON j.test_package_no=tp.test_package_no ' + wsql, params)[0] || {}).c;
      var rows = LocalDB.query('SELECT j.rowid AS id, j.*, tp.skyline,tp.test_plan,tp.ready_for_hydrotest,tp.review_weld_sum,tp.line_check,tp.sign_p02a,tp.flushing,tp.sign_p03a,tp.hydro_test,tp.sign_p04a,tp.bolting_completion,tp.reinstatement,tp.sign_p05a,tp.sign_p06a,tp.sign_p07a,tp.inspector FROM piping_data j LEFT JOIN test_packages tp ON j.test_package_no=tp.test_package_no ' + wsql + ' ORDER BY ' + sortCol + ' ' + dir + ' LIMIT ? OFFSET ?', params.concat([pageSize, (page - 1) * pageSize]));
      return { data: rows.map(camel), totalCount: total, page: page, pageSize: pageSize };
    });
  }

  function dropdowns(colKey) {
    return loadData().then(function () {
      var col = snake(colKey || ''); if (!/^[a-z_0-9]+$/.test(col)) return [];
      var tbl = TP_COLS.indexOf(col) >= 0 ? 'test_packages' : 'piping_data';
      var rows = LocalDB.query("SELECT DISTINCT " + col + " v FROM " + tbl + " WHERE " + col + " IS NOT NULL AND TRIM(" + col + ")<>'' ORDER BY " + col + " LIMIT 2000");
      return rows.map(function (r) { return r.v; });
    });
  }

  function jointsPkg(sys, pkg) {
    return loadData().then(function () {
      return LocalDB.query("SELECT * FROM piping_data WHERE system=? AND test_package_no=? ORDER BY spool_no, joint_no", [sys, pkg]).map(camel);
    });
  }

  function hydroNotInFab(d) {
    var fab = new Set(); d.packages.forEach(function (p) { if (p.testPackageNo) fab.add(String(p.testPackageNo).toUpperCase()); });
    return d.live.list.filter(function (p) { return !fab.has(String(p.testPackageNo).toUpperCase()); })
      .sort(function (a, b) { return a.testPackageNo.localeCompare(b.testPackageNo); })
      .map(function (p, i) { return { number: i + 1, testPackageNo: p.testPackageNo, hydroDate: p.hydro || '' }; });
  }

  // ---- the router: serve /api/* from LocalDB ---------------------------------
  function jsonResponse(obj) { return { ok: true, status: 200, json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(JSON.stringify(obj)); } }; }

  function apiFetch(path, opts) {
    var qs = path.indexOf('?') >= 0 ? path.slice(path.indexOf('?') + 1) : '';
    var p = new URLSearchParams(qs);
    if (path.indexOf('/api/database-query') >= 0) {
      var body = {}; try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (e) {}
      return databaseQuery(body).then(jsonResponse);
    }
    if (path.indexOf('/api/dropdowns') >= 0) return dropdowns(p.get('colKey')).then(jsonResponse);
    if (path.indexOf('/api/joints') >= 0) {
      if (p.get('pkg')) return jointsPkg(p.get('sys'), p.get('pkg')).then(jsonResponse);
      return loadData().then(function (d) { return jsonResponse(buildPackages(p.get('sys') || '__ALL__', d)); });
    }
    if (path.indexOf('/api/dashboard-summary') >= 0) {
      var view = (p.get('view') || 'totals').toLowerCase();
      // testpacks = the LIVE Google-Sheet rows for the AI Assistant -> NOT in LocalDB; let this
      // call fall through to the real Vercel endpoint (return null = "not handled here").
      if (view === 'testpacks') return null;
      return loadData().then(function (d) {
        if (view === 'systems') return jsonResponse(buildSystems(d));
        if (view === 'scurve') return jsonResponse(buildScurve(d));
        if (view === 'hydro-not-in-fab') return jsonResponse(hydroNotInFab(d));
        if (view === 'syncmeta') return jsonResponse({ filename: d.meta.filename || null, fileTime: d.meta.fileTime || null, syncedAt: d.meta.builtAt || d.meta.version || null });
        if (view === 'live') return jsonResponse(d.live.list);
        return jsonResponse(buildTotals(d));
      });
    }
    if (path.indexOf('/api/resync') >= 0) return window.LocalDB.refresh().then(function () { _data = null; return jsonResponse({ ok: true }); });
    return null;   // not an API path
  }

  // app.js calls hybridFetch(path) for the analytics views.
  window.hybridFetch = function (path) { var r = apiFetch(path); return r || _origFetch(path); };

  // Transparently serve app.js's direct fetch('/api/...') calls from LocalDB too.
  window.fetch = function (input, opts) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    if (url && url.indexOf('/api/') >= 0) { var r = apiFetch(url, opts); if (r) return r; }
    return _origFetch(input, opts);
  };

  // When db-sqlite hot-swaps in newer data (background update), drop the cached query data
  // and refresh the current view IN PLACE (app.js's reloadFreshData) -- no page reload.
  // Header status: announce while a newer dataset is downloading; clear it when ready.
  window.addEventListener('localdb-updating', function (e) {
    var d = (e && e.detail) || {};
    var msg = d.filename
      ? ('Đang cập nhật dữ liệu mới: ' + d.filename + (d.fileTime ? ' (' + d.fileTime + ')' : '') + ' — sẽ hiện trong giây lát…')
      : 'Đang cập nhật dữ liệu mới — sẽ hiện trong giây lát…';
    if (typeof window.setDataStatus === 'function') { try { window.setDataStatus('loading', msg); } catch (e2) {} }
  });
  window.addEventListener('localdb-updated', function () {
    _data = null;
    var done = function () { if (typeof window.setDataStatus === 'function') { try { window.setDataStatus('ready', 'Data up to date'); } catch (e) {} } };
    if (typeof window.reloadFreshData === 'function') { try { Promise.resolve(window.reloadFreshData()).then(done, done); } catch (e) { done(); } }
    else done();
  });

  // Real-time hydro/reinst/note: poll the LIVE sheet; if it changed, refresh the view in place.
  setInterval(function () {
    _origFetch(LIVE_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (list) {
        if (!list) return;
        var sig = JSON.stringify(list);
        if (_liveSig !== null && sig !== _liveSig) {
          _liveSig = sig; _data = null;
          if (typeof window.reloadFreshData === 'function') { try { window.reloadFreshData(); } catch (e) {} }
        } else { _liveSig = sig; }
      });
  }, 90000);

  // ---- "N online" presence badge --------------------------------------------------------
  // Each open tab heartbeats an anonymous, random session id to /api/presence (Upstash store,
  // token kept server-side); the response says how many sessions were seen in the last few
  // minutes -> the header badge. Stays hidden until the store is configured (online === null).
  (function presenceBadge() {
    var PRESENCE_URL = LIVE_URL.replace(/\/api\/dashboard-summary.*$/, '/api/presence');
    var sid;
    try {
      sid = sessionStorage.getItem('pqpoc_sid');
      if (!sid) { sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('pqpoc_sid', sid); }
    } catch (e) { sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

    function badge() {
      var el = document.getElementById('presence-badge');
      if (el) return el;
      var nav = document.querySelector('.app-navbar');
      if (!nav) return null;
      el = document.createElement('div');
      el.id = 'presence-badge';
      el.className = 'presence-badge';
      el.style.display = 'none';
      el.title = 'So nguoi dang dung app (hoat dong trong ~3 phut gan nhat)';
      el.innerHTML = '<span class="presence-dot"></span><span class="presence-count">0</span><span class="presence-label">online</span>';
      var anchor = document.getElementById('header-sync-info');
      if (anchor && anchor.parentNode === nav) nav.insertBefore(el, anchor); else nav.appendChild(el);
      return el;
    }

    function ping() {
      if (document.hidden) return;   // don't count / spend commands while the tab is hidden
      var u = PRESENCE_URL + (PRESENCE_URL.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(sid);
      _origFetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (resp) {
        var el = badge(); if (!el) return;
        if (resp && typeof resp.online === 'number') {
          el.querySelector('.presence-count').textContent = resp.online;
          el.style.display = '';
        } else { el.style.display = 'none'; }
      }).catch(function () {});
    }

    function start() { ping(); setInterval(ping, 90000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  })();
})();
