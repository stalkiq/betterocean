const crypto = require("crypto");
const express = require("express");
const https = require("https");
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  tokenWillExpireSoon,
  schwabApiRequest,
  assertCredentials,
} = require("./schwab-client");

const app = express();
const PORT = Number(process.env.PORT || 8080);
const CLIENT_APP_URL = process.env.CLIENT_APP_URL || "/";
const SESSION_COOKIE_NAME = "bo_session";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const MAX_ORDER_QTY = Number(process.env.SCHWAB_MAX_ORDER_QTY || 1000);

const sessionStore = new Map();

app.use(express.json({ limit: "1mb" }));

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
}

function readCookieMap(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    cookies[k] = decodeURIComponent(v.join("=") || "");
  });
  return cookies;
}

function makeSignedCookieValue(sessionId) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex");
  return `${sessionId}.${sig}`;
}

function verifySignedCookieValue(value) {
  if (!value || !value.includes(".")) return null;
  const [sessionId, sig] = value.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex");
  if (sig !== expected) return null;
  return sessionId;
}

function getCookieBaseAttributes() {
  const isSecure =
    process.env.NODE_ENV === "production" || String(process.env.FORCE_SECURE_COOKIE || "") === "true";
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isSecure ? "Secure" : "",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function setSessionCookie(res, sessionId) {
  const value = makeSignedCookieValue(sessionId);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; ${getCookieBaseAttributes()}`);
}

function clearSessionCookie(res) {
  const isSecure =
    process.env.NODE_ENV === "production" || String(process.env.FORCE_SECURE_COOKIE || "") === "true";
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", isSecure ? "Secure" : "", "Max-Age=0"]
    .filter(Boolean)
    .join("; ");
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; ${attrs}`);
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sid, session] of sessionStore.entries()) {
    if (!session || !session.lastSeenAt || now - session.lastSeenAt > SESSION_TTL_MS) {
      sessionStore.delete(sid);
    }
  }
}

function getOrCreateSession(req, res) {
  cleanupExpiredSessions();
  const cookies = readCookieMap(req.headers.cookie || "");
  const signed = cookies[SESSION_COOKIE_NAME];
  const existingSessionId = verifySignedCookieValue(signed);

  if (existingSessionId && sessionStore.has(existingSessionId)) {
    const session = sessionStore.get(existingSessionId);
    session.lastSeenAt = Date.now();
    req.sessionId = existingSessionId;
    req.session = session;
    setSessionCookie(res, existingSessionId);
    return;
  }

  const newSessionId = crypto.randomUUID();
  const newSession = { createdAt: Date.now(), lastSeenAt: Date.now() };
  sessionStore.set(newSessionId, newSession);
  req.sessionId = newSessionId;
  req.session = newSession;
  setSessionCookie(res, newSessionId);
}

function sendJson(res, statusCode, payload) {
  res.set(jsonHeaders()).status(statusCode).json(payload);
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

function getText(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 500, data: raw });
        });
      }
    );

    req.setTimeout(15000, () => req.destroy(new Error("Market data request timed out")));
    req.on("error", reject);
    req.end();
  });
}

function parseStooqCsv(csvText) {
  const lines = String(csvText || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const symbolIdx = idx("symbol");
  const openIdx = idx("open");
  const highIdx = idx("high");
  const lowIdx = idx("low");
  const closeIdx = idx("close");
  const volumeIdx = idx("volume");
  const dateIdx = idx("date");

  const labelBySymbol = {
    "SPY.US": "S&P 500 ETF (SPY)",
    "QQQ.US": "Nasdaq 100 ETF (QQQ)",
    "IWM.US": "Russell 2000 ETF (IWM)",
    "DIA.US": "Dow ETF (DIA)",
    "GLD.US": "Gold ETF (GLD)",
    "TLT.US": "20Y Treasury ETF (TLT)",
  };

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const symbol = String(cols[symbolIdx] || "").toUpperCase();
    const open = Number(cols[openIdx] || 0);
    const high = Number(cols[highIdx] || 0);
    const low = Number(cols[lowIdx] || 0);
    const close = Number(cols[closeIdx] || 0);
    const volume = Number(cols[volumeIdx] || 0);
    const date = cols[dateIdx] || null;

    return {
      symbol,
      label: labelBySymbol[symbol] || symbol,
      open,
      high,
      low,
      close,
      volume,
      date,
    };
  });
}

