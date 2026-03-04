const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');
const BREAKING_NEWS_URL = 'https://feeds.bbci.co.uk/news/world/rss.xml';

const RECENT_SEARCH_KEY = 'r1_recent_searches_v1';
const RECENT_ARTICLE_KEY = 'r1_recent_articles_v1';

const els = {
  navBack: document.getElementById('navBack'),
  navHome: document.getElementById('navHome'),
  viewLabel: document.getElementById('viewLabel'),

  viewHome: document.getElementById('viewHome'),
  viewCards: document.getElementById('viewCards'),
  viewArticle: document.getElementById('viewArticle'),

  urlInput: document.getElementById('urlInput'),
  previewBtn: document.getElementById('previewBtn'),
  fetchFromUrlBtn: document.getElementById('fetchFromUrlBtn'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  breakingBtn: document.getElementById('breakingBtn'),

  previewPane: document.getElementById('previewPane'),
  previewDomain: document.getElementById('previewDomain'),
  previewUrl: document.getElementById('previewUrl'),
  previewSafety: document.getElementById('previewSafety'),
  openPreviewBtn: document.getElementById('openPreviewBtn'),
  cancelPreviewBtn: document.getElementById('cancelPreviewBtn'),

  recentSearches: document.getElementById('recentSearches'),
  recentArticles: document.getElementById('recentArticles'),

  cardsTitle: document.getElementById('cardsTitle'),
  prevCardBtn: document.getElementById('prevCardBtn'),
  nextCardBtn: document.getElementById('nextCardBtn'),
  deck: document.getElementById('deck'),

  articleTitle: document.getElementById('articleTitle'),
  articleSummary: document.getElementById('articleSummary'),
  articleSource: document.getElementById('articleSource'),
  articleSections: document.getElementById('articleSections'),

  status: document.getElementById('status')
};

const state = {
  view: 'home',
  cards: [],
  activeCardIndex: 0,
  previewCandidate: null,
  recentSearches: [],
  recentArticles: []
};

function setStatus(message) {
  els.status.textContent = message || '';
}

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

function setView(view, { push = true } = {}) {
  state.view = view;

  els.viewHome.classList.toggle('hidden', view !== 'home');
  els.viewCards.classList.toggle('hidden', view !== 'cards');
  els.viewArticle.classList.toggle('hidden', view !== 'article');

  const labels = { home: 'Home', cards: 'News Cards', article: 'Article' };
  els.viewLabel.textContent = labels[view] || 'Home';
  els.navBack.disabled = view === 'home';

  if (push) history.pushState({ view }, '', `#${view}`);
}

function goBackView() {
  if (state.view === 'article') return setView('cards');
  if (state.view === 'cards') return setView('home');
}

function goHomeView() {
  setView('home');
}

function saveRecent() {
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(state.recentSearches.slice(0, 8)));
  localStorage.setItem(RECENT_ARTICLE_KEY, JSON.stringify(state.recentArticles.slice(0, 10)));
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

  const next = {
    title: item.title,
    url: item.url,
    source: item.source || ''
  };

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

function renderPreview(data) {
  els.previewPane.classList.remove('hidden');
  els.previewDomain.textContent = data.domain || '-';
  els.previewUrl.textContent = data.url || '-';
  els.previewSafety.textContent = data.safe ? 'Safe' : 'Blocked';
  els.previewSafety.className = `badge ${data.safe ? 'safe' : 'blocked'}`;
  state.previewCandidate = data.url;
}

async function previewUrl(url) {
  const safe = looksSafeUrl(url);
  if (!safe.ok) {
    renderPreview({ url, domain: '-', safe: false });
    setStatus(safe.reason);
    return;
  }

  try {
    const data = await api('/api/preview', { url });
    renderPreview(data);
    setStatus('Preview ready.');
  } catch (error) {
    setStatus(error.message);
  }
}

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
      img.classList.add('news-card-image--placeholder');
      img.alt = 'Top story';
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
  snippet.textContent = card.snippet || 'Open for full story.';

  const readBtn = document.createElement('button');
  readBtn.className = 'btn btn-primary read-btn';
  readBtn.textContent = 'Dive In';
  readBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (card.url) readArticle(card.url);
  });

  content.append(title, snippet, readBtn);
  article.appendChild(content);

  article.addEventListener('click', () => setActiveCard(index));
  return article;
}

