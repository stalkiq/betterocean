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
const TICKER_UNIVERSE_TTL_MS = Number(process.env.TICKER_UNIVERSE_TTL_MS || 12 * 60 * 60 * 1000);

const sessionStore = new Map();
const tickerUniverseCache = { symbols: [], fetchedAt: 0 };
const FALLBACK_TICKER_UNIVERSE = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "JPM",
  "XOM",
  "UNH",
  "BRK.B",
  "LLY",
  "AVGO",
  "V",
  "MA",
  "COST",
  "WMT",
  "HD",
  "PG",
  "JNJ",
  "KO",
  "PEP",
  "MRK",
  "ABBV",
  "CRM",
  "NFLX",
  "AMD",
  "INTC",
  "ADBE",
  "QCOM",
  "TMO",
  "ORCL",
  "MCD",
  "BAC",
  "GS",
  "MS",
  "CAT",
  "DE",
  "BA",
  "GE",
  "NKE",
  "DIS",
  "PFE",
  "CVX",
  "SLB",
  "COP",
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "GLD",
  "TLT",
  "XLF",
  "XLE",
  "XLK",
  "XLI",
  "XLY",
  "XLV",
];

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

function normalizeTickerForStooq(rawSymbol) {
  const cleaned = String(rawSymbol || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!cleaned) return "";
  if (cleaned.endsWith(".us")) return cleaned;
  return `${cleaned.replace(/\./g, "-")}.us`;
}

function normalizeTickerSymbol(rawSymbol) {
  return String(rawSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z.\-]/g, "")
    .slice(0, 12);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parseSimpleRss(xmlText) {
  const xml = String(xmlText || "");
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return itemMatches
    .map((itemXml) => {
      const readTag = (tag) => {
        const match = itemXml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return match ? stripHtml(match[1]) : "";
      };
      return {
        title: readTag("title"),
        link: readTag("link"),
        pubDate: readTag("pubDate"),
        source: readTag("source"),
        description: readTag("description"),
      };
    })
    .filter((item) => item.title && item.link);
}

async function fetchTickerNews(symbol, limit = 8) {
  const query = encodeURIComponent(`${symbol} stock market news`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  const upstream = await getText(url);
  if (upstream.status < 200 || upstream.status >= 300) {
    throw new Error(`News feed request failed (${upstream.status})`);
  }
  return parseSimpleRss(upstream.data).slice(0, limit);
}

async function loadSp500TickerUniverse(limit = 500) {
  const now = Date.now();
  if (tickerUniverseCache.symbols.length >= 200 && now - tickerUniverseCache.fetchedAt < TICKER_UNIVERSE_TTL_MS) {
    return tickerUniverseCache.symbols.slice(0, limit);
  }

  const url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
  const upstream = await getText(url);
  if (upstream.status < 200 || upstream.status >= 300) {
    throw new Error(`Ticker universe source failed (${upstream.status})`);
  }
  const html = String(upstream.data || "");
  const tableMatch =
    html.match(/<table[^>]*id="constituents"[^>]*>[\s\S]*?<\/table>/i) ||
    html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error("Ticker universe table not found.");

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const symbols = [];
  rows.slice(1).forEach((row) => {
    const firstCell = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!firstCell) return;
    const raw = stripHtml(firstCell[1]).split(/\s+/)[0];
    const symbol = normalizeTickerSymbol(raw).replace(/-/g, ".");
    if (!symbol) return;
    symbols.push(symbol);
  });

  const unique = [...new Set(symbols)].slice(0, limit);
  if (unique.length < 100) {
    throw new Error("Ticker universe source returned too few symbols.");
  }
  tickerUniverseCache.symbols = unique;
  tickerUniverseCache.fetchedAt = now;
  return unique;
}

function buildTickerReportFallback(symbol, quote, news) {
  const open = Number(quote?.open || 0);
  const close = Number(quote?.close || 0);
  const deltaPct =
    Number.isFinite(open) && open > 0 && Number.isFinite(close) ? (((close - open) / open) * 100).toFixed(2) : null;
  const signal =
    deltaPct == null
      ? "neutral"
      : Number(deltaPct) >= 0.4
        ? "bullish"
        : Number(deltaPct) <= -0.4
          ? "bearish"
          : "neutral";
  return {
    symbol,
    signal,
    confidence: "medium",
    overview:
      "AI deep-dive unavailable. This fallback view uses current market pricing and recent headlines only; treat as directional context, not investment advice.",
    bullishFactors:
      signal === "bullish"
        ? ["Price is trading above today's open, suggesting positive session momentum."]
        : ["No strong bullish momentum detected from price action alone."],
    bearishFactors:
      signal === "bearish"
        ? ["Price is trading below today's open, signaling near-term downside pressure."]
        : ["No strong bearish momentum detected from price action alone."],
    neutralFactors: ["Monitor intraday range, volume, and headline follow-through before acting."],
    catalystWatch: ["Earnings updates", "Guidance changes", "Executive leadership headlines", "New partnerships or M&A"],
    riskFlags: ["Headline volatility can reverse intraday direction quickly."],
    narrativeSummary: "Combine this with your own risk controls and position sizing.",
    newsUsed: news.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate || "",
      source: item.source || "",
    })),
    quote: quote || null,
    source: "fallback",
    asOf: new Date().toISOString(),
  };
}

