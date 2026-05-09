(function () {
  let mutedByExtension = false;
  let pendingPlay = false;

  function ensureMuted() {
    window.postMessage({ type: 'YTM_SYNC_SET_MUTE', muted: true }, '*');

    document.querySelectorAll('audio, video').forEach((el) => {
      el.muted = true;
      el.volume = 0;
    });
    mutedByExtension = true;
  }

  new MutationObserver(() => { if (mutedByExtension) ensureMuted(); })
    .observe(document.body, { childList: true, subtree: true });

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
    });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function playFirstResult() {
    try {
      const firstRow = await waitForElement('[data-testid="tracklist-row"]', 10000);
      await sleep(300);

      firstRow.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      firstRow.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
      await sleep(200);

      const playBtn =
        firstRow.querySelector('[data-testid="play-button"]') ||
        firstRow.querySelector('button[aria-label*="play" i]');

      if (playBtn) playBtn.click();
      else firstRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

      await sleep(700);

      // Verify playing and forcefully click bottom bar play button if needed
      const ppBtn = document.querySelector('[data-testid="control-button-playpause"]');
      const stillPaused = ppBtn && ppBtn.getAttribute('aria-label')?.toLowerCase().includes('play');
      if (stillPaused) ppBtn.click();

      await sleep(300);
      ensureMuted();

      chrome.runtime.sendMessage({ type: 'SPOTIFY_PLAY_SUCCESS' }).catch(() => {});
    } catch (err) {
      chrome.runtime.sendMessage({ type: 'SPOTIFY_PLAY_ERROR', error: err.message }).catch(() => {});
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingPlay) {
      pendingPlay = false;
      chrome.runtime.sendMessage({ type: 'SPOTIFY_NEEDS_PLAY' }).catch(() => {});
    }
  });

  function handlePlayIfVisible() {
    if (document.visibilityState === 'visible') {
      chrome.runtime.sendMessage({ type: 'SPOTIFY_NEEDS_PLAY' }).catch(() => {});
    } else {
      pendingPlay = true;
    }
  }

  // 1. Direct explicit click on the PAUSE button
  function pauseSpotify() {
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    if (btn?.getAttribute('aria-label')?.toLowerCase().includes('pause')) {
      btn.click();
    }
  }

  // 2. Direct explicit click on the PLAY button (Resuming)
  function resumeSpotify() {
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    if (btn?.getAttribute('aria-label')?.toLowerCase().includes('play')) {
      btn.click();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SPOTIFY_PLAY_FIRST_RESULT') {
      mutedByExtension = true;
      ensureMuted();
      playFirstResult();
    } else if (msg.type === 'SPOTIFY_PREPARE_PLAY') {
      mutedByExtension = true;
      ensureMuted();
      handlePlayIfVisible();
    } else if (msg.type === 'SPOTIFY_PAUSE') {
      pauseSpotify();
    } else if (msg.type === 'SPOTIFY_RESUME') {
      resumeSpotify();
    } else if (msg.type === 'SPOTIFY_MUTE') {
      mutedByExtension = true;
      ensureMuted();
    }
  });

  chrome.storage.local.get(['syncEnabled'], ({ syncEnabled }) => {
    if (syncEnabled) { mutedByExtension = true; ensureMuted(); }
  });

  chrome.runtime.sendMessage({ type: 'SPOTIFY_TAB_READY' }).catch(() => {});
})();