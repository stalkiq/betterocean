const topTabs = document.getElementById("topTabs");
const railButtons = [...document.querySelectorAll(".rail-btn")];
const menuButtons = [...document.querySelectorAll(".menu-item")];
const appShell = document.querySelector(".app-shell");
const titleEl = document.getElementById("workspaceTitle");
const subEl = document.getElementById("workspaceSub");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatLog = document.getElementById("chatLog");
const workspaceTableWrap = document.getElementById("workspaceTableWrap");
const chatPanelTitle = document.getElementById("chatPanelTitle");
const chatPanelBadge = document.getElementById("chatPanelBadge");
const workspaceRefreshBtn = document.getElementById("workspaceRefreshBtn");
const openShoppingCartBtn = document.getElementById("openShoppingCartBtn");

const DO_API_BASE = "https://api.digitalocean.com";
const TOKEN_KEY = "do_api_token";
const API_CHAT_URL = "/api/chat/message";
const SCHWAB_CONNECT_TAB = "Schwab Connect";
const PORTFOLIO_TAB = "My Holdings";
const INVESTMENTS_TAB = "Investments";
const TICKER_INTEL_TAB = "Ticker Intel";
const TIME_TAB = "Time";
const SHOPPING_TAB = "Shopping";
const HOME_TAB = SCHWAB_CONNECT_TAB;
const SCHWAB_FUNDING_URL = "https://www.schwab.com/fund-your-account";
const RESPONSE_STYLE_PROMPT =
  "Reply in 3-6 concise bullet points with short, scannable lines. Keep spacing clean and avoid long paragraphs.";
const UI_PREFS_KEY = "bo_ui_prefs_v1";
const MARKET_TAB_TTL_MS = 90 * 1000;
const TICKER_REPORT_TTL_MS = 5 * 60 * 1000;
const TICKER_QUOTES_TTL_MS = 2 * 60 * 1000;

const AGENTS = [
  {
    id: "portfolio-copilot",
    tab: "Portfolio Copilot",
    subtitle: "Allocation, concentration, and rebalance ideas",
    description:
      "Uses live Schwab account structure to summarize portfolio shape, identify concentration, and suggest practical next actions.",
    insights: [
      "Highlights top positions by weight and unrealized impact.",
      "Flags portfolio concentration where one name drives risk.",
      "Suggests small, staged rebalance moves instead of all-at-once shifts.",
    ],
    prompts: [
      "Give me a rebalance plan using my current Schwab holdings.",
      "What are my top concentration risks right now?",
      "What are the first 3 practical portfolio actions for this week?",
    ],
    systemPrompt:
      "You are Portfolio Copilot. Use portfolio context to give concise allocation and rebalance guidance with clear, low-friction actions.",
  },
  {
    id: "risk-radar",
    tab: "Risk Radar",
    subtitle: "Scenario risk, downside triggers, and hedge ideas",
    description:
      "Acts like an on-demand risk desk: concentration checks, downside scenarios, and hedge-aware risk controls for active portfolios.",
    insights: [
      "Translates position-level exposure into scenario-level risk language.",
      "Prioritizes downside before upside to preserve capital.",
      "Emphasizes position sizing, cash buffers, and stop discipline.",
    ],
    prompts: [
      "Run a 30-day downside stress check on my current portfolio.",
      "Where am I most exposed if market volatility spikes?",
      "What hedge options should I consider right now?",
    ],
    systemPrompt:
      "You are Risk Radar. Prioritize downside protection, scenario analysis, and disciplined risk actions using current portfolio context.",
  },
  {
    id: "order-flow-execution",
    tab: "Order Flow & Execution",
    subtitle: "Open orders, stale order cleanup, and execution tactics",
    description:
      "Monitors open orders and execution quality, helping users place, adjust, and cancel orders with cleaner workflow discipline.",
    insights: [
      "Surfaces stale open orders that likely need review.",
      "Encourages incremental entries/exits over emotional all-in orders.",
      "Turns order state data into concrete next execution steps.",
    ],
    prompts: [
      "Review my open orders and tell me what to cancel or adjust.",
      "What execution plan should I use for a volatile day?",
      "How should I stage entries for a 3-leg buy plan?",
    ],
    systemPrompt:
      "You are Order Flow & Execution. Focus on practical order management, reducing execution mistakes, and improving trade workflow quality.",
  },
];

const AGENT_BY_ID = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent]));
const AGENT_BY_TAB = Object.fromEntries(AGENTS.map((agent) => [agent.tab, agent]));

const openTabs = new Set([HOME_TAB, PORTFOLIO_TAB, INVESTMENTS_TAB, TICKER_INTEL_TAB, TIME_TAB]);
let currentTab = HOME_TAB;
let currentAgentId = AGENTS[0].id;
const announcedAgents = new Set();

let chatHistory = [];
let schwabSession = { connected: false };
let schwabData = { accounts: null, openOrders: null, accountError: "" };
let investmentsMarket = { assets: [], updatedAt: null };
let openingPlaybook = { buckets: [], asOf: null };
let openingQuotesBySymbol = {};
const DEFAULT_TICKER_WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "UNH"];
const SHOPPING_10_TO_50_SYMBOLS = ["F", "PFE", "BAC", "INTC", "T", "VZ", "KHC", "CCL", "SNAP", "PARA"];
const SYMBOL_COMPANY_NAMES = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  META: "Meta",
  TSLA: "Tesla",
  JPM: "JPMorgan Chase",
  XOM: "Exxon Mobil",
  UNH: "UnitedHealth Group",
  F: "Ford",
  PFE: "Pfizer",
  BAC: "Bank of America",
  INTC: "Intel",
  T: "AT&T",
  VZ: "Verizon",
  KHC: "Kraft Heinz",
  CCL: "Carnival",
  SNAP: "Snap",
  PARA: "Paramount Global",
};
const ETF_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "XLF", "XLK", "XLE", "XLV", "XLI", "XLP", "XLY", "TLT", "GLD"];
const TECH_FOCUS_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AVGO", "AMD", "INTC", "QCOM", "TSM", "ADBE", "CRM", "ORCL", "META"];
const DIVIDEND_FOCUS_SYMBOLS = ["KO", "PEP", "PG", "JNJ", "XOM", "CVX", "T", "VZ", "PFE", "MCD", "WMT", "ABBV"];
let tickerIntelState = {
  selected: "AAPL",
  loading: false,
  report: null,
  error: "",
  universe: [],
  universeSource: "",
  loadedQuotes: 0,
  loadingUniverse: false,
  quoteBySymbol: {},
  signalFilter: "all",
  priceFilter: "all",
  search: "",
  sortMode: "best-now",
  universePreset: "sp500",
  detailTab: "rating",
  allUniverse: [],
  reportCache: {},
  reportCacheAt: {},
  quotesUpdatedAt: 0,
};
let shoppingState = {
  items: [],
  submitting: false,
  status: "",
  quoteBySymbol: {},
  quotesUpdatedAt: 0,
  loadingQuotes: false,
};
let marketCountdownTimer = null;
let marketOpenThemeTimer = null;
let tickerUniverseQuotesPromise = null;
let shoppingMarketClockTimer = null;
let tickerUniverseRequestId = 0;
let tickerReportRequestId = 0;
let investmentsLoadedAt = 0;
let openingPlaybookLoadedAt = 0;

function getDoToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setDoToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function readUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeUiPrefs(next) {
  const current = readUiPrefs();
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ ...current, ...next }));
}

function applyLayoutPrefs() {
  if (!appShell) return;
  const prefs = readUiPrefs();
  appShell.classList.toggle("left-collapsed", Boolean(prefs.leftCollapsed));
  appShell.classList.toggle("chat-collapsed", Boolean(prefs.chatCollapsed));
  const leftToggle = document.getElementById("toggleLeftPanelBtn");
  const chatToggle = document.getElementById("toggleChatPanelBtn");
  if (leftToggle) leftToggle.textContent = prefs.leftCollapsed ? "Show Left" : "Hide Left";
  if (chatToggle) chatToggle.textContent = prefs.chatCollapsed ? "Show Chat" : "Hide Chat";
}

async function doApi(path, token) {
  const res = await fetch(`${DO_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.id || `HTTP ${res.status}`);
  return data;
}

async function schwabApi(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Schwab request failed (${res.status})`);
  return data;
}

async function refreshSchwabSession() {
  try {
    schwabSession = await schwabApi("/api/schwab/me", { method: "GET" });
  } catch {
    schwabSession = { connected: false };
  }
  updateSchwabChatBadge();
}

async function loadSchwabContextData() {
  if (!schwabSession.connected) {
    schwabData = { accounts: null, openOrders: null, accountError: "" };
    return;
  }
  const [accountsResult, openOrdersResult] = await Promise.allSettled([
    schwabApi("/api/schwab/accounts", { method: "GET" }),
    schwabApi("/api/schwab/orders/open?maxResults=25", { method: "GET" }),
  ]);

  const accounts = accountsResult.status === "fulfilled" ? accountsResult.value : null;
  const accountError =
    accountsResult.status === "rejected" ? String(accountsResult.reason?.message || "Failed to load Schwab accounts.") : "";
  const openOrders =
    openOrdersResult.status === "fulfilled"
      ? openOrdersResult.value
      : { accountHash: schwabSession.accountHash || null, orders: [], rawCount: 0 };

  // Preserve whichever payload succeeds so account visibility isn't lost when orders endpoint fails.
  schwabData = { accounts, openOrders, accountError };
}

async function loadInvestmentsMarketData() {
  const data = await schwabApi("/api/market/overview", { method: "GET" });
  investmentsMarket = {
    assets: Array.isArray(data.assets) ? data.assets : [],
    updatedAt: data.updatedAt || null,
  };
  return investmentsMarket;
}

async function loadOpeningPlaybook() {
  const data = await schwabApi("/api/market/opening-playbook", { method: "GET" });
  openingPlaybook = {
    buckets: Array.isArray(data.buckets) ? data.buckets : [],
    asOf: data.asOf || null,
    notes: data.notes || "",
    source: data.source || "unknown",
  };
  return openingPlaybook;
}

async function loadTickerIntelReport(symbol) {
  const safeSymbol = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!safeSymbol) throw new Error("Ticker symbol is required.");

  const cachedReport = tickerIntelState.reportCache[safeSymbol];
  const cachedAt = Number(tickerIntelState.reportCacheAt[safeSymbol] || 0);
  if (cachedReport && Date.now() - cachedAt < TICKER_REPORT_TTL_MS) {
    tickerIntelState = {
      ...tickerIntelState,
      selected: safeSymbol,
      loading: false,
      report: cachedReport,
      error: "",
    };
    return cachedReport;
  }

  const reqId = ++tickerReportRequestId;
  const data = await schwabApi(`/api/market/ticker-report?symbol=${encodeURIComponent(safeSymbol)}`, {
    method: "GET",
  });
  if (reqId !== tickerReportRequestId) return data;

  tickerIntelState = {
    ...tickerIntelState,
    selected: safeSymbol,
    loading: false,
    report: data,
    error: "",
    reportCache: { ...tickerIntelState.reportCache, [safeSymbol]: data },
    reportCacheAt: { ...tickerIntelState.reportCacheAt, [safeSymbol]: Date.now() },
  };
  return data;
}

async function loadTickerUniverse(limit = 500) {
  const data = await schwabApi(`/api/market/ticker-universe?limit=${Math.min(500, Math.max(50, Number(limit) || 500))}`, {
    method: "GET",
  });
  const symbols = Array.isArray(data.symbols)
    ? [...new Set(data.symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))]
    : [];
  const nextAll = symbols.length ? symbols : DEFAULT_TICKER_WATCHLIST;
  tickerIntelState = {
    ...tickerIntelState,
    allUniverse: nextAll,
    universe: nextAll,
    universeSource: "",
    loadingUniverse: false,
    selected: nextAll.includes(tickerIntelState.selected) ? tickerIntelState.selected : nextAll[0] || "AAPL",
  };
  applyUniversePreset(tickerIntelState.universePreset || "sp500");
  return tickerIntelState.universe;
}

function toFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeCompanyLabel(rawLabel, symbol = "") {
  const raw = String(rawLabel || "").trim();
  if (!raw) return "";
  const upperRaw = raw.toUpperCase();
  const upperSymbol = String(symbol || "").toUpperCase();
  if (!upperSymbol) return raw;
  if (upperRaw === upperSymbol) return "";
  if (upperRaw === `${upperSymbol}.US`) return "";
  if (upperRaw.includes(`(${upperSymbol})`)) {
    return raw.replace(new RegExp(`\\s*\\(${upperSymbol}\\)\\s*`, "i"), "").trim();
  }
  return raw;
}

function getCompanyName(symbol, quote = null) {
  const safeSymbol = String(symbol || "").toUpperCase();
  const fromQuote = normalizeCompanyLabel(
    quote?.companyName ||
      quote?.description ||
      quote?.longName ||
      quote?.name ||
      quote?.securityName ||
      quote?.label ||
      "",
    safeSymbol
  );
  if (fromQuote) return fromQuote;
  return SYMBOL_COMPANY_NAMES[safeSymbol] || safeSymbol;
}

function normalizeUnifiedQuote(input, symbolHint = "") {
  const quote = input?.quote && typeof input.quote === "object" ? input.quote : input || {};
  const symbol = String(input?.symbol || quote?.symbol || symbolHint || "")
    .trim()
    .toUpperCase();
  if (!symbol) return null;

  const open = toFiniteNumber(quote?.openPrice, quote?.open, input?.open, quote?.regularMarketOpen);
  const high = toFiniteNumber(quote?.highPrice, quote?.high, input?.high, quote?.regularMarketDayHigh);
  const low = toFiniteNumber(quote?.lowPrice, quote?.low, input?.low, quote?.regularMarketDayLow);
  const close = toFiniteNumber(
    quote?.lastPrice,
    quote?.mark,
    quote?.closePrice,
    quote?.close,
    input?.close,
    quote?.regularMarketLastPrice
  );

  const companyName = getCompanyName(symbol, input) || symbol;
  if (!Number.isFinite(close) || close <= 0) {
    return { symbol, label: companyName, companyName, unavailable: true };
  }

  const safeOpen = Number.isFinite(open) && open > 0 ? open : close;
  const safeHigh = Number.isFinite(high) ? high : Math.max(close, safeOpen);
  const safeLow = Number.isFinite(low) ? low : Math.min(close, safeOpen);

  return {
    symbol,
    label: companyName,
    companyName,
    open: safeOpen,
    high: safeHigh,
    low: safeLow,
    close,
  };
}

function parseSchwabQuotesPayload(payload, requestedSymbols) {
  const requested = [...new Set((requestedSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean))];
  const bySymbol = {};

  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.quotes)) {
      payload.quotes.forEach((entry) => {
        const normalized = normalizeUnifiedQuote(entry);
        if (normalized?.symbol) bySymbol[normalized.symbol] = normalized;
      });
    } else {
      Object.entries(payload).forEach(([symbolKey, entry]) => {
        const normalized = normalizeUnifiedQuote(entry, symbolKey);
        if (normalized?.symbol) bySymbol[normalized.symbol] = normalized;
      });
    }
  }

  return requested.map((symbol) => bySymbol[symbol] || { symbol, label: symbol, unavailable: true });
}

async function fetchTickerQuoteBatch(symbols) {
  const requested = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  if (!requested.length) return [];

  if (schwabSession.connected) {
    try {
      const schwabPayload = await schwabApi(
        `/api/schwab/quotes?symbols=${encodeURIComponent(requested.join(","))}&fields=quote`,
        { method: "GET" }
      );
      const schwabQuotes = parseSchwabQuotesPayload(schwabPayload, requested);
      const missing = schwabQuotes.filter((q) => q?.unavailable).map((q) => q.symbol);
      if (!missing.length) return schwabQuotes;

      const publicData = await schwabApi(`/api/market/quotes?symbols=${encodeURIComponent(missing.join(","))}`, {
        method: "GET",
      });
      const publicQuotes = Array.isArray(publicData.quotes) ? publicData.quotes : [];
      const publicBySymbol = Object.fromEntries(
        publicQuotes
          .map((q) => normalizeUnifiedQuote(q))
          .filter((q) => Boolean(q?.symbol))
          .map((q) => [q.symbol, q])
      );

      return schwabQuotes.map((q) => (q?.unavailable && publicBySymbol[q.symbol] ? publicBySymbol[q.symbol] : q));
    } catch {
      // Fallback to public feed when Schwab quote request fails.
    }
  }

  const publicData = await schwabApi(`/api/market/quotes?symbols=${encodeURIComponent(requested.join(","))}`, {
    method: "GET",
  });
  return Array.isArray(publicData.quotes) ? publicData.quotes : [];
}

