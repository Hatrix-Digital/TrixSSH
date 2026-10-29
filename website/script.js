// ---------- OS detection ----------
/* deployed from repo @ v1.0.0 */
function detectOS() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();
  if (ua.includes('mac') || platform.includes('mac')) return 'mac';
  if (ua.includes('linux') || platform.includes('linux')) return 'linux';
  if (ua.includes('win') || platform.includes('win')) return 'win';
  return 'win';
}

const osLabels = { win: 'Windows', mac: 'macOS', linux: 'Linux' };
const osLinks = {
  win: 'https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-Setup-1.0.0.exe',
  mac: 'https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-1.0.0.dmg',
  linux: 'https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-1.0.0-x86_64.AppImage',
};

const os = detectOS();
const ctaLabel = document.getElementById('ctaLabel');
const ctaDownload = document.getElementById('ctaDownload');
if (ctaLabel) ctaLabel.textContent = 'Download for ' + osLabels[os];
if (ctaDownload) ctaDownload.href = osLinks[os] || '#download';

// ---------- GitHub stars (cached 1h) ----------
function formatStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
(function loadStars() {
  const el = document.getElementById('ghStars');
  const CACHE_KEY = 'trixssh_gh_stars';
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      if (el) el.textContent = formatStars(cached.value);
      return;
    }
  } catch (e) {}
  fetch('https://api.github.com/repos/Hatrix-Digital/TrixSSH')
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (d && typeof d.stargazers_count === 'number') {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ value: d.stargazers_count, ts: Date.now() })); } catch (e) {}
        if (el) el.textContent = formatStars(d.stargazers_count);
      } else if (el && el.textContent === '—') {
        el.textContent = '★';
      }
    })
    .catch(() => {
      if (el && el.textContent === '—') el.textContent = '★';
    });
})();

// ---------- Mock terminal typing ----------
const mockLines = [
  { cls: 'prompt', text: '$ trixssh connect web-prod' },
  { cls: 'out', text: 'Connected to deploy@203.0.113.10 (Ubuntu 24.04)' },
  { cls: 'prompt', text: '$ systemctl status nginx' },
  { cls: 'out', text: '● nginx.service - A high performance web server' },
  { cls: 'out2', text: '   Active: active (running) since Mon 2026-10-12' },
  { cls: 'prompt', text: '$ df -h /' },
  { cls: 'out', text: 'Filesystem      Size  Used Avail Use% Mounted on' },
  { cls: 'out3', text: '/dev/sda1        80G   24G   52G  31% /' },
  { cls: 'prompt', text: '$ ' },
];

const mockTerm = document.getElementById('mockTerm');
let li = 0, ci = 0, curLine = null, curSpan = null;

function typeMock() {
  if (li >= mockLines.length) {
    setTimeout(() => { mockTerm.innerHTML = ''; li = 0; ci = 0; curLine = null; curSpan = null; typeMock(); }, 7000);
    return;
  }
  const item = mockLines[li];
  if (!curLine) {
    curLine = document.createElement('div');
    curLine.className = 'mock-line';
    if (item.cls === 'prompt') {
      const p = document.createElement('span');
      p.className = 'text-cyan-400';
      p.textContent = '$ ';
      curLine.appendChild(p);
      const c = document.createElement('span');
      c.className = 'text-slate-100';
      c.textContent = '';
      curLine.appendChild(c);
      curSpan = c;
    } else {
      const o = document.createElement('span');
      o.className = item.cls === 'out2' ? 'text-emerald-400' : item.cls === 'out3' ? 'text-amber-300' : 'text-slate-400';
      o.textContent = '';
      curLine.appendChild(o);
      curSpan = o;
    }
    mockTerm.appendChild(curLine);
  }
  const full = item.cls === 'prompt' ? item.text.replace(/^\$\s?/, '') : item.text;
  if (ci < full.length) {
    curSpan.textContent += full[ci++];
    setTimeout(typeMock, item.cls === 'prompt' ? 40 : 10);
  } else {
    const finished = curLine;
    li++; ci = 0; curLine = null; curSpan = null;
    if (li >= mockLines.length && finished) {
      const cursor = document.createElement('span');
      cursor.className = 'mock-cursor';
      finished.appendChild(cursor);
    }
    setTimeout(typeMock, item.cls === 'prompt' ? 320 : 70);
  }
}
setTimeout(typeMock, 500);

// ---------- Animate metric bars on load ----------
window.addEventListener('load', () => {
  document.querySelectorAll('.metric-bar').forEach((bar, i) => {
    const w = bar.style.width;
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = w; }, 300 + i * 150);
  });
});

// ---------- Lightbox for screenshots ----------
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lbImg');
const lbCaption = document.getElementById('lbCaption');
const lbContent = document.getElementById('lbContent');
const lbClose = document.getElementById('lbClose');
const lbPrev = document.getElementById('lbPrev');
const lbNext = document.getElementById('lbNext');

const shotFigures = Array.from(document.querySelectorAll('#screenshots figure'));
const shotItems = shotFigures.map(fig => ({
  src: fig.querySelector('img')?.getAttribute('src'),
  alt: fig.querySelector('img')?.getAttribute('alt'),
  caption: fig.querySelector('figcaption')?.textContent?.trim() || '',
}));
let lbIndex = 0;

function openLightbox(i) {
  lbIndex = (i + shotItems.length) % shotItems.length;
  const item = shotItems[lbIndex];
  if (!item || !item.src) return;
  lbImg.src = item.src;
  lbImg.alt = item.alt || '';
  lbCaption.textContent = item.caption;
  lightbox.classList.remove('hidden');
  lightbox.classList.add('flex');
  requestAnimationFrame(() => {
    lightbox.classList.remove('opacity-0');
    lbContent.classList.remove('scale-95');
    lbContent.classList.add('scale-100');
  });
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  lightbox.classList.add('opacity-0');
  lbContent.classList.remove('scale-100');
  lbContent.classList.add('scale-95');
  setTimeout(() => {
    lightbox.classList.add('hidden');
    lightbox.classList.remove('flex');
    document.body.style.overflow = '';
  }, 300);
}
function navLightbox(dir) {
  openLightbox(lbIndex + dir);
}

shotFigures.forEach((fig, i) => {
  fig.style.cursor = 'zoom-in';
  const img = fig.querySelector('img');
  if (img) { img.style.cursor = 'zoom-in'; img.title = 'Click to enlarge'; }
  fig.addEventListener('click', () => openLightbox(i));
  if (img) img.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(i); });
});

// delegated fallback
const shotsSection = document.getElementById('screenshots');
if (shotsSection) {
  shotsSection.addEventListener('click', (e) => {
    const fig = e.target.closest('figure');
    if (!fig) return;
    const idx = shotFigures.indexOf(fig);
    if (idx >= 0) openLightbox(idx);
  });
}

lbClose?.addEventListener('click', closeLightbox);
lbPrev?.addEventListener('click', (e) => { e.stopPropagation(); navLightbox(-1); });
lbNext?.addEventListener('click', (e) => { e.stopPropagation(); navLightbox(1); });
lightbox?.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') navLightbox(-1);
  if (e.key === 'ArrowRight') navLightbox(1);
});

// ---------- Smooth scroll for anchor links ----------
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length > 1) {
      const el = document.querySelector(id);
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
    }
  });
});
