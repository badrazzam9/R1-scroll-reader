/* ═══════════════════════════════════════════════
   R1 News Fetcher v26 — main.js
   ═══════════════════════════════════════════════ */

const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');
const BREAKING_FEEDS = [
  'https://news.yahoo.com/rss/world',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.npr.org/1001/rss.xml'
];

const RECENT_SEARCH_KEY = 'r1_recent_searches_v1';
const RECENT_ARTICLE_KEY = 'r1_recent_articles_v1';
const ARTICLE_FONT_KEY = 'r1_article_font_scale_v1';

/* ── Paywall domain blocklist ── */
const PAYWALL_DOMAINS = [
  'nytimes.com', 'wsj.com', 'ft.com', 'washingtonpost.com',
  'economist.com', 'bloomberg.com', 'thetimes.co.uk', 'telegraph.co.uk',
  'theathletic.com', 'barrons.com', 'hbr.org', 'newyorker.com',
  'wired.com', 'theatlantic.com', 'foreignpolicy.com', 'foreignaffairs.com',
  'medium.com', 'substack.com'
];

function isPaywalled(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return PAYWALL_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

/* ── Region / country RSS feeds ── */
const REGIONS = [
  // Top 6 always visible
  { label: '🇺🇸 US', url: 'https://news.yahoo.com/rss/us' },
  { label: '🇬🇧 UK', url: 'https://news.yahoo.com/rss/search?p=UK+News' },
  { label: '🇪🇺 Europe', url: 'https://news.yahoo.com/rss/search?p=Europe+News' },
  { label: '🌍 Africa', url: 'https://news.yahoo.com/rss/search?p=Africa+News' },
  { label: '🌏 Asia', url: 'https://news.yahoo.com/rss/search?p=Asia+News' },
  { label: '🏛️ Middle East', url: 'https://news.yahoo.com/rss/search?p=Middle+East+News' },
  // Collapsed by default
  { label: '🇦🇺 Australia', url: 'https://news.yahoo.com/rss/search?p=Australia+News' },
  { label: '🌎 L. America', url: 'https://news.yahoo.com/rss/search?p=Latin+America+news' },
  { label: '🇮🇳 India', url: 'https://news.yahoo.com/rss/search?p=India+News' },
  { label: '🇨🇳 China', url: 'https://news.yahoo.com/rss/search?p=China+News' },
  { label: '💼 Business', url: 'https://news.yahoo.com/rss/business' },
  { label: '🔬 Sci/Tech', url: 'https://news.yahoo.com/rss/tech' },
  { label: '⚽ Sport', url: 'https://sports.yahoo.com/rss/' },
  { label: '🎬 Entertain', url: 'https://news.yahoo.com/rss/entertainment' },
  { label: '🏥 Health', url: 'https://news.yahoo.com/rss/health' },
];
const REGIONS_VISIBLE = 6;

/* ── DOM refs ── */
const els = {
  navRefresh: document.getElementById('navRefresh'),
  navHome: document.getElementById('navHome'),
  viewLabel: document.getElementById('viewLabel'),
  fontTools: document.getElementById('fontTools'),
  fontDown: document.getElementById('fontDown'),
  fontUp: document.getElementById('fontUp'),

  viewHome: document.getElementById('viewHome'),
  viewCards: document.getElementById('viewCards'),
  viewArticle: document.getElementById('viewArticle'),

  searchInput: document.getElementById('searchInput'),
  searchForm: document.getElementById('searchForm'),
  regionSelect: document.getElementById('regionSelect'),
  breakingDeck: document.getElementById('breakingDeck'),
  breakingLoading: document.getElementById('breakingLoading'),

  cardCounter: document.getElementById('cardCounter'),
  deck: document.getElementById('deck'),

  articleImage: document.getElementById('articleImage'),
  articleTitle: document.getElementById('articleTitle'),
  articleSource: document.getElementById('articleSource'),
  articleSections: document.getElementById('articleSections'),

  status: document.getElementById('status')
};

/* ── State ── */
const state = {
  view: 'home',
  cards: [],
  activeCardIndex: 0,
  articleFontScale: 0.72,
  regionsExpanded: false,
  breakingCards: [],
  breakingIndex: 0,
  currentAbort: null,
  currentFeedContext: null
};

/* ═══ Status / Loading ═══ */
let statusTimer;
function setStatus(message, { persist = false } = {}) {
  clearTimeout(statusTimer);
  els.status.textContent = message || '';
  els.status.classList.remove('status--loading');
  if (message && !persist) {
    statusTimer = setTimeout(() => { els.status.textContent = ''; }, 3000);
  }
}

function showLoading(message) {
  els.status.textContent = message || 'Loading…';
  els.status.classList.add('status--loading');
}

function hideLoading() {
  els.status.classList.remove('status--loading');
}

/* ═══ Helpers ═══ */
function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function normaliseToUrl(input) {
  if (!input) return null;
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return null;
}

/* ═══ #11 + #15: API with timeout + cancel in-flight ═══ */
async function api(path, payload, method = 'POST') {
  // #15 Cancel any previous in-flight request
  if (state.currentAbort) {
    state.currentAbort.abort();
  }

  const controller = new AbortController();
  state.currentAbort = controller;

  // #11 Timeout after 10 seconds
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const requestUrl = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const response = await fetch(requestUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Check your connection.');
    }
    throw error;
  } finally {
    if (state.currentAbort === controller) {
      state.currentAbort = null;
    }
  }
}

