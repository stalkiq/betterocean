const topTabs = document.getElementById("topTabs");
const railButtons = [...document.querySelectorAll(".rail-btn")];
const menuButtons = [...document.querySelectorAll(".menu-item")];
const titleEl = document.getElementById("workspaceTitle");
const subEl = document.getElementById("workspaceSub");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatLog = document.getElementById("chatLog");
const workspaceTableWrap = document.getElementById("workspaceTableWrap");
const chatPanelTitle = document.getElementById("chatPanelTitle");
const chatPanelBadge = document.getElementById("chatPanelBadge");

const DO_API_BASE = "https://api.digitalocean.com";
const TOKEN_KEY = "do_api_token";
const API_CHAT_URL = "/api/chat/message";
const SCHWAB_CONNECT_TAB = "Schwab Connect";
const INVESTMENTS_TAB = "Investments";
const HOME_TAB = SCHWAB_CONNECT_TAB;
const RESPONSE_STYLE_PROMPT =
  "Reply in 3-6 concise bullet points with short, scannable lines. Keep spacing clean and avoid long paragraphs.";

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

const openTabs = new Set([HOME_TAB, INVESTMENTS_TAB]);
let currentTab = HOME_TAB;
let currentAgentId = AGENTS[0].id;
const announcedAgents = new Set();

let chatHistory = [];
let schwabSession = { connected: false };
let schwabData = { accounts: null, openOrders: null };
let investmentsMarket = { assets: [], updatedAt: null };

function getDoToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setDoToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
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
  if (tabName === HOME_TAB || tabName === INVESTMENTS_TAB || !openTabs.has(tabName)) return;
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

  const cardHtml = top
    .map(
      (asset) => `
      <article class="schwab-metric-card">
        <h4>${asset.label}</h4>
        <div class="schwab-metric-value small">$${Number(asset.close || 0).toFixed(2)}</div>
        <div class="settings-desc">O:${Number(asset.open || 0).toFixed(2)} H:${Number(asset.high || 0).toFixed(
          2
        )} L:${Number(asset.low || 0).toFixed(2)}</div>
      </article>
    `
    )
    .join("");

  const rows = assets
    .map(
      (asset) => `
      <tr>
        <td>${asset.label}</td>
        <td>${asset.symbol}</td>
        <td>$${Number(asset.close || 0).toFixed(2)}</td>
        <td>${Number(asset.open || 0).toFixed(2)}</td>
        <td>${Number(asset.high || 0).toFixed(2)}</td>
        <td>${Number(asset.low || 0).toFixed(2)}</td>
        <td>${Number(asset.volume || 0).toLocaleString()}</td>
      </tr>
    `
    )
    .join("");

  workspaceTableWrap.innerHTML = `
    <div class="agent-view">
      <section class="agent-hero">
        <h3>Investments Dashboard</h3>
        <p>Public market dashboard powered by backend market feeds. Schwab account login is optional for this tab.</p>
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
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7">No market data available.</td></tr>'}</tbody>
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
    tabName !== INVESTMENTS_TAB
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
      : tabName === "DigitalOcean"
        ? "Account & Droplets"
        : tabName === "Settings"
          ? "API token"
          : "Blank workspace";

  renderTabs(tabName);

  if (tabName === SCHWAB_CONNECT_TAB) {
    renderSchwabConnectView();
    return;
  }
  if (tabName === INVESTMENTS_TAB) {
    renderInvestmentsLoading();
    loadInvestmentsMarketData()
      .then(() => renderInvestmentsView())
      .catch((error) => {
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load market data."
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

document.querySelector(".refresh-btn").addEventListener("click", () => {
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
      .then(() => renderInvestmentsView())
      .catch((error) => {
        workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${
          error.message || "Failed to load market data."
        }</p></div>`;
      });
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
  if (!schwabSession.connected && currentTab !== INVESTMENTS_TAB) {
    appendChatMessage(
      "assistant",
      "Please connect your Charles Schwab account first for account-specific analysis. You can still use the Investments tab without login.",
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

  await refreshSchwabSession();
  if (schwabSession.connected) {
    await loadSchwabContextData();
  }

  renderTabs(HOME_TAB);
  openTabs.add(INVESTMENTS_TAB);
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
