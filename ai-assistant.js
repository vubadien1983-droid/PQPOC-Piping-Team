/* ai-assistant.js -- "AI Assistant" tab: an expert oil&gas piping PROJECT-MANAGER assistant.
 *
 * Flow (Balanced package, phases 1+2):
 *   question (+ short conversation history) -> POST /api/ai-query -> {type, sql, explanation, answer}
 *   - type "answer"  : the model replied from expertise (no data)          -> render Markdown answer
 *   - type "sql"     : a plain lookup                                       -> run SQL locally, show table
 *   - type "analyze" : run the AGGREGATED SQL locally, then POST the small  -> render expert narrative
 *                      result to /api/ai-analyze for an expert PM narrative    ABOVE the table
 * Conversation memory keeps the last few turns so follow-ups ("tại sao?", "đào sâu") work.
 * PRIVACY: only the schema + question (query pass) and the small AGGREGATED result (analyze pass)
 * leave the device; the raw 96k joint rows never do.
 */
(function () {
  'use strict';

  var AI_URL = window.AI_API_URL ||
    'https://block-b-piping-fab.vercel.app/api/ai-query';
  var ANALYZE_URL = AI_URL.replace(/\/api\/ai-query.*$/, '/api/ai-analyze');
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
    'Đánh giá tổng thể tiến độ NDT theo system và chỉ ra điểm nghẽn',
    'Dự đoán khi nào hoàn thành welding theo tiến độ hiện tại (kèm dẫn chứng)',
    'Liệt kê các test pack đã ready for hydrotest',
    'Các mối đang sót PWHT — gồm Test pack, Line, SpoolNo, JointNo',
    'PWHT là gì và khi nào bắt buộc phải làm?'
  ];

  // ---- Conversation memory (kept in this tab session) --------------------------------------
  var _history = [];   // [{role:'user'|'model', text}]
  function remember(q, a) {
    if (q) _history.push({ role: 'user', text: String(q) });
    if (a) _history.push({ role: 'model', text: String(a) });
    if (_history.length > 8) _history = _history.slice(-8);   // ~4 turns
  }
  function resetHistory() { _history = []; }

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

  // Minimal, safe Markdown -> HTML (bold/italic/code, headings, bullet + numbered lists).
  function mdToHtml(md) {
    var text = escapeHtml(md);
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    var lines = text.split(/\r?\n/), html = '', listType = null;
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { closeList(); return; }
      var h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); var lvl = Math.min(h[1].length + 2, 6); html += '<h' + lvl + '>' + h[2] + '</h' + lvl + '>'; return; }
      var ol = t.match(/^\d+[.)]\s+(.*)$/);
      var ul = t.match(/^[-*•]\s+(.*)$/);
      if (ol) { if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += '<li>' + ol[1] + '</li>'; return; }
      if (ul) { if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += '<li>' + ul[1] + '</li>'; return; }
      closeList(); html += '<p>' + t + '</p>';
    });
    closeList();
    return html;
  }

  var _lastRows = null;

  function memoryBar() {
    if (!_history.length) return '';
    var turns = Math.floor((_history.length + 1) / 2);
    return '<div class="ai-membar">🧠 Đang nhớ ngữ cảnh (' + turns + ' lượt) — có thể hỏi tiếp "tại sao?", "đào sâu…". ' +
      '<button class="ai-reset" id="ai-reset-btn" type="button">Ngữ cảnh mới</button></div>';
  }

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

  // opts: { narrative, explanation, sql, rows, pending }
  function renderResult(opts) {
    opts = opts || {};
    _lastRows = opts.rows || null;
    var out = el('ai-result');
    if (!out) return;

    var head = '';
    if (opts.narrative) {
      head = '<div class="ai-answer-rich"><span class="ai-badge">Chuyên gia AI</span>' + mdToHtml(opts.narrative) + '</div>';
    } else if (opts.pending) {
      head = '<div class="ai-answer"><span class="ai-badge">AI</span> ' + escapeHtml(opts.explanation || '') +
        ' <span class="ai-analyzing">⏳ đang viết nhận định chuyên gia…</span></div>';
    } else if (opts.explanation) {
      head = '<div class="ai-answer"><span class="ai-badge">AI</span> ' + escapeHtml(opts.explanation || '') + '</div>';
    }

    var rows = opts.rows;
    var resultHead = (rows && rows.length !== undefined) ?
      ('<div class="ai-result-head">' +
        '<span class="ai-rowcount">' + rows.length + ' dòng</span>' +
        '<button class="btn btn-secondary" id="ai-export-btn" style="padding:0.3rem 0.7rem; font-size:0.75rem;">⬇ Export Excel</button>' +
        (opts.sql ? '<button class="ai-sql-toggle" id="ai-sql-toggle">Xem SQL</button>' : '') +
      '</div>' +
      (opts.sql ? '<pre class="ai-sql" id="ai-sql-box" style="display:none;">' + escapeHtml(opts.sql) + '</pre>' : '') +
      renderTable(rows)) : '';

    out.innerHTML = memoryBar() + head + resultHead;
    wireResultButtons();
  }

  // Direct expert answer (type "answer"): just the Markdown reply, no table.
  function renderAnswerOnly(md) {
    var out = el('ai-result');
    if (!out) return;
    _lastRows = null;
    out.innerHTML = memoryBar() + '<div class="ai-answer-rich"><span class="ai-badge">Chuyên gia AI</span>' + mdToHtml(md) + '</div>';
    wireResultButtons();
  }

  function wireResultButtons() {
    var tgl = el('ai-sql-toggle');
    if (tgl) tgl.addEventListener('click', function () {
      var box = el('ai-sql-box');
      if (box) { var show = box.style.display === 'none'; box.style.display = show ? 'block' : 'none'; tgl.textContent = show ? 'Ẩn SQL' : 'Xem SQL'; }
    });
    var exp = el('ai-export-btn');
    if (exp) exp.addEventListener('click', function () { exportRows(_lastRows); });
    var rst = el('ai-reset-btn');
    if (rst) rst.addEventListener('click', function () {
      resetHistory();
      var out = el('ai-result'); if (out) out.innerHTML = '';
      setStatus('', '');
      var input = el('ai-question'); if (input) input.focus();
    });
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

  // Run the model's SQL on the local DB (loading the live sheet first if the query needs it).
  function runLocalSql(sql) {
    return Promise.resolve(window.LocalDB.ready ? window.LocalDB.ready() : null)
      .then(function () { return ensureSheetData(); })
      .then(function () { if (/testpack_sheet/i.test(sql) && !sheetHasRows()) return ensureSheetData(true); })
      .then(function () {
        if (window.LocalDB.ensureIndexes) { try { window.LocalDB.ensureIndexes(); } catch (e) {} }
        return window.LocalDB.query(sql);
      });
  }

  function ask(question) {
    question = (question || '').trim();
    if (!question) return;
    if (!window.LocalDB) { setStatus('error', 'AI Assistant cần cơ sở dữ liệu cục bộ (bản PQPOC).'); return; }
    var out = el('ai-result'); if (out) out.innerHTML = '';
    setStatus('loading', '⏳ AI đang phân tích câu hỏi…');
    var askBtn = el('ai-ask-btn'); if (askBtn) askBtn.disabled = true;
    var hist = _history.slice();     // context sent to the model (excludes the current question)
    var done = function () { var b = el('ai-ask-btn'); if (b) b.disabled = false; };

    fetch(AI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, history: hist })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { setStatus('error', errorText(data)); return; }

      // (1) Expert answer straight from domain knowledge -- no data query.
      if (data.type === 'answer' && data.answer) {
        setStatus('', '');
        remember(question, data.answer);
        renderAnswerOnly(data.answer);
        return;
      }

      // (2)/(3) Need SQL.
      if (!isSafeSelect(data.sql)) { setStatus('error', 'AI tạo câu lệnh không hợp lệ (chỉ cho phép SELECT). Thử hỏi lại.'); return; }

      return runLocalSql(data.sql).catch(function (e) {
        setStatus('error', 'Câu SQL chạy lỗi: ' + e.message + '  — bấm "Xem SQL" để kiểm tra.');
        renderResult({ explanation: data.explanation, sql: data.sql, rows: [] });
        if (e && typeof e === 'object') e._handled = true;
        throw e;   // stop the chain (already shown)
      }).then(function (rows) {
        // (2) Plain lookup -> just the table.
        if (data.type !== 'analyze') {
          setStatus('', '');
          remember(question, (data.explanation || 'Kết quả') + ' (' + rows.length + ' dòng)');
          renderResult({ explanation: data.explanation, sql: data.sql, rows: rows });
          return;
        }

        // (3) Analyze -> show the table now, then fetch the expert narrative (2nd pass).
        renderResult({ explanation: data.explanation, sql: data.sql, rows: rows, pending: true });
        setStatus('loading', '⏳ AI đang viết nhận định chuyên gia…');
        var cols = rows.length ? Object.keys(rows[0]) : [];
        return fetch(ANALYZE_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: question, columns: cols, rows: rows, history: hist })
        }).then(function (r) { return r.json(); }).then(function (a) {
          setStatus('', '');
          if (a && a.answer) {
            remember(question, a.answer);
            renderResult({ narrative: a.answer, explanation: data.explanation, sql: data.sql, rows: rows });
          } else {
            remember(question, (data.explanation || 'Kết quả') + ' (' + rows.length + ' dòng)');
            renderResult({ explanation: data.explanation, sql: data.sql, rows: rows });
          }
        }).catch(function () {
          setStatus('', '');
          renderResult({ explanation: data.explanation, sql: data.sql, rows: rows });
        });
      });
    }).catch(function (e) {
      if (e && e._handled) return;                 // SQL error already shown
      setStatus('error', 'Không gọi được AI: ' + (e && e.message ? e.message : e));
    }).then(done, done);
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
