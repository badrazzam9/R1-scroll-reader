const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');

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
  scanBtn: document.getElementById('scanBtn'),
  voiceBtn: document.getElementById('voiceBtn'),

  previewPane: document.getElementById('previewPane'),
  previewDomain: document.getElementById('previewDomain'),
  previewUrl: document.getElementById('previewUrl'),
  previewSafety: document.getElementById('previewSafety'),
  openPreviewBtn: document.getElementById('openPreviewBtn'),
  cancelPreviewBtn: document.getElementById('cancelPreviewBtn'),
  rescanPreviewBtn: document.getElementById('rescanPreviewBtn'),

  scannerPane: document.getElementById('scannerPane'),
  scannerVideo: document.getElementById('scannerVideo'),
  stopScanBtn: document.getElementById('stopScanBtn'),
  manualUrlBtn: document.getElementById('manualUrlBtn'),

  cardsTitle: document.getElementById('cardsTitle'),
  cardsSub: document.getElementById('cardsSub'),
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
  scannedCandidate: null,
  stream: null,
  rafId: null,
  recognition: null,
  wheelLocked: false
};

const BREAKING_NEWS_URL = 'https://feeds.bbci.co.uk/news/world/rss.xml';

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

function normaliseVoiceUrl(input) {
  if (!input) return null;
  const spoken = input
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+slash\s+/gi, '/')
    .replace(/\s+/g, '')
    .trim();
  return normaliseToUrl(spoken);
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

  const labels = {
    home: 'Home',
    cards: 'News Cards',
    article: 'Article'
  };
  els.viewLabel.textContent = labels[view] || 'Home';
  els.navBack.disabled = view === 'home';

  if (push) {
    history.pushState({ view }, '', `#${view}`);
  }
}

function goBackView() {
  if (state.view === 'article') return setView('cards');
  if (state.view === 'cards') return setView('home');
}

function goHomeView() {
  setView('home');
}

