/* ai-assistant.js -- "AI Assistant" tab: an expert oil&gas piping PM assistant, now a full
 * Gemini-style CHAT app: History rail | Chat thread | Result pane.
 *
 * - Conversations are saved LOCALLY (localStorage, per browser -- data never leaves the device).
 * - Every question + AI answer is stamped with the date/time the data was EXTRACTED.
 * - Clicking an AI answer shows its result (table / analysis / SQL / export) in the right pane.
 * - "Cập nhật" re-runs that answer's query against the CURRENT local data (new timestamp).
 * Backend flow unchanged: /api/ai-query routes answer|sql|analyze (analyze = 2nd pass, mode:'analyze').
 */
(function () {
  'use strict';

  var AI_URL = window.AI_API_URL || 'https://block-b-piping-fab.vercel.app/api/ai-query';
  var ANALYZE_URL = AI_URL;                         // analyze = same endpoint, mode:'analyze'
  var SHEET_URL = AI_URL.replace(/\/api\/ai-query.*$/, '/api/dashboard-summary?view=testpacks');
  var JSON_HEADERS = { 'Content-Type': 'application/json' };
  var STORE_KEY = 'pqpoc_ai_chats_v1';

  var EXAMPLES = [
    'Đánh giá tổng thể tiến độ NDT theo system và chỉ ra điểm nghẽn',
    'Dự đoán khi nào hoàn thành welding theo tiến độ hiện tại (kèm dẫn chứng)',
    'Liệt kê các test pack đã ready for hydrotest',
    'Các mối đang sót PWHT — gồm Test pack, Line, SpoolNo, JointNo',
    'PWHT là gì và khi nào bắt buộc phải làm?'
  ];

  // ---- Live Google-Sheet rows loaded into the local `testpack_sheet` table when the tab is used.
  var _sheetAt = 0;
  function sheetHasRows() {
    try { return window.LocalDB.query('SELECT 1 FROM testpack_sheet LIMIT 1').length > 0; } catch (e) { return false; }
  }
  function ensureSheetData(force) {
    if (!window.LocalDB || !window.LocalDB.loadSheetData) return Promise.resolve();
    var now = Date.now(), hour = new Date().getHours();
    var firstLoad = _sheetAt === 0;
    var dueRefresh = (now - _sheetAt >= 3 * 60 * 60 * 1000) && hour >= 7 && hour < 21;
    if (!force && !firstLoad && !dueRefresh) return Promise.resolve();
    return fetch(SHEET_URL, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (rows) { if (Array.isArray(rows) && rows.length) { window.LocalDB.loadSheetData(rows); _sheetAt = now; } })
      .catch(function () {});
  }

  // ---- Small utils ------------------------------------------------------------------------
  function el(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function now() { return Date.now(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms), t = new Date(), sameDay = d.toDateString() === t.toDateString();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return sameDay ? ('Hôm nay ' + hm) : (pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + hm);
  }
  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function snippet(md, n) {
    var s = String(md == null ? '' : md).replace(/[*#`>_\-]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function isSafeSelect(sql) {
    if (!sql) return false;
    var s = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
    if (s.indexOf(';') >= 0) return false;
    if (!/^(select|with)\b/i.test(s)) return false;
    if (/\b(insert|update|delete|drop|alter|attach|detach|pragma|replace|create|reindex|vacuum)\b/i.test(s)) return false;
    return true;
  }
  function errorText(data) {
    switch (data && data.error) {
      case 'not_configured': return 'AI chưa được cấu hình. Cần thêm GEMINI_API_KEY vào Vercel.';
      case 'empty_question': return 'Hãy nhập câu hỏi.';
      case 'question_too_long': return 'Câu hỏi quá dài.';
      case 'gemini_error': return 'Lỗi từ Gemini: ' + (data.detail || '');
      case 'bad_json': return 'AI trả về không đúng định dạng. Thử hỏi lại rõ hơn.';
      default: return 'Lỗi: ' + ((data && (data.detail || data.error)) || 'không rõ');
    }
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
      var ol = t.match(/^\d+[.)]\s+(.*)$/), ul = t.match(/^[-*•]\s+(.*)$/);
      if (ol) { if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += '<li>' + ol[1] + '</li>'; return; }
      if (ul) { if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += '<li>' + ul[1] + '</li>'; return; }
      closeList(); html += '<p>' + t + '</p>';
    });
    closeList();
    return html;
  }
  function renderTable(rows) {
    if (!rows || !rows.length) return '<div class="ai-empty">Không có dòng nào khớp yêu cầu.</div>';
    var cols = Object.keys(rows[0]);
    var thead = '<tr><th>#</th>' + cols.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r, i) {
      return '<tr><td class="ai-idx">' + (i + 1) + '</td>' +
        cols.map(function (c) { var v = r[c]; return '<td>' + escapeHtml(v === null || v === undefined || (typeof v === 'number' && isNaN(v)) ? '' : v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="ai-table-scroll"><table class="ai-result-table"><thead>' + thead + '</thead><tbody>' + body + '</tbody></table></div>';
  }
  function exportRows(rows) {
    if (!rows || !rows.length || typeof ExcelJS === 'undefined') { alert('Không có dữ liệu để export.'); return; }
    var cols = Object.keys(rows[0]);
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('AI Result');
    ws.columns = cols.map(function (c) { return { header: c, key: c, width: 20 }; });
    rows.forEach(function (r) { ws.addRow(r); });
    ws.getRow(1).eachCell(function (c) { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; });
    wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = 'AI_Query_Result.xlsx'; a.click(); URL.revokeObjectURL(a.href);
    });
  }

  // ---- Persistent store (localStorage) ----------------------------------------------------
  var store = { conversations: [], activeId: null };
  var state = { selectedId: null, busy: false };

  function loadStore() {
    try { var s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && Array.isArray(s.conversations)) store = s; } catch (e) {}
    if (!store.conversations.length) newConversation(true);
    if (!activeConv()) store.activeId = store.conversations[0] && store.conversations[0].id;
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return; } catch (e) {}
    while (store.conversations.length > 1) {                    // quota: drop oldest non-active, retry
      var oi = -1, oldest = Infinity;
      store.conversations.forEach(function (c, i) { if (c.id !== store.activeId && c.updatedAt < oldest) { oldest = c.updatedAt; oi = i; } });
      if (oi < 0) break;
      store.conversations.splice(oi, 1);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return; } catch (e2) {}
    }
  }
  function activeConv() { return store.conversations.filter(function (c) { return c.id === store.activeId; })[0]; }
  function findMsg(conv, id) { return conv ? conv.messages.filter(function (m) { return m.id === id; })[0] : null; }
  function newConversation(silent) {
    var cur = activeConv();
    if (cur && !cur.messages.length) { state.selectedId = null; if (!silent) renderAll(); return cur; }  // reuse empty
    var c = { id: uid(), title: '', createdAt: now(), updatedAt: now(), messages: [] };
    store.conversations.unshift(c); store.activeId = c.id; state.selectedId = null;
    if (!silent) { saveStore(); renderAll(); var q = el('ai-question'); if (q) q.focus(); }
    return c;
  }
  function switchConversation(id) {
    store.activeId = id; state.selectedId = null; saveStore(); renderAll(); selectLatest();
  }
  function deleteConversation(id) {
    store.conversations = store.conversations.filter(function (c) { return c.id !== id; });
    if (store.activeId === id) { store.activeId = store.conversations[0] && store.conversations[0].id; state.selectedId = null; }
    if (!store.conversations.length) newConversation(true);
    saveStore(); renderAll(); selectLatest();
  }
  function buildHistory(conv, beforeId) {
    var out = [];
    for (var i = 0; i < conv.messages.length; i++) {
      var m = conv.messages[i];
      if (m.id === beforeId) break;
      if (m.role === 'user') out.push({ role: 'user', text: m.text });
      else { var t = m.narrative || m.text || ''; if (t) out.push({ role: 'model', text: t }); }
    }
    return out.slice(-6);
  }

  // ---- Query pipeline ---------------------------------------------------------------------
  function runLocalSql(sql) {
    return Promise.resolve(window.LocalDB.ready ? window.LocalDB.ready() : null)
      .then(function () { return ensureSheetData(); })
      .then(function () { if (/testpack_sheet/i.test(sql) && !sheetHasRows()) return ensureSheetData(true); })
      .then(function () { if (window.LocalDB.ensureIndexes) { try { window.LocalDB.ensureIndexes(); } catch (e) {} } return window.LocalDB.query(sql); });
  }
  // Returns a Promise<aiPayload> = {kind:'answer'|'table'|'analysis'|'error', text?, narrative?, sql?, model?, columns?, rows?, error?}
  function runQuestion(question, history) {
    return fetch(AI_URL, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ question: question, history: history }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) return { kind: 'error', error: errorText(data) };
        if (data.type === 'answer' && data.answer) return { kind: 'answer', narrative: data.answer, model: data.model };
        if (!isSafeSelect(data.sql)) return { kind: 'error', error: 'AI tạo câu lệnh không hợp lệ (chỉ cho phép SELECT). Thử hỏi lại.' };
        return runLocalSql(data.sql).then(function (rows) {
          var columns = rows.length ? Object.keys(rows[0]) : [];
          if (data.type !== 'analyze') return { kind: 'table', text: data.explanation, sql: data.sql, model: data.model, columns: columns, rows: rows };
          return fetch(ANALYZE_URL, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ mode: 'analyze', question: question, columns: columns, rows: rows, history: history }) })
            .then(function (r) { return r.json(); })
            .then(function (a) { return { kind: 'analysis', text: data.explanation, narrative: (a && a.answer) || '', sql: data.sql, model: (a && a.model) || data.model, columns: columns, rows: rows }; })
            .catch(function () { return { kind: 'table', text: data.explanation, sql: data.sql, model: data.model, columns: columns, rows: rows }; });
        }).catch(function (e) { return { kind: 'error', error: 'Câu SQL chạy lỗi: ' + (e && e.message ? e.message : e), sql: data.sql }; });
      })
      .catch(function (e) { return { kind: 'error', error: 'Không gọi được AI: ' + (e && e.message ? e.message : e) }; });
  }

  function setBusy(b) { state.busy = b; var btn = el('ai-ask-btn'); if (btn) { btn.disabled = b; btn.textContent = b ? 'Đang xử lý…' : 'Hỏi AI'; } }

  function ask(question) {
    question = (question || '').trim();
    if (!question || state.busy) return;
    if (!window.LocalDB) { renderOutputMessage('AI Assistant cần cơ sở dữ liệu cục bộ (bản PQPOC).'); return; }
    var conv = activeConv() || newConversation(true);
    var t = now();
    var userMsg = { id: uid(), role: 'user', ts: t, text: question };
    var aiMsg = { id: uid(), role: 'ai', ts: t, extractedAt: t, kind: 'pending' };
    conv.messages.push(userMsg, aiMsg);
    if (!conv.title) conv.title = question.slice(0, 70);
    conv.updatedAt = t;
    var input = el('ai-question'); if (input) input.value = '';
    saveStore(); renderHistory(); renderThread(); state.selectedId = aiMsg.id; renderOutput(aiMsg); scrollThread();
    setBusy(true);
    var history = buildHistory(conv, userMsg.id);
    runQuestion(question, history).then(function (payload) {
      for (var k in aiMsg) if (k !== 'id' && k !== 'role' && k !== 'ts') delete aiMsg[k];
      Object.assign(aiMsg, payload); aiMsg.extractedAt = now(); aiMsg.ts = now();
      conv.updatedAt = now(); saveStore();
      renderHistory(); renderThread(); if (state.selectedId === aiMsg.id) renderOutput(aiMsg); scrollThread();
    }).then(function () { setBusy(false); }, function () { setBusy(false); });
  }

  // Re-run one AI answer against the CURRENT data (keeps the same question; new timestamp).
  function updateMessage(id) {
    if (state.busy) return;
    var conv = activeConv(); if (!conv) return;
    var idx = -1; conv.messages.forEach(function (m, i) { if (m.id === id) idx = i; });
    var msg = conv.messages[idx]; if (!msg || msg.role !== 'ai') return;
    var uidx = -1; for (var i = idx - 1; i >= 0; i--) { if (conv.messages[i].role === 'user') { uidx = i; break; } }
    var q = uidx >= 0 ? conv.messages[uidx].text : '';
    var history = uidx >= 0 ? buildHistory(conv, conv.messages[uidx].id) : [];
    setBusy(true); msg._updating = true; if (state.selectedId === id) renderOutput(msg);
    var p;
    if (msg.sql && (msg.kind === 'table' || msg.kind === 'analysis')) {
      p = runLocalSql(msg.sql).then(function (rows) {
        msg.columns = rows.length ? Object.keys(rows[0]) : []; msg.rows = rows;
        if (msg.kind === 'analysis') {
          return fetch(ANALYZE_URL, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ mode: 'analyze', question: q, columns: msg.columns, rows: rows, history: history }) })
            .then(function (r) { return r.json(); }).then(function (a) { if (a && a.answer) msg.narrative = a.answer; if (a && a.model) msg.model = a.model; });
        }
      }).catch(function (e) { msg.kind = 'error'; msg.error = 'Cập nhật lỗi: ' + (e && e.message ? e.message : e); });
    } else {                                                    // answer / no-sql -> re-ask
      p = runQuestion(q, history).then(function (payload) { for (var k in msg) if (k !== 'id' && k !== 'role') delete msg[k]; Object.assign(msg, payload); });
    }
    p.then(function () {
      msg._updating = false; msg.extractedAt = now(); msg.ts = now(); conv.updatedAt = now(); saveStore();
      renderHistory(); renderThread(); if (state.selectedId === id) renderOutput(msg);
    }).then(function () { setBusy(false); }, function () { setBusy(false); });
  }

  // ---- Rendering --------------------------------------------------------------------------
  function renderAll() { renderHistory(); renderThread(); var m = findMsg(activeConv(), state.selectedId); renderOutput(m || null); }
  function selectLatest() {
    var conv = activeConv(); if (!conv) { renderOutput(null); return; }
    var last = null; conv.messages.forEach(function (m) { if (m.role === 'ai' && m.kind && m.kind !== 'pending') last = m; });
    state.selectedId = last ? last.id : null; renderThread(); renderOutput(last || null);
  }

  function renderHistory() {
    var box = el('ai-history-list'); if (!box) return;
    var convs = store.conversations.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    box.innerHTML = convs.map(function (c) {
      var active = c.id === store.activeId ? ' active' : '';
      var title = escapeHtml(c.title || 'Cuộc trò chuyện mới');
      return '<div class="ai-hist-item' + active + '" data-conv="' + c.id + '">' +
        '<div class="ai-hist-main"><div class="t">' + title + '</div><div class="d">' + fmtTime(c.updatedAt) + '</div></div>' +
        '<button class="ai-hist-del" data-del="' + c.id + '" title="Xoá" aria-label="Xoá cuộc trò chuyện">✕</button></div>';
    }).join('') || '<div class="ai-hist-empty">Chưa có cuộc trò chuyện.</div>';
  }

  function renderThread() {
    var conv = activeConv(), head = el('ai-chat-title'), thread = el('ai-thread');
    if (head) head.textContent = (conv && conv.title) ? conv.title : 'Cuộc trò chuyện mới';
    if (!thread) return;
    if (!conv || !conv.messages.length) {
      thread.innerHTML = '<div class="ai-thread-empty">Hỏi một câu để bắt đầu. Câu hỏi và câu trả lời sẽ được lưu kèm thời điểm trích xuất dữ liệu.</div>';
      return;
    }
    thread.innerHTML = conv.messages.map(function (m) {
      if (m.role === 'user') {
        return '<div class="ai-msg ai-msg-user"><div class="ai-bubble">' + escapeHtml(m.text) + '</div>' +
          '<div class="ai-msg-meta">' + fmtTime(m.ts) + '</div></div>';
      }
      var sel = m.id === state.selectedId ? ' ai-msg-selected' : '';
      var body, hint = '', canUpdate = false;
      if (m._updating || m.kind === 'pending') { body = '<span class="ai-spin"></span> Đang phân tích…'; }
      else if (m.kind === 'error') { body = '<span class="ai-err">' + escapeHtml(m.error || 'Lỗi') + '</span>'; }
      else if (m.kind === 'answer') { body = escapeHtml(snippet(m.narrative, 170)); hint = 'xem đầy đủ'; canUpdate = true; }
      else if (m.kind === 'analysis') { body = escapeHtml(snippet(m.narrative, 170)); hint = (m.rows ? m.rows.length : 0) + ' dòng · phân tích · xem'; canUpdate = true; }
      else { body = escapeHtml(m.text || 'Kết quả'); hint = (m.rows ? m.rows.length : 0) + ' dòng · xem kết quả'; canUpdate = true; }
      var meta = '<div class="ai-msg-meta"><span title="Thời điểm trích xuất dữ liệu">⏱ ' + fmtTime(m.extractedAt || m.ts) + '</span>' +
        (canUpdate ? '<span class="ai-msg-update" data-update="' + m.id + '" title="Chạy lại trên dữ liệu hiện tại">↻ Cập nhật</span>' : '') + '</div>';
      return '<div class="ai-msg ai-msg-ai' + sel + '">' +
        '<div class="ai-bubble" data-msg="' + m.id + '">' + body +
        (hint ? '<div class="ai-bubble-hint">' + escapeHtml(hint) + ' →</div>' : '') + '</div>' + meta + '</div>';
    }).join('');
  }

  function scrollThread() { var t = el('ai-thread'); if (t) t.scrollTop = t.scrollHeight; }

  function renderOutputMessage(txt) { var out = el('ai-output'); if (out) out.innerHTML = '<div class="ai-output-empty">' + escapeHtml(txt) + '</div>'; }

  function renderOutput(msg) {
    var out = el('ai-output'); if (!out) return;
    if (!msg) { out.innerHTML = '<div class="ai-output-empty">Chọn một câu trả lời bên trái để xem kết quả.</div>'; return; }
    if (msg._updating || msg.kind === 'pending') { out.innerHTML = '<div class="ai-output-empty"><span class="ai-spin"></span> Đang xử lý…</div>'; return; }
    var rows = msg.rows, hasRows = Array.isArray(rows);
    var head = '<div class="ai-output-head"><span class="ai-output-title">Kết quả</span>' +
      '<span class="ai-extracted" title="Thời điểm trích xuất dữ liệu">⏱ trích xuất ' + fmtTime(msg.extractedAt || msg.ts) + '</span>';
    if (msg.kind === 'table' || msg.kind === 'analysis' || msg.kind === 'answer') head += '<button class="ai-mini" data-update="' + msg.id + '" title="Chạy lại trên dữ liệu hiện tại">↻ Cập nhật</button>';
    if (hasRows) head += '<button class="ai-mini" id="ai-export-btn">⬇ Export</button>';
    if (msg.sql) head += '<button class="ai-mini" id="ai-sql-toggle">Xem SQL</button>';
    head += '</div>';
    var body = '';
    if (msg.kind === 'error') body += '<div class="ai-answer ai-answer-err"><span class="ai-badge">Lỗi</span> ' + escapeHtml(msg.error || '') + '</div>';
    if (msg.narrative) body += '<div class="ai-answer-rich"><span class="ai-badge">Chuyên gia AI</span>' + mdToHtml(msg.narrative) + '</div>';
    else if (msg.text) body += '<div class="ai-answer"><span class="ai-badge">AI</span> ' + escapeHtml(msg.text) + '</div>';
    if (msg.sql) body += '<pre class="ai-sql" id="ai-sql-box" style="display:none;">' + escapeHtml(msg.sql) + '</pre>';
    if (hasRows) body += '<div class="ai-rowcount">' + rows.length + ' dòng' + (msg.model ? ' · ' + escapeHtml(msg.model) : '') + '</div>' + renderTable(rows);
    out.innerHTML = head + '<div class="ai-output-body">' + body + '</div>';
  }

  function selectMessage(id) {
    var conv = activeConv(), m = findMsg(conv, id); if (!m || m.role !== 'ai') return;
    state.selectedId = id; renderThread(); renderOutput(m);
  }

  // ---- Init + event delegation ------------------------------------------------------------
  function init() {
    var askBtn = el('ai-ask-btn'), input = el('ai-question'), examples = el('ai-examples');
    var thread = el('ai-thread'), history = el('ai-history-list'), output = el('ai-output'), newBtn = el('ai-newchat');

    if (askBtn) askBtn.addEventListener('click', function () { ask(input && input.value); });
    if (input) input.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ask(input.value); } });
    if (newBtn) newBtn.addEventListener('click', function () { newConversation(false); });

    if (examples) {
      examples.innerHTML = EXAMPLES.map(function (q) { return '<button class="ai-example-chip" type="button">' + escapeHtml(q) + '</button>'; }).join('');
      examples.querySelectorAll('.ai-example-chip').forEach(function (chip) {
        chip.addEventListener('click', function () { if (input) input.value = chip.textContent; ask(chip.textContent); });
      });
    }
    if (thread) thread.addEventListener('click', function (e) {
      var u = e.target.closest('[data-update]'); if (u) { e.stopPropagation(); updateMessage(u.getAttribute('data-update')); return; }
      var b = e.target.closest('[data-msg]'); if (b) selectMessage(b.getAttribute('data-msg'));
    });
    if (history) history.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]'); if (d) { e.stopPropagation(); deleteConversation(d.getAttribute('data-del')); return; }
      var c = e.target.closest('[data-conv]'); if (c) switchConversation(c.getAttribute('data-conv'));
    });
    if (output) output.addEventListener('click', function (e) {
      var u = e.target.closest('[data-update]'); if (u) { updateMessage(u.getAttribute('data-update')); return; }
      if (e.target.closest('#ai-export-btn')) { var m = findMsg(activeConv(), state.selectedId); if (m) exportRows(m.rows); return; }
      if (e.target.closest('#ai-sql-toggle')) { var box = el('ai-sql-box'), tgl = el('ai-sql-toggle'); if (box) { var show = box.style.display === 'none'; box.style.display = show ? 'block' : 'none'; tgl.textContent = show ? 'Ẩn SQL' : 'Xem SQL'; } }
    });

    loadStore(); renderAll(); selectLatest();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