function getPriceBucket(quote) {
  const close = Number(quote?.close || 0);
  if (!Number.isFinite(close) || close <= 0) return "unknown";
  if (close < 20) return "under20";
  if (close < 100) return "20to100";
  if (close < 500) return "100to500";
  return "500plus";
}

function getSignalKeyForQuote(quote) {
  if (!quote || quote.unavailable) return "no-data";
  const pct = getOpenDeltaPercent(quote);
  if (!Number.isFinite(pct)) return "no-data";
  if (pct >= 0.4) return "bullish";
  if (pct <= -0.4) return "bearish";
  return "neutral";
}

async function refreshTickerUniverseQuotes({ rerender = true, force = false } = {}) {
  if (tickerUniverseQuotesPromise && !force) {
    return tickerUniverseQuotesPromise;
  }

  const symbols = tickerIntelState.universe.length ? tickerIntelState.universe : DEFAULT_TICKER_WATCHLIST;
  const chunkSize = 50;
  const requestId = ++tickerUniverseRequestId;
  const chunks = [];
  for (let i = 0; i < symbols.length; i += chunkSize) chunks.push(symbols.slice(i, i + chunkSize));
  const bySymbol = force ? {} : { ...tickerIntelState.quoteBySymbol };
  let loaded = force ? 0 : Number(tickerIntelState.loadedQuotes || 0);
  const concurrency = 4;

  const run = (async () => {
    tickerIntelState = {
      ...tickerIntelState,
      loadingUniverse: true,
      loadedQuotes: force ? 0 : loaded,
      quoteBySymbol: force ? {} : bySymbol,
    };
    if (rerender && currentTab === TICKER_INTEL_TAB) renderTickerIntelView();

    let nextIndex = 0;
    async function worker() {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= chunks.length) return;
        const chunk = chunks[index];
        try {
          const quotes = await fetchTickerQuoteBatch(chunk);
          quotes.forEach((q) => {
            const normalized = normalizeUnifiedQuote(q);
            if (normalized?.symbol) bySymbol[normalized.symbol] = normalized;
          });
        } catch {
          // Keep going even if a chunk fails.
        }
        loaded = Math.min(symbols.length, loaded + chunk.length);
        if (requestId !== tickerUniverseRequestId) return;
        tickerIntelState = { ...tickerIntelState, quoteBySymbol: { ...bySymbol }, loadedQuotes: loaded };
        if (rerender && currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));

    if (requestId !== tickerUniverseRequestId) return bySymbol;

    tickerIntelState = {
      ...tickerIntelState,
      quoteBySymbol: bySymbol,
      loadedQuotes: loaded,
      loadingUniverse: false,
      quotesUpdatedAt: Date.now(),
    };
    if (rerender && currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
    return bySymbol;
  })();

  tickerUniverseQuotesPromise = run.finally(() => {
    if (tickerUniverseQuotesPromise === run) {
      tickerUniverseQuotesPromise = null;
    }
  });
  return tickerUniverseQuotesPromise;
}

async function loadPublicQuotes(symbols) {
  const unique = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  if (!unique.length) {
    openingQuotesBySymbol = {};
    return openingQuotesBySymbol;
  }

  const data = await schwabApi(`/api/market/quotes?symbols=${encodeURIComponent(unique.join(","))}`, {
    method: "GET",
  });
  const quotes = Array.isArray(data.quotes) ? data.quotes : [];
  openingQuotesBySymbol = Object.fromEntries(
    quotes.map((q) => [String(q.label || q.symbol || "").toUpperCase(), q])
  );
  return openingQuotesBySymbol;
}

function getEtNowParts() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function isUsMarketOpenNow() {
  const nowEt = getEtNowParts();
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[nowEt.weekday] ?? 0;
  if (day === 0 || day === 6) return false;
  const minutes = nowEt.hour * 60 + nowEt.minute;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  return minutes >= marketOpen && minutes < marketClose;
}

function applyMarketOpenTheme() {
  if (!appShell) return;
  appShell.classList.toggle("market-open", isUsMarketOpenNow());
}

function startMarketOpenThemeTimer() {
  applyMarketOpenTheme();
  if (marketOpenThemeTimer) clearInterval(marketOpenThemeTimer);
  marketOpenThemeTimer = setInterval(applyMarketOpenTheme, 60000);
}

function computeNextMarketOpenCountdown() {
  const nowEt = getEtNowParts();
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const nowDow = weekdayMap[nowEt.weekday] ?? 0;
  const nowSynthetic = Date.UTC(
    nowEt.year,
    nowEt.month - 1,
    nowEt.day,
    nowEt.hour,
    nowEt.minute,
    nowEt.second
  );

  let addDays = 0;
  const nowMinutes = nowEt.hour * 60 + nowEt.minute;
  const openMinutes = 9 * 60 + 30;

  if (nowDow === 0) addDays = 1;
  else if (nowDow === 6) addDays = 2;
  else if (nowMinutes >= openMinutes) addDays = nowDow === 5 ? 3 : 1;

  const targetBase = new Date(Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day + addDays, 9, 30, 0));
  const targetSynthetic = targetBase.getTime();
  const diffMs = Math.max(0, targetSynthetic - nowSynthetic);

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, diffMs };
}

function stopMarketCountdown() {
  if (marketCountdownTimer) {
    clearInterval(marketCountdownTimer);
    marketCountdownTimer = null;
  }
}

function startMarketCountdown() {
  stopMarketCountdown();
  const el = document.getElementById("marketOpenCountdown");
  if (!el) return;
  const update = () => {
    const countdown = computeNextMarketOpenCountdown();
    const pad = (n) => String(n).padStart(2, "0");
    const days = countdown.days > 0 ? `${countdown.days}d ` : "";
    el.textContent = `${days}${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
  };
  update();
  marketCountdownTimer = setInterval(update, 1000);
}

function computeNextMarketCloseCountdown() {
  const nowEt = getEtNowParts();
  const nowSynthetic = Date.UTC(
    nowEt.year,
    nowEt.month - 1,
    nowEt.day,
    nowEt.hour,
    nowEt.minute,
    nowEt.second
  );
  const closeSynthetic = Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day, 16, 0, 0);
  const diffMs = Math.max(0, closeSynthetic - nowSynthetic);
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, diffMs };
}

function formatCountdown(countdown) {
  const pad = (n) => String(Number(n || 0)).padStart(2, "0");
  const days = countdown.days > 0 ? `${countdown.days}d ` : "";
  return `${days}${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
}

function formatEtNowLabel() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return formatter.format(new Date());
}

function stopShoppingMarketClock() {
  if (shoppingMarketClockTimer) {
    clearInterval(shoppingMarketClockTimer);
    shoppingMarketClockTimer = null;
  }
}

function updateShoppingSubmitButtonState() {
  const submitBtn = document.getElementById("cartSubmitBtn");
  if (!submitBtn) return;
  const isConnected = Boolean(schwabSession.connected);
  const hasBuy = shoppingState.items.some((item) => String(item?.side || "BUY").toUpperCase() === "BUY");
  const marketOpen = isUsMarketOpenNow();
  submitBtn.disabled = !isConnected || !shoppingState.items.length || shoppingState.submitting || (hasBuy && !marketOpen);
}

function startShoppingMarketClock() {
  stopShoppingMarketClock();
  const stateEl = document.getElementById("shoppingMarketState");
  const countdownEl = document.getElementById("shoppingMarketCountdown");
  const nowEl = document.getElementById("shoppingEtNow");
  const gateEl = document.getElementById("shoppingMarketGate");
  if (!stateEl || !countdownEl || !nowEl) return;

  const update = () => {
    const marketOpen = isUsMarketOpenNow();
    const countdown = marketOpen ? computeNextMarketCloseCountdown() : computeNextMarketOpenCountdown();
    stateEl.textContent = marketOpen ? "Market Open" : "Market Closed";
    stateEl.className = `market-state-pill ${marketOpen ? "open" : "closed"}`;
    countdownEl.textContent = marketOpen
      ? `Closes in ${formatCountdown(countdown)}`
      : `Opens in ${formatCountdown(countdown)}`;
    nowEl.textContent = `ET now: ${formatEtNowLabel()}`;
    if (gateEl) {
      const hasBuy = shoppingState.items.some((item) => String(item?.side || "BUY").toUpperCase() === "BUY");
      gateEl.textContent =
        !marketOpen && hasBuy
          ? "Buy orders are disabled while the U.S. market is closed."
          : marketOpen
            ? "Buy and sell orders are enabled."
            : "Sell-only mode while market is closed.";
      gateEl.className = `market-gate-note ${marketOpen ? "open" : "closed"}`;
    }
    updateShoppingSubmitButtonState();
  };
  update();
  shoppingMarketClockTimer = setInterval(update, 1000);
}

function getShoppingWatchSymbols() {
  return uniqueSymbols([
    ...getShoppingHoldingSymbols(10),
    ...SHOPPING_10_TO_50_SYMBOLS,
    ...DEFAULT_TICKER_WATCHLIST,
    ...shoppingState.items.map((item) => String(item?.symbol || "").toUpperCase()),
  ]).slice(0, 20);
}

function getShoppingHoldings(limit = 10) {
  return (Array.isArray(schwabData.accounts) ? schwabData.accounts : [])
    .flatMap((account) => (Array.isArray(account?.securitiesAccount?.positions) ? account.securitiesAccount.positions : []))
    .map((position) => ({
      symbol: String(position?.instrument?.symbol || "").toUpperCase(),
      qty: Math.max(0, Math.floor(Number(position?.longQuantity || 0))),
      marketValue: Number(position?.marketValue || 0),
    }))
    .filter((p) => p.symbol && p.qty > 0)
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, limit);
}

function getShoppingHoldingSymbols(limit = 10) {
  return getShoppingHoldings(limit).map((item) => item.symbol);
}

async function refreshShoppingQuotes({ force = false } = {}) {
  const symbols = getShoppingWatchSymbols();
  if (!symbols.length || shoppingState.loadingQuotes) return;
  if (!force && shoppingState.quotesUpdatedAt && Date.now() - shoppingState.quotesUpdatedAt < 20000) return;
  shoppingState = { ...shoppingState, loadingQuotes: true };
  try {
    const quotes = await fetchTickerQuoteBatch(symbols);
    const quoteBySymbol = { ...(shoppingState.quoteBySymbol || {}) };
    for (const quote of quotes) {
      const normalized = normalizeUnifiedQuote(quote);
      if (!normalized?.symbol) continue;
      quoteBySymbol[normalized.symbol] = normalized;
    }
    shoppingState = {
      ...shoppingState,
      quoteBySymbol,
      quotesUpdatedAt: Date.now(),
      loadingQuotes: false,
    };
    if (currentTab === SHOPPING_TAB) renderShoppingView();
  } catch {
    shoppingState = { ...shoppingState, loadingQuotes: false };
  }
}

function renderPriceCell(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return `$${Number(value).toFixed(2)}`;
}

function getOpenDeltaPercent(quote) {
  const open = Number(quote?.open || 0);
  const close = Number(quote?.close || 0);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) return null;
  return ((close - open) / open) * 100;
}

function formatPercent(pct) {
  if (!Number.isFinite(pct)) return "-";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function getSignalFromDelta(pct) {
  if (!Number.isFinite(pct)) return { label: "No Data", className: "neutral" };
  if (pct >= 0.4) return { label: "Up", className: pct >= 2 ? "bull-strong" : "bull" };
  if (pct <= -0.4) return { label: "Down", className: pct <= -2 ? "bear-strong" : "bear" };
  return { label: "Flat", className: "neutral" };
}

function renderSignalPill(pct) {
  const signal = getSignalFromDelta(pct);
  return `<span class="signal-pill ${signal.className}">${signal.label}</span>`;
}

function toSignalBadge(signal = "neutral") {
  const clean = String(signal || "neutral").toLowerCase();
  if (clean === "bullish") return '<span class="signal-pill bull">Looks Strong</span>';
  if (clean === "bearish") return '<span class="signal-pill bear">Looks Weak</span>';
  return '<span class="signal-pill neutral">Mixed</span>';
}

function renderListItems(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '<li class="settings-desc">No items.</li>';
  return list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("");
}

function getIntradayRangePercent(quote) {
  const high = Number(quote?.high || 0);
  const low = Number(quote?.low || 0);
  const close = Number(quote?.close || 0);
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || close <= 0) return null;
  return ((high - low) / close) * 100;
}

function looksLikeBigNews(title) {
  const t = String(title || "").toLowerCase();
  return /(merger|acquisition|lawsuit|investigation|ceo|resign|layoff|guidance|downgrade|upgrade|tariff|attack|probe)/.test(
    t
  );
}

function looksLikeEarningsToday(title) {
  const t = String(title || "").toLowerCase();
  return /earnings|quarterly results|guidance/.test(t) && /today|this morning|after close|before open|q[1-4]/.test(t);
}

