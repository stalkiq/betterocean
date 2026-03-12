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
const SEC_TAB = "SEC";
const SHOPPING_TAB = "Shopping";
const TICKER_DETAIL_TAB_PREFIX = "Ticker ";
const HOME_TAB = SCHWAB_CONNECT_TAB;
const SCHWAB_FUNDING_URL = "https://www.schwab.com/fund-your-account";
const TAB_THEME_CLASS_MAP = {
  [SCHWAB_CONNECT_TAB]: "theme-schwab",
  [PORTFOLIO_TAB]: "theme-holdings",
  [INVESTMENTS_TAB]: "theme-investments",
  [TICKER_INTEL_TAB]: "theme-ticker-intel",
  [TIME_TAB]: "theme-time",
  [SEC_TAB]: "theme-time",
  [SHOPPING_TAB]: "theme-shopping",
};
const RESPONSE_STYLE_PROMPT =
  "Reply in 3-6 concise bullet points with short, scannable lines. Keep spacing clean and avoid long paragraphs.";
const UI_PREFS_KEY = "bo_ui_prefs_v1";
const MARKET_TAB_TTL_MS = 90 * 1000;
const TICKER_REPORT_TTL_MS = 5 * 60 * 1000;
const TICKER_QUOTES_TTL_MS = 2 * 60 * 1000;
const WATCHBOARD_LAYOUT_TTL_MS = 10 * 60 * 1000;
const TICKER_LIVE_REFRESH_MS = 15000;
const TICKER_LIVE_SYMBOL_LIMIT = 40;
const TICKER_LIVE_PULSE_MS = 2200;
const TICKER_INITIAL_UNIVERSE_LIMIT = 220;
const TICKER_DEFAULT_VISIBLE_COUNT = 90;
const TICKER_VISIBLE_INCREMENT = 60;
const AGENT_BRIEF_TTL_MS = 3 * 60 * 1000;
const SEC_BRIEF_TAB_TTL_MS = 10 * 60 * 1000;

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

const openTabs = new Set([HOME_TAB, PORTFOLIO_TAB, INVESTMENTS_TAB, TICKER_INTEL_TAB, TIME_TAB, SEC_TAB]);
let currentTab = HOME_TAB;
let currentAgentId = AGENTS[0].id;
const announcedAgents = new Set();

let chatHistory = [];
let schwabSession = { connected: false };
let schwabData = { accounts: null, openOrders: null, accountError: "" };
let investmentsMarket = { assets: [], updatedAt: null, beginnerBrief: null };
let openingPlaybook = { buckets: [], asOf: null, agentBriefs: null };
let openingQuotesBySymbol = {};
let secTabState = {
  symbolsInput: "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,EXE,ADM",
  days: 180,
  category: "all",
  hiddenRowIds: {},
  offset: 0,
  limit: 120,
  hasMore: true,
  loadingMore: false,
  sheetScrollTop: 0,
  loading: false,
  error: "",
  rows: [],
  meta: null,
  fetchedAt: 0,
  cache: {},
  cacheAt: {},
};
const SEC_QUICK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "EXE", "ADM"];
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
  ADM: "Archer-Daniels-Midland Co.",
  EXE: "Expand Energy Corp",
  SNAP: "Snap",
  PARA: "Paramount Global",
  MMM: "3M",
  AOS: "A. O. Smith",
  ABT: "Abbott Laboratories",
  ABBV: "AbbVie",
  ACN: "Accenture",
  ADI: "Analog Devices",
  BG: "Bunge Global",
};
const COMPANY_SUCCESS_NOTES = {
  AAPL: "Apple sells devices and services with strong customer loyalty and recurring revenue.",
  MSFT: "Microsoft combines cloud software and enterprise tools used by businesses worldwide.",
  NVDA: "NVIDIA leads AI and graphics chips used across data centers, gaming, and computing.",
  AMZN: "Amazon pairs global e-commerce scale with cloud infrastructure through AWS.",
  GOOGL: "Alphabet monetizes search and digital ads while investing in long-term technology platforms.",
  META: "Meta operates large social platforms and ad systems with billions of daily users.",
  TSLA: "Tesla combines EV manufacturing, software updates, and energy products in one brand.",
  JPM: "JPMorgan is a diversified bank with strong consumer, investment, and asset management businesses.",
  XOM: "Exxon Mobil is an integrated energy company with global production and refining operations.",
  UNH: "UnitedHealth combines health insurance scale with care and data operations through Optum.",
  T: "AT&T provides wireless and fiber connectivity to large U.S. customer bases.",
  VZ: "Verizon runs a large telecom network with recurring subscription-based revenue.",
  INTC: "Intel designs and sells processors used in PCs, servers, and enterprise systems.",
  BAC: "Bank of America is a major U.S. bank with diversified consumer and business lines.",
  PFE: "Pfizer develops and commercializes medicines with global distribution and research depth.",
};
const ETF_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "XLF", "XLK", "XLE", "XLV", "XLI", "XLP", "XLY", "TLT", "GLD"];
const TECH_FOCUS_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AVGO", "AMD", "INTC", "QCOM", "TSM", "ADBE", "CRM", "ORCL", "META"];
const DIVIDEND_FOCUS_SYMBOLS = ["KO", "PEP", "PG", "JNJ", "XOM", "CVX", "T", "VZ", "PFE", "MCD", "WMT", "ABBV"];
const SYMBOL_SECTOR_HINTS = {
  AAPL: "Consumer Technology",
  MSFT: "Enterprise Software",
  NVDA: "Semiconductors",
  AMZN: "E-Commerce & Cloud",
  GOOGL: "Internet Services",
  META: "Social Platforms",
  TSLA: "Automotive & Energy",
  JPM: "Banking",
  BAC: "Banking",
  XOM: "Energy",
  UNH: "Healthcare",
  T: "Telecom",
  VZ: "Telecom",
  INTC: "Semiconductors",
  PFE: "Healthcare",
};
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
  watchboards: [],
  watchboardsSource: "fallback",
  watchboardsLoading: false,
  watchboardsError: "",
  watchboardsLoadedAt: 0,
  selectedWatchboardId: "morning-scanner",
  quotePulseBySymbol: {},
  compareSymbols: [],
  maxVisible: TICKER_DEFAULT_VISIBLE_COUNT,
};
let externalCompanyNamesBySymbol = {};

function applyTabTheme(tabName) {
  if (!appShell) return;
  const themeClasses = Object.values(TAB_THEME_CLASS_MAP);
  themeClasses.forEach((themeClass) => appShell.classList.remove(themeClass));
  const targetTab = isTickerDetailTab(tabName) ? TICKER_INTEL_TAB : tabName;
  const themeClass = TAB_THEME_CLASS_MAP[targetTab] || TAB_THEME_CLASS_MAP[SCHWAB_CONNECT_TAB];
  if (themeClass) appShell.classList.add(themeClass);
}
let shoppingState = {
  items: [],
  submitting: false,
  status: "",
  quoteBySymbol: {},
  quotesUpdatedAt: 0,
  loadingQuotes: false,
  executionStyle: "fast-fill",
  aiPlanByItem: {},
  executionByItem: {},
  lastExecutionResults: [],
  lastSubmittedAt: 0,
};
let portfolioAgentBriefState = {
  loading: false,
  data: null,
  error: "",
  fetchedAt: 0,
  lastKey: "",
};
let shoppingAgentBriefState = {
  loading: false,
  data: null,
  error: "",
  fetchedAt: 0,
  lastKey: "",
};
let marketCountdownTimer = null;
let marketOpenThemeTimer = null;
let tickerUniverseQuotesPromise = null;
let shoppingMarketClockTimer = null;
let tickerUniverseRequestId = 0;
let tickerReportRequestId = 0;
let investmentsLoadedAt = 0;
let openingPlaybookLoadedAt = 0;
let tickerIntelLiveRefreshTimer = null;
const tickerReportAutoRefreshTimers = new Map();

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
    beginnerBrief: data?.beginnerBrief || null,
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
    agentBriefs: data?.agentBriefs && typeof data.agentBriefs === "object" ? data.agentBriefs : null,
  };
  return openingPlaybook;
}

function normalizeSecSymbolsInput(raw) {
  return [...new Set(
    String(raw || "")
      .split(",")
      .map((s) => String(s || "").trim().toUpperCase())
      .filter(Boolean)
      .map((s) => s.replace(/[^A-Z.\-]/g, "").slice(0, 12))
      .filter(Boolean)
  )].slice(0, 25);
}

async function loadSecBrief(options = {}) {
  const {
    force = false,
    symbolsInput = secTabState.symbolsInput,
    days = secTabState.days,
    category = secTabState.category || "all",
    append = false,
    limit = secTabState.limit || 120,
  } = options;
  const symbols = normalizeSecSymbolsInput(symbolsInput);
  if (!symbols.length) throw new Error("At least one ticker symbol is required.");
  const safeDays = Math.max(7, Math.min(365, Number(days) || 180));
  const safeCategory = String(category || "all").trim().toLowerCase();
  const safeLimit = Math.max(20, Math.min(200, Number(limit) || 120));
  const nextOffset = append ? Math.max(0, Number(secTabState.offset || 0)) : 0;
  const cacheKey = `${symbols.join(",")}|${safeDays}|${safeCategory}|${safeLimit}|0`;
  const cached = secTabState.cache[cacheKey];
  const cachedAt = Number(secTabState.cacheAt[cacheKey] || 0);
  if (!append && !force && cached && Date.now() - cachedAt < SEC_BRIEF_TAB_TTL_MS) {
    secTabState = {
      ...secTabState,
      symbolsInput: symbols.join(","),
      days: safeDays,
      category: safeCategory,
      offset: Number(cached?.nextOffset || (Array.isArray(cached?.rows) ? cached.rows.length : 0)),
      hasMore: Boolean(cached?.hasMore),
      loading: false,
      error: "",
      rows: Array.isArray(cached?.rows) ? cached.rows : [],
      meta: cached,
      fetchedAt: cachedAt,
    };
    return cached;
  }
  const payload = await schwabApi(
    `/api/market/sec-grid?symbols=${encodeURIComponent(symbols.join(","))}&days=${safeDays}&limit=${safeLimit}&offset=${nextOffset}&category=${encodeURIComponent(
      safeCategory
    )}${force ? "&force=1" : ""}`,
    { method: "GET" }
  );
  const payloadRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const mergedRows = append
    ? [...(Array.isArray(secTabState.rows) ? secTabState.rows : []), ...payloadRows].filter(
        (row, index, arr) => index === arr.findIndex((entry) => entry.rowId === row.rowId)
      )
    : payloadRows;
  secTabState = {
    ...secTabState,
    symbolsInput: symbols.join(","),
    days: safeDays,
    category: safeCategory,
    offset: Number(payload?.nextOffset || (append ? nextOffset + payloadRows.length : payloadRows.length)),
    hasMore: Boolean(payload?.hasMore),
    loadingMore: false,
    loading: false,
    error: "",
    rows: mergedRows,
    meta: payload,
    fetchedAt: Date.now(),
    cache: append ? secTabState.cache : { ...secTabState.cache, [cacheKey]: { ...payload, rows: mergedRows } },
    cacheAt: append ? secTabState.cacheAt : { ...secTabState.cacheAt, [cacheKey]: Date.now() },
  };
  return payload;
}

async function loadTickerIntelReport(symbol, options = {}) {
  const { force = false, autoRefresh = true } = options;
  const safeSymbol = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!safeSymbol) throw new Error("Ticker symbol is required.");

  const cachedReport = tickerIntelState.reportCache[safeSymbol];
  const cachedAt = Number(tickerIntelState.reportCacheAt[safeSymbol] || 0);
  if (!force && cachedReport && Date.now() - cachedAt < TICKER_REPORT_TTL_MS) {
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
  const data = await schwabApi(
    `/api/market/ticker-report?symbol=${encodeURIComponent(safeSymbol)}${force ? "&force=1" : ""}`,
    {
    method: "GET",
    }
  );
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
  if (autoRefresh && data?.pending) {
    const timerId = tickerReportAutoRefreshTimers.get(safeSymbol);
    if (timerId) clearTimeout(timerId);
    const refreshInMs = Math.max(700, Number(data?.refreshHintMs || 1200));
    const nextTimer = setTimeout(() => {
      tickerReportAutoRefreshTimers.delete(safeSymbol);
      loadTickerIntelReport(safeSymbol, { force: true, autoRefresh: false })
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB && String(tickerIntelState.selected || "").toUpperCase() === safeSymbol) {
            renderTickerIntelView();
          }
        })
        .catch(() => ({}));
    }, refreshInMs);
    tickerReportAutoRefreshTimers.set(safeSymbol, nextTimer);
  }
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

function sanitizeWatchboardLayoutId(value, fallback = "custom-layout") {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw || fallback;
}

