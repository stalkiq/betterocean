const crypto = require("crypto");
const express = require("express");
const https = require("https");
const { createClient } = require("redis");
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
const MARKET_OVERVIEW_TTL_MS = Number(process.env.MARKET_OVERVIEW_TTL_MS || 20 * 1000);
const OPENING_PLAYBOOK_TTL_MS = Number(process.env.OPENING_PLAYBOOK_TTL_MS || 90 * 1000);
const TICKER_REPORT_TTL_MS = Number(process.env.TICKER_REPORT_TTL_MS || 5 * 60 * 1000);
const TICKER_WATCHBOARDS_TTL_MS = Number(process.env.TICKER_WATCHBOARDS_TTL_MS || 3 * 60 * 1000);
const AGENT_BRIEF_TTL_MS = Number(process.env.AGENT_BRIEF_TTL_MS || 3 * 60 * 1000);
const SCHWAB_CACHE_TTL_MS = Number(process.env.SCHWAB_CACHE_TTL_MS || 12 * 1000);
const SEC_COMPANY_TICKERS_TTL_MS = Number(process.env.SEC_COMPANY_TICKERS_TTL_MS || 24 * 60 * 60 * 1000);
const TICKER_PREWARM_INTERVAL_MS = Number(process.env.TICKER_PREWARM_INTERVAL_MS || 120 * 1000);
const REDIS_URL = process.env.REDIS_URL || process.env.DO_REDIS_URL || "";
const REDIS_CACHE_PREFIX = process.env.REDIS_CACHE_PREFIX || "bo:cache:v1";

const sessionStore = new Map();
const tickerUniverseCache = { symbols: [], fetchedAt: 0 };
const secCompanyTickerCache = { bySymbol: {}, fetchedAt: 0 };
const marketOverviewCache = { data: null, fetchedAt: 0 };
const openingPlaybookCache = { data: null, fetchedAt: 0 };
const tickerWatchboardsCache = { data: null, fetchedAt: 0 };
const tickerReportCache = new Map();
const tickerReportInFlight = new Map();
let tickerPrewarmRunning = false;
let redisClient = null;
let redisReady = false;
const HTTPS_KEEPALIVE_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1500,
  maxSockets: 100,
  maxFreeSockets: 20,
  timeout: 60000,
});
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
const SYMBOL_COMPANY_LOOKUP = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft",
  NVDA: "Nvidia",
  AMZN: "Amazon",
  GOOGL: "Google",
  META: "Meta Platforms",
  TSLA: "Tesla, Inc.",
  JPM: "JPMorgan Chase",
  XOM: "ExxonMobil",
  UNH: "UnitedHealth Group",
  MMM: "3M",
  ABT: "Abbott Laboratories",
  ABBV: "AbbVie",
  ACN: "Accenture",
  AVGO: "Broadcom Inc.",
  DAL: "Delta Air Lines",
  CCL: "Carnival Corporation",
  ADM: "Archer-Daniels-Midland Co.",
  HAL: "Halliburton",
  PH: "Parker-Hannifin",
  CSCO: "Cisco",
  ORCL: "Oracle Corporation",
};
const COMPANY_PROFILE_OVERRIDES = {
  ADM: {
    name: "Archer-Daniels-Midland Co.",
    description: "Agricultural processing and nutrition",
    summary:
      "ADM buys, stores, processes, and transports crops like corn and soybeans. It sells ingredients for food, animal nutrition, and industrial uses. Investors watch crop margins, global demand, and commodity volatility.",
    source: "curated-profile",
  },
  AVGO: {
    name: "Broadcom Inc.",
    description: "Semiconductors and infrastructure software",
    summary:
      "Broadcom builds chips for networking, data centers, broadband, and wireless. It also sells infrastructure software used by enterprises. Investors track product demand, AI data-center spending, and software subscription growth.",
    source: "curated-profile",
  },
  AAPL: {
    name: "Apple Inc.",
    description: "Consumer technology",
    summary:
      "Apple sells iPhone, Mac, iPad, and wearables, plus services like iCloud and Apple TV+. It makes money from device sales and recurring subscriptions. Investors watch product cycles, services growth, and margins.",
    source: "curated-profile",
  },
  MSFT: {
    name: "Microsoft Corporation",
    description: "Enterprise software and cloud",
    summary:
      "Microsoft sells business software and Azure cloud services. It earns from subscriptions, cloud usage, and enterprise licensing. Investors focus on AI product adoption, cloud growth, and corporate spending trends.",
    source: "curated-profile",
  },
  NVDA: {
    name: "NVIDIA Corporation",
    description: "Semiconductors",
    summary:
      "NVIDIA designs GPUs and AI accelerators used in data centers, gaming, and professional systems. Revenue is driven by chip demand and platform ecosystems. Investors watch supply, pricing power, and hyperscaler orders.",
    source: "curated-profile",
  },
  GOOGL: {
    name: "Alphabet Inc.",
    description: "Internet services and advertising",
    summary:
      "Alphabet runs Google Search, YouTube, and cloud services. It primarily earns from digital advertising and cloud subscriptions. Investors monitor ad demand, AI search changes, and cloud profitability.",
    source: "curated-profile",
  },
};
const COMPANY_BUSINESS_HINTS = {
  CCL: "runs cruise vacations and onboard travel services.",
  CF: "manufactures nitrogen fertilizer products for agriculture.",
  NKE: "designs and sells athletic footwear, apparel, and accessories.",
  T: "sells wireless, broadband, and communication services.",
  F: "manufactures and sells cars, trucks, and auto financing.",
  GM: "manufactures and sells vehicles, parts, and mobility services.",
  DAL: "sells passenger and cargo airline transportation services.",
  UAL: "sells passenger and cargo airline transportation services.",
  AAL: "sells passenger and cargo airline transportation services.",
  XOM: "produces oil, natural gas, and refined fuel products.",
  CVX: "produces oil, natural gas, and refined fuel products.",
  KO: "sells nonalcoholic beverages through global distribution networks.",
  PEP: "sells beverages and snack foods through retail channels.",
  WMT: "sells consumer goods through retail stores and e-commerce.",
  COST: "sells consumer goods through membership warehouse retail.",
};

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

function getFreshCache(cacheEntry, ttlMs) {
  if (!cacheEntry || !cacheEntry.data || !cacheEntry.fetchedAt) return null;
  if (Date.now() - cacheEntry.fetchedAt > ttlMs) return null;
  return cacheEntry.data;
}

function buildRedisCacheKey(scope, id = "") {
  const safeScope = String(scope || "generic")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-");
  const safeId = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9,._:-]+/g, "-");
  return safeId ? `${REDIS_CACHE_PREFIX}:${safeScope}:${safeId}` : `${REDIS_CACHE_PREFIX}:${safeScope}`;
}

