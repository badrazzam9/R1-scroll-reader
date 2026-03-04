const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');

const els = {
  urlInput: document.getElementById('urlInput'),
  previewBtn: document.getElementById('previewBtn'),
  fetchNewsBtn: document.getElementById('fetchNewsBtn'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  scanBtn: document.getElementById('scanBtn'),
  stopScanBtn: document.getElementById('stopScanBtn'),
  manualUrlBtn: document.getElementById('manualUrlBtn'),
  scannerPane: document.getElementById('scannerPane'),
  scannerVideo: document.getElementById('scannerVideo'),
  previewPane: document.getElementById('previewPane'),
  previewDomain: document.getElementById('previewDomain'),
  previewUrl: document.getElementById('previewUrl'),
  previewSafety: document.getElementById('previewSafety'),
  openPreviewBtn: document.getElementById('openPreviewBtn'),
  cancelPreviewBtn: document.getElementById('cancelPreviewBtn'),
  rescanPreviewBtn: document.getElementById('rescanPreviewBtn'),
  voiceBtn: document.getElementById('voiceBtn'),
  newsDeckSection: document.getElementById('newsDeckSection'),
  newsDeck: document.getElementById('newsDeck'),
  summaryCard: document.getElementById('summaryCard'),
  imageCard: document.getElementById('imageCard'),
  imageGallery: document.getElementById('imageGallery'),
  reader: document.getElementById('reader'),
  title: document.getElementById('title'),
  summary: document.getElementById('summary'),
  sourceLink: document.getElementById('sourceLink'),
  backToCardsBtn: document.getElementById('backToCardsBtn'),
  status: document.getElementById('status')
};

let scannedCandidate = null;
let stream = null;
let rafId = null;
let recognition = null;
let newsCards = [];
let currentCardIndex = 0;
let wheelLocked = false;
let lastReadData = null;

function setStatus(msg) {
  els.status.textContent = msg || '';
}

function normalizeToUrl(input) {
  if (!input) return null;
  const cleaned = input.trim();
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(cleaned)) return `https://${cleaned}`;
  return null;
}

function normalizeVoiceUrl(input) {
  if (!input) return null;
  const spoken = input
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+slash\s+/gi, '/')
    .replace(/\s+/g, '')
    .trim();
  return normalizeToUrl(spoken);
}

function looksSafeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'Only http/https allowed' };
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return { ok: false, reason: 'Localhost blocked' };
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return { ok: false, reason: 'Private IP blocked' };
    if (/^169\.254\./.test(host)) return { ok: false, reason: 'Link-local blocked' };
    return { ok: true, reason: 'Looks safe' };
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
}

async function api(path, payload, method = 'POST') {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {})
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderPreview(data) {
  els.previewPane.classList.remove('hidden');
  els.previewDomain.textContent = data.domain || '-';
  els.previewUrl.textContent = data.url || '-';
  els.previewSafety.textContent = data.safe ? 'Safe' : 'Blocked';
  els.previewSafety.className = `badge ${data.safe ? 'safe' : 'blocked'}`;
  scannedCandidate = data.url;
}

async function previewUrl(url) {
  const localSafe = looksSafeUrl(url);
  if (!localSafe.ok) {
    renderPreview({ url, domain: '-', safe: false });
    setStatus(localSafe.reason);
    return;
  }

  try {
    const data = await api('/api/preview', { url });
    renderPreview(data);
    setStatus('Preview ready.');
  } catch (e) {
    setStatus(e.message);
  }
}

function createNewsCardElement(card, index) {
  const article = document.createElement('article');
  article.className = 'news-card';
  article.dataset.index = String(index);

  if (card.image?.url) {
    const img = document.createElement('img');
    img.className = 'news-card-image';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = card.image.url;
    img.alt = card.image.alt || card.title || `News image ${index + 1}`;
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.remove();
    article.appendChild(img);
  }

  const content = document.createElement('div');
  content.className = 'news-card-content';

  const h4 = document.createElement('h4');
  h4.textContent = card.title || `Story ${index + 1}`;
  content.appendChild(h4);

  const p = document.createElement('p');
  p.textContent = card.snippet || '';
  content.appendChild(p);

  const actions = document.createElement('div');
  actions.className = 'row';

  const readBtn = document.createElement('button');
  readBtn.className = 'btn btn-primary';
  readBtn.textContent = 'Read this';
  readBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (card.url) readArticle(card.url);
  });

  const openBtn = document.createElement('button');
  openBtn.className = 'btn';
  openBtn.textContent = 'Open source';
  openBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (card.url) window.open(card.url, '_blank', 'noopener,noreferrer');
  });

  actions.append(readBtn, openBtn);
  content.appendChild(actions);

  article.appendChild(content);

  article.addEventListener('click', () => {
    setActiveCard(index);
  });

  return article;
}