async function loadTickerWatchboards({ force = false } = {}) {
  const hasFresh =
    !force &&
    Array.isArray(tickerIntelState.watchboards) &&
    tickerIntelState.watchboards.length > 0 &&
    Date.now() - Number(tickerIntelState.watchboardsLoadedAt || 0) < WATCHBOARD_LAYOUT_TTL_MS;
  if (hasFresh) return tickerIntelState.watchboards;

  tickerIntelState = {
    ...tickerIntelState,
    watchboardsLoading: true,
    watchboardsError: "",
  };
  if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();

  try {
    const data = await schwabApi("/api/market/ticker-watchboards", { method: "GET" });
    const layouts = Array.isArray(data?.layouts)
      ? data.layouts
          .map((layout, index) => {
            const id = sanitizeWatchboardLayoutId(layout?.id || layout?.name, `layout-${index + 1}`);
            return {
              id,
              name: String(layout?.name || `Watchboard ${index + 1}`).trim(),
              description: String(layout?.description || "").trim(),
              universePreset: String(layout?.universePreset || "sp500").trim(),
              sortMode: String(layout?.sortMode || "best-now").trim(),
              signalFilter: String(layout?.signalFilter || "all").trim(),
              priceFilter: String(layout?.priceFilter || "all").trim(),
              searchHint: String(layout?.searchHint || "").trim(),
              focusSymbols: Array.isArray(layout?.focusSymbols)
                ? layout.focusSymbols
                    .map((s) => String(s || "").trim().toUpperCase())
                    .filter(Boolean)
                    .slice(0, 8)
                : [],
            };
          })
          .filter((layout) => layout.name)
      : [];
    const fallbackLayouts = [
      {
        id: "morning-scanner",
        name: "Morning Scanner",
        description: "Fast opening-move board with liquid names and active price action.",
        universePreset: "big-movers",
        sortMode: "big-movers",
        signalFilter: "all",
        priceFilter: "all",
        searchHint: "",
        focusSymbols: [],
      },
    ];
    const nextLayouts = layouts.length ? layouts : fallbackLayouts;
    const nextSelected = nextLayouts.some((layout) => layout.id === tickerIntelState.selectedWatchboardId)
      ? tickerIntelState.selectedWatchboardId
      : nextLayouts[0].id;
    tickerIntelState = {
      ...tickerIntelState,
      watchboards: nextLayouts,
      watchboardsSource: String(data?.source || "fallback"),
      watchboardsLoading: false,
      watchboardsError: "",
      watchboardsLoadedAt: Date.now(),
      selectedWatchboardId: nextSelected,
    };
    return nextLayouts;
  } catch (error) {
    tickerIntelState = {
      ...tickerIntelState,
      watchboardsLoading: false,
      watchboardsError: error?.message || "Failed to load watchboard layouts.",
    };
    if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
    return tickerIntelState.watchboards;
  }
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
  const lowered = raw.toLowerCase();
  if (lowered === "undefined" || lowered === "null" || lowered === "n/a" || lowered === "na") return "";
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

function isResolvedCompanyName(symbol, rawName) {
  const safeSymbol = String(symbol || "").toUpperCase();
  const clean = normalizeCompanyLabel(rawName || "", safeSymbol);
  if (!clean) return false;
  if (clean.toUpperCase() === safeSymbol) return false;
  if (/^\w+\s+Company$/i.test(clean)) return false;
  return true;
}

async function hydrateCompanyNamesForQuotes(quotes) {
  const list = Array.isArray(quotes) ? quotes : [];
  const missing = [...new Set(
    list
      .map((quote) => String(quote?.symbol || "").toUpperCase())
      .filter(Boolean)
      .filter((symbol) => {
        if (isResolvedCompanyName(symbol, quoteBySymbolLookup(symbol, list)?.companyName)) return false;
        if (isResolvedCompanyName(symbol, externalCompanyNamesBySymbol[symbol])) return false;
        return true;
      })
  )];
  if (missing.length) {
    try {
      const payload = await schwabApi(`/api/market/company-names?symbols=${encodeURIComponent(missing.join(","))}`, {
        method: "GET",
      });
      const names = payload && typeof payload.names === "object" ? payload.names : {};
      externalCompanyNamesBySymbol = { ...externalCompanyNamesBySymbol, ...names };
    } catch {
      // Non-fatal: we keep existing fallback naming behavior.
    }
  }
  return list.map((quote) => {
    const symbol = String(quote?.symbol || "").toUpperCase();
    if (!symbol) return quote;
    const external = String(externalCompanyNamesBySymbol[symbol] || "").trim();
    if (!isResolvedCompanyName(symbol, external)) return quote;
    if (isResolvedCompanyName(symbol, quote?.companyName || quote?.label || "")) return quote;
    return {
      ...quote,
      companyName: external,
      label: external,
    };
  });
}

function quoteBySymbolLookup(symbol, list) {
  const safe = String(symbol || "").toUpperCase();
  return (Array.isArray(list) ? list : []).find((item) => String(item?.symbol || "").toUpperCase() === safe) || null;
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
  const fromExternal = normalizeCompanyLabel(externalCompanyNamesBySymbol[safeSymbol] || "", safeSymbol);
  if (fromExternal) return fromExternal;
  return SYMBOL_COMPANY_NAMES[safeSymbol] || safeSymbol;
}

function getTickerCardCompanyLine(symbol, quote = null) {
  const safeSymbol = String(symbol || "").toUpperCase();
  const companyName = getCompanyName(safeSymbol, quote);
  if (!companyName || String(companyName).toUpperCase() === safeSymbol) {
    return SYMBOL_COMPANY_NAMES[safeSymbol] || `${safeSymbol} Company`;
  }
  return companyName;
}

function getCompanySuccessNote(symbol) {
  const safeSymbol = String(symbol || "").toUpperCase();
  return (
    COMPANY_SUCCESS_NOTES[safeSymbol] ||
    `${getCompanyName(safeSymbol)} is a public company many investors follow for size, brand, and market relevance.`
  );
}

function isTickerDetailTab(tabName) {
  return String(tabName || "").startsWith(TICKER_DETAIL_TAB_PREFIX);
}

function getTickerSymbolFromDetailTab(tabName) {
  return String(tabName || "")
    .replace(TICKER_DETAIL_TAB_PREFIX, "")
    .trim()
    .toUpperCase();
}

function getTickerDetailTabName(symbol) {
  return `${TICKER_DETAIL_TAB_PREFIX}${String(symbol || "").trim().toUpperCase()}`;
}

function normalizeUnifiedQuote(input, symbolHint = "") {
  const quote = input?.quote && typeof input.quote === "object" ? input.quote : input || {};
  const reference = input?.reference && typeof input.reference === "object" ? input.reference : {};
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
  const volume = toFiniteNumber(
    quote?.totalVolume,
    quote?.totalVolumeTraded,
    quote?.regularMarketTradeVolume,
    quote?.volume,
    input?.volume
  );
  const marketCap = toFiniteNumber(
    quote?.marketCap,
    reference?.marketCap,
    input?.marketCap,
    reference?.fundamental?.marketCap
  );
  const sector =
    normalizeCompanyLabel(
      reference?.sector ||
        reference?.sectorName ||
        input?.sector ||
        quote?.sector ||
        reference?.fundamental?.sector ||
        "",
      ""
    ) || "";
  const bid = toFiniteNumber(quote?.bidPrice, quote?.bid, input?.bid);
  const ask = toFiniteNumber(quote?.askPrice, quote?.ask, input?.ask);
  const previousClose = toFiniteNumber(quote?.previousClosePrice, quote?.previousClose, input?.previousClose);
  const vwap = toFiniteNumber(quote?.vwap, quote?.vwap, input?.vwap);
  const week52High = toFiniteNumber(
    quote?.week52High,
    quote?.fiftyTwoWeekHigh,
    quote?.high52,
    quote?.yearHigh,
    input?.week52High,
    input?.fiftyTwoWeekHigh
  );
  const week52Low = toFiniteNumber(
    quote?.week52Low,
    quote?.fiftyTwoWeekLow,
    quote?.low52,
    quote?.yearLow,
    input?.week52Low,
    input?.fiftyTwoWeekLow
  );
  const tradeTime =
    input?.quoteTime ||
    input?.tradeTime ||
    quote?.quoteTime ||
    quote?.tradeTime ||
    quote?.lastTradeTime ||
    null;
  const dataSource = String(input?.__source || input?.source || "unknown").toLowerCase();
  if (!Number.isFinite(close) || close <= 0) {
    return {
      symbol,
      label: companyName,
      companyName,
      unavailable: true,
      volume: null,
      marketCap: null,
      sector,
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      previousClose: Number.isFinite(previousClose) ? previousClose : null,
      vwap: Number.isFinite(vwap) ? vwap : null,
      week52High: Number.isFinite(week52High) ? week52High : null,
      week52Low: Number.isFinite(week52Low) ? week52Low : null,
      tradeTime,
      dataSource,
    };
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
    volume: Number.isFinite(volume) ? volume : null,
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    sector,
    bid: Number.isFinite(bid) ? bid : null,
    ask: Number.isFinite(ask) ? ask : null,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    vwap: Number.isFinite(vwap) ? vwap : null,
    week52High: Number.isFinite(week52High) ? week52High : null,
    week52Low: Number.isFinite(week52Low) ? week52Low : null,
    tradeTime,
    dataSource,
  };
}

function parseSchwabQuotesPayload(payload, requestedSymbols) {
  const requested = [...new Set((requestedSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean))];
  const bySymbol = {};

  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.quotes)) {
      payload.quotes.forEach((entry) => {
        const normalized = normalizeUnifiedQuote({ ...(entry || {}), __source: "schwab" });
        if (normalized?.symbol) bySymbol[normalized.symbol] = normalized;
      });
    } else {
      Object.entries(payload).forEach(([symbolKey, entry]) => {
        const normalized = normalizeUnifiedQuote({ ...(entry || {}), __source: "schwab" }, symbolKey);
        if (normalized?.symbol) bySymbol[normalized.symbol] = normalized;
      });
    }
  }

  return requested.map((symbol) => bySymbol[symbol] || { symbol, label: symbol, unavailable: true, __source: "schwab" });
}

async function fetchTickerQuoteBatch(symbols) {
  const requested = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  if (!requested.length) return [];

  if (schwabSession.connected) {
    try {
      const schwabPayload = await schwabApi(
        `/api/schwab/quotes?symbols=${encodeURIComponent(requested.join(","))}&fields=quote,reference`,
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
          .map((q) => normalizeUnifiedQuote({ ...q, __source: "public" }))
          .filter((q) => Boolean(q?.symbol))
          .map((q) => [q.symbol, q])
      );

      const merged = schwabQuotes.map((q) => (q?.unavailable && publicBySymbol[q.symbol] ? publicBySymbol[q.symbol] : q));
      return hydrateCompanyNamesForQuotes(merged);
    } catch {
      // Fallback to public feed when Schwab quote request fails.
    }
  }

  const publicData = await schwabApi(`/api/market/quotes?symbols=${encodeURIComponent(requested.join(","))}`, {
    method: "GET",
  });
  const publicQuotes = Array.isArray(publicData.quotes) ? publicData.quotes.map((q) => ({ ...q, __source: "public" })) : [];
  return hydrateCompanyNamesForQuotes(publicQuotes);
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

function renderTickerMiniSparkline(quote) {
  if (!quote || quote.unavailable) return '<span class="ticker-sparkline-empty">-</span>';
  const open = Number(quote.open);
  const high = Number(quote.high);
  const low = Number(quote.low);
  const close = Number(quote.close);
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) {
    return '<span class="ticker-sparkline-empty">-</span>';
  }
  const values = [open, (open + high) / 2, high, (close + low) / 2, close];
  const width = 78;
  const height = 18;
  const pad = 2;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.0001, max - min);
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = pad + step * index;
      const y = pad + ((max - value) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const closeX = pad + step * (values.length - 1);
  const closeY = pad + ((max - close) / range) * (height - pad * 2);
  return `
    <svg class="ticker-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="ticker-sparkline-line" points="${points}" />
      <circle class="ticker-sparkline-dot" cx="${closeX.toFixed(1)}" cy="${closeY.toFixed(1)}" r="1.8"></circle>
    </svg>
  `;
}

function getTickerPulseClass(symbol) {
  const pulse = tickerIntelState.quotePulseBySymbol[String(symbol || "").toUpperCase()];
  if (!pulse || !pulse.at) return "";
  if (Date.now() - Number(pulse.at) > TICKER_LIVE_PULSE_MS) return "";
  return pulse.direction === "down" ? "live-down" : "live-up";
}