async function getRedisCacheJson(key) {
  if (!redisReady || !redisClient || !key) return null;
  try {
    const raw = await redisClient.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setRedisCacheJson(key, payload, ttlMs) {
  if (!redisReady || !redisClient || !key || payload == null) return;
  try {
    const ttlSec = Math.max(1, Math.floor(Number(ttlMs || 0) / 1000));
    await redisClient.set(key, JSON.stringify(payload), { EX: ttlSec });
  } catch {
    // Ignore Redis cache writes to keep request path resilient.
  }
}

async function initRedisCache() {
  if (!REDIS_URL) {
    console.log("Redis cache disabled: REDIS_URL not set.");
    return;
  }
  try {
    redisClient = createClient({
      url: REDIS_URL,
      socket: {
        connectTimeout: 3000,
      },
    });
    redisClient.on("error", (err) => {
      redisReady = false;
      console.error("Redis client error:", err?.message || err);
    });
    redisClient
      .connect()
      .then(() => {
        redisReady = true;
        console.log("Redis cache connected.");
      })
      .catch((err) => {
        redisReady = false;
        console.error("Redis cache init failed:", err?.message || err);
      });
  } catch (err) {
    redisReady = false;
    redisClient = null;
    console.error("Redis cache init failed:", err?.message || err);
  }
}

function readSessionCache(session, key, ttlMs = SCHWAB_CACHE_TTL_MS) {
  const entry = session?.cached?.[key];
  if (!entry || !entry.fetchedAt) return null;
  if (Date.now() - entry.fetchedAt > ttlMs) return null;
  return entry.data;
}

function writeSessionCache(session, key, data) {
  if (!session.cached || typeof session.cached !== "object") session.cached = {};
  session.cached[key] = { fetchedAt: Date.now(), data };
}

function clearSessionCacheByPrefix(session, prefix) {
  if (!session?.cached || typeof session.cached !== "object") return;
  Object.keys(session.cached).forEach((key) => {
    if (key.startsWith(prefix)) delete session.cached[key];
  });
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
        agent: HTTPS_KEEPALIVE_AGENT,
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

function getText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
        headers,
        agent: HTTPS_KEEPALIVE_AGENT,
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

function trimToWords(value, maxWords = 28) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function getCompanyLookupName(symbol) {
  const safe = normalizeTickerSymbol(symbol);
  return SYMBOL_COMPANY_LOOKUP[safe] || safe;
}

function parseSecCompanyTickerJson(rawData) {
  const parsed = JSON.parse(String(rawData || "{}"));
  const bySymbol = {};
  if (!parsed || typeof parsed !== "object") return bySymbol;
  Object.values(parsed).forEach((entry) => {
    const symbol = normalizeTickerSymbol(entry?.ticker || "");
    const title = String(entry?.title || "").trim();
    if (!symbol || !title) return;
    bySymbol[symbol] = title;
  });
  return bySymbol;
}

async function loadSecCompanyTickerMap() {
  const now = Date.now();
  if (Object.keys(secCompanyTickerCache.bySymbol).length && now - secCompanyTickerCache.fetchedAt < SEC_COMPANY_TICKERS_TTL_MS) {
    return secCompanyTickerCache.bySymbol;
  }

  const redisKey = buildRedisCacheKey("sec-company-tickers-v1");
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached && typeof redisCached.bySymbol === "object" && redisCached.bySymbol !== null) {
    secCompanyTickerCache.bySymbol = redisCached.bySymbol;
    secCompanyTickerCache.fetchedAt = now;
    return secCompanyTickerCache.bySymbol;
  }

  try {
    const upstream = await getText("https://www.sec.gov/files/company_tickers.json", {
      "User-Agent": "BetterOcean/1.0 (support@betterocean.app)",
      Accept: "application/json",
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      throw new Error(`SEC symbol map request failed (${upstream.status})`);
    }
    const bySymbol = parseSecCompanyTickerJson(upstream.data);
    if (Object.keys(bySymbol).length) {
      secCompanyTickerCache.bySymbol = bySymbol;
      secCompanyTickerCache.fetchedAt = now;
      await setRedisCacheJson(redisKey, { bySymbol, updatedAt: new Date().toISOString() }, SEC_COMPANY_TICKERS_TTL_MS);
      return bySymbol;
    }
  } catch {
    // Fall through to local lookup fallback.
  }

  return secCompanyTickerCache.bySymbol;
}

async function resolveCompanyNamesForSymbols(symbols = []) {
  const secMap = await loadSecCompanyTickerMap().catch(() => ({}));
  const out = {};
  symbols.forEach((symbol) => {
    const safe = normalizeTickerSymbol(symbol);
    if (!safe) return;
    out[safe] = String(secMap?.[safe] || SYMBOL_COMPANY_LOOKUP[safe] || safe).trim();
  });
  return out;
}

async function resolvePrimaryCompanyName(symbol) {
  const safe = normalizeTickerSymbol(symbol);
  if (!safe) return "";
  const names = await resolveCompanyNamesForSymbols([safe]).catch(() => ({}));
  return String(names?.[safe] || getCompanyLookupName(safe) || safe).trim();
}

function applyResolvedNameToCompanyProfile(symbol, companyProfile = null, resolvedName = "") {
  const safe = normalizeTickerSymbol(symbol);
  if (!safe) return companyProfile;
  const canonicalName = String(resolvedName || getCompanyLookupName(safe) || safe).trim() || safe;
  if (companyProfile && typeof companyProfile === "object") {
    const existingName = String(companyProfile?.name || "").trim();
    const shouldOverwriteName = !existingName || normalizeTickerSymbol(existingName) === safe;
    const mergedName = shouldOverwriteName ? canonicalName : existingName;
    const summary = String(companyProfile?.summary || "").trim();
    return {
      ...companyProfile,
      name: mergedName,
      summary: summary || `${mergedName} ${buildBusinessHint(safe, mergedName)}`,
    };
  }
  return {
    name: canonicalName,
    description: "",
    summary: `${canonicalName} ${buildBusinessHint(safe, canonicalName)}`,
    source: "resolved-name",
    updatedAt: new Date().toISOString(),
  };
}

function buildBusinessHint(symbol, companyName = "") {
  const safe = normalizeTickerSymbol(symbol);
  const explicit = COMPANY_BUSINESS_HINTS[safe];
  if (explicit) return explicit;
  const label = String(companyName || "").toLowerCase();
  if (label.includes("bank") || label.includes("financial")) return "provides banking, lending, and related financial services.";
  if (label.includes("energy") || label.includes("petroleum") || label.includes("oil")) {
    return "produces, transports, or sells energy and fuel products.";
  }
  if (label.includes("air") || label.includes("airline")) return "sells passenger travel and cargo transportation services.";
  if (label.includes("pharma") || label.includes("bio")) return "develops and sells pharmaceutical or biotech products.";
  if (label.includes("tech") || label.includes("software")) return "builds software, digital platforms, or technology hardware.";
  if (label.includes("retail") || label.includes("store")) return "sells consumer products through stores and online channels.";
  return "sells products and services tied to its main industry and customer demand.";
}

function buildBestEffortCompanyProfile(symbol) {
  const name = getCompanyLookupName(symbol);
  const businessHint = buildBusinessHint(symbol, name);
  return {
    name,
    description: "Best-effort AI profile",
    summary: `${name} ${businessHint} Revenue and sentiment can shift on earnings, guidance, and major headlines.`,
    source: "best-effort",
    updatedAt: new Date().toISOString(),
  };
}

async function fetchCompanyProfile(symbol, news = []) {
  const safe = normalizeTickerSymbol(symbol);
  if (!safe) return null;
  const profileOverride = COMPANY_PROFILE_OVERRIDES[safe];
  if (profileOverride) {
    return {
      ...profileOverride,
      updatedAt: new Date().toISOString(),
    };
  }
  const candidates = [getCompanyLookupName(safe)];
  const firstNewsTitle = String(news?.[0]?.title || "").trim();
  const fromNews = firstNewsTitle
    .replace(/\(.*?\)/g, "")
    .split(/[-|:]/)[0]
    .replace(/\bstock\b/gi, "")
    .trim();
  if (fromNews && fromNews.length > 2) candidates.push(fromNews);

  for (const candidate of [...new Set(candidates)]) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
    try {
      const upstream = await getText(url);
      if (upstream.status < 200 || upstream.status >= 300) continue;
      const data = JSON.parse(String(upstream.data || "{}"));
      const title = String(data?.title || "").trim();
      const summary = trimToWords(data?.extract || "", 40);
      if (!title || !summary) continue;
      return {
        name: title,
        description: String(data?.description || "").trim(),
        summary,
        source: "wikipedia",
        updatedAt: new Date().toISOString(),
      };
    } catch {
      // Try next candidate.
    }
  }
  return null;
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
  const redisKey = buildRedisCacheKey("ticker-universe", String(limit));
  const redisCached = await getRedisCacheJson(redisKey);
  if (Array.isArray(redisCached?.symbols) && redisCached.symbols.length >= 100) {
    return redisCached.symbols.slice(0, limit);
  }
  if (tickerUniverseCache.symbols.length >= 200 && now - tickerUniverseCache.fetchedAt < TICKER_UNIVERSE_TTL_MS) {
    return tickerUniverseCache.symbols.slice(0, limit);
  }

  let unique = [];

  // Primary source: maintained CSV list of S&P 500 symbols.
  const csvUrl = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
  const csvUpstream = await getText(csvUrl).catch(() => null);
  if (csvUpstream && csvUpstream.status >= 200 && csvUpstream.status < 300) {
    const lines = String(csvUpstream.data || "")
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean);
    const symbols = lines
      .map((line) => line.split(",")[0] || "")
      .map((raw) => normalizeTickerSymbol(raw).replace(/-/g, "."))
      .filter(Boolean);
    unique = [...new Set(symbols)].slice(0, limit);
  }

  // Secondary fallback: scrape Wikipedia table if CSV is unavailable.
  if (unique.length < 100) {
    const wikiUrl = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
    const upstream = await getText(wikiUrl);
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
    unique = [...new Set(symbols)].slice(0, limit);
  }

  if (unique.length < 100) {
    throw new Error("Ticker universe source returned too few symbols.");
  }
  tickerUniverseCache.symbols = unique;
  tickerUniverseCache.fetchedAt = now;
  await setRedisCacheJson(
    redisKey,
    {
      source: "wikipedia-sp500",
      updatedAt: new Date().toISOString(),
      symbols: unique,
    },
    TICKER_UNIVERSE_TTL_MS
  );
  return unique;
}

function buildTickerReportFallback(symbol, quote, news, companyProfile = null) {
  const businessHint = buildBusinessHint(symbol, companyProfile?.name || getCompanyLookupName(symbol));
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
      companyProfile?.summary ||
      `${getCompanyLookupName(symbol)} ${businessHint}`,
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
    companyProfile: companyProfile || {
      name: getCompanyLookupName(symbol),
      description: "",
      summary: `${getCompanyLookupName(symbol)} ${businessHint}`,
      source: "fallback",
      updatedAt: new Date().toISOString(),
    },
    gradientSuggestion: {
      title: signal === "bullish" ? "Lean positive with risk controls" : signal === "bearish" ? "Stay defensive for now" : "Wait for confirmation",
      bullets:
        signal === "bullish"
          ? [
              "Watch for follow-through above the opening range.",
              "Size small and define a stop before entry.",
              "Avoid chasing if momentum fades intraday.",
            ]
          : signal === "bearish"
            ? [
                "Avoid forcing long entries into current weakness.",
                "Wait for stabilization before taking new risk.",
                "Use tighter risk limits in high headline volatility.",
              ]
            : [
                "Wait for a cleaner directional signal.",
                "Track volume confirmation before acting.",
                "Keep position size conservative until trend forms.",
              ],
      confidence: "low",
      asOf: new Date().toISOString(),
      source: "fallback",
    },
    agentPanels: {
      company: companyProfile?.summary
        ? [trimToWords(companyProfile.summary, 16)]
        : [
            `What they do: ${getCompanyLookupName(symbol)} ${businessHint}`,
            "How they make money: Revenue comes from selling those products and services.",
            "Why investors care: Earnings and major headlines can quickly move valuation.",
          ],
      catalyst: news.slice(0, 3).map((item) => trimToWords(item?.title || "", 14)).filter(Boolean),
      risk: ["Headline volatility can quickly reverse intraday direction.", "Use sizing and stop discipline before entering trades."],
      source: "fallback",
      asOf: new Date().toISOString(),
    },
    companyExplainer: {
      companyName: companyProfile?.name || getCompanyLookupName(symbol),
      oneLiner: companyProfile?.summary
        ? trimToWords(companyProfile.summary, 18)
        : `${getCompanyLookupName(symbol)} ${businessHint}`,
      bullets: companyProfile?.summary
        ? [trimToWords(companyProfile.summary, 14)]
        : [
            `What they do: ${getCompanyLookupName(symbol)} ${businessHint}`,
            "How they make money: Revenue comes from customer demand for those offerings.",
            "Why investors care: Earnings and guidance can shift sentiment quickly.",
          ],
      source: "fallback",
      asOf: new Date().toISOString(),
    },
    debate: {
      bullAnalyst: {
        thesis: "Upside case is limited without stronger confirmation.",
        points:
          signal === "bullish"
            ? ["Price is above the open, which supports a short-term bullish bias."]
            : ["No clear bullish breakout is visible from current price action alone."],
        confidence: "low",
      },
      bearAnalyst: {
        thesis: "Downside case requires confirmation from continued weakness.",
        points:
          signal === "bearish"
            ? ["Price is below the open, which signals near-term downside pressure."]
            : ["No clear bearish breakdown is visible from current price action alone."],
        confidence: "low",
      },
      referee: {
        summary: "Fallback debate mode uses limited inputs. Treat as directional context only.",
        verdict: "balanced",
        actionBias: "balanced",
        confidence: "low",
      },
    },
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

function parseJsonFromModelContent(rawContent) {
  const content = String(rawContent || "").trim();
  if (!content) return null;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function sanitizeConfidence(value, fallback = "medium") {
  const clean = String(value || "").toLowerCase();
  return ["high", "medium", "low"].includes(clean) ? clean : fallback;
}

function sanitizeSignal(value, fallback = "neutral") {
  const clean = String(value || "").toLowerCase();
  return ["bullish", "bearish", "neutral"].includes(clean) ? clean : fallback;
}

function sanitizeArray(value, maxItems = 6) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, maxItems) : [];
}

function hashPayloadForCache(payload) {
  try {
    const raw = JSON.stringify(payload || {});
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 18);
  } catch {
    return crypto.randomBytes(8).toString("hex");
  }
}

