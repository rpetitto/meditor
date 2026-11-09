# Chrome Web Store submission: Meditor

Copy each value into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). The fields below follow the dashboard's tabs.

**Upload:** `dist/meditor-extension-v1.3.0.zip` (built with `npm run package`, with the relay URL in `.webhook-url`).

---

## Store listing tab

**Name** (from the manifest): `Meditor — News Clipper`

**Summary** (from the manifest, 132 characters max):
```
Spots news articles and clips their link, headline, lead image, publish date and authors to your Glide app.
```

**Description:**
```
Meditor turns any news article into a clean, structured clip for your Glide app in one click.

Open an article, click the Meditor icon, and Meditor shows:
• Whether the page is a news article, with a confidence score you can expand to see why
• A preview of the headline, lead image, publication and byline
• Editable fields, so you can fix anything before it's sent
• The exact JSON that will be sent

Press "Send to Glide" and the clip arrives in your Glide app with five fields: url, title, image, published_date and authors. Links are cleaned of tracking parameters, dates are ISO 8601, and authors are split into a proper list.

Built to read real newsrooms: Meditor understands schema.org NewsArticle markup (including complex JSON-LD graphs), Open Graph and article meta tags, Parse.ly and Dublin Core metadata, and plain bylines and timestamps on pages that have no metadata at all.

PRIVATE BY DEFAULT
• Meditor reads a page only when you click its icon.
• Want the ✓ badge on articles as you browse? Switch on Automatic detection in Settings. Chrome asks your permission first, and detection runs inside your browser.
• Nothing is sent until you press Send (or turn on Auto-send).
• No analytics, no tracking, no ads.

ALSO INCLUDES
• Auto-send: send articles automatically above a confidence threshold you choose, once per article
• Recent clips history, kept only on your computer
• Keyboard shortcuts: Alt+Shift+N opens Meditor; Ctrl/⌘+Enter sends
• Light and dark themes
```

**Category:** Productivity → Workflow & Planning (or "Tools")

**Language:** English

**Graphic assets** (all in `store/`):

| Dashboard field | File |
| --- | --- |
| Store icon (128×128) | taken from the zip (`icons/icon128.png`) |
| Screenshots (1280×800) | `screenshot-1.png` … `screenshot-5.png` |
| Small promo tile (440×280) | `promo-small.png` |
| Marquee promo tile (1400×560) | `promo-marquee.png` |

**Official URL:** none · **Homepage URL:** `https://github.com/rpetitto/meditor` · **Support URL:** `https://github.com/rpetitto/meditor/issues`

**Mature content:** No

---

## Privacy practices tab

**Single purpose:**
```
Clip news articles: detect when the current page is a news article, show its link, headline, lead image, publish date and authors, and send them to the publisher's Glide app when the user chooses.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `activeTab` | Reads the current tab only when the user clicks the Meditor icon or presses its shortcut, to extract the article details shown in the popup. |
| `scripting` | Runs Meditor's own bundled extractor script (src/content/extract.js) in the current tab after the user clicks the icon. If the user turns on Automatic detection, it registers the same bundled script for http/https pages. No remote code is ever injected. |
| `storage` | Saves the user's settings (destination URL, Automatic detection, Auto-send threshold) and a local history of the last 100 clips. |
| Host permissions (optional: `https://*/*`, `http://*/*`) | Not requested at install. Requested only when the user switches on Automatic detection in Settings (to show the article badge while browsing), or saves a destination on a different host. Detection runs locally; data is sent only when the user presses Send or enables Auto-send. |

**Are you using remote code?** No, I am not using remote code.
```
All JavaScript is included in the package. The only network request is a JSON POST of the clip to the configured destination.
```

**Data usage.** Check these two:
- ☑ **Web history**: the addresses of pages the user chooses to clip
- ☑ **Website content**: the headline, lead image address, publish date and author names of clipped pages

Leave everything else unchecked: personally identifiable info, health, financial, authentication, personal communications, location, user activity.

**Certifications.** Check all three:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
```
https://github.com/rpetitto/meditor/blob/claude/blissful-bell-4u0z34/PRIVACY.md
```
(Once this branch is merged, switch to `…/blob/main/PRIVACY.md`.)

---

## Distribution tab

- **Visibility:** **Unlisted**. Only people with the link can install it.
- **Regions:** All regions

---

## Test instructions (optional "Instructions for reviewers" field)

```
1. Open a news article, e.g. https://www.bbc.com/news (pick any story) or https://apnews.com.
2. Click the Meditor icon. The popup shows "News article detected" with the extracted fields.
3. Press "Send to Glide". The clip is delivered to the developer's Glide app through the developer's relay; the button turns green.
4. Optional: Settings → Automatic detection asks for all-sites access and then shows a ✓ badge on articles while browsing.
No account or login is needed.
```

> Reviewers' test clips will appear as rows in your Glide app. Delete them after approval.
