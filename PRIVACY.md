# mEditor privacy policy

_Last updated: November 10, 2026_

mEditor is a Chrome extension that detects news articles and, when asked, saves a short summary of an article to the mEditor service. This policy explains what mEditor reads, what it sends, and where that data goes.

## What mEditor reads

- **Only the page you choose, by default.** mEditor reads a page when you click its toolbar icon or press its keyboard shortcut. Chrome's `activeTab` permission limits this to the tab you're on, at that moment.
- **Every page you visit, only if you turn it on.** If you switch on **Automatic detection** in mEditor's settings, Chrome asks you to allow access to all sites. mEditor then checks each page as you browse so it can show the article badge. That check runs entirely inside your browser and sends nothing anywhere. You can switch it off at any time; mEditor then gives the access back to Chrome.

From a page, mEditor reads only its public metadata and visible article details: the page address, headline, lead image address, publish date and author names. It does not read form fields, passwords, cookies, or your activity on the page.

## What mEditor sends, and when

When you press **Send**, mEditor sends one record with exactly these five fields:

| Field | Example |
| --- | --- |
| `url` | the article's address (tracking parameters removed) |
| `title` | the headline |
| `image` | the address of the lead image (not the image itself) |
| `published_date` | the publish date, if the page has one |
| `authors` | the author names shown on the article |

If you switch on **Auto-send** (it requires Automatic detection), mEditor sends the same record automatically for pages it is confident are articles. Each address is sent once.

Nothing else is sent: no browsing history, no information about you, your device, or your Google account. Requests are sent without cookies.

## Where it goes

Records are saved to the **mEditor service**, operated by mEditor's publisher. The service runs on two infrastructure providers, which process records only to deliver this service:

1. A small receiving service hosted on [Cloudflare](https://www.cloudflare.com/privacypolicy/) checks that each record has the expected shape and passes it on. It does not store records.
2. Records are stored in the mEditor app, which is built on [Glide](https://www.glideapps.com/legal/privacy).

The data is used only to collect the articles you clip in mEditor. It is **not sold**, not used for advertising, not used to build profiles, not used to determine creditworthiness or for lending, and not shared with anyone else except as required by law.

## What stays on your device

- **Settings** (the destination address, Automatic detection, Auto-send and its threshold) are kept in Chrome's extension storage. If Chrome sync is on, Chrome syncs these settings to your other computers.
- **Recent clips** (the last 100 records you sent, with the time and result) are kept only on this computer, in local extension storage. You can clear them in mEditor's settings at any time.

mEditor has no analytics, no tracking, no ads and no remote code.

## Your choices

- Don't press **Send**, and nothing leaves your browser.
- Turn off **Automatic detection** and **Auto-send** in mEditor's settings at any time.
- Clear **Recent clips** in mEditor's settings.
- Uninstalling mEditor removes its settings and history from Chrome.
- To have clips you've sent removed from mEditor, contact the publisher (below).

## Changes and contact

If this policy changes, the updated version will be posted here with a new date.

Questions or requests: [open an issue on GitHub](https://github.com/rpetitto/meditor/issues).