function buildPortfolioBriefFallback(payload) {
  const accountCount = Number(payload?.accountCount || 0);
  const positionCount = Number(payload?.positionCount || 0);
  const buyingPower = Number(payload?.buyingPower || 0);
  return {
    source: "fallback",
    asOf: new Date().toISOString(),
    allocation: [
      `Accounts connected: ${accountCount}. Positions tracked: ${positionCount}.`,
      positionCount > 0 ? "Keep top position weights balanced to reduce single-name exposure." : "Start with small staged entries while building your first positions.",
    ],
    risk: [
      buyingPower <= 0 ? "Buying power is low. Add cash before placing larger buy orders." : "Set a max risk budget per new position before entering.",
      "Review stale open orders daily to avoid unintended fills.",
    ],
    income: [
      "Blend growth names with cash-generating holdings if income stability matters.",
      "Track dividend dates and payout consistency before relying on yield.",
    ],
  };
}

function buildShoppingBriefFallback(payload) {
  const itemCount = Number(payload?.itemCount || 0);
  const marketOpen = Boolean(payload?.marketOpen);
  return {
    source: "fallback",
    asOf: new Date().toISOString(),
    planner: [
      itemCount > 0 ? `Cart has ${itemCount} item(s). Prioritize liquid symbols first.` : "Add 1-2 liquid tickers first, then expand the cart.",
      "Use smaller initial size and scale only after confirmation.",
    ],
    execution: [
      marketOpen ? "Market is open. Monitor fills quickly after submit." : "Market is closed. Queue planning now and submit when open.",
      "If status is working, check order updates before resubmitting duplicates.",
    ],
  };
}

function sanitizeActionBias(value, fallback = "balanced") {
  const clean = String(value || "").toLowerCase();
  return ["lean-bullish", "lean-bearish", "balanced"].includes(clean) ? clean : fallback;
}

function sanitizeExecutionSide(value, fallback = "BUY") {
  const clean = String(value || "").toUpperCase();
  return clean === "SELL" ? "SELL" : fallback;
}

function sanitizeExecutionOrderType(value, fallback = "MARKET") {
  const clean = String(value || "").toUpperCase();
  return ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"].includes(clean) ? clean : fallback;
}

