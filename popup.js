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

const toggleEnabled = document.getElementById("toggle-enabled");
const maxItemsInput = document.getElementById("max-items");
const maxBodyInput = document.getElementById("max-body");
const traceWindowInput = document.getElementById("trace-window");
const blocklistInput = document.getElementById("blocklist");
const snapshotList = document.getElementById("snapshot-list");
const refreshButton = document.getElementById("refresh");

function formatTime(ts) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDisplayValue(type, value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (type === "JSON") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function createCopyButton(label, text, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (disabled) {
    button.disabled = true;
  }
  button.addEventListener("click", async () => {
    if (!text) {
      return;
    }
    await navigator.clipboard.writeText(text);
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 800);
  });
  return button;
}

function renderSnapshots(snapshots) {
  snapshotList.innerHTML = "";
  if (!snapshots || snapshots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无请求快照";
    snapshotList.appendChild(empty);
    return;
  }

  const reversed = [...snapshots].reverse();
  reversed.forEach((snapshot) => {
    const details = document.createElement("details");
    details.className = "snapshot";

    const summary = document.createElement("summary");
    summary.className = "summary";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span class="time">${formatTime(snapshot.ts)}</span>
      <span class="method">${snapshot.method || "-"}</span>
      <span class="status">${snapshot.status ?? "-"}</span>
    `;

    const envTag = document.createElement("span");
    envTag.className = `env ${snapshot.envType?.toLowerCase() || ""}`;
    envTag.textContent = snapshot.envType || "-";

    const path = document.createElement("div");
    path.className = "path";
    path.textContent = snapshot.path || "";

    const trace = document.createElement("div");
    trace.className = "trace";
    trace.textContent = snapshot.traceId ? `traceID: ${snapshot.traceId}` : "traceID: -";

    summary.appendChild(meta);
    summary.appendChild(envTag);
    summary.appendChild(path);
    summary.appendChild(trace);

    const body = document.createElement("div");
    body.className = "body";

    const copyRow = document.createElement("div");
    copyRow.className = "copy-row";
    copyRow.appendChild(createCopyButton("Copy Path", snapshot.path, !snapshot.path));

    const isAdmin = snapshot.envType === "ADMIN";
    const requestText = toDisplayValue(snapshot.requestPayloadType, snapshot.requestPayload);
    const responseText = toDisplayValue(snapshot.responseBodyType, snapshot.responseBody);

    copyRow.appendChild(
      createCopyButton("Copy Request", requestText, !isAdmin || !requestText)
    );
    copyRow.appendChild(
      createCopyButton("Copy Response", responseText, !isAdmin || !responseText)
    );
    copyRow.appendChild(
      createCopyButton("Copy traceID", snapshot.traceId, !snapshot.traceId)
    );

    const requestBlock = document.createElement("div");
    requestBlock.className = "payload";
    requestBlock.innerHTML = `
      <h4>Request Payload</h4>
      <pre>${requestText || (isAdmin ? "(empty)" : "加密不可用")}</pre>
    `;

    const responseBlock = document.createElement("div");
    responseBlock.className = "payload";
    responseBlock.innerHTML = `
      <h4>Response Body</h4>
      <pre>${responseText || (isAdmin ? "(empty)" : "加密不可用")}</pre>
    `;

    body.appendChild(copyRow);
    body.appendChild(requestBlock);
    body.appendChild(responseBlock);

    details.appendChild(summary);
    details.appendChild(body);
    snapshotList.appendChild(details);
  });
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    toggleEnabled.checked = Boolean(items.enabled);
    maxItemsInput.value = items.maxItems;
    maxBodyInput.value = items.maxBodySizeKB;
    traceWindowInput.value = items.traceBindWindowSec;
    blocklistInput.value = (items.blocklist || []).join("\n");
  });
}

function saveSettings() {
  const maxItems = Math.min(Math.max(Number(maxItemsInput.value) || 20, 10), 200);
  const maxBodySizeKB = Math.min(Math.max(Number(maxBodyInput.value) || 200, 10), 1024);
  const traceBindWindowSec = Math.min(Math.max(Number(traceWindowInput.value) || 5, 1), 60);
  const blocklist = blocklistInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  chrome.storage.sync.set({
    enabled: toggleEnabled.checked,
    maxItems,
    maxBodySizeKB,
    traceBindWindowSec,
    blocklist
  });
}

async function loadSnapshots() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    renderSnapshots([]);
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "RFS_GET_SNAPSHOTS",
      tabId: tab.id
    },
    (response) => {
      renderSnapshots(response?.snapshots || []);
    }
  );
}

[toggleEnabled, maxItemsInput, maxBodyInput, traceWindowInput].forEach((input) => {
  input.addEventListener("change", () => {
    saveSettings();
  });
});

blocklistInput.addEventListener("blur", () => {
  saveSettings();
});

refreshButton.addEventListener("click", () => {
  loadSnapshots();
});

loadSettings();
loadSnapshots();
