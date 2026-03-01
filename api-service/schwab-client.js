const https = require("https");

const OAUTH_AUTHORIZE_URL =
  process.env.SCHWAB_OAUTH_AUTHORIZE_URL || "https://api.schwabapi.com/v1/oauth/authorize";
const OAUTH_TOKEN_URL =
  process.env.SCHWAB_OAUTH_TOKEN_URL || "https://api.schwabapi.com/v1/oauth/token";
const TRADER_BASE_URL =
  process.env.SCHWAB_TRADER_BASE_URL || "https://api.schwabapi.com/trader/v1";
const MARKETDATA_BASE_URL =
  process.env.SCHWAB_MARKETDATA_BASE_URL || "https://api.schwabapi.com/marketdata/v1";

function requestJson(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload =
      body == null ? null : typeof body === "string" ? body : JSON.stringify(body);

    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          ...headers,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data = {};
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = { raw };
            }
          }
          resolve({ status: res.statusCode || 500, data, headers: res.headers });
        });
      }
    );

    req.setTimeout(25000, () => req.destroy(new Error("Schwab request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function assertCredentials() {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    const err = new Error(
      "Schwab OAuth is not configured. Missing SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, or SCHWAB_REDIRECT_URI."
    );
    err.code = "SCHWAB_CONFIG_MISSING";
    throw err;
  }

  return { clientId, clientSecret, redirectUri };
}

function buildAuthorizeUrl(state) {
  const { clientId, redirectUri } = assertCredentials();
  const scope = process.env.SCHWAB_OAUTH_SCOPE;

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

async function exchangeCodeForToken(code) {
  const { clientId, clientSecret, redirectUri } = assertCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }).toString();

  const result = await requestJson(
    "POST",
    OAUTH_TOKEN_URL,
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    payload
  );

  if (result.status < 200 || result.status >= 300) {
    const err = new Error(
      result.data?.error_description || result.data?.error || `Schwab token exchange failed (${result.status})`
    );
    err.status = result.status;
    err.payload = result.data;
    throw err;
  }

  return {
    accessToken: result.data.access_token,
    refreshToken: result.data.refresh_token,
    expiresIn: Number(result.data.expires_in || 1800),
    refreshExpiresIn: Number(result.data.refresh_token_expires_in || 604800),
    tokenType: result.data.token_type || "Bearer",
    createdAt: Date.now(),
  };
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = assertCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  const result = await requestJson(
    "POST",
    OAUTH_TOKEN_URL,
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    payload
  );

  if (result.status < 200 || result.status >= 300) {
    const err = new Error(
      result.data?.error_description || result.data?.error || `Schwab token refresh failed (${result.status})`
    );
    err.status = result.status;
    err.payload = result.data;
    throw err;
  }

  return {
    accessToken: result.data.access_token,
    refreshToken: result.data.refresh_token || refreshToken,
    expiresIn: Number(result.data.expires_in || 1800),
    refreshExpiresIn: Number(result.data.refresh_token_expires_in || 604800),
    tokenType: result.data.token_type || "Bearer",
    createdAt: Date.now(),
  };
}

function tokenWillExpireSoon(tokenBundle, seconds = 60) {
  if (!tokenBundle || !tokenBundle.createdAt || !tokenBundle.expiresIn) return true;
  const expiresAt = tokenBundle.createdAt + tokenBundle.expiresIn * 1000;
  return Date.now() + seconds * 1000 >= expiresAt;
}

async function schwabApiRequest(tokenBundle, method, path, query = null, body = null) {
  const full = path.startsWith("/marketdata/")
    ? `${MARKETDATA_BASE_URL}${path.replace("/marketdata", "")}`
    : `${TRADER_BASE_URL}${path}`;
  const url = new URL(full);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  const result = await requestJson(
    method,
    url.toString(),
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenBundle.accessToken}`,
    },
    body
  );

  return result;
}

module.exports = {
  OAUTH_AUTHORIZE_URL,
  OAUTH_TOKEN_URL,
  TRADER_BASE_URL,
  MARKETDATA_BASE_URL,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  tokenWillExpireSoon,
  schwabApiRequest,
  assertCredentials,
};