/* ═══ #12: Retry with backoff ═══ */
async function apiWithRetry(path, payload, method = 'POST') {
  try {
    return await api(path, payload, method);
  } catch (firstError) {
    // Don't retry aborts from user-initiated cancels
    if (firstError.message === 'Request timed out. Check your connection.') {
      throw firstError;
    }
    // Wait 2s, retry once
    await new Promise(r => setTimeout(r, 2000));
    try {
      return await api(path, payload, method);
    } catch {
      throw firstError; // Throw original error
    }
  }
}

/* ═══ Storage (creationStorage with localStorage fallback) ═══ */
async function storageSave(key, value) {
  try {
    if (window.creationStorage?.plain) {
      await window.creationStorage.plain.setItem(key, btoa(JSON.stringify(value)));
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch { /* silent */ }
}

async function storageLoad(key) {
  try {
    if (window.creationStorage?.plain) {
      const raw = await window.creationStorage.plain.getItem(key);
      return raw ? JSON.parse(atob(raw)) : null;
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ═══ #16: Migrate localStorage → creationStorage ═══ */
async function migrateStorage() {
  if (!window.creationStorage?.plain) return;
  const keys = [RECENT_SEARCH_KEY, RECENT_ARTICLE_KEY, ARTICLE_FONT_KEY];
  for (const key of keys) {
    try {
      const old = localStorage.getItem(key);
      if (old) {
        const existing = await window.creationStorage.plain.getItem(key);
        if (!existing) {
          await window.creationStorage.plain.setItem(key, btoa(old));
        }
        localStorage.removeItem(key);
      }
    } catch { /* silent */ }
  }
}

/* ═══ Navigation ═══ */
function setView(view, { push = true } = {}) {
  state.view = view;

  els.viewHome.classList.toggle('hidden', view !== 'home');
  els.viewCards.classList.toggle('hidden', view !== 'cards');
  els.viewArticle.classList.toggle('hidden', view !== 'article');

  els.fontTools.classList.toggle('hidden', view !== 'article');
  els.cardCounter.classList.toggle('hidden', view !== 'cards');

  const labels = { home: 'Home', cards: 'News Cards', article: 'Article' };
  els.viewLabel.textContent = labels[view] || 'Home';

  if (push) history.pushState({ view }, '', `#${view}`);
}

function goBackView() {
  if (state.view === 'article') return setView('cards');
  if (state.view === 'cards') return setView('home');
}

function scrollCards(direction) {
  if (!state.cards.length) return;
  state.activeCardIndex = Math.max(0, Math.min(state.cards.length - 1, state.activeCardIndex + direction));
  applyWheelTransforms();
}

function goHomeView() {
  setView('home');
}

/* ═══ Font controls ═══ */
function applyArticleFontScale() {
  state.articleFontScale = Math.max(0.62, Math.min(1.0, Number(state.articleFontScale) || 0.72));
  const sections = document.getElementById('articleSections');
  if (sections) sections.style.fontSize = `${state.articleFontScale}em`;
  storageSave(ARTICLE_FONT_KEY, state.articleFontScale);
}

function changeArticleFont(delta) {
  state.articleFontScale = (Number(state.articleFontScale) || 0.72) + delta;
  applyArticleFontScale();
  setStatus(`Text size: ${Math.round(state.articleFontScale * 100)}%`);
}

/* ═══ Collapsible region grid ═══ */
function renderRegions() {
  els.regionSelect.innerHTML = '<option value="" disabled selected>🌍 By Region</option>';
  REGIONS.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.url;
    opt.textContent = r.label;
    els.regionSelect.appendChild(opt);
  });
}

/* ═══ Empty state ═══ */
function renderEmptyState(container, emoji, message) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-emoji">${emoji}</span><span>${message}</span>`;
  container.appendChild(div);
}

/* ═══ Breaking news as 3D wheel ═══ */
function createBreakingCardElement(card, index) {
  const el = document.createElement('article');
  el.className = 'news-card';
  el.dataset.index = String(index);

  if (card.image?.url) {
    const img = document.createElement('img');
    img.className = 'news-card-image';
    img.src = card.image.url;
    img.alt = card.title || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.remove();
      const ph = document.createElement('div');
      ph.className = 'news-card-image news-card-image--placeholder';
      ph.textContent = 'Breaking';
      el.prepend(ph);
    };
    el.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-image news-card-image--placeholder';
    ph.textContent = 'Breaking';
    el.appendChild(ph);
  }

  const content = document.createElement('div');
  content.className = 'news-card-content';
  const title = document.createElement('h3');
  title.textContent = card.title || `Story ${index + 1}`;
  content.appendChild(title);
  el.appendChild(content);

  el.addEventListener('click', () => {
    if (card.url) readArticle(card.url, card.image?.url);
  });
  return el;
}

function applyBreakingWheelTransforms() {
  const cards = [...els.breakingDeck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  const active = state.breakingIndex;
  cards.forEach((card, i) => {
    const offset = i - active;
    const absOff = Math.abs(offset);

    if (absOff > 2) {
      card.style.cssText = 'display:none';
      return;
    }

    const angle = offset * 55;
    const radius = 100;
    const y = Math.sin(angle * Math.PI / 180) * radius;
    const z = (Math.cos(angle * Math.PI / 180) - 1) * radius;
    const scale = Math.max(0.45, Math.cos(angle * Math.PI / 180));
    const opacity = Math.max(0, Math.cos(angle * Math.PI / 180) * 1.1 - 0.1);

    card.style.cssText = `
      display: block;
      transform: translateY(${y}px) translateZ(${z}px) rotateX(${-angle}deg) scale(${scale.toFixed(3)});
      opacity: ${opacity.toFixed(3)};
      z-index: ${10 - absOff};
      pointer-events: ${absOff === 0 ? 'auto' : 'none'};
    `;
    card.classList.toggle('is-active', i === active);
  });

  // Update breaking counter
  const bc = document.getElementById('breakCounter');
  if (bc) bc.textContent = `${active + 1} / ${cards.length}`;
}

function scrollBreaking(direction) {
  if (!state.breakingCards.length) return;
  state.breakingIndex = Math.max(0, Math.min(state.breakingCards.length - 1, state.breakingIndex + direction));
  applyBreakingWheelTransforms();
}

async function loadBreakingNewsInline() {
  try {
    els.breakingLoading.classList.remove('hidden');
    els.breakingLoading.textContent = 'Aggregating global sources…';

    // Concurrently fetch from Yahoo, BBC, and NPR to guarantee rapid breaking updates
    const promises = BREAKING_FEEDS.map(feedUrl => {
      const cacheBustedUrl = feedUrl + (feedUrl.includes('?') ? '&' : '?') + '_cb=' + Date.now();
      return api('/top', { url: cacheBustedUrl }).catch(() => null);
    });

    const results = await Promise.all(promises);
    els.breakingLoading.classList.add('hidden');

    let allCards = [];
    results.forEach(res => {
      if (res && res.items) allCards = allCards.concat(res.items);
    });

    if (!allCards.length) {
      renderEmptyState(els.breakingDeck, '📡', 'No breaking news right now');
      return;
    }

    // Normalize, drop paywalls
    allCards = allCards
      .map(c => ({ ...c, url: c.url || c.link }))
      .filter(c => c.url && !isPaywalled(c.url));

    // Sort strictly by published date so the absolute newest wire stories always appear first
    allCards.sort((a, b) => {
      const tA = new Date(a.published).getTime() || 0;
      const tB = new Date(b.published).getTime() || 0;
      return tB - tA; // Newest first
    });

    // Deduplicate exact same wire stories across networks using Title/Content heuristics
    const uniqueCards = [];
    const seenTitles = new Set();
    for (const card of allCards) {
      const simpleTitle = (card.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
      if (!seenTitles.has(simpleTitle) && uniqueCards.length < 20) {
        seenTitles.add(simpleTitle);
        uniqueCards.push(card);
      }
    }

    state.breakingCards = uniqueCards;
    els.breakingDeck.innerHTML = '';
    state.breakingIndex = 0;
    state.breakingCards.forEach((card, index) => {
      els.breakingDeck.appendChild(createBreakingCardElement(card, index));
    });
    applyBreakingWheelTransforms();
  } catch (error) {
    els.breakingLoading.textContent = 'Could not load breaking news.';
  }
}

/* ═══ #3: Card creation with entrance animations ═══ */
function createCardElement(card, index) {
  const article = document.createElement('article');
  article.className = 'news-card animate-in';
  article.style.animationDelay = `${index * 50}ms`;
  article.dataset.index = String(index);

  if (card.image?.url) {
    const img = document.createElement('img');
    img.className = 'news-card-image';
    img.src = card.image.url;
    img.alt = card.image.alt || card.title || `News image ${index + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.remove();
      const ph = document.createElement('div');
      ph.className = 'news-card-image news-card-image--placeholder';
      ph.textContent = 'Top Story';
      article.prepend(ph);
    };
    article.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-image news-card-image--placeholder';
    ph.textContent = 'Top Story';
    article.appendChild(ph);
  }

  const content = document.createElement('div');
  content.className = 'news-card-content';

  const title = document.createElement('h3');
  title.textContent = card.title || `Story ${index + 1}`;

  const snippet = document.createElement('p');
  snippet.textContent = card.snippet || card.summary || 'Tap to open full story.';

  content.append(title, snippet);
  article.appendChild(content);

  const openCard = () => {
    const articleUrl = card.url || card.link;
    if (articleUrl) readArticle(articleUrl, card.image?.url);
  };
  article.addEventListener('click', openCard);
  article.addEventListener('touchend', (ev) => { ev.preventDefault(); openCard(); }, { passive: false });

  return article;
}

/* ═══ 3D Wheel Carousel ═══ */
function applyWheelTransforms() {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  const active = state.activeCardIndex;
  const deckH = els.deck.offsetHeight || 200;

  cards.forEach((card, i) => {
    const offset = i - active; // -2, -1, 0, 1, 2...
    const absOff = Math.abs(offset);

    // Only show nearby cards (±2)
    if (absOff > 2) {
      card.style.cssText = 'display:none';
      return;
    }

    // ── Cylinder geometry ──
    // Each slot is 55° around the drum
    const angle = offset * 55;
    // Radius of the cylinder — determines how far back cards go
    const radius = 100;
    // Y position on the cylinder surface
    const y = Math.sin(angle * Math.PI / 180) * radius;
    // Z depth into the screen
    const z = (Math.cos(angle * Math.PI / 180) - 1) * radius;
    // Scale shrinks as cards rotate away
    const scale = Math.max(0.45, Math.cos(angle * Math.PI / 180));
    // Opacity fades dramatically
    const opacity = Math.max(0, Math.cos(angle * Math.PI / 180) * 1.1 - 0.1);

    card.style.cssText = `
      display: block;
      transform: translateY(${y}px) translateZ(${z}px) rotateX(${-angle}deg) scale(${scale.toFixed(3)});
      opacity: ${opacity.toFixed(3)};
      z-index: ${10 - absOff};
      pointer-events: ${absOff === 0 ? 'auto' : 'none'};
    `;

    card.classList.toggle('is-active', i === active);
  });

  // Card counter
  els.cardCounter.textContent = `${active + 1} / ${cards.length}`;
}

function refreshActiveCard() {
  if (state.view !== 'cards') return;
  applyWheelTransforms();
}

function renderCards(cards = [], sourceLabel = 'News') {
  state.cards = cards;
  state.activeCardIndex = 0;
  els.deck.innerHTML = '';

  if (!cards.length) {
    setStatus('No cards found. Try another source or keyword.');
    return;
  }

  cards.forEach((card, index) => els.deck.appendChild(createCardElement(card, index)));

  // Add swipe support to the generic card deck for the 3D wheel
  let touchStartY = 0;
  els.deck.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  els.deck.addEventListener('touchend', e => {
    const touchY = e.changedTouches[0].clientY;
    if (touchStartY - touchY > 30) scrollCards(1);
    else if (touchY - touchStartY > 30) scrollCards(-1);
  }, { passive: true });

  setView('cards');
  applyWheelTransforms();
  setStatus(`${sourceLabel}: ${cards.length} cards`);
}

/* ═══ Article with lead image (always preserved) ═══ */
function renderArticle(data, fallbackImageUrl) {
  els.articleTitle.textContent = data.title || 'Article';

  // Show lead image: API image > fallback from card > hidden
  const imgUrl = data.image?.url || data.leadImage || fallbackImageUrl;
  if (imgUrl) {
    els.articleImage.src = imgUrl;
    els.articleImage.alt = data.title || 'Article image';
    els.articleImage.classList.remove('hidden');
    els.articleImage.onerror = () => els.articleImage.classList.add('hidden');
  } else {
    els.articleImage.classList.add('hidden');
  }

  if (data.url) {
    els.articleSource.href = data.url;
    els.articleSource.classList.remove('hidden');
  } else {
    els.articleSource.classList.add('hidden');
  }

  els.articleSections.innerHTML = '';

  // Readability returns data.content (HTML) and data.textContent (plain text)
  const htmlContent = data.content || '';
  if (!htmlContent) {
    renderEmptyState(els.articleSections, '📄', 'Could not extract article text.');
    return;
  }

  const block = document.createElement('section');
  block.className = 'article-chunk article-chunk--plain animate-in';
  // Sanitise: remove scripts, styles, and ALL inline width/height/style attributes
  let cleanHtml = htmlContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\s+width\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+height\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+style\s*=\s*["'][^"']*["']/gi, '');
  block.innerHTML = cleanHtml;

  // Post-insert DOM cleanup: remove any remaining size attributes from all elements
  block.querySelectorAll('*').forEach(el => {
    el.removeAttribute('width');
    el.removeAttribute('height');
    el.removeAttribute('style');
    el.style.maxWidth = '100%';
    el.style.boxSizing = 'border-box';
  });
  // Remove ALL inline images, pictures, and figures from the article content (user only wants the single top-level lead image)
  block.querySelectorAll('img, picture, figure').forEach(el => el.remove());
  els.articleSections.appendChild(block);
}

/* ═══ API actions ═══ */
async function fetchNewsFromUrl(url, label = 'Source News') {
  state.currentFeedContext = { type: 'url', url, label };
  try {
    showLoading('Fetching news cards…');
    const cacheBustedUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    const data = await apiWithRetry('/top', { url: cacheBustedUrl });
    hideLoading();
    // Filter out paywalled cards
    const filteredCards = (data.items || []).filter(c => !c.url || !isPaywalled(c.url));
    renderCards(filteredCards, label || data.domain || 'News');
  } catch (error) {
    hideLoading();
    renderErrorCard(error.message, () => fetchNewsFromUrl(url, label));
  }
}

async function searchNews(query) {
  const q = String(query || '').trim();
  if (!q) return setStatus('Type a search term first.');
  state.currentFeedContext = { type: 'search', query: q };

  try {
    showLoading('Searching across sources…');
    // Use Yahoo News RSS as search backend to avoid Google's redirect walls that block Readability on the worker
    const searchUrl = `https://news.yahoo.com/rss/search?p=${encodeURIComponent(q)}&_cb=${Date.now()}`;
    const data = await apiWithRetry('/top', { url: searchUrl });
    hideLoading();
    const filteredCards = (data.items || []).filter(c => !c.url || !isPaywalled(c.url));
    renderCards(filteredCards, `Search: ${q}`);
  } catch (error) {
    hideLoading();
    renderErrorCard(error.message, () => searchNews(query));
  }
}

async function readArticle(url, cardImageUrl) {
  // Warn user if paywalled
  if (isPaywalled(url)) {
    setStatus('⚠️ This source may require a subscription.', { persist: true });
  }
  try {
    showLoading('Opening article…');
    const cacheBustedUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    const data = await apiWithRetry('/article', { url: cacheBustedUrl });
    hideLoading();

    // Check if content is too short (likely paywall)
    const textContent = data.textContent || data.content || '';
    if (textContent.length < 100) {
      setStatus('⚠️ Article may be behind a paywall — limited content available.', { persist: true });
    }

    renderArticle(data, cardImageUrl);
    setView('article');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    applyArticleFontScale();
    setStatus(`Opened article from ${new URL(url).hostname || 'source'}.`);
  } catch (error) {
    hideLoading();
    setStatus(error.message, { persist: true });
  }
}

/* ═══ #14: Error card with retry ═══ */
function renderErrorCard(message, retryFn) {
  state.cards = [];
  els.deck.innerHTML = '';

  const el = document.createElement('div');
  el.className = 'error-card animate-in';
  el.innerHTML = `
    <span class="empty-emoji">⚠️</span>
    <p>${escapeHtml(message)}</p>
    <button class="btn btn-soft" id="retryBtn">Retry</button>
  `;
  els.deck.appendChild(el);
  el.querySelector('#retryBtn').addEventListener('click', retryFn);

  setView('cards');
}

/* ═══ #13: Health check + resume ═══ */
async function healthCheck() {
  try {
    // Direct fetch to avoid canceling other api() requests
    // Custom timeout implementation since AbortSignal.timeout() is not supported on older R1 WebViews
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    await fetch(`${API_BASE}/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (error) {
    if (error.name !== 'AbortError') {
      setStatus(`API unavailable: ${error.message}`, { persist: true });
    }
  }
}

/* ═══ Persistence ═══ */
async function loadRecent() {
  try {
    const fontVal = await storageLoad(ARTICLE_FONT_KEY);
    state.articleFontScale = Number(fontVal) || 0.72;
  } catch {
    state.articleFontScale = 0.72;
  }
  applyArticleFontScale();
}

/* ═══ UI bindings ═══ */
function bindUi() {
  els.navRefresh.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (state.view === 'cards' && state.currentFeedContext) {
      if (state.currentFeedContext.type === 'url') {
        fetchNewsFromUrl(state.currentFeedContext.url, state.currentFeedContext.label);
      } else if (state.currentFeedContext.type === 'search') {
        searchNews(state.currentFeedContext.query);
      }
    } else {
      goHomeView();
      // Clear out search input and trigger fresh fetch
      els.searchInput.value = '';
      els.regionSelect.selectedIndex = 0;

      // Soft reload the breaking news inline
      loadBreakingNewsInline();
    }
  });
  els.navHome.addEventListener('click', goHomeView);

  els.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    searchNews(els.searchInput.value);
  });
  // Enter key in search
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchNews(els.searchInput.value); }
  });

  // #8 Search debounce — auto-search after 500ms of typing
  let searchDebounce;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = els.searchInput.value.trim();
    if (q.length >= 3) {
      searchDebounce = setTimeout(() => searchNews(q), 500);
    }
  });

  els.regionSelect.addEventListener('change', () => {
    const query = els.regionSelect.value;
    const opt = els.regionSelect.options[els.regionSelect.selectedIndex];
    if (query) {
      els.searchInput.value = '';
      fetchNewsFromUrl(query, opt.textContent);
      els.regionSelect.selectedIndex = 0; // Reset after navigation
    }
  });

  // Breaking news nav arrows removed per user request

  // Font controls
  els.fontDown.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(-0.08); });
  els.fontUp.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(0.08); });

  window.addEventListener('resize', refreshActiveCard, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (state.view === 'cards') {
      if (['ArrowDown', 'PageDown', 'j', 'J'].includes(event.key)) { event.preventDefault(); scrollCards(1); return; }
      if (['ArrowUp', 'PageUp', 'k', 'K'].includes(event.key)) { event.preventDefault(); scrollCards(-1); return; }
      if (event.key === 'Enter') { event.preventDefault(); const a = state.cards[state.activeCardIndex]; if (a?.url) readArticle(a.url, a.image?.url); }
      return;
    }
    if (state.view === 'article') {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeArticleFont(0.08); }
      else if (event.key === '-') { event.preventDefault(); changeArticleFont(-0.08); }
    }
  });

  window.addEventListener('popstate', (event) => {
    const view = event.state?.view || 'home';
    setView(view, { push: false });
  });

  // #13 Health check on resume
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) healthCheck();
  });
}

/* ═══ R1 hardware (scroll + PTT) with throttle ═══ */
function initR1Hardware() {
  let scrollLock = false;
  const SCROLL_COOLDOWN = 180;

  function throttledScroll(handler) {
    if (scrollLock) return;
    scrollLock = true;
    handler();
    setTimeout(() => { scrollLock = false; }, SCROLL_COOLDOWN);
  }

  window.addEventListener('scrollUp', () => {
    throttledScroll(() => {
      if (state.view === 'cards') {
        scrollCards(-1);
      } else if (state.view === 'article') {
        window.scrollBy({ top: -60, behavior: 'smooth' });
      } else if (state.view === 'home') {
        // #7 Pull-to-refresh: if at top, refresh breaking news
        if (window.scrollY <= 0) {
          scrollBreaking(-1);
        } else {
          window.scrollBy({ top: -50, behavior: 'smooth' });
        }
      }
    });
  });

  window.addEventListener('scrollDown', () => {
    throttledScroll(() => {
      if (state.view === 'cards') {
        scrollCards(1);
      } else if (state.view === 'article') {
        window.scrollBy({ top: 60, behavior: 'smooth' });
      } else if (state.view === 'home') {
        if (window.scrollY <= 0) {
          scrollBreaking(1);
        } else {
          window.scrollBy({ top: 50, behavior: 'smooth' });
        }
      }
    });
  });

  // PTT: open active card in cards view
  window.addEventListener('sideClick', () => {
    if (state.view === 'cards') {
      const active = state.cards[state.activeCardIndex];
      if (active?.url) readArticle(active.url, active.image?.url);
    } else if (state.view === 'article') {
      goBackView();
    }
  });
}

/* ═══ Service Worker registration & cache busting ═══ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=34').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New SW found, force clear caches and hard reload
            caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
              .then(() => window.location.reload(true));
          }
        });
      });
    }).catch(() => { /* silent */ });
  }
}

/* ═══ #17: Boot with error boundary ═══ */
function boot() {
  try {
    bindUi();
    initR1Hardware();
    renderRegions();
    loadRecent();
    migrateStorage(); // #16
    setView('home', { push: false });
    history.replaceState({ view: 'home' }, '', '#home');
    healthCheck();
    loadBreakingNewsInline();
    registerSW(); // #10
  } catch (error) {
    document.body.innerHTML = `
      <div style="padding:1rem;color:#f2f5f9;font-family:system-ui;text-align:center;margin-top:2rem;">
        <p style="font-size:1.5rem;">⚠️</p>
        <p style="font-size:.8rem;margin:.5rem 0;">Something went wrong</p>
        <button onclick="location.reload()" style="padding:.4rem .8rem;border-radius:8px;border:1px solid #2a3240;background:#212b39;color:#f2f5f9;font-size:.72rem;cursor:pointer;">Tap to reload</button>
      </div>
    `;
  }
}

boot();