async function buildTickerDeepDiveReport(symbol) {
  const safeSymbol = normalizeTickerSymbol(symbol);
  if (!safeSymbol) {
    const err = new Error("A valid ticker symbol is required.");
    err.status = 400;
    throw err;
  }

  const [quote, news] = await Promise.all([
    fetchStooqQuote(normalizeTickerForStooq(safeSymbol), safeSymbol).catch(() => null),
    fetchTickerNews(safeSymbol, 8).catch(() => []),
  ]);

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key) {
    return buildTickerReportFallback(safeSymbol, quote, news);
  }

  const base = endpoint.replace(/\/+$/, "");
  const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const prompt = `
You are a financial research analyst generating a concise, structured ticker deep-dive.

Ticker: ${safeSymbol}
Quote JSON:
${JSON.stringify(quote || {}, null, 2)}

Recent news JSON:
${JSON.stringify(news, null, 2)}

Return STRICT JSON only with this exact shape:
{
  "signal": "bullish|bearish|neutral",
  "confidence": "high|medium|low",
  "overview": "2-4 sentence high-level view",
  "bullishFactors": ["string", "string"],
  "bearishFactors": ["string", "string"],
  "neutralFactors": ["string", "string"],
  "catalystWatch": ["string", "string"],
  "riskFlags": ["string", "string"],
  "narrativeSummary": "1-2 sentence summary"
}

Rules:
- Ground reasoning in the provided quote + headlines.
- Mention concrete drivers when available: products, partnerships, acquisitions, leadership changes, legal/regulatory events, protests, demand trends.
- Do not fabricate numbers or events not in the inputs.
- Keep each bullet concise and decision-useful.
`;

  const upstream = await postJson(
    completionsUrl,
    {
      model: process.env.GRADIENT_MODEL || "openai-gpt-oss-120b",
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a disciplined equity analyst. Return strict JSON only. No markdown, no extra text.",
        },
        { role: "user", content: prompt },
      ],
    },
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    }
  );

  if (upstream.status < 200 || upstream.status >= 300) {
    return buildTickerReportFallback(safeSymbol, quote, news);
  }

  const content = String(upstream.data?.choices?.[0]?.message?.content || "").trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return buildTickerReportFallback(safeSymbol, quote, news);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    symbol: safeSymbol,
    signal: ["bullish", "bearish", "neutral"].includes(String(parsed.signal || "").toLowerCase())
      ? String(parsed.signal).toLowerCase()
      : "neutral",
    confidence: ["high", "medium", "low"].includes(String(parsed.confidence || "").toLowerCase())
      ? String(parsed.confidence).toLowerCase()
      : "medium",
    overview: String(parsed.overview || "").trim(),
    bullishFactors: Array.isArray(parsed.bullishFactors) ? parsed.bullishFactors.map(String).slice(0, 6) : [],
    bearishFactors: Array.isArray(parsed.bearishFactors) ? parsed.bearishFactors.map(String).slice(0, 6) : [],
    neutralFactors: Array.isArray(parsed.neutralFactors) ? parsed.neutralFactors.map(String).slice(0, 6) : [],
    catalystWatch: Array.isArray(parsed.catalystWatch) ? parsed.catalystWatch.map(String).slice(0, 6) : [],
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags.map(String).slice(0, 6) : [],
    narrativeSummary: String(parsed.narrativeSummary || "").trim(),
    newsUsed: news.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate || "",
      source: item.source || "",
    })),
    quote: quote || null,
    source: "gradient",
    asOf: new Date().toISOString(),
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