async function fetchStooqQuote(symbol, label) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const upstream = await getText(url);
  if (upstream.status < 200 || upstream.status >= 300) {
    throw new Error(`Quote fetch failed for ${symbol} (${upstream.status})`);
  }

  const lines = String(upstream.data || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines[1].split(",");
  if (cols.length < 8) return null;

  const open = Number(cols[3] || 0);
  const high = Number(cols[4] || 0);
  const low = Number(cols[5] || 0);
  const close = Number(cols[6] || 0);
  const volume = Number(cols[7] || 0);

  if (!Number.isFinite(close) || close <= 0) return null;

  return {
    symbol: String(cols[0] || symbol).toUpperCase(),
    label,
    open,
    high,
    low,
    close,
    volume,
    date: cols[1] || null,
  };
}

function readMessages(req) {
  if (Array.isArray(req.body?.messages)) return req.body.messages;
  return null;
}

async function ensureSchwabAccessToken(session) {
  if (!session.schwabTokens) {
    const err = new Error("Schwab session not connected.");
    err.status = 401;
    throw err;
  }

  if (!tokenWillExpireSoon(session.schwabTokens, 60)) {
    return session.schwabTokens.accessToken;
  }

  const refreshed = await refreshAccessToken(session.schwabTokens.refreshToken);
  session.schwabTokens = refreshed;
  return refreshed.accessToken;
}

async function schwabRequestWithSession(session, method, path, query, body) {
  await ensureSchwabAccessToken(session);
  let result = await schwabApiRequest(session.schwabTokens, method, path, query, body);

  // One retry after refresh if token became invalid.
  if (result.status === 401 && session.schwabTokens?.refreshToken) {
    const refreshed = await refreshAccessToken(session.schwabTokens.refreshToken);
    session.schwabTokens = refreshed;
    result = await schwabApiRequest(session.schwabTokens, method, path, query, body);
  }
  return result;
}

function requireSchwabAuth(req, res, next) {
  if (!req.session?.schwabConnected || !req.session?.schwabTokens) {
    sendJson(res, 401, { error: "Schwab login required." });
    return;
  }
  next();
}

function sanitizeSessionSummary(session) {
  return {
    connected: Boolean(session?.schwabConnected),
    connectedAt: session?.schwabConnectedAt || null,
    accountHash: session?.primaryAccountHash || null,
    accountNumber: session?.primaryAccountNumber || null,
    accountCount: Array.isArray(session?.accountNumbers) ? session.accountNumbers.length : 0,
  };
}

function extractMaxQuantityFromOrder(order) {
  if (!order || typeof order !== "object") return 0;
  let maxQty = 0;

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (typeof node.quantity === "number" && Number.isFinite(node.quantity)) {
      maxQty = Math.max(maxQty, node.quantity);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  }

  walk(order);
  return maxQty;
}

app.use((req, res, next) => {
  getOrCreateSession(req, res);
  if (req.method === "OPTIONS") {
    res.set(jsonHeaders()).status(204).send();
    return;
  }
  next();
});

app.get("/healthz", (_req, res) => {
  sendJson(res, 200, { ok: true, service: "betterocean-api-service" });
});

app.get(["/market/overview", "/api/market/overview"], async (_req, res) => {
  const symbols = [
    { symbol: "spy.us", label: "S&P 500 ETF (SPY)" },
    { symbol: "qqq.us", label: "Nasdaq 100 ETF (QQQ)" },
    { symbol: "iwm.us", label: "Russell 2000 ETF (IWM)" },
    { symbol: "dia.us", label: "Dow ETF (DIA)" },
    { symbol: "gld.us", label: "Gold ETF (GLD)" },
    { symbol: "tlt.us", label: "20Y Treasury ETF (TLT)" },
  ];
  try {
    const assets = (
      await Promise.all(
        symbols.map(({ symbol, label }) =>
          fetchStooqQuote(symbol, label).catch(() => null)
        )
      )
    ).filter(Boolean);
    sendJson(res, 200, {
      source: "stooq",
      updatedAt: new Date().toISOString(),
      assets,
    });
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Failed to load market overview data." });
  }
});