function renderPreview(data) {
  els.previewPane.classList.remove('hidden');
  els.previewDomain.textContent = data.domain || '-';
  els.previewUrl.textContent = data.url || '-';
  els.previewSafety.textContent = data.safe ? 'Safe' : 'Blocked';
  els.previewSafety.className = `badge ${data.safe ? 'safe' : 'blocked'}`;
  state.scannedCandidate = data.url;
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
    img.onerror = () => img.remove();
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
  snippet.textContent = card.snippet || 'Open this story for the full cleaned article.';

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

function setActiveCard(index) {
  const cards = [...els.deck.querySelectorAll('.news-card')];
  if (!cards.length) return;

  state.activeCardIndex = Math.max(0, Math.min(index, cards.length - 1));

  const compact = window.innerWidth <= 480;

  cards.forEach((cardEl, i) => {
    const diff = i - state.activeCardIndex;
    const abs = Math.abs(diff);

    if (abs > 3) {
      cardEl.classList.add('hide');
      cardEl.style.pointerEvents = 'none';
      return;
    }

    const y = diff * (compact ? 42 : 62);
    const scale = 1 - Math.min(abs * (compact ? 0.08 : 0.07), compact ? 0.24 : 0.21);
    const opacity = diff === 0 ? 1 : Math.max(compact ? 0.16 : 0.2, 1 - abs * 0.27);

    cardEl.classList.remove('hide');
    cardEl.classList.toggle('is-active', diff === 0);
    cardEl.style.transform = `translate(-50%, calc(-50% + ${y}px)) scale(${scale})`;
    cardEl.style.opacity = String(opacity);
    cardEl.style.zIndex = String(100 - abs);
    cardEl.style.pointerEvents = diff === 0 ? 'auto' : 'none';
  });

  const active = state.cards[state.activeCardIndex];
  if (active) setStatus(`Card ${state.activeCardIndex + 1}/${state.cards.length}: ${active.title}`);
}

function moveCard(step) {
  setActiveCard(state.activeCardIndex + step);
}

function handleCardStep(step) {
  if (state.view !== 'cards' || !state.cards.length) return;
  if (state.wheelLocked) return;

  state.wheelLocked = true;
  moveCard(step);
  setTimeout(() => { state.wheelLocked = false; }, 170);
}

function attachDeckWheel() {
  els.deck.onwheel = (event) => {
    if (state.view !== 'cards' || !state.cards.length) return;
    event.preventDefault();
    handleCardStep(event.deltaY > 0 ? 1 : -1);
  };
}

function renderCards(cards = [], sourceLabel = 'News') {
  state.cards = cards;
  state.activeCardIndex = 0;
  els.deck.innerHTML = '';

  if (!cards.length) {
    setStatus('No cards found. Try another source or query.');
    return;
  }

  cards.forEach((card, index) => {
    els.deck.appendChild(createCardElement(card, index));
  });

  els.cardsTitle.textContent = sourceLabel;
  setView('cards');
  attachDeckWheel();
  setActiveCard(0);
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
  (data.sections || []).forEach((section, i) => {
    const block = document.createElement('section');
    block.className = 'article-chunk';
    block.innerHTML = `<h4>Section ${i + 1}</h4><p>${escapeHtml(section)}</p>`;
    els.articleSections.appendChild(block);
  });
}

async function fetchNewsFromUrl(url, label = 'News') {
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
  try {
    setStatus('Searching across major feeds…');
    const data = await api('/api/search', { query });
    renderCards(data.cards || [], `Search: ${query}`);
    setStatus(`Found ${data.cards?.length || 0} matching cards.`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function readArticle(url) {
  try {
    setStatus('Opening full story…');
    const data = await api('/api/read', { url });
    renderArticle(data);
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
    setStatus('Ready. Enter a source or run a news search.');
  } catch (error) {
    setStatus(`API unavailable: ${error.message}`);
  }
}

function stopScan() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;

  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  state.stream = null;
  els.scannerPane.classList.add('hidden');
}

async function startScan() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera unavailable. Use manual URL.');
    const manual = prompt('Paste URL from QR:');
    if (!manual) return;
    const url = normaliseToUrl(manual);
    if (!url) return setStatus('Invalid URL. Try bbc.com or full https:// URL.');
    els.urlInput.value = url;
    previewUrl(url);
    return;
  }

  els.scannerPane.classList.remove('hidden');

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    els.scannerVideo.srcObject = state.stream;

    if (!('BarcodeDetector' in window)) {
      setStatus('QR detector unavailable. Use manual URL.');
      return;
    }

    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    const tick = async () => {
      if (!state.stream) return;

      try {
        const matches = await detector.detect(els.scannerVideo);
        if (matches.length) {
          const raw = matches[0].rawValue || '';
          stopScan();
          const url = normaliseToUrl(raw.trim());
          if (!url) return setStatus('Invalid URL in QR code.');
          els.urlInput.value = url;
          await previewUrl(url);
          return;
        }
      } catch {
        // keep scanning
      }

      state.rafId = requestAnimationFrame(tick);
    };

    tick();
  } catch {
    setStatus('Could not access camera. Use manual URL fallback.');
  }
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    els.voiceBtn.disabled = true;
    els.voiceBtn.textContent = '🎙 Voice (unsupported)';
    return;
  }

  state.recognition = new SR();
  state.recognition.lang = 'en-GB';
  state.recognition.continuous = false;
  state.recognition.interimResults = false;

  state.recognition.onresult = (event) => {
    const text = event.results[0][0].transcript.toLowerCase().trim();
    handleVoiceIntent(text);
  };

  state.recognition.onerror = () => setStatus('Voice input failed. Try again.');
}

