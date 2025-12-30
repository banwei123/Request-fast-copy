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

let settings = { ...DEFAULT_SETTINGS };
const envType = window.location.hostname.toLowerCase().includes("admin") ? "ADMIN" : "H5";
let extensionAlive = true;

function isExtensionAvailable() {
  if (!extensionAlive) {
    return false;
  }
  try {
    return Boolean(chrome?.runtime?.id);
  } catch (error) {
    extensionAlive = false;
    return false;
  }
}

function safeSendMessage(payload) {
  if (!isExtensionAvailable()) {
    return;
  }
  try {
    chrome.runtime.sendMessage(payload, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Extension context invalidated (e.g., reload/uninstall).
    extensionAlive = false;
  }
}

function postSettingsToPage() {
  window.postMessage(
    {
      source: "RFS",
      type: "RFS_SETTINGS",
      payload: {
        enabled: settings.enabled
      }
    },
    "*"
  );
}

function injectPageHook() {
  if (!isExtensionAvailable()) {
    return;
  }
  const script = document.createElement("script");
  try {
    script.src = chrome.runtime.getURL("pageHook.js");
  } catch (error) {
    extensionAlive = false;
    return;
  }
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

function loadSettings() {
  if (!isExtensionAvailable()) {
    return;
  }
  try {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      settings = { ...settings, ...items };
      postSettingsToPage();
    });
  } catch (error) {
    extensionAlive = false;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBlocked(path) {
  if (!settings.blocklist || settings.blocklist.length === 0) {
    return false;
  }
  return settings.blocklist.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return false;
    }
    const regex = new RegExp(`^${escapeRegex(trimmed).replace(/\\\*/g, ".*")}$`, "i");
    return regex.test(path);
  });
}

function buildPath(url) {
  const parsed = new URL(url, window.location.href);
  const search = parsed.search || "";
  const pathname = parsed.pathname || "";
  const resourceIndex = pathname.indexOf("/resource/");
  if (resourceIndex >= 0) {
    return `${pathname.slice(resourceIndex)}${search}`;
  }
  return `${pathname}${search}`;
}

function limitText(text) {
  if (text === null || text === undefined) {
    return { text: null, truncated: false };
  }
  const limit = Math.max(Number(settings.maxBodySizeKB) || 0, 0) * 1024;
  if (limit > 0 && text.length > limit) {
    return {
      text: `${text.slice(0, limit)}\n... [truncated]`,
      truncated: true
    };
  }
  return { text, truncated: false };
}

function parsePayload(payload) {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (typeof payload !== "string") {
    return {
      type: "JSON",
      value: payload
    };
  }
  try {
    const parsed = JSON.parse(payload);
    return {
      type: "JSON",
      value: parsed
    };
  } catch (error) {
    return {
      type: "TEXT",
      value: payload
    };
  }
}

function normalizePayload(input) {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === "string") {
    return input;
  }
  try {
    return JSON.stringify(input);
  } catch (error) {
    return String(input);
  }
}

function handleRequestMessage(payload) {
  try {
    if (!settings.enabled) {
      return;
    }
    const fullUrl = payload.url;
    if (!fullUrl) {
      return;
    }
    const path = buildPath(fullUrl);
    if (isBlocked(path)) {
      return;
    }

    const snapshot = {
      id: crypto.randomUUID(),
      ts: payload.ts || Date.now(),
      envType,
      method: payload.method,
      fullUrl,
      path,
      status: payload.status
    };

    if (envType === "ADMIN") {
      const requestText = normalizePayload(payload.requestBody);
      const requestLimited = limitText(requestText || "");
      if (requestLimited.text !== null && requestLimited.text !== "") {
        const requestParsed = requestLimited.truncated
          ? { type: "TEXT", value: requestLimited.text }
          : parsePayload(requestLimited.text);
        snapshot.requestPayloadType = requestParsed.type;
        snapshot.requestPayload = requestParsed.value;
      }

      const responseText = normalizePayload(payload.responseBody);
      const responseLimited = limitText(responseText || "");
      if (responseLimited.text !== null && responseLimited.text !== "") {
        const responseParsed = responseLimited.truncated
          ? { type: "TEXT", value: responseLimited.text }
          : parsePayload(responseLimited.text);
        snapshot.responseBodyType = responseParsed.type;
        snapshot.responseBody = responseParsed.value;

        if (responseParsed.type === "JSON") {
          const traceId = responseParsed.value?.extraData?.traceID;
          if (traceId) {
            snapshot.traceId = traceId;
          }
        }
      }
    }

    safeSendMessage({
      type: "RFS_SNAPSHOT",
      snapshot,
      maxItems: settings.maxItems
    });
  } catch (error) {
    if (String(error).includes("Extension context invalidated")) {
      extensionAlive = false;
    }
  }
}

function handleTraceMessage(payload) {
  try {
    if (!settings.enabled) {
      return;
    }
    if (envType !== "H5") {
      return;
    }
    if (!payload?.traceId) {
      return;
    }
    safeSendMessage({
      type: "RFS_TRACE",
      traceId: payload.traceId,
      ts: payload.ts || Date.now(),
      traceBindWindowSec: settings.traceBindWindowSec,
      maxItems: settings.maxItems
    });
  } catch (error) {
    if (String(error).includes("Extension context invalidated")) {
      extensionAlive = false;
    }
  }
}

injectPageHook();
loadSettings();

if (isExtensionAvailable()) {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") {
        return;
      }
      for (const [key, change] of Object.entries(changes)) {
        settings[key] = change.newValue;
      }
      postSettingsToPage();
    });
  } catch (error) {
    extensionAlive = false;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  if (!data || data.source !== "RFS_PAGE") {
    return;
  }
  if (data.type === "RFS_REQUEST") {
    handleRequestMessage(data.payload);
  }
  if (data.type === "RFS_TRACE") {
    handleTraceMessage(data.payload);
  }
});