async function refreshTickerLiveQuotes({ rerender = true } = {}) {
  const symbols = getFilteredTickerUniverse().slice(0, TICKER_LIVE_SYMBOL_LIMIT);
  if (!symbols.length) return;
  try {
    const quotes = await fetchTickerQuoteBatch(symbols);
    const bySymbol = { ...tickerIntelState.quoteBySymbol };
    const pulseBySymbol = { ...tickerIntelState.quotePulseBySymbol };
    const now = Date.now();
    quotes.forEach((rawQuote) => {
      const nextQuote = normalizeUnifiedQuote(rawQuote);
      if (!nextQuote?.symbol) return;
      const prevQuote = bySymbol[nextQuote.symbol];
      bySymbol[nextQuote.symbol] = nextQuote;
      const prevClose = Number(prevQuote?.close);
      const nextClose = Number(nextQuote.close);
      if (Number.isFinite(prevClose) && Number.isFinite(nextClose) && Math.abs(nextClose - prevClose) >= 0.005) {
        pulseBySymbol[nextQuote.symbol] = {
          direction: nextClose >= prevClose ? "up" : "down",
          at: now,
        };
      }
    });
    tickerIntelState = {
      ...tickerIntelState,
      quoteBySymbol: bySymbol,
      quotePulseBySymbol: pulseBySymbol,
      quotesUpdatedAt: now,
    };
    if (rerender && currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
  } catch {
    // Keep silent during background live refresh.
  }
}

function stopTickerIntelLiveRefresh() {
  if (tickerIntelLiveRefreshTimer) {
    clearInterval(tickerIntelLiveRefreshTimer);
    tickerIntelLiveRefreshTimer = null;
  }
  tickerReportAutoRefreshTimers.forEach((timerId) => clearTimeout(timerId));
  tickerReportAutoRefreshTimers.clear();
}

function startTickerIntelLiveRefresh() {
  stopTickerIntelLiveRefresh();
  refreshTickerLiveQuotes({ rerender: true }).catch(() => ({}));
  tickerIntelLiveRefreshTimer = setInterval(() => {
    if (currentTab !== TICKER_INTEL_TAB) {
      stopTickerIntelLiveRefresh();
      return;
    }
    refreshTickerLiveQuotes({ rerender: true }).catch(() => ({}));
  }, TICKER_LIVE_REFRESH_MS);
}

async function refreshTickerUniverseQuotes({ rerender = true, force = false } = {}) {
  if (tickerUniverseQuotesPromise && !force) {
    return tickerUniverseQuotesPromise;
  }

  const universeSymbols = tickerIntelState.universe.length ? tickerIntelState.universe : DEFAULT_TICKER_WATCHLIST;
  const desiredLoadCount = Math.max(
    TICKER_INITIAL_UNIVERSE_LIMIT,
    Number(tickerIntelState.maxVisible || TICKER_DEFAULT_VISIBLE_COUNT) + 80
  );
  const symbols = universeSymbols.slice(0, Math.min(universeSymbols.length, desiredLoadCount));
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
        const shouldPaintThisChunk = loaded === symbols.length || loaded % 100 === 0;
        if (shouldPaintThisChunk && rerender && currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
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
  const hasBuy = shoppingState.items.some((item) => {
    const plan = shoppingState.aiPlanByItem?.[item.id];
    const side = String(plan?.side || item?.side || "BUY").toUpperCase();
    return side === "BUY";
  });
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
      const hasBuy = shoppingState.items.some((item) => {
        const plan = shoppingState.aiPlanByItem?.[item.id];
        const side = String(plan?.side || item?.side || "BUY").toUpperCase();
        return side === "BUY";
      });
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

function getCartEstimatedBuyCost() {
  const items = Array.isArray(shoppingState.items) ? shoppingState.items : [];
  let estimated = 0;
  let unresolvedCount = 0;
  for (const item of items) {
    const plan = shoppingState.aiPlanByItem?.[item.id];
    const side = String(plan?.side || item?.side || "BUY").toUpperCase();
    if (side !== "BUY") continue;
    const qty = Math.max(0, Number(item?.quantity || 0));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const symbol = String(item?.symbol || "").toUpperCase();
    const quote = shoppingState.quoteBySymbol?.[symbol];
    const quotePrice = Number(quote?.close);
    const limitPrice = Number(plan?.limitPrice ?? item?.limitPrice);
    const stopPrice = Number(plan?.stopPrice ?? item?.stopPrice);
    const orderType = String(plan?.orderType || item?.orderType || "MARKET").toUpperCase();
    let unitPrice = quotePrice;
    if (orderType === "LIMIT" || orderType === "STOP_LIMIT") {
      unitPrice = Number.isFinite(limitPrice) && limitPrice > 0 ? limitPrice : quotePrice;
    } else if (orderType === "STOP") {
      unitPrice = Number.isFinite(stopPrice) && stopPrice > 0 ? stopPrice : quotePrice;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      unresolvedCount += 1;
      continue;
    }
    estimated += qty * unitPrice;
  }
  return { estimatedCost: estimated, unresolvedCount };
}

function getShoppingFundingSnapshot() {
  const accounts = getLinkedAccounts();
  const availableToTrade = accounts.reduce((sum, account) => {
    const balances = account?.securitiesAccount?.currentBalances || {};
    const value = pickFirstFiniteNumber(balances, [
      "cashAvailableForTrading",
      "availableFunds",
      "availableFundsNonMarginableTrade",
      "buyingPower",
      "cashBalance",
    ]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const investedAmount = accounts.reduce((sum, account) => {
    const balances = account?.securitiesAccount?.currentBalances || {};
    const value = pickFirstFiniteNumber(balances, ["longMarketValue", "marketValue", "liquidationValue"]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const { estimatedCost, unresolvedCount } = getCartEstimatedBuyCost();
  const remainingAfterCart = availableToTrade - estimatedCost;
  return {
    accountCount: accounts.length,
    availableToTrade,
    investedAmount,
    cartEstimatedCost: estimatedCost,
    unresolvedCount,
    remainingAfterCart,
    cartOverage: Math.max(0, -remainingAfterCart),
  };
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
  if (!Number.isFinite(pct)) return { label: "No data", text: "No data", className: "neutral" };
  if (pct >= 0.4) return { label: "Up today", text: "Up today", className: pct >= 2 ? "bull-strong" : "bull" };
  if (pct <= -0.4) return { label: "Down today", text: "Down today", className: pct <= -2 ? "bear-strong" : "bear" };
  return { label: "Flat", text: "Flat", className: "neutral" };
}

function getMarketCapBucket(symbol, quote) {
  const marketCap = Number(quote?.marketCap || 0);
  if (!Number.isFinite(marketCap) || marketCap <= 0) {
    const safeSymbol = String(symbol || "").toUpperCase();
    if (["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "UNH", "SPY", "QQQ"].includes(safeSymbol)) {
      return "Large cap";
    }
    return null;
  }
  if (marketCap >= 200_000_000_000) return "Large cap";
  if (marketCap >= 10_000_000_000) return "Mid cap";
  return "Small cap";
}

function getCompanyTypeLabel(symbol, quote, report = null) {
  const safeSymbol = String(symbol || "").toUpperCase();
  if (ETF_SYMBOLS.includes(safeSymbol)) return "ETF";
  const profileDescription = normalizeCompanyLabel(report?.companyProfile?.description || "", "");
  if (profileDescription) return profileDescription;
  const fromQuote = normalizeCompanyLabel(quote?.sector || "", "");
  if (fromQuote) return fromQuote;
  return SYMBOL_SECTOR_HINTS[safeSymbol] || "";
}

function toPlainCompanySnapshot(symbol, quote, report = null) {
  const fromProfile = String(report?.companyProfile?.summary || "").trim();
  if (fromProfile) return fromProfile;
  const fromOverview = String(report?.overview || "").trim();
  if (fromOverview) return fromOverview;
  return `${getCompanyName(symbol, quote)} in focus; AI summary uses market data and latest headlines.`;
}

function getTickerCatalystTags(symbol, report, quote) {
  const tags = [];
  const news = Array.isArray(report?.newsUsed) ? report.newsUsed : [];
  if (news.some((item) => looksLikeEarningsToday(item?.title))) tags.push("Earnings");
  if (news.some((item) => looksLikeBigNews(item?.title))) tags.push("Big news");
  if (Number(Math.abs(getOpenDeltaPercent(quote) || 0)) >= 1.5) tags.push("Momentum");
  if (Array.isArray(report?.catalystWatch) && report.catalystWatch.length) tags.push("Catalyst");
  if (!tags.length) tags.push("Steady");
  return [...new Set(tags)].slice(0, 2);
}

function renderPriceLocationBar(quote) {
  const low = Number(quote?.low);
  const high = Number(quote?.high);
  const close = Number(quote?.close);
  if (![low, high, close].every((v) => Number.isFinite(v)) || high <= low) {
    return '<span class="ticker-loc-empty">Range N/A</span>';
  }
  const pct = Math.max(0, Math.min(100, ((close - low) / (high - low)) * 100));
  return `
    <span class="ticker-loc-wrap" title="Current location in today's range">
      <span class="ticker-loc-track"><span class="ticker-loc-dot" style="left:${pct.toFixed(1)}%"></span></span>
    </span>
  `;
}

function getDataQualityLabel(quote) {
  const src = String(quote?.dataSource || "").toLowerCase();
  if (src === "schwab") return "Live";
  if (src === "public") return "Delayed";
  return "Fallback";
}

function getTickerDataSourceLabel(quote) {
  const src = String(quote?.dataSource || "").toLowerCase();
  if (src === "schwab") return "Schwab API";
  if (src === "public") return "Public feed";
  return "Fallback feed";
}

function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function getQuoteFieldCoverage(quote) {
  const checks = [
    { key: "close", label: "last" },
    { key: "open", label: "open" },
    { key: "high", label: "high" },
    { key: "low", label: "low" },
    { key: "volume", label: "volume" },
    { key: "bid", label: "bid" },
    { key: "ask", label: "ask" },
    { key: "vwap", label: "vwap" },
    { key: "previousClose", label: "prev close" },
  ];
  const present = checks.filter((item) => Number.isFinite(Number(quote?.[item.key])));
  const missing = checks.filter((item) => !Number.isFinite(Number(quote?.[item.key]))).map((item) => item.label);
  const score = Math.round((present.length / checks.length) * 100);
  return { score, missing };
}

function getAiConfidenceScore(report) {
  const c = String(report?.confidence || "").toLowerCase();
  if (c === "high") return 85;
  if (c === "medium") return 68;
  if (c === "low") return 45;
  return 35;
}

function getGradientNowNext(report, quote) {
  const pct = getOpenDeltaPercent(quote);
  const topHeadline = String(report?.newsUsed?.[0]?.title || "").trim();
  const catalyst = String(
    (Array.isArray(report?.catalystWatch) && report.catalystWatch[0]) ||
      (Array.isArray(report?.gradientSuggestion?.bullets) && report.gradientSuggestion.bullets[0]) ||
      ""
  ).trim();
  const nowBase = Number.isFinite(pct)
    ? `Price is ${formatPercent(pct)} vs open with ${formatCompactNumber(quote?.volume)} volume.`
    : "Price move is still unclear right now.";
  const now = topHeadline ? `${nowBase} Headline: ${topHeadline}` : nowBase;
  const next = catalyst || "Watch for a clear break of today's range before adding risk.";
  return { now, next };
}

function getNewsNoiseScore(symbol) {
  const report = tickerIntelState.reportCache[symbol];
  const headlines = Array.isArray(report?.newsUsed) ? report.newsUsed : [];
  const loud = headlines.filter((h) => looksLikeBigNews(h?.title)).length;
  return Math.min(10, loud * 2 + Math.max(0, headlines.length - 3));
}

function getSmartSetupScore(symbol, quote) {
  const move = Math.abs(Number(getOpenDeltaPercent(quote) || 0));
  const liquidity = Number(quote?.volume || 0);
  const liquidityScore = liquidity > 20_000_000 ? 30 : liquidity > 5_000_000 ? 20 : liquidity > 1_000_000 ? 10 : 4;
  const moveScore = move >= 2.5 ? 24 : move >= 1 ? 18 : move >= 0.4 ? 12 : 6;
  const convictionScore = Math.max(0, getTickerRankingScore(symbol, quote)) * 0.45;
  const noisePenalty = getNewsNoiseScore(symbol) * 1.8;
  return liquidityScore + moveScore + convictionScore - noisePenalty;
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

function getNewsImpactDirection(title, reportSignal = "neutral") {
  const text = String(title || "").toLowerCase();
  if (/beat|record|surge|upgrade|partnership|contract win|approval|expansion|buyback/.test(text)) return "Likely positive";
  if (/miss|cuts|downgrade|lawsuit|probe|layoff|recall|delay|resign|guidance cut/.test(text)) return "Likely negative";
  if (String(reportSignal || "").toLowerCase() === "bullish") return "Slightly positive";
  if (String(reportSignal || "").toLowerCase() === "bearish") return "Slightly negative";
  return "Unclear";
}

function getNewsImpactWhy(title) {
  const text = String(title || "").toLowerCase();
  if (/earnings|quarter|guidance/.test(text)) return "Earnings headlines can shift expectations for future profits.";
  if (/ceo|executive|leadership/.test(text)) return "Leadership changes can affect confidence in company strategy.";
  if (/partnership|contract|deal/.test(text)) return "New deals can increase future sales and market reach.";
  if (/lawsuit|probe|investigation|regulator/.test(text)) return "Legal or regulatory risk can raise uncertainty.";
  if (/product|launch|approval|drug|fda/.test(text)) return "Product updates can change growth expectations.";
  return "News sentiment can influence short-term buying and selling pressure.";
}

function formatNewsTime(value) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "Recent";
  return new Date(ms).toLocaleString();
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
    maxVisible: TICKER_DEFAULT_VISIBLE_COUNT,
  };
}

function applyTickerWatchboardLayout(layoutId, { refreshQuotes = true } = {}) {
  const safeId = sanitizeWatchboardLayoutId(layoutId, "");
  if (!safeId) return;
  const layout = (tickerIntelState.watchboards || []).find((item) => item.id === safeId);
  if (!layout) return;
  const nextPreset = String(layout.universePreset || "sp500");
  applyUniversePreset(nextPreset);
  const nextSelected =
    Array.isArray(layout.focusSymbols) && layout.focusSymbols.length
      ? layout.focusSymbols.find((symbol) => tickerIntelState.universe.includes(symbol)) || tickerIntelState.selected
      : tickerIntelState.selected;
  tickerIntelState = {
    ...tickerIntelState,
    selectedWatchboardId: safeId,
    signalFilter: layout.signalFilter || "all",
    priceFilter: layout.priceFilter || "all",
    sortMode: layout.sortMode || "best-now",
    search: layout.searchHint || "",
    selected: nextSelected || tickerIntelState.selected,
    loadingUniverse: refreshQuotes,
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
    const quote = tickerIntelState.quoteBySymbol[symbol];
    const companyName = getCompanyName(symbol, quote).toUpperCase();
    if (search && !symbol.includes(search) && !companyName.includes(search)) return false;
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
      getSmartSetupScore(b, tickerIntelState.quoteBySymbol[b]) -
      getSmartSetupScore(a, tickerIntelState.quoteBySymbol[a])
  );
}

function getTickerFilterCounts() {
  const search = String(tickerIntelState.search || "")
    .trim()
    .toUpperCase();
  const symbols = tickerIntelState.universe.length ? tickerIntelState.universe : DEFAULT_TICKER_WATCHLIST;
  const scoped = symbols.filter((symbol) => {
    if (!search) return true;
    const quote = tickerIntelState.quoteBySymbol[symbol];
    const companyName = getCompanyName(symbol, quote).toUpperCase();
    return symbol.includes(search) || companyName.includes(search);
  });
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
  const filtered = getFilteredTickerUniverse();
  const maxVisible = Math.max(TICKER_DEFAULT_VISIBLE_COUNT, Number(tickerIntelState.maxVisible || TICKER_DEFAULT_VISIBLE_COUNT));
  const visibleSymbols = filtered.slice(0, maxVisible);
  const counts = getTickerFilterCounts();
  const watchlistHtml = visibleSymbols
    .map((symbol) => {
      const quote = tickerIntelState.quoteBySymbol[symbol];
      const report = tickerIntelState.reportCache[symbol] || null;
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const companyLine = getTickerCardCompanyLine(symbol, quote);
      const signal = getSignalFromDelta(pct);
      const livePulseClass = getTickerPulseClass(symbol);
      const companyType = getCompanyTypeLabel(symbol, quote, report);
      const marketCapBucket = getMarketCapBucket(symbol, quote);
      const snapshot = toPlainCompanySnapshot(symbol, quote, report);
      const catalysts = getTickerCatalystTags(symbol, report, quote);
      const dataQuality = getDataQualityLabel(quote);
      const isCompared = Array.isArray(tickerIntelState.compareSymbols)
        ? tickerIntelState.compareSymbols.includes(symbol)
        : false;
      const companyMetaLine = [companyType, marketCapBucket].filter(Boolean).join(" - ");
      return `
      <div class="ticker-item ${symbol === selected ? "active" : ""} ${livePulseClass}" data-ticker="${symbol}" role="button" tabindex="0">
        <span class="ticker-item-top">
          <span class="ticker-item-symbol">${symbol} - ${escapeHtml(companyLine)}</span>
          <span>${escapeHtml(signal.label)}</span>
        </span>
        ${companyMetaLine ? `<span class="ticker-item-company">${escapeHtml(companyMetaLine)}</span>` : ""}
        <span class="ticker-item-snapshot">${escapeHtml(snapshot)}</span>
        <span class="ticker-meta-inline">
          ${catalysts.map((tag) => `<span class="ticker-catalyst-chip">${escapeHtml(tag)}</span>`).join("")}
          <span class="ticker-data-quality">${escapeHtml(dataQuality)}</span>
        </span>
        <span class="ticker-item-bottom">
          <span class="ticker-item-price">${quote ? renderPriceCell(quote.close) : "-"}</span>
          <span class="ticker-item-sparkline">${renderTickerMiniSparkline(quote)}</span>
          <span class="ticker-item-loc">${renderPriceLocationBar(quote)}</span>
          <span>${formatPercent(pct)}</span>
        </span>
        <span class="ticker-item-actions">
          <button type="button" class="ticker-compare-btn ${isCompared ? "active" : ""}" data-compare-ticker="${symbol}">
            ${isCompared ? "Compared" : "Compare"}
          </button>
        </span>
      </div>
    `;
    })
    .join("");
  const watchboards = Array.isArray(tickerIntelState.watchboards) ? tickerIntelState.watchboards : [];
  const watchboardButtonsHtml = watchboards
    .slice(0, 6)
    .map((layout) => {
      const isActive = layout.id === tickerIntelState.selectedWatchboardId;
      return `
        <button type="button" class="watchboard-chip ${isActive ? "active" : ""}" data-watchboard-id="${escapeHtml(layout.id)}" title="${escapeHtml(
          layout.description || layout.name
        )}">
          ${escapeHtml(layout.name)}
        </button>
      `;
    })
    .join("");

  const selectedQuote = tickerIntelState.quoteBySymbol[selected];
  const selectedCompany = getCompanyName(selected, selectedQuote);
  const selectedCompanyType = getCompanyTypeLabel(selected, selectedQuote, tickerIntelState.reportCache[selected] || null);
  const selectedDataQuality = getDataQualityLabel(selectedQuote);
  const selectedSourceLabel = getTickerDataSourceLabel(selectedQuote);
  const selectedMarketCap = getMarketCapBucket(selected, selectedQuote);
  const selectedPct = selectedQuote ? getOpenDeltaPercent(selectedQuote) : null;
  const selectedReport = tickerIntelState.reportCache[selected] || null;
  const reportLoading = tickerIntelState.loading && tickerIntelState.selected === selected;
  const reportError = tickerIntelState.error || "";
  const companyExplainer = String(
    selectedReport?.companyProfile?.summary ||
      selectedReport?.overview ||
      selectedReport?.narrativeSummary ||
      `${selectedCompany || selected} likely sells products or services in its core industry, with demand driven by news and earnings.`
  ).trim();
  const profileSource = String(selectedReport?.companyProfile?.source || "gradient-best-effort").trim();
  const profileUpdatedAt = String(selectedReport?.companyProfile?.updatedAt || selectedReport?.asOf || "").trim();
  const quoteUpdatedAt = tickerIntelState.quotesUpdatedAt ? formatNewsTime(tickerIntelState.quotesUpdatedAt) : "n/a";
  const marketStatusText = isUsMarketOpenNow() ? "Market Open" : "Market Closed";
  const spreadValue =
    Number.isFinite(Number(selectedQuote?.bid)) && Number.isFinite(Number(selectedQuote?.ask))
      ? Number(selectedQuote.ask) - Number(selectedQuote.bid)
      : null;
  const fieldCoverage = getQuoteFieldCoverage(selectedQuote);
  const aiConfidenceScore = getAiConfidenceScore(selectedReport);
  const nowNext = getGradientNowNext(selectedReport, selectedQuote);
  const missingTapeFields = fieldCoverage.missing.length ? fieldCoverage.missing.slice(0, 4).join(", ") : "";
  const gradientSuggestion = selectedReport?.gradientSuggestion || null;
  const companyExplainerBullets = Array.isArray(selectedReport?.companyExplainer?.bullets)
    ? selectedReport.companyExplainer.bullets.filter(Boolean).slice(0, 3)
    : [];
  const workspaceTitle = String(
    selectedReport?.companyExplainer?.companyName || selectedReport?.companyProfile?.name || selectedCompany || selected
  ).trim();
  const workspaceSubtitleRaw = String(
    selectedReport?.companyExplainer?.oneLiner ||
      companyExplainerBullets[0] ||
      selectedReport?.companyProfile?.summary ||
      companyExplainer
  ).trim();
  const workspaceSubtitle = workspaceSubtitleRaw.replace(/^what they do:\s*/i, "");
  const agentPanels = selectedReport?.agentPanels && typeof selectedReport.agentPanels === "object" ? selectedReport.agentPanels : null;
  const companyAgentBullets = Array.isArray(agentPanels?.company) ? agentPanels.company.filter(Boolean).slice(0, 3) : [];
  const catalystAgentBullets = Array.isArray(agentPanels?.catalyst) ? agentPanels.catalyst.filter(Boolean).slice(0, 3) : [];
  const riskAgentBullets = Array.isArray(agentPanels?.risk) ? agentPanels.risk.filter(Boolean).slice(0, 3) : [];
  const whyToday = [
    ...(Array.isArray(selectedReport?.catalystWatch) ? selectedReport.catalystWatch.slice(0, 2) : []),
    ...(Array.isArray(selectedReport?.bullishFactors) ? selectedReport.bullishFactors.slice(0, 1) : []),
    ...(Array.isArray(selectedReport?.bearishFactors) ? selectedReport.bearishFactors.slice(0, 1) : []),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const newsTimeline = (Array.isArray(selectedReport?.newsUsed) ? selectedReport.newsUsed : []).slice(0, 5);
  const newsTimelineHtml = newsTimeline.length
    ? newsTimeline
        .map((item) => {
          const title = String(item?.title || "Headline").trim();
          const impact = getNewsImpactDirection(title, selectedReport?.signal || "neutral");
          const why = getNewsImpactWhy(title);
          const source = String(item?.source || "News").trim();
          const link = String(item?.link || "").trim();
          return `<li>
            <strong>${escapeHtml(title)}</strong>
            <div class="settings-desc">${escapeHtml(source)} - ${escapeHtml(formatNewsTime(item?.pubDate))}</div>
            <div class="settings-desc"><strong>Expected impact:</strong> ${escapeHtml(impact)}</div>
            <div class="settings-desc">${escapeHtml(why)}</div>
            ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Read source</a>` : ""}
          </li>`;
        })
        .join("")
    : '<li class="settings-desc">No recent headlines yet for this ticker.</li>';
  const compareSymbols = Array.isArray(tickerIntelState.compareSymbols) ? tickerIntelState.compareSymbols.slice(0, 3) : [];
  const compareRows = compareSymbols
    .map((symbol) => {
      const quote = tickerIntelState.quoteBySymbol[symbol];
      const pct = getOpenDeltaPercent(quote);
      const score = Math.round(getSmartSetupScore(symbol, quote));
      return `
        <tr>
          <td>${escapeHtml(symbol)}</td>
          <td>${escapeHtml(getTickerCardCompanyLine(symbol, quote))}</td>
          <td>${quote ? renderPriceCell(quote.close) : "-"}</td>
          <td>${formatPercent(pct)}</td>
          <td>${escapeHtml(getDataQualityLabel(quote))}</td>
          <td>${Number.isFinite(score) ? score : "-"}</td>
        </tr>
      `;
    })
    .join("");
  const rightPaneHtml = `
    <section class="ticker-workspace-modern">
      <div class="ticker-workspace-header">
        <div>
          <h3>${escapeHtml(workspaceTitle || selected)}</h3>
          <p class="schwab-card-sub">${escapeHtml(workspaceSubtitle || companyExplainer)}</p>
        </div>
        <div class="ticker-source-badges">
          <span class="ticker-catalyst-chip">AI profile: ${escapeHtml(profileSource || "gradient-best-effort")}</span>
          <span class="ticker-catalyst-chip">Updated: ${escapeHtml(profileUpdatedAt ? formatNewsTime(profileUpdatedAt) : "n/a")}</span>
        </div>
      </div>
      <article class="schwab-card ticker-snapshot-card">
        <div class="ticker-snapshot-head">
          <h4>Live ticker snapshot</h4>
          <div class="ticker-source-badges">
            <span class="ticker-catalyst-chip">${escapeHtml(marketStatusText)}</span>
            <span class="ticker-catalyst-chip">${escapeHtml(selectedSourceLabel)} • ${escapeHtml(selectedDataQuality)}</span>
            <span class="ticker-catalyst-chip">Updated: ${escapeHtml(quoteUpdatedAt)}</span>
          </div>
        </div>
        <div class="ticker-snapshot-grid">
          <div class="ticker-snapshot-pane">
            <div><span>Symbol</span><strong>${escapeHtml(selected)}</strong></div>
            <div><span>Company</span><strong>${escapeHtml(selectedCompany)}</strong></div>
            ${selectedCompanyType ? `<div><span>Type</span><strong>${escapeHtml(selectedCompanyType)}</strong></div>` : ""}
            ${selectedMarketCap ? `<div><span>Market cap</span><strong>${escapeHtml(selectedMarketCap)}</strong></div>` : ""}
            <div><span>Last / Today</span><strong>${selectedQuote ? renderPriceCell(selectedQuote.close) : "-"} • ${formatPercent(selectedPct)}</strong></div>
            <div><span>Bid / Ask</span><strong>${renderPriceCell(selectedQuote?.bid)} / ${renderPriceCell(selectedQuote?.ask)}</strong></div>
            <div><span>Spread</span><strong>${Number.isFinite(spreadValue) ? renderPriceCell(spreadValue) : "-"}</strong></div>
          </div>
          <div class="ticker-snapshot-pane">
            <div><span>Open / High / Low</span><strong>${
              selectedQuote
                ? `${renderPriceCell(selectedQuote.open)} / ${renderPriceCell(selectedQuote.high)} / ${renderPriceCell(selectedQuote.low)}`
                : "-"
            }</strong></div>
            <div><span>Prev close</span><strong>${renderPriceCell(selectedQuote?.previousClose)}</strong></div>
            <div><span>VWAP</span><strong>${renderPriceCell(selectedQuote?.vwap)}</strong></div>
            <div><span>Volume</span><strong>${formatCompactNumber(selectedQuote?.volume)}</strong></div>
            <div><span>52W range</span><strong>${renderPriceCell(selectedQuote?.week52Low)} - ${renderPriceCell(selectedQuote?.week52High)}</strong></div>
            <div><span>Range position</span><strong>${renderPriceLocationBar(selectedQuote)}</strong></div>
          </div>
          <div class="ticker-snapshot-pane">
            <div><span>Gradient now</span><strong>${escapeHtml(nowNext.now)}</strong></div>
            <div><span>Gradient next</span><strong>${escapeHtml(nowNext.next)}</strong></div>
            <div><span>Data quality score</span><strong>${fieldCoverage.score}/100</strong></div>
            <div><span>AI confidence score</span><strong>${aiConfidenceScore}/100</strong></div>
            <div><span>Missing fields</span><strong>${escapeHtml(missingTapeFields || "None")}</strong></div>
          </div>
        </div>
      </article>
      ${
        reportLoading
          ? '<div class="do-loading">Building AI explainer and news impact view...</div>'
          : reportError
            ? `<div class="do-error"><strong>AI report issue</strong><p>${escapeHtml(reportError)}</p></div>`
            : ""
      }
      ${
        gradientSuggestion
          ? `<article class="schwab-card ticker-gradient-brief">
              <h4>Gradient suggestion</h4>
              <p class="schwab-card-sub"><strong>${escapeHtml(gradientSuggestion?.title || "Risk-managed setup")}</strong></p>
              <ul class="ticker-bullets">
                ${(Array.isArray(gradientSuggestion?.bullets) ? gradientSuggestion.bullets.slice(0, 3) : ["No suggestion available yet."])
                  .map((line) => `<li>${escapeHtml(line)}</li>`)
                  .join("")}
              </ul>
            </article>`
          : ""
      }
      <section class="schwab-grid ticker-workspace-grid">
        <article class="schwab-card">
          <h4>What this company does</h4>
          ${
            companyAgentBullets.length
              ? `<ul class="ticker-bullets">
                  ${companyAgentBullets.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
                </ul>`
              : companyExplainerBullets.length
              ? `<ul class="ticker-bullets">
                  ${companyExplainerBullets.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
                </ul>`
              : `<p class="schwab-card-sub">${escapeHtml(companyExplainer)}</p>`
          }
        </article>
        <article class="schwab-card">
          <h4>Why today could move this ticker</h4>
          <ul class="ticker-bullets">
            ${(catalystAgentBullets.length ? catalystAgentBullets : whyToday.length ? whyToday : ["No major catalyst detected right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </article>
        <article class="schwab-card">
          <h4>Risk agent</h4>
          <ul class="ticker-bullets">
            ${(riskAgentBullets.length
              ? riskAgentBullets
              : Array.isArray(selectedReport?.riskFlags) && selectedReport.riskFlags.length
                ? selectedReport.riskFlags.slice(0, 3)
                : ["No major risk flags detected right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </article>
        <article class="schwab-card">
          <h4>News impact timeline</h4>
          <ul class="ticker-bullets">${newsTimelineHtml}</ul>
        </article>
      </section>
      <section class="schwab-card">
        <h4>Quick Compare (up to 3)</h4>
        ${
          compareRows
            ? `<div class="ticker-compare-wrap">
                <table class="time-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Company</th>
                      <th>Price</th>
                      <th>Today</th>
                      <th>Data</th>
                      <th>Setup</th>
                    </tr>
                  </thead>
                  <tbody>${compareRows}</tbody>
                </table>
              </div>`
            : '<p class="schwab-card-sub">Tap Compare on ticker cards to build a quick side-by-side view.</p>'
        }
      </section>
    </section>
  `;

  const remaining = Math.max(0, filtered.length - visibleSymbols.length);
  const tickerListFooterHtml = `
    <div class="settings-desc">Showing ${visibleSymbols.length} of ${filtered.length} symbols</div>
    ${
      remaining > 0
        ? `<button type="button" class="schwab-btn schwab-btn-ghost" id="loadMoreTickerIntelBtn">Load ${Math.min(
            TICKER_VISIBLE_INCREMENT,
            remaining
          )} more</button>`
        : ""
    }
  `;

  workspaceTableWrap.innerHTML = `
    <section class="ticker-intel-layout">
      <aside class="ticker-intel-list">
        <h4>Market Coverage</h4>
        <div class="watchboard-strip">
          <div class="watchboard-strip-top">
            <span class="watchboard-label">AI Watchboards</span>
            <button type="button" class="watchboard-refresh-btn" id="refreshTickerWatchboardsBtn">Regenerate</button>
          </div>
          <div class="watchboard-chip-row">
            ${
              tickerIntelState.watchboardsLoading
                ? '<span class="settings-desc">Building Gradient watchboards...</span>'
                : watchboardButtonsHtml || '<span class="settings-desc">No watchboards loaded yet.</span>'
            }
          </div>
          ${
            tickerIntelState.watchboardsError
              ? `<div class="settings-desc">${escapeHtml(tickerIntelState.watchboardsError)}</div>`
              : `<div class="settings-desc">Source: ${escapeHtml(
                  tickerIntelState.watchboardsSource || "fallback"
                )}</div>`
          }
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
          <div class="ticker-filters-inline">
            <input id="tickerSearchInput" class="trade-input" placeholder="Search symbol (e.g. AAPL)" value="${escapeHtml(
              tickerIntelState.search || ""
            )}" />
            <select id="tickerSignalFilter" class="trade-input">
              <option value="all" ${tickerIntelState.signalFilter === "all" ? "selected" : ""}>Ratings</option>
              <option value="bullish" ${tickerIntelState.signalFilter === "bullish" ? "selected" : ""}>Up (${counts.signal.bullish})</option>
              <option value="bearish" ${tickerIntelState.signalFilter === "bearish" ? "selected" : ""}>Down (${counts.signal.bearish})</option>
              <option value="neutral" ${tickerIntelState.signalFilter === "neutral" ? "selected" : ""}>Mixed (${counts.signal.neutral})</option>
              <option value="no-data" ${tickerIntelState.signalFilter === "no-data" ? "selected" : ""}>No Data (${counts.signal["no-data"]})</option>
            </select>
            <select id="tickerPriceFilter" class="trade-input">
              <option value="all" ${tickerIntelState.priceFilter === "all" ? "selected" : ""}>Prices</option>
              <option value="under20" ${tickerIntelState.priceFilter === "under20" ? "selected" : ""}>Under $20 (${counts.price.under20})</option>
              <option value="20to100" ${tickerIntelState.priceFilter === "20to100" ? "selected" : ""}>$20 - $100 (${counts.price["20to100"]})</option>
              <option value="100to500" ${tickerIntelState.priceFilter === "100to500" ? "selected" : ""}>$100 - $500 (${counts.price["100to500"]})</option>
              <option value="500plus" ${tickerIntelState.priceFilter === "500plus" ? "selected" : ""}>$500+ (${counts.price["500plus"]})</option>
              <option value="unknown" ${tickerIntelState.priceFilter === "unknown" ? "selected" : ""}>No Price (${counts.price.unknown})</option>
            </select>
          </div>
          <div class="sort-mode-row">
            <button type="button" class="sort-mode-btn ${tickerIntelState.sortMode === "best-now" ? "active" : ""}" data-sort-mode="best-now">Best Now</button>
            <button type="button" class="sort-mode-btn ${tickerIntelState.sortMode === "lowest-risk" ? "active" : ""}" data-sort-mode="lowest-risk">Lowest Risk</button>
            <button type="button" class="sort-mode-btn ${tickerIntelState.sortMode === "big-movers" ? "active" : ""}" data-sort-mode="big-movers">Big Movers</button>
          </div>
          <button type="button" class="schwab-btn schwab-btn-ghost" id="refreshTickerUniverseBtn">Refresh Prices</button>
        </div>
        <div class="ticker-items">${watchlistHtml || '<div class="settings-desc">No symbols match the current filters.</div>'}</div>
        <div class="ticker-list-footer">${tickerListFooterHtml}</div>
      </aside>
      <article class="ticker-intel-report">
        ${rightPaneHtml}
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
  const loadMoreBtn = document.getElementById("loadMoreTickerIntelBtn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      tickerIntelState = {
        ...tickerIntelState,
        maxVisible: Number(tickerIntelState.maxVisible || TICKER_DEFAULT_VISIBLE_COUNT) + TICKER_VISIBLE_INCREMENT,
      };
      renderTickerIntelView();
      refreshTickerUniverseQuotes({ rerender: true, force: true }).catch(() => {
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
  const watchboardRefreshBtn = document.getElementById("refreshTickerWatchboardsBtn");
  if (watchboardRefreshBtn) {
    watchboardRefreshBtn.addEventListener("click", () => {
      loadTickerWatchboards({ force: true })
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        })
        .catch(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    });
  }
  workspaceTableWrap.querySelectorAll("[data-watchboard-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const layoutId = btn.dataset.watchboardId || "";
      if (!layoutId) return;
      applyTickerWatchboardLayout(layoutId, { refreshQuotes: true });
      renderTickerIntelView();
      refreshTickerUniverseQuotes({ rerender: true, force: true }).catch(() => {
        if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
      });
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
      const safeSymbol = String(symbol).toUpperCase();
      tickerIntelState = { ...tickerIntelState, selected: safeSymbol, loading: true, error: "" };
      renderTickerIntelView();
      loadTickerIntelReport(safeSymbol)
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        })
        .catch((error) => {
          tickerIntelState = { ...tickerIntelState, loading: false, error: error.message || "Failed to load report." };
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      btn.click();
    });
  });
  workspaceTableWrap.querySelectorAll("[data-compare-ticker]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const symbol = String(btn.dataset.compareTicker || "").toUpperCase();
      if (!symbol) return;
      const current = Array.isArray(tickerIntelState.compareSymbols) ? [...tickerIntelState.compareSymbols] : [];
      const exists = current.includes(symbol);
      let next = exists ? current.filter((s) => s !== symbol) : [...current, symbol].slice(0, 3);
      tickerIntelState = { ...tickerIntelState, compareSymbols: next };
      renderTickerIntelView();
    });
  });
  workspaceTableWrap.querySelectorAll(".ticker-priority-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = btn.dataset.ticker;
      if (!symbol) return;
      const safeSymbol = String(symbol).toUpperCase();
      tickerIntelState = { ...tickerIntelState, selected: safeSymbol, loading: true, error: "" };
      renderTickerIntelView();
      loadTickerIntelReport(safeSymbol)
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        })
        .catch((error) => {
          tickerIntelState = { ...tickerIntelState, loading: false, error: error.message || "Failed to load report." };
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    });
  });
}

function renderTickerDetailView(symbol) {
  const safeSymbol = String(symbol || "").trim().toUpperCase();
  if (!safeSymbol) {
    workspaceTableWrap.innerHTML = '<div class="do-error"><strong>Error</strong><p>Invalid ticker symbol.</p></div>';
    return;
  }

  const cachedQuote = tickerIntelState.quoteBySymbol[safeSymbol] || null;

  const renderDetail = (quote) => {
    const movePct = quote ? getOpenDeltaPercent(quote) : null;
    const moveClass = !Number.isFinite(movePct) ? "value-flat" : movePct > 0 ? "value-up" : movePct < 0 ? "value-down" : "value-flat";
    workspaceTableWrap.innerHTML = `
      <section class="agent-view">
        <section class="agent-hero">
          <h3>${escapeHtml(safeSymbol)} - ${escapeHtml(getCompanyName(safeSymbol, quote))}</h3>
          <p>${escapeHtml(getCompanySuccessNote(safeSymbol))}</p>
        </section>
        <section class="schwab-metrics">
          <article class="schwab-metric-card">
            <h4>Price</h4>
            <div class="schwab-metric-value small">${quote ? renderPriceCell(quote.close) : "-"}</div>
          </article>
          <article class="schwab-metric-card">
            <h4>Today</h4>
            <div class="schwab-metric-value small ${moveClass}">${formatPercent(movePct)}</div>
          </article>
          <article class="schwab-metric-card">
            <h4>Open / High / Low</h4>
            <div class="schwab-metric-value small">${
              quote ? `${renderPriceCell(quote.open)} / ${renderPriceCell(quote.high)} / ${renderPriceCell(quote.low)}` : "-"
            }</div>
          </article>
        </section>
        <section class="schwab-grid">
          <article class="schwab-card">
            <h4>What this company does</h4>
            <p class="schwab-card-sub">${escapeHtml(getCompanySuccessNote(safeSymbol))}</p>
          </article>
          <article class="schwab-card">
            <h4>Why many investors know this name</h4>
            <ul class="ticker-bullets">
              <li>Large public-company visibility and regular financial reporting.</li>
              <li>Clear products/services people or businesses use every day.</li>
              <li>Frequent market coverage, so price moves are watched closely.</li>
            </ul>
          </article>
        </section>
      </section>
    `;
  };

  renderDetail(cachedQuote);
  fetchTickerQuoteBatch([safeSymbol])
    .then((quotes) => {
      const nextQuote = Array.isArray(quotes) && quotes.length ? normalizeUnifiedQuote(quotes[0], safeSymbol) : null;
      if (nextQuote) {
        tickerIntelState = {
          ...tickerIntelState,
          quoteBySymbol: {
            ...tickerIntelState.quoteBySymbol,
            [safeSymbol]: nextQuote,
          },
        };
      }
      if (currentTab === getTickerDetailTabName(safeSymbol)) {
        renderDetail(nextQuote || cachedQuote);
      }
    })
    .catch(() => {
      if (currentTab === getTickerDetailTabName(safeSymbol)) {
        renderDetail(cachedQuote);
      }
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

function buildBriefKey(payload) {
  const text = JSON.stringify(payload || {});
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function buildPortfolioAgentPayload() {
  const portfolio = getPortfolioSnapshot();
  const orders = getOpenOrdersSummary();
  return {
    accountCount: portfolio.accountCount,
    positionCount: portfolio.positionCount,
    totalLiquidationValue: Math.round(Number(portfolio.totalLiquidationValue || 0)),
    totalCash: Math.round(Number(portfolio.totalCash || 0)),
    buyingPower: Math.round(
      getLinkedAccounts().reduce((sum, account) => sum + Number(account?.securitiesAccount?.currentBalances?.buyingPower || 0), 0)
    ),
    topHoldings: (Array.isArray(portfolio.top3) ? portfolio.top3 : []).map((item) => ({
      symbol: item?.symbol || "-",
      marketValue: Math.round(Number(item?.marketValue || 0)),
      weightPct: Number(item?.weight || 0),
    })),
    openOrders: {
      total: orders.total,
      stale: orders.stale,
    },
  };
}

function buildShoppingAgentPayload() {
  const funding = getShoppingFundingSnapshot();
  const watchSymbols = getShoppingWatchSymbols().slice(0, 8);
  return {
    marketOpen: isUsMarketOpenNow(),
    itemCount: Array.isArray(shoppingState.items) ? shoppingState.items.length : 0,
    executionStyle: shoppingState.executionStyle || "fast-fill",
    cartEstimatedCost: Math.round(Number(funding.cartEstimatedCost || 0)),
    availableToTrade: Math.round(Number(funding.availableToTrade || 0)),
    remainingAfterCart: Math.round(Number(funding.remainingAfterCart || 0)),
    unresolvedCount: Number(funding.unresolvedCount || 0),
    watchSymbols,
  };
}

function maybeLoadPortfolioAgentBrief() {
  if (!schwabSession.connected) return;
  const payload = buildPortfolioAgentPayload();
  const key = buildBriefKey(payload);
  const isFresh =
    portfolioAgentBriefState.data &&
    portfolioAgentBriefState.lastKey === key &&
    Date.now() - Number(portfolioAgentBriefState.fetchedAt || 0) < AGENT_BRIEF_TTL_MS;
  if (isFresh || (portfolioAgentBriefState.loading && portfolioAgentBriefState.lastKey === key)) return;

  portfolioAgentBriefState = { ...portfolioAgentBriefState, loading: true, error: "", lastKey: key };
  schwabApi("/api/agents/portfolio-brief", {
    method: "POST",
    body: JSON.stringify(payload),
  })
    .then((data) => {
      portfolioAgentBriefState = {
        loading: false,
        data: data && typeof data === "object" ? data : null,
        error: "",
        fetchedAt: Date.now(),
        lastKey: key,
      };
      if (currentTab === PORTFOLIO_TAB) renderPortfolioView();
    })
    .catch((error) => {
      portfolioAgentBriefState = {
        ...portfolioAgentBriefState,
        loading: false,
        error: error?.message || "Portfolio agents unavailable.",
      };
      if (currentTab === PORTFOLIO_TAB) renderPortfolioView();
    });
}

function maybeLoadShoppingAgentBrief() {
  if (!schwabSession.connected) return;
  const payload = buildShoppingAgentPayload();
  const key = buildBriefKey(payload);
  const isFresh =
    shoppingAgentBriefState.data &&
    shoppingAgentBriefState.lastKey === key &&
    Date.now() - Number(shoppingAgentBriefState.fetchedAt || 0) < AGENT_BRIEF_TTL_MS;
  if (isFresh || (shoppingAgentBriefState.loading && shoppingAgentBriefState.lastKey === key)) return;

  shoppingAgentBriefState = { ...shoppingAgentBriefState, loading: true, error: "", lastKey: key };
  schwabApi("/api/agents/shopping-brief", {
    method: "POST",
    body: JSON.stringify(payload),
  })
    .then((data) => {
      shoppingAgentBriefState = {
        loading: false,
        data: data && typeof data === "object" ? data : null,
        error: "",
        fetchedAt: Date.now(),
        lastKey: key,
      };
      if (currentTab === SHOPPING_TAB) renderShoppingView();
    })
    .catch((error) => {
      shoppingAgentBriefState = {
        ...shoppingAgentBriefState,
        loading: false,
        error: error?.message || "Shopping agents unavailable.",
      };
      if (currentTab === SHOPPING_TAB) renderShoppingView();
    });
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
  const portfolioAgentData = portfolioAgentBriefState.data && typeof portfolioAgentBriefState.data === "object"
    ? portfolioAgentBriefState.data
    : null;
  const allocationBullets = Array.isArray(portfolioAgentData?.allocation) ? portfolioAgentData.allocation.slice(0, 3) : [];
  const riskBullets = Array.isArray(portfolioAgentData?.risk) ? portfolioAgentData.risk.slice(0, 3) : [];
  const incomeBullets = Array.isArray(portfolioAgentData?.income) ? portfolioAgentData.income.slice(0, 3) : [];

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
      <section class="schwab-grid">
        <article class="schwab-card">
          <h4>Allocation Agent</h4>
          <ul class="ticker-bullets">
            ${(allocationBullets.length
              ? allocationBullets
              : [portfolioAgentBriefState.loading ? "Building allocation brief..." : "Allocation brief unavailable right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </article>
        <article class="schwab-card">
          <h4>Risk Agent</h4>
          <ul class="ticker-bullets">
            ${(riskBullets.length
              ? riskBullets
              : [portfolioAgentBriefState.loading ? "Building risk brief..." : "Risk brief unavailable right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </article>
        <article class="schwab-card">
          <h4>Income Agent</h4>
          <ul class="ticker-bullets">
            ${(incomeBullets.length
              ? incomeBullets
              : [portfolioAgentBriefState.loading ? "Building income brief..." : "Income brief unavailable right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
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
  maybeLoadPortfolioAgentBrief();
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
  portfolioAgentBriefState = { loading: false, data: null, error: "", fetchedAt: 0, lastKey: "" };
  shoppingAgentBriefState = { loading: false, data: null, error: "", fetchedAt: 0, lastKey: "" };
  updateSchwabChatBadge();
  openTabs.add(SCHWAB_CONNECT_TAB);
  activateTab(SCHWAB_CONNECT_TAB);
}

function buildEquityOrder({ side, symbol, quantity, orderType = "MARKET", duration = "DAY", limitPrice, stopPrice }) {
  const cleanType = String(orderType || "MARKET").toUpperCase();
  const cleanSide = String(side || "BUY").toUpperCase();
  const cleanQuantity = Math.max(1, Math.floor(Number(quantity || 0)));
  const order = {
    session: "NORMAL",
    duration: String(duration || "DAY").toUpperCase() === "GTC" ? "GOOD_TILL_CANCEL" : "DAY",
    orderType: cleanType,
    complexOrderStrategyType: "NONE",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: cleanSide,
        quantity: cleanQuantity,
        instrument: {
          symbol,
          assetType: "EQUITY",
        },
      },
    ],
  };
  if (cleanType === "LIMIT" || cleanType === "STOP_LIMIT") {
    const numericLimit = Number(limitPrice);
    if (Number.isFinite(numericLimit)) order.price = Number(numericLimit.toFixed(2));
  }
  if (cleanType === "STOP" || cleanType === "STOP_LIMIT") {
    const numericStop = Number(stopPrice);
    if (Number.isFinite(numericStop)) order.stopPrice = Number(numericStop.toFixed(2));
  }
  return order;
}

function buildEquityMarketOrder({ side, symbol, quantity }) {
  return buildEquityOrder({ side, symbol, quantity, orderType: "MARKET", duration: "DAY" });
}

function getOrderLeg(order) {
  return Array.isArray(order?.orderLegCollection) ? order.orderLegCollection[0] || null : null;
}

function getOrderLegSymbol(order) {
  return String(getOrderLeg(order)?.instrument?.symbol || "")
    .trim()
    .toUpperCase();
}

function getOrderLegInstruction(order) {
  return String(getOrderLeg(order)?.instruction || "")
    .trim()
    .toUpperCase();
}

function getOrderLegQuantity(order) {
  const raw = Number(getOrderLeg(order)?.quantity ?? order?.quantity ?? NaN);
  return Number.isFinite(raw) ? raw : null;
}

function extractPolledOrderMessage(order) {
  if (!order || typeof order !== "object") return "";
  const textCandidates = [
    order.statusDescription,
    order.statusReason,
    order.rejectReason,
    order.rejectionReason,
    order.cancelMessage,
    order.cancelReason,
    order.destinationLinkName,
  ];
  for (const candidate of textCandidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  const arrayCandidates = [order.messages, order.orderMessages, order.orderActivityCollection];
  for (const list of arrayCandidates) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const text = String(
        entry?.message ||
          entry?.description ||
          entry?.activityType ||
          entry?.executionType ||
          entry?.status ||
          ""
      ).trim();
      if (text) return text;
    }
  }
  return "";
}

function matchRecentSubmittedOrder(orders, { orderId, symbol, quantity, side, submittedAt }) {
  const safeOrderId = String(orderId || "").trim();
  if (safeOrderId) {
    return orders.find((order) => String(order?.orderId || "").trim() === safeOrderId) || null;
  }

  const safeSymbol = String(symbol || "").trim().toUpperCase();
  const safeSide = String(side || "").trim().toUpperCase();
  const safeQuantity = Number(quantity);
  const submittedFloor = Number.isFinite(submittedAt) ? submittedAt - 2 * 60 * 1000 : Date.now() - 2 * 60 * 1000;

  const candidates = orders.filter((order) => {
    const entered = Date.parse(order?.enteredTime || "");
    if (!Number.isFinite(entered) || entered < submittedFloor) return false;
    if (safeSymbol && getOrderLegSymbol(order) !== safeSymbol) return false;
    if (safeSide && getOrderLegInstruction(order) && getOrderLegInstruction(order) !== safeSide) return false;
    if (Number.isFinite(safeQuantity)) {
      const orderQty = getOrderLegQuantity(order);
      if (Number.isFinite(orderQty) && orderQty !== safeQuantity) return false;
    }
    return true;
  });

  if (candidates.length !== 1) return null;
  return candidates[0];
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
  return "";
}

async function getAiOrderPlanForItem(item) {
  const symbol = String(item?.symbol || "")
    .trim()
    .toUpperCase();
  const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
  const executionStyle = shoppingState.executionStyle === "smart-price" ? "smart-price" : "fast-fill";
  const sideHint = String(item?.side || "BUY").toUpperCase();
  const response = await schwabApi("/api/schwab/order-plan", {
    method: "POST",
    body: JSON.stringify({
      symbol,
      quantity,
      executionStyle,
      sideHint,
    }),
  });
  return response?.plan || null;
}

async function pollSubmittedOrderOutcome({ orderId, symbol, quantity, side, submittedAt, maxAttempts = 6, delayMs = 1200 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await schwabApi("/api/schwab/orders/recent?maxResults=20", { method: "GET" });
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const orderMatch = matchRecentSubmittedOrder(orders, { orderId, symbol, quantity, side, submittedAt });
    if (!orderMatch) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    const status = String(orderMatch?.status || "UNKNOWN").toUpperCase();
    const terminalStates = new Set(["FILLED", "REJECTED", "CANCELED", "EXPIRED"]);
    if (terminalStates.has(status)) {
      return { status, order: orderMatch };
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { status: orderId ? "WORKING" : "SUBMITTED", order: null };
}

function summarizeOrderOutcome(outcome) {
  const status = String(outcome?.status || "SUBMITTED").toUpperCase();
  if (status === "FILLED") return "Filled now.";
  if (status === "REJECTED") return "Rejected by Schwab.";
  if (status === "CANCELED") return "Canceled.";
  if (status === "EXPIRED") return "Expired.";
  if (status === "SUBMITTED") return "Submitted to Schwab. Waiting for confirmed status.";
  return "Working at Schwab.";
}

async function submitShoppingCartOrders() {
  if (!schwabSession.connected) throw new Error("Connect Schwab first.");
  if (!shoppingState.items.length) throw new Error("Your cart is empty.");

  // Refresh session/account snapshot before submit so orders are tied to the active Schwab account hash.
  await refreshSchwabSession();
  if (!schwabSession.connected) throw new Error("Schwab session expired. Reconnect and try again.");
  await loadSchwabContextData().catch(() => ({}));
  const activeAccountHash = String(schwabSession.accountHash || "").trim();
  if (!activeAccountHash) throw new Error("No active Schwab account hash. Reconnect and try again.");

  shoppingState = {
    ...shoppingState,
    submitting: true,
    status: "Submitting cart to Schwab...",
    lastExecutionResults: [],
    lastSubmittedAt: Date.now(),
  };
  renderShoppingView();

  const results = [];
  for (const item of shoppingState.items) {
    const validationError = validateShoppingItem(item);
    if (validationError) {
      results.push({ id: item.id, symbol: item.symbol || "-", ok: false, message: validationError });
      continue;
    }
    try {
      const plan = await getAiOrderPlanForItem(item);
      if (plan) {
        shoppingState = {
          ...shoppingState,
          aiPlanByItem: {
            ...(shoppingState.aiPlanByItem || {}),
            [item.id]: plan,
          },
        };
      }
      const finalSide = String(plan?.side || item.side || "BUY").toUpperCase();
      const finalType = String(plan?.orderType || "MARKET").toUpperCase();
      const finalDuration = String(plan?.duration || "DAY").toUpperCase();
      const finalLimit = plan?.limitPrice ?? "";
      const finalStop = plan?.stopPrice ?? "";
      const orderQuantity = Math.max(1, Math.floor(Number(item.quantity || 0)));
      if (finalSide === "BUY" && !isUsMarketOpenNow()) {
        results.push({
          id: item.id,
          symbol: item.symbol || "-",
          ok: false,
          message: "Buy blocked: U.S. market is closed.",
        });
        continue;
      }
      const order = buildEquityOrder({
        side: finalSide,
        symbol: String(item.symbol || "").toUpperCase(),
        quantity: orderQuantity,
        orderType: finalType,
        duration: finalDuration,
        limitPrice: finalLimit,
        stopPrice: finalStop,
      });
      const submittedAt = Date.now();
      const submit = await schwabApi("/api/schwab/orders", {
        method: "POST",
        body: JSON.stringify({ accountHash: activeAccountHash, order }),
      });
      const outcome = await pollSubmittedOrderOutcome({
        orderId: submit?.orderId || null,
        symbol: String(item.symbol || "").toUpperCase(),
        quantity: orderQuantity,
        side: finalSide,
        submittedAt,
      }).catch(() => ({ status: submit?.orderId ? "WORKING" : "SUBMITTED", order: null }));
      const outcomeStatus = String(outcome?.status || (submit?.orderId ? "WORKING" : "SUBMITTED")).toUpperCase();
      const outcomeDetail = extractPolledOrderMessage(outcome?.order);
      const outcomeSummary = summarizeOrderOutcome(outcome);
      const refs = [
        submit?.orderId ? `orderId ${submit.orderId}` : "",
        submit?.correlationId ? `corr ${submit.correlationId}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      const isTerminalFailure = new Set(["REJECTED", "CANCELED", "EXPIRED"]).has(outcomeStatus);
      results.push({
        id: item.id,
        symbol: item.symbol || "-",
        ok: !isTerminalFailure,
        message: `${finalSide} ${orderQuantity} ${item.symbol} submitted. ${outcomeSummary}${
          outcomeDetail ? ` ${outcomeDetail}` : ""
        }${refs ? ` [${refs}]` : ""}`,
        outcomeStatus,
      });
    } catch (error) {
      results.push({ id: item.id, symbol: item.symbol || "-", ok: false, message: error.message || "Order failed" });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.length - successCount;
  const firstFailure = results.find((r) => !r.ok)?.message || "";
  const submittedIds = new Set(results.filter((r) => r.ok && r.id).map((r) => String(r.id)));
  const nextItems = shoppingState.items.filter((item) => !submittedIds.has(String(item.id)));
  const nextExecutionByItem = { ...(shoppingState.executionByItem || {}) };
  for (const result of results) {
    if (!result?.id) continue;
    nextExecutionByItem[result.id] = result.message;
  }
  shoppingState = {
    ...shoppingState,
    items: nextItems,
    executionByItem: nextExecutionByItem,
    submitting: false,
    status: `Submitted ${successCount} order(s), ${failCount} failed.${firstFailure ? ` ${firstFailure}` : ""}`,
    lastExecutionResults: results.map((row) => ({
      symbol: String(row?.symbol || "-"),
      ok: Boolean(row?.ok),
      message: String(row?.message || ""),
      status: String(row?.outcomeStatus || (row?.ok ? "SUBMITTED" : "FAILED")).toUpperCase(),
    })),
    lastSubmittedAt: Date.now(),
  };
  appendChatMessage("assistant", shoppingState.status, failCount ? "msg-muted" : "msg-success");
  if (successCount > 0) {
    // Pull fresh Schwab balances/positions after order submit so the summary strip updates quickly.
    await loadSchwabContextData().catch(() => ({}));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await loadSchwabContextData().catch(() => ({}));
  }
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
    tabName === TIME_TAB ||
    tabName === SEC_TAB
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
  const beginnerBrief = investmentsMarket.beginnerBrief || null;
  const takeaways = Array.isArray(beginnerBrief?.takeaways) ? beginnerBrief.takeaways.slice(0, 3) : [];
  const starterActions = Array.isArray(beginnerBrief?.starterActions) ? beginnerBrief.starterActions.slice(0, 3) : [];
  const terms = Array.isArray(beginnerBrief?.terms) ? beginnerBrief.terms.slice(0, 3) : [];

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
        <p>A beginner-friendly market view. Schwab login is optional for this tab.</p>
      </section>
      <section class="schwab-card">
        <h4>${escapeHtml(beginnerBrief?.headline || "Market in plain English")}</h4>
        <p class="schwab-card-sub">${escapeHtml(beginnerBrief?.summary || "Quick daily explanation for new investors.")}</p>
        <div class="schwab-grid">
          <article class="schwab-card">
            <h4>What this means today</h4>
            <ul class="ticker-bullets">
              ${(takeaways.length ? takeaways : ["This snapshot is mixed, so avoid rushing into one trade."])
                .map((line) => `<li>${escapeHtml(line)}</li>`)
                .join("")}
            </ul>
          </article>
          <article class="schwab-card">
            <h4>Starter actions</h4>
            <ul class="ticker-bullets">
              ${(starterActions.length ? starterActions : ["Start small and focus on one or two symbols first."])
                .map((line) => `<li>${escapeHtml(line)}</li>`)
                .join("")}
            </ul>
          </article>
          <article class="schwab-card">
            <h4>Simple terms</h4>
            <ul class="ticker-bullets">
              ${(terms.length
                ? terms
                : [
                    { term: "Open", meaning: "First traded price when market starts." },
                    { term: "Volume", meaning: "How many shares traded today." },
                    { term: "High / Low", meaning: "Highest and lowest prices so far today." },
                  ]
              )
                .map((item) => `<li><strong>${escapeHtml(item.term)}:</strong> ${escapeHtml(item.meaning)}</li>`)
                .join("")}
            </ul>
          </article>
        </div>
      </section>
      <section class="schwab-metrics">
        <article class="schwab-metric-card"><h4>Up today</h4><div class="schwab-metric-value value-up">${advancers}</div></article>
        <article class="schwab-metric-card"><h4>Down today</h4><div class="schwab-metric-value value-down">${decliners}</div></article>
        <article class="schwab-metric-card"><h4>Flat today</h4><div class="schwab-metric-value value-flat">${flats}</div></article>
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

function renderSecLoading(symbol = "AAPL") {
  workspaceTableWrap.innerHTML = `<div class="do-loading">Loading SEC sheet for ${escapeHtml(symbol)}...</div>`;
}

function renderSecView() {
  const allRows = Array.isArray(secTabState.rows) ? secTabState.rows : [];
  const category = String(secTabState.category || "all").toLowerCase();
  const visibleRows = allRows;
  const rowHtml = visibleRows.length
    ? visibleRows
        .map((row, index) => {
          const impactClass = String(row.importance || "").toLowerCase();
          return `
          <tr>
            <td class="sec-row-index">${index + 1}</td>
            <td class="sec-col-symbol">${escapeHtml(row.symbol || "-")}</td>
            <td>${escapeHtml(row.companyName || "-")}</td>
            <td>${escapeHtml(row.form || "-")}</td>
            <td>${escapeHtml(row.filingDate || "-")}</td>
            <td>${Number.isFinite(Number(row.daysAgo)) ? Number(row.daysAgo) : "-"}</td>
            <td><span class="sec-impact ${impactClass}">${escapeHtml(row.importance || "Low")}</span></td>
            <td>${escapeHtml(row.topic || "-")}</td>
            <td>${escapeHtml(row.aiSummary || row.description || "-")}</td>
            <td>${row.secUrl ? `<a href="${escapeHtml(row.secUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : "-"}</td>
          </tr>
        `;
        })
        .join("")
    : '<tr><td colspan="10">No rows found yet.</td></tr>';
  const loadingMoreRow = secTabState.loadingMore
    ? `<tr><td colspan="10"><div class="do-loading">Loading more SEC rows...</div></td></tr>`
    : "";
  const errorRow = secTabState.error
    ? `<tr><td colspan="10"><div class="do-error"><strong>Error</strong><p>${escapeHtml(secTabState.error)}</p></div></td></tr>`
    : "";

  workspaceTableWrap.innerHTML = `
    <section class="table-wrap sec-sheet-wrap">
      <table class="sec-sheet-table">
        <thead>
          <tr>
            <th>#</th>
            <th class="sec-header-filter">
              <label for="secCategorySelect">SEC</label>
              <select id="secCategorySelect">
                <option value="all" ${category === "all" ? "selected" : ""}>All</option>
                <option value="date" ${category === "date" ? "selected" : ""}>Date</option>
                <option value="importance" ${category === "importance" ? "selected" : ""}>Importance level</option>
                <option value="military" ${category === "military" ? "selected" : ""}>Military / Defense</option>
                <option value="10k" ${category === "10k" ? "selected" : ""}>10-Ks</option>
                <option value="10q" ${category === "10q" ? "selected" : ""}>Quarterly 10-Qs</option>
                <option value="8k" ${category === "8k" ? "selected" : ""}>Event-driven 8-Ks</option>
                <option value="def14a" ${category === "def14a" ? "selected" : ""}>DEF 14A (Proxy Statement)</option>
                <option value="10k-annual" ${category === "10k-annual" ? "selected" : ""}>10-K (Annual Report)</option>
              </select>
            </th>
            <th>Company</th>
            <th>Form</th>
            <th>Filed Date</th>
            <th>Days Ago</th>
            <th>Importance</th>
            <th>Topic</th>
            <th>AI Summary</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${errorRow}${rowHtml}${loadingMoreRow}</tbody>
      </table>
    </section>
  `;

  const categorySelect = document.getElementById("secCategorySelect");
  const sheetWrap = workspaceTableWrap.querySelector(".sec-sheet-wrap");

  categorySelect?.addEventListener("change", () => {
    const nextCategory = String(categorySelect?.value || "all").trim().toLowerCase();
    secTabState = {
      ...secTabState,
      category: nextCategory,
      offset: 0,
      hasMore: true,
      loading: true,
      loadingMore: false,
      error: "",
      sheetScrollTop: 0,
      rows: [],
    };
    renderSecLoading(secTabState.symbolsInput || "SEC");
    loadSecBrief({
      symbolsInput: secTabState.symbolsInput,
      days: secTabState.days,
      category: nextCategory,
      append: false,
      force: true,
    })
      .then(() => {
        if (currentTab === SEC_TAB) renderSecView();
      })
      .catch((error) => {
        secTabState = { ...secTabState, loading: false, loadingMore: false, error: error.message || "Failed to load SEC sheet." };
        if (currentTab === SEC_TAB) renderSecView();
      });
  });

  if (sheetWrap) {
    if (Number.isFinite(Number(secTabState.sheetScrollTop))) sheetWrap.scrollTop = Number(secTabState.sheetScrollTop || 0);
    sheetWrap.addEventListener("scroll", () => {
      secTabState = { ...secTabState, sheetScrollTop: sheetWrap.scrollTop };
      if (secTabState.loading || secTabState.loadingMore || !secTabState.hasMore) return;
      const nearBottom = sheetWrap.scrollTop + sheetWrap.clientHeight >= sheetWrap.scrollHeight - 140;
      if (!nearBottom) return;
      secTabState = { ...secTabState, loadingMore: true };
      loadSecBrief({
        symbolsInput: secTabState.symbolsInput,
        days: secTabState.days,
        category: secTabState.category,
        append: true,
      })
        .then(() => {
          if (currentTab === SEC_TAB) renderSecView();
        })
        .catch(() => {
          secTabState = { ...secTabState, loadingMore: false };
        });
    });
  }
}

function renderShoppingView() {
  const isConnected = Boolean(schwabSession.connected);
  const marketOpen = isUsMarketOpenNow();
  const hasBuyOrders = shoppingState.items.some((item) => {
    const plan = shoppingState.aiPlanByItem?.[item.id];
    const side = String(plan?.side || item?.side || "BUY").toUpperCase();
    return side === "BUY";
  });
  const funding = getShoppingFundingSnapshot();
  const shoppingAgentData = shoppingAgentBriefState.data && typeof shoppingAgentBriefState.data === "object"
    ? shoppingAgentBriefState.data
    : null;
  const plannerBullets = Array.isArray(shoppingAgentData?.planner) ? shoppingAgentData.planner.slice(0, 3) : [];
  const executionBullets = Array.isArray(shoppingAgentData?.execution) ? shoppingAgentData.execution.slice(0, 3) : [];
  const hasFundingData = isConnected && funding.accountCount > 0;
  const holdings = getShoppingHoldings(10);
  const sellChoices = holdings;
  const pinnedHoldings = holdings.slice(0, 8);
  const watchSymbols = getShoppingWatchSymbols();
  const lastSubmittedLabel = shoppingState.lastSubmittedAt ? new Date(shoppingState.lastSubmittedAt).toLocaleTimeString() : "";
  const lastResults = Array.isArray(shoppingState.lastExecutionResults) ? shoppingState.lastExecutionResults : [];
  const lastResultsHtml = lastResults
    .slice(0, 12)
    .map((row) => {
      const toneClass = row.ok ? "value-up" : "value-down";
      return `<li><strong>${escapeHtml(row.symbol)}</strong> <span class="${toneClass}">${escapeHtml(row.status)}</span> - ${escapeHtml(
        row.message
      )}</li>`;
    })
    .join("");
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
      const symbol = String(item.symbol || "").toUpperCase();
      const quote = shoppingState.quoteBySymbol?.[symbol];
      const plan = shoppingState.aiPlanByItem?.[item.id] || null;
      const planSide = String(plan?.side || item.side || "BUY").toUpperCase();
      const planType = String(plan?.orderType || "MARKET").toUpperCase();
      const planDuration = String(plan?.duration || "DAY").toUpperCase();
      const planLimit = plan?.limitPrice ?? "";
      const planStop = plan?.stopPrice ?? "";
      const pct = quote ? getOpenDeltaPercent(quote) : null;
      const rowTone = !Number.isFinite(pct) ? "tone-flat" : pct > 0 ? "tone-up" : pct < 0 ? "tone-down" : "tone-flat";
      const buyBlocked = !marketOpen && planSide === "BUY";
      const executionNote = shoppingState.executionByItem?.[item.id] || "";
      return `
      <tr data-cart-row="${item.id}" class="${rowTone}">
        <td><input class="trade-input cart-input-symbol" data-cart-symbol value="${escapeHtml(item.symbol)}" placeholder="AAPL" /></td>
        <td>
          <select class="trade-input" data-cart-side disabled>
            <option value="BUY" ${planSide === "BUY" ? "selected" : ""}>Buy</option>
            <option value="SELL" ${planSide === "SELL" ? "selected" : ""}>Sell</option>
          </select>
        </td>
        <td><input class="trade-input" data-cart-qty type="number" min="1" step="1" value="${Number(item.quantity) || 1}" /></td>
        <td>
          <select class="trade-input" data-cart-order-type disabled>
            <option value="MARKET" ${planType === "MARKET" ? "selected" : ""}>Market</option>
            <option value="LIMIT" ${planType === "LIMIT" ? "selected" : ""}>Limit</option>
            <option value="STOP" ${planType === "STOP" ? "selected" : ""}>Stop</option>
            <option value="STOP_LIMIT" ${planType === "STOP_LIMIT" ? "selected" : ""}>Stop Limit</option>
          </select>
        </td>
        <td><input class="trade-input" data-cart-limit type="number" min="0.01" step="0.01" value="${escapeHtml(planLimit)}" disabled /></td>
        <td><input class="trade-input" data-cart-stop type="number" min="0.01" step="0.01" value="${escapeHtml(planStop)}" disabled /></td>
        <td>
          <select class="trade-input" data-cart-duration disabled>
            <option value="DAY" ${planDuration === "DAY" ? "selected" : ""}>Day</option>
            <option value="GTC" ${planDuration === "GTC" ? "selected" : ""}>GTC</option>
          </select>
        </td>
        <td><label class="cart-auto-label"><input type="checkbox" data-cart-auto checked disabled /> AI</label></td>
        <td><button type="button" class="schwab-btn schwab-btn-ghost cart-remove-btn" data-cart-remove>Remove</button></td>
        <td class="cart-row-price">${quote ? renderPriceCell(quote.close) : "-"}</td>
        <td class="cart-row-move ${!Number.isFinite(pct) ? "value-flat" : pct > 0 ? "value-up" : pct < 0 ? "value-down" : "value-flat"}">${formatPercent(
          pct
        )}</td>
        <td>${quote ? renderSignalPill(pct) : '<span class="signal-pill neutral">No Data</span>'}</td>
        <td class="cart-row-note">${executionNote || (buyBlocked ? "Buy waits for market open" : "AI plan runs at submit")}</td>
      </tr>
    `;
    })
    .join("");

  workspaceTableWrap.innerHTML = `
    <div class="agent-view">
      <section class="agent-hero">
        <h3>Shopping Cart</h3>
        <p>Add ticker + quantity, then submit. Gradient AI auto-sets side, order type, limit/stop, and TIF before sending to Schwab.</p>
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
      <section class="schwab-metrics">
        <article class="schwab-metric-card">
          <h4>Available To Trade</h4>
          <div class="schwab-metric-value small">${hasFundingData ? formatMoney(funding.availableToTrade) : "-"}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Currently Invested</h4>
          <div class="schwab-metric-value small">${hasFundingData ? formatMoney(funding.investedAmount) : "-"}</div>
        </article>
        <article class="schwab-metric-card">
          <h4>Cart Buy Estimate</h4>
          <div class="schwab-metric-value small">${formatMoney(funding.cartEstimatedCost)}</div>
          ${
            funding.unresolvedCount > 0
              ? `<div class="settings-desc">${funding.unresolvedCount} buy order(s) missing price estimate.</div>`
              : ""
          }
        </article>
        <article class="schwab-metric-card">
          <h4>Remaining After Cart</h4>
          <div class="schwab-metric-value small ${
            hasFundingData
              ? funding.remainingAfterCart < 0
                ? "value-down"
                : "value-up"
              : ""
          }">${hasFundingData ? formatMoney(funding.remainingAfterCart) : "-"}</div>
        </article>
      </section>
      <section class="schwab-card">
        <div class="sort-mode-row">
          <button type="button" class="sort-mode-btn ${shoppingState.executionStyle === "fast-fill" ? "active" : ""}" data-execution-style="fast-fill">Fast Fill</button>
          <button type="button" class="sort-mode-btn ${shoppingState.executionStyle === "smart-price" ? "active" : ""}" data-execution-style="smart-price">Smart Price</button>
        </div>
        <p class="schwab-card-sub">
          ${shoppingState.executionStyle === "fast-fill"
            ? "Fast Fill: AI prioritizes execution speed."
            : "Smart Price: AI prioritizes price quality with likely fill."}
        </p>
      </section>
      <section class="schwab-grid">
        <article class="schwab-card">
          <h4>Order Planner Agent</h4>
          <ul class="ticker-bullets">
            ${(plannerBullets.length
              ? plannerBullets
              : [shoppingAgentBriefState.loading ? "Building order planner brief..." : "Order planner brief unavailable right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </article>
        <article class="schwab-card">
          <h4>Execution Watcher Agent</h4>
          <ul class="ticker-bullets">
            ${(executionBullets.length
              ? executionBullets
              : [shoppingAgentBriefState.loading ? "Building execution watcher brief..." : "Execution watcher brief unavailable right now."])
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </article>
      </section>
      ${
        hasFundingData && funding.cartOverage > 0
          ? `<section class="schwab-card"><p class="schwab-card-sub value-down">Cart exceeds available funds by ${formatMoney(
              funding.cartOverage
            )}. Schwab may reject some buy orders.</p></section>`
          : ""
      }
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
                <th>Remove</th>
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
        ${
          shoppingState.submitting
            ? `<div class="do-loading">Submitting your cart... Waiting for Schwab response.</div>`
            : ""
        }
        ${
          lastResults.length
            ? `<section class="schwab-card">
                <h4>Last Submission Results ${lastSubmittedLabel ? `- ${escapeHtml(lastSubmittedLabel)}` : ""}</h4>
                <ul class="schwab-list">${lastResultsHtml}</ul>
              </section>`
            : ""
        }
      </section>
    </div>
  `;

  const addBtn = document.getElementById("cartAddBtn");
  const newSymbolInput = document.getElementById("cartNewSymbol");
  const clearBtn = document.getElementById("cartClearBtn");
  const refreshQuotesBtn = document.getElementById("cartRefreshQuotesBtn");
  const submitBtn = document.getElementById("cartSubmitBtn");
  const executionStyleButtons = workspaceTableWrap.querySelectorAll("[data-execution-style]");
  executionStyleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextStyle = btn.getAttribute("data-execution-style") === "smart-price" ? "smart-price" : "fast-fill";
      shoppingState = {
        ...shoppingState,
        executionStyle: nextStyle,
        status: "",
        aiPlanByItem: {},
      };
      renderShoppingView();
    });
  });
  if (addBtn && newSymbolInput) {
    addBtn.addEventListener("click", () => {
      const symbol = String(newSymbolInput.value || "")
        .trim()
        .toUpperCase();
      if (!symbol) return;
      shoppingState = {
        ...shoppingState,
        items: [...shoppingState.items, createShoppingCartItem(symbol)],
        status: "",
        aiPlanByItem: {},
      };
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
      shoppingState = { ...shoppingState, items: [], status: "Cart cleared.", aiPlanByItem: {}, executionByItem: {} };
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
      const nextPlan = { ...(shoppingState.aiPlanByItem || {}) };
      const nextExecution = { ...(shoppingState.executionByItem || {}) };
      delete nextPlan[id];
      delete nextExecution[id];
      shoppingState = {
        ...shoppingState,
        items: shoppingState.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        status: "",
        aiPlanByItem: nextPlan,
        executionByItem: nextExecution,
      };
      renderShoppingView();
    };
    rowEl.querySelector("[data-cart-symbol]")?.addEventListener("change", (e) => {
      updateItem({ symbol: String(e.target.value || "").trim().toUpperCase() });
    });
    rowEl.querySelector("[data-cart-qty]")?.addEventListener("change", (e) =>
      updateItem({ quantity: Number(e.target.value || 0) })
    );
    rowEl.querySelector("[data-cart-remove]")?.addEventListener("click", () => {
      const nextPlan = { ...(shoppingState.aiPlanByItem || {}) };
      const nextExecution = { ...(shoppingState.executionByItem || {}) };
      delete nextPlan[id];
      delete nextExecution[id];
      shoppingState = {
        ...shoppingState,
        items: shoppingState.items.filter((item) => item.id !== id),
        status: "",
        aiPlanByItem: nextPlan,
        executionByItem: nextExecution,
      };
      renderShoppingView();
    });
  });

  const addFromBoardButtons = workspaceTableWrap.querySelectorAll("[data-cart-add-symbol]");
  addFromBoardButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = String(btn.getAttribute("data-cart-add-symbol") || "").toUpperCase();
      if (!symbol) return;
      shoppingState = {
        ...shoppingState,
        items: [...shoppingState.items, createShoppingCartItem(symbol)],
        status: "",
        aiPlanByItem: {},
      };
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
        aiPlanByItem: {},
      };
      renderShoppingView();
    });
  });

  if (!shoppingState.loadingQuotes) {
    refreshShoppingQuotes().catch(() => ({}));
  }
  maybeLoadShoppingAgentBrief();
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
    tabName !== SEC_TAB &&
    tabName !== SHOPPING_TAB &&
    !isTickerDetailTab(tabName)
  ) {
    openTabs.add(SCHWAB_CONNECT_TAB);
    currentTab = SCHWAB_CONNECT_TAB;
    applyTabTheme(SCHWAB_CONNECT_TAB);
    titleEl.textContent = SCHWAB_CONNECT_TAB;
    subEl.textContent = "Schwab OAuth required";
    renderTabs(SCHWAB_CONNECT_TAB);
    renderSchwabConnectView();
    return;
  }

  currentTab = tabName;
  applyTabTheme(tabName);
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
            ? "Market coverage list + inline ticker workspace"
        : tabName === TIME_TAB
          ? "Market open countdown + AI playbook"
      : tabName === SEC_TAB
        ? "SEC filings + Gradient AI digest"
      : tabName === SHOPPING_TAB
        ? "Build and submit buy/sell cart orders"
      : isTickerDetailTab(tabName)
        ? "Simple ticker snapshot"
          : "Blank workspace";

  renderTabs(tabName);

  stopMarketCountdown();
  stopShoppingMarketClock();
  stopTickerIntelLiveRefresh();

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
    const targetTab = PORTFOLIO_TAB;
    loadSchwabContextData()
      .then(() => {
        if (currentTab !== targetTab) return;
        renderPortfolioView();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load portfolio data."
        }</p></div>`;
      });
    return;
  }
  if (tabName === INVESTMENTS_TAB) {
    const targetTab = INVESTMENTS_TAB;
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
          if (currentTab !== targetTab) return;
          investmentsLoadedAt = Date.now();
          renderInvestmentsView();
        })
        .catch((error) => {
          if (currentTab !== targetTab) return;
          workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
            error.message || "Failed to load market data."
          }</p></div>`;
        });
    }
    return;
  }
  if (tabName === TICKER_INTEL_TAB) {
    const targetTab = TICKER_INTEL_TAB;
    renderTickerIntelLoading();
    const needsWatchboards =
      !tickerIntelState.watchboardsLoadedAt ||
      Date.now() - Number(tickerIntelState.watchboardsLoadedAt || 0) > WATCHBOARD_LAYOUT_TTL_MS;
    if (needsWatchboards) {
      loadTickerWatchboards()
        .then(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        })
        .catch(() => {
          if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
        });
    }
    const universePromise =
      tickerIntelState.universe.length >= 50
        ? Promise.resolve(tickerIntelState.universe)
        : loadTickerUniverse(500).catch(() => DEFAULT_TICKER_WATCHLIST);
    universePromise
      .then(() => {
        if (currentTab !== targetTab) return;
        renderTickerIntelView();
        const selectedSymbol = String(tickerIntelState.selected || "").toUpperCase();
        if (selectedSymbol) {
          loadTickerIntelReport(selectedSymbol)
            .then(() => {
              if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
            })
            .catch((error) => {
              tickerIntelState = { ...tickerIntelState, loading: false, error: error.message || "Failed to load report." };
              if (currentTab === TICKER_INTEL_TAB) renderTickerIntelView();
            });
        }
        const needsFreshQuotes =
          !tickerIntelState.quotesUpdatedAt || Date.now() - tickerIntelState.quotesUpdatedAt > TICKER_QUOTES_TTL_MS;
        if (needsFreshQuotes) {
          refreshTickerUniverseQuotes({ rerender: true }).catch(() => ({}));
        }
        startTickerIntelLiveRefresh();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
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
  if (isTickerDetailTab(tabName)) {
    renderTickerDetailView(getTickerSymbolFromDetailTab(tabName));
    return;
  }
  if (tabName === TIME_TAB) {
    const targetTab = TIME_TAB;
    workspaceTableWrap.innerHTML = '<div class="do-loading">Building opening bell playbook...</div>';
    loadOpeningPlaybook()
      .then(async () => {
        if (currentTab !== targetTab) return;
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
        const openingAgentBriefs = openingPlaybook?.agentBriefs && typeof openingPlaybook.agentBriefs === "object"
          ? openingPlaybook.agentBriefs
          : {};
        const openingAgentCards = [
          { title: "Macro Agent", bullets: Array.isArray(openingAgentBriefs.macro) ? openingAgentBriefs.macro.slice(0, 3) : [] },
          { title: "Sector Agent", bullets: Array.isArray(openingAgentBriefs.sector) ? openingAgentBriefs.sector.slice(0, 3) : [] },
          { title: "Opening Agent", bullets: Array.isArray(openingAgentBriefs.opening) ? openingAgentBriefs.opening.slice(0, 3) : [] },
        ]
          .map((panel) => {
            const items = panel.bullets.length ? panel.bullets : ["Brief unavailable right now."];
            return `
              <article class="schwab-card">
                <h4>${panel.title}</h4>
                <ul class="ticker-bullets">${items.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
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
              ${openingAgentCards}
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
        if (currentTab !== targetTab) return;
        startMarketCountdown();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load opening playbook."
        }</p></div>`;
      });
    return;
  }
  if (tabName === SEC_TAB) {
    const targetTab = SEC_TAB;
    const selectedSymbols = String(secTabState.symbolsInput || "AAPL")
      .trim()
      .toUpperCase();
    const hasFresh =
      Array.isArray(secTabState.rows) &&
      secTabState.rows.length > 0 &&
      Date.now() - Number(secTabState.fetchedAt || 0) < SEC_BRIEF_TAB_TTL_MS;
    if (hasFresh) {
      renderSecView();
    } else {
      secTabState = { ...secTabState, symbolsInput: selectedSymbols, loading: true, error: "" };
      renderSecLoading(selectedSymbols);
      loadSecBrief({ symbolsInput: selectedSymbols, days: secTabState.days })
        .then(() => {
          if (currentTab !== targetTab) return;
          renderSecView();
        })
        .catch((error) => {
          if (currentTab !== targetTab) return;
          secTabState = { ...secTabState, loading: false, error: error.message || "Failed to load SEC brief." };
          renderSecView();
        });
    }
    return;
  }
  if (tabName === SHOPPING_TAB) {
    if (schwabSession.connected) {
      loadSchwabContextData()
        .catch(() => ({}))
        .finally(() => {
          if (currentTab === SHOPPING_TAB) renderShoppingView();
        });
    } else {
      renderShoppingView();
    }
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
    const targetTab = INVESTMENTS_TAB;
    renderInvestmentsLoading();
    loadInvestmentsMarketData()
      .then(() => {
        if (currentTab !== targetTab) return;
        investmentsLoadedAt = Date.now();
        renderInvestmentsView();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load market data."
        }</p></div>`;
      });
    return;
  }
  if (currentTab === PORTFOLIO_TAB) {
    const targetTab = PORTFOLIO_TAB;
    loadSchwabContextData()
      .then(() => {
        if (currentTab !== targetTab) return;
        renderPortfolioView();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load portfolio data."
        }</p></div>`;
      });
    return;
  }
  if (currentTab === TICKER_INTEL_TAB) {
    const targetTab = TICKER_INTEL_TAB;
    const universePromise =
      tickerIntelState.universe.length >= 50
        ? Promise.resolve(tickerIntelState.universe)
        : loadTickerUniverse(500).catch(() => DEFAULT_TICKER_WATCHLIST);
    universePromise
      .then(() => refreshTickerUniverseQuotes({ rerender: true, force: true }))
      .then(() => loadTickerWatchboards())
      .then(() => loadTickerIntelReport(tickerIntelState.selected || "AAPL"))
      .then(() => {
        if (currentTab !== targetTab) return;
        renderTickerIntelView();
        startTickerIntelLiveRefresh();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
        tickerIntelState = { ...tickerIntelState, loading: false, error: error.message || "Refresh failed." };
        renderTickerIntelView();
      });
    return;
  }
  if (currentTab === TIME_TAB) {
    activateTab(TIME_TAB);
    return;
  }
  if (currentTab === SEC_TAB) {
    const targetTab = SEC_TAB;
    const selectedSymbols = String(secTabState.symbolsInput || "AAPL")
      .trim()
      .toUpperCase();
    secTabState = { ...secTabState, symbolsInput: selectedSymbols, loading: true, error: "" };
    renderSecLoading(selectedSymbols);
    loadSecBrief({ symbolsInput: selectedSymbols, days: secTabState.days, force: true })
      .then(() => {
        if (currentTab !== targetTab) return;
        renderSecView();
      })
      .catch((error) => {
        if (currentTab !== targetTab) return;
        secTabState = { ...secTabState, loading: false, error: error.message || "Failed to refresh SEC brief." };
        renderSecView();
      });
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
  openTabs.add(SEC_TAB);
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
