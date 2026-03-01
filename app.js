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
const HOME_TAB = "Assets";
const SCHWAB_CONNECT_TAB = "Schwab Connect";
const RESPONSE_STYLE_PROMPT =
  "Reply in 3-6 concise bullet points with short, scannable lines. Keep spacing clean and avoid long paragraphs.";

const AGENTS = [
  {
    id: "market-pulse",
    tab: "Market Pulse Agent",
    subtitle: "Cross-asset market pulse and macro headlines",
    description: "Tracks broad market regime shifts, policy moves, and risk sentiment across equities, rates, FX, and commodities.",
    insights: [
      "US large-cap breadth is uneven; leadership concentration remains elevated.",
      "Rates volatility stays sensitive to inflation and labor surprises.",
      "Cross-asset correlation tends to rise during policy repricing windows.",
    ],
    prompts: [
      "Give me today's market pulse in 5 bullet points.",
      "What macro headline risk is most likely to move indices this week?",
      "Summarize risk-on vs risk-off signals right now.",
    ],
    systemPrompt:
      "You are Market Pulse Agent. Provide concise, actionable market commentary focused on macro regime, cross-asset flow, and headline risk for investors.",
  },
  {
    id: "equity-intel",
    tab: "Equity Intel Agent",
    subtitle: "Stocks, sectors, earnings, and equity positioning",
    description: "Focuses on stock-specific catalysts, sector rotation, earnings revisions, and valuation context.",
    insights: [
      "Mega-cap earnings quality still drives index-level momentum.",
      "Estimate revisions and guidance language are key near-term equity drivers.",
      "Sector leadership can rotate quickly when real yields reprice.",
    ],
    prompts: [
      "Which sectors look strongest this week and why?",
      "What are the top earnings watch names for this month?",
      "Compare growth vs value risk in this tape.",
    ],
    systemPrompt:
      "You are Equity Intel Agent. Deliver institutional-style equity insights: catalysts, sector trends, earnings context, and risk scenarios.",
  },
  {
    id: "macro-rates",
    tab: "Macro & Rates Agent",
    subtitle: "Policy path, inflation prints, and yield curve signals",
    description: "Interprets economic releases and central bank communication into rates and positioning implications.",
    insights: [
      "Front-end rates react fastest to policy communication shifts.",
      "Curve steepening vs flattening regimes matter for sector performance.",
      "Inflation surprise direction strongly influences duration demand.",
    ],
    prompts: [
      "How does the latest inflation trend affect rates and equities?",
      "What is the current yield curve signal telling us?",
      "Give me a base case and bear case for policy path this quarter.",
    ],
    systemPrompt:
      "You are Macro & Rates Agent. Explain rate-market implications of macro data with clear base/bull/bear scenarios.",
  },
  {
    id: "bond-credit",
    tab: "Bond & Credit Agent",
    subtitle: "Treasuries, IG/HY spreads, funding, and credit stress",
    description: "Monitors bond markets, credit spread behavior, and refinancing risk across quality tiers.",
    insights: [
      "Spread compression can reverse quickly when growth concerns rise.",
      "Refinancing windows and coupon burden matter for lower-quality issuers.",
      "Credit stress often appears in liquidity metrics before price gaps.",
    ],
    prompts: [
      "What are current credit spread risks in IG vs HY?",
      "Where do you see default risk pockets forming?",
      "How should I interpret today's move in Treasury yields for bonds?",
    ],
    systemPrompt:
      "You are Bond & Credit Agent. Provide fixed-income and credit risk insight with practical investor implications.",
  },
  {
    id: "commodity-energy",
    tab: "Commodity & Energy Agent",
    subtitle: "Oil, gas, metals, and supply-demand narrative shifts",
    description: "Tracks commodity price drivers including geopolitics, inventory trends, and demand signals.",
    insights: [
      "Energy curves reflect both geopolitics and demand expectations.",
      "Inventory and shipping constraints can trigger short volatility bursts.",
      "Commodity inflation can feed back into rates and equity factor pricing.",
    ],
    prompts: [
      "What is driving crude oil right now?",
      "How do energy moves impact inflation-sensitive sectors?",
      "Give me a 2-week outlook for major commodities.",
    ],
    systemPrompt:
      "You are Commodity & Energy Agent. Focus on commodity fundamentals, macro linkages, and forward-looking scenario analysis.",
  },
  {
    id: "risk-sentinel",
    tab: "Risk Sentinel Agent",
    subtitle: "Portfolio risk checks, stress scenarios, and hedging ideas",
    description: "Acts as a risk officer, highlighting concentration risk, volatility triggers, and downside scenarios.",
    insights: [
      "Position concentration increases drawdown risk during factor rotations.",
      "Volatility clustering often follows headline-driven regime breaks.",
      "Hedge timing and sizing matter as much as instrument choice.",
    ],
    prompts: [
      "Run a quick risk check for a growth-heavy portfolio.",
      "What are top downside scenarios over the next 30 days?",
      "Suggest practical hedging approaches for index and rates risk.",
    ],
    systemPrompt:
      "You are Risk Sentinel Agent. Prioritize risk management, scenario planning, and practical hedging guidance.",
  },
];

const AGENT_BY_ID = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent]));
const AGENT_BY_TAB = Object.fromEntries(AGENTS.map((agent) => [agent.tab, agent]));

const openTabs = new Set([HOME_TAB]);
let currentTab = HOME_TAB;
let currentAgentId = AGENTS[0].id;
const announcedAgents = new Set();

let chatHistory = [];
let schwabSession = { connected: false };
let schwabData = { accounts: null, openOrders: null };

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

function renderTabs(activeTab = "Assets") {
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
  if (tabName === HOME_TAB || !openTabs.has(tabName)) return;
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
  if (!schwabSession.connected && tabName !== SCHWAB_CONNECT_TAB && tabName !== "Settings") {
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
      : tabName === "Assets"
      ? "Market Watch"
      : tabName === "DigitalOcean"
        ? "Account & Droplets"
        : tabName === "Settings"
          ? "API token"
          : "Blank workspace";

  renderTabs(tabName);

  if (tabName === "Assets") {
    renderAssetsView();
    return;
  }
  if (tabName === SCHWAB_CONNECT_TAB) {
    renderSchwabConnectView();
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
  if (currentTab === "DigitalOcean") {
    loadDoView();
    return;
  }
  const agent = AGENT_BY_TAB[currentTab];
  if (agent) {
    renderAgentView(agent);
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
  const schwabContext = schwabSession.connected
    ? `Schwab context: connected account count=${schwabSession.accountCount || 0}, primary account hash=${
        schwabSession.accountHash || "unknown"
      }, open orders=${Array.isArray(schwabData.openOrders?.orders) ? schwabData.openOrders.orders.length : 0}.`
    : "Schwab context unavailable (user not connected).";
  const messages = [
    { role: "system", content: agent.systemPrompt },
    { role: "system", content: RESPONSE_STYLE_PROMPT },
    { role: "system", content: schwabContext },
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
  if (!schwabSession.connected) {
    appendChatMessage(
      "assistant",
      "Please connect your Charles Schwab account first to use the app and AI assistant.",
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
  if (schwabSession.connected) {
    activateTab(HOME_TAB);
  } else {
    openTabs.add(SCHWAB_CONNECT_TAB);
    activateTab(SCHWAB_CONNECT_TAB);
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
