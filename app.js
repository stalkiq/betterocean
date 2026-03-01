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

const DO_API_BASE = "https://api.digitalocean.com";
const TOKEN_KEY = "do_api_token";
const API_CHAT_URL = "/api/chat/message";
const SCHWAB_CONNECT_TAB = "Schwab Connect";
const INVESTMENTS_TAB = "Investments";
const TICKER_INTEL_TAB = "Ticker Intel";
const TIME_TAB = "Time";
const HOME_TAB = SCHWAB_CONNECT_TAB;
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

const openTabs = new Set([HOME_TAB, INVESTMENTS_TAB, TICKER_INTEL_TAB, TIME_TAB]);
let currentTab = HOME_TAB;
let currentAgentId = AGENTS[0].id;
const announcedAgents = new Set();

let chatHistory = [];
let schwabSession = { connected: false };
let schwabData = { accounts: null, openOrders: null };
let investmentsMarket = { assets: [], updatedAt: null };
let openingPlaybook = { buckets: [], asOf: null };
let openingQuotesBySymbol = {};
const DEFAULT_TICKER_WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "UNH"];
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
  reportCache: {},
  reportCacheAt: {},
  quotesUpdatedAt: 0,
};
let marketCountdownTimer = null;
let tickerUniverseQuotesPromise = null;
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
    schwabData = { accounts: null, openOrders: null };
    return;
  }
  try {
    const [accounts, openOrders] = await Promise.all([
      schwabApi("/api/schwab/accounts", { method: "GET" }),
      schwabApi("/api/schwab/orders/open?maxResults=25", { method: "GET" }),
    ]);
    schwabData = { accounts, openOrders };
  } catch {
    schwabData = { accounts: null, openOrders: null };
  }
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
  tickerIntelState = {
    ...tickerIntelState,
    universe: symbols.length ? symbols : DEFAULT_TICKER_WATCHLIST,
    universeSource: "",
    loadingUniverse: false,
    selected: symbols.includes(tickerIntelState.selected) ? tickerIntelState.selected : symbols[0] || "AAPL",
  };
  return tickerIntelState.universe;
}

function parseSchwabQuotesPayload(payload, requestedSymbols = []) {
  const upperRequested = [...new Set((requestedSymbols || []).map((s) => String(s || "").toUpperCase()))];
  const out = {};
  const records = payload && typeof payload === "object" ? payload : {};

  upperRequested.forEach((symbol) => {
    const rec = records[symbol] || records[symbol.toLowerCase()] || null;
    const q = rec?.quote || rec?.regular || rec || null;
    if (!q || typeof q !== "object") {
      out[symbol] = { symbol, label: symbol, unavailable: true };
      return;
    }
    const close = Number(q.lastPrice ?? q.mark ?? q.closePrice ?? q.bidPrice ?? q.askPrice);
    const open = Number(q.openPrice ?? q.open ?? 0);
    const high = Number(q.highPrice ?? q.high ?? 0);
    const low = Number(q.lowPrice ?? q.low ?? 0);
    const volume = Number(q.totalVolume ?? q.volume ?? 0);
    if (!Number.isFinite(close) || close <= 0) {
      out[symbol] = { symbol, label: symbol, unavailable: true };
      return;
    }
    out[symbol] = {
      symbol,
      label: symbol,
      close,
      open: Number.isFinite(open) ? open : 0,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      volume: Number.isFinite(volume) ? volume : 0,
      source: "schwab",
      unavailable: false,
    };
  });

  return out;
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
  const chunkSize = 25;
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
          const data = await schwabApi(`/api/schwab/quotes?symbols=${encodeURIComponent(chunk.join(","))}`, {
            method: "GET",
          });
          const parsed = parseSchwabQuotesPayload(data, chunk);
          Object.assign(bySymbol, parsed);
        } catch (error) {
          chunk.forEach((symbol) => {
            bySymbol[symbol] = { symbol, label: symbol, unavailable: true };
          });
          if (String(error?.message || "").includes("401")) {
            tickerIntelState = {
              ...tickerIntelState,
              error: "Schwab login required to load live prices in this tab.",
            };
          }
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
  if (pct >= 2) return { label: "Strong Bull", className: "bull-strong" };
  if (pct >= 0.4) return { label: "Bullish", className: "bull" };
  if (pct <= -2) return { label: "Strong Bear", className: "bear-strong" };
  if (pct <= -0.4) return { label: "Bearish", className: "bear" };
  return { label: "Neutral", className: "neutral" };
}

function renderSignalPill(pct) {
  const signal = getSignalFromDelta(pct);
  return `<span class="signal-pill ${signal.className}">${signal.label}</span>`;
}

function toSignalBadge(signal = "neutral") {
  const clean = String(signal || "neutral").toLowerCase();
  if (clean === "bullish") return '<span class="signal-pill bull">Bullish</span>';
  if (clean === "bearish") return '<span class="signal-pill bear">Bearish</span>';
  return '<span class="signal-pill neutral">Neutral</span>';
}

