const topTabs = document.getElementById("topTabs");
const railButtons = [...document.querySelectorAll(".rail-btn")];
const menuButtons = [...document.querySelectorAll(".menu-item")];
const titleEl = document.getElementById("workspaceTitle");
const subEl = document.getElementById("workspaceSub");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatLog = document.getElementById("chatLog");
const workspaceTableWrap = document.getElementById("workspaceTableWrap");

const DO_API_BASE = "https://api.digitalocean.com";
const TOKEN_KEY = "do_api_token";
const GRADIENT_ENDPOINT_KEY = "gradient_agent_endpoint";
const GRADIENT_KEY_KEY = "gradient_agent_key";

const openTabs = new Set(["Assets"]);
let currentTab = "Assets";

function getDoToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setDoToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function getGradientConfig() {
  const endpoint = (sessionStorage.getItem(GRADIENT_ENDPOINT_KEY) || "").trim().replace(/\/+$/, "");
  const key = sessionStorage.getItem(GRADIENT_KEY_KEY) || "";
  return { endpoint, key };
}

function setGradientConfig(endpoint, key) {
  if (endpoint) sessionStorage.setItem(GRADIENT_ENDPOINT_KEY, endpoint.trim().replace(/\/+$/, ""));
  else sessionStorage.removeItem(GRADIENT_ENDPOINT_KEY);
  if (key) sessionStorage.setItem(GRADIENT_KEY_KEY, key);
  else sessionStorage.removeItem(GRADIENT_KEY_KEY);
}

