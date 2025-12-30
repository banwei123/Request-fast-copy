(() => {
  const settings = {
    enabled: true
  };

  function updateSettings(payload) {
    if (!payload) {
      return;
    }
    if (typeof payload.enabled === "boolean") {
      settings.enabled = payload.enabled;
    }
  }

  function postMessage(type, payload) {
    if (!settings.enabled) {
      return;
    }
    window.postMessage(
      {
        source: "RFS_PAGE",
        type,
        payload
      },
      "*"
    );
  }

  function stringifyBody(body) {
    if (body === null || body === undefined) {
      return null;
    }
    if (typeof body === "string") {
      return body;
    }
    if (body instanceof URLSearchParams) {
      return body.toString();
    }
    if (body instanceof FormData) {
      const entries = [];
      body.forEach((value, key) => {
        entries.push(`${key}=${value}`);
      });
      return entries.join("&");
    }
    try {
      return JSON.stringify(body);
    } catch (error) {
      return String(body);
    }
  }

  function extractTraceId(args) {
    const regex = /traceID\s*:\s*"?([A-Za-z0-9._-]+)"?/;
    for (const arg of args) {
      if (typeof arg === "string") {
        const match = arg.match(regex);
        if (match) {
          return match[1];
        }
      } else {
        try {
          const text = JSON.stringify(arg);
          const match = text.match(regex);
          if (match) {
            return match[1];
          }
        } catch (error) {
          continue;
        }
      }
    }
    return null;
  }

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = async function (...args) {
      const [input, init] = args;
      const method = (init && init.method) || (input && input.method) || "GET";
      const url = typeof input === "string" ? input : input?.url;
      const requestBody = stringifyBody(init?.body);
      const ts = Date.now();

      try {
        const response = await originalFetch.apply(this, args);
        let responseBody = null;
        try {
          const clone = response.clone();
          responseBody = await clone.text();
        } catch (error) {
          responseBody = null;
        }
        postMessage("RFS_REQUEST", {
          ts,
          method,
          url,
          status: response.status,
          requestBody,
          responseBody
        });
        return response;
      } catch (error) {
        postMessage("RFS_REQUEST", {
          ts,
          method,
          url,
          status: 0,
          requestBody,
          responseBody: null
        });
        throw error;
      }
    };
  }

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rfsMethod = method;
    this.__rfsUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.__rfsRequestBody = stringifyBody(body);
    const ts = Date.now();

    const handleReadyState = () => {
      if (this.readyState !== 4) {
        return;
      }
      let responseBody = null;
      if (this.responseType === "" || this.responseType === "text") {
        responseBody = this.responseText;
      } else if (this.responseType === "json") {
        try {
          responseBody = JSON.stringify(this.response);
        } catch (error) {
          responseBody = null;
        }
      }
      postMessage("RFS_REQUEST", {
        ts,
        method: this.__rfsMethod || "GET",
        url: this.__rfsUrl,
        status: this.status,
        requestBody: this.__rfsRequestBody,
        responseBody
      });
      this.removeEventListener("readystatechange", handleReadyState);
    };

    this.addEventListener("readystatechange", handleReadyState);
    return originalXHRSend.call(this, body);
  };

  const consoleMethods = ["log", "info", "warn", "error"];
  consoleMethods.forEach((method) => {
    const original = console[method];
    console[method] = function (...args) {
      const traceId = extractTraceId(args);
      if (traceId) {
        postMessage("RFS_TRACE", {
          traceId,
          ts: Date.now()
        });
      }
      return original.apply(this, args);
    };
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== "RFS" || data.type !== "RFS_SETTINGS") {
      return;
    }
    updateSettings(data.payload);
  });
})();
