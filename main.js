const API_BASE = (localStorage.getItem('r1_api_base') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev').replace(/\/$/, '');

const els = {
  urlInput: document.getElementById('urlInput'),
  previewBtn: document.getElementById('previewBtn'),
  readBtn: document.getElementById('readBtn'),
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
  reader: document.getElementById('reader'),
  summaryCard: document.getElementById('summaryCard'),
  storyCardSection: document.getElementById('storyCardSection'),
  storyCards: document.getElementById('storyCards'),
  imageCard: document.getElementById('imageCard'),
  imageGallery: document.getElementById('imageGallery'),
  title: document.getElementById('title'),
  summary: document.getElementById('summary'),
  sourceLink: document.getElementById('sourceLink'),
  status: document.getElementById('status')
};

let scannedCandidate = null;
let stream = null;
let rafId = null;
let recognition = null;
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
    setStatus(data.safe ? 'Preview ready.' : `Blocked: ${data.reason || 'unsafe URL'}`);
  } catch (e) {
    setStatus(e.message);
  }
}

function renderStoryCards(cards = []) {
  if (!els.storyCardSection || !els.storyCards) return;

  els.storyCards.innerHTML = '';
  if (!cards.length) {
    els.storyCardSection.classList.add('hidden');
    return;
  }

  cards.slice(0, 10).forEach((card, i) => {
    const article = document.createElement('article');
    article.className = 'story-card';

    if (card.image?.url) {
      const img = document.createElement('img');
      img.className = 'story-card-image';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = card.image.url;
      img.alt = card.image.alt || card.title || `Story image ${i + 1}`;
      img.referrerPolicy = 'no-referrer';
      article.appendChild(img);
    }

    const content = document.createElement('div');
    content.className = 'story-card-content';

    const h4 = document.createElement('h4');
    h4.textContent = card.title || `Story ${i + 1}`;
    content.appendChild(h4);

    const p = document.createElement('p');
    p.textContent = card.snippet || '';
    content.appendChild(p);

    const jump = document.createElement('button');
    jump.className = 'btn';
    jump.textContent = 'Open section';
    jump.addEventListener('click', () => {
      const sectionId = `section-${(card.sectionIndex || i) + 1}`;
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    content.appendChild(jump);

    article.appendChild(content);
    els.storyCards.appendChild(article);
  });

  if (els.storyCards.children.length) els.storyCardSection.classList.remove('hidden');
  else els.storyCardSection.classList.add('hidden');
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

function renderRead(data) {
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

  renderStoryCards(data.cards || []);
  renderImages(data.images || []);

  els.reader.innerHTML = '';
  (data.sections || []).forEach((txt, i) => {
    const card = document.createElement('article');
    card.className = 'section-card';
    card.id = `section-${i + 1}`;
    card.innerHTML = `<h4>Section ${i + 1}</h4><p>${escapeHtml(txt)}</p>`;
    els.reader.appendChild(card);
  });
}

async function readUrl(url) {
  try {
    const data = await api('/api/read', { url });
    renderRead(data);
    setStatus(`Loaded ${data.sections?.length || 0} sections from ${data.domain}.`);
  } catch (e) {
    setStatus(e.message);
  }
}

async function healthCheck() {
  try {
    await api('/health', null, 'GET');
    setStatus('Connected. Paste/scan a URL to start reading.');
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
          // ignore and continue scanning
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

  if (text.startsWith('search ')) {
    const q = text.replace(/^search\s+/, '').trim();
    if (!q) return setStatus('Say: search <topic>.');
    els.searchInput.value = q;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    els.urlInput.value = url;
    previewUrl(url);
    return;
  }

  if (text === 'summarize this') {
    if (!lastReadData) return setStatus('No page loaded yet.');
    els.summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (text === 'scroll down') return window.scrollBy({ top: 500, behavior: 'smooth' });
  if (text === 'scroll up') return window.scrollBy({ top: -500, behavior: 'smooth' });

  if (text === 'next section') {
    const cards = [...document.querySelectorAll('.section-card')];
    const current = cards.findIndex(c => c.getBoundingClientRect().top > 90);
    const idx = current === -1 ? cards.length - 1 : current;
    cards[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (text === 'back') return history.back();

  setStatus('Try: open bbc.com, search bitcoin, summarize this, scroll down, next section.');
}

els.previewBtn.addEventListener('click', () => {
  const raw = els.urlInput.value.trim();
  const normalized = normalizeToUrl(raw);
  if (!normalized) return setStatus('Enter a valid URL (e.g. bbc.com or https://bbc.com).');
  els.urlInput.value = normalized;
  previewUrl(normalized);
});

els.readBtn.addEventListener('click', () => {
  const raw = els.urlInput.value.trim();
  const normalized = normalizeToUrl(raw);
  if (!normalized) return setStatus('Enter a valid URL (e.g. bbc.com or https://bbc.com).');
  els.urlInput.value = normalized;
  readUrl(normalized);
});

els.searchBtn.addEventListener('click', () => {
  const q = els.searchInput.value.trim();
  if (!q) return;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  els.urlInput.value = url;
  previewUrl(url);
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
  readUrl(scannedCandidate);
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
