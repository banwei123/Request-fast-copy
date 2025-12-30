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

function getStorageKey(tabId) {
  return `rfs_snapshots_${tabId}`;
}

async function readSnapshots(tabId) {
  const key = getStorageKey(tabId);
  const result = await chrome.storage.session.get({ [key]: [] });
  return result[key] || [];
}

async function writeSnapshots(tabId, snapshots) {
  const key = getStorageKey(tabId);
  await chrome.storage.session.set({ [key]: snapshots });
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
  const key = getStorageKey(tabId);
  chrome.storage.session.remove(key);
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
    (async () => {
      const snapshots = await readSnapshots(tabId);
      snapshots.push(message.snapshot);
      const maxItems = Number(message.maxItems) || DEFAULT_SETTINGS.maxItems;
      if (snapshots.length > maxItems) {
        snapshots.splice(0, snapshots.length - maxItems);
      }
      await writeSnapshots(tabId, snapshots);
    })();
    return;
  }

  if (message.type === "RFS_TRACE") {
    (async () => {
      const snapshots = await readSnapshots(tabId);
      const now = message.ts || Date.now();
      const windowMs =
        (Number(message.traceBindWindowSec) || DEFAULT_SETTINGS.traceBindWindowSec) * 1000;
      let bound = false;

      for (let i = snapshots.length - 1; i >= 0; i -= 1) {
        const snapshot = snapshots[i];
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
        snapshots.push(traceOnly);
        const maxItems = Number(message.maxItems) || DEFAULT_SETTINGS.maxItems;
        if (snapshots.length > maxItems) {
          snapshots.splice(0, snapshots.length - maxItems);
        }
      }
      await writeSnapshots(tabId, snapshots);
    })();
    return;
  }

  if (message.type === "RFS_GET_SNAPSHOTS") {
    (async () => {
      const snapshots = await readSnapshots(tabId);
      sendResponse({ snapshots });
    })();
    return true;
  }
});
