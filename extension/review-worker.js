chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'start-review' || sender.frameId !== 0 || !sender.tab || !/^[a-f0-9-]{36}$/.test(message.ticket)) return;
  const app = new URL(sender.url);
  if (app.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(app.hostname)) return;
  const url = new URL(chrome.runtime.getURL('review.html'));
  url.hash = new URLSearchParams({ app: app.origin, ticket: message.ticket });
  chrome.storage.local.get('endpoint').then(async ({ endpoint }) => {
    const configured = new URL(endpoint || 'http://127.0.0.1:4317');
    if (configured.port !== app.port || !['localhost', '127.0.0.1'].includes(configured.hostname)) return false;
    await chrome.tabs.create({ url: url.href, windowId: sender.tab.windowId });
    return true;
  }).then(reply, () => reply(false));
  return true;
});
