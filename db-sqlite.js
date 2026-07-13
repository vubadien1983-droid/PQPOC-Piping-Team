/* db-sqlite.js -- Local-first SQLite read path for the (vanilla) app.
 *
 * window.LocalDB downloads piping_data.db.gz ONCE into a local cache (IndexedDB), decompresses
 * it (pako), loads it into sql.js (WASM, in-RAM), and exposes LocalDB.query(sql, params) for
 * 0ms local SQL -- no cloud database at runtime.
 *
 * UX (stale-while-revalidate):
 *  - First open (no cache): show a one-time loading screen with a progress bar (~1 min, 5-6 MB),
 *    then the app runs.
 *  - Every open after: load the CACHED copy INSTANTLY (app is usable immediately, no wait), then
 *    SILENTLY check GitHub (ETag) in the background. If newer data exists, download it in the
 *    background WHILE the user keeps using the old data, then swap it in and fire 'localdb-updated'
 *    -- the app refreshes in place (reloadFreshData). No "update?" prompt, no blank screen.
 *  - Offline: keep using the cached copy.
 *
 * Config: window.SQLITE_DB_URL = the GitHub raw URL of piping_data.db.gz.
 */
(function () {
  'use strict';

  var DB_URL = window.SQLITE_DB_URL ||
    'https://raw.githubusercontent.com/vubadien1983-droid/piping-data/main/piping_data.db.gz';
  // Tiny sibling file (version + source filename/date) pushed next to the .db.gz, so the app
  // can announce "updating to <file>" BEFORE downloading the multi-MB database.
  var META_URL = window.META_URL || DB_URL.replace(/piping_data\.db\.gz/, 'meta.json');
  // sql.js WASM loader -- tried in order with a timeout, so a slow/blocked CDN falls through
  // to the next instead of hanging the whole app (~2 min browser timeout) on load.
  var SQLJS_CDNS = [
    'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/',
    'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/',
    'https://unpkg.com/sql.js@1.10.3/dist/'
  ];
  var IDB_NAME = 'piping-local-db', IDB_STORE = 'kv';
  var KEY_BYTES = 'db_gz', KEY_ETAG = 'db_etag';

  var _SQL = null, _db = null, _meta = null, _ready = null, _indexed = false;

  // ---- IndexedDB key/value (persist compressed bytes + etag) ------------------
  function _idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function _idbGet(k) { return _idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k); t.onsuccess = function () { res(t.result); }; t.onerror = function () { rej(t.error); }; }); }); }
  function _idbSet(k, v) { return _idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }

  // ---- sql.js ----------------------------------------------------------------
  function _loadScript(src, timeoutMs) {
    return new Promise(function (res, rej) {
      var done = false, s = document.createElement('script');
      var to = setTimeout(function () { if (!done) { done = true; rej(new Error('script timeout')); } }, timeoutMs || 12000);
      s.src = src;
      s.onload = function () { if (!done) { done = true; clearTimeout(to); res(); } };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); rej(new Error('script error')); } };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function _ensureSQL() {
    if (_SQL) return Promise.resolve(_SQL);
    function tryCdn(i) {
      if (i >= SQLJS_CDNS.length) return Promise.reject(new Error('sql.js failed to load from all CDNs'));
      var base = SQLJS_CDNS[i];
      var loadJs = window.initSqlJs ? Promise.resolve() : _loadScript(base + 'sql-wasm.js', 12000);
      // Race the whole attempt (script + wasm init) against a timeout so a hanging CDN/WASM
      // fetch doesn't stall the app -- on timeout/error we fall through to the next CDN.
      var attempt = loadJs
        .then(function () { return window.initSqlJs({ locateFile: function (f) { return base + f; } }); })
        .then(function (SQL) { _SQL = SQL; return SQL; });
      var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('cdn timeout')); }, 15000); });
      return Promise.race([attempt, timeout]).catch(function () {
        try { window.initSqlJs = undefined; } catch (e) {}   // reset so the next CDN reloads the script
        return tryCdn(i + 1);
      });
    }
    return tryCdn(0);
  }

  function _loadDB(gz) {
    var raw = window.pako ? window.pako.ungzip(gz) : gz;
    // Free the OLD DB BEFORE allocating the new one so we never hold two ~70MB DBs at once
    // (that memory spike could stall/OOM weaker devices during a data hot-swap).
    if (_db) { try { _db.close(); } catch (e) {} _db = null; }
    _db = new _SQL.Database(raw);
    _indexed = false;   // heavy pairing indexes (idx_dwg_joint...) still built LAZILY by the AI tab.
    // Nhưng index cho JOIN/filter tab Database (test_package_no, material) build NGAY -> mọi query
    // Database/dropdown/joints không còn full-scan ~96k dòng. Rẻ (~vài trăm ms, 1 lần/lần load).
    try { _db.exec('CREATE INDEX IF NOT EXISTS idx_tp ON piping_data (test_package_no);' +
                   'CREATE INDEX IF NOT EXISTS idx_material ON piping_data (material);'); } catch (e) {}
    _meta = {};
    try { var r = _db.exec('SELECT key, value FROM app_meta'); if (r[0]) r[0].values.forEach(function (row) { _meta[row[0]] = row[1]; }); } catch (e) {}
  }

  // ---- first-run loading overlay (informative; NOT a yes/no prompt) ----------
  function _overlay() {
    var ov = document.createElement('div');
    ov.id = 'localdb-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0d1b2a;color:#e7eef5;' +
      'display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
    ov.innerHTML = '<div style="text-align:center;max-width:380px;padding:0 24px">' +
      '<div style="font-size:1.05rem;font-weight:700;margin-bottom:8px">Đang cài đặt cơ sở dữ liệu</div>' +
      '<div style="font-size:.85rem;color:#9fb3c5;margin-bottom:18px">Lần đầu tải dữ liệu về máy (~5–6 MB). ' +
      'Các lần sau sẽ mở <b>tức thì</b> và tự cập nhật trong nền.</div>' +
      '<div style="height:8px;background:#1d2c3a;border-radius:6px;overflow:hidden">' +
      '<div id="localdb-bar" style="height:100%;width:0;background:#2d7ff9;transition:width .15s"></div></div>' +
      '<div id="localdb-pct" style="font-size:.78rem;color:#7f93a6;margin-top:8px">0%</div></div>';
    document.body.appendChild(ov);
  }
  function _overlayProgress(rec, total) {
    var bar = document.getElementById('localdb-bar'), pct = document.getElementById('localdb-pct');
    if (total && bar) { var p = Math.min(100, Math.round(rec / total * 100)); bar.style.width = p + '%'; if (pct) pct.textContent = p + '%'; }
    else if (pct) { pct.textContent = (rec / 1e6).toFixed(1) + ' MB'; }
  }
  function _overlayHide() { var ov = document.getElementById('localdb-overlay'); if (ov) ov.remove(); }

  // ---- streaming download (tracks progress) ----------------------------------
  function _download(headers, onProgress) {
    return fetch(DB_URL, { headers: headers || {}, cache: 'no-cache' }).then(function (resp) {
      if (resp.status === 304) return { status: 304 };
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var etag = resp.headers.get('ETag');
      var total = +resp.headers.get('Content-Length') || 0;
      if (!resp.body || !resp.body.getReader) {
        return resp.arrayBuffer().then(function (b) { return { status: 200, bytes: new Uint8Array(b), etag: etag }; });
      }
      var reader = resp.body.getReader(), chunks = [], received = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { var all = new Uint8Array(received), off = 0; chunks.forEach(function (c) { all.set(c, off); off += c.length; }); return { status: 200, bytes: all, etag: etag }; }
          chunks.push(r.value); received += r.value.length;
          if (onProgress) onProgress(received, total);
          return pump();
        });
      }
      return pump();
    });
  }

  // ---- background revalidate: silent download + hot-swap ---------------------
  function _backgroundUpdate(etag) {
    _download(etag ? { 'If-None-Match': etag } : {}).then(function (r) {
      if (!r || r.status === 304) return;            // already current
      return Promise.all([_idbSet(KEY_BYTES, r.bytes), r.etag ? _idbSet(KEY_ETAG, r.etag) : null]).then(function () {
        _loadDB(r.bytes);                            // hot-swap the in-RAM DB
        if (window.console) console.log('[LocalDB] new data swapped in -> refreshing view');
        try { window.dispatchEvent(new Event('localdb-updated')); } catch (e) {}
      });
    }).catch(function () { /* offline / transient -> keep current data */ });
  }

  // Check the tiny meta.json first: if a newer build exists, ANNOUNCE it (filename/date) so the
  // header can show "updating to <file>", then pull the .db.gz (which hot-swaps when it lands).
  function _maybeUpdate() {
    return fetch(META_URL + (META_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (remote) {
        if (remote && remote.version && _meta && String(remote.version) !== String(_meta.version)) {
          try { window.dispatchEvent(new CustomEvent('localdb-updating', { detail: { filename: remote.filename, fileTime: remote.fileTime } })); } catch (e) {}
        }
        return _idbGet(KEY_ETAG).then(function (e) { return _backgroundUpdate(e); });
      });
  }

  function _init() {
    return _ensureSQL().then(function () {
      return Promise.all([_idbGet(KEY_BYTES), _idbGet(KEY_ETAG)]);
    }).then(function (c) {
      var bytes = c[0], etag = c[1];
      if (bytes) {                                   // STALE-WHILE-REVALIDATE
        _loadDB(bytes);                              // instant, cached (old) data
        _maybeUpdate();                              // announce + pull newer data (non-blocking)
        return;
      }
      // FIRST RUN: must download once (progress overlay, no yes/no prompt)
      if (document.body) _overlay();
      return _download({}, _overlayProgress).then(function (r) {
        return Promise.all([_idbSet(KEY_BYTES, r.bytes), r.etag ? _idbSet(KEY_ETAG, r.etag) : null]).then(function () {
          _loadDB(r.bytes); _overlayHide();
        });
      }).catch(function (e) { _overlayHide(); throw e; });
    });
  }

  // ---- public API ------------------------------------------------------------
  window.LocalDB = {
    ready: function () { return _ready || (_ready = _init()); },
    query: function (sql, params) {
      if (!_db) throw new Error('LocalDB not ready');
      var st = _db.prepare(sql);
      try { if (params) st.bind(params); var out = []; while (st.step()) out.push(st.getAsObject()); return out; }
      finally { st.free(); }
    },
    meta: function () { return _meta || {}; },
    refresh: function () { return _maybeUpdate(); },
    // Build query indexes ON DEMAND (used by the AI Assistant). Idempotent; ~1-2s once per
    // dataset. joint_no is unique only within a drawing, so repair-pairing joins on
    // (drawing_no, joint_no) -- without this index that join is O(n^2) over ~96k rows.
    ensureIndexes: function () {
      if (_indexed || !_db) return;
      try {
        _db.exec('CREATE INDEX IF NOT EXISTS idx_dwg_joint ON piping_data (drawing_no, joint_no);' +
                 'CREATE INDEX IF NOT EXISTS idx_tp ON piping_data (test_package_no);' +
                 'CREATE INDEX IF NOT EXISTS idx_system ON piping_data (system);' +
                 'CREATE INDEX IF NOT EXISTS idx_material ON piping_data (material);');
        _indexed = true;
      } catch (e) {}
    },
    // Populate a local `testpack_sheet` table from the LIVE Google Sheet rows (inspector,
    // test_plan, deadline, hydro_test, ...) -- data the offline .db.gz does NOT contain, used by
    // the AI Assistant. Recreated on each call; ~914 rows in one transaction (fast).
    loadSheetData: function (rows) {
      if (!_db || !rows || !rows.length) return 0;
      try {
        _db.run('DROP TABLE IF EXISTS testpack_sheet');
        _db.run('CREATE TABLE testpack_sheet (test_package_no TEXT, inspector TEXT, test_plan TEXT, deadline TEXT, hydro_test TEXT, reinstatement TEXT, pct_welding TEXT, spools TEXT, joints TEXT, skyline TEXT, note TEXT)');
        _db.run('BEGIN');
        var st = _db.prepare('INSERT INTO testpack_sheet VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        rows.forEach(function (r) {
          st.run([r.test_package_no || '', r.inspector || '', r.test_plan || '', r.deadline || '',
                  r.hydro_test || '', r.reinstatement || '', r.pct_welding || '', r.spools || '',
                  r.joints || '', r.skyline || '', r.note || '']);
        });
        st.free();
        _db.run('COMMIT');
        return rows.length;
      } catch (e) { try { _db.run('ROLLBACK'); } catch (x) {} return 0; }
    }
  };

  // Auto pick-up new data pushed by the desktop uploader, WHILE the app is open: re-check the
  // .db.gz every few minutes (a conditional ETag request -> cheap 304 when unchanged, silent
  // hot-swap + 'localdb-updated' when newer). Without this the app only checked on (re)load.
  setInterval(function () { if (_db && !document.hidden) { try { window.LocalDB.refresh(); } catch (e) {} } }, 180000);
})();
