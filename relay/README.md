# Meditor relay

A tiny Cloudflare Worker between the Meditor extension and your Glide webhook.

```
Meditor extension ──POST clip──▶ relay (Cloudflare Worker) ──POST + Authorization: Bearer ──▶ Glide
                                 holds GLIDE_WEBHOOK_URL + GLIDE_TOKEN as secrets
```

Anything inside a Chrome extension can be read by its users. So the Glide webhook URL and its bearer token live only here, as Worker secrets. The extension only knows the relay's address.

The relay forwards a request only when all of these hold:

- it's a `POST` from a Chrome extension (`Origin: chrome-extension://…`)
- the body is JSON under 16 KB
- the body is a valid clip: `url` (required, http/https), `title`, `image` (http/https or empty), `published_date` (a date or empty), and `authors` (an array of strings)

Anything else is rejected and never reaches Glide. Extra fields are dropped. Error responses never include the secrets.

> The origin check keeps web pages and casual scripts out, but it isn't authentication: anyone can fake an `Origin` header outside a browser. The relay's guarantees are that **the token never leaves Cloudflare** and **only well-formed clips reach Glide**. To restrict it further, set `ALLOWED_ORIGINS` (below) or add a rate-limiting rule in the Cloudflare dashboard.

## Deploy (about 5 minutes, free plan is fine)

### Option A: Cloudflare dashboard (no tools needed)

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Open **Workers & Pages**, click **Create**, then create a Worker from the **Hello World** template.
3. Name it `meditor-relay` and click **Deploy**.
4. Click **Edit code**, replace everything with the contents of [`src/worker.js`](src/worker.js), and click **Deploy**.
5. Go to the Worker's **Settings → Variables and Secrets** and add two variables. For both, set **Type** to **Secret**:
   - `GLIDE_WEBHOOK_URL`: your Glide webhook trigger URL (`https://go.glideapps.com/api/container/plugin/webhook-trigger/…`)
   - `GLIDE_TOKEN`: the bearer token from the Glide trigger (just the token, without `Bearer `)

   Then **Deploy**.
6. Open the Worker's URL, e.g. `https://meditor-relay.<your-subdomain>.workers.dev`. You should see:
   ```json
   {"ok":true,"service":"meditor-relay","configured":true}
   ```
   If `configured` is `false`, a secret is missing.

### Option B: Wrangler CLI

```bash
cd relay
npx wrangler login
npx wrangler deploy
npx wrangler secret put GLIDE_WEBHOOK_URL   # paste the Glide webhook URL when prompted
npx wrangler secret put GLIDE_TOKEN         # paste the bearer token when prompted
```

## Point the extension at the relay

Build the extension with the relay URL as its default, from the repo root:

```bash
echo 'https://meditor-relay.<your-subdomain>.workers.dev/' > .webhook-url
npm run package        # → dist/meditor-extension-v<version>.zip
```

Users who install that zip send clips to the relay automatically and never see a token. Existing installs that stored the Glide URL directly (v1.1 and earlier) are switched to the relay default when they update.

## Rotating the token

In Glide, regenerate the bearer token on the webhook trigger. Then update the `GLIDE_TOKEN` secret in Cloudflare. **No extension update is needed.** Until you update the secret, users see: “Glide rejected the relay’s bearer token. Update GLIDE_TOKEN in the Worker settings.”

## Optional settings

| Variable | Purpose |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins, e.g. `chrome-extension://abcdefghijklmnopabcdefghijklmnop`. By default any Chrome extension origin is accepted. Unpacked installs get a different ID per machine, so pin this only for Web Store builds. |

## Run locally

```bash
GLIDE_WEBHOOK_URL=… GLIDE_TOKEN=… npm run relay    # http://127.0.0.1:8787
```

`npm test` exercises the relay directly (validation, origin checks, error mapping, and no secret leakage). It also drives the real extension through the relay to a stand-in Glide endpoint that requires the token.