function getWarningChipsForTicker(symbol, quote) {
  const chips = [];
  const pct = Math.abs(Number(getOpenDeltaPercent(quote) || 0));
  const rangePct = Number(getIntradayRangePercent(quote) || 0);
  if (pct >= 2 || rangePct >= 5) chips.push({ text: "High risk", className: "warn-high-risk" });

  const report = tickerIntelState.reportCache[symbol];
  const headlines = Array.isArray(report?.newsUsed) ? report.newsUsed : [];
  if (headlines.some((h) => looksLikeEarningsToday(h?.title))) {
    chips.push({ text: "Earnings today", className: "warn-earnings" });
  }
  if (headlines.some((h) => looksLikeBigNews(h?.title))) {
    chips.push({ text: "Big news", className: "warn-big-news" });
  }
  return chips.slice(0, 3);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getDecisionScorecard(symbol, quote, report) {
  if (!quote || quote.unavailable) {
    return {
      overall: 0,
      rating: 0,
      label: "Need More Data",
      trendStrength: 0,
      riskLevel: 0,
      valuation: 0,
      newsSentiment: 0,
      catalystStrength: 0,
    };
  }

  const openDelta = Number(getOpenDeltaPercent(quote) || 0);
  const rangePct = Number(getIntradayRangePercent(quote) || 0);
  const signal = String(report?.signal || "neutral").toLowerCase();
  const confidence = String(report?.confidence || "medium").toLowerCase();
  const bullishCount = Array.isArray(report?.bullishFactors) ? report.bullishFactors.length : 0;
  const bearishCount = Array.isArray(report?.bearishFactors) ? report.bearishFactors.length : 0;
  const catalystCount = Array.isArray(report?.catalystWatch) ? report.catalystWatch.length : 0;

  const trendStrength = clampNumber(50 + openDelta * 14, 0, 100);
  const riskLevel = clampNumber(100 - Math.abs(openDelta) * 14 - Math.max(0, rangePct - 4) * 8, 0, 100);
  const valuationBase = signal === "bullish" ? 70 : signal === "bearish" ? 35 : 55;
  const valuation = clampNumber(valuationBase + (confidence === "high" ? 6 : confidence === "low" ? -4 : 0), 0, 100);
  const newsSentiment = clampNumber(
    55 + (signal === "bullish" ? 12 : signal === "bearish" ? -12 : 0) + (bullishCount - bearishCount) * 3,
    0,
    100
  );
  const catalystStrength = clampNumber(catalystCount * 16 + (confidence === "high" ? 15 : 7), 0, 100);

  const overall = Math.round(
    trendStrength * 0.24 + riskLevel * 0.2 + valuation * 0.2 + newsSentiment * 0.2 + catalystStrength * 0.16
  );
  const rating = Math.max(1, Math.min(5, Math.round(overall / 20)));
  const label =
    overall >= 75
      ? "Strong Buy Zone"
      : overall >= 60
        ? "Watch for Entry"
        : overall >= 45
          ? "Mixed / Wait"
          : "Avoid for Now";

  return {
    overall,
    rating,
    label,
    trendStrength: Math.round(trendStrength),
    riskLevel: Math.round(riskLevel),
    valuation: Math.round(valuation),
    newsSentiment: Math.round(newsSentiment),
    catalystStrength: Math.round(catalystStrength),
  };
}

function getTradeReadiness(quote, scorecard) {
  if (!quote || quote.unavailable) return null;
  const close = Number(quote?.close || 0);
  if (!Number.isFinite(close) || close <= 0) return null;

  const entryBandPct = 0.8;
  const entryLow = close * (1 - entryBandPct / 100);
  const entryHigh = close * (1 + entryBandPct / 100);
  const targetPct = clampNumber(2 + (scorecard.overall - 50) / 9, 1.5, 8);
  const stopPct = clampNumber(1.1 + (100 - scorecard.riskLevel) / 18, 1, 5);
  const target = close * (1 + targetPct / 100);
  const stop = close * (1 - stopPct / 100);
  const reward = target - close;
  const risk = close - stop;
  const rr = risk > 0 ? reward / risk : 0;

  const snapshot = getPortfolioSnapshot();
  const portfolioValue = Number(snapshot.totalLiquidationValue || 0);
  const cash = Number(snapshot.totalCash || 0);
  const riskBudgetDollar = portfolioValue > 0 ? portfolioValue * 0.01 : close * 2;
  const sharesByRisk = risk > 0 ? Math.max(1, Math.floor(riskBudgetDollar / risk)) : 1;
  const sharesByCash = cash > 0 ? Math.max(1, Math.floor(cash / close)) : sharesByRisk;
  const shares = Math.max(1, Math.min(sharesByRisk, sharesByCash));
  const positionValue = shares * close;
  const upsideDollar = shares * reward;
  const downsideDollar = shares * risk;

  return {
    entryLow,
    entryHigh,
    target,
    stop,
    rr,
    shares,
    positionValue,
    upsideDollar,
    downsideDollar,
  };
}

function getPortfolioFit(symbol, quote, scorecard) {
  const positions = getAllPositions();
  const snapshot = getPortfolioSnapshot();
  const held = positions.find((p) => String(p?.instrument?.symbol || "").toUpperCase() === symbol);
  const close = Number(quote?.close || 0);
  const requiredCash = Number.isFinite(close) && close > 0 ? close : 0;
  const cash = Number(snapshot.totalCash || 0);
  const cashReady = cash >= requiredCash && requiredCash > 0;
  const currentHoldingValue = Number(held?.marketValue || 0);
  const concentrationPct =
    snapshot.totalLiquidationValue > 0
      ? ((currentHoldingValue + (Number.isFinite(close) ? close : 0)) / snapshot.totalLiquidationValue) * 100
      : 0;

  const fitScore = Math.round(
    clampNumber(
      45 +
        (cashReady ? 22 : -15) +
        (held ? -8 : 8) +
        (scorecard.riskLevel >= 55 ? 12 : -6) +
        (concentrationPct >= 20 ? -18 : concentrationPct >= 10 ? -8 : 8),
      0,
      100
    )
  );

  return {
    fitScore,
    cashReady,
    requiredCash,
    availableCash: cash,
    alreadyHeld: Boolean(held),
    concentrationPct,
  };
}

function getTickerRankingScore(symbol, quote) {
  if (!quote || quote.unavailable) return -999;
  const report = tickerIntelState.reportCache[symbol] || null;
  const scorecard = getDecisionScorecard(symbol, quote, report);
  return scorecard.overall;
}

function uniqueSymbols(list) {
  return [...new Set((list || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
}

function getUniversePresetSymbols(preset) {
  const base = uniqueSymbols(
    tickerIntelState.allUniverse.length ? tickerIntelState.allUniverse : tickerIntelState.universe
  );
  if (!base.length) return uniqueSymbols(DEFAULT_TICKER_WATCHLIST);

  if (preset === "etf-focus") return uniqueSymbols(ETF_SYMBOLS);
  if (preset === "tech-focus") return uniqueSymbols(TECH_FOCUS_SYMBOLS.filter((s) => base.includes(s)));
  if (preset === "dividend-focus") return uniqueSymbols(DIVIDEND_FOCUS_SYMBOLS.filter((s) => base.includes(s)));
  if (preset === "my-holdings") return uniqueSymbols(getAllPositions().map((p) => p?.instrument?.symbol));
  if (preset === "big-movers") {
    const ranked = [...base].sort((a, b) => {
      const aPct = Math.abs(Number(getOpenDeltaPercent(tickerIntelState.quoteBySymbol[a]) || 0));
      const bPct = Math.abs(Number(getOpenDeltaPercent(tickerIntelState.quoteBySymbol[b]) || 0));
      return bPct - aPct;
    });
    return ranked.slice(0, 150);
  }
  if (preset === "high-volatility") {
    const ranked = [...base].sort((a, b) => {
      const aRange = Number(getIntradayRangePercent(tickerIntelState.quoteBySymbol[a]) || 0);
      const bRange = Number(getIntradayRangePercent(tickerIntelState.quoteBySymbol[b]) || 0);
      return bRange - aRange;
    });
    return ranked.slice(0, 150);
  }
  return base;
}

function applyUniversePreset(preset) {
  const normalizedPreset = String(preset || "sp500");
  const symbols = getUniversePresetSymbols(normalizedPreset);
  const nextUniverse = symbols.length ? symbols : uniqueSymbols(DEFAULT_TICKER_WATCHLIST);
  tickerIntelState = {
    ...tickerIntelState,
    universePreset: normalizedPreset,
    universe: nextUniverse,
    selected: nextUniverse.includes(tickerIntelState.selected) ? tickerIntelState.selected : nextUniverse[0],
  };
}

function getSimpleTickerStatus(scorecard) {
  if (!scorecard || !Number.isFinite(scorecard.overall) || scorecard.overall <= 0) {
    return "Need more market data to rate this ticker.";
  }
  if (scorecard.overall >= 75) return "Strong setup with favorable trend and signals.";
  if (scorecard.overall >= 60) return "Reasonable setup, but wait for a cleaner entry.";
  if (scorecard.overall >= 45) return "Mixed setup with both upside and downside pressure.";
  return "Weak setup right now; risk is elevated.";
}

function getSimpleTickerWhy(quote, scorecard) {
  const pct = Number(getOpenDeltaPercent(quote) || 0);
  const range = Number(getIntradayRangePercent(quote) || 0);
  if (!Number.isFinite(pct)) return "No reliable price move yet.";
  if (Math.abs(pct) >= 2) return "Large move today, so this is higher risk.";
  if (range >= 5) return "Wide price swings today increase uncertainty.";
  if (scorecard?.riskLevel >= 65) return "Price behavior is fairly stable so far.";
  if (pct > 0.4) return "Price is moving up with decent momentum.";
  if (pct < -0.4) return "Price is under pressure today.";
  return "Price action is mixed and still forming.";
}

function getRiskLevelTag(scorecard) {
  const risk = Number(scorecard?.riskLevel || 0);
  if (risk >= 70) return { text: "Low risk", className: "risk-low" };
  if (risk >= 45) return { text: "Medium risk", className: "risk-medium" };
  return { text: "High risk", className: "risk-high" };
}

function getConfidenceTag(report) {
  const c = String(report?.confidence || "unknown").toLowerCase();
  if (c === "high") return { text: "High confidence", className: "conf-high" };
  if (c === "medium") return { text: "Medium confidence", className: "conf-medium" };
  if (c === "low") return { text: "Low confidence", className: "conf-low" };
  return { text: "Confidence unknown", className: "conf-unknown" };
}

function getFilteredTickerUniverse() {
  const search = String(tickerIntelState.search || "")
    .trim()
    .toUpperCase();
  const signalFilter = tickerIntelState.signalFilter || "all";
  const priceFilter = tickerIntelState.priceFilter || "all";
  const symbols = tickerIntelState.universe.length ? tickerIntelState.universe : DEFAULT_TICKER_WATCHLIST;

  const filtered = symbols.filter((symbol) => {
    if (search && !symbol.includes(search)) return false;
    const quote = tickerIntelState.quoteBySymbol[symbol];
    if (priceFilter !== "all" && getPriceBucket(quote) !== priceFilter) return false;
    if (signalFilter !== "all" && getSignalKeyForQuote(quote) !== signalFilter) return false;
    return true;
  });
  const sortMode = tickerIntelState.sortMode || "best-now";
  if (sortMode === "lowest-risk") {
    return filtered.sort((a, b) => {
      const qa = tickerIntelState.quoteBySymbol[a];
      const qb = tickerIntelState.quoteBySymbol[b];
      const ra = getDecisionScorecard(a, qa, tickerIntelState.reportCache[a] || null).riskLevel;
      const rb = getDecisionScorecard(b, qb, tickerIntelState.reportCache[b] || null).riskLevel;
      return rb - ra;
    });
  }
  if (sortMode === "big-movers") {
    return filtered.sort((a, b) => {
      const aPct = Math.abs(Number(getOpenDeltaPercent(tickerIntelState.quoteBySymbol[a]) || 0));
      const bPct = Math.abs(Number(getOpenDeltaPercent(tickerIntelState.quoteBySymbol[b]) || 0));
      return bPct - aPct;
    });
  }
  return filtered.sort(
    (a, b) =>
      getTickerRankingScore(b, tickerIntelState.quoteBySymbol[b]) -
      getTickerRankingScore(a, tickerIntelState.quoteBySymbol[a])
  );
}

function getTickerFilterCounts() {
  const search = String(tickerIntelState.search || "")
    .trim()
    .toUpperCase();
  const symbols = tickerIntelState.universe.length ? tickerIntelState.universe : DEFAULT_TICKER_WATCHLIST;
  const scoped = symbols.filter((symbol) => !search || symbol.includes(search));
  const signal = { bullish: 0, bearish: 0, neutral: 0, "no-data": 0 };
  const price = { under20: 0, "20to100": 0, "100to500": 0, "500plus": 0, unknown: 0 };

  scoped.forEach((symbol) => {
    const quote = tickerIntelState.quoteBySymbol[symbol];
    const sig = getSignalKeyForQuote(quote);
    signal[sig] = (signal[sig] || 0) + 1;
    const bucket = getPriceBucket(quote);
    price[bucket] = (price[bucket] || 0) + 1;
  });

  return { total: scoped.length, signal, price };
}

function renderTickerIntelLoading() {
  tickerIntelState = { ...tickerIntelState, loading: true };
  renderTickerIntelView();
}

function renderTickerIntelView() {
  const selected = tickerIntelState.selected || DEFAULT_TICKER_WATCHLIST[0];
  const report = tickerIntelState.report;
  const filtered = getFilteredTickerUniverse();
  const counts = getTickerFilterCounts();
  const totalUniverse = tickerIntelState.universe.length || DEFAULT_TICKER_WATCHLIST.length;
  const watchlistHtml = filtered
    .map((symbol) => {
      const quote = tickerIntelState.quoteBySymbol[symbol];
      const reportForSymbol = tickerIntelState.reportCache[symbol] || null;
      const scorecardForSymbol = getDecisionScorecard(symbol, quote, reportForSymbol);
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const signal = getSignalFromDelta(pct);
      const companyName = getCompanyName(symbol, quote);
      const rowToneClass =
        signal.className === "bull-strong" || signal.className === "bull"
          ? "tone-strong"
          : signal.className === "bear-strong" || signal.className === "bear"
            ? "tone-weak"
            : "tone-mixed";
      const warningChips = getWarningChipsForTicker(symbol, quote)
        .map((chip) => `<span class="warning-chip ${chip.className}">${escapeHtml(chip.text)}</span>`)
        .join("");
      const confidenceTag = getConfidenceTag(reportForSymbol);
      const riskTag = getRiskLevelTag(scorecardForSymbol);
      const simpleStatus = getSimpleTickerStatus(scorecardForSymbol);
      const simpleWhy = getSimpleTickerWhy(quote, scorecardForSymbol);
      const trendClass = !Number.isFinite(pct)
        ? "value-flat"
        : pct > 0
          ? "value-up"
          : pct < 0
            ? "value-down"
            : "value-flat";
      return `
      <button type="button" class="ticker-item ${rowToneClass} ${symbol === selected ? "active" : ""}" data-ticker="${symbol}">
        <span class="ticker-item-top">
          <span class="ticker-item-symbol">${symbol}</span>
          <span class="ticker-score-badge">${scorecardForSymbol.overall || "--"}/100</span>
        </span>
        <span class="ticker-item-company">${escapeHtml(companyName)}</span>
        <span class="ticker-item-bottom">
          <span>${quote ? renderPriceCell(quote.close) : "-"}</span>
          <span class="${trendClass}">${formatPercent(pct)}</span>
        </span>
        <span class="ticker-item-context">${escapeHtml(simpleStatus)}</span>
        <span class="ticker-item-context muted">${escapeHtml(simpleWhy)}</span>
        <span class="ticker-meta-row">
          <span class="meta-pill ${escapeHtml(confidenceTag.className)}">${escapeHtml(confidenceTag.text)}</span>
          <span class="meta-pill ${escapeHtml(riskTag.className)}">${escapeHtml(riskTag.text)}</span>
        </span>
        ${warningChips ? `<span class="ticker-warning-row">${warningChips}</span>` : ""}
      </button>
    `;
    })
    .join("");

  const quote = report?.quote;
  const openDelta = quote ? getOpenDeltaPercent(quote) : null;
  const selectedScorecard = getDecisionScorecard(selected, quote, report);
  const selectedReadiness = getTradeReadiness(quote, selectedScorecard);
  const selectedFit = getPortfolioFit(selected, quote, selectedScorecard);
  const detailTab = tickerIntelState.detailTab || "rating";
  const quickTake =
    selectedScorecard.overall >= 75
      ? "Clear setup right now."
      : selectedScorecard.overall >= 60
        ? "Promising, but wait for cleaner entry."
        : selectedScorecard.overall >= 45
          ? "Mixed setup. Keep risk small."
          : "Higher risk. Better to wait.";
  const topIdeas = filtered
    .map((symbol) => {
      const q = tickerIntelState.quoteBySymbol[symbol];
      const r = tickerIntelState.reportCache[symbol] || null;
      const score = getDecisionScorecard(symbol, q, r);
      return { symbol, score: score.overall, label: score.label };
    })
    .filter((row) => row.score > 0)
    .slice(0, 5);
  const quoteSummary = quote
    ? `
      <section class="ticker-quote-grid">
        <article class="schwab-metric-card"><h4>Current Price</h4><div class="schwab-metric-value small">${renderPriceCell(
          quote.close
        )}</div></article>
        <article class="schwab-metric-card"><h4>Today Change</h4><div class="schwab-metric-value small ${
          openDelta > 0 ? "value-up" : openDelta < 0 ? "value-down" : "value-flat"
        }">${formatPercent(openDelta)}</div></article>
        <article class="schwab-metric-card"><h4>Today Range</h4><div class="schwab-metric-value small">${renderPriceCell(
          quote.low
        )} - ${renderPriceCell(quote.high)}</div></article>
      </section>
    `
    : "";

  const newsHtml = Array.isArray(report?.newsUsed)
    ? report.newsUsed
        .slice(0, 8)
        .map(
          (item) => `
            <li>
              <a href="${escapeHtml(item.link || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                item.title || "Untitled headline"
              )}</a>
              <span>${escapeHtml(item.source || "News")} ${item.pubDate ? `• ${escapeHtml(item.pubDate)}` : ""}</span>
            </li>
          `
        )
        .join("")
    : "";
  const debate = report?.debate || {};
  const bullDebate = debate.bullAnalyst || {};
  const bearDebate = debate.bearAnalyst || {};
  const refereeDebate = debate.referee || {};
  const debateHtml =
    bullDebate.thesis || bearDebate.thesis || refereeDebate.summary
      ? `
      <section class="schwab-card">
        <h4>Two-Sided AI View</h4>
        <p class="schwab-card-sub">One AI explains the upside, one explains the downside, and a final AI gives the balanced call.</p>
        <section class="ticker-report-grid">
          <article class="schwab-card">
            <h4>Upside View</h4>
            <p class="schwab-card-sub">${escapeHtml(bullDebate.thesis || "No bullish thesis generated.")}</p>
            <ul class="ticker-bullets">${renderListItems(bullDebate.points)}</ul>
          </article>
          <article class="schwab-card">
            <h4>Downside View</h4>
            <p class="schwab-card-sub">${escapeHtml(bearDebate.thesis || "No bearish thesis generated.")}</p>
            <ul class="ticker-bullets">${renderListItems(bearDebate.points)}</ul>
          </article>
          <article class="schwab-card">
            <h4>Balanced Summary</h4>
            <p class="schwab-card-sub">${escapeHtml(
              refereeDebate.summary || "No referee summary available."
            )}</p>
            <ul class="ticker-bullets">
              <li>Overall call: ${escapeHtml(String(refereeDebate.verdict || report.signal || "neutral"))}</li>
              <li>Suggested stance: ${escapeHtml(String(refereeDebate.actionBias || "balanced"))}</li>
              <li>How sure AI is: ${escapeHtml(String(refereeDebate.confidence || report.confidence || "medium"))}</li>
            </ul>
          </article>
        </section>
      </section>
    `
      : "";

  const reportHtml = tickerIntelState.error
    ? `<div class="do-error"><strong>Error</strong><p>${escapeHtml(tickerIntelState.error)}</p></div>`
    : tickerIntelState.loading
      ? `<div class="do-loading">Building deep-dive report for ${selected}...</div>`
      : !report
      ? '<div class="do-loading">Choose a ticker to load a report.</div>'
      : `
      <header class="ticker-report-header">
        <div>
          <h3>${escapeHtml(report.symbol || selected)} Deep-Dive</h3>
          <p>${escapeHtml(report.overview || "No overview available.")}</p>
        </div>
        <div class="ticker-report-signal">
          ${toSignalBadge(report.signal)}
          <span class="settings-desc">How sure we are: ${escapeHtml(report.confidence || "medium")}</span>
        </div>
      </header>
      ${quoteSummary}
      <section class="quick-take-bar">
        <strong>Quick Take:</strong> ${escapeHtml(quickTake)}
      </section>
      <section class="detail-tab-row">
        <button type="button" class="detail-tab-btn ${detailTab === "rating" ? "active" : ""}" data-detail-tab="rating">Rating</button>
        <button type="button" class="detail-tab-btn ${detailTab === "plan" ? "active" : ""}" data-detail-tab="plan">Plan</button>
        <button type="button" class="detail-tab-btn ${detailTab === "fit" ? "active" : ""}" data-detail-tab="fit">Account Fit</button>
      </section>
      <section class="ticker-report-grid ${detailTab === "rating" ? "" : "hidden-section"}">
        <article class="schwab-card decision-overall">
          <h4>Investability Score</h4>
          <div class="decision-score-main">${selectedScorecard.overall}<span>/100</span></div>
          <div class="decision-rating">${"★".repeat(selectedScorecard.rating)}${"☆".repeat(5 - selectedScorecard.rating)}</div>
          <p class="schwab-card-sub">${selectedScorecard.label}</p>
        </article>
        <article class="schwab-card">
          <h4>Decision Scorecard</h4>
          <div class="decision-subscore-grid">
            <div><span>Trend strength</span><strong>${selectedScorecard.trendStrength}</strong></div>
            <div><span>Risk control</span><strong>${selectedScorecard.riskLevel}</strong></div>
            <div><span>Value setup</span><strong>${selectedScorecard.valuation}</strong></div>
            <div><span>News tone</span><strong>${selectedScorecard.newsSentiment}</strong></div>
            <div><span>Catalyst power</span><strong>${selectedScorecard.catalystStrength}</strong></div>
          </div>
        </article>
      </section>
      <section class="ticker-report-grid ${detailTab === "plan" ? "" : "hidden-section"}">
        <article class="schwab-card">
          <h4>Trade Readiness</h4>
          ${
            selectedReadiness
              ? `
          <div class="decision-subscore-grid">
            <div><span>Entry zone</span><strong>${renderPriceCell(selectedReadiness.entryLow)} - ${renderPriceCell(selectedReadiness.entryHigh)}</strong></div>
            <div><span>Upside target</span><strong>${renderPriceCell(selectedReadiness.target)}</strong></div>
            <div><span>Risk line (stop)</span><strong>${renderPriceCell(selectedReadiness.stop)}</strong></div>
            <div><span>Risk / reward</span><strong>${selectedReadiness.rr.toFixed(2)}:1</strong></div>
            <div><span>Suggested shares</span><strong>${selectedReadiness.shares.toLocaleString()}</strong></div>
            <div><span>Position size</span><strong>${formatMoney(selectedReadiness.positionValue)}</strong></div>
            <div><span>If target hits</span><strong class="value-up">+${formatMoney(selectedReadiness.upsideDollar)}</strong></div>
            <div><span>If stop hits</span><strong class="value-down">-${formatMoney(selectedReadiness.downsideDollar)}</strong></div>
          </div>
          `
              : '<p class="schwab-card-sub">Not enough price data yet to compute trade numbers.</p>'
          }
        </article>
      </section>
      <section class="ticker-report-grid ${detailTab === "fit" ? "" : "hidden-section"}">
        <article class="schwab-card">
          <h4>Portfolio Fit</h4>
          <div class="decision-subscore-grid">
            <div><span>Fit score</span><strong>${selectedFit.fitScore}/100</strong></div>
            <div><span>Cash needed (1 share)</span><strong>${formatMoney(selectedFit.requiredCash)}</strong></div>
            <div><span>Available cash</span><strong>${formatMoney(selectedFit.availableCash)}</strong></div>
            <div><span>Cash ready</span><strong>${selectedFit.cashReady ? "Yes" : "No"}</strong></div>
            <div><span>Already in portfolio</span><strong>${selectedFit.alreadyHeld ? "Yes" : "No"}</strong></div>
            <div><span>Concentration impact</span><strong>${Number(selectedFit.concentrationPct || 0).toFixed(1)}%</strong></div>
          </div>
          <p class="schwab-card-sub">This helps prioritize ideas that match your current account, not just market hype.</p>
        </article>
      </section>
      <section class="schwab-card ${detailTab === "plan" ? "" : "hidden-section"}">
        <h4>Top 5 Easiest Choices Right Now</h4>
        <div class="ticker-priority-list">
          ${
            topIdeas.length
              ? topIdeas
                  .map(
                    (idea, idx) =>
                      `<button type="button" class="ticker-priority-item" data-ticker="${escapeHtml(idea.symbol)}"><span>#${
                        idx + 1
                      } ${escapeHtml(idea.symbol)}</span><span>${idea.score}/100 • ${escapeHtml(idea.label)}</span></button>`
                  )
                  .join("")
              : '<div class="settings-desc">No ranked ideas yet. Refresh prices to populate scores.</div>'
          }
        </div>
      </section>
      ${debateHtml}
      <section class="ticker-report-grid">
        <article class="schwab-card"><h4>Why It Could Go Up</h4><ul class="ticker-bullets">${renderListItems(
          report.bullishFactors
        )}</ul></article>
        <article class="schwab-card"><h4>Why It Could Go Down</h4><ul class="ticker-bullets">${renderListItems(
          report.bearishFactors
        )}</ul></article>
        <article class="schwab-card"><h4>What To Watch</h4><ul class="ticker-bullets">${renderListItems(
          report.neutralFactors
        )}</ul></article>
        <article class="schwab-card"><h4>Upcoming Events</h4><ul class="ticker-bullets">${renderListItems(
          report.catalystWatch
        )}</ul></article>
      </section>
      <section class="schwab-card">
        <h4>Risk Warnings</h4>
        <ul class="ticker-bullets">${renderListItems(report.riskFlags)}</ul>
        <p class="schwab-card-sub">${escapeHtml(report.narrativeSummary || "")}</p>
      </section>
      <section class="schwab-card">
        <h4>Recent News Used By AI</h4>
        <ul class="ticker-news-list">${newsHtml || '<li class="settings-desc">No recent headlines available.</li>'}</ul>
      </section>
    `;

  workspaceTableWrap.innerHTML = `
    <section class="ticker-intel-layout">
      <aside class="ticker-intel-list">
        <h4>Market Coverage</h4>
        <p class="settings-desc">Showing ${filtered.length}/${totalUniverse} symbols • quotes loaded ${
          tickerIntelState.loadedQuotes
        }/${totalUniverse}${tickerIntelState.loadingUniverse ? " (updating...)" : ""}</p>
        <div class="coverage-legend">
          <span class="legend-chip good">Good setup</span>
          <span class="legend-chip caution">Use caution</span>
          <span class="legend-chip risk">Higher risk</span>
        </div>
        <div class="ticker-filters">
          <select id="tickerUniversePreset" class="trade-input">
            <option value="sp500" ${tickerIntelState.universePreset === "sp500" ? "selected" : ""}>S&P 500 Universe</option>
            <option value="etf-focus" ${tickerIntelState.universePreset === "etf-focus" ? "selected" : ""}>ETF Focus</option>
            <option value="tech-focus" ${tickerIntelState.universePreset === "tech-focus" ? "selected" : ""}>Tech Focus</option>
            <option value="dividend-focus" ${tickerIntelState.universePreset === "dividend-focus" ? "selected" : ""}>Dividend Focus</option>
            <option value="big-movers" ${tickerIntelState.universePreset === "big-movers" ? "selected" : ""}>Big Movers Focus</option>
            <option value="high-volatility" ${tickerIntelState.universePreset === "high-volatility" ? "selected" : ""}>High Volatility Focus</option>
            <option value="my-holdings" ${tickerIntelState.universePreset === "my-holdings" ? "selected" : ""}>My Holdings</option>
          </select>
          <input id="tickerSearchInput" class="trade-input" placeholder="Search symbol (e.g. AAPL)" value="${escapeHtml(
            tickerIntelState.search || ""
          )}" />
          <select id="tickerSignalFilter" class="trade-input">
            <option value="all" ${tickerIntelState.signalFilter === "all" ? "selected" : ""}>All Ratings (${counts.total})</option>
            <option value="bullish" ${tickerIntelState.signalFilter === "bullish" ? "selected" : ""}>Looks Strong (${counts.signal.bullish})</option>
            <option value="bearish" ${tickerIntelState.signalFilter === "bearish" ? "selected" : ""}>Looks Weak (${counts.signal.bearish})</option>
            <option value="neutral" ${tickerIntelState.signalFilter === "neutral" ? "selected" : ""}>Mixed (${counts.signal.neutral})</option>
            <option value="no-data" ${tickerIntelState.signalFilter === "no-data" ? "selected" : ""}>Need More Data (${counts.signal["no-data"]})</option>
          </select>
          <select id="tickerPriceFilter" class="trade-input">
            <option value="all" ${tickerIntelState.priceFilter === "all" ? "selected" : ""}>All Prices (${counts.total})</option>
            <option value="under20" ${tickerIntelState.priceFilter === "under20" ? "selected" : ""}>Under $20 (${counts.price.under20})</option>
            <option value="20to100" ${tickerIntelState.priceFilter === "20to100" ? "selected" : ""}>$20 - $100 (${counts.price["20to100"]})</option>
            <option value="100to500" ${tickerIntelState.priceFilter === "100to500" ? "selected" : ""}>$100 - $500 (${counts.price["100to500"]})</option>
            <option value="500plus" ${tickerIntelState.priceFilter === "500plus" ? "selected" : ""}>$500+ (${counts.price["500plus"]})</option>
            <option value="unknown" ${tickerIntelState.priceFilter === "unknown" ? "selected" : ""}>No Price (${counts.price.unknown})</option>
          </select>
          <div class="sort-mode-row">
            <button type="button" class="sort-mode-btn ${tickerIntelState.sortMode === "best-now" ? "active" : ""}" data-sort-mode="best-now">Best Now</button>
            <button type="button" class="sort-mode-btn ${tickerIntelState.sortMode === "lowest-risk" ? "active" : ""}" data-sort-mode="lowest-risk">Lowest Risk</button>
            <button type="button" class="sort-mode-btn ${tickerIntelState.sortMode === "big-movers" ? "active" : ""}" data-sort-mode="big-movers">Big Movers</button>
          </div>
          <button type="button" class="schwab-btn schwab-btn-ghost" id="refreshTickerUniverseBtn">Refresh Prices</button>
        </div>
        <div class="ticker-items">${watchlistHtml || '<div class="settings-desc">No symbols match the current filters.</div>'}</div>
      </aside>
      <article class="ticker-intel-report">
        ${reportHtml}
      </article>
    </section>
  `;
  wireTickerIntelEvents();
}

function wireTickerIntelEvents() {
  const universePreset = document.getElementById("tickerUniversePreset");
  if (universePreset) {
    universePreset.addEventListener("change", (e) => {
      applyUniversePreset(e.target.value || "sp500");
      tickerIntelState = { ...tickerIntelState, loadingUniverse: true };
      renderTickerIntelView();
      refreshTickerUniverseQuotes({ rerender: true, force: true }).catch(() => {
        if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
      });
    });
  }
  const searchInput = document.getElementById("tickerSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      tickerIntelState = { ...tickerIntelState, search: e.target.value || "" };
      renderTickerIntelView();
    });
  }
  const signalSelect = document.getElementById("tickerSignalFilter");
  if (signalSelect) {
    signalSelect.addEventListener("change", (e) => {
      tickerIntelState = { ...tickerIntelState, signalFilter: e.target.value || "all" };
      renderTickerIntelView();
    });
  }
  const priceSelect = document.getElementById("tickerPriceFilter");
  if (priceSelect) {
    priceSelect.addEventListener("change", (e) => {
      tickerIntelState = { ...tickerIntelState, priceFilter: e.target.value || "all" };
      renderTickerIntelView();
    });
  }
  const refreshBtn = document.getElementById("refreshTickerUniverseBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadTickerUniverse(500)
        .catch(() => tickerIntelState.universe)
        .then(() => refreshTickerUniverseQuotes({ rerender: true, force: true }))
        .catch(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    });
  }
  workspaceTableWrap.querySelectorAll("[data-sort-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tickerIntelState = { ...tickerIntelState, sortMode: btn.dataset.sortMode || "best-now" };
      renderTickerIntelView();
    });
  });
  workspaceTableWrap.querySelectorAll("[data-detail-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tickerIntelState = { ...tickerIntelState, detailTab: btn.dataset.detailTab || "rating" };
      renderTickerIntelView();
    });
  });
  workspaceTableWrap.querySelectorAll(".ticker-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = btn.dataset.ticker;
      if (!symbol) return;
      tickerIntelState = { ...tickerIntelState, selected: symbol, loading: true, error: "" };
      renderTickerIntelLoading();
      loadTickerIntelReport(symbol)
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        })
        .catch((error) => {
          tickerIntelState = {
            ...tickerIntelState,
            loading: false,
            report: null,
            error: error.message || "Failed to load ticker report.",
          };
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    });
  });
  workspaceTableWrap.querySelectorAll(".ticker-priority-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = btn.dataset.ticker;
      if (!symbol) return;
      tickerIntelState = { ...tickerIntelState, selected: symbol, loading: true, error: "" };
      renderTickerIntelLoading();
      loadTickerIntelReport(symbol)
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        })
        .catch((error) => {
          tickerIntelState = {
            ...tickerIntelState,
            loading: false,
            report: null,
            error: error.message || "Failed to load ticker report.",
          };
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    });
  });
}

