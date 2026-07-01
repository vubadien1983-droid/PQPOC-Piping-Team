/* ai-assistant.js -- "AI Assistant" tab (NotebookLM-style ask-your-data).
 *
 * Flow: user question -> POST /api/ai-query (Gemini, key server-side) -> {sql, explanation}
 * -> validate the SQL is read-only SELECT -> run it on the LOCAL SQLite (window.LocalDB) ->
 * render a result table (+ Export Excel). Data never leaves the device; only the question +
 * the fixed schema go to the model.
 */
(function () {
  'use strict';

  var AI_URL = window.AI_API_URL ||
    'https://block-b-piping-fab.vercel.app/api/ai-query';
  // Live Google-Sheet rows (inspector, test_plan, deadline, hydro...) loaded into the local
  // `testpack_sheet` table when the AI tab is USED: on the first query of a session, then
  // re-fetched at most every 3 HOURS and ONLY between 07:00-21:00 local time (to save calls).
  var SHEET_URL = AI_URL.replace(/\/api\/ai-query.*$/, '/api/dashboard-summary?view=testpacks');
  var _sheetAt = 0;
  function sheetHasRows() {
    try { return window.LocalDB.query('SELECT 1 FROM testpack_sheet LIMIT 1').length > 0; } catch (e) { return false; }
  }
  function ensureSheetData(force) {
    if (!window.LocalDB || !window.LocalDB.loadSheetData) return Promise.resolve();
    var now = Date.now(), hour = new Date().getHours();
    var firstLoad = _sheetAt === 0;                                               // load once per session
    var dueRefresh = (now - _sheetAt >= 3 * 60 * 60 * 1000) && hour >= 7 && hour < 21;  // else every 3h, 07:00-21:00
    if (!force && !firstLoad && !dueRefresh) return Promise.resolve();
    return fetch(SHEET_URL, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (rows) { if (Array.isArray(rows) && rows.length) { window.LocalDB.loadSheetData(rows); _sheetAt = now; } })
      .catch(function () {});
  }

  var EXAMPLES = [
    'Liệt kê các jointNo đã PWHT ở mối gốc nhưng phải repair/reweld — gồm Test pack, Line, SpoolNo, JointNo, các loại NDT, PWHT của mối gốc và mối Repair/Reweld',
    'Có bao nhiêu joint đã hàn (Visual ACC) theo từng material?',
    'Liệt kê các test package chưa hoàn thành RT (RT yêu cầu nhưng chưa ACC)',
    'Tổng Dia-Inch đã hàn theo từng system, sắp xếp giảm dần'
  ];

  // Only allow a single read-only SELECT / WITH statement.
  function isSafeSelect(sql) {
    if (!sql) return false;
    var s = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    s = s.replace(/;\s*$/, '');                 // allow one trailing semicolon
    if (s.indexOf(';') >= 0) return false;      // no multiple statements
    if (!/^(select|with)\b/i.test(s)) return false;
    if (/\b(insert|update|delete|drop|alter|attach|detach|pragma|replace|create|reindex|vacuum)\b/i.test(s)) return false;
    return true;
  }

  function el(id) { return document.getElementById(id); }

  function setStatus(kind, msg) {
    var s = el('ai-status');
    if (!s) return;
    s.style.display = msg ? 'block' : 'none';
    s.className = 'ai-status ' + (kind || '');
    s.textContent = msg || '';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var _lastRows = null;

  function renderTable(rows) {
    if (!rows || !rows.length) return '<div class="ai-empty">Không có dòng nào khớp yêu cầu.</div>';
    var cols = Object.keys(rows[0]);
    var thead = '<tr><th>#</th>' + cols.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r, i) {
      return '<tr><td class="ai-idx">' + (i + 1) + '</td>' +
        cols.map(function (c) { var v = r[c]; return '<td>' + escapeHtml(v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? '' : v) + '</td>'; }).join('') +
        '</tr>';
    }).join('');
    return '<div class="ai-table-scroll"><table class="ai-result-table"><thead>' + thead + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderResult(explanation, sql, rows) {
    _lastRows = rows;
    var out = el('ai-result');
    if (!out) return;
    out.innerHTML =
      '<div class="ai-answer"><span class="ai-badge">AI</span> ' + escapeHtml(explanation || '') + '</div>' +
      '<div class="ai-result-head">' +
        '<span class="ai-rowcount">' + (rows ? rows.length : 0) + ' dòng</span>' +
        '<button class="btn btn-secondary" id="ai-export-btn" style="padding:0.3rem 0.7rem; font-size:0.75rem;">⬇ Export Excel</button>' +
        '<button class="ai-sql-toggle" id="ai-sql-toggle">Xem SQL</button>' +
      '</div>' +
      '<pre class="ai-sql" id="ai-sql-box" style="display:none;">' + escapeHtml(sql) + '</pre>' +
      renderTable(rows);
    var tgl = el('ai-sql-toggle');
    if (tgl) tgl.addEventListener('click', function () {
      var box = el('ai-sql-box');
      if (box) { var show = box.style.display === 'none'; box.style.display = show ? 'block' : 'none'; tgl.textContent = show ? 'Ẩn SQL' : 'Xem SQL'; }
    });
    var exp = el('ai-export-btn');
    if (exp) exp.addEventListener('click', function () { exportRows(_lastRows); });
  }

  function exportRows(rows) {
    if (!rows || !rows.length || typeof ExcelJS === 'undefined') { alert('Không có dữ liệu để export.'); return; }
    var cols = Object.keys(rows[0]);
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('AI Result');
    ws.columns = cols.map(function (c) { return { header: c, key: c, width: 20 }; });
    rows.forEach(function (r) { ws.addRow(r); });
    ws.getRow(1).eachCell(function (c) {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    });
    wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'AI_Query_Result.xlsx'; a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function errorText(data) {
    switch (data && data.error) {
      case 'not_configured': return 'AI chưa được cấu hình. Cần thêm GEMINI_API_KEY vào Vercel (xem hướng dẫn).';
      case 'empty_question': return 'Hãy nhập câu hỏi.';
      case 'question_too_long': return 'Câu hỏi quá dài.';
      case 'gemini_error': return 'Lỗi từ Gemini: ' + (data.detail || '');
      case 'bad_json': return 'AI trả về không đúng định dạng. Thử hỏi lại rõ hơn.';
      case 'no_answer': return 'AI không trả lời được. Thử diễn đạt lại.';
      default: return 'Lỗi: ' + ((data && (data.detail || data.error)) || 'không rõ');
    }
  }

  function ask(question) {
    question = (question || '').trim();
    if (!question) return;
    if (!window.LocalDB) { setStatus('error', 'AI Assistant cần cơ sở dữ liệu cục bộ (bản PQPOC).'); return; }
    var out = el('ai-result'); if (out) out.innerHTML = '';
    setStatus('loading', '⏳ AI đang phân tích câu hỏi và truy vấn dữ liệu…');
    var askBtn = el('ai-ask-btn'); if (askBtn) askBtn.disabled = true;

    fetch(AI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { setStatus('error', errorText(data)); return; }
      if (!isSafeSelect(data.sql)) { setStatus('error', 'AI tạo câu lệnh không hợp lệ (chỉ cho phép SELECT). Thử hỏi lại.'); return; }
      return Promise.resolve(window.LocalDB.ready ? window.LocalDB.ready() : null).then(function () {
        return ensureSheetData();
      }).then(function () {
        // If the query needs the live-sheet table but it isn't populated yet (first load failed
        // or was skipped), force one reload so testpack_sheet queries never come back empty.
        if (/testpack_sheet/i.test(data.sql) && !sheetHasRows()) return ensureSheetData(true);
      }).then(function () {
        if (window.LocalDB.ensureIndexes) { try { window.LocalDB.ensureIndexes(); } catch (e) {} }
        var rows;
        try { rows = window.LocalDB.query(data.sql); }
        catch (e) { setStatus('error', 'Câu SQL chạy lỗi: ' + e.message + '  — bấm "Xem SQL" để kiểm tra.'); renderResult(data.explanation, data.sql, []); return; }
        setStatus('', '');
        renderResult(data.explanation, data.sql, rows);
      });
    }).catch(function (e) {
      setStatus('error', 'Không gọi được AI: ' + e.message);
    }).then(function () {
      var b = el('ai-ask-btn'); if (b) b.disabled = false;
    });
  }

  function init() {
    var askBtn = el('ai-ask-btn'), input = el('ai-question'), examples = el('ai-examples');
    if (askBtn) askBtn.addEventListener('click', function () { ask(input && input.value); });
    if (input) input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ask(input.value); }
    });
    if (examples) {
      examples.innerHTML = EXAMPLES.map(function (q) { return '<button class="ai-example-chip" type="button">' + escapeHtml(q) + '</button>'; }).join('');
      examples.querySelectorAll('.ai-example-chip').forEach(function (chip) {
        chip.addEventListener('click', function () { if (input) { input.value = chip.textContent; input.focus(); } ask(chip.textContent); });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
