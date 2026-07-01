/* idle-manager.js -- Singleton tab lock + auto-logout after 1 hour inactivity.
 *
 * 1. SINGLETON: Only one tab of the app can be open per machine. If a 2nd tab tries to open,
 *    it shows a warning and redirects to login (for PQPOC) or closes.
 *    Uses BroadcastChannel (primary) + localStorage (fallback).
 *
 * 2. AUTO-LOGOUT: Track user activity (click, keydown, scroll, etc). If the tab is visible
 *    and has been idle for 60 minutes, auto-logout with a notification.
 *    (Idle time is ONLY counted when the tab is visible; background tabs don't count.)
 */
(function () {
  'use strict';

  // ============ SINGLETON TAB ============
  var tabId = Math.random().toString(36).slice(2, 10);   // unique per tab
  var bc = null;
  var isSingleton = true;   // assume we're the only tab

  try {
    bc = new BroadcastChannel('pqpoc_tab_manager');
  } catch (e) {
    // BroadcastChannel not supported; use localStorage fallback
  }

  function detectConflict() {
    // Another tab is open.
    alert('App is already open in another tab. Closing this tab.');
    try { sessionStorage.removeItem('pqpoc_auth'); } catch (e) {}
    if (window.opener) window.close();
    else window.location.href = window.location.pathname;   // reload to login
  }

  if (bc) {
    // Set up listener FIRST, before sending any message.
    bc.onmessage = function (event) {
      var msg = event.data;
      if (msg && msg.action === 'tab_opened' && msg.tabId !== tabId) {
        isSingleton = false;
        detectConflict();
      }
    };

    // Now notify other tabs that this tab is open.
    bc.postMessage({ action: 'tab_opened', tabId: tabId });

    // When this tab unloads, notify others it's closing.
    window.addEventListener('beforeunload', function () {
      try { bc.postMessage({ action: 'tab_closed', tabId: tabId }); } catch (e) {}
    });
  } else {
    // BroadcastChannel not available; use localStorage as fallback.
    // Store tab ID + timestamp; check if another tab is already open.
    var storageKey = 'pqpoc_active_tab';
    var now = Date.now();
    var existingTabEntry = null;
    try {
      existingTabEntry = localStorage.getItem(storageKey);
    } catch (e) {}

    if (existingTabEntry) {
      var parts = existingTabEntry.split(':');
      var existingTabId = parts[0];
      var existingTime = parseInt(parts[1], 10) || 0;

      // If existing tab is fresh (< 1 min old), assume it's still open.
      if (now - existingTime < 60000 && existingTabId !== tabId) {
        isSingleton = false;
        detectConflict();
      }
    }

    // Register this tab if we're the first one.
    if (isSingleton) {
      try {
        localStorage.setItem(storageKey, tabId + ':' + now);
      } catch (e) {}

      // Poll other tabs' presence every 5 seconds.
      setInterval(function () {
        try {
          var entry = localStorage.getItem(storageKey);
          if (!entry) return;
          var parts = entry.split(':');
          var storedTabId = parts[0];
          var storedTime = parseInt(parts[1], 10) || 0;

          // If stored tab is different and fresh, we have a conflict.
          if (storedTabId !== tabId && Date.now() - storedTime < 60000) {
            isSingleton = false;
            detectConflict();
          }
        } catch (e) {}
      }, 5000);

      // Update our presence periodically.
      setInterval(function () {
        try {
          localStorage.setItem(storageKey, tabId + ':' + Date.now());
        } catch (e) {}
      }, 10000);
    }

    // Clean up on unload.
    window.addEventListener('beforeunload', function () {
      try { localStorage.removeItem(storageKey); } catch (e) {}
    });
  }

  // ============ IDLE TIMEOUT (60 MINUTES) ============
  var IDLE_TIMEOUT_MS = 60 * 60 * 1000;   // 60 minutes in milliseconds
  var lastActivityTime = Date.now();
  var idleCheckInterval = null;

  function updateActivity() {
    if (!document.hidden) {   // only count activity when tab is visible
      lastActivityTime = Date.now();
    }
  }

  function logout() {
    // Clear auth (for PQPOC gate.js).
    try { sessionStorage.removeItem('pqpoc_auth'); } catch (e) {}

    // Show notification.
    if (window.confirm('Session expired due to 60 minutes of inactivity. Redirecting to login...')) {
      window.location.href = window.location.pathname;   // reload = back to login
    } else {
      window.location.href = window.location.pathname;
    }
  }

  function checkIdle() {
    if (document.hidden) return;   // don't check while tab is hidden

    var now = Date.now();
    var idleTime = now - lastActivityTime;

    if (idleTime > IDLE_TIMEOUT_MS) {
      clearInterval(idleCheckInterval);
      logout();
    }
  }

  // Track user activity.
  ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, updateActivity, { passive: true });
  });

  // Track visibility changes (reset lastActivityTime when tab becomes visible again).
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      lastActivityTime = Date.now();   // reset timer when user switches back to tab
    }
  });

  // Check idle status every 1 minute.
  idleCheckInterval = setInterval(checkIdle, 60000);

  // Cleanup on unload.
  window.addEventListener('beforeunload', function () {
    clearInterval(idleCheckInterval);
  });
})();