function getLinkedAccounts() {
  if (Array.isArray(schwabData.accounts)) return schwabData.accounts;
  if (Array.isArray(schwabData.accounts?.accounts)) return schwabData.accounts.accounts;
  return [];
}

function getAllPositions() {
  const positions = [];
  getLinkedAccounts().forEach((account) => {
    const list = account?.securitiesAccount?.positions;
    if (Array.isArray(list)) {
      list.forEach((position) => positions.push(position));
    }
  });
  return positions;
}

function getPortfolioSnapshot() {
  const accounts = getLinkedAccounts();
  const positions = getAllPositions();

  const totalLiquidationValue = accounts.reduce((sum, account) => {
    const value = Number(account?.securitiesAccount?.currentBalances?.liquidationValue || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const totalCash = accounts.reduce((sum, account) => {
    const value = Number(account?.securitiesAccount?.currentBalances?.cashBalance || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const mapped = positions
    .map((position) => ({
      symbol: position?.instrument?.symbol || "N/A",
      marketValue: Number(position?.marketValue || 0),
      longQuantity: Number(position?.longQuantity || 0),
      shortQuantity: Number(position?.shortQuantity || 0),
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const top3 = mapped.slice(0, 3);
  const topWeight =
    totalLiquidationValue > 0 && top3[0]
      ? Math.round((top3[0].marketValue / totalLiquidationValue) * 100)
      : 0;

  return {
    accountCount: accounts.length,
    positionCount: positions.length,
    totalLiquidationValue,
    totalCash,
    top3,
    topWeight,
  };
}

function getOpenOrdersSummary() {
  const orders = Array.isArray(schwabData.openOrders?.orders) ? schwabData.openOrders.orders : [];
  const stale = orders.filter((order) => {
    const entered = Date.parse(order?.enteredTime || "");
    if (!Number.isFinite(entered)) return false;
    return Date.now() - entered > 2 * 24 * 60 * 60 * 1000;
  });
  return { total: orders.length, stale: stale.length, recent: orders.slice(0, 5) };
}

function formatDollars(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatMoney(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  }).format(n);
}

function pickFirstFiniteNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function getAccountPendingDepositSignal(account) {
  const sa = account?.securitiesAccount || {};
  const current = sa.currentBalances || {};
  const projected = sa.projectedBalances || {};

  const explicitPending = pickFirstFiniteNumber(current, [
    "pendingDeposits",
    "pendingDeposit",
    "cashReceipts",
    "pendingCash",
    "pendingCredits",
  ]);

  const currentTradingCash = pickFirstFiniteNumber(current, [
    "cashAvailableForTrading",
    "availableFunds",
    "availableFundsNonMarginableTrade",
    "cashBalance",
  ]);
  const projectedTradingCash = pickFirstFiniteNumber(projected, [
    "cashAvailableForTrading",
    "availableFunds",
    "availableFundsNonMarginableTrade",
    "cashBalance",
  ]);

  const projectionDelta =
    Number.isFinite(projectedTradingCash) && Number.isFinite(currentTradingCash)
      ? projectedTradingCash - currentTradingCash
      : null;

  const candidates = [explicitPending, projectionDelta].filter((value) => Number.isFinite(value));
  const pendingEstimate = candidates.length ? Math.max(...candidates, 0) : 0;

  let source = "No pending deposit signal";
  if (Number.isFinite(explicitPending) && explicitPending > 0) {
    source = "From Schwab pending cash balance field";
  } else if (Number.isFinite(projectionDelta) && projectionDelta > 0) {
    source = "From Schwab projected vs current cash delta";
  }

  return {
    pendingEstimate,
    source,
    currentTradingCash,
    projectedTradingCash,
  };
}

function renderPortfolioView() {
  if (!schwabSession.connected) {
    workspaceTableWrap.innerHTML = `
      <div class="do-error">
        <strong>Schwab Login Required</strong>
        <p>Connect your Schwab account to view your portfolio, balances, and positions.</p>
      </div>
    `;
    return;
  }

  const accounts = getLinkedAccounts();
  const positions = getAllPositions();
  const totalBuyingPower = accounts.reduce((sum, account) => {
    const value = Number(account?.securitiesAccount?.currentBalances?.buyingPower || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const fundingRequired = totalBuyingPower <= 0;

  const accountCards = accounts
    .map((account) => {
      const sa = account?.securitiesAccount || {};
      const balances = sa.currentBalances || {};
      const hash = sa.accountNumber || sa.hashValue || "-";
      return `
        <article class="schwab-card">
          <h4>Account ${escapeHtml(String(hash))}</h4>
          <ul class="schwab-list">
            <li>Liquidation Value: ${formatMoney(balances.liquidationValue || 0)}</li>
            <li>Cash Balance: ${formatMoney(balances.cashBalance || 0)}</li>
            <li>Buying Power: ${formatMoney(balances.buyingPower || 0)}</li>
            <li>Long Market Value: ${formatMoney(balances.longMarketValue || 0)}</li>
          </ul>
        </article>
      `;
    })
    .join("");

  const rows = positions
    .map((position) => {
      const symbol = position?.instrument?.symbol || "-";
      const qty = Number(position?.longQuantity || 0) - Number(position?.shortQuantity || 0);
      const marketValue = Number(position?.marketValue || 0);
      const avgPrice = Number(position?.averagePrice || 0);
      return `
        <tr>
          <td class="ticker-cell">${escapeHtml(String(symbol))}</td>
          <td>${Number.isFinite(qty) ? qty.toLocaleString() : "-"}</td>
          <td>${formatMoney(avgPrice)}</td>
          <td>${formatMoney(marketValue)}</td>
        </tr>
      `;
    })
    .join("");
  const hasPositions = positions.length > 0;

  workspaceTableWrap.innerHTML = `
    <div class="agent-view">
      <section class="agent-hero">
        <h3>My Holdings</h3>
        <p>Auto-loaded from your connected Schwab profile. Review account balances and open equity positions in one place.</p>
      </section>
      <section class="schwab-metrics">
        <article class="schwab-metric-card">
          <h4>Linked Accounts</h4>
          <div class="schwab-metric-value">${accounts.length}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Total Positions</h4>
          <div class="schwab-metric-value">${positions.length}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Total Market Value</h4>
          <div class="schwab-metric-value small">${formatMoney(
            positions.reduce((sum, p) => sum + Number(p?.marketValue || 0), 0)
          )}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Available Buying Power</h4>
          <div class="schwab-metric-value small">${formatMoney(totalBuyingPower)}</div>
        </article>
      </section>
      ${
        fundingRequired
          ? `
      <section class="schwab-card funding-required-card">
        <h4>Funding Required Before Trading</h4>
        <p class="schwab-card-sub">
          Your available buying power is ${formatMoney(
            totalBuyingPower
          )}. Add funds in Schwab, then refresh this page to place a live order.
        </p>
        <div class="schwab-actions">
          <a class="schwab-btn schwab-btn-primary" href="${SCHWAB_FUNDING_URL}" target="_blank" rel="noopener noreferrer">Add Funds in Schwab</a>
        </div>
      </section>
      `
          : ""
      }
      <section class="schwab-grid">
        ${
          accountCards ||
          `<article class="schwab-card"><h4>No accounts returned</h4><p class="schwab-card-sub">${
            escapeHtml(schwabData.accountError || "Your connected session has no account records yet. Try Refresh.")
          }</p></article>`
        }
      </section>
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Quantity</th>
              <th>Avg Price</th>
              <th>Market Value</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4">No positions returned.</td></tr>'}</tbody>
        </table>
      </section>
      ${
        hasPositions
          ? ""
          : `
      <section class="schwab-grid portfolio-empty-grid">
        <article class="schwab-card">
          <h4>Start Investing</h4>
          <p class="schwab-card-sub">
            Your account is connected, but there are no open equity positions yet. Place your first buy order below.
          </p>
          <div class="schwab-actions">
            <button type="button" class="schwab-btn schwab-btn-ghost" data-quick-symbol="SPY">Use SPY</button>
            <button type="button" class="schwab-btn schwab-btn-ghost" data-quick-symbol="QQQ">Use QQQ</button>
            <button type="button" class="schwab-btn schwab-btn-ghost" data-quick-symbol="AAPL">Use AAPL</button>
          </div>
        </article>
        <article class="schwab-card">
          <h4>Quick Buy Ticket</h4>
          <p class="schwab-card-sub">Submit a market order directly from My Portfolio.</p>
          <form class="trade-form" id="portfolioTradeTicketForm">
            <label class="trade-label">Side</label>
            <select class="trade-input" data-trade-side>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>

            <label class="trade-label">Symbol</label>
            <input class="trade-input" data-trade-symbol placeholder="AAPL" autocomplete="off" />

            <label class="trade-label">Quantity</label>
            <input class="trade-input" data-trade-qty type="number" min="1" step="1" value="1" />

            <button type="submit" class="schwab-btn schwab-btn-primary">Submit Order</button>
          </form>
          <div class="trade-status" id="portfolioTradeTicketStatus"></div>
          <div class="trade-funding-hint" id="portfolioTradeFundingHint" hidden>
            Need to fund first? Add cash at Schwab, then return and retry.
            <a href="${SCHWAB_FUNDING_URL}" target="_blank" rel="noopener noreferrer">Funding steps</a>
          </div>
        </article>
      </section>
      `
      }
    </div>
  `;

  if (!hasPositions) {
    wireTradeTicketForm({
      formId: "portfolioTradeTicketForm",
      statusId: "portfolioTradeTicketStatus",
      fundingHintId: "portfolioTradeFundingHint",
      onSuccess: () => renderPortfolioView(),
    });
    const symbolInput = workspaceTableWrap.querySelector("[data-trade-symbol]");
    const quickBtns = workspaceTableWrap.querySelectorAll("[data-quick-symbol]");
    quickBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!symbolInput) return;
        symbolInput.value = String(btn.getAttribute("data-quick-symbol") || "").toUpperCase();
        symbolInput.focus();
      });
    });
  }
}

function buildMissionZoneContext(agentId) {
  const portfolio = getPortfolioSnapshot();
  const orders = getOpenOrdersSummary();

  if (agentId === "portfolio-copilot") {
    return `Portfolio snapshot: accounts=${portfolio.accountCount}, positions=${portfolio.positionCount}, liquidationValue=${formatDollars(
      portfolio.totalLiquidationValue
    )}, cash=${formatDollars(portfolio.totalCash)}, largestWeight=${portfolio.topWeight}%. Top holdings: ${portfolio.top3
      .map((p) => `${p.symbol} ${formatDollars(p.marketValue)}`)
      .join(", ") || "none"}.`;
  }
  if (agentId === "risk-radar") {
    return `Risk snapshot: positions=${portfolio.positionCount}, largest single-position weight=${portfolio.topWeight}%, openOrders=${orders.total}, staleOrders=${orders.stale}, cashBuffer=${formatDollars(
      portfolio.totalCash
    )}.`;
  }
  if (agentId === "order-flow-execution") {
    return `Execution snapshot: openOrders=${orders.total}, staleOrders=${orders.stale}, recentOrders=${orders.recent
      .map((o) => `${o.status || "UNKNOWN"} ${o.orderType || ""}`.trim())
      .join(" | ") || "none"}.`;
  }
  return "Mission zone context unavailable.";
}

function startSchwabLogin() {
  window.location.href = "/api/schwab/login";
}

async function logoutSchwab() {
  await schwabApi("/api/schwab/logout", { method: "POST" });
  chatHistory = [];
  schwabSession = { connected: false };
  schwabData = { accounts: null, openOrders: null, accountError: "" };
  updateSchwabChatBadge();
  openTabs.add(SCHWAB_CONNECT_TAB);
  activateTab(SCHWAB_CONNECT_TAB);
}

function buildEquityOrder({ side, symbol, quantity, orderType = "MARKET", duration = "DAY", limitPrice, stopPrice }) {
  const cleanType = String(orderType || "MARKET").toUpperCase();
  const order = {
    session: "NORMAL",
    duration: String(duration || "DAY").toUpperCase() === "GTC" ? "GOOD_TILL_CANCEL" : "DAY",
    orderType: cleanType,
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: String(side || "BUY").toUpperCase(),
        quantity,
        instrument: {
          symbol,
          assetType: "EQUITY",
        },
      },
    ],
  };
  if (cleanType === "LIMIT" || cleanType === "STOP_LIMIT") {
    order.price = Number(limitPrice);
  }
  if (cleanType === "STOP" || cleanType === "STOP_LIMIT") {
    order.stopPrice = Number(stopPrice);
  }
  return order;
}

function buildEquityMarketOrder({ side, symbol, quantity }) {
  return buildEquityOrder({ side, symbol, quantity, orderType: "MARKET", duration: "DAY" });
}

function createShoppingCartItem(symbol = "") {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol: String(symbol || "").toUpperCase(),
    side: "BUY",
    quantity: 1,
    orderType: "MARKET",
    duration: "DAY",
    limitPrice: "",
    stopPrice: "",
    autoMode: false,
  };
}

function validateShoppingItem(item) {
  const symbol = String(item?.symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol) return "Ticker is required.";
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return "Use a valid ticker symbol (example: AAPL, SPY, BRK.B).";
  const quantity = Number(item?.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return "Quantity must be greater than zero.";
  const type = String(item?.orderType || "MARKET").toUpperCase();
  if (type === "LIMIT" || type === "STOP_LIMIT") {
    const p = Number(item?.limitPrice || 0);
    if (!Number.isFinite(p) || p <= 0) return "Limit price must be greater than zero.";
  }
  if (type === "STOP" || type === "STOP_LIMIT") {
    const s = Number(item?.stopPrice || 0);
    if (!Number.isFinite(s) || s <= 0) return "Stop price must be greater than zero.";
  }
  return "";
}

async function getAutoOrderOverrides(item) {
  if (!item?.autoMode) return {};
  const symbol = String(item.symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol) return {};
  try {
    const report = await loadTickerIntelReport(symbol);
    const signal = String(report?.signal || "neutral").toLowerCase();
    const side = signal === "bearish" ? "SELL" : "BUY";
    return {
      side,
      orderType: "MARKET",
    };
  } catch {
    return {};
  }
}

async function submitShoppingCartOrders() {
  if (!schwabSession.connected) throw new Error("Connect Schwab first.");
  if (!shoppingState.items.length) throw new Error("Your cart is empty.");

  shoppingState = { ...shoppingState, submitting: true, status: "Submitting orders..." };
  renderShoppingView();

  const results = [];
  for (const item of shoppingState.items) {
    const validationError = validateShoppingItem(item);
    if (validationError) {
      results.push({ symbol: item.symbol || "-", ok: false, message: validationError });
      continue;
    }
    try {
      const auto = await getAutoOrderOverrides(item);
      const finalSide = String(auto.side || item.side || "BUY").toUpperCase();
      const finalType = String(auto.orderType || item.orderType || "MARKET").toUpperCase();
      if (finalSide === "BUY" && !isUsMarketOpenNow()) {
        results.push({
          symbol: item.symbol || "-",
          ok: false,
          message: "Buy blocked: U.S. market is closed.",
        });
        continue;
      }
      const order = buildEquityOrder({
        side: finalSide,
        symbol: String(item.symbol || "").toUpperCase(),
        quantity: Number(item.quantity || 0),
        orderType: finalType,
        duration: item.duration || "DAY",
        limitPrice: item.limitPrice,
        stopPrice: item.stopPrice,
      });
      await schwabApi("/api/schwab/orders", {
        method: "POST",
        body: JSON.stringify({ order }),
      });
      results.push({
        symbol: item.symbol || "-",
        ok: true,
        message: `${finalSide} ${item.quantity} ${item.symbol} submitted`,
      });
    } catch (error) {
      results.push({ symbol: item.symbol || "-", ok: false, message: error.message || "Order failed" });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.length - successCount;
  const firstFailure = results.find((r) => !r.ok)?.message || "";
  shoppingState = {
    ...shoppingState,
    submitting: false,
    status: `Submitted ${successCount} order(s), ${failCount} failed.${firstFailure ? ` ${firstFailure}` : ""}`,
  };
  appendChatMessage("assistant", shoppingState.status, failCount ? "msg-muted" : "msg-success");
  if (successCount > 0) await loadSchwabContextData().catch(() => ({}));
  renderShoppingView();
}

function isFundingRelatedOrderError(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("insufficient") ||
    normalized.includes("buying power") ||
    normalized.includes("insufficient funds") ||
    normalized.includes("not enough") ||
    normalized.includes("cash")
  );
}

function wireTradeTicketForm({ formId, statusId, fundingHintId, onSuccess }) {
  const tradeForm = document.getElementById(formId);
  const tradeStatus = document.getElementById(statusId);
  const fundingHint = fundingHintId ? document.getElementById(fundingHintId) : null;
  if (!tradeForm || !tradeStatus) return;

  tradeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!schwabSession.connected) return;
    if (fundingHint) fundingHint.hidden = true;

    const side = String(tradeForm.querySelector("[data-trade-side]")?.value || "BUY").toUpperCase();
    const symbol = String(tradeForm.querySelector("[data-trade-symbol]")?.value || "")
      .trim()
      .toUpperCase();
    const quantity = Number(tradeForm.querySelector("[data-trade-qty]")?.value || 0);

    if (!symbol) {
      tradeStatus.textContent = "Enter a valid symbol.";
      tradeStatus.className = "trade-status error";
      return;
    }
    if (symbol === "APPL") {
      tradeStatus.textContent = "Symbol APPL not found. Did you mean AAPL?";
      tradeStatus.className = "trade-status error";
      return;
    }
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
      tradeStatus.textContent = "Use a valid ticker symbol (example: AAPL, SPY, BRK.B).";
      tradeStatus.className = "trade-status error";
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      tradeStatus.textContent = "Quantity must be greater than zero.";
      tradeStatus.className = "trade-status error";
      return;
    }

    const order = buildEquityMarketOrder({ side, symbol, quantity });
    tradeStatus.textContent = "Submitting order...";
    tradeStatus.className = "trade-status pending";

    try {
      const result = await schwabApi("/api/schwab/orders", {
        method: "POST",
        body: JSON.stringify({ order }),
      });
      if (result?.dryRun) {
        tradeStatus.textContent = result.message || "Dry run: order validated but not sent.";
        tradeStatus.className = "trade-status pending";
        appendChatMessage("assistant", tradeStatus.textContent, "msg-muted");
        return;
      }
      tradeStatus.textContent = `Order submitted: ${side} ${quantity} ${symbol}`;
      tradeStatus.className = "trade-status success";
      appendChatMessage("assistant", tradeStatus.textContent, "msg-muted");
      await loadSchwabContextData();
      if (typeof onSuccess === "function") onSuccess();
    } catch (error) {
      tradeStatus.textContent = error.message || "Order submission failed.";
      tradeStatus.className = "trade-status error";
      if (fundingHint && isFundingRelatedOrderError(error.message)) {
        fundingHint.hidden = false;
      }
    }
  });
}

function getCurrentAgent() {
  return AGENT_BY_ID[currentAgentId] || AGENTS[0];
}

function updateSchwabChatBadge() {
  if (!chatPanelBadge) return;
  chatPanelBadge.textContent = schwabSession.connected ? "Schwab Connected" : "Schwab Login Required";
  chatPanelBadge.classList.toggle("connected", Boolean(schwabSession.connected));
  const sendBtn = chatForm.querySelector("button[type='submit']");
  if (sendBtn) sendBtn.disabled = !schwabSession.connected;
  chatInput.disabled = !schwabSession.connected;
}

function setChatContextFromAgent(agent, announce = false) {
  chatInput.placeholder = `Ask ${agent.tab}...`;
  if (chatPanelTitle) chatPanelTitle.textContent = agent.tab;
  updateSchwabChatBadge();

  if (announce && !announcedAgents.has(agent.id)) {
    appendChatMessage(
      "assistant",
      `${agent.tab} is ready. I can help with ${agent.subtitle.toLowerCase()}.`,
      "msg-muted"
    );
    announcedAgents.add(agent.id);
  }
}

function isPermanentTab(tabName) {
  return (
    tabName === HOME_TAB ||
    tabName === PORTFOLIO_TAB ||
    tabName === INVESTMENTS_TAB ||
    tabName === TICKER_INTEL_TAB ||
    tabName === TIME_TAB
  );
}

function renderTabs(activeTab = HOME_TAB) {
  topTabs.innerHTML = "";
  [...openTabs].forEach((tabName) => {
    const btn = document.createElement("button");
    btn.className = `top-tab ${tabName === activeTab ? "active" : ""}`;
    btn.dataset.tab = tabName;
    const label = document.createElement("span");
    label.className = "top-tab-label";
    label.textContent = tabName;
    btn.appendChild(label);

    if (!isPermanentTab(tabName)) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "top-tab-close";
      close.setAttribute("aria-label", `Close ${tabName}`);
      close.textContent = "×";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tabName);
      });
      btn.appendChild(close);
    }

    btn.addEventListener("click", () => activateTab(tabName));
    topTabs.appendChild(btn);
  });
}