function sanitizeExecutionDuration(value, fallback = "DAY") {
  const clean = String(value || "").toUpperCase();
  return ["DAY", "GTC"].includes(clean) ? clean : fallback;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readSchwabQuote(payload, symbol) {
  const safeSymbol = String(symbol || "").toUpperCase();
  if (!safeSymbol || !payload || typeof payload !== "object") return null;
  const entry = payload[safeSymbol] || payload[safeSymbol.toLowerCase()] || null;
  const quote = entry?.quote && typeof entry.quote === "object" ? entry.quote : entry;
  if (!quote || typeof quote !== "object") return null;
  const last = toNumberOrNull(quote.lastPrice ?? quote.mark ?? quote.closePrice ?? quote.netChange);
  const bid = toNumberOrNull(quote.bidPrice);
  const ask = toNumberOrNull(quote.askPrice);
  const open = toNumberOrNull(quote.openPrice);
  const high = toNumberOrNull(quote.highPrice);
  const low = toNumberOrNull(quote.lowPrice);
  return {
    symbol: safeSymbol,
    last,
    bid,
    ask,
    open,
    high,
    low,
    raw: quote,
  };
}

function buildFallbackOrderPlan({ symbol, quantity, executionStyle, sideHint, quote }) {
  const style = String(executionStyle || "fast-fill").toLowerCase() === "smart-price" ? "smart-price" : "fast-fill";
  const side = sanitizeExecutionSide(sideHint, "BUY");
  const duration = "DAY";
  const last = toNumberOrNull(quote?.last);
  const bid = toNumberOrNull(quote?.bid);
  const ask = toNumberOrNull(quote?.ask);
  const reference = ask || bid || last;
  if (!reference) {
    return {
      symbol,
      quantity,
      side,
      orderType: "MARKET",
      duration,
      limitPrice: null,
      stopPrice: null,
      source: "fallback",
      rationale: "Quote data was limited, so a market order was selected for valid submission.",
    };
  }

  if (style === "fast-fill") {
    return {
      symbol,
      quantity,
      side,
      orderType: "MARKET",
      duration,
      limitPrice: null,
      stopPrice: null,
      source: "fallback",
      rationale: "Fast-fill mode uses market orders to maximize immediate execution probability.",
    };
  }

  // Smart-price fallback: use a near-touch limit to improve price control while keeping high fill odds.
  const base = side === "BUY" ? ask || reference : bid || reference;
  const offset = base * 0.0015;
  const limitPriceRaw = side === "BUY" ? base + offset : Math.max(0.01, base - offset);
  const limitPrice = Number(limitPriceRaw.toFixed(2));
  return {
    symbol,
    quantity,
    side,
    orderType: "LIMIT",
    duration,
    limitPrice,
    stopPrice: null,
    source: "fallback",
    rationale: "Smart-price mode chose a near-touch limit to balance price quality with likely execution.",
  };
}

function extractOrderIdFromHeaders(headers) {
  const locationRaw = headers?.location;
  const location = Array.isArray(locationRaw) ? locationRaw[0] : locationRaw;
  const text = String(location || "");
  if (!text) return null;
  const match = text.match(/\/orders\/(\d+)(?:\b|$)/i);
  return match ? match[1] : null;
}

function extractHeaderValue(headers, key) {
  if (!headers || !key) return null;
  const value = headers[String(key).toLowerCase()];
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

async function gradientStructuredJson({ completionsUrl, key, model, systemPrompt, userPrompt }) {
  const upstream = await postJson(
    completionsUrl,
    {
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: userPrompt },
      ],
    },
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    }
  );

  if (upstream.status < 200 || upstream.status >= 300) {
    const err = new Error(`Gradient returned ${upstream.status}`);
    err.status = upstream.status;
    throw err;
  }

  const parsed = parseJsonFromModelContent(upstream.data?.choices?.[0]?.message?.content);
  if (!parsed) {
    throw new Error("Gradient response did not include valid JSON.");
  }
  return parsed;
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
  const resolvedCompanyName = await resolvePrimaryCompanyName(safeSymbol).catch(() => getCompanyLookupName(safeSymbol));
  const fetchedCompanyProfile = await fetchCompanyProfile(safeSymbol, news).catch(() => null);
  const companyProfile = applyResolvedNameToCompanyProfile(safeSymbol, fetchedCompanyProfile, resolvedCompanyName);

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key) {
    return buildTickerReportFallback(safeSymbol, quote, news, companyProfile);
  }

  const base = endpoint.replace(/\/+$/, "");
  const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const model = process.env.GRADIENT_MODEL || "openai-gpt-oss-120b";
  const sharedContext = `
Ticker: ${safeSymbol}
Quote JSON:
${JSON.stringify(quote || {}, null, 2)}

Recent news JSON:
${JSON.stringify(news, null, 2)}

Company profile JSON:
${JSON.stringify(companyProfile || {}, null, 2)}
`;

  try {
    let companyExplainer = null;
    try {
      const explainerRaw = await gradientStructuredJson({
        completionsUrl,
        key,
        model,
        systemPrompt:
          "You are a best-effort company explainer. Infer carefully from company name, market context, and headlines. Return strict JSON only.",
        userPrompt: `
Ticker: ${safeSymbol}
Structured company input:
${JSON.stringify(
  {
    name: companyProfile?.name || getCompanyLookupName(safeSymbol),
    sector: companyProfile?.description || "",
    products: companyProfile?.summary || "",
    businessHint: buildBusinessHint(safeSymbol, companyProfile?.name || getCompanyLookupName(safeSymbol)),
    latestFilingsOrNews: Array.isArray(news) ? news.slice(0, 5).map((item) => item?.title || "").filter(Boolean) : [],
  },
  null,
  2
)}

Return STRICT JSON:
{
  "companyName": "Full company name",
  "oneLiner": "One sentence on what the company sells or manufactures.",
  "bullets": [
    "What they do: ...",
    "How they make money: ...",
    "Why investors care: ..."
  ]
}

Rules:
- 2-3 bullets only, plain American English.
- Keep each bullet under 18 words.
- companyName should be the best full company name you can infer.
- oneLiner must describe what the company sells or manufactures in plain English.
- Must name concrete products/services the company likely sells or manufactures.
- Do not use generic phrases like "publicly traded company" or "operates in public markets".
- No markdown, no extra text.
- Make a best-effort inference from company name and headlines when profile fields are limited.
`,
      });
      const explainerBullets = sanitizeArray(explainerRaw?.bullets, 3);
      const explainerName = String(explainerRaw?.companyName || companyProfile?.name || getCompanyLookupName(safeSymbol)).trim();
      const explainerOneLiner = String(explainerRaw?.oneLiner || "").trim();
      companyExplainer = {
        companyName: explainerName || getCompanyLookupName(safeSymbol),
        oneLiner:
          explainerOneLiner ||
          `${getCompanyLookupName(safeSymbol)} ${buildBusinessHint(
            safeSymbol,
            companyProfile?.name || getCompanyLookupName(safeSymbol)
          )}`,
        bullets: explainerBullets.length
          ? explainerBullets
          : [
              `What they do: ${getCompanyLookupName(safeSymbol)} ${buildBusinessHint(
                safeSymbol,
                companyProfile?.name || getCompanyLookupName(safeSymbol)
              )}`,
              "How they make money: Revenue depends on customer demand for those offerings.",
              "Why investors care: Earnings results and major news can quickly change sentiment.",
            ],
        source: "gradient-best-effort",
        asOf: new Date().toISOString(),
      };
    } catch {
      companyExplainer = {
        companyName: companyProfile?.name || getCompanyLookupName(safeSymbol),
        oneLiner: `${getCompanyLookupName(safeSymbol)} ${buildBusinessHint(
          safeSymbol,
          companyProfile?.name || getCompanyLookupName(safeSymbol)
        )}`,
        bullets: [
          `What they do: ${getCompanyLookupName(safeSymbol)} ${buildBusinessHint(
            safeSymbol,
            companyProfile?.name || getCompanyLookupName(safeSymbol)
          )}`,
          "How they make money: Revenue depends on customer demand for those offerings.",
          "Why investors care: Earnings and headlines can quickly move the stock.",
        ],
        source: "best-effort-fallback",
        asOf: new Date().toISOString(),
      };
    }

    const [bullRaw, bearRaw, catalystRaw, riskRaw] = await Promise.all([
      gradientStructuredJson({
        completionsUrl,
        key,
        model,
        systemPrompt:
          "You are Bull Analyst. Build the strongest bullish case using only provided inputs. Return strict JSON only.",
        userPrompt: `
${sharedContext}

Return STRICT JSON:
{
  "thesis": "1-2 sentence bullish thesis",
  "points": ["string", "string", "string"],
  "risks": ["string", "string"],
  "confidence": "high|medium|low"
}

Rules:
- Use only the provided quote + headlines.
- No markdown, no extra text.
`,
      }),
      gradientStructuredJson({
        completionsUrl,
        key,
        model,
        systemPrompt:
          "You are Bear Analyst. Build the strongest bearish case using only provided inputs. Return strict JSON only.",
        userPrompt: `
${sharedContext}

Return STRICT JSON:
{
  "thesis": "1-2 sentence bearish thesis",
  "points": ["string", "string", "string"],
  "risks": ["string", "string"],
  "confidence": "high|medium|low"
}

Rules:
- Use only the provided quote + headlines.
- No markdown, no extra text.
`,
      }),
      gradientStructuredJson({
        completionsUrl,
        key,
        model,
        systemPrompt:
          "You are Catalyst Agent. Identify what could move this ticker soon using only provided inputs. Return strict JSON only.",
        userPrompt: `
${sharedContext}

Return STRICT JSON:
{
  "bullets": ["string", "string", "string"]
}

Rules:
- 2-3 bullets, plain American English.
- Keep each bullet under 18 words.
- Use only provided quote + profile + headlines.
- No markdown, no extra text.
`,
      }),
      gradientStructuredJson({
        completionsUrl,
        key,
        model,
        systemPrompt:
          "You are Risk Agent. Identify downside/uncertainty factors for this ticker using only provided inputs. Return strict JSON only.",
        userPrompt: `
${sharedContext}

Return STRICT JSON:
{
  "bullets": ["string", "string", "string"]
}

Rules:
- 2-3 bullets, plain American English.
- Keep each bullet under 18 words.
- Focus on execution and information risk.
- No markdown, no extra text.
`,
      }),
    ]);

    const bullAnalyst = {
      thesis: String(bullRaw?.thesis || "").trim(),
      points: sanitizeArray(bullRaw?.points, 6),
      risks: sanitizeArray(bullRaw?.risks, 6),
      confidence: sanitizeConfidence(bullRaw?.confidence, "medium"),
    };
    const bearAnalyst = {
      thesis: String(bearRaw?.thesis || "").trim(),
      points: sanitizeArray(bearRaw?.points, 6),
      risks: sanitizeArray(bearRaw?.risks, 6),
      confidence: sanitizeConfidence(bearRaw?.confidence, "medium"),
    };

    const refereeRaw = await gradientStructuredJson({
      completionsUrl,
      key,
      model,
      systemPrompt:
        "You are Referee Analyst. Synthesize bull and bear arguments into a balanced investment view. Return strict JSON only.",
      userPrompt: `
${sharedContext}

Bull Analyst JSON:
${JSON.stringify(bullAnalyst, null, 2)}

Bear Analyst JSON:
${JSON.stringify(bearAnalyst, null, 2)}

Return STRICT JSON:
{
  "signal": "bullish|bearish|neutral",
  "confidence": "high|medium|low",
  "overview": "2-4 sentence high-level view",
  "neutralFactors": ["string", "string"],
  "catalystWatch": ["string", "string"],
  "riskFlags": ["string", "string"],
  "narrativeSummary": "1-2 sentence summary",
  "verdict": "1 sentence final call",
  "actionBias": "lean-bullish|lean-bearish|balanced",
  "suggestionTitle": "short recommendation title",
  "suggestionBullets": ["string", "string", "string"]
}

Rules:
- Ground synthesis in the provided inputs and both analyst arguments.
- No markdown, no extra text.
`,
    });

    return {
      symbol: safeSymbol,
      signal: sanitizeSignal(refereeRaw?.signal, "neutral"),
      confidence: sanitizeConfidence(refereeRaw?.confidence, "medium"),
      overview: String(refereeRaw?.overview || "").trim(),
      bullishFactors: bullAnalyst.points,
      bearishFactors: bearAnalyst.points,
      neutralFactors: sanitizeArray(refereeRaw?.neutralFactors, 6),
      catalystWatch: sanitizeArray(refereeRaw?.catalystWatch, 6),
      riskFlags: sanitizeArray(refereeRaw?.riskFlags, 6),
      narrativeSummary: String(refereeRaw?.narrativeSummary || "").trim(),
      companyProfile: companyProfile || {
        name: getCompanyLookupName(safeSymbol),
        description: "",
        summary: `${getCompanyLookupName(safeSymbol)} ${buildBusinessHint(
          safeSymbol,
          companyProfile?.name || getCompanyLookupName(safeSymbol)
        )}`,
        source: "fallback",
        updatedAt: new Date().toISOString(),
      },
      companyExplainer,
      agentPanels: {
        company:
          companyExplainer && Array.isArray(companyExplainer.bullets) && companyExplainer.bullets.length
            ? companyExplainer.bullets.slice(0, 3)
            : [],
        catalyst: sanitizeArray(catalystRaw?.bullets, 3),
        risk: sanitizeArray(riskRaw?.bullets, 3),
        source: "gradient-multi-agent",
        asOf: new Date().toISOString(),
      },
      gradientSuggestion: {
        title: String(refereeRaw?.suggestionTitle || "Risk-managed setup").trim() || "Risk-managed setup",
        bullets: sanitizeArray(refereeRaw?.suggestionBullets, 4),
        confidence: sanitizeConfidence(refereeRaw?.confidence, "medium"),
        asOf: new Date().toISOString(),
        source: "gradient",
      },
      debate: {
        bullAnalyst,
        bearAnalyst,
        referee: {
          summary: String(refereeRaw?.verdict || "").trim(),
          verdict: sanitizeSignal(refereeRaw?.signal, "neutral"),
          actionBias: sanitizeActionBias(refereeRaw?.actionBias, "balanced"),
          confidence: sanitizeConfidence(refereeRaw?.confidence, "medium"),
        },
      },
      newsUsed: news.map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate || "",
        source: item.source || "",
      })),
      quote: quote || null,
      source: "gradient-multi-agent",
      asOf: new Date().toISOString(),
    };
  } catch {
    return buildTickerReportFallback(safeSymbol, quote, news, companyProfile);
  }
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

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

