// compat.js — cross-browser shim, loaded before all other extension scripts
// Normalises chrome.* vs browser.* so the rest of the code uses `ext.*` uniformly.
//
// Firefox exposes `browser` (Promise-based) AND `chrome` (callback-based).
// Chrome only exposes `chrome` (callback-based, but also supports promises in MV3).
// We wrap everything in a unified promise-based `ext` object.

(function () {
  // Already shimmed (e.g. loaded twice in the same context)
  if (typeof window !== 'undefined' && window.__ytmSyncCompat) return;
  if (typeof globalThis !== 'undefined' && globalThis.__ytmSyncCompat) return;

  const _browser = (typeof browser !== 'undefined' && browser.runtime) ? browser : null;
  const _chrome  = (typeof chrome  !== 'undefined' && chrome.runtime)  ? chrome  : null;
  const api = _browser || _chrome;

  if (!api) {
    console.error('[YTM Sync] No extension API found');
    return;
  }

  // Helper: wrap a chrome callback-style fn as a Promise if needed
  function promisify(fn, ctx) {
    return function (...args) {
      // Firefox browser.* is already promise-based
      if (_browser) return fn.apply(ctx, args);
      // Chrome MV3 also returns promises when no callback is passed
      return new Promise((resolve, reject) => {
        fn.apply(ctx, [...args, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        }]);
      });
    };
  }

  // Unified ext object — used throughout the extension instead of chrome.* / browser.*
  const ext = {
    runtime: {
      sendMessage: (msg) => {
        try {
          const result = api.runtime.sendMessage(msg);
          // Always return a real promise that swallows "no receivers" errors
          return Promise.resolve(result).catch(() => {});
        } catch (e) {
          return Promise.resolve();
        }
      },
      onMessage: api.runtime.onMessage,
      lastError: () => api.runtime.lastError,
    },
    storage: {
      local: {
        get: promisify(api.storage.local.get.bind(api.storage.local)),
        set: promisify(api.storage.local.set.bind(api.storage.local)),
      },
      onChanged: api.storage.onChanged,
    },
    tabs: {
      query:      promisify(api.tabs.query.bind(api.tabs)),
      create:     promisify(api.tabs.create.bind(api.tabs)),
      update:     promisify(api.tabs.update.bind(api.tabs)),
      sendMessage: (tabId, msg) => {
        try {
          const result = api.tabs.sendMessage(tabId, msg);
          return Promise.resolve(result).catch(() => {});
        } catch (e) {
          return Promise.resolve();
        }
      },
      onRemoved:  api.tabs.onRemoved,
    },
    windows: {
      update: promisify(api.windows.update.bind(api.windows)),
    },
  };

  // Expose globally — works in both service worker (no `window`) and content scripts
  if (typeof globalThis !== 'undefined') {
    globalThis.ext = ext;
    globalThis.__ytmSyncCompat = true;
  }
  if (typeof window !== 'undefined') {
    window.ext = ext;
    window.__ytmSyncCompat = true;
  }
})();
