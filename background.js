// Opens every incomplete non-quiz, non-feedback activity in the #Module
// sections in a background tab, one every 5 seconds. Each tab closes itself as
// soon as it finishes loading (visiting the page is what marks it as viewed).

const OPEN_INTERVAL_MS = 5000;
const TAB_MAX_LIFETIME_MS = 30000; // close even if "complete" never fires (e.g. a download)

// { items: [{url, name}], index, sourceTabId, timer }
let run = null;
const openedTabs = new Set();

function closeTab(tabId) {
  loadingTabs.delete(tabId);
  if (!openedTabs.delete(tabId)) return;
  chrome.tabs.remove(tabId).catch(() => {});
}

// Tabs that have started loading their page. Without the "tabs" permission
// `tab.url` isn't exposed here, so instead of checking the URL we only close on
// a "complete" that follows a "loading" (skips any initial about:blank complete).
const loadingTabs = new Set();

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!openedTabs.has(tabId)) return;
  if (info.status === 'loading') loadingTabs.add(tabId);
  if (info.status === 'complete' && loadingTabs.has(tabId)) closeTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openedTabs.delete(tabId);
  // Stop if the tab that started the run goes away.
  if (run && run.sourceTabId === tabId) stopPages();
});

async function openNext() {
  if (!run) return;
  if (run.index >= run.items.length) {
    run = null;
    return;
  }
  const item = run.items[run.index++];
  try {
    const source = await chrome.tabs.get(run.sourceTabId);
    const tab = await chrome.tabs.create({
      url: item.url,
      active: false,
      index: source.index + 1,
      windowId: source.windowId,
    });
    openedTabs.add(tab.id);
    // The first "loading" event may fire before we get here.
    if (tab.status === 'loading') loadingTabs.add(tab.id);
    setTimeout(() => closeTab(tab.id), TAB_MAX_LIFETIME_MS);
  } catch (_) {
    stopPages();
    return;
  }
  if (run) run.timer = setTimeout(openNext, OPEN_INTERVAL_MS);
}

function startPages(tabId, items) {
  stopPages();
  run = { items, index: 0, sourceTabId: tabId, timer: null };
  openNext();
  return items.length;
}

function stopPages() {
  if (run?.timer) clearTimeout(run.timer);
  run = null;
}

function pagesStatus() {
  if (!run) return { running: false };
  return { running: true, done: run.index, total: run.items.length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'startPages':
      sendResponse({ total: startPages(sender.tab.id, msg.items ?? []) });
      return false;
    case 'stopPages':
      stopPages();
      sendResponse({ ok: true });
      return false;
    case 'pagesStatus':
      sendResponse(pagesStatus());
      return false;
    default:
      return false;
  }
});
