# BetterOcean UI Scaffold

Standalone static scaffold that mirrors the requested three-pane command UI:

- Left icon rail with hollow buttons
- Left assets menu
- Center workspace with tabs and assets table
- Right assistant chat panel

## Run locally

```bash
npm install
npm run dev
```

Then open the localhost URL shown in the terminal (e.g. **http://localhost:3000**).

Alternatively, open `index.html` directly in a browser or use any static server.

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

## Gradient™ AI (chat)

The right-hand **Assistant** chat is wired to [DigitalOcean Gradient™ AI Platform](https://docs.digitalocean.com/products/gradient-ai-platform). You can connect it to a Gradient AI agent so the chat uses your agent (with optional knowledge bases, guardrails, and models).

1. **Create an agent**  
   In the [DigitalOcean Control Panel](https://cloud.digitalocean.com), go to **Agent Platform** → create or open a workspace → **Create Agent**. Name it, set instructions, choose a model, and create the agent.

2. **Get endpoint and access key**  
   On the agent’s **Overview** tab, copy the **Endpoint** URL (e.g. `https://xxxxx.agents.do-ai.run`). In the **Settings** tab, under **Endpoint Access Keys**, click **Create Key**, name it, then copy the secret key (it’s shown only once).

3. **Configure in the app**  
   Open the **Settings** tab (G) in BetterOcean. In **Gradient™ AI (chat)**, paste the **Agent endpoint URL** and **Endpoint access key**, then click **Save**.

4. **Use the chat**  
   Type in the Assistant box and send. Messages are sent to your agent’s Chat Completions API (`POST .../api/v1/chat/completions`) with full conversation history. Responses appear in the chat; errors (e.g. wrong key or CORS) show in the thread with a hint to check Settings.

If Gradient is not configured, the chat will ask you to configure it in Settings.

## Host on DigitalOcean (App Platform)

You can deploy this app as a **static website** on [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform) so it’s available at a public URL (e.g. `https://betterocean-xxxxx.ondigitalocean.app`).

### 1. Push the repo to GitHub

If it isn’t already there, push this project to a GitHub repo (e.g. `your-username/betterocean`).

### 2. Edit the app spec (if needed)

Open `.do/app.yaml` and set `github.repo` to your actual repo:

```yaml
repo: your-username/betterocean   # use your GitHub owner and repo name
```

Use the same `branch` you deploy from (e.g. `main`).

### 3. Create the app in DigitalOcean

1. Go to [DigitalOcean Apps](https://cloud.digitalocean.com/apps).
2. Click **Create App**.
3. Choose **GitHub** as the source and authorize DigitalOcean if prompted.
4. Select the **betterocean** repo (or the repo you pushed) and the **main** branch.
5. App Platform will detect the static site from `.do/app.yaml` (or add a Static Site component, set **Source Directory** to `/`, **Environment** to **HTML**).
6. Click **Next**, review plan (static sites have a free tier), then **Create Resources**.

After the first deployment finishes, your site will be live at the app URL. New pushes to the connected branch will trigger automatic deploys if `deploy_on_push` is `true` in the spec.