function closeTab(tabName) {
  if (isPermanentTab(tabName) || !openTabs.has(tabName)) return;
  const tabs = [...openTabs];
  const currentIndex = tabs.indexOf(tabName);
  openTabs.delete(tabName);

  if (currentTab === tabName) {
    const remaining = [...openTabs];
    if (!remaining.length) {
      openTabs.add(HOME_TAB);
      activateTab(HOME_TAB);
      return;
    }
    const nextIndex = Math.max(0, currentIndex - 1);
    const fallbackTab = remaining[nextIndex] || HOME_TAB;
    activateTab(fallbackTab);
    return;
  }

  renderTabs(currentTab);
}

function renderAssetsView() {
  workspaceTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Close</th>
          <th>Change</th>
          <th>Open</th>
          <th>High</th>
          <th>Low</th>
          <th>Volume</th>
        </tr>
      </thead>
      <tbody id="rows">
        <tr><td>S&P 500 ETF (SPY)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
        <tr><td>Apple (AAPL)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
        <tr><td>Microsoft (MSFT)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
        <tr><td>Crude Oil (CL.F)</td><td>67.02</td><td class="up">+2.56%</td><td>65.35</td><td>67.83</td><td>64.85</td><td>—</td></tr>
        <tr><td>Natural Gas (NG.F)</td><td>2.859</td><td class="up">+0.95%</td><td>2.832</td><td>2.894</td><td>2.818</td><td>—</td></tr>
      </tbody>
    </table>
  `;
}

function renderInvestmentsLoading() {
  workspaceTableWrap.innerHTML = '<div class="do-loading">Loading market data...</div>';
}

function renderInvestmentsView() {
  const assets = Array.isArray(investmentsMarket.assets) ? investmentsMarket.assets : [];
  const top = assets.slice(0, 6);
  const advancers = assets.filter((asset) => Number(getOpenDeltaPercent(asset) || 0) > 0).length;
  const decliners = assets.filter((asset) => Number(getOpenDeltaPercent(asset) || 0) < 0).length;
  const flats = Math.max(0, assets.length - advancers - decliners);

  const cardHtml = top
    .map(
      (asset) => {
        const pct = getOpenDeltaPercent(asset);
        const trendClass = !Number.isFinite(pct)
          ? "value-flat"
          : pct > 0
            ? "value-up"
            : pct < 0
              ? "value-down"
              : "value-flat";
        return `
      <article class="schwab-metric-card">
        <h4>${asset.label}</h4>
        <div class="schwab-metric-value small">$${Number(asset.close || 0).toFixed(2)}</div>
        <div class="settings-desc ${trendClass}">O:${Number(asset.open || 0).toFixed(2)} H:${Number(asset.high || 0).toFixed(
          2
        )} L:${Number(asset.low || 0).toFixed(2)} · ${formatPercent(pct)}</div>
        <div class="settings-desc">${renderSignalPill(pct)}</div>
      </article>
    `;
      }
    )
    .join("");

  const rows = assets
    .map((asset) => {
      const pct = getOpenDeltaPercent(asset);
      const trendClass = !Number.isFinite(pct)
        ? "value-flat"
        : pct > 0
          ? "value-up"
          : pct < 0
            ? "value-down"
            : "value-flat";
      return `
      <tr>
        <td class="ticker-cell">${asset.label}</td>
        <td>${asset.symbol}</td>
        <td>$${Number(asset.close || 0).toFixed(2)}</td>
        <td>${Number(asset.open || 0).toFixed(2)}</td>
        <td>${Number(asset.high || 0).toFixed(2)}</td>
        <td>${Number(asset.low || 0).toFixed(2)}</td>
        <td class="${trendClass}">${formatPercent(pct)}</td>
        <td>${renderSignalPill(pct)}</td>
        <td>${Number(asset.volume || 0).toLocaleString()}</td>
      </tr>
    `;
    })
    .join("");

  workspaceTableWrap.innerHTML = `
    <div class="agent-view">
      <section class="agent-hero">
        <h3>Investments Dashboard</h3>
        <p>Public market dashboard powered by backend market feeds. Schwab account login is optional for this tab.</p>
      </section>
      <section class="schwab-metrics">
        <article class="schwab-metric-card"><h4>Advancers</h4><div class="schwab-metric-value value-up">${advancers}</div></article>
        <article class="schwab-metric-card"><h4>Decliners</h4><div class="schwab-metric-value value-down">${decliners}</div></article>
        <article class="schwab-metric-card"><h4>Neutral</h4><div class="schwab-metric-value value-flat">${flats}</div></article>
      </section>
      <section class="schwab-metrics">${cardHtml}</section>
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Symbol</th>
              <th>Last</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Open Δ%</th>
              <th>Signal</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="9">No market data available.</td></tr>'}</tbody>
        </table>
      </section>
    </div>
  `;
}

function renderAgentView(agent) {
  const insightsHtml = agent.insights.map((item) => `<li>${item}</li>`).join("");
  const promptHtml = agent.prompts
    .map(
      (prompt) =>
        `<button type="button" class="prompt-btn" data-agent-prompt="${encodeURIComponent(prompt)}">${prompt}</button>`
    )
    .join("");

  const connectedSummary = schwabSession.connected
    ? `
      <article class="agent-card">
        <h4>Schwab account snapshot</h4>
        <ul class="agent-list">
          <li>Connected accounts: ${
            Array.isArray(schwabData.accounts) ? schwabData.accounts.length : schwabSession.accountCount || 0
          }</li>
          <li>Open orders: ${
            Array.isArray(schwabData.openOrders?.orders) ? schwabData.openOrders.orders.length : 0
          }</li>
          <li>Primary account hash: ${schwabSession.accountHash || "-"}</li>
        </ul>
      </article>
    `
    : `
      <article class="agent-card">
        <h4>Schwab account snapshot</h4>
        <p class="settings-desc">Connect Schwab to unlock live balances, positions, orders, and quote context.</p>
        <button type="button" class="prompt-btn" id="connectSchwabInlineBtn">Connect Schwab</button>
      </article>
    `;

  const portfolio = getPortfolioSnapshot();
  const orders = getOpenOrdersSummary();
  let missionDataCard = "";
  if (schwabSession.connected && agent.id === "portfolio-copilot") {
    missionDataCard = `
      <article class="agent-card">
        <h4>Portfolio Snapshot</h4>
        <ul class="agent-list">
          <li>Total value: ${formatDollars(portfolio.totalLiquidationValue)}</li>
          <li>Cash balance: ${formatDollars(portfolio.totalCash)}</li>
          <li>Total positions: ${portfolio.positionCount}</li>
          <li>Largest position weight: ${portfolio.topWeight}%</li>
        </ul>
      </article>
    `;
  } else if (schwabSession.connected && agent.id === "risk-radar") {
    missionDataCard = `
      <article class="agent-card">
        <h4>Risk Indicators</h4>
        <ul class="agent-list">
          <li>Largest concentration: ${portfolio.topWeight}%</li>
          <li>Cash buffer: ${formatDollars(portfolio.totalCash)}</li>
          <li>Open orders: ${orders.total}</li>
          <li>Stale open orders: ${orders.stale}</li>
        </ul>
      </article>
    `;
  } else if (schwabSession.connected && agent.id === "order-flow-execution") {
    const orderRows =
      orders.recent
        .map((order) => {
          const symbol = order?.orderLegCollection?.[0]?.instrument?.symbol || "-";
          const status = order?.status || "UNKNOWN";
          const type = order?.orderType || "N/A";
          return `<li>${symbol} - ${status} (${type})</li>`;
        })
        .join("") || "<li>No open orders right now.</li>";
    missionDataCard = `
      <article class="agent-card">
        <h4>Execution Board</h4>
        <ul class="agent-list">
          ${orderRows}
        </ul>
      </article>
    `;
  }

  workspaceTableWrap.innerHTML = `
    <div class="agent-view">
      <section class="agent-hero">
        <h3>${agent.tab}</h3>
        <p>${agent.description}</p>
      </section>
      <section class="agent-grid">
        <article class="agent-card">
          <h4>Recent market themes</h4>
          <ul class="agent-list">${insightsHtml}</ul>
        </article>
        <article class="agent-card">
          <h4>Quick prompts</h4>
          <div class="prompt-list">${promptHtml}</div>
        </article>
        ${missionDataCard}
        ${connectedSummary}
      </section>
    </div>
  `;

  const promptButtons = workspaceTableWrap.querySelectorAll("[data-agent-prompt]");
  promptButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompt = decodeURIComponent(btn.dataset.agentPrompt || "");
      if (!prompt) return;
      chatInput.value = prompt;
      chatForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });
  });

  const connectBtn = document.getElementById("connectSchwabInlineBtn");
  if (connectBtn) {
    connectBtn.addEventListener("click", startSchwabLogin);
  }
}

function renderSchwabConnectView() {
  const isConnected = Boolean(schwabSession.connected);
  const accountCount = schwabSession.accountCount || 0;
  const primaryAccount = schwabSession.accountNumber || "-";
  const connectedAt = schwabSession.connectedAt
    ? new Date(schwabSession.connectedAt).toLocaleString()
    : "Not connected";
  const linkedAccounts = getLinkedAccounts();
  const pendingSignals = linkedAccounts.map((account) => ({
    accountLabel:
      account?.securitiesAccount?.accountNumber ||
      account?.securitiesAccount?.hashValue ||
      account?.accountNumber ||
      "-",
    ...getAccountPendingDepositSignal(account),
  }));
  const totalPendingEstimate = pendingSignals.reduce((sum, item) => sum + Number(item.pendingEstimate || 0), 0);
  const pendingRows = pendingSignals
    .map((row) => {
      const hasPending = Number(row.pendingEstimate || 0) > 0;
      return `
        <li>
          Account ${escapeHtml(String(row.accountLabel))}: ${
            hasPending ? formatMoney(row.pendingEstimate) : "No pending amount detected"
          }
          <span class="settings-desc">(${escapeHtml(row.source)})</span>
        </li>
      `;
    })
    .join("");

  workspaceTableWrap.innerHTML = `
    <div class="schwab-view">
      <section class="schwab-hero">
        <div class="schwab-hero-copy">
          <h3>Connect Charles Schwab</h3>
          <p>Securely link your brokerage account to unlock live balances, positions, open orders, and trading actions directly in BetterOcean.</p>
        </div>
        <span class="schwab-status-pill ${isConnected ? "connected" : "offline"}">
          ${isConnected ? "Connected" : "Not Connected"}
        </span>
      </section>

      <section class="schwab-metrics">
        <article class="schwab-metric-card">
          <h4>Linked accounts</h4>
          <div class="schwab-metric-value">${accountCount}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Primary account</h4>
          <div class="schwab-metric-value small">${primaryAccount}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Last connected</h4>
          <div class="schwab-metric-value small">${connectedAt}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Pending Deposits (Estimate)</h4>
          <div class="schwab-metric-value small">${formatMoney(totalPendingEstimate)}</div>
        </article>
      </section>

      <section class="schwab-grid">
        ${
          isConnected
            ? `
        <article class="schwab-card">
          <h4>Pending Cash Activity</h4>
          <p class="schwab-card-sub">Incoming deposits can take time to settle. This card tracks pending cash signals from your Schwab balance payload.</p>
          <ul class="schwab-list">
            ${pendingRows || "<li>No connected account balances yet.</li>"}
          </ul>
        </article>
        `
            : ""
        }
        <article class="schwab-card">
          <h4>Connection Actions</h4>
          <p class="schwab-card-sub">Use secure OAuth to connect your Schwab identity to this session.</p>
          <div class="schwab-actions">
            <button type="button" class="schwab-btn schwab-btn-primary" id="schwabConnectBtn">
              ${isConnected ? "Reconnect Schwab" : "Connect Schwab"}
            </button>
            ${
              isConnected
                ? '<button type="button" class="schwab-btn schwab-btn-ghost" id="schwabDisconnectBtn">Disconnect</button>'
                : ""
            }
          </div>
        </article>

        <article class="schwab-card">
          <h4>What You Unlock</h4>
          <ul class="schwab-list">
            <li>Live account and position context across all agent tabs.</li>
            <li>Quote lookups and open order monitoring in real time.</li>
            <li>Guardrailed order placement and cancellation via backend APIs.</li>
          </ul>
        </article>

        <article class="schwab-card">
          <h4>Trade Ticket</h4>
          <p class="schwab-card-sub">
            Place a simple market order from BetterOcean. ${
              isConnected ? "Orders are sent through your connected Schwab account." : "Connect Schwab to enable trading."
            }
          </p>
          <form class="trade-form" id="tradeTicketForm">
            <label class="trade-label">Side</label>
            <select class="trade-input" id="tradeSide" data-trade-side ${isConnected ? "" : "disabled"}>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>

            <label class="trade-label">Symbol</label>
            <input class="trade-input" id="tradeSymbol" data-trade-symbol placeholder="AAPL" autocomplete="off" ${isConnected ? "" : "disabled"} />

            <label class="trade-label">Quantity</label>
            <input class="trade-input" id="tradeQty" data-trade-qty type="number" min="1" step="1" value="1" ${isConnected ? "" : "disabled"} />

            <button type="submit" class="schwab-btn schwab-btn-primary" ${isConnected ? "" : "disabled"}>
              Submit Order
            </button>
          </form>
          <div class="trade-status" id="tradeTicketStatus"></div>
          <div class="trade-funding-hint" id="tradeFundingHint" hidden>
            If Schwab rejects this for buying power, fund your account first and retry.
            <a href="${SCHWAB_FUNDING_URL}" target="_blank" rel="noopener noreferrer">Funding steps</a>
          </div>
        </article>
      </section>
    </div>
  `;

  const connectBtn = document.getElementById("schwabConnectBtn");
  if (connectBtn) connectBtn.addEventListener("click", startSchwabLogin);
  const disconnectBtn = document.getElementById("schwabDisconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", async () => {
      try {
        await logoutSchwab();
      } catch (e) {
        appendChatMessage("assistant", e.message || "Failed to disconnect Schwab.", "msg-error");
      }
    });
  }

  wireTradeTicketForm({
    formId: "tradeTicketForm",
    statusId: "tradeTicketStatus",
    fundingHintId: "tradeFundingHint",
  });
}

function renderShoppingView() {
  const isConnected = Boolean(schwabSession.connected);
  const marketOpen = isUsMarketOpenNow();
  const hasBuyOrders = shoppingState.items.some((item) => String(item?.side || "BUY").toUpperCase() === "BUY");
  const holdings = getShoppingHoldings(10);
  const sellChoices = holdings;
  const pinnedHoldings = holdings.slice(0, 8);
  const watchSymbols = getShoppingWatchSymbols();
  const pinnedHoldingsHtml = pinnedHoldings
    .map((holding) => {
      const quote = shoppingState.quoteBySymbol?.[holding.symbol];
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const toneClass = !Number.isFinite(pct) ? "value-flat" : pct > 0 ? "value-up" : pct < 0 ? "value-down" : "value-flat";
      const companyName = getCompanyName(holding.symbol, quote);
      return `
        <button type="button" class="shopping-quote-tile shopping-holding-tile" data-cart-add-symbol="${escapeHtml(
          holding.symbol
        )}">
          <span class="shopping-quote-top">
            <strong>${escapeHtml(holding.symbol)}</strong>
            <span class="shopping-company-name">${escapeHtml(companyName)}</span>
          </span>
          <span class="shopping-quote-bottom">
            <span>${quote ? renderPriceCell(quote.close) : "-"}</span>
            <span class="${toneClass}">${formatPercent(pct)}</span>
          </span>
          <span class="shopping-holding-meta">Held: ${holding.qty} · Value: ${formatMoney(holding.marketValue)}</span>
        </button>
      `;
    })
    .join("");
  const quoteTiles = watchSymbols
    .map((symbol) => {
      const quote = shoppingState.quoteBySymbol?.[symbol];
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const toneClass = !Number.isFinite(pct) ? "value-flat" : pct > 0 ? "value-up" : pct < 0 ? "value-down" : "value-flat";
      const companyName = getCompanyName(symbol, quote);
      return `
        <button type="button" class="shopping-quote-tile" data-cart-add-symbol="${escapeHtml(symbol)}">
          <span class="shopping-quote-top">
            <strong>${escapeHtml(symbol)}</strong>
            <span class="shopping-company-name">${escapeHtml(companyName)}</span>
          </span>
          <span class="shopping-quote-bottom">
            <span>${quote ? renderPriceCell(quote.close) : "-"}</span>
            <span class="${toneClass}">${formatPercent(pct)}</span>
          </span>
        </button>
      `;
    })
    .join("");

  const rowsHtml = shoppingState.items
    .map((item) => {
      const needsLimit = item.orderType === "LIMIT" || item.orderType === "STOP_LIMIT";
      const needsStop = item.orderType === "STOP" || item.orderType === "STOP_LIMIT";
      const symbol = String(item.symbol || "").toUpperCase();
      const quote = shoppingState.quoteBySymbol?.[symbol];
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const rowTone = !Number.isFinite(pct) ? "tone-flat" : pct > 0 ? "tone-up" : pct < 0 ? "tone-down" : "tone-flat";
      const buyBlocked = !marketOpen && String(item.side || "BUY").toUpperCase() === "BUY";
      return `
      <tr data-cart-row="${item.id}" class="${rowTone}">
        <td><input class="trade-input cart-input-symbol" data-cart-symbol value="${escapeHtml(item.symbol)}" placeholder="AAPL" /></td>
        <td>
          <select class="trade-input" data-cart-side>
            <option value="BUY" ${item.side === "BUY" ? "selected" : ""}>Buy</option>
            <option value="SELL" ${item.side === "SELL" ? "selected" : ""}>Sell</option>
          </select>
        </td>
        <td><input class="trade-input" data-cart-qty type="number" min="1" step="1" value="${Number(item.quantity) || 1}" /></td>
        <td>
          <select class="trade-input" data-cart-order-type>
            <option value="MARKET" ${item.orderType === "MARKET" ? "selected" : ""}>Market</option>
            <option value="LIMIT" ${item.orderType === "LIMIT" ? "selected" : ""}>Limit</option>
            <option value="STOP" ${item.orderType === "STOP" ? "selected" : ""}>Stop</option>
            <option value="STOP_LIMIT" ${item.orderType === "STOP_LIMIT" ? "selected" : ""}>Stop Limit</option>
          </select>
        </td>
        <td><input class="trade-input" data-cart-limit type="number" min="0.01" step="0.01" value="${escapeHtml(item.limitPrice || "")}" ${needsLimit ? "" : "disabled"} /></td>
        <td><input class="trade-input" data-cart-stop type="number" min="0.01" step="0.01" value="${escapeHtml(item.stopPrice || "")}" ${needsStop ? "" : "disabled"} /></td>
        <td>
          <select class="trade-input" data-cart-duration>
            <option value="DAY" ${item.duration === "DAY" ? "selected" : ""}>Day</option>
            <option value="GTC" ${item.duration === "GTC" ? "selected" : ""}>GTC</option>
          </select>
        </td>
        <td><label class="cart-auto-label"><input type="checkbox" data-cart-auto ${item.autoMode ? "checked" : ""} /> Auto</label></td>
        <td><button type="button" class="schwab-btn schwab-btn-ghost cart-remove-btn" data-cart-remove>Remove</button></td>
        <td class="cart-row-price">${quote ? renderPriceCell(quote.close) : "-"}</td>
        <td class="cart-row-move ${!Number.isFinite(pct) ? "value-flat" : pct > 0 ? "value-up" : pct < 0 ? "value-down" : "value-flat"}">${formatPercent(
          pct
        )}</td>
        <td>${quote ? renderSignalPill(pct) : '<span class="signal-pill neutral">No Data</span>'}</td>
        <td class="cart-row-note">${buyBlocked ? "Buy waits for market open" : "Ready"}</td>
      </tr>
    `;
    })
    .join("");

  workspaceTableWrap.innerHTML = `
    <div class="agent-view">
      <section class="agent-hero">
        <h3>Shopping Cart</h3>
        <p>Build buy and sell orders, then submit straight to Schwab. Auto mode uses Gradient ticker intelligence to bias side/type before submit.</p>
      </section>
      <section class="shopping-market-card">
        <div class="shopping-market-left">
          <span class="market-state-pill ${marketOpen ? "open" : "closed"}" id="shoppingMarketState">${
            marketOpen ? "Market Open" : "Market Closed"
          }</span>
          <div class="shopping-market-clock" id="shoppingMarketCountdown">${
            marketOpen ? "Closes in --:--:--" : "Opens in --:--:--"
          }</div>
          <div class="shopping-market-now" id="shoppingEtNow">ET now: ${formatEtNowLabel()}</div>
        </div>
        <div class="shopping-market-right">
          <div class="market-gate-note ${marketOpen ? "open" : "closed"}" id="shoppingMarketGate">
            ${
              marketOpen
                ? "Buy and sell orders are enabled."
                : hasBuyOrders
                  ? "Buy orders are disabled while the U.S. market is closed."
                  : "Sell-only mode while market is closed."
            }
          </div>
        </div>
      </section>
      <section class="schwab-card">
        <h4>Live Stock Board</h4>
        <p class="schwab-card-sub">Click any stock to add it to your cart with live price and signal context.</p>
        ${
          isConnected
            ? `
        <div class="shopping-pinned-head">
          <span class="shopping-pinned-title">Pinned: My Holdings</span>
          <span class="shopping-pinned-sub">${pinnedHoldings.length} symbols from your connected Schwab portfolio</span>
        </div>
        <div class="shopping-quote-grid shopping-quote-grid-pinned">${
          pinnedHoldingsHtml || '<div class="settings-desc">No current holdings found.</div>'
        }</div>
        `
            : ""
        }
        <div class="shopping-quote-grid">${quoteTiles || '<div class="settings-desc">No symbols loaded yet.</div>'}</div>
      </section>
      <section class="schwab-card">
        ${
          sellChoices.length
            ? `
          <div class="cart-sell-strip">
            <span class="cart-sell-label">Quick Sell From Portfolio:</span>
            ${sellChoices
              .map(
                (choice) =>
                  `<button type="button" class="schwab-btn schwab-btn-ghost cart-sell-chip" data-quick-sell-symbol="${escapeHtml(
                    choice.symbol
                  )}" data-quick-sell-qty="${choice.qty}">${escapeHtml(choice.symbol)} (${choice.qty})</button>`
              )
              .join("")}
          </div>
        `
            : ""
        }
        <div class="cart-toolbar">
          <input id="cartNewSymbol" class="trade-input cart-add-input" placeholder="Add ticker (AAPL)" ${isConnected ? "" : "disabled"} />
          <button type="button" class="schwab-btn schwab-btn-primary" id="cartAddBtn" ${isConnected ? "" : "disabled"}>Add Ticker</button>
          <button type="button" class="schwab-btn schwab-btn-ghost" id="cartRefreshQuotesBtn">Refresh Prices</button>
          <button type="button" class="schwab-btn schwab-btn-ghost" id="cartClearBtn" ${isConnected ? "" : "disabled"}>Clear</button>
        </div>
        <div class="table-wrap">
          <table class="cart-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Order Type</th>
                <th>Limit</th>
                <th>Stop</th>
                <th>TIF</th>
                <th>Auto</th>
                <th>Action</th>
                <th>Last</th>
                <th>Move %</th>
                <th>Signal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rowsHtml || '<tr><td colspan="13">No orders in cart yet.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="cart-footer">
          <div class="trade-status ${shoppingState.submitting ? "pending" : ""}">${escapeHtml(
            shoppingState.status || (isConnected ? "Ready to submit." : "Connect Schwab to start trading.")
          )}</div>
          <button type="button" class="schwab-btn schwab-btn-primary" id="cartSubmitBtn" ${
            isConnected && shoppingState.items.length && !shoppingState.submitting ? "" : "disabled"
          }>Submit Cart</button>
        </div>
      </section>
    </div>
  `;

  const addBtn = document.getElementById("cartAddBtn");
  const newSymbolInput = document.getElementById("cartNewSymbol");
  const clearBtn = document.getElementById("cartClearBtn");
  const refreshQuotesBtn = document.getElementById("cartRefreshQuotesBtn");
  const submitBtn = document.getElementById("cartSubmitBtn");
  if (addBtn && newSymbolInput) {
    addBtn.addEventListener("click", () => {
      const symbol = String(newSymbolInput.value || "")
        .trim()
        .toUpperCase();
      if (!symbol) return;
      shoppingState = { ...shoppingState, items: [...shoppingState.items, createShoppingCartItem(symbol)], status: "" };
      renderShoppingView();
    });
    newSymbolInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addBtn.click();
      }
    });
  }
  if (refreshQuotesBtn) {
    refreshQuotesBtn.addEventListener("click", () => {
      refreshShoppingQuotes({ force: true }).catch(() => ({}));
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      shoppingState = { ...shoppingState, items: [], status: "Cart cleared." };
      renderShoppingView();
    });
  }
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      submitShoppingCartOrders().catch((error) => {
        shoppingState = { ...shoppingState, submitting: false, status: error.message || "Cart submit failed." };
        renderShoppingView();
      });
    });
  }

  const rowEls = workspaceTableWrap.querySelectorAll("[data-cart-row]");
  rowEls.forEach((rowEl) => {
    const id = rowEl.getAttribute("data-cart-row");
    if (!id) return;
    const updateItem = (patch) => {
      shoppingState = {
        ...shoppingState,
        items: shoppingState.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        status: "",
      };
      renderShoppingView();
    };
    rowEl.querySelector("[data-cart-symbol]")?.addEventListener("change", (e) => {
      updateItem({ symbol: String(e.target.value || "").trim().toUpperCase() });
    });
    rowEl.querySelector("[data-cart-side]")?.addEventListener("change", (e) => updateItem({ side: e.target.value || "BUY" }));
    rowEl.querySelector("[data-cart-qty]")?.addEventListener("change", (e) =>
      updateItem({ quantity: Number(e.target.value || 0) })
    );
    rowEl.querySelector("[data-cart-order-type]")?.addEventListener("change", (e) => {
      const nextType = String(e.target.value || "MARKET").toUpperCase();
      updateItem({ orderType: nextType });
    });
    rowEl.querySelector("[data-cart-limit]")?.addEventListener("change", (e) => updateItem({ limitPrice: e.target.value || "" }));
    rowEl.querySelector("[data-cart-stop]")?.addEventListener("change", (e) => updateItem({ stopPrice: e.target.value || "" }));
    rowEl.querySelector("[data-cart-duration]")?.addEventListener("change", (e) =>
      updateItem({ duration: String(e.target.value || "DAY").toUpperCase() })
    );
    rowEl.querySelector("[data-cart-auto]")?.addEventListener("change", (e) => updateItem({ autoMode: Boolean(e.target.checked) }));
    rowEl.querySelector("[data-cart-remove]")?.addEventListener("click", () => {
      shoppingState = { ...shoppingState, items: shoppingState.items.filter((item) => item.id !== id), status: "" };
      renderShoppingView();
    });
  });

  const addFromBoardButtons = workspaceTableWrap.querySelectorAll("[data-cart-add-symbol]");
  addFromBoardButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = String(btn.getAttribute("data-cart-add-symbol") || "").toUpperCase();
      if (!symbol) return;
      shoppingState = { ...shoppingState, items: [...shoppingState.items, createShoppingCartItem(symbol)], status: "" };
      renderShoppingView();
    });
  });

  const quickSellButtons = workspaceTableWrap.querySelectorAll("[data-quick-sell-symbol]");
  quickSellButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = String(btn.getAttribute("data-quick-sell-symbol") || "").toUpperCase();
      const qty = Number(btn.getAttribute("data-quick-sell-qty") || 1);
      if (!symbol) return;
      shoppingState = {
        ...shoppingState,
        items: [
          ...shoppingState.items,
          {
            ...createShoppingCartItem(symbol),
            side: "SELL",
            quantity: Math.max(1, qty),
          },
        ],
        status: "",
      };
      renderShoppingView();
    });
  });

  if (!shoppingState.loadingQuotes) {
    refreshShoppingQuotes().catch(() => ({}));
  }
  updateShoppingSubmitButtonState();
  startShoppingMarketClock();
}

