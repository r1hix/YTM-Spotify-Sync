// background.js — service worker (Chrome) / event page (Firefox)

let spotifyTabId = null;
let lastSentTrack = null;
let syncEnabled = false;
let returnTabId = null;
let returnWindowId = null;
let playPending = false;

chrome.storage.local.get(['syncEnabled'], (data) => {
  syncEnabled = data.syncEnabled ?? false;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.syncEnabled) syncEnabled = changes.syncEnabled.newValue;
});

async function getOrCreateSpotifyTab() {
  if (spotifyTabId !== null) {
    try { const t = await chrome.tabs.get(spotifyTabId); if (t) return spotifyTabId; }
    catch (_) { spotifyTabId = null; }
  }
  const tabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  if (tabs.length > 0) { spotifyTabId = tabs[0].id; return spotifyTabId; }
  const tab = await chrome.tabs.create({ url: 'https://open.spotify.com/', active: false });
  spotifyTabId = tab.id;
  return spotifyTabId;
}

async function flashAndPlay(title, artist) {
  const tabId = await getOrCreateSpotifyTab();

  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && active.id !== tabId) {
      returnTabId = active.id;
      returnWindowId = active.windowId;
    }
  } catch (_) {}

  playPending = true;
  await chrome.tabs.update(tabId, { active: true });
  try { await chrome.windows.update((await chrome.tabs.get(tabId)).windowId, { focused: true }); }
  catch (_) {}

  sendToSpotify({ type: 'SPOTIFY_PREPARE_PLAY' });
}

async function returnFocus() {
  if (!returnTabId) return;
  try {
    await chrome.tabs.update(returnTabId, { active: true });
    if (returnWindowId) await chrome.windows.update(returnWindowId, { focused: true });
  } catch (_) {}
  returnTabId = null;
}

async function navigateSpotifyToSearch(title, artist) {
  const tabId = await getOrCreateSpotifyTab();
  const url = `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}/tracks`;
  await chrome.tabs.update(tabId, { url });

  return new Promise((resolve) => {
    function onUpdated(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      setTimeout(async () => {
        await flashAndPlay(title, artist);
        resolve();
      }, 1800);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendToSpotify(msg) {
  try {
    const tabId = await getOrCreateSpotifyTab();
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) { console.warn('[YTM Sync]', e.message); }
}

function handleTrackUpdate(track) {
  if (track?.title) chrome.storage.local.set({ currentTrack: track });
  if (!syncEnabled) return;
  const same = lastSentTrack?.title === track?.title && lastSentTrack?.artist === track?.artist;
  const wasPlaying = lastSentTrack?.isPlaying;
  
  if (!track?.title) return;
  
  // 1. Handle pausing
  if (!track.isPlaying) {
    if (wasPlaying) { 
      sendToSpotify({ type: 'SPOTIFY_PAUSE' }); 
      lastSentTrack = track; 
    }
    return;
  }
  
  // 2. Handle resuming the SAME song (Bypasses search/restart)
  if (same) {
    if (!wasPlaying) { 
      sendToSpotify({ type: 'SPOTIFY_RESUME' }); 
      lastSentTrack = track; 
    }
    return;
  }
  
  // 3. Handle entirely new song (Performs search & plays first result)
  lastSentTrack = track;
  chrome.storage.local.set({ currentTrack: track, lastSynced: Date.now() });
  navigateSpotifyToSearch(track.title, track.artist);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {
    case 'YTM_TRACK_UPDATE':
      handleTrackUpdate(msg.track);
      break;
    case 'SPOTIFY_TAB_READY':
      if (sender.tab?.id) {
        spotifyTabId = sender.tab.id;
        
        chrome.storage.local.get(['syncEnabled'], (data) => {
          chrome.scripting.executeScript({
            target: { tabId: spotifyTabId },
            world: 'MAIN',
            func: (isSyncEnabled) => {
              if (window.__ytmSyncPatched) return;
              window.__ytmSyncPatched = true;
              window.__ytmSyncMuted = isSyncEnabled;
              window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'YTM_SYNC_SET_MUTE') {
                  window.__ytmSyncMuted = event.data.muted;
                }
              });
              const origPlay = HTMLMediaElement.prototype.play;
              HTMLMediaElement.prototype.play = function() {
                if (window.__ytmSyncMuted) {
                  this.muted = true;
                  this.volume = 0;
                }
                return origPlay.apply(this, arguments);
              };
            },
            args: [!!data.syncEnabled]
          }).catch(err => console.warn('[YTM Sync] Scripting injection failed:', err));
        });

        chrome.tabs.sendMessage(sender.tab.id, { type: 'SPOTIFY_MUTE' }).catch(() => {});
      }
      break;
    case 'SPOTIFY_PLAY_SUCCESS':
      chrome.storage.local.set({ lastStatus: 'playing', lastError: null });
      returnFocus();
      break;
    case 'SPOTIFY_PLAY_ERROR':
      chrome.storage.local.set({ lastStatus: 'error', lastError: msg.error });
      returnFocus();
      break;
    case 'SPOTIFY_NEEDS_PLAY':
      if (playPending && sender.tab?.id === spotifyTabId) {
        playPending = false;
        chrome.tabs.sendMessage(sender.tab.id, { type: 'SPOTIFY_PLAY_FIRST_RESULT' }).catch(() => {});
      }
      break;
    case 'TOGGLE_SYNC':
      syncEnabled = msg.enabled;
      chrome.storage.local.set({ syncEnabled });
      if (!syncEnabled) { sendToSpotify({ type: 'SPOTIFY_PAUSE' }); lastSentTrack = null; }
      else if (lastSentTrack?.isPlaying) { const t = lastSentTrack; lastSentTrack = null; handleTrackUpdate(t); }
      break;
  }
});

chrome.tabs.onRemoved.addListener(id => { 
  if (id === spotifyTabId) {
    spotifyTabId = null; 
    lastSentTrack = null; // Wipes memory so the next song reliably triggers a fresh search
  }
});