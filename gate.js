/* gate.js -- simple password gate for the PQPOC-Piping-Team build.
 * NOTE: this is a client-side UI gate (a deterrent). The data file on the public GitHub
 * repo is reachable by URL, so this does not cryptographically protect the data -- true
 * protection would need a private host + server auth (incompatible with a free static app). */
(function () {
  'use strict';
  var PW = 'PQPOC_Piping';
  var KEY = 'pqpoc_auth';
  if (sessionStorage.getItem(KEY) === '1') return;

  var EYE_OPEN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function show() {
    if (document.getElementById('pqpoc-gate')) return;
    var ov = document.createElement('div');
    ov.id = 'pqpoc-gate';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0d1b2a;' +
      'display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
    ov.innerHTML =
      '<div style="background:#15202b;color:#e7eef5;padding:34px 38px;border-radius:14px;' +
      'border:1px solid #2a3a4a;box-shadow:0 12px 48px rgba(0,0,0,.6);width:330px;text-align:center">' +
      '<div style="font-size:1.15rem;font-weight:700;margin-bottom:4px">PQPOC Piping Team</div>' +
      '<div style="font-size:.83rem;color:#9fb3c5;margin-bottom:20px">Nhập mật khẩu để truy cập</div>' +
      '<div style="position:relative">' +
      '<input id="pqpoc-pw" type="password" placeholder="Mật khẩu" ' +
      'style="width:100%;box-sizing:border-box;padding:11px 42px 11px 13px;border-radius:9px;border:1px solid #34465a;' +
      'background:#0e1822;color:#fff;font-size:.95rem;outline:none">' +
      '<button id="pqpoc-eye" type="button" title="Hiện/ẩn mật khẩu" ' +
      'style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;border:0;' +
      'cursor:pointer;color:#e2e8f0;padding:5px;display:flex;align-items:center;line-height:0">' + EYE_OPEN + '</button>' +
      '</div>' +
      '<div id="pqpoc-err" style="color:#ff6b6b;font-size:.8rem;height:16px;margin:8px 0 4px"></div>' +
      '<button id="pqpoc-go" style="width:100%;padding:11px;border:0;border-radius:9px;background:#2d7ff9;' +
      'color:#fff;font-weight:600;font-size:.95rem;cursor:pointer">Đăng nhập</button></div>';
    document.body.appendChild(ov);
    var inp = ov.querySelector('#pqpoc-pw'), err = ov.querySelector('#pqpoc-err'), eye = ov.querySelector('#pqpoc-eye');
    function go() {
      if (inp.value === PW) { sessionStorage.setItem(KEY, '1'); ov.remove(); }
      else { err.textContent = 'Sai mật khẩu'; inp.value = ''; inp.focus(); }
    }
    eye.onclick = function () {
      var reveal = inp.type === 'password';
      inp.type = reveal ? 'text' : 'password';
      eye.innerHTML = reveal ? EYE_OFF : EYE_OPEN;
      eye.style.color = reveal ? '#38bdf8' : '#e2e8f0';
      inp.focus();
    };
    ov.querySelector('#pqpoc-go').onclick = go;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    inp.focus();
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