async function doApi(path, token) {
  const res = await fetch(`${DO_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.id || `HTTP ${res.status}`);
  return data;
}

function renderTabs(activeTab = "Assets") {
  topTabs.innerHTML = "";
  [...openTabs].forEach((tabName) => {
    const btn = document.createElement("button");
    btn.className = `top-tab ${tabName === activeTab ? "active" : ""}`;
    btn.dataset.tab = tabName;
    btn.textContent = tabName;
    btn.addEventListener("click", () => activateTab(tabName));
    topTabs.appendChild(btn);
  });
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

function renderSettingsView() {
  const token = getDoToken();
  const { endpoint: gradEndpoint, key: gradKey } = getGradientConfig();
  workspaceTableWrap.innerHTML = `
    <div class="settings-block">
      <h3 class="settings-title">DigitalOcean API</h3>
      <p class="settings-desc">Add a read-only Personal Access Token to view account and droplets in the DigitalOcean tab. Token is stored in this browser session only.</p>
      <label class="settings-label">API token</label>
      <input type="password" id="doTokenInput" class="settings-input" placeholder="${token ? "Token saved — paste a new token to replace" : "Paste your token"}" autocomplete="off" />
      <button type="button" id="doTokenSave" class="settings-save">Save token</button>
      ${token ? '<button type="button" id="doTokenClear" class="settings-clear">Clear token</button>' : ""}
    </div>
    <div class="settings-block settings-block-second">
      <h3 class="settings-title">Gradient™ AI (chat)</h3>
      <p class="settings-desc">Connect the right-hand chat to a DigitalOcean Gradient AI agent. Create an agent in <a href="https://cloud.digitalocean.com" target="_blank" rel="noopener">Agent Platform</a>, then add its endpoint URL and an endpoint access key here.</p>
      <label class="settings-label">Agent endpoint URL</label>
      <input type="url" id="gradientEndpointInput" class="settings-input" placeholder="https://xxxxx.agents.do-ai.run" value="${gradEndpoint || ""}" autocomplete="off" />
      <label class="settings-label">Endpoint access key</label>
      <input type="password" id="gradientKeyInput" class="settings-input" placeholder="${gradKey ? "Key saved — paste new to replace" : "Paste your agent access key"}" autocomplete="off" />
      <button type="button" id="gradientSave" class="settings-save">Save</button>
      ${gradEndpoint || gradKey ? '<button type="button" id="gradientClear" class="settings-clear">Clear</button>' : ""}
    </div>
  `;
  const input = document.getElementById("doTokenInput");
  document.getElementById("doTokenSave").addEventListener("click", () => {
    const raw = input.value.trim();
    if (raw) setDoToken(raw);
    input.value = "";
    input.placeholder = "Token saved — paste a new token to replace";
    renderSettingsView();
  });
  const clearBtn = document.getElementById("doTokenClear");
  if (clearBtn) clearBtn.addEventListener("click", () => { setDoToken(""); renderSettingsView(); });

  const epInput = document.getElementById("gradientEndpointInput");
  const keyInput = document.getElementById("gradientKeyInput");
  document.getElementById("gradientSave").addEventListener("click", () => {
    const ep = epInput.value.trim().replace(/\/+$/, "");
    const key = keyInput.value.trim();
    if (ep) sessionStorage.setItem(GRADIENT_ENDPOINT_KEY, ep);
    else sessionStorage.removeItem(GRADIENT_ENDPOINT_KEY);
    if (key) sessionStorage.setItem(GRADIENT_KEY_KEY, key);
    else sessionStorage.removeItem(GRADIENT_KEY_KEY);
    keyInput.value = "";
    keyInput.placeholder = getGradientConfig().key ? "Key saved — paste new to replace" : "Paste your agent access key";
    renderSettingsView();
  });
  const gradClearBtn = document.getElementById("gradientClear");
  if (gradClearBtn) gradClearBtn.addEventListener("click", () => { setGradientConfig("", ""); renderSettingsView(); });
}

function renderDoLoading() {
  workspaceTableWrap.innerHTML = '<div class="do-loading">Loading DigitalOcean data…</div>';
}

function renderDoError(msg) {
  workspaceTableWrap.innerHTML = `<div class="do-error"><strong>Error</strong><p>${msg}</p><p>Set your API token in Settings (G).</p></div>`;
}

function renderDoView(account, droplets) {
  const acc = account?.account || {};
  const list = droplets?.droplets || [];
  const region = (r) => (r && (r.slug || r.name)) || "—";
  const rows = list
    .map(
      (d) =>
        `<tr>
          <td>${d.name || d.id}</td>
          <td>${d.status || "—"}</td>
          <td>${region(d.region)}</td>
          <td>${d.memory || "—"} MB</td>
          <td>${d.vcpus ?? "—"}</td>
          <td>${d.disk ?? "—"} GB</td>
        </tr>`
    )
    .join("");
  workspaceTableWrap.innerHTML = `
    <div class="do-account">
      <div class="do-account-card">
        <span class="do-account-label">Account</span>
        <div class="do-account-email">${acc.email || "—"}</div>
        <div class="do-account-meta">Droplet limit: ${acc.droplet_limit ?? "—"} · Status: ${acc.status || "—"}</div>
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
      <tbody>${rows || "<tr><td colspan=\"6\">No droplets</td></tr>"}</tbody>
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
  currentTab = tabName;
  titleEl.textContent = tabName;
  subEl.textContent =
    tabName === "Assets"
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
  if (tabName === "DigitalOcean") {
    loadDoView();
    return;
  }
  if (tabName === "Settings") {
    renderSettingsView();
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
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>Blank</td>
        </tr>
      </tbody>
    </table>
  `;
}

document.querySelector(".refresh-btn").addEventListener("click", () => {
  if (currentTab === "DigitalOcean") loadDoView();
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
    subEl.textContent = btn.dataset.view || "Market Watch";
  });
});

// Conversation history for Gradient AI (OpenAI-style messages).
let chatHistory = [];

function appendChatMessage(role, content, className = "") {
  const div = document.createElement("div");
  div.className = role === "user" ? "msg me" : "msg" + (className ? " " + className : "");
  div.textContent = content;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendToGradient(userContent) {
  const { endpoint, key } = getGradientConfig();
  if (!endpoint || !key) return null;
  const url = `${endpoint}/api/v1/chat/completions`;
  const messages = [...chatHistory, { role: "user", content: userContent }];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages,
      stream: false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data.error?.message || data.message || `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  const text = data.choices?.[0]?.message?.content;
  if (text == null) throw new Error("No response content from agent");
  return text;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = chatInput.value.trim();
  if (!value) return;

  const userMsg = value;
  chatInput.value = "";
  chatHistory.push({ role: "user", content: userMsg });
  appendChatMessage("user", userMsg);

  const placeholder = document.createElement("div");
  placeholder.className = "msg msg-thinking";
  placeholder.textContent = "Thinking…";
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
      appendChatMessage("assistant", "Configure Gradient AI in Settings (G) to use the assistant.", "msg-muted");
    }
  } catch (err) {
    placeholder.remove();
    chatHistory.pop();
    const errText = err.message || String(err);
    appendChatMessage("assistant", "Error: " + errText + " — Check Settings (G) for Gradient endpoint and key.", "msg-error");
  }
});

renderTabs("Assets");
activateTab("Assets");
