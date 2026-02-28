const topTabs = document.getElementById("topTabs");
const railButtons = [...document.querySelectorAll(".rail-btn")];
const menuButtons = [...document.querySelectorAll(".menu-item")];
const titleEl = document.getElementById("workspaceTitle");
const subEl = document.getElementById("workspaceSub");
const rowsEl = document.getElementById("rows");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatLog = document.getElementById("chatLog");

const openTabs = new Set(["Assets"]);

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

function activateTab(tabName) {
  titleEl.textContent = tabName;
  subEl.textContent = tabName === "Assets" ? "Market Watch" : "Blank workspace";
  renderTabs(tabName);

  if (tabName === "Assets") {
    rowsEl.innerHTML = `
      <tr><td>S&P 500 ETF (SPY)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td>Apple (AAPL)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td>Microsoft (MSFT)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td>Crude Oil (CL.F)</td><td>67.02</td><td class="up">+2.56%</td><td>65.35</td><td>67.83</td><td>64.85</td><td>—</td></tr>
      <tr><td>Natural Gas (NG.F)</td><td>2.859</td><td class="up">+0.95%</td><td>2.832</td><td>2.894</td><td>2.818</td><td>—</td></tr>
    `;
    return;
  }

  rowsEl.innerHTML = `
    <tr>
      <td>${tabName} tab is ready</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>Blank</td>
    </tr>
  `;
}

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

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = chatInput.value.trim();
  if (!value) return;

  const me = document.createElement("div");
  me.className = "msg me";
  me.textContent = value;
  chatLog.appendChild(me);

  const bot = document.createElement("div");
  bot.className = "msg";
  bot.textContent = "Got it. This is a placeholder assistant panel for BetterOcean.";
  chatLog.appendChild(bot);

  chatInput.value = "";
  chatLog.scrollTop = chatLog.scrollHeight;
});

renderTabs("Assets");