function renderListItems(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '<li class="settings-desc">No items.</li>';
  return list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("");
}

function getFilteredTickerUniverse() {
  const search = String(tickerIntelState.search || "")
    .trim()
    .toUpperCase();
  const signalFilter = tickerIntelState.signalFilter || "all";
  const priceFilter = tickerIntelState.priceFilter || "all";
  const symbols = tickerIntelState.universe.length ? tickerIntelState.universe : DEFAULT_TICKER_WATCHLIST;

  return symbols.filter((symbol) => {
    if (search && !symbol.includes(search)) return false;
    const quote = tickerIntelState.quoteBySymbol[symbol];
    if (priceFilter !== "all" && getPriceBucket(quote) !== priceFilter) return false;
    if (signalFilter !== "all" && getSignalKeyForQuote(quote) !== signalFilter) return false;
    return true;
  });
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
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const signalPill = quote ? renderSignalPill(pct) : '<span class="signal-pill neutral">No Data</span>';
      const trendClass = !Number.isFinite(pct)
        ? "value-flat"
        : pct > 0
          ? "value-up"
          : pct < 0
            ? "value-down"
            : "value-flat";
      return `
      <button type="button" class="ticker-item ${symbol === selected ? "active" : ""}" data-ticker="${symbol}">
        <span class="ticker-item-top"><span class="ticker-item-symbol">${symbol}</span>${signalPill}</span>
        <span class="ticker-item-bottom">
          <span>${quote ? renderPriceCell(quote.close) : "-"}</span>
          <span class="${trendClass}">${formatPercent(pct)}</span>
        </span>
      </button>
    `;
    })
    .join("");

  const quote = report?.quote;
  const openDelta = quote ? getOpenDeltaPercent(quote) : null;
  const quoteSummary = quote
    ? `
      <section class="ticker-quote-grid">
        <article class="schwab-metric-card"><h4>Last</h4><div class="schwab-metric-value small">${renderPriceCell(
          quote.close
        )}</div></article>
        <article class="schwab-metric-card"><h4>Open Δ%</h4><div class="schwab-metric-value small ${
          openDelta > 0 ? "value-up" : openDelta < 0 ? "value-down" : "value-flat"
        }">${formatPercent(openDelta)}</div></article>
        <article class="schwab-metric-card"><h4>Range</h4><div class="schwab-metric-value small">${renderPriceCell(
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
          <span class="settings-desc">Confidence: ${escapeHtml(report.confidence || "medium")}</span>
        </div>
      </header>
      ${quoteSummary}
      <section class="ticker-report-grid">
        <article class="schwab-card"><h4>Bullish Case</h4><ul class="ticker-bullets">${renderListItems(
          report.bullishFactors
        )}</ul></article>
        <article class="schwab-card"><h4>Bearish Case</h4><ul class="ticker-bullets">${renderListItems(
          report.bearishFactors
        )}</ul></article>
        <article class="schwab-card"><h4>Neutral / Watch</h4><ul class="ticker-bullets">${renderListItems(
          report.neutralFactors
        )}</ul></article>
        <article class="schwab-card"><h4>Catalysts</h4><ul class="ticker-bullets">${renderListItems(
          report.catalystWatch
        )}</ul></article>
      </section>
      <section class="schwab-card">
        <h4>Risk Flags</h4>
        <ul class="ticker-bullets">${renderListItems(report.riskFlags)}</ul>
        <p class="schwab-card-sub">${escapeHtml(report.narrativeSummary || "")}</p>
      </section>
      <section class="schwab-card">
        <h4>Recent Headlines Used By AI</h4>
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
        <div class="ticker-filters">
          <input id="tickerSearchInput" class="trade-input" placeholder="Search symbol (e.g. AAPL)" value="${escapeHtml(
            tickerIntelState.search || ""
          )}" />
          <select id="tickerSignalFilter" class="trade-input">
            <option value="all" ${tickerIntelState.signalFilter === "all" ? "selected" : ""}>All Signals (${counts.total})</option>
            <option value="bullish" ${tickerIntelState.signalFilter === "bullish" ? "selected" : ""}>Bullish (${counts.signal.bullish})</option>
            <option value="bearish" ${tickerIntelState.signalFilter === "bearish" ? "selected" : ""}>Bearish (${counts.signal.bearish})</option>
            <option value="neutral" ${tickerIntelState.signalFilter === "neutral" ? "selected" : ""}>Neutral (${counts.signal.neutral})</option>
            <option value="no-data" ${tickerIntelState.signalFilter === "no-data" ? "selected" : ""}>No Data (${counts.signal["no-data"]})</option>
          </select>
          <select id="tickerPriceFilter" class="trade-input">
            <option value="all" ${tickerIntelState.priceFilter === "all" ? "selected" : ""}>All Prices (${counts.total})</option>
            <option value="under20" ${tickerIntelState.priceFilter === "under20" ? "selected" : ""}>Under $20 (${counts.price.under20})</option>
            <option value="20to100" ${tickerIntelState.priceFilter === "20to100" ? "selected" : ""}>$20 - $100 (${counts.price["20to100"]})</option>
            <option value="100to500" ${tickerIntelState.priceFilter === "100to500" ? "selected" : ""}>$100 - $500 (${counts.price["100to500"]})</option>
            <option value="500plus" ${tickerIntelState.priceFilter === "500plus" ? "selected" : ""}>$500+ (${counts.price["500plus"]})</option>
            <option value="unknown" ${tickerIntelState.priceFilter === "unknown" ? "selected" : ""}>No Price (${counts.price.unknown})</option>
          </select>
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
}

function getLinkedAccounts() {
  return Array.isArray(schwabData.accounts) ? schwabData.accounts : [];
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
  schwabData = { accounts: null, openOrders: null };
  updateSchwabChatBadge();
  openTabs.add(SCHWAB_CONNECT_TAB);
  activateTab(SCHWAB_CONNECT_TAB);
}

function buildEquityMarketOrder({ side, symbol, quantity }) {
  return {
    session: "NORMAL",
    duration: "DAY",
    orderType: "MARKET",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: side,
        quantity,
        instrument: {
          symbol,
          assetType: "EQUITY",
        },
      },
    ],
  };
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

    if (tabName !== HOME_TAB) {
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
  if (
    tabName === HOME_TAB ||
    tabName === INVESTMENTS_TAB ||
    tabName === TICKER_INTEL_TAB ||
    tabName === TIME_TAB ||
    !openTabs.has(tabName)
  )
    return;
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
      </section>

      <section class="schwab-grid">
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
            <select class="trade-input" id="tradeSide" ${isConnected ? "" : "disabled"}>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>

            <label class="trade-label">Symbol</label>
            <input class="trade-input" id="tradeSymbol" placeholder="AAPL" autocomplete="off" ${isConnected ? "" : "disabled"} />

            <label class="trade-label">Quantity</label>
            <input class="trade-input" id="tradeQty" type="number" min="1" step="1" value="1" ${isConnected ? "" : "disabled"} />

            <button type="submit" class="schwab-btn schwab-btn-primary" ${isConnected ? "" : "disabled"}>
              Submit Order
            </button>
          </form>
          <div class="trade-status" id="tradeTicketStatus"></div>
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

  const tradeForm = document.getElementById("tradeTicketForm");
  const tradeStatus = document.getElementById("tradeTicketStatus");
  if (tradeForm && tradeStatus) {
    tradeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!schwabSession.connected) return;

      const side = String(document.getElementById("tradeSide")?.value || "BUY").toUpperCase();
      const symbol = String(document.getElementById("tradeSymbol")?.value || "")
        .trim()
        .toUpperCase();
      const quantity = Number(document.getElementById("tradeQty")?.value || 0);

      if (!symbol) {
        tradeStatus.textContent = "Enter a valid symbol.";
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
      } catch (error) {
        tradeStatus.textContent = error.message || "Order submission failed.";
        tradeStatus.className = "trade-status error";
      }
    });
  }
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
    tabName !== "Settings" &&
    tabName !== INVESTMENTS_TAB &&
    tabName !== TICKER_INTEL_TAB &&
    tabName !== TIME_TAB
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
      : tabName === INVESTMENTS_TAB
        ? "Public market dashboard"
          : tabName === TICKER_INTEL_TAB
            ? "Ticker list + Gradient AI deep-dive"
        : tabName === TIME_TAB
          ? "Market open countdown + AI playbook"
      : tabName === "DigitalOcean"
        ? "Account & Droplets"
        : tabName === "Settings"
          ? "API token"
          : "Blank workspace";

  renderTabs(tabName);

  stopMarketCountdown();

  if (tabName === SCHWAB_CONNECT_TAB) {
    renderSchwabConnectView();
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
    if (!schwabSession.connected) {
      workspaceTableWrap.innerHTML = `
        <div class="do-error">
          <strong>Schwab Connection Required</strong>
          <p>Live stock prices in this tab use Charles Schwab market data. Connect Schwab to continue.</p>
        </div>
      `;
      return;
    }
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
  if (tabName === "DigitalOcean") {
    loadDoView();
    return;
  }
  if (tabName === "Settings") {
    renderSettingsView();
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
  if (currentTab === "DigitalOcean") {
    loadDoView();
    return;
  }
  const agent = AGENT_BY_TAB[currentTab];
  if (agent) {
    loadSchwabContextData().then(() => renderAgentView(agent));
  }
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

  await refreshSchwabSession();
  if (schwabSession.connected) {
    await loadSchwabContextData();
  }

  renderTabs(HOME_TAB);
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
  } else if (schwabFlag === "error") {
    appendChatMessage(
      "assistant",
      `Schwab login failed: ${schwabReason || "Unknown error."}`,
      "msg-error"
    );
  }
}

initApp();