function renderSettingsView() {
  const token = getDoToken();
  workspaceTableWrap.innerHTML = `
    <div class="settings-block">
      <h3 class="settings-title">DigitalOcean API</h3>
      <p class="settings-desc">Optional: add a read-only Personal Access Token to view account and droplets in the DigitalOcean tab. Token is stored in this browser session only.</p>
      <label class="settings-label">API token</label>
      <input type="password" id="doTokenInput" class="settings-input" placeholder="${token ? "Token saved - paste a new token to replace" : "Paste your token"}" autocomplete="off" />
      <button type="button" id="doTokenSave" class="settings-save">Save token</button>
      ${token ? '<button type="button" id="doTokenClear" class="settings-clear">Clear token</button>' : ""}
    </div>
  `;
  const input = document.getElementById("doTokenInput");
  document.getElementById("doTokenSave").addEventListener("click", () => {
    const raw = input.value.trim();
    if (raw) setDoToken(raw);
    input.value = "";
    input.placeholder = "Token saved - paste a new token to replace";
    renderSettingsView();
  });
  const clearBtn = document.getElementById("doTokenClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      setDoToken("");
      renderSettingsView();
    });
  }
}

function renderDoLoading() {
  workspaceTableWrap.innerHTML = '<div class="do-loading">Loading DigitalOcean data...</div>';
}