function normalizeSchwabSession(value) {
  const clean = String(value || "").toUpperCase();
  const allowed = new Set(["NORMAL", "AM", "PM", "SEAMLESS"]);
  return allowed.has(clean) ? clean : "NORMAL";
}

function normalizeSchwabDuration(value) {
  const clean = String(value || "").toUpperCase();
  if (clean === "GOOD_TILL_CANCEL" || clean === "GTC") return "GOOD_TILL_CANCEL";
  return "DAY";
}

function normalizeSchwabOrderType(value) {
  const clean = String(value || "").toUpperCase();
  const allowed = new Set(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]);
  return allowed.has(clean) ? clean : "MARKET";
}

function normalizeSchwabInstruction(value) {
  const clean = String(value || "").toUpperCase();
  const allowed = new Set(["BUY", "SELL", "SELL_SHORT", "BUY_TO_COVER"]);
  return allowed.has(clean) ? clean : "BUY";
}

function compileOrderForSchwab(rawOrder) {
  if (!rawOrder || typeof rawOrder !== "object") {
    const err = new Error("order object is required.");
    err.status = 400;
    throw err;
  }

  const leg = Array.isArray(rawOrder.orderLegCollection) ? rawOrder.orderLegCollection[0] || {} : {};
  const symbol = normalizeTickerSymbol(leg?.instrument?.symbol || rawOrder?.symbol || "");
  if (!symbol) {
    const err = new Error("Order symbol is required.");
    err.status = 400;
    throw err;
  }

  const quantity = toPositiveInteger(leg?.quantity ?? rawOrder.quantity);
  if (!quantity) {
    const err = new Error("Order quantity must be greater than zero.");
    err.status = 400;
    throw err;
  }

  const orderType = normalizeSchwabOrderType(rawOrder.orderType);
  const price = toPositiveNumber(rawOrder.price);
  const stopPrice = toPositiveNumber(rawOrder.stopPrice);
  if ((orderType === "LIMIT" || orderType === "STOP_LIMIT") && !price) {
    const err = new Error("Limit/Stop-Limit orders require a valid price.");
    err.status = 400;
    throw err;
  }
  if ((orderType === "STOP" || orderType === "STOP_LIMIT") && !stopPrice) {
    const err = new Error("Stop/Stop-Limit orders require a valid stopPrice.");
    err.status = 400;
    throw err;
  }

  const compiled = {
    session: normalizeSchwabSession(rawOrder.session),
    duration: normalizeSchwabDuration(rawOrder.duration),
    orderType,
    complexOrderStrategyType: "NONE",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: normalizeSchwabInstruction(leg?.instruction),
        quantity,
        instrument: {
          symbol,
          assetType: "EQUITY",
        },
      },
    ],
  };

  if (orderType === "LIMIT" || orderType === "STOP_LIMIT") compiled.price = Number(price.toFixed(2));
  if (orderType === "STOP" || orderType === "STOP_LIMIT") compiled.stopPrice = Number(stopPrice.toFixed(2));

  return compiled;
}

function extractSchwabErrorMessage(payload, fallbackStatus) {
  if (!payload) return `Schwab request failed (${fallbackStatus || "unknown"})`;
  if (typeof payload === "string") return payload;
  if (payload.error_description) return String(payload.error_description);
  if (payload.message) return String(payload.message);
  if (payload.error) return String(payload.error);
  if (Array.isArray(payload.errors) && payload.errors.length) {
    const first = payload.errors[0] || {};
    const title = first.title || first.code || "Schwab rejected the request";
    const detail = first.detail || first.message || first.source || "";
    const id = first.id ? ` [id: ${first.id}]` : "";
    return `${title}${detail ? `: ${detail}` : ""}${id}`;
  }
  return `Schwab request failed (${fallbackStatus || "unknown"})`;
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

async function buildBeginnerMarketBrief(assets) {
  const safeAssets = Array.isArray(assets) ? assets.slice(0, 8) : [];
  const deltas = safeAssets
    .map((asset) => Number((((asset?.close || 0) - (asset?.open || 0)) / (asset?.open || 1)) * 100))
    .filter((value) => Number.isFinite(value));
  const upCount = deltas.filter((v) => v > 0).length;
  const downCount = deltas.filter((v) => v < 0).length;
  const tone = upCount > downCount ? "mostly up" : downCount > upCount ? "mostly down" : "mixed";
  const topMover = safeAssets
    .map((asset) => ({
      label: asset?.label || asset?.symbol || "Asset",
      pct: Number((((asset?.close || 0) - (asset?.open || 0)) / (asset?.open || 1)) * 100),
    }))
    .filter((row) => Number.isFinite(row.pct))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];

  const fallback = {
    headline: `Today looks ${tone}.`,
    summary: `${upCount} assets are up and ${downCount} are down in this snapshot.`,
    takeaways: [
      topMover ? `${topMover.label} is moving the most right now.` : "No clear leader in this snapshot yet.",
      "Green means prices are above the opening level. Red means below the opening level.",
      "Big one-day moves can reverse quickly, so avoid rushing into a single trade.",
    ],
    starterActions: [
      "Start with one or two symbols you understand and track them daily.",
      "Use small position sizes while learning how prices move after the open.",
      "Set a clear exit plan before entering any trade.",
    ],
    terms: [
      { term: "Open", meaning: "The first traded price when the market starts." },
      { term: "High / Low", meaning: "The highest and lowest prices seen so far today." },
      { term: "Volume", meaning: "How many shares changed hands today." },
    ],
    source: "fallback",
  };

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key || !safeAssets.length) return fallback;

  try {
    const base = endpoint.replace(/\/+$/, "");
    const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const upstream = await postJson(
      completionsUrl,
      {
        model: process.env.GRADIENT_MODEL || "openai-gpt-oss-120b",
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a beginner-friendly market explainer. Use plain American English and keep output concise.",
          },
          {
            role: "user",
            content: `Return STRICT JSON only with this shape:
{
  "headline":"string",
  "summary":"string",
  "takeaways":["string","string","string"],
  "starterActions":["string","string","string"],
  "terms":[{"term":"string","meaning":"string"},{"term":"string","meaning":"string"},{"term":"string","meaning":"string"}]
}

Rules:
- Explain for beginners with no jargon.
- Keep each item under 18 words.
- No markdown.

Market data JSON:
${JSON.stringify(safeAssets)}
`,
          },
        ],
      },
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      }
    );
    if (upstream.status < 200 || upstream.status >= 300) return fallback;
    const parsed = parseJsonFromModelContent(upstream.data?.choices?.[0]?.message?.content);
    if (!parsed) return fallback;
    return {
      headline: String(parsed?.headline || fallback.headline).trim(),
      summary: String(parsed?.summary || fallback.summary).trim(),
      takeaways: Array.isArray(parsed?.takeaways) ? parsed.takeaways.slice(0, 3).map((s) => String(s).trim()).filter(Boolean) : fallback.takeaways,
      starterActions: Array.isArray(parsed?.starterActions)
        ? parsed.starterActions.slice(0, 3).map((s) => String(s).trim()).filter(Boolean)
        : fallback.starterActions,
      terms: Array.isArray(parsed?.terms)
        ? parsed.terms
            .slice(0, 3)
            .map((row) => ({
              term: String(row?.term || "").trim(),
              meaning: String(row?.meaning || "").trim(),
            }))
            .filter((row) => row.term && row.meaning)
        : fallback.terms,
      source: "gradient",
    };
  } catch {
    return fallback;
  }
}

function sanitizeWatchboardValue(value, allowed, fallback) {
  const clean = String(value || "").trim().toLowerCase();
  return allowed.includes(clean) ? clean : fallback;
}

