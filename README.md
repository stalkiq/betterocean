# BetterOcean

Static web app shell with backend APIs for an **investing platform** powered by [DigitalOcean Gradient™ AI](https://docs.digitalocean.com/products/gradient-ai-platform) and **Charles Schwab OAuth + trading APIs**.

- **Frontend:** Static HTML/CSS/JS (three-pane UI: rail, workspace, Gradient™ AI chat).
- **Backend:** App Platform service `POST /api/chat/message` proxies chat to Gradient AI; credentials stay on the server so all users get the same assistant without configuring anything in the app.
- **Broker auth/data:** Charles Schwab OAuth login per user with server-side token handling and Schwab account/market/trading routes.

## Run locally

```bash
npx serve
```

Then open **http://localhost:3000** (or the URL shown). Chat will only work when deployed (the `/api` route is served by App Platform). Or open `index.html` in a browser for UI only.

## Notes

- This repo is intentionally independent from other projects.
- Rail buttons open blank tabs in the center workspace.
- Left menu remains interactive and updates the active subview label.

## DigitalOcean integration

The **DO** rail tab shows your DigitalOcean account info and droplets using the [DigitalOcean API](https://docs.digitalocean.com/reference/api/).

1. **Get a token**  
   In the [DigitalOcean Control Panel](https://cloud.digitalocean.com/account/api/tokens), create a Personal Access Token with **Read** scope (or at least `account:read` and `droplet:read`).

2. **Add the token in the app**  
   Open the **Settings** tab (G on the rail), paste your token in **API token**, and click **Save token**. The token is stored only in this browser session (sessionStorage).

3. **View account and droplets**  
   Open the **DigitalOcean** tab (DO on the rail). The workspace shows your account (email, droplet limit, status) and a table of droplets (name, status, region, memory, vCPUs, disk). Use **Refresh** to reload.

The app calls `https://api.digitalocean.com` for `GET /v2/account` and `GET /v2/droplets` as described in the public API spec.

## Gradient™ AI (chat, in the background)

The right-hand chat is powered by Gradient AI via a **backend API service**. Users do not configure anything; you set Gradient once in App Platform.

1. **Create an agent**  
   In the [DigitalOcean Control Panel](https://cloud.digitalocean.com), go to **Agent Platform** → create or open a workspace → **Create Agent**. Name it, set instructions (e.g. for investing/markets), choose a model, and create the agent.

2. **Get endpoint and access key**  
   On the agent’s **Overview** tab, copy the **Endpoint** URL (e.g. `https://xxxxx.agents.do-ai.run`). In the agent’s **Settings** tab, under **Endpoint Access Keys**, click **Create Key**, name it, then copy the secret key (shown only once).

3. **Configure in App Platform**  
   In your app’s dashboard, open the **api** (Service) component → **Settings** → **Environment Variables**. Add:
   - `GRADIENT_AGENT_ENDPOINT` = the agent endpoint URL  
   - `GRADIENT_AGENT_KEY` = the endpoint access key (mark as **Encrypt** / secret)  
   Save and redeploy if needed.

4. **Chat**  
   Users type in the chat; the frontend sends `POST /api/chat/message` with the conversation history. The backend service calls Gradient with the env credentials and returns the reply. No keys or config are exposed to the browser.

## Charles Schwab OAuth + Trading

Users must connect their Schwab account to use core app features.

1. **Create Schwab app**  
   In the [Schwab Developer Portal](https://developer.schwab.com), create your app and set callback URL(s):
   - Production: `https://seal-app-m5pqo.ondigitalocean.app/api/schwab/callback`
   - Optional local: `http://localhost:8080/api/schwab/callback`

2. **Configure env vars on `api` service**  
   In App Platform, add:
   - `SCHWAB_CLIENT_ID` (secret)
   - `SCHWAB_CLIENT_SECRET` (secret)
   - `SCHWAB_REDIRECT_URI` (general, usually your production callback)
   - `SESSION_SECRET` (secret random string)
   - `SCHWAB_DRY_RUN` (`true` for safety while testing order flow)
   - `SCHWAB_MAX_ORDER_QTY` (guardrail, default `1000`)

3. **OAuth flow**  
   - `GET /api/schwab/login` -> redirects user to Schwab auth page
   - `GET /api/schwab/callback` -> backend exchanges code for tokens and stores session cookie
   - `GET /api/schwab/me` -> returns connected session summary
   - `POST /api/schwab/logout` -> disconnects Schwab session

4. **Schwab data and trading endpoints**
   - `GET /api/schwab/accounts`
   - `GET /api/schwab/positions?accountHash=...`
   - `GET /api/schwab/balances?accountHash=...`
   - `GET /api/schwab/orders/open?accountHash=...`
   - `GET /api/schwab/quotes?symbols=AAPL,MSFT`
   - `POST /api/schwab/orders` (place order)
   - `DELETE /api/schwab/orders/:orderId?accountHash=...` (cancel order)

All Schwab tokens stay on the backend. The browser only receives session-level status and route responses.

## Host on DigitalOcean (App Platform)

The app has two components: a **static site** (web shell) and a **Service** component (backend API for chat). Deploy from the same repo.

### 1. Push the repo to GitHub

Push this project to a GitHub repo (e.g. `stalkiq/betterocean`).

### 2. Create or update the app in DigitalOcean

1. Go to [DigitalOcean Apps](https://cloud.digitalocean.com/apps).
2. Create a new app from GitHub, or update the existing app’s spec to use `.do/app.yaml` from this repo.
3. The spec defines:
   - **web** (static site): source `/`, serves the shell.
   - **api** (service): source `api-service/`, route `/api`; exposes `POST /api/chat/message`.
4. Add environment variables to the **api** component for Gradient + Schwab (see sections above).
5. Deploy. The live URL serves the static site at `/` and the chat API at `/api/chat/message`.
