const express = require("express");
const https = require("https");

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.use(express.json({ limit: "1mb" }));

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}

function postJson(url, requestBody, headers) {
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
            resolve({ status: res.statusCode || 500, data: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({
              status: res.statusCode || 500,
              data: { error: raw || "Non-JSON response from upstream" },
            });
          }
        });
      }
    );

    req.setTimeout(25000, () => {
      req.destroy(new Error("Upstream request timed out"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function readMessages(req) {
  if (Array.isArray(req.body?.messages)) return req.body.messages;
  return null;
}

app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.set(jsonHeaders()).status(204).send();
    return;
  }
  next();
});

app.get("/healthz", (_req, res) => {
  res.set(jsonHeaders()).status(200).json({ ok: true, service: "betterocean-api-service" });
});

async function handleChat(req, res) {
  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;

  if (!endpoint || !key) {
    res
      .set(jsonHeaders())
      .status(503)
      .json({ error: "Gradient AI is not configured. Missing endpoint or key." });
    return;
  }

  const messages = readMessages(req);
  if (!Array.isArray(messages) || messages.length === 0) {
    res
      .set(jsonHeaders())
      .status(400)
      .json({ error: "Request body must include a non-empty messages array." });
    return;
  }

  const base = endpoint.replace(/\/+$/, "");
  const completionsUrl = base.includes("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  try {
    const upstream = await postJson(
      completionsUrl,
      {
        model: process.env.GRADIENT_MODEL || "openai-gpt-oss-120b",
        messages,
        stream: false,
      },
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      }
    );

    if (upstream.status < 200 || upstream.status >= 300) {
      const message =
        upstream.data?.error?.message ||
        upstream.data?.message ||
        upstream.data?.error ||
        `Gradient returned status ${upstream.status}`;
      res.set(jsonHeaders()).status(upstream.status).json({ error: String(message) });
      return;
    }

    const reply = upstream.data?.choices?.[0]?.message?.content;
    res.set(jsonHeaders()).status(200).json({ reply: reply != null ? String(reply) : "" });
  } catch (err) {
    res
      .set(jsonHeaders())
      .status(502)
      .json({ error: err && err.message ? err.message : "Gradient request failed" });
  }
}

// With ingress /api -> service, /api/chat/message becomes /chat/message on this service.
app.post("/chat/message", handleChat);
// Fallback for direct service testing without ingress trim.
app.post("/api/chat/message", handleChat);

app.listen(PORT, () => {
  console.log(`API service listening on port ${PORT}`);
});
