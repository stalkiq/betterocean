/**
 * BetterOcean chat proxy for DigitalOcean Gradient Serverless Inference.
 * CommonJS action format is used for maximum OpenWhisk compatibility.
 */
const https = require("https");

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

function parseRequestMessages(event) {
  if (!event || typeof event !== "object") return null;

  if (Array.isArray(event.messages)) return event.messages;

  // Common App Platform web action shape.
  if (event.body && typeof event.body === "object" && Array.isArray(event.body.messages)) {
    return event.body.messages;
  }

  // Fallback for raw OpenWhisk body pass-through.
  if (typeof event.__ow_body === "string") {
    try {
      const parsed = JSON.parse(event.__ow_body);
      if (Array.isArray(parsed.messages)) return parsed.messages;
    } catch {
      return null;
    }
  }

  return null;
}

function httpsPostJson(url, requestBody, headers) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const payload = JSON.stringify(requestBody);
    const req = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode || 500,
              data: raw ? JSON.parse(raw) : {},
            });
          } catch {
            resolve({
              status: res.statusCode || 500,
              data: { error: raw || "Non-JSON response from upstream" },
            });
          }
        });
      }
    );

    // Hard timeout so App Platform does not hit 60s gateway timeout.
    req.setTimeout(25000, () => {
      req.destroy(new Error("Upstream request timed out"));
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

exports.main = async function main(event = {}) {
  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const apiKey = process.env.GRADIENT_AGENT_KEY;

  if (!endpoint || !apiKey) {
    return jsonResponse(503, {
      error: "Gradient AI is not configured. Missing endpoint or key.",
    });
  }

  const messages = parseRequestMessages(event);
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, {
      error: "Request body must include a non-empty messages array.",
    });
  }

  const base = endpoint.replace(/\/+$/, "");
  const completionsUrl = base.includes("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  try {
    const upstream = await httpsPostJson(
      completionsUrl,
      {
        model: process.env.GRADIENT_MODEL || "openai-gpt-oss-120b",
        messages,
        stream: false,
      },
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      }
    );

    if (upstream.status < 200 || upstream.status >= 300) {
      const message =
        upstream.data?.error?.message ||
        upstream.data?.message ||
        upstream.data?.error ||
        `Gradient returned status ${upstream.status}`;
      return jsonResponse(upstream.status, { error: String(message) });
    }

    const reply = upstream.data?.choices?.[0]?.message?.content;
    return jsonResponse(200, { reply: reply != null ? String(reply) : "" });
  } catch (err) {
    return jsonResponse(502, {
      error: err && err.message ? err.message : "Gradient request failed",
    });
  }
};