function setActiveCard(nextIndex) {
  const cards = [...els.newsDeck.querySelectorAll('.news-card')];
  if (!cards.length) return;
  currentCardIndex = Math.max(0, Math.min(nextIndex, cards.length - 1));

  cards.forEach((c, i) => c.classList.toggle('active', i === currentCardIndex));
  cards[currentCardIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const active = newsCards[currentCardIndex];
  if (active?.title) setStatus(`Card ${currentCardIndex + 1}/${newsCards.length}: ${active.title}`);
}

function moveCard(direction) {
  setActiveCard(currentCardIndex + direction);
}

function attachWheelCardSwipe() {
  if (!els.newsDeck) return;
  els.newsDeck.onwheel = (event) => {
    if (!newsCards.length) return;
    event.preventDefault();
    if (wheelLocked) return;
    wheelLocked = true;

    moveCard(event.deltaY > 0 ? 1 : -1);
    setTimeout(() => {
      wheelLocked = false;
    }, 260);
  };
}

function renderNewsCards(cards = []) {
  newsCards = cards;
  currentCardIndex = 0;
  els.newsDeck.innerHTML = '';

  if (!cards.length) {
    els.newsDeckSection.classList.add('hidden');
    setStatus('No news cards found from this source.');
    return;
  }

  cards.forEach((card, index) => {
    els.newsDeck.appendChild(createNewsCardElement(card, index));
  });

  els.newsDeckSection.classList.remove('hidden');
  attachWheelCardSwipe();
  setActiveCard(0);
}

function renderImages(images = []) {
  els.imageGallery.innerHTML = '';
  if (!images.length) {
    els.imageCard.classList.add('hidden');
    return;
  }

  images.slice(0, 8).forEach((img, i) => {
    const fig = document.createElement('figure');
    fig.className = 'image-item';

    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = img.url;
    image.alt = img.alt || `Related image ${i + 1}`;
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => fig.remove();
    fig.appendChild(image);

    if (img.alt) {
      const cap = document.createElement('figcaption');
      cap.textContent = img.alt;
      fig.appendChild(cap);
    }

    els.imageGallery.appendChild(fig);
  });

  if (els.imageGallery.children.length) els.imageCard.classList.remove('hidden');
  else els.imageCard.classList.add('hidden');
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderArticle(data) {
  lastReadData = data;
  els.summaryCard.classList.remove('hidden');
  els.title.textContent = data.title || data.domain || 'Untitled';
  els.summary.textContent = data.summary || 'No summary available.';

  if (data.canonicalUrl) {
    els.sourceLink.href = data.canonicalUrl;
    els.sourceLink.classList.remove('hidden');
  } else {
    els.sourceLink.classList.add('hidden');
  }

  renderImages(data.images || []);

  els.reader.innerHTML = '';
  (data.sections || []).forEach((txt, i) => {
    const section = document.createElement('article');
    section.className = 'section-card';
    section.id = `section-${i + 1}`;
    section.innerHTML = `<h4>Section ${i + 1}</h4><p>${escapeHtml(txt)}</p>`;
    els.reader.appendChild(section);
  });
}

async function fetchNews(url) {
  try {
    const data = await api('/api/news', { url });
    renderNewsCards(data.cards || []);
    setStatus(`Fetched ${data.cards?.length || 0} cards from ${data.domain}. Use wheel to swipe.`);
  } catch (e) {
    setStatus(e.message);
  }
}

async function readArticle(url) {
  try {
    setStatus('Loading article…');
    const data = await api('/api/read', { url });
    renderArticle(data);
    els.summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus(`Loaded article from ${data.domain}.`);
  } catch (e) {
    setStatus(e.message);
  }
}

async function healthCheck() {
  try {
    await api('/health', null, 'GET');
    setStatus('Connected. Enter a source and fetch news cards.');
  } catch (e) {
    setStatus(`API unavailable: ${e.message}`);
  }
}

function stopScan() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  els.scannerPane.classList.add('hidden');
}

async function startScan() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera unavailable. Use manual URL.');
    const manual = prompt('Paste URL from QR code:');
    if (!manual) return;
    const normalized = normalizeToUrl(manual.trim());
    if (!normalized) return setStatus('Invalid URL. Try bbc.com or full https:// URL.');
    els.urlInput.value = normalized;
    previewUrl(normalized);
    return;
  }

  els.scannerPane.classList.remove('hidden');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    els.scannerVideo.srcObject = stream;

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!stream) return;
        try {
          const barcodes = await detector.detect(els.scannerVideo);
          if (barcodes.length) {
            const value = barcodes[0].rawValue;
            stopScan();
            const normalized = normalizeToUrl(value.trim());
            if (!normalized) return setStatus('Invalid URL from QR code.');
            els.urlInput.value = normalized;
            await previewUrl(normalized);
            return;
          }
        } catch {
          // keep scanning
        }
        rafId = requestAnimationFrame(tick);
      };
      tick();
    } else {
      setStatus('QR detector unavailable. Use Manual URL.');
    }
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

  recognition = new SR();
  recognition.lang = 'en-GB';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript.toLowerCase().trim();
    handleVoiceIntent(text);
  };

  recognition.onerror = () => setStatus('Voice input failed. Try again.');
}