async function handleChat(req, res) {
  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;

  if (!endpoint || !key) {
    sendJson(res, 503, { error: "Gradient AI is not configured. Missing endpoint or key." });
    return;
  }

  const messages = readMessages(req);
  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: "Request body must include a non-empty messages array." });
    return;
  }

  const base = endpoint.replace(/\/+$/, "");
  const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

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
      sendJson(res, upstream.status, { error: String(message) });
      return;
    }

    const reply = upstream.data?.choices?.[0]?.message?.content;
    sendJson(res, 200, { reply: reply != null ? String(reply) : "" });
  } catch (err) {
    sendJson(res, 502, { error: err && err.message ? err.message : "Gradient request failed" });
  }
}

app.post("/chat/message", handleChat);
app.post("/api/chat/message", handleChat);

app.get("/schwab/login", (req, res) => {
  try {
    assertCredentials();
    const state = crypto.randomUUID();
    req.session.oauthState = state;
    req.session.oauthStartedAt = Date.now();
    const authorizeUrl = buildAuthorizeUrl(state);
    res.redirect(authorizeUrl);
  } catch (err) {
    sendJson(res, 503, { error: err.message || "Schwab OAuth is not configured." });
  }
});

app.get("/api/schwab/login", (req, res) => {
  res.redirect("/schwab/login");
});