function normalizeWatchboardLayout(layout, index) {
  const allowedUniverse = [
    "sp500",
    "etf-focus",
    "tech-focus",
    "dividend-focus",
    "big-movers",
    "high-volatility",
    "my-holdings",
  ];
  const allowedSort = ["best-now", "lowest-risk", "big-movers"];
  const allowedSignal = ["all", "bullish", "bearish", "neutral", "no-data"];
  const allowedPrice = ["all", "under20", "20to100", "100to500", "500plus", "unknown"];
  const id = String(layout?.id || layout?.name || `watchboard-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    id: id || `watchboard-${index + 1}`,
    name: String(layout?.name || `Watchboard ${index + 1}`).trim(),
    description: String(layout?.description || "").trim(),
    universePreset: sanitizeWatchboardValue(layout?.universePreset, allowedUniverse, "sp500"),
    sortMode: sanitizeWatchboardValue(layout?.sortMode, allowedSort, "best-now"),
    signalFilter: sanitizeWatchboardValue(layout?.signalFilter, allowedSignal, "all"),
    priceFilter: sanitizeWatchboardValue(layout?.priceFilter, allowedPrice, "all"),
    searchHint: String(layout?.searchHint || "").trim().slice(0, 24),
    focusSymbols: Array.isArray(layout?.focusSymbols)
      ? layout.focusSymbols
          .map((symbol) => normalizeTickerSymbol(symbol))
          .filter(Boolean)
          .slice(0, 8)
      : [],
  };
}

async function buildTickerWatchboardLayouts() {
  const fallbackLayouts = [
    {
      id: "morning-scanner",
      name: "Morning Scanner",
      description: "Liquid names and major ETFs that usually react quickly at the open.",
      universePreset: "big-movers",
      sortMode: "big-movers",
      signalFilter: "all",
      priceFilter: "all",
      searchHint: "",
      focusSymbols: ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
    },
    {
      id: "swing-setup-board",
      name: "Swing Setup Board",
      description: "Cleaner trend names with less noise for multi-day positioning decisions.",
      universePreset: "tech-focus",
      sortMode: "best-now",
      signalFilter: "bullish",
      priceFilter: "20to100",
      searchHint: "",
      focusSymbols: ["MSFT", "AAPL", "AMD", "QCOM", "CRM"],
    },
    {
      id: "dividend-stability-board",
      name: "Dividend Stability Board",
      description: "Income-oriented symbols and slower moving names for steadier watchlists.",
      universePreset: "dividend-focus",
      sortMode: "lowest-risk",
      signalFilter: "all",
      priceFilter: "all",
      searchHint: "",
      focusSymbols: ["KO", "PEP", "PG", "JNJ", "ABBV"],
    },
  ].map(normalizeWatchboardLayout);

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key) {
    return {
      source: "fallback",
      generatedAt: new Date().toISOString(),
      layouts: fallbackLayouts,
    };
  }

  try {
    const base = endpoint.replace(/\/+$/, "");
    const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const model = process.env.GRADIENT_MODEL || "openai-gpt-oss-120b";
    const prompt = `Return STRICT JSON only.
{
  "layouts": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "universePreset": "sp500|etf-focus|tech-focus|dividend-focus|big-movers|high-volatility|my-holdings",
      "sortMode": "best-now|lowest-risk|big-movers",
      "signalFilter": "all|bullish|bearish|neutral|no-data",
      "priceFilter": "all|under20|20to100|100to500|500plus|unknown",
      "searchHint": "string",
      "focusSymbols": ["AAPL","MSFT"]
    }
  ]
}

Rules:
- Return exactly 3 layouts.
- Focus on practical stock watchboard experiences for active users.
- Keep names short and description under 14 words.
- No markdown, no extra text.
`;
    const parsed = await gradientStructuredJson({
      completionsUrl,
      key,
      model,
      systemPrompt:
        "You design concise market watchboard layouts for a stock analysis UI. Return valid JSON only.",
      userPrompt: prompt,
    });
    const layouts = Array.isArray(parsed?.layouts)
      ? parsed.layouts.map(normalizeWatchboardLayout).filter((layout) => layout.name)
      : [];
    return {
      source: layouts.length ? "gradient" : "fallback",
      generatedAt: new Date().toISOString(),
      layouts: layouts.length ? layouts : fallbackLayouts,
    };
  } catch {
    return {
      source: "fallback",
      generatedAt: new Date().toISOString(),
      layouts: fallbackLayouts,
    };
  }
}

app.get(["/market/overview", "/api/market/overview"], async (_req, res) => {
  const redisKey = buildRedisCacheKey("market-overview");
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    sendJson(res, 200, redisCached);
    return;
  }
  const cached = getFreshCache(marketOverviewCache, MARKET_OVERVIEW_TTL_MS);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }
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
    const beginnerBrief = await buildBeginnerMarketBrief(assets);
    const payload = {
      source: "stooq",
      updatedAt: new Date().toISOString(),
      assets,
      beginnerBrief,
    };
    marketOverviewCache.data = payload;
    marketOverviewCache.fetchedAt = Date.now();
    await setRedisCacheJson(redisKey, payload, MARKET_OVERVIEW_TTL_MS);
    sendJson(res, 200, payload);
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

app.post(["/agents/portfolio-brief", "/api/agents/portfolio-brief"], async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const redisKey = buildRedisCacheKey("agent-portfolio-brief-v1", hashPayloadForCache(payload));
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    sendJson(res, 200, redisCached);
    return;
  }

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key) {
    const fallback = buildPortfolioBriefFallback(payload);
    await setRedisCacheJson(redisKey, fallback, AGENT_BRIEF_TTL_MS);
    sendJson(res, 200, fallback);
    return;
  }

  try {
    const base = endpoint.replace(/\/+$/, "");
    const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const model = process.env.GRADIENT_MODEL || "openai-gpt-oss-120b";
    const aiRaw = await gradientStructuredJson({
      completionsUrl,
      key,
      model,
      systemPrompt:
        "You are a portfolio coaching panel. Return concise bullets in plain American English. Return strict JSON only.",
      userPrompt: `
Portfolio snapshot JSON:
${JSON.stringify(payload, null, 2)}

Return STRICT JSON:
{
  "allocation": ["string","string","string"],
  "risk": ["string","string","string"],
  "income": ["string","string","string"]
}

Rules:
- 2-3 bullets per section.
- Keep each bullet under 16 words.
- No markdown, no extra text.
`,
    });
    const output = {
      source: "gradient",
      asOf: new Date().toISOString(),
      allocation: sanitizeArray(aiRaw?.allocation, 3),
      risk: sanitizeArray(aiRaw?.risk, 3),
      income: sanitizeArray(aiRaw?.income, 3),
    };
    const normalized =
      output.allocation.length && output.risk.length && output.income.length
        ? output
        : buildPortfolioBriefFallback(payload);
    await setRedisCacheJson(redisKey, normalized, AGENT_BRIEF_TTL_MS);
    sendJson(res, 200, normalized);
  } catch {
    const fallback = buildPortfolioBriefFallback(payload);
    await setRedisCacheJson(redisKey, fallback, AGENT_BRIEF_TTL_MS);
    sendJson(res, 200, fallback);
  }
});

app.post(["/agents/shopping-brief", "/api/agents/shopping-brief"], async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const redisKey = buildRedisCacheKey("agent-shopping-brief-v1", hashPayloadForCache(payload));
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    sendJson(res, 200, redisCached);
    return;
  }

  const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
  const key = process.env.GRADIENT_AGENT_KEY;
  if (!endpoint || !key) {
    const fallback = buildShoppingBriefFallback(payload);
    await setRedisCacheJson(redisKey, fallback, AGENT_BRIEF_TTL_MS);
    sendJson(res, 200, fallback);
    return;
  }

  try {
    const base = endpoint.replace(/\/+$/, "");
    const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const model = process.env.GRADIENT_MODEL || "openai-gpt-oss-120b";
    const aiRaw = await gradientStructuredJson({
      completionsUrl,
      key,
      model,
      systemPrompt:
        "You are a trading execution support panel. Return concise bullets in plain American English. Return strict JSON only.",
      userPrompt: `
Shopping cart snapshot JSON:
${JSON.stringify(payload, null, 2)}

Return STRICT JSON:
{
  "planner": ["string","string","string"],
  "execution": ["string","string","string"]
}

