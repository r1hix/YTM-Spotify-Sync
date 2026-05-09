// popup.js — uses ext shim for cross-browser compatibility

const toggle = document.getElementById('syncToggle');
const mainContent = document.getElementById('mainContent');
const openSpotifyBtn = document.getElementById('openSpotify');

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderContent(syncEnabled, track, status) {
  if (!syncEnabled) {
    mainContent.innerHTML = `
      <div class="sync-off-msg">
        <span>Sync is off</span>
        Toggle the switch above to start<br>mirroring YTM → Spotify
      </div>`;
    return;
  }
  const dotClass = !track?.isPlaying ? 'paused' : (status === 'error' ? 'error' : 'playing');
  const statusLabel = !track?.title ? 'waiting for ytm...'
    : !track.isPlaying ? 'ytm paused'
    : status === 'error' ? 'sync error'
    : 'syncing';

  const trackHTML = track?.title
    ? `<div class="track-platform-row">
         <span class="platform-tag ytm">YouTube Music</span>
         <span class="platform-tag spotify">Spotify</span>
       </div>
       <div class="track-title">${escHtml(track.title)}</div>
       <div class="track-artist">${escHtml(track.artist || '')}</div>`
    : `<div class="track-empty">Nothing playing yet…</div>`;

  mainContent.innerHTML = `
    <div class="status-block">
      <div class="status-row">
        <div class="dot ${dotClass}"></div>
        <span class="status-text">${statusLabel}</span>
      </div>
      <div class="track-card">${trackHTML}</div>
    </div>`;
}

// ── Load state ────────────────────────────────────────────────────────────────

chrome.storage.local
  .get(['syncEnabled', 'currentTrack', 'lastStatus'])
  .then(({ syncEnabled, currentTrack, lastStatus }) => {
    toggle.checked = !!syncEnabled;
    renderContent(!!syncEnabled, currentTrack, lastStatus);
  });

// ── Toggle ────────────────────────────────────────────────────────────────────

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.runtime.sendMessage({ type: 'TOGGLE_SYNC', enabled });
  chrome.storage.local.get(['currentTrack', 'lastStatus']).then(({ currentTrack, lastStatus }) => {
    renderContent(enabled, currentTrack, lastStatus);
  });
});

// ── Open Spotify ──────────────────────────────────────────────────────────────

openSpotifyBtn.addEventListener('click', () => {
  chrome.tabs.query({ url: 'https://open.spotify.com/*' }).then((tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      // windows.update not available in all Firefox contexts, guard it
      if (chrome.windows && tabs[0].windowId) {
        chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
      }
    } else {
      chrome.tabs.create({ url: 'https://open.spotify.com/' });
    }
  });
});

// ── Refresh on storage changes ────────────────────────────────────────────────

chrome.storage.onChanged.addListener(() => {
  chrome.storage.local
    .get(['syncEnabled', 'currentTrack', 'lastStatus'])
    .then(({ syncEnabled, currentTrack, lastStatus }) => {
      toggle.checked = !!syncEnabled;
      renderContent(!!syncEnabled, currentTrack, lastStatus);
    });
});
