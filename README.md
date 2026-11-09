# Meditor — News Clipper

A Chrome extension that recognizes when you're reading a news article, pulls out its key details, and sends them to a Glide webhook in one click.

![The Meditor popup: detection, preview, editable fields, JSON payload and dark mode](docs/popup-tour.png)

## What it sends

Each clip is a `POST` with `Content-Type: application/json` and exactly this shape:

```json
{
  "url": "https://www.example.com/2026/11/08/city-council-approves-riverfront-park-plan/",
  "title": "City council approves riverfront park plan after “marathon” session",
  "image": "https://www.example.com/media/riverfront-park.jpg",
  "published_date": "2026-11-08T19:30:00.000Z",
  "authors": ["María José Álvarez", "John E. Smith"]
}
```

| Field | Value |
| --- | --- |
| `url` | The page's canonical URL, with tracking parameters (`utm_*`, `fbclid`, `gclid`, …) and `#fragments` removed. |
| `title` | The article headline, with the trailing “– Site Name” removed. |
| `image` | The absolute URL of the lead image. |
| `published_date` | ISO 8601 in UTC, or `""` if the page has no date. |
| `authors` | Each author as a separate string, with “By …” and the publisher name removed. Empty array if none found. |

Clips go to your Glide **webhook trigger** URL
(`https://go.glideapps.com/api/container/plugin/webhook-trigger/…`).

## Install

1. Get the extension folder, either way:
   - Unzip a packaged build (`meditor-extension-v1.1.0.zip`), which already has your webhook built in.
   - Or clone this repo and use the `extension/` folder.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder (or `extension/`).
4. Pin Meditor from the puzzle-piece menu so the shield stays on your toolbar.

If the build has no webhook built in, Settings opens on install. Paste your Glide webhook URL and press **Save**.

### Glide bearer token (fixes HTTP 401)

If your Glide webhook trigger has a **bearer token**, Glide rejects any request without it with **401 Unauthorized**. To fix it:

1. In Glide, open the workflow, select the **Webhook** trigger, and copy the bearer token from the right-hand panel.
2. In Meditor **Settings**, paste it into **Bearer token**. Either `abc123` or `Bearer abc123` works.
3. Press **Save**, then **Send test payload** to confirm.

Meditor sends the token as `Authorization: Bearer <token>`. It is stored only on this device (`chrome.storage.local`), is never synced, and is never written to the clip history. If you'd rather not use a token, delete it on the Glide trigger (the ✕ button), but then anyone with the URL can post to your app.

Works in Chrome 110+ and other Chromium browsers (Edge, Brave, Arc).

### Why the webhook URL isn't in this repo

Anyone holding a Glide webhook trigger URL can post rows into your app, so treat it like a password. The source ships with an empty default. `npm run package` bakes your URL into the zip from either of these, and never writes it back to the source:

- a gitignored `.webhook-url` file at the repo root, or
- the `MEDITOR_WEBHOOK_URL` environment variable

The bearer token works the same way, from `.webhook-token` or `MEDITOR_WEBHOOK_TOKEN`.

```bash
echo 'https://go.glideapps.com/api/container/plugin/webhook-trigger/<app>/<trigger>' > .webhook-url
npm run package      # → dist/meditor-extension-v<version>.zip with that URL as the default
```

If a URL ever leaks, rotate it in Glide: delete the webhook trigger and create a new one.

## Using it

- **The toolbar badge tells you at a glance.** <kbd>✓</kbd> green means a news article was detected, <kbd>?</kbd> amber means it might be one, and <kbd>↑</kbd> navy means you already sent this page.
- **Click the icon** (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>) to see the detection score, a preview card and every field.
- **Fix anything before sending.** Title, URL, image, date and author chips are all editable, and the *JSON payload* tab shows exactly what will be posted.
- **Click Send to Glide** (or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>). The button turns green when the webhook accepts the clip. If it fails, it turns red and shows the reason.
- On pages that don't look like articles, the button becomes **Send anyway**. Detection guides you but never blocks you.

### Settings

Right-click the icon and choose **Options**, or click the gear in the popup.

- **Webhook URL** and **Bearer token**: change the destination, send a test payload, or reset to the built-in default. Saving a URL on another host asks Chrome for permission to contact that host only.
- **Auto-send** (off by default): sends articles as soon as you open them if their score meets your minimum confidence (default 70%). Each URL is sent only once.
- **Recent clips**: the last 100 sends with status, kept only in this browser.

## How detection works

The content script scores each page from signals it finds:

| Signal | Effect |
| --- | --- |
| Schema.org `NewsArticle` family (JSON-LD or microdata) | strong + |
| Schema.org `Article` / `BlogPosting` | + |
| `og:type = article`, `article:*` meta tags | + |
| Publish date, byline, `<article>` with headline and timestamp | + |
| Substantial body text (paragraph word count) | + |
| Dated or headline-style URL, known news publisher | small + |
| Homepage, section front, tag/category index, product/video/profile pages | − |
| Reference and social sites (Wikipedia, GitHub, YouTube, …) | − |

A score of 55 or more counts as an **article**, 30–54 as **maybe**, and anything lower as **not an article**. Expand the verdict in the popup to see which signals fired.

Each field is extracted from the most reliable source first:

- JSON-LD, including Yoast-style `@graph` documents with `@id` references
- Open Graph / Twitter / Parse.ly / Dublin Core meta tags
- Microdata
- The visible page: byline elements, `<time>`, the first large `<img>`, and dates in the URL

Tested against live articles from BBC, NPR, CNN, Al Jazeera, TechCrunch, Ars Technica and The Verge. All were detected at 100% with correct fields. Section fronts, homepages and Wikipedia were correctly rejected.

## Privacy

- Detection runs entirely inside your browser.
- Nothing is sent anywhere until you click **Send**, or until you turn on auto-send.
- The only network request the extension makes is the webhook `POST`, sent without cookies.
- Settings sync through your Chrome profile. Clip history stays in local extension storage.

## Development

```
extension/            ← the unpacked extension (load this folder)
  manifest.json         Manifest V3
  src/content/extract.js  detection + extraction (runs on every http/https page)
  src/background.js       badge, webhook POST, history, auto-send
  src/popup/              toolbar popup
  src/options/            settings page
  src/shared/             settings helpers + design tokens
  icons/                  generated from assets/logo-source.png
tests/                ← fixtures + end-to-end test runner
scripts/              ← icon builder and packager
```

```bash
npm install          # Playwright for the tests
npm test             # extractor + full extension end-to-end tests
npm run screenshots  # tests, plus refreshed images in docs/
npm run icons        # rebuild icons from assets/logo-source.png
npm run package      # dist/meditor-extension-v<version>.zip (+ .webhook-url / .webhook-token, if present)
```

The end-to-end tests load the real extension in Chromium and drive the badge, popup, editing, sending, error handling, auto-send and settings page. They post to a local stand-in webhook, never the real Glide one.