Rules:
- 2-3 bullets per section.
- Keep each bullet under 16 words.
- No markdown, no extra text.
`,
    });
    const output = {
      source: "gradient",
      asOf: new Date().toISOString(),
      planner: sanitizeArray(aiRaw?.planner, 3),
      execution: sanitizeArray(aiRaw?.execution, 3),
    };
    const normalized = output.planner.length && output.execution.length ? output : buildShoppingBriefFallback(payload);
    await setRedisCacheJson(redisKey, normalized, AGENT_BRIEF_TTL_MS);
    sendJson(res, 200, normalized);
  } catch {
    const fallback = buildShoppingBriefFallback(payload);
    await setRedisCacheJson(redisKey, fallback, AGENT_BRIEF_TTL_MS);
    sendJson(res, 200, fallback);
  }
});

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
      agentBriefs: {
        macro: ["Macro Agent: Watch index direction and bond yield moves into the opening hour."],
        sector: ["Sector Agent: Track where leadership appears after the first 15 minutes."],
        opening: ["Opening Agent: Focus on liquid names with clean opening-range behavior."],
      },
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
  "notes": "string",
  "agentBriefs": {
    "macro": ["string","string"],
    "sector": ["string","string"],
    "opening": ["string","string"]
  }
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
  const parsedBriefs = parsed?.agentBriefs && typeof parsed.agentBriefs === "object" ? parsed.agentBriefs : {};
  return {
    asOf: new Date().toISOString(),
    source: "gradient",
    buckets,
    notes: parsed?.notes || "",
    agentBriefs: {
      macro: sanitizeArray(parsedBriefs?.macro, 3),
      sector: sanitizeArray(parsedBriefs?.sector, 3),
      opening: sanitizeArray(parsedBriefs?.opening, 3),
    },
    marketSnapshot,
  };
}

app.get(["/market/opening-playbook", "/api/market/opening-playbook"], async (_req, res) => {
  const redisKey = buildRedisCacheKey("opening-playbook-v2");
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    sendJson(res, 200, redisCached);
    return;
  }
  const cached = getFreshCache(openingPlaybookCache, OPENING_PLAYBOOK_TTL_MS);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }
  try {
    const playbook = await buildOpeningPlaybook();
    openingPlaybookCache.data = playbook;
    openingPlaybookCache.fetchedAt = Date.now();
    await setRedisCacheJson(redisKey, playbook, OPENING_PLAYBOOK_TTL_MS);
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
  const redisKey = buildRedisCacheKey("market-quotes", symbols.join(","));
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    sendJson(res, 200, redisCached);
    return;
  }

  try {
    const resolvedNames = await resolveCompanyNamesForSymbols(symbols);
    const quotes = (
      await Promise.all(
        symbols.map((symbol) =>
          fetchStooqQuote(normalizeTickerForStooq(symbol), symbol).catch(() => null)
        )
      )
    )
      .filter(Boolean)
      .map((quote) => {
        const safeSymbol = normalizeTickerSymbol(quote?.symbol || quote?.label || "");
        const resolved = String(resolvedNames?.[safeSymbol] || quote?.companyName || quote?.label || safeSymbol).trim();
        return {
          ...quote,
          symbol: safeSymbol || quote.symbol,
          companyName: resolved || safeSymbol || quote.symbol,
          label: resolved || safeSymbol || quote.symbol,
        };
      });

    const bySymbol = Object.fromEntries(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
    const payload = {
      updatedAt: new Date().toISOString(),
      quotes: symbols.map((symbol) =>
        bySymbol[symbol] || {
          symbol,
          label: resolvedNames[symbol] || symbol,
          companyName: resolvedNames[symbol] || symbol,
          unavailable: true,
        }
      ),
    };
    await setRedisCacheJson(redisKey, payload, 15 * 1000);
    sendJson(res, 200, payload);
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Failed to load market quotes." });
  }
});

app.get(["/market/company-names", "/api/market/company-names"], async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 500);
  if (!symbols.length) {
    sendJson(res, 400, { error: "symbols query param is required." });
    return;
  }
  try {
    const names = await resolveCompanyNamesForSymbols(symbols);
    sendJson(res, 200, {
      updatedAt: new Date().toISOString(),
      source: "sec+ticker-lookup",
      names,
    });
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Failed to load company names." });
  }
});

async function refreshTickerReportCache(symbol, { force = false } = {}) {
  const safeSymbol = normalizeTickerSymbol(symbol);
  if (!safeSymbol) throw new Error("Ticker symbol is required.");
  const redisKey = buildRedisCacheKey("ticker-report-v5", safeSymbol);

  if (!force) {
    const redisCached = await getRedisCacheJson(redisKey);
    if (redisCached) return redisCached;
    const cached = tickerReportCache.get(safeSymbol);
    if (cached && Date.now() - cached.fetchedAt < TICKER_REPORT_TTL_MS) return cached.data;
  }

  const inFlight = tickerReportInFlight.get(safeSymbol);
  if (inFlight) return inFlight;

  const work = (async () => {
    const report = await buildTickerDeepDiveReport(safeSymbol);
    tickerReportCache.set(safeSymbol, { data: report, fetchedAt: Date.now() });
    await setRedisCacheJson(redisKey, report, TICKER_REPORT_TTL_MS);
    return report;
  })();
  tickerReportInFlight.set(safeSymbol, work);
  try {
    return await work;
  } finally {
    tickerReportInFlight.delete(safeSymbol);
  }
}

function parseReportAgeMs(report) {
  const asOf = Date.parse(String(report?.asOf || ""));
  if (!Number.isFinite(asOf)) return Infinity;
  return Date.now() - asOf;
}

function backgroundRefreshTickerReport(symbol) {
  refreshTickerReportCache(symbol, { force: true }).catch(() => ({}));
}

app.get(["/market/ticker-report", "/api/market/ticker-report"], async (req, res) => {
  const symbol = normalizeTickerSymbol(req.query.symbol || "");
  if (!symbol) {
    sendJson(res, 400, { error: "symbol query param is required." });
    return;
  }
  const redisKey = buildRedisCacheKey("ticker-report-v5", symbol);
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    if (parseReportAgeMs(redisCached) > TICKER_REPORT_TTL_MS / 3) backgroundRefreshTickerReport(symbol);
    sendJson(res, 200, redisCached);
    return;
  }
  const cached = tickerReportCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < TICKER_REPORT_TTL_MS) {
    if (parseReportAgeMs(cached.data) > TICKER_REPORT_TTL_MS / 3) backgroundRefreshTickerReport(symbol);
    sendJson(res, 200, cached.data);
    return;
  }
  try {
    const report = await refreshTickerReportCache(symbol, { force: true });
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

app.get(["/market/ticker-watchboards", "/api/market/ticker-watchboards"], async (_req, res) => {
  const redisKey = buildRedisCacheKey("ticker-watchboards");
  const redisCached = await getRedisCacheJson(redisKey);
  if (redisCached) {
    sendJson(res, 200, redisCached);
    return;
  }
  const cached = getFreshCache(tickerWatchboardsCache, TICKER_WATCHBOARDS_TTL_MS);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }
  try {
    const payload = await buildTickerWatchboardLayouts();
    tickerWatchboardsCache.data = payload;
    tickerWatchboardsCache.fetchedAt = Date.now();
    await setRedisCacheJson(redisKey, payload, TICKER_WATCHBOARDS_TTL_MS);
    sendJson(res, 200, payload);
  } catch (err) {
    sendJson(res, 502, { error: err.message || "Failed to build ticker watchboards." });
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
    let accountNumbers = [];
    const diagnostics = [];

    const accountNumberResult = await schwabApiRequest(tokenBundle, "GET", "/accounts/accountNumbers");
    diagnostics.push({ key: "accountNumbers", status: accountNumberResult.status, data: accountNumberResult.data });
    if (
      accountNumberResult.status >= 200 &&
      accountNumberResult.status < 300 &&
      Array.isArray(accountNumberResult.data)
    ) {
      accountNumbers = accountNumberResult.data;
    }

    // Fallback 1: /accounts without fields.
    if (!accountNumbers.length) {
      const accountsBasic = await schwabApiRequest(tokenBundle, "GET", "/accounts");
      diagnostics.push({ key: "accountsBasic", status: accountsBasic.status, data: accountsBasic.data });
      if (accountsBasic.status >= 200 && accountsBasic.status < 300 && Array.isArray(accountsBasic.data)) {
        accountNumbers = accountsBasic.data
          .map((entry) => ({
            accountNumber: entry?.securitiesAccount?.accountNumber || entry?.accountNumber || null,
            hashValue: entry?.securitiesAccount?.hashValue || entry?.hashValue || null,
          }))
          .filter((entry) => entry.accountNumber || entry.hashValue);
      }
    }

    // Fallback 2: /accounts with positions for compatibility with older behavior.
    if (!accountNumbers.length) {
      const accountsWithPositions = await schwabApiRequest(tokenBundle, "GET", "/accounts", { fields: "positions" });
      diagnostics.push({
        key: "accountsPositions",
        status: accountsWithPositions.status,
        data: accountsWithPositions.data,
      });
      if (
        accountsWithPositions.status >= 200 &&
        accountsWithPositions.status < 300 &&
        Array.isArray(accountsWithPositions.data)
      ) {
        accountNumbers = accountsWithPositions.data
          .map((entry) => ({
            accountNumber: entry?.securitiesAccount?.accountNumber || entry?.accountNumber || null,
            hashValue: entry?.securitiesAccount?.hashValue || entry?.hashValue || null,
          }))
          .filter((entry) => entry.accountNumber || entry.hashValue);
      }
    }

    if (!accountNumbers.length) {
      const summary = diagnostics
        .map((d) => {
          const detail =
            d.data?.error_description ||
            d.data?.message ||
            d.data?.error ||
            (d.data && typeof d.data === "object" ? JSON.stringify(d.data) : "") ||
            "no_detail";
          return `${d.key}=${d.status} (${String(detail).slice(0, 180)})`;
        })
        .join(", ");
      throw new Error(`Schwab account link failed: ${summary}`);
    }

    req.session.schwabTokens = tokenBundle;
    req.session.schwabConnected = true;
    req.session.schwabConnectedAt = new Date().toISOString();
    req.session.accountNumbers = accountNumbers;
    req.session.primaryAccountNumber = accountNumbers[0]?.accountNumber || null;
    req.session.primaryAccountHash = accountNumbers[0]?.hashValue || null;
    delete req.session.oauthState;
    delete req.session.oauthStartedAt;

    res.redirect(`${CLIENT_APP_URL}?schwab=connected`);
  } catch (err) {
    req.session.schwabConnected = false;
    delete req.session.schwabTokens;
    delete req.session.accountNumbers;
    delete req.session.primaryAccountNumber;
    delete req.session.primaryAccountHash;
    delete req.session.oauthState;
    delete req.session.oauthStartedAt;
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
  if (req.session) req.session.cached = {};
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

app.post("/api/schwab/logout", (req, res) => {
  if (req.sessionId) {
    sessionStore.delete(req.sessionId);
  }
  if (req.session) req.session.cached = {};
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

app.get(["/schwab/accounts", "/api/schwab/accounts"], requireSchwabAuth, async (req, res) => {
  const cacheKey = "accounts:positions";
  const cached = readSessionCache(req.session, cacheKey);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }
  try {
    const result = await schwabRequestWithSession(req.session, "GET", "/accounts", {
      fields: "positions",
    });
    if (result.status >= 200 && result.status < 300) {
      writeSessionCache(req.session, cacheKey, result.data);
    }
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
  const cacheKey = `orders-open:${String(accountHash)}:${String(req.query.maxResults || 50)}`;
  const cached = readSessionCache(req.session, cacheKey, SCHWAB_CACHE_TTL_MS);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }
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
    const payload = { accountHash, orders: openOrders, rawCount: orders.length };
    if (result.status >= 200 && result.status < 300) {
      writeSessionCache(req.session, cacheKey, payload);
    }
    sendJson(res, result.status, payload);
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

app.post(["/schwab/order-plan", "/api/schwab/order-plan"], requireSchwabAuth, async (req, res) => {
  const symbol = normalizeTickerSymbol(req.body?.symbol || "");
  const quantity = Math.max(1, Math.floor(Number(req.body?.quantity || 1)));
  const executionStyle = String(req.body?.executionStyle || "fast-fill").toLowerCase() === "smart-price" ? "smart-price" : "fast-fill";
  const sideHint = sanitizeExecutionSide(req.body?.sideHint || "BUY", "BUY");
  if (!symbol) {
    sendJson(res, 400, { error: "A valid symbol is required." });
    return;
  }

  try {
    const quoteResult = await schwabRequestWithSession(req.session, "GET", "/marketdata/quotes", {
      symbols: symbol,
      fields: "quote",
    });
    const quote = readSchwabQuote(quoteResult.data, symbol);
    const endpoint = process.env.GRADIENT_AGENT_ENDPOINT;
    const key = process.env.GRADIENT_AGENT_KEY;
    if (!endpoint || !key || !quote) {
      sendJson(res, 200, {
        ok: true,
        plan: buildFallbackOrderPlan({ symbol, quantity, executionStyle, sideHint, quote }),
      });
      return;
    }

    const base = endpoint.replace(/\/+$/, "");
    const completionsUrl = base.includes("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const model = process.env.GRADIENT_MODEL || "openai-gpt-oss-120b";
    const aiRaw = await gradientStructuredJson({
      completionsUrl,
      key,
      model,
      systemPrompt:
        "You are an execution planning assistant for a brokerage order router. Return strict JSON only with conservative order fields that maximize valid submission and practical fill odds.",
      userPrompt: `
