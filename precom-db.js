/* precom-db.js -- Loader LAZY cho DB thu 2 (mang Precom: ITR-A + Punch).
 *
 * Hoan toan DOC LAP voi db-sqlite.js (mang Fabrication) - khong dong nao cua app cu bi anh
 * huong. DB chi duoc tai khi user MO TAB Precom lan dau (PrecomDB.ready()), cache o
 * IndexedDB rieng ('precom-local-db'), revalidate bang ETag o cac lan sau.
 *
 * URL: localhost -> /precom_data.db.gz (server.js phuc vu file build_precom.py copy sang);
 *      production -> raw.githubusercontent.com/vubadien1983-droid/precom-data (push khi user duyet OK).
 */
(function () {
  'use strict';

  var IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var DB_URL = window.PRECOM_DB_URL ||
    (IS_LOCAL ? '/precom_data.db.gz'
              : 'https://raw.githubusercontent.com/vubadien1983-droid/precom-data/main/precom_data.db.gz');
  var IDB_NAME = 'precom-local-db', IDB_STORE = 'kv';
  var KEY_BYTES = 'db_gz', KEY_ETAG = 'db_etag';

  var _db = null, _meta = null, _ready = null;

  function _idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function _get(k) { return _idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k); t.onsuccess = function () { res(t.result); }; t.onerror = function () { rej(t.error); }; }); }); }
  function _set(k, v) { return _idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }

  // sql.js da duoc db-sqlite.js nap san khi app khoi dong (LocalDB.ready()). Neu vi ly do
  // nao do chua co, tu nap tu CDN nhu db-sqlite.
  function _ensureSQL() {
    if (window.initSqlJs) return window.initSqlJs({ locateFile: function (f) { return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + f; } });
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';
      s.onload = function () { res(window.initSqlJs({ locateFile: function (f) { return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + f; } })); };
      s.onerror = function () { rej(new Error('sql.js load failed')); };
      document.head.appendChild(s);
    });
  }

  function _loadDB(SQL, gz) {
    var raw = window.pako ? window.pako.ungzip(gz) : gz;
    if (_db) { try { _db.close(); } catch (e) {} }
    _db = new SQL.Database(raw);
    _meta = {};
    try {
      var r = _db.exec('SELECT key, value FROM app_meta');
      if (r[0]) r[0].values.forEach(function (row) { _meta[row[0]] = row[1]; });
    } catch (e) {}
  }

  // server.js (localhost) tra ve index.html (200) cho file KHONG ton tai (SPA fallback),
  // nen phai kiem tra gzip magic bytes (1f 8b) truoc khi dung/cache - tranh cache rac vinh vien.
  function _isGzip(b) { return b && b.length > 2 && b[0] === 0x1f && b[1] === 0x8b; }

  function _download(headers) {
    return fetch(DB_URL, { headers: headers || {}, cache: 'no-cache' }).then(function (resp) {
      if (resp.status === 304) return { status: 304 };
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' khi tai ' + DB_URL);
      return resp.arrayBuffer().then(function (b) {
        var bytes = new Uint8Array(b);
        if (!_isGzip(bytes)) {
          throw new Error('precom_data.db.gz chua duoc build (server tra ve noi dung khac). ' +
            'Chay Precom\\Build_Precom_Local.bat roi F5.');
        }
        return { status: 200, bytes: bytes, etag: resp.headers.get('ETag') };
      });
    });
  }

  function _init() {
    var SQL;
    return _ensureSQL().then(function (S) {
      SQL = S;
      return Promise.all([_get(KEY_BYTES), _get(KEY_ETAG)]);
    }).then(function (c) {
      var bytes = c[0], etag = c[1];
      if (bytes && !_isGzip(bytes)) { bytes = null; _set(KEY_BYTES, null); _set(KEY_ETAG, null); }  // purge cache rac
      if (bytes) {                                  // stale-while-revalidate
        _loadDB(SQL, bytes);
        _download(etag ? { 'If-None-Match': etag } : {}).then(function (r) {
          if (!r || r.status === 304) return;
          Promise.all([_set(KEY_BYTES, r.bytes), r.etag ? _set(KEY_ETAG, r.etag) : null]).then(function () {
            _loadDB(SQL, r.bytes);
            try { window.dispatchEvent(new Event('precomdb-updated')); } catch (e) {}
          });
        }).catch(function () {});
        return;
      }
      return _download({}).then(function (r) {
        return Promise.all([_set(KEY_BYTES, r.bytes), r.etag ? _set(KEY_ETAG, r.etag) : null])
          .then(function () { _loadDB(SQL, r.bytes); });
      });
    });
  }

  window.PrecomDB = {
    // KHONG cache promise bi reject: lan bam tab sau se thu tai lai (sau khi user build xong).
    ready: function () {
      if (_ready) return _ready;
      _ready = _init().catch(function (e) { _ready = null; throw e; });
      return _ready;
    },
    loaded: function () { return !!_db; },
    query: function (sql, params) {
      if (!_db) throw new Error('PrecomDB not ready');
      var st = _db.prepare(sql);
      try { if (params) st.bind(params); var out = []; while (st.step()) out.push(st.getAsObject()); return out; }
      finally { st.free(); }
    },
    meta: function () { return _meta || {}; }
  };
})();
