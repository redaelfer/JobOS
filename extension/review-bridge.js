// Runs only on loopback pages. A run ticket is issued by the JobOS server.
document.documentElement.dataset.jobosBrowserReview = '1';
window.addEventListener('jobos-start-browser-review', event => {
  if (typeof event.detail !== 'string' || !/^[a-f0-9-]{36}$/.test(event.detail)) return;
  chrome.runtime.sendMessage({ type: 'start-review', ticket: event.detail }).then(ok => {
    if (!ok) window.dispatchEvent(new Event('jobos-review-launch-failed'));
  }).catch(() => window.dispatchEvent(new Event('jobos-review-launch-failed')));
});