Return STRICT JSON:
{
  "side": "BUY|SELL",
  "orderType": "MARKET|LIMIT|STOP|STOP_LIMIT",
  "duration": "DAY|GTC",
  "limitPrice": number|null,
  "stopPrice": number|null,
  "rationale": "1 sentence plain English"
}

Inputs:
- Symbol: ${symbol}
- Quantity: ${quantity}
- Execution style: ${executionStyle}
- Side hint: ${sideHint}
- Quote JSON: ${JSON.stringify(quote, null, 2)}

Rules:
- fast-fill style should strongly prefer MARKET DAY.
- smart-price style should prefer LIMIT near touch (ask for BUY, bid for SELL).
- If orderType does not need a field, set it to null.
- Keep rationale concise.
- No markdown. No extra keys.
`,
    });

    const side = sanitizeExecutionSide(aiRaw?.side, sideHint);
    const orderType = sanitizeExecutionOrderType(
      aiRaw?.orderType,
      executionStyle === "smart-price" ? "LIMIT" : "MARKET"
    );
    const duration = sanitizeExecutionDuration(aiRaw?.duration, "DAY");
    let limitPrice = toNumberOrNull(aiRaw?.limitPrice);
    let stopPrice = toNumberOrNull(aiRaw?.stopPrice);
    if (!(orderType === "LIMIT" || orderType === "STOP_LIMIT")) limitPrice = null;
    if (!(orderType === "STOP" || orderType === "STOP_LIMIT")) stopPrice = null;

    const plan = {
      symbol,
      quantity,
      side,
      orderType,
      duration,
      limitPrice,
      stopPrice,
      source: "gradient",
      rationale: String(aiRaw?.rationale || "").trim() || "AI generated execution settings.",
    };
    sendJson(res, 200, { ok: true, plan });
  } catch {
    try {
      const quoteResult = await schwabRequestWithSession(req.session, "GET", "/marketdata/quotes", {
        symbols: symbol,
        fields: "quote",
      });
      const quote = readSchwabQuote(quoteResult.data, symbol);
      sendJson(res, 200, {
        ok: true,
        plan: buildFallbackOrderPlan({ symbol, quantity, executionStyle, sideHint, quote }),
      });
    } catch (err) {
      sendJson(res, err.status || 502, { error: err.message || "Failed to build order plan." });
    }
  }
});

app.get(["/schwab/orders/recent", "/api/schwab/orders/recent"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.query.accountHash || req.session.primaryAccountHash;
  if (!accountHash) {
    sendJson(res, 400, { error: "No account hash available for orders." });
    return;
  }
  const maxResults = Math.max(1, Math.min(50, Number(req.query.maxResults || 25)));
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();
  try {
    const result = await schwabRequestWithSession(
      req.session,
      "GET",
      `/accounts/${encodeURIComponent(String(accountHash))}/orders`,
      {
        fromEnteredTime: from,
        toEnteredTime: to,
        maxResults,
      }
    );
    const list = Array.isArray(result.data) ? result.data : result.data?.orders || [];
    const sorted = list
      .slice()
      .sort((a, b) => Date.parse(b?.enteredTime || 0) - Date.parse(a?.enteredTime || 0))
      .slice(0, maxResults);
    sendJson(res, result.status, { accountHash, orders: sorted, rawCount: list.length });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to fetch recent orders." });
  }
});

app.post(["/schwab/orders", "/api/schwab/orders"], requireSchwabAuth, async (req, res) => {
  const accountHash = req.body?.accountHash || req.session.primaryAccountHash;
  const order = req.body?.order;
  if (!accountHash) {
    sendJson(res, 400, { error: "accountHash is required." });
    return;
  }
  let compiledOrder;
  try {
    compiledOrder = compileOrderForSchwab(order);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message || "Invalid order payload." });
    return;
  }

  const maxQty = extractMaxQuantityFromOrder(compiledOrder);
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
      compiledOrder
    );
    if (result.status >= 200 && result.status < 300) {
      clearSessionCacheByPrefix(req.session, "orders-open:");
      clearSessionCacheByPrefix(req.session, "accounts:");
      sendJson(res, result.status, {
        ok: true,
        result: result.data,
        accountHash: String(accountHash),
        orderId: extractOrderIdFromHeaders(result.headers),
        location: extractHeaderValue(result.headers, "location"),
        correlationId: extractHeaderValue(result.headers, "schwab-client-correlid"),
      });
      return;
    }
    sendJson(res, result.status, {
      ok: false,
      accountHash: String(accountHash),
      error: extractSchwabErrorMessage(result.data, result.status),
      correlationId: extractHeaderValue(result.headers, "schwab-client-correlid"),
      result: result.data,
    });
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
    if (result.status >= 200 && result.status < 300) {
      clearSessionCacheByPrefix(req.session, "orders-open:");
      clearSessionCacheByPrefix(req.session, "accounts:");
    }
    sendJson(res, result.status, { ok: result.status >= 200 && result.status < 300, result: result.data });
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message || "Failed to cancel order." });
  }
});

async function prewarmHotTickerReports() {
  if (tickerPrewarmRunning) return;
  tickerPrewarmRunning = true;
  const hotSymbols = FALLBACK_TICKER_UNIVERSE.slice(0, 40);
  try {
    for (const symbol of hotSymbols) {
      await refreshTickerReportCache(symbol, { force: true }).catch(() => ({}));
    }
  } finally {
    tickerPrewarmRunning = false;
  }
}

async function startServer() {
  initRedisCache();
  prewarmHotTickerReports().catch(() => ({}));
  setInterval(() => {
    prewarmHotTickerReports().catch(() => ({}));
  }, TICKER_PREWARM_INTERVAL_MS);
  app.listen(PORT, () => {
    console.log(`API service listening on port ${PORT}`);
  });
}

startServer();
