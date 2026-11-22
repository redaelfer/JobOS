chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['start-review', 'start-indeed'].includes(message?.type) || sender.frameId !== 0 || !sender.tab || !/^[a-f0-9-]{36}$/.test(message.ticket)) return;
  const app = new URL(sender.url);
  if (app.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(app.hostname)) return;
  const url = new URL(chrome.runtime.getURL(message.type === 'start-indeed' ? 'indeed.html' : 'review.html'));
  url.hash = new URLSearchParams({ app: app.origin, ticket: message.ticket });
  // A fresh query forces exactly one document navigation on controller reuse.
  // Hash-only navigation keeps the old module/ticket; update + reload can load
  // the new ticket twice and let the first document's pagehide pause the second.
  if (message.type === 'start-indeed') url.searchParams.set('launch', crypto.randomUUID());
  chrome.storage.local.get('endpoint').then(async ({ endpoint }) => {
    const configured = new URL(endpoint || 'http://127.0.0.1:4317');
    if (configured.port !== app.port || !['localhost', '127.0.0.1'].includes(configured.hostname)) return false;
    if (message.type === 'start-indeed') {
      const key = 'indeed-controller:' + app.origin;
      const saved = (await chrome.storage.session.get(key))[key];
      if (saved) {
        const previous = await chrome.tabs.get(saved).catch(() => null);
        if (previous?.url?.startsWith(chrome.runtime.getURL('indeed.html'))) {
          await chrome.tabs.update(saved, { url: url.href, active: true });
          return true;
        }
      }
      const tab = await chrome.tabs.create({ url: url.href, windowId: sender.tab.windowId });
      await chrome.storage.session.set({ [key]: tab.id });
    } else await chrome.tabs.create({ url: url.href, windowId: sender.tab.windowId });
    return true;
  }).then(reply, () => reply(false));
  return true;
});