async function buildOpeningPlaybook() {
  const symbols = [
    { symbol: "spy.us", label: "S&P 500 ETF (SPY)" },
    { symbol: "qqq.us", label: "Nasdaq 100 ETF (QQQ)" },
    { symbol: "iwm.us", label: "Russell 2000 ETF (IWM)" },
    { symbol: "dia.us", label: "Dow ETF (DIA)" },
    { symbol: "gld.us", label: "Gold ETF (GLD)" },
    { symbol: "tlt.us", label: "20Y Treasury ETF (TLT)" },
  ];

  const marketSnapshot = (
    await Promise.all(
      symbols.map(({ symbol, label }) => fetchStooqQuote(symbol, label).catch(() => null))
    )
  ).filter(Boolean);

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key) {
    return {
      asOf: new Date().toISOString(),
      source: "fallback",
      buckets: [
        {
          name: "Large Cap Momentum",
          thesis: "Use high-liquidity ETFs as opening bell anchors.",
          tickers: ["SPY", "QQQ", "DIA"],
        },
        {
          name: "Risk Rotation",
          thesis: "Small caps and duration can signal risk-on/risk-off at open.",
          tickers: ["IWM", "TLT", "GLD"],
        },
      ],
      marketSnapshot,
    };
  }

  const base = endpoint.replace(/\/+$/, "");
  const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const prompt = `
You are an opening bell trading assistant.
Given this market snapshot JSON:
${JSON.stringify(marketSnapshot)}

Return STRICT JSON only with this shape:
{
  "buckets": [
    { "name": "string", "thesis": "string", "tickers": ["AAPL","MSFT","..."] }
  ],
  "notes": "string"
}

Rules:
- 3 to 4 buckets total
- Each bucket must have 3-6 tickers
- Focus on liquid U.S. tickers most relevant for opening session ideas
- Keep thesis concise and practical
`;

  const upstream = await postJson(
    completionsUrl,
    {
      model: process.env.GRADIENT_MODEL || "openai-gpt-oss-120b",
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a market strategist. Return clean JSON only, no markdown.",
        },
        { role: "user", content: prompt },
      ],
    },
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    }
  );

  if (upstream.status < 200 || upstream.status >= 300) {
    throw new Error(`Gradient returned ${upstream.status}`);
  }

  const content = String(upstream.data?.choices?.[0]?.message?.content || "").trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gradient response did not include valid JSON.");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const buckets = Array.isArray(parsed?.buckets) ? parsed.buckets : [];
  return {
    asOf: new Date().toISOString(),
    source: "gradient",
    buckets,
    notes: parsed?.notes || "",
    marketSnapshot,
  };
}

app.get(["/market/opening-playbook", "/api/market/opening-playbook"], async (_req, res) => {
  try {
    const playbook = await buildOpeningPlaybook();
    sendJson(res, 200, playbook);
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Failed to build opening playbook." });
  }
});

app.get(["/market/quotes", "/api/market/quotes"], async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);
  if (!symbols.length) {
    sendJson(res, 400, { error: "symbols query param is required." });
    return;
  }

  try {
    const quotes = (
      await Promise.all(
        symbols.map((symbol) =>
          fetchStooqQuote(normalizeTickerForStooq(symbol), symbol).catch(() => null)
        )
      )
    ).filter(Boolean);

    const bySymbol = Object.fromEntries(quotes.map((quote) => [quote.label.toUpperCase(), quote]));
    sendJson(res, 200, {
      updatedAt: new Date().toISOString(),
      quotes: symbols.map((symbol) => bySymbol[symbol] || { symbol, label: symbol, unavailable: true }),
    });
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Failed to load market quotes." });
  }
});

app.get(["/market/ticker-report", "/api/market/ticker-report"], async (req, res) => {
  const symbol = normalizeTickerSymbol(req.query.symbol || "");
  if (!symbol) {
    sendJson(res, 400, { error: "symbol query param is required." });
    return;
  }
  try {
    const report = await buildTickerDeepDiveReport(symbol);
    sendJson(res, 200, report);
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to build ticker report." });
  }
});

app.get(["/market/ticker-universe", "/api/market/ticker-universe"], async (req, res) => {
  const requested = Number(req.query.limit || 500);
  const limit = Number.isFinite(requested) ? Math.max(50, Math.min(500, Math.floor(requested))) : 500;
  try {
    const symbols = await loadSp500TickerUniverse(limit);
    sendJson(res, 200, {
      source: "wikipedia-sp500",
      updatedAt: new Date().toISOString(),
      symbols,
    });
  } catch (err) {
    sendJson(res, 200, {
      source: "fallback",
      updatedAt: new Date().toISOString(),
      symbols: FALLBACK_TICKER_UNIVERSE.slice(0, limit),
      warning: err.message || "Ticker universe source unavailable.",
    });
  }
});

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