function setActiveCard(index, { scroll = true } = {}) {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  state.activeCardIndex = Math.max(0, Math.min(index, cards.length - 1));

  cards.forEach((cardEl, i) => {
    cardEl.classList.toggle('is-active', i === state.activeCardIndex);
  });

  if (scroll) {
    cards[state.activeCardIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  }

  const active = state.cards[state.activeCardIndex];
  if (active?.title) setStatus(`Card ${state.activeCardIndex + 1}/${state.cards.length}: ${active.title}`);
}

function moveCard(step) {
  setActiveCard(state.activeCardIndex + step);
}

function handleCardStep(step) {
  if (state.view !== 'cards' || !state.cards.length) return;
  moveCard(step);
}

function activeIndexFromDeckScroll() {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return 0;

  const deckTop = els.deck.getBoundingClientRect().top;
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  cards.forEach((card, i) => {
    const dist = Math.abs(card.getBoundingClientRect().top - deckTop);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  });

  return bestIndex;
}

function attachDeckControls() {
  els.deck.addEventListener('scroll', () => {
    if (state.view !== 'cards') return;
    const idx = activeIndexFromDeckScroll();
    if (idx !== state.activeCardIndex) setActiveCard(idx, { scroll: false });
  }, { passive: true });
}

function renderCards(cards = [], sourceLabel = 'News') {
  state.cards = cards;
  state.activeCardIndex = 0;
  els.deck.innerHTML = '';

  if (!cards.length) {
    setStatus('No cards found. Try another source or keyword.');
    return;
  }

  cards.forEach((card, index) => {
    els.deck.appendChild(createCardElement(card, index));
  });

  els.cardsTitle.textContent = sourceLabel;
  setView('cards');
  els.deck.scrollTop = 0;
  els.deck.setAttribute('tabindex', '0');
  els.deck.focus();
  setActiveCard(0, { scroll: false });
}

function renderArticle(data) {
  els.articleTitle.textContent = data.title || 'Article';
  els.articleSummary.textContent = data.summary || '';

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

async function fetchNewsFromUrl(url, label = 'Source News') {
  try {
    setStatus('Fetching news cards…');
    const data = await api('/api/news', { url });
    renderCards(data.cards || [], label || data.domain || 'News');
    setStatus(`Fetched ${data.cards?.length || 0} cards from ${data.domain}.`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function fetchBreakingNews() {
  await fetchNewsFromUrl(BREAKING_NEWS_URL, 'Breaking News Worldwide');
}

async function searchNews(query) {
  const q = String(query || '').trim();
  if (!q) return setStatus('Type a search term first.');

  addRecentSearch(q);

  try {
    setStatus('Searching across sources…');
    const data = await api('/api/search', { query: q });
    renderCards(data.cards || [], `Search: ${q}`);
    setStatus(`Found ${data.cards?.length || 0} cards.`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function readArticle(url) {
  try {
    setStatus('Opening article…');
    const data = await api('/api/read', { url });
    renderArticle(data);
    addRecentArticle({ title: data.title, url: data.canonicalUrl || url, source: data.domain });
    setView('article');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setStatus(`Opened article from ${data.domain}.`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function healthCheck() {
  try {
    await api('/health', null, 'GET');
    setStatus('Ready. Enter source or search keyword.');
  } catch (error) {
    setStatus(`API unavailable: ${error.message}`);
  }
}

function loadRecent() {
  try {
    state.recentSearches = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]');
    state.recentArticles = JSON.parse(localStorage.getItem(RECENT_ARTICLE_KEY) || '[]');
  } catch {
    state.recentSearches = [];
    state.recentArticles = [];
  }
  renderRecentSearches();
  renderRecentArticles();
}

function bindUi() {
  els.navBack.addEventListener('click', goBackView);
  els.navHome.addEventListener('click', goHomeView);

  els.previewBtn.addEventListener('click', () => {
    const url = normaliseToUrl(els.urlInput.value.trim());
    if (!url) return setStatus('Enter valid URL (bbc.com or full https://).');
    els.urlInput.value = url;
    previewUrl(url);
  });

  els.fetchFromUrlBtn.addEventListener('click', () => {
    const url = normaliseToUrl(els.urlInput.value.trim());
    if (!url) return setStatus('Enter valid source URL first.');
    els.urlInput.value = url;
    fetchNewsFromUrl(url, 'Source News');
  });

  els.searchBtn.addEventListener('click', () => searchNews(els.searchInput.value));
  els.breakingBtn.addEventListener('click', fetchBreakingNews);

  els.openPreviewBtn.addEventListener('click', () => {
    if (!state.previewCandidate) return;
    fetchNewsFromUrl(state.previewCandidate, 'Source News');
  });

  els.cancelPreviewBtn.addEventListener('click', () => {
    els.previewPane.classList.add('hidden');
    state.previewCandidate = null;
    setStatus('Preview cancelled.');
  });

  els.prevCardBtn.addEventListener('click', () => handleCardStep(-1));
  els.nextCardBtn.addEventListener('click', () => handleCardStep(1));

  window.addEventListener('keydown', (event) => {
    if (state.view !== 'cards') return;

    if (['ArrowDown', 'PageDown', 'j', 'J'].includes(event.key)) {
      event.preventDefault();
      handleCardStep(1);
      return;
    }

    if (['ArrowUp', 'PageUp', 'k', 'K'].includes(event.key)) {
      event.preventDefault();
      handleCardStep(-1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const active = state.cards[state.activeCardIndex];
      if (active?.url) readArticle(active.url);
    }
  });

  window.addEventListener('popstate', (event) => {
    const view = event.state?.view || 'home';
    setView(view, { push: false });
  });
}

function boot() {
  bindUi();
  attachDeckControls();
  loadRecent();
  setView('home', { push: false });
  history.replaceState({ view: 'home' }, '', '#home');
  healthCheck();
}

boot();