function handleVoiceIntent(text) {
  setStatus(`Heard: "${text}"`);

  if (text.startsWith('open ')) {
    const target = text.replace(/^open\s+/, '');
    const url = normalizeVoiceUrl(target);
    if (!url) return setStatus('Could not parse URL to open.');
    els.urlInput.value = url;
    previewUrl(url);
    return;
  }

  if (text === 'fetch news' || text === 'get news') {
    const url = normalizeToUrl(els.urlInput.value.trim());
    if (!url) return setStatus('Set a valid source URL first.');
    fetchNews(url);
    return;
  }

  if (text.startsWith('search ')) {
    const q = text.replace(/^search\s+/, '').trim();
    if (!q) return setStatus('Say: search <topic>.');
    els.searchInput.value = q;
    const url = `https://news.google.com/search?q=${encodeURIComponent(q)}`;
    els.urlInput.value = url;
    fetchNews(url);
    return;
  }

  if (text === 'next card') return moveCard(1);
  if (text === 'previous card' || text === 'back card') return moveCard(-1);

  if (text === 'read card' || text === 'read this') {
    const card = newsCards[currentCardIndex];
    if (!card?.url) return setStatus('No active card selected.');
    readArticle(card.url);
    return;
  }

  if (text === 'scroll down') return moveCard(1);
  if (text === 'scroll up') return moveCard(-1);

  if (text === 'summarize this') {
    if (!lastReadData) return setStatus('No article loaded yet.');
    els.summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  setStatus('Try: open bbc.com, fetch news, next card, read card, search AI regulation UK.');
}

els.previewBtn.addEventListener('click', () => {
  const url = normalizeToUrl(els.urlInput.value.trim());
  if (!url) return setStatus('Enter a valid URL (e.g. bbc.com or https://bbc.com).');
  els.urlInput.value = url;
  previewUrl(url);
});

els.fetchNewsBtn.addEventListener('click', () => {
  const url = normalizeToUrl(els.urlInput.value.trim());
  if (!url) return setStatus('Enter a valid URL first.');
  els.urlInput.value = url;
  fetchNews(url);
});

els.searchBtn.addEventListener('click', () => {
  const q = els.searchInput.value.trim();
  if (!q) return;
  const url = `https://news.google.com/search?q=${encodeURIComponent(q)}`;
  els.urlInput.value = url;
  fetchNews(url);
});

els.scanBtn.addEventListener('click', startScan);
els.stopScanBtn.addEventListener('click', stopScan);

els.manualUrlBtn.addEventListener('click', () => {
  const manual = prompt('Paste URL:');
  if (!manual) return;
  const normalized = normalizeToUrl(manual.trim());
  if (!normalized) return setStatus('Invalid URL. Try bbc.com or full https:// URL.');
  els.urlInput.value = normalized;
  previewUrl(normalized);
});

els.openPreviewBtn.addEventListener('click', () => {
  if (!scannedCandidate) return;
  fetchNews(scannedCandidate);
});

els.backToCardsBtn?.addEventListener('click', () => {
  els.newsDeckSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

els.cancelPreviewBtn.addEventListener('click', () => {
  els.previewPane.classList.add('hidden');
  scannedCandidate = null;
  setStatus('Preview cancelled.');
});

els.rescanPreviewBtn.addEventListener('click', startScan);
els.voiceBtn.addEventListener('click', () => recognition?.start());

window.addEventListener('beforeunload', stopScan);
setupVoice();
healthCheck();
