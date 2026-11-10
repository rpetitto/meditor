# Chrome Web Store submission: mEditor

Copy each value into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). The fields below follow the dashboard's tabs.

**Upload:** `dist/meditor-extension-v1.3.2.zip` (built with `npm run package`, with the relay URL in `.webhook-url`).

---

## Store listing tab

**Name** (from the manifest): `mEditor — News Clipper`

**Summary** (from the manifest, 132 characters max):
```
Spots news articles and clips their link, headline, lead image, publish date and authors to mEditor.
```

**Description:**
```
mEditor turns any news article into a clean clip in one click.

Open an article, click the mEditor icon, and you'll see:
• Whether the page is a news article, with a confidence score you can expand to see why
• A preview of the headline, lead image, publication and byline
• Editable fields, so you can fix anything before it's saved

Press "Send to mEditor" and the article is saved with its link, headline, lead image, publish date and authors. Links are cleaned of tracking codes, every author is listed separately, and articles you've already saved are marked so you don't clip them twice.

Built for real newsrooms: mEditor reads the details publishers build into their pages, and falls back to the visible byline and date when a page has none.

PRIVATE BY DEFAULT
• mEditor reads a page only when you click its icon.
• Want the ✓ badge on articles as you browse? Switch on Automatic detection in Settings. Chrome asks your permission first, and detection happens on your computer.
• Nothing is sent until you press Send (or turn on Auto-send).
• No ads, no tracking, no analytics.

ALSO INCLUDES
• Auto-send: save articles automatically above a confidence level you choose, once per article
• Recent clips, kept only on your computer
• Keyboard shortcuts: Alt+Shift+N opens mEditor; Ctrl/⌘+Enter sends
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
Clip news articles to mEditor: detect when the current page is a news article, show its link, headline, lead image, publish date and authors, and save them to mEditor when the user chooses.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `activeTab` | Reads the current tab only when the user clicks the mEditor icon or presses its shortcut, to extract the article details shown in the popup. |
| `scripting` | Runs mEditor's own bundled extractor script (src/content/extract.js) in the current tab after the user clicks the icon. If the user turns on Automatic detection, it registers the same bundled script for http/https pages. No remote code is ever injected. |
| `storage` | Saves the user's settings (destination URL, Automatic detection, Auto-send threshold) and a local history of the last 100 clips. |
| Host permissions (optional: `https://*/*`, `http://*/*`) | Not requested at install. Requested only when the user switches on Automatic detection in Settings (to show the article badge while browsing), or saves a destination on a different host. Detection runs locally; data is sent only when the user presses Send or enables Auto-send. |

**Are you using remote code?** No, I am not using remote code.
```
All JavaScript is included in the package. The only network request sends the clip to the mEditor service.
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
2. Click the mEditor icon. The popup shows "News article detected" with the extracted fields.
3. Press "Send to mEditor". The clip is saved to the developer's mEditor service and the button turns green ("Saved to mEditor").
4. Optional: Settings → Automatic detection asks for all-sites access and then shows a ✓ badge on articles while browsing.
No account or login is needed.
```

> Reviewers' test clips will appear in your mEditor app. Delete them after approval.
