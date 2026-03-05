/* ═══════════════════════════════════════════════
   R1 News Fetcher v24 — main.js
   ═══════════════════════════════════════════════ */

const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');
const BREAKING_NEWS_URL = 'https://feeds.bbci.co.uk/news/world/rss.xml';

const RECENT_SEARCH_KEY = 'r1_recent_searches_v1';
const RECENT_ARTICLE_KEY = 'r1_recent_articles_v1';
const ARTICLE_FONT_KEY = 'r1_article_font_scale_v1';

/* ── Region / country RSS feeds ── */
const REGIONS = [
  // Top 6 always visible
  { label: '🇺🇸 US', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
  { label: '🇬🇧 UK', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
  { label: '🇪🇺 Europe', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
  { label: '🌍 Africa', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml' },
  { label: '🌏 Asia', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' },
  { label: '🏛️ Middle East', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  // Collapsed by default
  { label: '🇦🇺 Australia', url: 'https://feeds.bbci.co.uk/news/world/australia/rss.xml' },
  { label: '🌎 L. America', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
  { label: '🇮🇳 India', url: 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml' },
  { label: '🇨🇳 China', url: 'https://feeds.bbci.co.uk/news/world/asia/china/rss.xml' },
  { label: '💼 Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { label: '🔬 Sci/Tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { label: '⚽ Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { label: '🎬 Entertain', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { label: '🏥 Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
];
const REGIONS_VISIBLE = 6;

/* ── DOM refs ── */
const els = {
  navBack: document.getElementById('navBack'),
  navHome: document.getElementById('navHome'),
  viewLabel: document.getElementById('viewLabel'),
  fontTools: document.getElementById('fontTools'),
  fontDown: document.getElementById('fontDown'),
  fontUp: document.getElementById('fontUp'),

  viewHome: document.getElementById('viewHome'),
  viewCards: document.getElementById('viewCards'),
  viewArticle: document.getElementById('viewArticle'),

  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),

  regionList: document.getElementById('regionList'),
  regionToggle: document.getElementById('regionToggle'),
  breakingDeck: document.getElementById('breakingDeck'),
  breakingLoading: document.getElementById('breakingLoading'),

  recentSearches: document.getElementById('recentSearches'),
  recentArticles: document.getElementById('recentArticles'),

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
  recentSearches: [],
  recentArticles: [],
  articleFontScale: 0.72,
  regionsExpanded: false,
  currentAbort: null  // #15 cancel in-flight
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
    const response = await fetch(`${API_BASE}${path}`, {
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
  els.navBack.disabled = view === 'home';

  if (push) history.pushState({ view }, '', `#${view}`);
}

function goBackView() {
  if (state.view === 'article') return setView('cards');
  if (state.view === 'cards') return setView('home');
}

function scrollCards(direction) {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;
  state.activeCardIndex = Math.max(0, Math.min(cards.length - 1, state.activeCardIndex + direction));
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

/* ═══ Recents ═══ */
function saveRecent() {
  storageSave(RECENT_SEARCH_KEY, state.recentSearches.slice(0, 8));
  storageSave(RECENT_ARTICLE_KEY, state.recentArticles.slice(0, 10));
}

function addRecentSearch(text) {
  const q = String(text || '').trim();
  if (!q) return;
  state.recentSearches = [q, ...state.recentSearches.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  saveRecent();
  renderRecentSearches();
}

function addRecentArticle(item) {
  if (!item?.url || !item?.title) return;
  const next = { title: item.title, url: item.url, source: item.source || '', image: item.image || '' };
  state.recentArticles = [next, ...state.recentArticles.filter(x => x.url !== next.url)].slice(0, 10);
  saveRecent();
  renderRecentArticles();
}

/* ═══ #9: Empty state with emoji ═══ */
function renderEmptyState(container, emoji, message) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-emoji">${emoji}</span><span>${message}</span>`;
  container.appendChild(div);
}

function renderRecentSearches() {
  els.recentSearches.innerHTML = '';
  if (!state.recentSearches.length) {
    renderEmptyState(els.recentSearches, '🔍', 'No searches yet');
    return;
  }
  state.recentSearches.forEach(q => {
    const b = document.createElement('button');
    b.className = 'recent-item';
    b.textContent = `🔎 ${q}`;
    b.addEventListener('click', () => {
      els.searchInput.value = q;
      searchNews(q);
    });
    els.recentSearches.appendChild(b);
  });
}

function renderRecentArticles() {
  els.recentArticles.innerHTML = '';
  if (!state.recentArticles.length) {
    renderEmptyState(els.recentArticles, '📰', 'No articles opened yet');
    return;
  }
  state.recentArticles.forEach(a => {
    const b = document.createElement('button');
    b.className = 'recent-item';
    b.textContent = `📰 ${a.title}`;
    b.title = a.url;
    b.addEventListener('click', () => readArticle(a.url));
    els.recentArticles.appendChild(b);
  });
}

/* ═══ #2: Collapsible region grid ═══ */
function renderRegions() {
  els.regionList.innerHTML = '';
  REGIONS.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'region-btn';
    if (i >= REGIONS_VISIBLE) btn.classList.add('region-extra');
    btn.textContent = r.label;
    btn.addEventListener('click', () => fetchNewsFromUrl(r.url, r.label));
    els.regionList.appendChild(btn);
  });
  updateRegionToggle();
}

function toggleRegions() {
  state.regionsExpanded = !state.regionsExpanded;
  updateRegionToggle();
}

function updateRegionToggle() {
  const extras = els.regionList.querySelectorAll('.region-extra');
  extras.forEach(el => el.classList.toggle('hidden', !state.regionsExpanded));
  els.regionToggle.textContent = state.regionsExpanded ? 'Less regions ▴' : 'More regions ▾';
}

/* ═══ Breaking news cards with images ═══ */
function createBreakingCardElement(card, index) {
  const el = document.createElement('article');
  el.className = 'breaking-card animate-in';
  el.style.animationDelay = `${index * 50}ms`;

  if (card.image?.url) {
    const img = document.createElement('img');
    img.className = 'breaking-card-img';
    img.src = card.image.url;
    img.alt = card.title || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { img.style.display = 'none'; };
    el.appendChild(img);
  }

  const title = document.createElement('span');
  title.className = 'breaking-card-title';
  title.textContent = card.title || `Story ${index + 1}`;
  el.appendChild(title);

  el.addEventListener('click', () => { if (card.url) readArticle(card.url); });
  return el;
}

/* ═══ Breaking news (inline on home) ═══ */
async function loadBreakingNewsInline() {
  try {
    els.breakingLoading.classList.remove('hidden');
    els.breakingLoading.textContent = 'Loading…';
    const data = await api('/api/news', { url: BREAKING_NEWS_URL });
    els.breakingLoading.classList.add('hidden');

    const cards = data.cards || [];
    if (!cards.length) {
      renderEmptyState(els.breakingDeck, '📡', 'No breaking news right now');
      return;
    }

    els.breakingDeck.innerHTML = '';
    cards.forEach((card, index) => {
      els.breakingDeck.appendChild(createBreakingCardElement(card, index));
    });
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
  snippet.textContent = card.snippet || 'Tap to open full story.';

  content.append(title, snippet);
  article.appendChild(content);

  const openCard = () => { if (card.url) readArticle(card.url); };
  article.addEventListener('click', openCard);
  article.addEventListener('touchend', (ev) => { ev.preventDefault(); openCard(); }, { passive: false });

  return article;
}

/* ═══ 3D Wheel Carousel ═══ */
function applyWheelTransforms() {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  const active = state.activeCardIndex;
  cards.forEach((card, i) => {
    const offset = i - active; // -2, -1, 0, 1, 2...
    const absOff = Math.abs(offset);

    // Only render nearby cards for performance
    if (absOff > 3) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';

    // Wheel geometry
    const rotateX = offset * -25;          // degrees per slot
    const translateZ = -absOff * 30;       // push back
    const translateY = offset * 85;        // vertical spacing
    const scale = Math.max(0.55, 1 - absOff * 0.15);
    const opacity = Math.max(0.15, 1 - absOff * 0.35);

    card.style.transform = `translateY(${translateY}px) perspective(600px) rotateX(${rotateX}deg) translateZ(${translateZ}px) scale(${scale})`;
    card.style.opacity = opacity;
    card.style.zIndex = 10 - absOff;
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

  setView('cards');
  applyWheelTransforms();
  setStatus(`${sourceLabel}: ${cards.length} cards`);
}

/* ═══ #1: Article with lead image ═══ */
function renderArticle(data) {
  els.articleTitle.textContent = data.title || 'Article';

  // Show lead image if available
  if (data.image?.url || data.leadImage) {
    els.articleImage.src = data.image?.url || data.leadImage;
    els.articleImage.alt = data.title || 'Article image';
    els.articleImage.classList.remove('hidden');
    els.articleImage.onerror = () => els.articleImage.classList.add('hidden');
  } else {
    els.articleImage.classList.add('hidden');
  }

  if (data.canonicalUrl) {
    els.articleSource.href = data.canonicalUrl;
    els.articleSource.classList.remove('hidden');
  } else {
    els.articleSource.classList.add('hidden');
  }

  els.articleSections.innerHTML = '';
  const parts = (data.sections || []).filter(Boolean);

  if (!parts.length) {
    renderEmptyState(els.articleSections, '📄', 'Could not extract article text.');
    return;
  }

  const block = document.createElement('section');
  block.className = 'article-chunk article-chunk--plain animate-in';
  block.innerHTML = parts.map(part => `<p>${escapeHtml(part)}</p>`).join('');
  els.articleSections.appendChild(block);
}

/* ═══ API actions (using #12 retry) ═══ */
async function fetchNewsFromUrl(url, label = 'Source News') {
  try {
    showLoading('Fetching news cards…');
    const data = await apiWithRetry('/api/news', { url });
    hideLoading();
    renderCards(data.cards || [], label || data.domain || 'News');
  } catch (error) {
    hideLoading();
    // #14 Graceful degradation — show error card with retry
    renderErrorCard(error.message, () => fetchNewsFromUrl(url, label));
  }
}

async function searchNews(query) {
  const q = String(query || '').trim();
  if (!q) return setStatus('Type a search term first.');

  addRecentSearch(q);

  try {
    showLoading('Searching across sources…');
    const data = await apiWithRetry('/api/search', { query: q });
    hideLoading();
    renderCards(data.cards || [], `Search: ${q}`);
  } catch (error) {
    hideLoading();
    renderErrorCard(error.message, () => searchNews(query));
  }
}

async function readArticle(url) {
  try {
    showLoading('Opening article…');
    const data = await apiWithRetry('/api/read', { url });
    hideLoading();
    renderArticle(data);
    addRecentArticle({ title: data.title, url: data.canonicalUrl || url, source: data.domain, image: data.image?.url || '' });
    setView('article');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    applyArticleFontScale();
    setStatus(`Opened article from ${data.domain}.`);
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
    await api('/health', null, 'GET');
  } catch (error) {
    setStatus(`API unavailable: ${error.message}`, { persist: true });
  }
}

/* ═══ Persistence ═══ */
async function loadRecent() {
  try {
    state.recentSearches = (await storageLoad(RECENT_SEARCH_KEY)) || [];
    state.recentArticles = (await storageLoad(RECENT_ARTICLE_KEY)) || [];
    const fontVal = await storageLoad(ARTICLE_FONT_KEY);
    state.articleFontScale = Number(fontVal) || 0.72;
  } catch {
    state.recentSearches = [];
    state.recentArticles = [];
    state.articleFontScale = 0.72;
  }

  renderRecentSearches();
  renderRecentArticles();
  applyArticleFontScale();
}

/* ═══ UI bindings ═══ */
function bindUi() {
  els.navBack.addEventListener('click', goBackView);
  els.navHome.addEventListener('click', goHomeView);

  els.searchBtn.addEventListener('click', () => searchNews(els.searchInput.value));

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

  // Region toggle
  els.regionToggle.addEventListener('click', toggleRegions);

  // Font controls — click only (no touchend double-fire)
  els.fontDown.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(-0.08); });
  els.fontUp.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); changeArticleFont(0.08); });

  window.addEventListener('scroll', refreshActiveCard, { passive: true });
  window.addEventListener('resize', refreshActiveCard, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (state.view === 'cards') {
      if (['ArrowDown', 'PageDown', 'j', 'J'].includes(event.key)) { event.preventDefault(); scrollCards(1); return; }
      if (['ArrowUp', 'PageUp', 'k', 'K'].includes(event.key)) { event.preventDefault(); scrollCards(-1); return; }
      if (event.key === 'Enter') { event.preventDefault(); const a = state.cards[state.activeCardIndex]; if (a?.url) readArticle(a.url); }
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
          setStatus('Refreshing…');
          loadBreakingNewsInline();
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
        window.scrollBy({ top: 50, behavior: 'smooth' });
      }
    });
  });

  // #5 PTT: open active card in cards view
  window.addEventListener('sideClick', () => {
    if (state.view === 'cards') {
      const active = state.cards[state.activeCardIndex];
      if (active?.url) readArticle(active.url);
    } else if (state.view === 'article') {
      goBackView();
    }
  });
}

/* ═══ Service Worker registration (#10) ═══ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* silent */ });
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
