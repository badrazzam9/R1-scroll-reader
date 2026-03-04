const els = {
  workerUrlInput: document.getElementById('workerUrlInput'),
  saveWorkerBtn: document.getElementById('saveWorkerBtn'),
  healthBtn: document.getElementById('healthBtn'),
  workerStatus: document.getElementById('workerStatus'),
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
  title: document.getElementById('title'),
  summary: document.getElementById('summary'),
  status: document.getElementById('status')
};

let scannedCandidate = null;
let stream = null;
let rafId = null;
let recognition = null;
let lastReadData = null;

function setStatus(msg) { els.status.textContent = msg || ''; }
function workerBase() { return (els.workerUrlInput.value || '').trim().replace(/\/$/, ''); }

function saveWorkerUrl() {
  localStorage.setItem('r1_worker_url', workerBase());
  els.workerStatus.textContent = 'Saved.';
}

function loadWorkerUrl() {
  const saved = localStorage.getItem('r1_worker_url') || 'https://r1-scroll-reader-worker.swordandscroll.workers.dev';
  els.workerUrlInput.value = saved;
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

function renderPreview(data) {
  els.previewPane.classList.remove('hidden');
  els.previewDomain.textContent = data.domain || '-';
  els.previewUrl.textContent = data.url || '-';
  els.previewSafety.textContent = data.safe ? 'Safe' : 'Blocked';
  els.previewSafety.className = `badge ${data.safe ? 'safe' : 'blocked'}`;
  scannedCandidate = data.url;
}

async function api(path, payload, method = 'POST') {
  const base = workerBase();
  if (!base) throw new Error('Set Worker URL first.');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
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

function renderRead(data) {
  lastReadData = data;
  els.summaryCard.classList.remove('hidden');
  els.title.textContent = data.title || data.domain || 'Untitled';
  els.summary.textContent = data.summary || 'No summary available.';
  els.reader.innerHTML = '';
  (data.sections || []).forEach((txt, i) => {
    const card = document.createElement('article');
    card.className = 'section-card';
    card.id = `section-${i + 1}`;
    card.innerHTML = `<h4>Section ${i + 1}</h4><p>${escapeHtml(txt)}</p>`;
    els.reader.appendChild(card);
  });
}

function escapeHtml(s='') {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
    const data = await api('/health', null, 'GET');
    els.workerStatus.textContent = `Worker OK (${data.status})`;
  } catch (e) {
    els.workerStatus.textContent = e.message;
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
    if (manual) { els.urlInput.value = manual; previewUrl(manual); }
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
            els.urlInput.value = value;
            await previewUrl(value);
            return;
          }
        } catch {}
        rafId = requestAnimationFrame(tick);
      };
      tick();
    } else {
      setStatus('Barcode detector unavailable. Use manual URL fallback.');
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

function normalizeToUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(input)) return `https://${input}`;
  return null;
}

function handleVoiceIntent(text) {
  setStatus(`Heard: "${text}"`);
  if (text.startsWith('open ')) {
    const target = text.replace(/^open\s+/, '');
    const url = normalizeToUrl(target);
    if (!url) return setStatus('Could not parse URL to open.');
    els.urlInput.value = url;
    previewUrl(url);
    return;
  }
  if (text.startsWith('search ')) {
    const q = text.replace(/^search\s+/, '');
    els.searchInput.value = q;
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
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
    const current = cards.findIndex(c => c.getBoundingClientRect().top > 80);
    const idx = current === -1 ? cards.length - 1 : current;
    cards[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (text === 'back') return history.back();
  setStatus('Intent not recognized. Try open/search/scroll/next section/back.');
}

els.saveWorkerBtn.addEventListener('click', saveWorkerUrl);
els.healthBtn.addEventListener('click', healthCheck);
els.previewBtn.addEventListener('click', () => previewUrl(els.urlInput.value.trim()));
els.readBtn.addEventListener('click', () => readUrl(els.urlInput.value.trim()));
els.scanBtn.addEventListener('click', startScan);
els.stopScanBtn.addEventListener('click', stopScan);
els.manualUrlBtn.addEventListener('click', () => {
  const manual = prompt('Paste URL:');
  if (manual) {
    els.urlInput.value = manual;
    previewUrl(manual);
  }
});
els.searchBtn.addEventListener('click', () => {
  const q = els.searchInput.value.trim();
  if (!q) return;
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  els.urlInput.value = url;
  previewUrl(url);
});
els.openPreviewBtn.addEventListener('click', () => scannedCandidate && readUrl(scannedCandidate));
els.cancelPreviewBtn.addEventListener('click', () => {
  els.previewPane.classList.add('hidden');
  scannedCandidate = null;
  setStatus('Preview cancelled.');
});
els.rescanPreviewBtn.addEventListener('click', startScan);
els.voiceBtn.addEventListener('click', () => recognition?.start());

window.addEventListener('beforeunload', stopScan);
loadWorkerUrl();
setupVoice();
setStatus('Ready. Set Worker URL, then scan or paste a URL.');