function handleVoiceIntent(text) {
  setStatus(`Heard: "${text}"`);

  if (text.startsWith('open ')) {
    const url = normaliseVoiceUrl(text.replace(/^open\s+/, ''));
    if (!url) return setStatus('Could not parse URL.');
    els.urlInput.value = url;
    previewUrl(url);
    return;
  }

  if (text === 'breaking news') return fetchBreakingNews();
  if (text === 'fetch news') {
    const url = normaliseToUrl(els.urlInput.value.trim());
    if (!url) return setStatus('Set a valid source URL first.');
    return fetchNewsFromUrl(url, 'Source News');
  }

  if (text.startsWith('search ')) {
    const q = text.replace(/^search\s+/, '').trim();
    if (!q) return setStatus('Say: search <topic>.');
    els.searchInput.value = q;
    return searchNews(q);
  }

  if (text === 'next card' || text === 'scroll down') return moveCard(1);
  if (text === 'previous card' || text === 'scroll up') return moveCard(-1);

  if (text === 'read this' || text === 'read card' || text === 'dive in') {
    const active = state.cards[state.activeCardIndex];
    if (!active?.url) return setStatus('No active card to read.');
    return readArticle(active.url);
  }

  if (text === 'home') return goHomeView();
  if (text === 'back') return goBackView();

  setStatus('Try: open bbc.com, fetch news, breaking news, next card, read this.');
}

function bindUi() {
  els.navBack.addEventListener('click', goBackView);
  els.navHome.addEventListener('click', goHomeView);

  els.previewBtn.addEventListener('click', () => {
    const url = normaliseToUrl(els.urlInput.value.trim());
    if (!url) return setStatus('Enter a valid URL (e.g. bbc.com or https://bbc.com).');
    els.urlInput.value = url;
    previewUrl(url);
  });

  els.fetchFromUrlBtn.addEventListener('click', () => {
    const url = normaliseToUrl(els.urlInput.value.trim());
    if (!url) return setStatus('Enter a valid source URL first.');
    els.urlInput.value = url;
    fetchNewsFromUrl(url, 'Source News');
  });

  els.searchBtn.addEventListener('click', () => {
    const q = els.searchInput.value.trim();
    if (!q) return setStatus('Type a news query first.');
    searchNews(q);
  });

  els.breakingBtn.addEventListener('click', fetchBreakingNews);
  els.scanBtn.addEventListener('click', startScan);
  els.stopScanBtn.addEventListener('click', stopScan);

  els.manualUrlBtn.addEventListener('click', () => {
    const input = prompt('Paste URL:');
    if (!input) return;
    const url = normaliseToUrl(input.trim());
    if (!url) return setStatus('Invalid URL.');
    els.urlInput.value = url;
    previewUrl(url);
  });

  els.openPreviewBtn.addEventListener('click', () => {
    if (!state.scannedCandidate) return;
    fetchNewsFromUrl(state.scannedCandidate, 'Source News');
  });

  els.cancelPreviewBtn.addEventListener('click', () => {
    els.previewPane.classList.add('hidden');
    state.scannedCandidate = null;
    setStatus('Preview cancelled.');
  });

  els.rescanPreviewBtn.addEventListener('click', startScan);
  els.voiceBtn.addEventListener('click', () => state.recognition?.start());
  els.prevCardBtn?.addEventListener('click', () => handleCardStep(-1));
  els.nextCardBtn?.addEventListener('click', () => handleCardStep(1));

  let touchStartY = 0;
  els.deck?.addEventListener('touchstart', (ev) => {
    touchStartY = ev.changedTouches?.[0]?.clientY || 0;
  }, { passive: true });

  els.deck?.addEventListener('touchend', (ev) => {
    const endY = ev.changedTouches?.[0]?.clientY || 0;
    const delta = touchStartY - endY;
    if (Math.abs(delta) < 24) return;
    handleCardStep(delta > 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener('wheel', (event) => {
    if (state.view !== 'cards') return;
    event.preventDefault();
    handleCardStep(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });

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

  window.addEventListener('beforeunload', stopScan);
}

function boot() {
  bindUi();
  setupVoice();
  setView('home', { push: false });
  history.replaceState({ view: 'home' }, '', '#home');
  healthCheck();
}

boot();