app.get("/schwab/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    const target = `${CLIENT_APP_URL}?schwab=error&reason=${encodeURIComponent(
      errorDescription || String(error)
    )}`;
    res.redirect(target);
    return;
  }

  if (!code || !state || !req.session.oauthState || String(state) !== String(req.session.oauthState)) {
    res.redirect(`${CLIENT_APP_URL}?schwab=error&reason=${encodeURIComponent("Invalid OAuth state.")}`);
    return;
  }

  try {
    const tokenBundle = await exchangeCodeForToken(String(code));
    req.session.schwabTokens = tokenBundle;
    req.session.schwabConnected = true;
    req.session.schwabConnectedAt = new Date().toISOString();
    delete req.session.oauthState;
    delete req.session.oauthStartedAt;

    const accountResult = await schwabRequestWithSession(req.session, "GET", "/accounts/accountNumbers");
    if (accountResult.status >= 200 && accountResult.status < 300 && Array.isArray(accountResult.data)) {
      req.session.accountNumbers = accountResult.data;
      if (accountResult.data[0]) {
        req.session.primaryAccountNumber = accountResult.data[0].accountNumber || null;
        req.session.primaryAccountHash = accountResult.data[0].hashValue || null;
      }
    }

    res.redirect(`${CLIENT_APP_URL}?schwab=connected`);
  } catch (err) {
    res.redirect(`${CLIENT_APP_URL}?schwab=error&reason=${encodeURIComponent(err.message || "OAuth failed")}`);
  }
});

app.get("/api/schwab/callback", (req, res) => {
  const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(`/schwab/callback${q}`);
});

app.get("/schwab/me", (req, res) => {
  sendJson(res, 200, sanitizeSessionSummary(req.session));
});

app.get("/api/schwab/me", (req, res) => {
  sendJson(res, 200, sanitizeSessionSummary(req.session));
});

app.post("/schwab/logout", (req, res) => {
  if (req.sessionId) {
    sessionStore.delete(req.sessionId);
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

app.post("/api/schwab/logout", (req, res) => {
  if (req.sessionId) {
    sessionStore.delete(req.sessionId);
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

app.get(["/schwab/accounts", "/api/schwab/accounts"], requireSchwabAuth, async (req, res) => {
  try {
    const result = await schwabRequestWithSession(req.session, "GET", "/accounts", {
      fields: "positions",
    });
    sendJson(res, result.status, result.data);
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to fetch Schwab accounts." });
  }
});

app.get(["/schwab/positions", "/api/schwab/positions"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.query.accountHash || req.session.primaryAccountHash;
  if (!accountHash) {
    sendJson(res, 400, { error: "No account hash available for positions." });
    return;
  }
  try {
    const result = await schwabRequestWithSession(
      req.session,
      "GET",
      `/accounts/${encodeURIComponent(String(accountHash))}`,
      { fields: "positions" }
    );
    const positions = result.data?.securitiesAccount?.positions || result.data?.positions || [];
    sendJson(res, result.status, { accountHash, positions, raw: result.data });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to fetch positions." });
  }
});

app.get(["/schwab/balances", "/api/schwab/balances"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.query.accountHash || req.session.primaryAccountHash;
  if (!accountHash) {
    sendJson(res, 400, { error: "No account hash available for balances." });
    return;
  }
  try {
    const result = await schwabRequestWithSession(
      req.session,
      "GET",
      `/accounts/${encodeURIComponent(String(accountHash))}`
    );
    const balances = result.data?.securitiesAccount?.currentBalances || result.data?.balances || {};
    sendJson(res, result.status, { accountHash, balances, raw: result.data });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to fetch balances." });
  }
});

app.get(["/schwab/orders/open", "/api/schwab/orders/open"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.query.accountHash || req.session.primaryAccountHash;
  if (!accountHash) {
    sendJson(res, 400, { error: "No account hash available for orders." });
    return;
  }
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();
  try {
    const result = await schwabRequestWithSession(
      req.session,
      "GET",
      `/accounts/${encodeURIComponent(String(accountHash))}/orders`,
      {
        fromEnteredTime: from,
        toEnteredTime: to,
        maxResults: req.query.maxResults || 50,
      }
    );
    const orders = Array.isArray(result.data) ? result.data : result.data?.orders || [];
    const openStates = new Set(["WORKING", "QUEUED", "ACCEPTED", "NEW", "AWAITING_PARENT_ORDER"]);
    const openOrders = orders.filter((order) => openStates.has(String(order.status || "").toUpperCase()));
    sendJson(res, result.status, { accountHash, orders: openOrders, rawCount: orders.length });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to fetch open orders." });
  }
});

app.get(["/schwab/quotes", "/api/schwab/quotes"], requireSchwabAuth, async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!symbols.length) {
    sendJson(res, 400, { error: "symbols query param is required (comma-separated)." });
    return;
  }
  try {
    const result = await schwabRequestWithSession(
      req.session,
      "GET",
      "/marketdata/quotes",
      { symbols: symbols.join(","), fields: req.query.fields || "quote" }
    );
    sendJson(res, result.status, result.data);
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to fetch quotes." });
  }
});

app.post(["/schwab/orders", "/api/schwab/orders"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.body?.accountHash || req.session.primaryAccountHash;
  const order = req.body?.order;
  if (!accountHash) {
    sendJson(res, 400, { error: "accountHash is required." });
    return;
  }
  if (!order || typeof order !== "object") {
    sendJson(res, 400, { error: "order object is required." });
    return;
  }

  const maxQty = extractMaxQuantityFromOrder(order);
  if (maxQty > MAX_ORDER_QTY) {
    sendJson(res, 400, {
      error: `Order rejected by guardrail. Quantity ${maxQty} exceeds SCHWAB_MAX_ORDER_QTY (${MAX_ORDER_QTY}).`,
    });
    return;
  }

  if (String(process.env.SCHWAB_DRY_RUN || "").toLowerCase() === "true") {
    sendJson(res, 200, {
      ok: true,
      dryRun: true,
      accountHash,
      maxQty,
      message: "SCHWAB_DRY_RUN is enabled. Order was validated but not sent.",
    });
    return;
  }

  try {
    const result = await schwabRequestWithSession(
      req.session,
      "POST",
      `/accounts/${encodeURIComponent(String(accountHash))}/orders`,
      null,
      order
    );
    sendJson(res, result.status, { ok: result.status >= 200 && result.status < 300, result: result.data });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to place order." });
  }
});

app.delete(["/schwab/orders/:orderId", "/api/schwab/orders/:orderId"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.query.accountHash || req.session.primaryAccountHash;
  const orderId = req.params.orderId;
  if (!accountHash || !orderId) {
    sendJson(res, 400, { error: "accountHash and orderId are required." });
    return;
  }
  try {
    const result = await schwabRequestWithSession(
      req.session,
      "DELETE",
      `/accounts/${encodeURIComponent(String(accountHash))}/orders/${encodeURIComponent(String(orderId))}`
    );
    sendJson(res, result.status, { ok: result.status >= 200 && result.status < 300, result: result.data });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to cancel order." });
  }
});

app.listen(PORT, () => {
  console.log(`API service listening on port ${PORT}`);
});