function renderDoError(msg) {
  workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${msg}</p><p>Set your API token in Settings (G).</p></div>`;
}

function renderDoView(account, droplets) {
  const acc = account?.account || {};
  const list = droplets?.droplets || [];
  const region = (r) => (r && (r.slug || r.name)) || "-";
  const rows = list
    .map(
      (d) =>
        `<tr>
          <td>${d.name || d.id}</td>
          <td>${d.status || "-"}</td>
          <td>${region(d.region)}</td>
          <td>${d.memory || "-"} MB</td>
          <td>${d.vcpus ?? "-"}</td>
          <td>${d.disk ?? "-"} GB</td>
        </tr>`
    )
    .join("");
  workspaceTableWrap.innerHTML = `
    <div class="do-account">
      <div class="do-account-card">
        <span class="do-account-label">Account</span>
        <div class="do-account-email">${acc.email || "-"}</div>
        <div class="do-account-meta">Droplet limit: ${acc.droplet_limit ?? "-"} - Status: ${acc.status || "-"}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Droplet</th>
          <th>Status</th>
          <th>Region</th>
          <th>Memory</th>
          <th>vCPUs</th>
          <th>Disk</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6">No droplets</td></tr>'}</tbody>
    </table>
  `;
}

async function loadDoView() {
  const token = getDoToken();
  if (!token) {
    renderDoError("No API token set.");
    return;
  }
  renderDoLoading();
  try {
    const [account, droplets] = await Promise.all([
      doApi("/v2/account", token),
      doApi("/v2/droplets?per_page=100", token),
    ]);
    renderDoView(account, droplets);
  } catch (e) {
    renderDoError(e.message || String(e));
  }
}

function activateTab(tabName) {
  if (tabName === "Assets") {
    tabName = SCHWAB_CONNECT_TAB;
  }
  if (
    !schwabSession.connected &&
    tabName !== SCHWAB_CONNECT_TAB &&
    tabName !== INVESTMENTS_TAB &&
    tabName !== TICKER_INTEL_TAB &&
    tabName !== TIME_TAB &&
    tabName !== SHOPPING_TAB
  ) {
    openTabs.add(SCHWAB_CONNECT_TAB);
    currentTab = SCHWAB_CONNECT_TAB;
    titleEl.textContent = SCHWAB_CONNECT_TAB;
    subEl.textContent = "Schwab OAuth required";
    renderTabs(SCHWAB_CONNECT_TAB);
    renderSchwabConnectView();
    return;
  }

  currentTab = tabName;
  const agent = AGENT_BY_TAB[tabName];

  titleEl.textContent = tabName;
  subEl.textContent = agent
    ? agent.subtitle
    : tabName === SCHWAB_CONNECT_TAB
      ? "Schwab OAuth required"
      : tabName === PORTFOLIO_TAB
        ? "Your Schwab accounts and positions"
      : tabName === INVESTMENTS_TAB
        ? "Public market dashboard"
          : tabName === TICKER_INTEL_TAB
            ? "Ticker list + Gradient AI deep-dive"
        : tabName === TIME_TAB
          ? "Market open countdown + AI playbook"
      : tabName === SHOPPING_TAB
        ? "Build and submit buy/sell cart orders"
          : "Blank workspace";

  renderTabs(tabName);

  stopMarketCountdown();
  stopShoppingMarketClock();

  if (tabName === SCHWAB_CONNECT_TAB) {
    renderSchwabConnectView();
    if (schwabSession.connected) {
      loadSchwabContextData()
        .then(() => {
          if (currentTab === SCHWAB_CONNECT_TAB) renderSchwabConnectView();
        })
        .catch(() => ({}));
    }
    return;
  }
  if (tabName === PORTFOLIO_TAB) {
    loadSchwabContextData()
      .then(() => renderPortfolioView())
      .catch((error) => {
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load portfolio data."
        }</p></div>`;
      });
    return;
  }
  if (tabName === INVESTMENTS_TAB) {
    const hasFreshInvestments =
      Array.isArray(investmentsMarket.assets) &&
      investmentsMarket.assets.length > 0 &&
      Date.now() - investmentsLoadedAt < MARKET_TAB_TTL_MS;
    if (hasFreshInvestments) {
      renderInvestmentsView();
    } else {
      renderInvestmentsLoading();
      loadInvestmentsMarketData()
        .then(() => {
          investmentsLoadedAt = Date.now();
          renderInvestmentsView();
        })
        .catch((error) => {
          workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
            error.message || "Failed to load market data."
          }</p></div>`;
        });
    }
    return;
  }
  if (tabName === TICKER_INTEL_TAB) {
    renderTickerIntelLoading();
    const universePromise =
      tickerIntelState.universe.length >= 50
        ? Promise.resolve(tickerIntelState.universe)
        : loadTickerUniverse(500).catch(() => DEFAULT_TICKER_WATCHLIST);
    universePromise
      .then(() => {
        renderTickerIntelView();
        const needsFreshQuotes =
          !tickerIntelState.quotesUpdatedAt || Date.now() - tickerIntelState.quotesUpdatedAt > TICKER_QUOTES_TTL_MS;
        if (needsFreshQuotes) {
          refreshTickerUniverseQuotes({ rerender: true }).catch(() => ({}));
        }
        const nextSymbol = tickerIntelState.universe.includes(tickerIntelState.selected)
          ? tickerIntelState.selected
          : tickerIntelState.universe[0] || "AAPL";
        return loadTickerIntelReport(nextSymbol);
      })
      .then(() => renderTickerIntelView())
      .catch((error) => {
        tickerIntelState = {
          ...tickerIntelState,
          loading: false,
          report: null,
          error: error.message || "Failed to build ticker report.",
        };
        renderTickerIntelView();
      });
    return;
  }
  if (tabName === TIME_TAB) {
    workspaceTableWrap.innerHTML = '<div class="do-loading">Building opening bell playbook...</div>';
    loadOpeningPlaybook()
      .then(async () => {
        openingPlaybookLoadedAt = Date.now();
        const symbols = openingPlaybook.buckets.flatMap((bucket) =>
          Array.isArray(bucket.tickers) ? bucket.tickers : []
        );
        await loadPublicQuotes(symbols).catch(() => ({}));

        const bucketHtml = openingPlaybook.buckets
          .map((bucket) => {
            const tickerRows = (Array.isArray(bucket.tickers) ? bucket.tickers : [])
              .map((symbol) => {
                const quote = openingQuotesBySymbol[String(symbol).toUpperCase()];
                if (!quote || quote.unavailable) {
                  return `<tr><td>${symbol}</td><td colspan="6">Price unavailable</td></tr>`;
                }
                const pct = getOpenDeltaPercent(quote);
                const trendClass = !Number.isFinite(pct)
                  ? "value-flat"
                  : pct > 0
                    ? "value-up"
                    : pct < 0
                      ? "value-down"
                      : "value-flat";
                return `
                  <tr>
                    <td class="ticker-cell">${symbol}</td>
                    <td>${renderPriceCell(quote.close)}</td>
                    <td>${renderPriceCell(quote.open)}</td>
                    <td>${renderPriceCell(quote.high)}</td>
                    <td>${renderPriceCell(quote.low)}</td>
                    <td class="${trendClass}">${formatPercent(pct)}</td>
                    <td>${renderSignalPill(pct)}</td>
                  </tr>
                `;
              })
              .join("");
            return `
              <article class="schwab-card">
                <h4>${bucket.name || "Bucket"}</h4>
                <p class="schwab-card-sub">${bucket.thesis || "No thesis provided."}</p>
                <div class="time-table-wrap">
                  <table class="time-table">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Last</th>
                        <th>Open</th>
                        <th>High</th>
                        <th>Low</th>
                        <th>Open Δ%</th>
                        <th>Signal</th>
                      </tr>
                    </thead>
                    <tbody>${tickerRows || '<tr><td colspan="7">No tickers.</td></tr>'}</tbody>
                  </table>
                </div>
              </article>
            `;
          })
          .join("");

        workspaceTableWrap.innerHTML = `
          <div class="agent-view">
            <section class="agent-hero">
              <h3>Market Open Timer</h3>
              <p>Countdown to next U.S. market open (ET) with Gradient AI opening-bell stock buckets.</p>
            </section>
            <section class="schwab-metrics">
              <article class="schwab-metric-card">
                <h4>Next market open in</h4>
                <div class="schwab-metric-value" id="marketOpenCountdown">--:--:--</div>
              </article>
              <article class="schwab-metric-card">
                <h4>AI Source</h4>
                <div class="schwab-metric-value small">${openingPlaybook.source || "unknown"}</div>
              </article>
              <article class="schwab-metric-card">
                <h4>Playbook Updated</h4>
                <div class="schwab-metric-value small">${
                  openingPlaybook.asOf ? new Date(openingPlaybook.asOf).toLocaleString() : "-"
                }</div>
              </article>
            </section>
            <section class="schwab-grid">
              ${bucketHtml || '<article class="schwab-card"><h4>No buckets</h4><p class="schwab-card-sub">Try Refresh to regenerate opening ideas.</p></article>'}
            </section>
            ${
              openingPlaybook.notes
                ? `<section class="schwab-card"><h4>AI Notes</h4><p class="schwab-card-sub">${openingPlaybook.notes}</p></section>`
                : ""
            }
          </div>
        `;
        startMarketCountdown();
      })
      .catch((error) => {
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load opening playbook."
        }</p></div>`;
      });
    return;
  }
  if (tabName === SHOPPING_TAB) {
    renderShoppingView();
    return;
  }
  if (agent) {
    currentAgentId = agent.id;
    setChatContextFromAgent(agent, true);
    renderAgentView(agent);
    return;
  }

  workspaceTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Close</th>
          <th>Change</th>
          <th>Open</th>
          <th>High</th>
          <th>Low</th>
          <th>Volume</th>
        </tr>
      </thead>
      <tbody id="rows">
        <tr>
          <td>${tabName} tab is ready</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>Blank</td>
        </tr>
      </tbody>
    </table>
  `;
}

document.getElementById("toggleLeftPanelBtn")?.addEventListener("click", () => {
  const prefs = readUiPrefs();
  writeUiPrefs({ leftCollapsed: !prefs.leftCollapsed });
  applyLayoutPrefs();
});

document.getElementById("toggleChatPanelBtn")?.addEventListener("click", () => {
  const prefs = readUiPrefs();
  writeUiPrefs({ chatCollapsed: !prefs.chatCollapsed });
  applyLayoutPrefs();
});

workspaceRefreshBtn?.addEventListener("click", () => {
  if (currentTab === SCHWAB_CONNECT_TAB) {
    refreshSchwabSession().then(() => {
      if (schwabSession.connected) {
        loadSchwabContextData().then(() => activateTab(HOME_TAB));
      } else {
        renderSchwabConnectView();
      }
    });
    return;
  }
  if (currentTab === INVESTMENTS_TAB) {
    renderInvestmentsLoading();
    loadInvestmentsMarketData()
      .then(() => {
        investmentsLoadedAt = Date.now();
        renderInvestmentsView();
      })
      .catch((error) => {
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load market data."
        }</p></div>`;
      });
    return;
  }
  if (currentTab === PORTFOLIO_TAB) {
    loadSchwabContextData()
      .then(() => renderPortfolioView())
      .catch((error) => {
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load portfolio data."
        }</p></div>`;
      });
    return;
  }
  if (currentTab === TICKER_INTEL_TAB) {
    const universePromise =
      tickerIntelState.universe.length >= 50
        ? Promise.resolve(tickerIntelState.universe)
        : loadTickerUniverse(500).catch(() => DEFAULT_TICKER_WATCHLIST);
    universePromise
      .then(() => refreshTickerUniverseQuotes({ rerender: true, force: true }))
      .then(() => loadTickerIntelReport(tickerIntelState.selected || "AAPL"))
      .then(() => renderTickerIntelView())
      .catch((error) => {
        tickerIntelState = { ...tickerIntelState, loading: false, error: error.message || "Refresh failed." };
        renderTickerIntelView();
      });
    return;
  }
  if (currentTab === TIME_TAB) {
    activateTab(TIME_TAB);
    return;
  }
  if (currentTab === SHOPPING_TAB) {
    renderShoppingView();
    return;
  }
  const agent = AGENT_BY_TAB[currentTab];
  if (agent) {
    loadSchwabContextData().then(() => renderAgentView(agent));
  }
});

openShoppingCartBtn?.addEventListener("click", () => {
  openTabs.add(SHOPPING_TAB);
  activateTab(SHOPPING_TAB);
});

railButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    railButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tabName = btn.dataset.openTab || "Blank";
    openTabs.add(tabName);
    activateTab(tabName);
  });
});

menuButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    menuButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const agentId = btn.dataset.agent;
    const agent = AGENT_BY_ID[agentId];
    if (!agent) return;
    openTabs.add(agent.tab);
    activateTab(agent.tab);
  });
});

function appendChatMessage(role, content, className = "") {
  const div = document.createElement("div");
  div.className = role === "user" ? "msg me" : "msg" + (className ? " " + className : "");
  if (role === "assistant" && !className) {
    const bulletItems = normalizeToBullets(content);
    if (bulletItems.length > 1) {
      div.innerHTML = `
        <ul class="msg-list">
          ${bulletItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      `;
    } else {
      div.textContent = content;
    }
  } else {
    div.textContent = content;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeToBullets(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const explicitBullets = lines
    .filter((line) => /^[-*•]\s+/.test(line) || /^\d+[\).\s]+/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+[\).\s]+/, "").trim())
    .filter(Boolean);
  if (explicitBullets.length >= 2) return explicitBullets.slice(0, 6);

  const sentenceBullets = clean
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  return sentenceBullets;
}

async function sendToGradient(userContent) {
  const agent = getCurrentAgent();
  const missionContext = buildMissionZoneContext(agent.id);
  const schwabContext = schwabSession.connected
    ? `Schwab context: connected account count=${schwabSession.accountCount || 0}, primary account hash=${
        schwabSession.accountHash || "unknown"
      }, open orders=${Array.isArray(schwabData.openOrders?.orders) ? schwabData.openOrders.orders.length : 0}.`
    : "Schwab context unavailable (user not connected).";
  const messages = [
    { role: "system", content: agent.systemPrompt },
    { role: "system", content: RESPONSE_STYLE_PROMPT },
    { role: "system", content: schwabContext },
    { role: "system", content: missionContext },
    ...chatHistory,
    { role: "user", content: userContent },
  ];
  const res = await fetch(API_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  if (data.error) throw new Error(data.error);
  return data.reply != null ? String(data.reply) : "";
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (
    !schwabSession.connected &&
    currentTab !== INVESTMENTS_TAB &&
    currentTab !== TICKER_INTEL_TAB &&
    currentTab !== TIME_TAB
  ) {
    appendChatMessage(
      "assistant",
      "Please connect your Charles Schwab account first for account-specific analysis. You can still use the Investments, Ticker Intel, and Time tabs without login.",
      "msg-error"
    );
    openTabs.add(SCHWAB_CONNECT_TAB);
    activateTab(SCHWAB_CONNECT_TAB);
    return;
  }
  const value = chatInput.value.trim();
  if (!value) return;

  const userMsg = value;
  chatInput.value = "";
  chatHistory.push({ role: "user", content: userMsg });
  appendChatMessage("user", userMsg);

  const placeholder = document.createElement("div");
  placeholder.className = "msg msg-thinking";
  placeholder.textContent = "Thinking...";
  chatLog.appendChild(placeholder);
  chatLog.scrollTop = chatLog.scrollHeight;

  try {
    const reply = await sendToGradient(userMsg);
    placeholder.remove();
    if (reply) {
      chatHistory.push({ role: "assistant", content: reply });
      appendChatMessage("assistant", reply);
    } else {
      chatHistory.pop();
      appendChatMessage(
        "assistant",
        "No reply from the assistant. The API may not be configured yet.",
        "msg-muted"
      );
    }
  } catch (err) {
    placeholder.remove();
    chatHistory.pop();
    const errText = err.message || String(err);
    appendChatMessage("assistant", errText, "msg-error");
  }
});

async function initApp() {
  const params = new URLSearchParams(window.location.search);
  const schwabFlag = params.get("schwab");
  const schwabReason = params.get("reason");
  applyLayoutPrefs();
  startMarketOpenThemeTimer();

  await refreshSchwabSession();
  if (schwabSession.connected) {
    await loadSchwabContextData();
  }

  renderTabs(HOME_TAB);
  openTabs.add(PORTFOLIO_TAB);
  openTabs.add(INVESTMENTS_TAB);
  openTabs.add(TICKER_INTEL_TAB);
  openTabs.add(TIME_TAB);
  if (schwabSession.connected) {
    activateTab(HOME_TAB);
  } else {
    activateTab(HOME_TAB);
  }
  setChatContextFromAgent(getCurrentAgent(), true);

  if (schwabFlag === "connected") {
    appendChatMessage("assistant", "Schwab login successful. Your account is connected.", "msg-muted");
    openTabs.add(PORTFOLIO_TAB);
    activateTab(PORTFOLIO_TAB);
  } else if (schwabFlag === "error") {
    appendChatMessage(
      "assistant",
      `Schwab login failed: ${schwabReason || "Unknown error."}`,
      "msg-error"
    );
  }
}

initApp();
