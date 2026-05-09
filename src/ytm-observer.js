// ytm-observer.js — runs inside music.youtube.com
// Uses `ext` from compat.js — works on both Chrome and Firefox.

(function () {
  let lastTrack = null;
  let pollInterval = null;

  function getCurrentTrack() {
    const titleEl =
      document.querySelector('yt-formatted-string.title.ytmusic-player-bar') ||
      document.querySelector('.content-info-wrapper .title') ||
      document.querySelector('ytmusic-player-bar .title');

    const artistEl =
      document.querySelector('yt-formatted-string.byline.ytmusic-player-bar') ||
      document.querySelector('.content-info-wrapper .byline') ||
      document.querySelector('ytmusic-player-bar .byline');

    const playButton =
      document.querySelector('tp-yt-paper-icon-button#play-pause-button') ||
      document.querySelector('.play-pause-button');

    const title = titleEl?.textContent?.trim();
    const artist = artistEl?.textContent?.trim()?.split('•')[0]?.trim();

    const isPlaying =
      playButton?.getAttribute('aria-label')?.toLowerCase().includes('pause') ||
      playButton?.title?.toLowerCase().includes('pause') ||
      document.querySelector('[player-ui-state="PLAYING"]') !== null;

    if (!title || !artist) return null;
    return { title, artist, isPlaying };
  }

  function trackChanged(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    return a.title !== b.title || a.artist !== b.artist || a.isPlaying !== b.isPlaying;
  }

  function poll() {
    const track = getCurrentTrack();
    if (trackChanged(lastTrack, track)) {
      lastTrack = track;
      chrome.runtime.sendMessage({ type: 'YTM_TRACK_UPDATE', track });
    }
  }

  pollInterval = setInterval(poll, 2000);
  setTimeout(poll, 1000);

  window.addEventListener('beforeunload', () => clearInterval(pollInterval));
})();
