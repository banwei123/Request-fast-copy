const DEFAULT_SETTINGS = {
  enabled: true,
  maxItems: 20,
  maxBodySizeKB: 200,
  traceBindWindowSec: 5,
  blocklist: [
    "*.js",
    "*.css",
    "*.map",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.svg",
    "*.ico",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.mp4",
    "*.mp3",
    "*heartbeat*",
    "*health*",
    "*ping*",
    "*keepalive*",
    "*poll*",
    "*longpoll*",
    "*/conf/*",
    "*/config/*",
    "*getConfig*",
    "*configValue*",
    "*/dictionary/*",
    "*/dict/*",
    "*track*",
    "*tracking*",
    "*event*",
    "*analytics*",
    "*monitor*",
    "*metric*",
    "*report*",
    "*log/collect*",
    "*sentry*",
    "*/favicon.ico*",
    "*/sockjs-node*",
    "*/ws*",
    "*/websocket*"
  ]
};

const snapshotsByTab = new Map();

function getTabState(tabId) {
  if (!snapshotsByTab.has(tabId)) {
    snapshotsByTab.set(tabId, { snapshots: [] });
  }
  return snapshotsByTab.get(tabId);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    const toSet = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (items[key] === undefined) {
        toSet[key] = value;
      }
    }
    if (Object.keys(toSet).length > 0) {
      chrome.storage.sync.set(toSet);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  snapshotsByTab.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  const tabId = message.tabId ?? sender.tab?.id;
  if (tabId === undefined) {
    return;
  }

  if (message.type === "RFS_SNAPSHOT") {
    const state = getTabState(tabId);
    state.snapshots.push(message.snapshot);
    const maxItems = Number(message.maxItems) || DEFAULT_SETTINGS.maxItems;
    if (state.snapshots.length > maxItems) {
      state.snapshots.splice(0, state.snapshots.length - maxItems);
    }
    return;
  }

  if (message.type === "RFS_TRACE") {
    const state = getTabState(tabId);
    const now = message.ts || Date.now();
    const windowMs = (Number(message.traceBindWindowSec) || DEFAULT_SETTINGS.traceBindWindowSec) * 1000;
    let bound = false;

    for (let i = state.snapshots.length - 1; i >= 0; i -= 1) {
      const snapshot = state.snapshots[i];
      if (snapshot.envType !== "H5") {
        continue;
      }
      if (snapshot.ts && snapshot.ts >= now - windowMs) {
        snapshot.traceId = snapshot.traceId || message.traceId;
        bound = true;
        break;
      }
      if (snapshot.ts && snapshot.ts < now - windowMs) {
        break;
      }
    }

    if (!bound) {
      const traceOnly = {
        id: crypto.randomUUID(),
        ts: now,
        envType: "TRACE_ONLY",
        path: "(trace only)",
        traceId: message.traceId
      };
      state.snapshots.push(traceOnly);
      const maxItems = Number(message.maxItems) || DEFAULT_SETTINGS.maxItems;
      if (state.snapshots.length > maxItems) {
        state.snapshots.splice(0, state.snapshots.length - maxItems);
      }
    }
    return;
  }

  if (message.type === "RFS_GET_SNAPSHOTS") {
    const state = getTabState(tabId);
    sendResponse({ snapshots: state.snapshots });
  }
});
