const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');
const BREAKING_NEWS_URL = 'https://feeds.bbci.co.uk/news/world/rss.xml';

const RECENT_SEARCH_KEY = 'r1_recent_searches_v1';
const RECENT_ARTICLE_KEY = 'r1_recent_articles_v1';
const ARTICLE_FONT_KEY = 'r1_article_font_scale_v1';

/* ── Region / country RSS feeds ── */
const REGIONS = [
  { label: '🇺🇸 US', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
  { label: '🇬🇧 UK', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
  { label: '🇪🇺 Europe', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
  { label: '🌍 Africa', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml' },
  { label: '🌏 Asia', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' },
  { label: '🇦🇺 Australia', url: 'https://feeds.bbci.co.uk/news/world/australia/rss.xml' },
  { label: '🌎 L. America', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
  { label: '🇮🇳 India', url: 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml' },
  { label: '🇨🇳 China', url: 'https://feeds.bbci.co.uk/news/world/asia/china/rss.xml' },
  { label: '🏛️ Middle East', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  { label: '💼 Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { label: '🔬 Sci/Tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { label: '⚽ Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { label: '🎬 Entertainment', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { label: '🏥 Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
];

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
  breakingDeck: document.getElementById('breakingDeck'),
  breakingLoading: document.getElementById('breakingLoading'),

  recentSearches: document.getElementById('recentSearches'),
  recentArticles: document.getElementById('recentArticles'),

  deck: document.getElementById('deck'),

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
  articleFontScale: 1
};

/* ── Status / Loading ── */
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

/* ── Helpers ── */
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

function looksSafeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'Only http/https allowed' };
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return { ok: false, reason: 'Localhost blocked' };
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return { ok: false, reason: 'Private IP blocked' };
    if (/^169\.254\./.test(h)) return { ok: false, reason: 'Link-local blocked' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
}

async function api(path, payload, method = 'POST') {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

/* ── Storage (creationStorage with localStorage fallback) ── */
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

/* ── Navigation ── */
function setView(view, { push = true } = {}) {
  state.view = view;

  els.viewHome.classList.toggle('hidden', view !== 'home');
  els.viewCards.classList.toggle('hidden', view !== 'cards');
  els.viewArticle.classList.toggle('hidden', view !== 'article');

  els.fontTools.classList.toggle('hidden', view !== 'article');

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
  cards[state.activeCardIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  refreshActiveCard();
}

function goHomeView() {
  setView('home');
}

/* ── Font controls ── */
function applyArticleFontScale() {
  state.articleFontScale = Math.max(0.82, Math.min(1.45, Number(state.articleFontScale) || 1));
  els.articleSections.style.fontSize = `${state.articleFontScale}em`;
  storageSave(ARTICLE_FONT_KEY, state.articleFontScale);
}

function changeArticleFont(delta) {
  state.articleFontScale = (Number(state.articleFontScale) || 1) + delta;
  applyArticleFontScale();
  setStatus(`Text size: ${Math.round(state.articleFontScale * 100)}%`);
}

/* ── Recents ── */
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

  const next = { title: item.title, url: item.url, source: item.source || '' };
  state.recentArticles = [next, ...state.recentArticles.filter(x => x.url !== next.url)].slice(0, 10);
  saveRecent();
  renderRecentArticles();
}

function renderRecentSearches() {
  els.recentSearches.innerHTML = '';
  if (!state.recentSearches.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = 'No recent searches yet.';
    els.recentSearches.appendChild(empty);
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
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = 'No articles opened yet.';
    els.recentArticles.appendChild(empty);
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

/* ── Region buttons ── */
function renderRegions() {
  els.regionList.innerHTML = '';
  REGIONS.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'region-btn';
    btn.textContent = r.label;
    btn.addEventListener('click', () => fetchNewsFromUrl(r.url, r.label));
    els.regionList.appendChild(btn);
  });
}

/* ── Breaking news (inline on home) ── */
async function loadBreakingNewsInline() {
  try {
    const data = await api('/api/news', { url: BREAKING_NEWS_URL });
    const cards = data.cards || [];
    els.breakingLoading.classList.add('hidden');

    if (!cards.length) {
      els.breakingDeck.innerHTML = '<div class="microcopy">No breaking news available.</div>';
      return;
    }

    els.breakingDeck.innerHTML = '';
    cards.forEach((card, index) => {
      els.breakingDeck.appendChild(createCardElement(card, index));
    });
  } catch (error) {
    els.breakingLoading.textContent = 'Could not load breaking news.';
  }
}

/* ── Card creation ── */
function createCardElement(card, index) {
  const article = document.createElement('article');
  article.className = 'news-card';
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

  const openCard = () => {
    if (card.url) readArticle(card.url);
  };

  article.addEventListener('click', openCard);
  article.addEventListener('touchend', (ev) => { ev.preventDefault(); openCard(); }, { passive: false });

  return article;
}

/* ── Active card highlight ── */
function refreshActiveCard() {
  if (state.view !== 'cards') return;

  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  const center = window.innerHeight * 0.42;
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  cards.forEach((card, i) => {
    const rect = card.getBoundingClientRect();
    const cardCenter = rect.top + rect.height / 2;
    const dist = Math.abs(cardCenter - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  });

  state.activeCardIndex = bestIndex;
  cards.forEach((card, i) => card.classList.toggle('is-active', i === bestIndex));
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
  window.scrollTo({ top: 0, behavior: 'auto' });
  refreshActiveCard();
  setStatus(`${sourceLabel}: ${cards.length} cards`);
}

function renderArticle(data) {
  els.articleTitle.textContent = data.title || 'Article';

  if (data.canonicalUrl) {
    els.articleSource.href = data.canonicalUrl;
    els.articleSource.classList.remove('hidden');
  } else {
    els.articleSource.classList.add('hidden');
  }

  els.articleSections.innerHTML = '';
  const parts = (data.sections || []).filter(Boolean);

  if (!parts.length) {
    const empty = document.createElement('p');
    empty.className = 'microcopy';
    empty.textContent = 'Could not extract article text from this source.';
    els.articleSections.appendChild(empty);
    return;
  }

  const block = document.createElement('section');
  block.className = 'article-chunk article-chunk--plain';
  block.innerHTML = parts.map(part => `<p>${escapeHtml(part)}</p>`).join('');
  els.articleSections.appendChild(block);
}

/* ── API actions ── */
async function fetchNewsFromUrl(url, label = 'Source News') {
  try {
    showLoading('Fetching news cards…');
    const data = await api('/api/news', { url });
    hideLoading();
    renderCards(data.cards || [], label || data.domain || 'News');
  } catch (error) {
    hideLoading();
    setStatus(error.message, { persist: true });
  }
}

async function searchNews(query) {
  const q = String(query || '').trim();
  if (!q) return setStatus('Type a search term first.');

  addRecentSearch(q);

  try {
    showLoading('Searching across sources…');
    const data = await api('/api/search', { query: q });
    hideLoading();
    renderCards(data.cards || [], `Search: ${q}`);
  } catch (error) {
    hideLoading();
    setStatus(error.message, { persist: true });
  }
}

async function readArticle(url) {
  try {
    showLoading('Opening article…');
    const data = await api('/api/read', { url });
    hideLoading();
    renderArticle(data);
    addRecentArticle({ title: data.title, url: data.canonicalUrl || url, source: data.domain });
    setView('article');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    applyArticleFontScale();
    setStatus(`Opened article from ${data.domain}.`);
  } catch (error) {
    hideLoading();
    setStatus(error.message, { persist: true });
  }
}

async function healthCheck() {
  try {
    await api('/health', null, 'GET');
  } catch (error) {
    setStatus(`API unavailable: ${error.message}`, { persist: true });
  }
}

/* ── Persistence ── */
async function loadRecent() {
  try {
    state.recentSearches = (await storageLoad(RECENT_SEARCH_KEY)) || [];
    state.recentArticles = (await storageLoad(RECENT_ARTICLE_KEY)) || [];
    const fontVal = await storageLoad(ARTICLE_FONT_KEY);
    state.articleFontScale = Number(fontVal) || 1;
  } catch {
    state.recentSearches = [];
    state.recentArticles = [];
    state.articleFontScale = 1;
  }

  renderRecentSearches();
  renderRecentArticles();
  applyArticleFontScale();
}

/* ── UI bindings ── */
function bindUi() {
  els.navBack.addEventListener('click', goBackView);
  els.navHome.addEventListener('click', goHomeView);

  els.searchBtn.addEventListener('click', () => searchNews(els.searchInput.value));

  // Enter key in search input
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchNews(els.searchInput.value);
    }
  });

  // Font controls — use ONLY click (not touchend) to prevent double-fire on R1
  els.fontDown.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    changeArticleFont(-0.08);
  });
  els.fontUp.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    changeArticleFont(0.08);
  });

  window.addEventListener('scroll', refreshActiveCard, { passive: true });
  window.addEventListener('resize', refreshActiveCard, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (state.view === 'cards') {
      if (['ArrowDown', 'PageDown', 'j', 'J'].includes(event.key)) {
        event.preventDefault();
        scrollCards(1);
        return;
      }

      if (['ArrowUp', 'PageUp', 'k', 'K'].includes(event.key)) {
        event.preventDefault();
        scrollCards(-1);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const active = state.cards[state.activeCardIndex];
        if (active?.url) readArticle(active.url);
      }
      return;
    }

    if (state.view === 'article') {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        changeArticleFont(0.08);
      } else if (event.key === '-') {
        event.preventDefault();
        changeArticleFont(-0.08);
      }
    }
  });

  window.addEventListener('popstate', (event) => {
    const view = event.state?.view || 'home';
    setView(view, { push: false });
  });
}

/* ── R1 hardware (scroll wheel + side button) with throttle ── */
function initR1Hardware() {
  let scrollLock = false;
  const SCROLL_COOLDOWN = 180; // ms between scroll ticks

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
        window.scrollBy({ top: -50, behavior: 'smooth' });
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

  window.addEventListener('sideClick', () => {
    if (state.view === 'cards') {
      const active = state.cards[state.activeCardIndex];
      if (active?.url) readArticle(active.url);
    } else if (state.view === 'article') {
      goBackView();
    }
  });
}

/* ── Boot ── */
function boot() {
  bindUi();
  initR1Hardware();
  renderRegions();
  loadRecent();
  setView('home', { push: false });
  history.replaceState({ view: 'home' }, '', '#home');
  healthCheck();
  loadBreakingNewsInline();
}

boot();
