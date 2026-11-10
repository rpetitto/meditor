/*
 * mEditor content script.
 *
 * Runs on every http(s) page. It scores how likely the page is a news article,
 * extracts { url, title, image, published_date, authors }, reports the verdict
 * to the background worker (for the toolbar badge / auto-send), and answers
 * extraction requests from the popup.
 *
 * Plain script (no modules) so it can also be injected on demand with
 * chrome.scripting.executeScript. Guarded against double injection.
 */
(() => {
  if (globalThis.__meditor) return;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const NEWS_TYPES = new Set([
    'NewsArticle', 'ReportageNewsArticle', 'AnalysisNewsArticle', 'OpinionNewsArticle',
    'BackgroundNewsArticle', 'ReviewNewsArticle', 'AskPublicNewsArticle', 'LiveBlogPosting',
    'SatiricalArticle',
  ]);
  const ARTICLE_TYPES = new Set(['Article', 'Report', 'TechArticle', 'ScholarlyArticle']);
  const BLOG_TYPES = new Set(['BlogPosting']);
  const NEGATIVE_TYPES = new Set([
    'Product', 'VideoObject', 'ProfilePage', 'SearchResultsPage', 'CollectionPage',
    'Recipe', 'Event', 'JobPosting', 'SoftwareApplication', 'Movie', 'Book',
  ]);

  // A short list of well-known publishers. It only nudges the score; markup does the real work.
  const NEWS_DOMAINS = [
    'nytimes.com', 'washingtonpost.com', 'wsj.com', 'theguardian.com', 'bbc.co.uk', 'bbc.com',
    'cnn.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'economist.com', 'npr.org',
    'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'foxnews.com', 'usatoday.com', 'latimes.com',
    'politico.com', 'politico.eu', 'axios.com', 'theatlantic.com', 'newyorker.com', 'time.com',
    'forbes.com', 'cnbc.com', 'aljazeera.com', 'independent.co.uk', 'telegraph.co.uk',
    'dailymail.co.uk', 'thetimes.co.uk', 'lemonde.fr', 'spiegel.de', 'theverge.com',
    'techcrunch.com', 'wired.com', 'arstechnica.com', 'vox.com', 'nypost.com', 'chicagotribune.com',
    'bostonglobe.com', 'sfchronicle.com', 'abc.net.au', 'smh.com.au', 'cbc.ca',
    'theglobeandmail.com', 'news.yahoo.com', 'businessinsider.com', 'huffpost.com', 'slate.com',
    'semafor.com', 'theinformation.com', 'thehill.com', 'newsweek.com', 'msnbc.com', 'news.sky.com',
    'france24.com', 'dw.com', 'euronews.com', 'scmp.com', 'hindustantimes.com',
    'timesofindia.indiatimes.com', 'ndtv.com', 'straitstimes.com', 'haaretz.com',
    'timesofisrael.com', 'propublica.org', 'theintercept.com', 'motherjones.com', 'fortune.com',
    'marketwatch.com', 'barrons.com', 'engadget.com', 'venturebeat.com', 'zdnet.com', 'gizmodo.com',
    'mashable.com', 'vice.com', 'rollingstone.com', 'variety.com', 'hollywoodreporter.com',
    'deadline.com', 'espn.com', 'theathletic.com', 'nationalgeographic.com', 'pbs.org',
    'miamiherald.com', 'seattletimes.com', 'startribune.com', 'denverpost.com',
    'nzherald.co.nz', 'irishtimes.com', 'theage.com.au', 'news.com.au', 'globalnews.ca',
  ];
  // Content-heavy sites that are rarely news articles even when marked up as "Article".
  const NON_NEWS_DOMAINS = [
    'wikipedia.org', 'wikimedia.org', 'github.com', 'stackoverflow.com', 'stackexchange.com',
    'youtube.com', 'amazon.com', 'google.com', 'reddit.com', 'twitter.com', 'x.com',
    'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'pinterest.com', 'imdb.com',
    'docs.google.com', 'notion.so', 'figma.com',
  ];

  const TRACKING_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|cmpid|smid|smtyp|ocid|cid|ito|ref_src|ref_url|sr_share|guccounter|guce_referrer|guce_referrer_sig|taid|ncid|mbid|giftCopy|unlocked_article_code)$/i;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const $ = (sel, root = document) => {
    try { return root.querySelector(sel); } catch { return null; }
  };
  const $$ = (sel, root = document) => {
    try { return Array.from(root.querySelectorAll(sel)); } catch { return []; }
  };

  const clean = (s) => (typeof s === 'string' ? s : s == null ? '' : String(s))
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let entityParser;
  const decodeEntities = (s) => {
    if (!s || !/&(#\d+|#x[\da-f]+|[a-z]+);/i.test(s)) return s;
    entityParser ||= new DOMParser();
    // DOMParser never runs scripts; we only read textContent.
    return entityParser.parseFromString(`<!doctype html><body>${s}`, 'text/html').body.textContent || s;
  };

  const text = (s) => clean(decodeEntities(clean(s)));

  const absUrl = (u) => {
    const raw = clean(u);
    if (!raw || raw.startsWith('data:')) return '';
    try {
      const url = new URL(raw, document.baseURI);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  };

  const meta = (...keys) => {
    for (const key of keys) {
      const el = $(`meta[property="${key}" i]`) || $(`meta[name="${key}" i]`) || $(`meta[itemprop="${key}" i]`);
      const v = el && clean(el.getAttribute('content'));
      if (v) return v;
    }
    return '';
  };

  const metaAll = (...keys) => {
    const out = [];
    for (const key of keys) {
      for (const el of [...$$(`meta[property="${key}" i]`), ...$$(`meta[name="${key}" i]`)]) {
        const v = clean(el.getAttribute('content'));
        if (v) out.push(v);
      }
    }
    return out;
  };

  const hostMatches = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

  const typeNames = (node) => [].concat(node?.['@type'] || [])
    .map((t) => String(t).replace(/^.*[/#:]/, ''));

  // ---------------------------------------------------------------------------
  // Structured data (JSON-LD + microdata)
  // ---------------------------------------------------------------------------

  function readJsonLd() {
    const nodes = [];
    const byId = new Map();

    const walk = (n, depth = 0) => {
      if (!n || depth > 8) return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof n !== 'object') return;
      if (n['@id'] && Object.keys(n).length > 1) byId.set(n['@id'], n);
      if (n['@type']) nodes.push(n);
      if (n['@graph']) walk(n['@graph'], depth + 1);
      if (n.mainEntity && typeof n.mainEntity === 'object') walk(n.mainEntity, depth + 1);
      if (n.hasPart && typeof n.hasPart === 'object') walk(n.hasPart, depth + 1);
    };

    for (const script of $$('script[type="application/ld+json" i]')) {
      const raw = script.textContent || '';
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        try {
          // Common breakages: raw control characters, trailing commas, HTML comments.
          data = JSON.parse(raw
            .replace(/^\s*<!--|-->\s*$/g, '')
            .replace(/[\u0000-\u001F]+/g, ' ')
            .replace(/,\s*([}\]])/g, '$1'));
        } catch {
          continue;
        }
      }
      walk(data);
    }

    // Resolve {"@id": "..."} references (Yoast & friends put authors/images in @graph).
    const resolve = (v) => (v && typeof v === 'object' && !Array.isArray(v) && v['@id'] && byId.has(v['@id'])
      ? { ...v, ...byId.get(v['@id']) }
      : v);

    return { nodes, resolve };
  }

  function pickArticleNode(nodes) {
    let best = null;
    let bestScore = 0;
    for (const node of nodes) {
      const types = typeNames(node);
      let s = 0;
      if (types.some((t) => NEWS_TYPES.has(t))) s = 30;
      else if (types.some((t) => ARTICLE_TYPES.has(t))) s = 20;
      else if (types.some((t) => BLOG_TYPES.has(t))) s = 15;
      if (!s) continue;
      if (node.headline) s += 3;
      if (node.datePublished) s += 2;
      if (node.author) s += 2;
      if (s > bestScore) { best = node; bestScore = s; }
    }
    return best;
  }

  function readMicrodata() {
    const scope = $('[itemscope][itemtype*="NewsArticle" i]')
      || $('[itemscope][itemtype*="schema.org/Article" i]')
      || $('[itemscope][itemtype*="BlogPosting" i]');
    if (!scope) return null;
    const prop = (name) => {
      const el = $(`[itemprop~="${name}"]`, scope);
      if (!el) return '';
      return clean(el.getAttribute('content') || el.getAttribute('datetime')
        || el.getAttribute('src') || el.getAttribute('href') || el.textContent);
    };
    const type = clean(scope.getAttribute('itemtype')).replace(/^.*[/#]/, '');
    const authors = $$('[itemprop~="author"]', scope).map((el) => {
      const name = $('[itemprop~="name"]', el);
      return clean(name ? (name.getAttribute('content') || name.textContent) : (el.getAttribute('content') || el.textContent));
    });
    return {
      type,
      headline: prop('headline'),
      datePublished: prop('datePublished'),
      image: prop('image'),
      authors,
    };
  }

  // ---------------------------------------------------------------------------
  // Field extractors
  // ---------------------------------------------------------------------------

  function cleanPageUrl(href) {
    try {
      const url = new URL(href);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
      }
      return url.href.replace(/\?$/, '');
    } catch {
      return href;
    }
  }

  function extractUrl(ld) {
    const here = new URL(location.href);
    const candidates = [
      absUrl($('link[rel="canonical" i]')?.getAttribute('href')),
      absUrl(meta('og:url')),
      absUrl(typeof ld?.url === 'string' ? ld.url : ''),
    ];
    for (const c of candidates) {
      if (!c) continue;
      const u = new URL(c);
      // Ignore canonicals that collapse an article onto the homepage (a common CMS bug).
      if ((u.pathname === '/' || u.pathname === '') && here.pathname.length > 1) continue;
      return cleanPageUrl(c);
    }
    return cleanPageUrl(location.href);
  }

  function siteName(ld, resolve) {
    const publisher = resolve(ld?.publisher);
    return text(meta('og:site_name', 'application-name', 'twitter:site:name')
      || (publisher && typeof publisher === 'object' ? publisher.name : '')
      || '');
  }

  // "news.bbc.co.uk" -> "bbc", "www.theguardian.com" -> "theguardian"
  function hostCore() {
    const generic = new Set(['www', 'com', 'co', 'org', 'net', 'news', 'uk', 'au', 'ca', 'in', 'edu', 'gov', 'm', 'amp', 'go']);
    const labels = location.hostname.toLowerCase().split('.').filter((l) => !generic.has(l) && l.length > 1);
    return labels.sort((a, b) => b.length - a.length)[0] || location.hostname.toLowerCase();
  }

  function stripSiteSuffix(title, site) {
    if (!title) return title;
    const parts = title.split(/\s+[|\-–—·•:]\s+/);
    if (parts.length < 2) return title;
    const last = parts[parts.length - 1].toLowerCase();
    const lastCompact = last.replace(/[\s.'’]+/g, '');
    const siteLc = (site || '').toLowerCase();
    const looksLikeSite = lastCompact.length >= 3 && (
      (siteLc && (last === siteLc || last.includes(siteLc) || siteLc.includes(last)))
      || lastCompact.includes(hostCore())
      || location.hostname.toLowerCase().includes(lastCompact));
    if (!looksLikeSite) return title;
    const cut = title.slice(0, title.length - parts[parts.length - 1].length).replace(/\s+[|\-–—·•:]\s*$/, '');
    return cut.length >= 12 ? cut : title;
  }

  function extractTitle(ld, micro, site) {
    const h1 = $('article h1') || $('main h1') || $('h1');
    const candidates = [
      ld?.headline,
      micro?.headline,
      meta('og:title'),
      meta('twitter:title'),
      meta('parsely-title', 'sailthru.title', 'headline', 'dc.title'),
      h1 && h1.textContent,
      ld?.name,
      document.title,
    ];
    for (const c of candidates) {
      const t = text(Array.isArray(c) ? c[0] : c);
      if (t && t.length > 3) return stripSiteSuffix(t, site);
    }
    return '';
  }

  function ldImageUrl(img, resolve, depth = 0) {
    if (!img || depth > 3) return '';
    if (typeof img === 'string') return absUrl(img);
    if (Array.isArray(img)) {
      for (const i of img) {
        const u = ldImageUrl(i, resolve, depth + 1);
        if (u) return u;
      }
      return '';
    }
    const r = resolve(img);
    if (r && typeof r === 'object') return absUrl(r.url || r.contentUrl || r['@id'] || '') || ldImageUrl(r.thumbnailUrl, resolve, depth + 1);
    return '';
  }

  function extractImage(ld, resolve, micro, root) {
    const fromMeta = [
      meta('og:image:secure_url', 'og:image:url', 'og:image'),
      meta('twitter:image', 'twitter:image:src'),
      $('link[rel="image_src" i]')?.getAttribute('href'),
    ].map(absUrl).find(Boolean);
    if (fromMeta) return fromMeta;

    const fromLd = ldImageUrl(ld?.image, resolve) || ldImageUrl(ld?.thumbnailUrl, resolve);
    if (fromLd) return fromLd;
    if (micro?.image) {
      const u = absUrl(micro.image);
      if (u) return u;
    }

    // Fallback: the first reasonably large image in the article body.
    for (const img of $$('img', root || document).slice(0, 40)) {
      const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
      const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
      if (w && w < 300) continue;
      if (h && h < 150) continue;
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src')
        || (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '').split(',')[0].trim().split(/\s+/)[0];
      const u = absUrl(src);
      if (u && !/\.svg(\?|$)|sprite|logo|avatar|icon|pixel|spacer|1x1/i.test(u)) return u;
    }
    return '';
  }

  function normalizeDate(raw) {
    let s = clean(raw);
    if (!s) return '';
    if (/^\d{10}$/.test(s)) s = Number(s) * 1000;
    else if (/^\d{13}$/.test(s)) s = Number(s);
    else if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    else if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
    // "2024-05-12T10:00:00+0000" -> add the colon Date() wants.
    if (typeof s === 'string' && /\d:\d{2}/.test(s)) s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getUTCFullYear();
    if (year < 1990 || d.getTime() > Date.now() + 2 * 864e5) return '';
    return d.toISOString();
  }

  function extractDate(ld, micro, root) {
    const candidates = [
      { v: ld?.datePublished, strong: true },
      { v: micro?.datePublished, strong: true },
      { v: meta('article:published_time', 'og:article:published_time', 'published_time'), strong: true },
      { v: meta('datePublished', 'pubdate', 'publishdate', 'publish-date', 'publish_date', 'publication_date',
        'parsely-pub-date', 'sailthru.date', 'article.published', 'dcterms.created', 'dc.date.issued',
        'dc.date', 'citation_publication_date', 'ptime', 'date', 'cxenseparse:recs:publishtime',
        'og:published_time', 'release_date'), strong: true },
      { v: ld?.dateCreated },
      { v: $('[itemprop~="datePublished"]')?.getAttribute('datetime') || $('[itemprop~="datePublished"]')?.getAttribute('content') },
      { v: $('time[pubdate]')?.getAttribute('datetime') || $('time[pubdate]')?.textContent },
      { v: $('time[datetime]', root || document)?.getAttribute('datetime') },
      { v: ld?.dateModified },
      { v: meta('article:modified_time', 'og:updated_time', 'last-modified') },
    ];
    for (const { v, strong } of candidates) {
      const d = normalizeDate(Array.isArray(v) ? v[0] : v);
      if (d) return { value: d, strong: !!strong };
    }
    // Dated URL: /2024/05/12/ or /2024-05-12/
    const m = location.pathname.match(/\/((?:19|20)\d{2})[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?:\/|-|$)/);
    if (m) {
      const d = normalizeDate(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
      if (d) return { value: d, strong: false };
    }
    return { value: '', strong: false };
  }

  // --- Authors ---------------------------------------------------------------

  const BYLINE_PREFIX = /^(?:(?:written|words|reporting|reported|posted|published|story|text|photos?|analysis|commentary)\s+)?(?:by|from|author|authors|byline)\s*[:\-–—]?\s+/i;
  const NOT_A_NAME = /^(?:by|and|the|staff|admin|administrator|editor|editors|unknown|anonymous|guest|share|follow|more|contributor|contributors|updated|published|reporter|correspondent|news desk|associated press writer)$/i;

  const ROLE_WORDS = /\b(?:reporter|correspondent|editor|writer|columnist|contributor|contributing|producer|analyst|photographer|photojournalist|bureau|chief|senior|director|updated|published|minutes?|read|follow|subscribe|newsletter|share)\b/i;

  function splitNames(raw) {
    let s = text(raw);
    if (!s) return [];
    s = s.replace(BYLINE_PREFIX, '');
    // Drop trailing role / date fragments: "Jane Doe | Reporter", "Jane Doe • Updated 3 hours ago"
    s = s.replace(/\s*(?:[|•·]|\s[-–—]\s).*$/, '');
    s = s.replace(/\b(?:updated|published|posted|last updated|first published)\b.*$/i, '');
    // Conjunctions are matched case-sensitively with surrounding spaces so that
    // middle initials ("John E. Smith") are never treated as "e"/"y"/"et".
    return s
      .split(/\s*(?:,|;|&|\s+(?:and|AND|And|und|et|y|e)\s+)\s*/)
      .map((n) => n.replace(BYLINE_PREFIX, '').replace(/^[@\s]+|[\s.,:;]+$/g, '').trim())
      .filter(Boolean);
  }

  function isPlausibleName(n) {
    if (n.length < 2 || n.length > 70) return false;
    if (/https?:\/\/|www\.|@.+\.|\.(com|org|net)\b/i.test(n)) return false;
    if (/\d{3,}/.test(n)) return false;
    if (!/\p{L}/u.test(n)) return false;
    if (n.split(/\s+/).length > 6) return false;
    if (NOT_A_NAME.test(n)) return false;
    if (ROLE_WORDS.test(n)) return false;
    if (/^(updated|published|posted|last updated|min read|\d+ min)/i.test(n)) return false;
    return true;
  }

  function ldAuthorNames(v, resolve, depth = 0) {
    if (!v || depth > 4) return { people: [], orgs: [] };
    if (Array.isArray(v)) {
      return v.reduce((acc, x) => {
        const r = ldAuthorNames(x, resolve, depth + 1);
        acc.people.push(...r.people);
        acc.orgs.push(...r.orgs);
        return acc;
      }, { people: [], orgs: [] });
    }
    if (typeof v === 'string') {
      // Some sites put a profile URL here; skip those.
      return /^https?:\/\//i.test(v) ? { people: [], orgs: [] } : { people: splitNames(v), orgs: [] };
    }
    const r = resolve(v);
    if (!r || typeof r !== 'object') return { people: [], orgs: [] };
    const name = typeof r.name === 'string' ? r.name : r.name?.['@value'] || (Array.isArray(r.name) ? r.name[0] : '')
      || [r.givenName, r.familyName].filter(Boolean).join(' ');
    if (!name) return { people: [], orgs: [] };
    const isOrg = typeNames(r).some((t) => /Organization|NewsMediaOrganization|Corporation/.test(t));
    return isOrg ? { people: [], orgs: [text(name)] } : { people: splitNames(name), orgs: [] };
  }

  function extractAuthors(ld, resolve, micro, root, site) {
    const tryLists = [];
    let orgFallback = [];

    if (ld) {
      const { people, orgs } = ldAuthorNames(ld.author, resolve);
      const creator = ldAuthorNames(ld.creator, resolve);
      tryLists.push(people, creator.people);
      orgFallback = [...orgs, ...creator.orgs];
    }
    if (micro?.authors?.length) tryLists.push(micro.authors.flatMap(splitNames));

    tryLists.push(metaAll('author', 'article:author', 'og:article:author', 'parsely-author', 'sailthru.author',
      'dc.creator', 'dcterms.creator', 'citation_author', 'byl', 'cxenseparse:author', 'author_name')
      .filter((v) => !/^https?:\/\//i.test(v))
      .flatMap(splitNames));

    // DOM bylines
    const scope = root || document;
    const selectors = [
      '[itemprop~="author"] [itemprop~="name"]',
      '[rel~="author"]',
      '[data-testid*="byline" i] a, [data-component*="byline" i] a',
      '.byline a[href*="author"], .byline a[href*="/people/"], .byline a[href*="/profile"]',
      '.author-name, .author__name, .byline__name, .byline-name, .article-author, .c-byline__author, .contributor-name',
      '[class*="byline" i] [class*="name" i]',
      '[class*="byline" i], [data-testid*="byline" i]',
      '[itemprop~="author"]',
    ];
    for (const sel of selectors) {
      const els = [...$$(sel, scope), ...(scope !== document ? $$(sel) : [])].slice(0, 12);
      const names = els
        .filter((el) => (el.textContent || '').length < 200)
        .flatMap((el) => splitNames(el.getAttribute('content') || el.textContent));
      if (names.length) tryLists.push(names);
    }

    const siteLc = (site || '').toLowerCase();
    const finalize = (list) => {
      const seen = new Set();
      const out = [];
      for (const raw of list) {
        const n = text(raw);
        const key = n.toLowerCase();
        if (!isPlausibleName(n) || seen.has(key)) continue;
        seen.add(key);
        out.push(n);
      }
      // Drop the publisher name when real people are listed too.
      const people = out.filter((n) => n.toLowerCase() !== siteLc);
      return (people.length ? people : out).slice(0, 10);
    };

    for (const list of tryLists) {
      const names = finalize(list);
      if (names.length) return names;
    }
    if (orgFallback.length) return finalize(orgFallback);
    return [];
  }

  // ---------------------------------------------------------------------------
  // Body / detection
  // ---------------------------------------------------------------------------

  function contentRoot() {
    const explicit = $('[itemprop~="articleBody"]') || $('[data-component="text-block"]')?.closest('article');
    if (explicit) return explicit;
    const articles = $$('article');
    if (articles.length) {
      return articles.reduce((a, b) => ((b.textContent || '').length > (a.textContent || '').length ? b : a));
    }
    return $('main') || $('[role="main"]') || document.body;
  }

  function countWords(root) {
    let words = 0;
    for (const p of $$('p', root || document.body)) {
      if (p.closest('nav, footer, aside, header, form, [role="navigation"], [aria-hidden="true"]')) continue;
      const t = (p.textContent || '').trim();
      if (t.length < 40) continue;
      words += t.split(/\s+/).length;
      if (words > 20000) break;
    }
    return words;
  }

  function detect(ctx) {
    const signals = [];
    let score = 0;
    const add = (pts, label) => { score += pts; signals.push({ label, pts }); };

    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    const path = location.pathname;
    const ldTypes = ctx.ldNode ? typeNames(ctx.ldNode) : [];
    const allLdTypes = ctx.ldNodes.flatMap(typeNames);
    const newsType = ldTypes.find((t) => NEWS_TYPES.has(t));
    const articleType = ldTypes.find((t) => ARTICLE_TYPES.has(t));
    const blogType = ldTypes.find((t) => BLOG_TYPES.has(t));

    if (newsType) add(45, `Schema.org ${newsType} markup`);
    else if (articleType) add(30, `Schema.org ${articleType} markup`);
    else if (blogType) add(22, `Schema.org ${blogType} markup`);

    if (ctx.micro) {
      if (/News/i.test(ctx.micro.type)) add(newsType ? 5 : 35, `Microdata ${ctx.micro.type}`);
      else if (!ctx.ldNode) add(20, `Microdata ${ctx.micro.type}`);
    }

    const ogType = meta('og:type').toLowerCase();
    if (ogType === 'article' || ogType.startsWith('article')) add(20, 'Open Graph type is “article”');
    else if (ogType && ogType !== 'website') add(-5, `Open Graph type is “${ogType}”`);

    if (meta('article:published_time', 'article:section', 'article:tag')) add(8, 'Article meta tags present');
    if (ctx.date.value) add(ctx.date.strong ? 10 : 5, 'Publication date found');
    if (ctx.authors.length) add(10, `Byline: ${ctx.authors.slice(0, 2).join(', ')}${ctx.authors.length > 2 ? '…' : ''}`);
    if (ogType.startsWith('article') && ctx.date.strong && ctx.authors.length) add(10, 'Complete article metadata (type, date, author)');
    const article = $('article');
    if (article) {
      add(6, '<article> element on page');
      if ($('h1', article) && $('time, [datetime]', article)) add(6, 'Headline and timestamp inside the article');
    }

    if (ctx.words >= 600) add(15, `${ctx.words.toLocaleString()} words of body text`);
    else if (ctx.words >= 250) add(8, `${ctx.words.toLocaleString()} words of body text`);
    else if (ctx.words < 80) add(-15, 'Very little body text');

    if (/\/(19|20)\d{2}[/-]\d{1,2}[/-]\d{1,2}\//.test(path) || /\/(19|20)\d{2}\/\d{1,2}\//.test(path)) add(8, 'Dated URL');
    if (/\/(news|article|articles|story|stories|politics|world|business|opinion|tech|science|health|sport|sports|blog|posts?)\//i.test(path)) add(4, 'News-style URL path');
    if (/[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/i.test(path)) add(4, 'Headline-style URL slug');

    if (hostMatches(host, NEWS_DOMAINS)) add(15, 'Known news publisher');
    if (hostMatches(host, NON_NEWS_DOMAINS)) add(-40, 'Reference / social site, not a publisher');

    const isHome = path === '/' || path === '' || /^\/(index\.html?)?$/i.test(path);
    if (isHome) add(-45, 'Site homepage');
    else if (path.split('/').filter(Boolean).length === 1 && /^\/[a-z-]{2,20}\/?$/i.test(path)
      && !newsType && !articleType && !ogType.startsWith('article')) add(-20, 'Section front page');
    if (/\/(tag|tags|category|categories|topic|topics|section|author|authors|search|page)\/[^/]*\/?$/i.test(path) && !newsType) add(-15, 'Index / listing page');
    const negative = allLdTypes.find((t) => NEGATIVE_TYPES.has(t));
    if (negative && !newsType && !articleType) add(-25, `Schema.org ${negative} page`);

    const confidence = Math.max(0, Math.min(100, Math.round(score)));
    const verdict = score >= 55 ? 'article' : score >= 30 ? 'maybe' : 'none';
    const kind = newsType || hostMatches(host, NEWS_DOMAINS) || /News/i.test(ctx.micro?.type || '')
      ? 'news'
      : blogType ? 'blog' : 'article';

    signals.sort((a, b) => b.pts - a.pts);
    return { verdict, kind, confidence, score, type: newsType || articleType || blogType || ctx.micro?.type || '', signals };
  }

  function extract() {
    const { nodes, resolve } = readJsonLd();
    const ldNode = pickArticleNode(nodes);
    const micro = readMicrodata();
    const root = contentRoot();
    const site = siteName(ldNode, resolve);
    const date = extractDate(ldNode, micro, root);
    const authors = extractAuthors(ldNode, resolve, micro, root, site);
    const words = countWords(root);

    const data = {
      url: extractUrl(ldNode),
      title: extractTitle(ldNode, micro, site),
      image: extractImage(ldNode, resolve, micro, root),
      published_date: date.value,
      authors,
    };

    const detection = detect({ ldNode, ldNodes: nodes, micro, date, authors, words });
    const description = text(meta('og:description', 'description', 'twitter:description')
      || (typeof ldNode?.description === 'string' ? ldNode.description : ''));

    return {
      data,
      detection,
      page: {
        href: location.href,
        host: location.hostname.replace(/^www\./, ''),
        siteName: site,
        description: description.slice(0, 280),
        wordCount: words,
        readingMinutes: words ? Math.max(1, Math.round(words / 230)) : 0,
        favicon: absUrl($('link[rel~="icon" i][sizes="32x32"]')?.getAttribute('href')
          || $('link[rel~="icon" i]')?.getAttribute('href')
          || $('link[rel="apple-touch-icon" i]')?.getAttribute('href')
          || '/favicon.ico'),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  let lastReportedHref = '';

  function report() {
    let result;
    try {
      result = extract();
    } catch (err) {
      return;
    }
    lastReportedHref = location.href;
    try {
      chrome.runtime.sendMessage({ type: 'meditor:detected', result }).catch(() => {});
    } catch {
      // Extension was reloaded/uninstalled; this orphaned script can stay silent.
    }
  }

  globalThis.__meditor = { extract, report, version: 1 };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'meditor:extract') {
        try {
          sendResponse({ ok: true, result: extract() });
        } catch (err) {
          sendResponse({ ok: false, error: String(err?.message || err) });
        }
      }
      return false;
    });

    report();

    // Single-page apps change the URL without reloading; re-detect after they settle.
    let timer;
    const onUrlMaybeChanged = () => {
      if (location.href === lastReportedHref) return;
      clearTimeout(timer);
      timer = setTimeout(report, 1200);
    };
    if (globalThis.navigation?.addEventListener) {
      globalThis.navigation.addEventListener('navigatesuccess', onUrlMaybeChanged);
    } else {
      setInterval(onUrlMaybeChanged, 1500);
    }
  }
})();
