// ============================================
// LoadLink Phase 2 v6 — Frontend
// Drag & drop avec STREAMING CHUNKED pour gros fichiers (>100 Mo)
// Fichiers < 100 Mo : base64 direct (rapide)
// Fichiers >= 100 Mo : streaming par chunks de 8 Mo (illimité)
// ============================================

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open } = window.__TAURI__.dialog;
const { readText } = window.__TAURI__.clipboardManager;

// ============================================
// CONFIG
// ============================================
const FORMATS = {
  mp4: { type: "video", label: "MP4", desc: "Standard, compatible partout" },
  webm: { type: "video", label: "WEBM", desc: "Plus léger, open source" },
  mp3: { type: "audio", label: "MP3", desc: "Compatible partout" },
  wav: { type: "audio", label: "WAV", desc: "Sans perte, gros fichier" },
  flac: { type: "audio", label: "FLAC", desc: "Sans perte compressé" },
  m4a: { type: "audio", label: "M4A", desc: "Apple AAC haute qualité" },
  ogg: { type: "audio", label: "OGG", desc: "Open source, compact" },
  aac: { type: "audio", label: "AAC", desc: "Compact, bonne qualité" },
};
const VIDEO_FORMATS = ["mp4", "webm"];
const AUDIO_FORMATS = ["mp3", "wav", "flac", "m4a", "ogg", "aac"];

const VIDEO_QUALITIES = [
  { key: "max", label: "Maximum", desc: "Meilleure qualité disponible" },
  { key: "2160", label: "4K (2160p)", desc: "Ultra HD" },
  { key: "1440", label: "1440p", desc: "Quad HD" },
  { key: "1080", label: "1080p", desc: "Full HD" },
  { key: "720", label: "720p", desc: "HD" },
  { key: "480", label: "480p", desc: "Standard" },
  { key: "360", label: "360p", desc: "Léger" },
];
const AUDIO_QUALITIES = [
  { key: "0", label: "Maximum", desc: "320 kbps (MP3) / lossless" },
  { key: "2", label: "Haute", desc: "256 kbps" },
  { key: "5", label: "Moyenne", desc: "192 kbps" },
  { key: "7", label: "Basse", desc: "128 kbps" },
  { key: "9", label: "Économique", desc: "96 kbps" },
];

const ZIP_LEVELS = [
  { key: "9", label: "Maximum", desc: "Plus lent, taille minimale" },
  { key: "6", label: "Équilibré", desc: "Bon rapport vitesse/taille" },
  { key: "1", label: "Rapide", desc: "Très rapide, peu compressé" },
  { key: "0", label: "Stockage seul", desc: "Pas de compression" },
];
const REENCODE_MODES = [
  { key: "crf", label: "Qualité (CRF)", desc: "Préserve la qualité, gain variable" },
  { key: "bitrate", label: "Bitrate cible", desc: "Réduction garantie en taille" },
];
const REENCODE_QUALITIES = [
  { key: "20", label: "Lossless visuel", desc: "Indiscernable, gain limité" },
  { key: "23", label: "Très haute", desc: "Quasi parfait, gain modéré" },
  { key: "26", label: "Haute (recommandé)", desc: "Excellent rapport taille/qualité" },
  { key: "28", label: "Standard", desc: "Bon compromis" },
  { key: "32", label: "Compact", desc: "Réduction maximale, qualité OK" },
];
const REENCODE_BITRATES = [
  { key: "0.7", label: "Léger (-30%)", desc: "Petite réduction, qualité préservée" },
  { key: "0.5", label: "Moyen (-50%)", desc: "Bon compromis" },
  { key: "0.3", label: "Fort (-70%)", desc: "Réduction maximale" },
];

const MODULE_INFO = {
  capture:    { title: "Capturer", sub: "Télécharge une vidéo ou un audio depuis une URL.", ready: true },
  transcribe: { title: "Transcrire", sub: "Convertit un fichier audio ou vidéo en texte horodaté.", ready: true },
  compress:   { title: "Compresser", sub: "Archive en ZIP ou réencode des vidéos en H.265.", ready: true },
  convert:    { title: "Convertir", sub: "Change le format d'un fichier local sans perte de qualité.", ready: true },
  audio:      { title: "Audio", sub: "Édition audio multitrack, normalisation, mastering.", ready: false },
  audioV2:    { title: "Audio V2", sub: "Timeline multi-pistes pour post-production audio.", ready: true },
  video:      { title: "Vidéo", sub: "Découpage, recadrage, sous-titres et effets vidéo.", ready: false },
  ai:         { title: "IA Studio", sub: "Traitements assistés par intelligence artificielle.", ready: false },
  import:     { title: "Importer", sub: "Importe automatiquement depuis carte SD, drone, caméra.", ready: false },
  plugins:    { title: "Plugins", sub: "Extensions tierces pour étendre LoadLink.", ready: false }
};

// Streaming threshold: files >= this size will use chunked upload
const STREAMING_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk

MODULE_INFO.audio.sub = "Mastering audio pour ton contenu.";
MODULE_INFO.audio.ready = true;

const loadAudioV2Frame = () => {
  const frame = $("audio-v2-frame");
  if (!frame) return;
  if (!frame.src) frame.src = "audio-v2-bundle/audio-v2.html";
};

const unloadAudioV2Frame = () => {
  const frame = $("audio-v2-frame");
  if (frame) frame.src = "";
};

// ============================================
// STATE
// ============================================
const state = {
  currentModule: "home",
  url: "",
  format: "mp4",
  type: "video",
  quality: "max",
  customName: null,
  customDir: null,
  videoInfo: null,
  downloading: false,
  isPlaylist: false,
  downloadFullPlaylist: false,
  history: JSON.parse(localStorage.getItem("dl-history") || "[]"),
  compressMode: "zip",
  compressSource: null,
  compressSourceType: null,
  compressSourceLabel: null,
  compressOutputDir: null,
  zipLevel: "9",
  reencodeMode: "bitrate",
  reencodeQuality: "26",
  reencodeBitrate: "0.5",
  compressing: false,
  dark: localStorage.getItem("theme") === "dark"
};

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================
// TOAST
// ============================================
let toastTimer = null;
const showToast = (msg, duration = 2500) => {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), duration);
};

// ============================================
// THEME
// ============================================
const moonSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const sunSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

const applyTheme = () => {
  document.body.classList.toggle("dark", state.dark);
  const svg = state.dark ? sunSVG : moonSVG;
  if ($("themeBtnHome")) $("themeBtnHome").innerHTML = svg;
  if ($("themeBtnSidebar")) $("themeBtnSidebar").innerHTML = svg;
};

const toggleTheme = () => {
  state.dark = !state.dark;
  localStorage.setItem("theme", state.dark ? "dark" : "light");
  applyTheme();
};

// ============================================
// ROUTING
// ============================================
const homePage = () => $("homePage");
const appPage = () => $("appPage");

const goHome = () => {
  // Garde "modifs non enregistrees" si on quitte le module Transcrire
  if (state.currentModule === "transcribe") {
    if (typeof window.__playerCanLeave === "function" && !window.__playerCanLeave()) return;
  }
  if (state.currentModule === "audio" && typeof audioStopTransientListeners === "function") {
    audioStopTransientListeners();
  }
  if (state.currentModule === "audioV2") {
    unloadAudioV2Frame();
  }
  state.currentModule = "home";
  appPage().classList.add("hidden");
  homePage().classList.remove("hidden");
  $$(".nav-item").forEach((el) => el.classList.remove("active"));
};

const hideAllModulePages = () => {
  $$(".module-page").forEach((el) => el.classList.add("hidden"));
};

const showModulePage = (id) => {
  const target = $(id);
  if (target) target.classList.remove("hidden");
};

const openModule = (moduleKey) => {
  if (moduleKey === "home") { goHome(); return; }
  const info = MODULE_INFO[moduleKey];
  if (!info) return;
  // Garde "modifs non enregistrees" si on quitte le module Transcrire
  if (state.currentModule === "transcribe" && moduleKey !== "transcribe") {
    if (typeof window.__playerCanLeave === "function" && !window.__playerCanLeave()) return;
  }
  if (state.currentModule === "audio" && moduleKey !== "audio" && typeof audioStopTransientListeners === "function") {
    audioStopTransientListeners();
  }
  if (state.currentModule === "audioV2" && moduleKey !== "audioV2") {
    unloadAudioV2Frame();
  }
  state.currentModule = moduleKey;
  homePage().classList.add("hidden");
  appPage().classList.remove("hidden");
  $$(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.module === moduleKey);
  });
  hideAllModulePages();
  if (info.ready) {
    showModulePage("page-" + moduleKey);
    if (moduleKey === "audio" && typeof initAudioModule === "function") {
      initAudioModule(state);
    }
    if (moduleKey === "audioV2") {
      loadAudioV2Frame();
    }
  } else {
    showModulePage("page-placeholder");
    $("placeholderTitle").textContent = info.title + " — en développement";
    $("placeholderText").innerHTML = info.sub + "<br><br>Ce module sera disponible dans une prochaine version.";
  }
};

// ============================================
// URL HELPERS
// ============================================
const isValidUrl = (s) => {
  if (!s) return false;
  try {
    const u = new URL(s.startsWith("http") ? s : "https://" + s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
};
const isYoutube = (s) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(s);
const isFakePlaylist = (listId) => listId && /^(RD|UL|OLAK|RDMM|RDCLAK|RDAMVM|RDAT|RDQ|RDEM)/.test(listId);
const hasPlaylist = (s) => {
  if (!isYoutube(s)) return false;
  if (/\/playlist\?/.test(s)) return true;
  const match = s.match(/[?&]list=([^&]+)/);
  if (!match) return false;
  return !isFakePlaylist(match[1]);
};
const cleanUrl = (s, keepPlaylist) => {
  if (!isYoutube(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : "https://" + s);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.slice(1).split("/")[0];
      return `https://www.youtube.com/watch?v=${id}`;
    }
    const v = u.searchParams.get("v");
    const list = u.searchParams.get("list");
    const realList = list && !isFakePlaylist(list) ? list : null;
    if (keepPlaylist && realList) {
      if (v) return `https://www.youtube.com/watch?v=${v}&list=${realList}`;
      return `https://www.youtube.com/playlist?list=${realList}`;
    }
    if (v) return `https://www.youtube.com/watch?v=${v}`;
    return s;
  } catch { return s; }
};
const formatDuration = (sec) => {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};
const qualityLabel = () => {
  const list = state.type === "video" ? VIDEO_QUALITIES : AUDIO_QUALITIES;
  return list.find((q) => q.key === state.quality)?.label || "Max";
};

// ============================================
// CAPTURE MODULE (inchangé)
// ============================================
const updateBtnState = () => {
  const btn = $("download-btn");
  if (!btn) return;
  btn.disabled = !(state.url && isValidUrl(state.url) && !state.downloading);
};

const renderHistory = () => {
  const list = $("history-list");
  if (!list) return;
  list.innerHTML = "";
  state.history.slice(0, 8).forEach((item) => {
    const el = document.createElement("div");
    el.className = "history-item";
    const isAudio = AUDIO_FORMATS.includes(item.format);
    el.innerHTML = `
      <div class="type-icon">
        ${isAudio
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
        }
      </div>
      <div class="history-info">
        <div class="history-name">${item.title}</div>
        <div class="history-meta">${item.format.toUpperCase()} · ${new Date(item.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    `;
    el.addEventListener("click", () => invoke("open_folder", { path: item.folder }));
    list.appendChild(el);
  });
};

const saveHistory = () => {
  localStorage.setItem("dl-history", JSON.stringify(state.history.slice(0, 8)));
  renderHistory();
};

const updatePlaylistUI = () => {
  const section = $("playlist-section");
  if (!section) return;
  if (state.isPlaylist) {
    section.classList.remove("hidden");
    $("playlist-hint").textContent = state.downloadFullPlaylist
      ? "Toutes les vidéos seront téléchargées"
      : "Seulement cette vidéo sera téléchargée";
  } else {
    section.classList.add("hidden");
  }
};

const updateFormatUI = () => {
  $("format-video").classList.toggle("selected", state.type === "video");
  $("format-audio").classList.toggle("selected", state.type === "audio");
  const f = FORMATS[state.format];
  if (state.type === "video") {
    $("video-meta").textContent = `${f.label} ${qualityLabel()}`;
  } else {
    $("audio-meta").textContent = `${f.label} ${qualityLabel()}`;
  }
  $("format-detail-label").textContent = `Format : ${f.label}`;
  $("quality-label").textContent = `Qualité : ${qualityLabel()}`;
  if (!state.customDir) {
    $("folder-label").textContent = state.type === "video"
      ? "Dossier par défaut (Vidéos)"
      : "Dossier par défaut (Musique)";
  }
  updateFullPreview();
};

const updateFullPreview = () => {
  const preview = $("full-preview");
  if (!preview) return;
  if (!state.videoInfo || state.downloadFullPlaylist) {
    preview.classList.add("hidden");
    return;
  }
  preview.classList.remove("hidden");
  $("full-preview-thumb").src = state.videoInfo.thumbnail || "";
  const displayTitle = state.customName
    ? `${state.customName}.${state.format}`
    : state.videoInfo.title || "—";
  $("full-preview-title").textContent = displayTitle;
  $("full-preview-uploader").textContent = state.videoInfo.uploader || "";
  $("full-preview-duration").textContent = formatDuration(state.videoInfo.duration);
  $("full-preview-format").textContent = FORMATS[state.format].label;
  $("full-preview-quality").textContent = qualityLabel();
  let dest;
  if (state.customDir) dest = state.customDir;
  else if (state.type === "video") dest = "Vidéos\\LoadLink-Videos";
  else dest = "Musique\\LoadLink-Audio";
  $("full-preview-dest").textContent = dest;
  $("full-preview-dest").title = dest;
};

let fetchTimer = null;
let fetchAbort = null;

const onUrlChange = () => {
  const urlInput = $("url-input");
  if (!urlInput) return;
  const raw = urlInput.value.trim();
  state.isPlaylist = hasPlaylist(raw);
  state.url = cleanUrl(raw, state.downloadFullPlaylist);
  state.videoInfo = null;
  $("preview-card").classList.add("hidden");
  $("loading-card").classList.add("hidden");
  $("full-preview").classList.add("hidden");
  updatePlaylistUI();
  updateBtnState();
  clearTimeout(fetchTimer);
  if (isValidUrl(state.url) && !state.downloadFullPlaylist) {
    $("loading-card").classList.remove("hidden");
    fetchTimer = setTimeout(() => fetchVideoInfo(state.url), 500);
  }
};

const fetchVideoInfo = async (url) => {
  if (fetchAbort) fetchAbort.abort();
  fetchAbort = new AbortController();
  const signal = fetchAbort.signal;
  const timeoutId = setTimeout(() => fetchAbort.abort(), 20000);
  try {
    const info = await invoke("fetch_video_info", { url });
    if (signal.aborted) return;
    clearTimeout(timeoutId);
    state.videoInfo = info;
    $("thumbnail").src = info.thumbnail;
    $("video-title").textContent = info.title;
    $("video-uploader").textContent = info.uploader;
    $("duration-badge").textContent = formatDuration(info.duration);
    $("loading-card").classList.add("hidden");
    $("preview-card").classList.remove("hidden");
    updateFullPreview();
  } catch (err) {
    clearTimeout(timeoutId);
    $("loading-card").classList.add("hidden");
    if (signal.aborted) showToast("Délai dépassé, vérifie le lien", 3500);
    else showToast("Vidéo non trouvée ou indisponible", 3000);
  }
};

const showOptionsModal = (title, list, currentKey, onPick) => {
  $("format-modal-title").textContent = title;
  const container = $("format-list");
  container.innerHTML = "";
  list.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "format-option" + (currentKey === item.key ? " selected" : "");
    btn.innerHTML = `
      <span class="format-option-name">${item.label}</span>
      <span class="format-option-desc">${item.desc}</span>
    `;
    btn.addEventListener("click", () => {
      onPick(item.key);
      $("format-modal").classList.add("hidden");
    });
    container.appendChild(btn);
  });
  $("format-modal").classList.remove("hidden");
};

// ============================================
// COMPRESS MODULE
// ============================================
const updateCompressBtnState = () => {
  const btn = $("compress-btn");
  if (!btn) return;
  btn.disabled = !(state.compressSource && !state.compressing);
};

const updateCompressUI = () => {
  $("mode-zip").classList.toggle("selected", state.compressMode === "zip");
  $("mode-reencode").classList.toggle("selected", state.compressMode === "reencode");
  $("zip-level-row").classList.toggle("hidden", state.compressMode !== "zip");
  $("reencode-mode-row").classList.toggle("hidden", state.compressMode !== "reencode");
  $("reencode-quality-row").classList.toggle("hidden", state.compressMode !== "reencode");

  const zipLevel = ZIP_LEVELS.find((l) => l.key === state.zipLevel);
  $("zip-level-label").textContent = `Compression : ${zipLevel.label}`;

  const mode = REENCODE_MODES.find((m) => m.key === state.reencodeMode);
  $("reencode-mode-label").textContent = `Mode : ${mode.label}`;

  if (state.reencodeMode === "crf") {
    const reQ = REENCODE_QUALITIES.find((q) => q.key === state.reencodeQuality);
    $("reencode-quality-label").textContent = `Qualité : ${reQ.label}`;
  } else {
    const reB = REENCODE_BITRATES.find((b) => b.key === state.reencodeBitrate);
    $("reencode-quality-label").textContent = `Réduction : ${reB.label}`;
  }

  $("compress-btn-label").textContent = state.compressMode === "zip" ? "Compresser en ZIP" : "Réencoder les vidéos";
};

const showCompressSourceInfo = (text) => {
  $("compress-source-info-text").textContent = text;
  $("compress-source-info-text").title = text;
  $("compress-source-info").classList.remove("hidden");
};

const clearCompressSource = () => {
  state.compressSource = null;
  state.compressSourceType = null;
  state.compressSourceLabel = null;
  $("source-label").textContent = "Choisir un dossier";
  $("compress-source-info").classList.add("hidden");
  updateCompressBtnState();
};

const setCompressSourceFromPath = (path) => {
  state.compressSource = path;
  state.compressSourceType = "directory";
  const name = path.split(/[\\/]/).pop() || path;
  state.compressSourceLabel = name;
  $("source-label").textContent = name;
  showCompressSourceInfo(`Dossier : ${name}`);
  updateCompressBtnState();
};



// ============================================
// HTML5 DRAG & DROP
// ============================================
window.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
window.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); });

const dropZone = () => $("compress-drop-zone");

// Tauri 2.x native drag & drop for Compresser (additive, alongside HTML5)
// Works around WebView2 quirks where HTML5 receives lock cursor.
(async () => {
  try {
    const wv =
      (window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrentWebview)
        ? window.__TAURI__.webview.getCurrentWebview()
        : null;
    if (wv && typeof wv.onDragDropEvent === "function") {
      await wv.onDragDropEvent((event) => {
        if (state.currentModule !== "compress") return;
        const p = event.payload;
        if (!p) return;
        const zone = dropZone();
        if (p.type === "enter" || p.type === "over") {
          zone?.classList.add("drag-over");
        } else if (p.type === "leave") {
          zone?.classList.remove("drag-over");
        } else if (p.type === "drop") {
          zone?.classList.remove("drag-over");
          const paths = Array.isArray(p.paths) ? p.paths : [];
          if (paths.length === 0) {
            showToast("Aucun element detecte", 2500);
            return;
          }
          if (paths.length > 1) {
            showToast("Drag un seul element a la fois", 3000);
            return;
          }
          setCompressSourceFromPath(paths[0]);
          showToast("Source ajoutee", 1800);
        }
      });
    }
  } catch (err) {
    console.error("[compress] onDragDropEvent setup failed:", err);
  }
})();




// ============================================
// FILE → BASE64 (full file, for small files)
// ============================================
// ============================================
// EVENT BINDINGS
// ============================================

$("themeBtnHome").addEventListener("click", toggleTheme);
$("themeBtnSidebar").addEventListener("click", toggleTheme);

$$(".module-card").forEach((card) => {
  card.addEventListener("click", () => {
    const key = card.dataset.module;
    if (card.classList.contains("soon")) {
      showToast(`${MODULE_INFO[key].title} : module en développement`);
    }
    openModule(key);
  });
});

$$(".nav-item").forEach((item) => {
  item.addEventListener("click", () => openModule(item.dataset.module));
});

const showWelcome = () => $("welcome-modal").classList.remove("hidden");
$("help-link")?.addEventListener("click", showWelcome);
$("help-link-sidebar")?.addEventListener("click", showWelcome);

// ===== Capture =====
$("url-input").addEventListener("input", onUrlChange);
$("paste-btn").addEventListener("click", async () => {
  try {
    const text = await readText();
    if (text) { $("url-input").value = text; onUrlChange(); }
  } catch { showToast("Impossible de lire le presse-papier"); }
});
$("url-input").addEventListener("focus", async () => {
  if ($("url-input").value.trim()) return;
  try {
    const text = await readText();
    if (text && isValidUrl(text)) { $("url-input").value = text; onUrlChange(); }
  } catch {}
});
$("playlist-toggle").addEventListener("change", (e) => {
  state.downloadFullPlaylist = e.target.checked;
  const raw = $("url-input").value.trim();
  state.url = cleanUrl(raw, state.downloadFullPlaylist);
  updatePlaylistUI();
  if (state.downloadFullPlaylist) {
    $("preview-card").classList.add("hidden");
    $("loading-card").classList.add("hidden");
  } else if (isValidUrl(state.url)) {
    $("loading-card").classList.remove("hidden");
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => fetchVideoInfo(state.url), 300);
  }
});

$("format-video").addEventListener("click", () => {
  state.type = "video";
  if (!VIDEO_FORMATS.includes(state.format)) state.format = "mp4";
  state.quality = "max";
  updateFormatUI();
});
$("format-audio").addEventListener("click", () => {
  state.type = "audio";
  if (!AUDIO_FORMATS.includes(state.format)) state.format = "mp3";
  state.quality = "0";
  updateFormatUI();
});
$("format-detail-row").addEventListener("click", () => {
  const formats = state.type === "video" ? VIDEO_FORMATS : AUDIO_FORMATS;
  const list = formats.map((k) => ({ key: k, ...FORMATS[k] }));
  showOptionsModal("Choisis le format", list, state.format, (key) => {
    state.format = key;
    updateFormatUI();
  });
});
$("quality-row").addEventListener("click", () => {
  const list = state.type === "video" ? VIDEO_QUALITIES : AUDIO_QUALITIES;
  showOptionsModal("Choisis la qualité", list, state.quality, (key) => {
    state.quality = key;
    updateFormatUI();
  });
});
$("format-cancel").addEventListener("click", () => $("format-modal").classList.add("hidden"));

$("folder-row").addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected) {
    state.customDir = selected;
    $("folder-label").textContent = selected.split(/[\\/]/).pop() || selected;
    updateFullPreview();
  }
});
$("rename-row").addEventListener("click", () => {
  $("rename-input").value = state.customName || "";
  $("rename-modal").classList.remove("hidden");
  setTimeout(() => $("rename-input").focus(), 50);
});
$("rename-cancel").addEventListener("click", () => $("rename-modal").classList.add("hidden"));
$("rename-ok").addEventListener("click", () => {
  const v = $("rename-input").value.trim();
  state.customName = v || null;
  $("rename-label").textContent = v || "Nom automatique";
  $("rename-modal").classList.add("hidden");
  updateFullPreview();
});
$("rename-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("rename-ok").click();
  if (e.key === "Escape") $("rename-cancel").click();
});

$("download-btn").addEventListener("click", async () => {
  if (state.downloading || !state.url) return;
  state.downloading = true;
  updateBtnState();
  $("btn-label").textContent = "Téléchargement…";
  $("progress-section").classList.remove("hidden");
  $("progress-fill").style.width = "0%";
  $("progress-stage").textContent = "Préparation…";
  $("progress-meta").textContent = "";

  try {
    const result = await invoke("download_video", {
      url: state.url,
      format: state.format,
      quality: state.quality,
      customName: state.customName,
      customDir: state.customDir,
      isPlaylist: state.downloadFullPlaylist,
    });

    if (result.success) {
      $("progress-fill").style.width = "100%";
      $("progress-stage").textContent = "Terminé";
      $("progress-meta").textContent = "";
      showToast(state.downloadFullPlaylist ? "Playlist téléchargée" : "Téléchargement réussi", 2400);
      state.history.unshift({
        title: state.downloadFullPlaylist ? "Playlist YouTube" : state.videoInfo?.title || state.url,
        format: state.format,
        folder: result.file_path,
        date: Date.now(),
      });
      saveHistory();
      setTimeout(() => {
        $("progress-section").classList.add("hidden");
        $("url-input").value = "";
        state.url = "";
        state.videoInfo = null;
        state.isPlaylist = false;
        state.downloadFullPlaylist = false;
        $("playlist-toggle").checked = false;
        $("preview-card").classList.add("hidden");
        $("playlist-section").classList.add("hidden");
        $("full-preview").classList.add("hidden");
        updateBtnState();
      }, 1800);
    } else {
      showToast("Erreur de téléchargement", 3500);
      console.error(result.error);
      $("progress-section").classList.add("hidden");
    }
  } catch (err) {
    showToast("Erreur : " + err, 3500);
    $("progress-section").classList.add("hidden");
  }

  state.downloading = false;
  $("btn-label").textContent = "Lancer";
  updateBtnState();
});

listen("download-progress", (event) => {
  const { percent, speed, eta, stage, playlist_index, playlist_count } = event.payload;
  $("progress-fill").style.width = percent + "%";
  let prefix = "";
  if (playlist_count && playlist_count > 1) prefix = `(${playlist_index}/${playlist_count}) `;
  if (stage === "downloading") {
    $("progress-stage").textContent = `${prefix}Téléchargement ${percent.toFixed(0)}%`;
    $("progress-meta").textContent = `${speed} · ${eta}`;
  } else if (stage === "merging") {
    $("progress-stage").textContent = prefix + "Fusion vidéo + audio…";
    $("progress-meta").textContent = "";
  } else if (stage === "extracting") {
    $("progress-stage").textContent = prefix + "Conversion audio…";
    $("progress-meta").textContent = "";
  }
});

$("open-folder-btn").addEventListener("click", () => {
  const isAudio = state.currentModule === "capture" && state.type === "audio";
  invoke("open_default_folder", { isAudio });
});

// ===== Compress =====
const pickCompressSourceDir = async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected) setCompressSourceFromPath(selected);
};

$("select-source-btn").addEventListener("click", pickCompressSourceDir);
$("compress-drop-zone").addEventListener("click", pickCompressSourceDir);
$("compress-source-clear").addEventListener("click", (e) => {
  e.stopPropagation();
  clearCompressSource();
});

$("mode-zip").addEventListener("click", () => { state.compressMode = "zip"; updateCompressUI(); });
$("mode-reencode").addEventListener("click", () => { state.compressMode = "reencode"; updateCompressUI(); });

$("zip-level-row").addEventListener("click", () => {
  showOptionsModal("Niveau de compression ZIP", ZIP_LEVELS, state.zipLevel, (key) => {
    state.zipLevel = key;
    updateCompressUI();
  });
});
$("reencode-mode-row").addEventListener("click", () => {
  showOptionsModal("Mode de réencodage", REENCODE_MODES, state.reencodeMode, (key) => {
    state.reencodeMode = key;
    updateCompressUI();
  });
});
$("reencode-quality-row").addEventListener("click", () => {
  if (state.reencodeMode === "crf") {
    showOptionsModal("Qualité (CRF)", REENCODE_QUALITIES, state.reencodeQuality, (key) => {
      state.reencodeQuality = key;
      updateCompressUI();
    });
  } else {
    showOptionsModal("Réduction de taille", REENCODE_BITRATES, state.reencodeBitrate, (key) => {
      state.reencodeBitrate = key;
      updateCompressUI();
    });
  }
});

$("compress-output-row").addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected) {
    state.compressOutputDir = selected;
    $("compress-output-label").textContent = "Sortie : " + (selected.split(/[\\/]/).pop() || selected);
  }
});

// ============================================
// LAUNCH COMPRESS — with smart routing:
// - Files < 100 MB total: use compress_files_from_data (base64 in memory)
// - Files >= 100 MB or any single file >= 100 MB: use chunked streaming
// ============================================
$("compress-btn").addEventListener("click", async () => {
  if (state.compressing || !state.compressSource) return;
  state.compressing = true;
  updateCompressBtnState();
  $("compress-progress-section").classList.remove("hidden");
  $("compress-progress-fill").style.width = "0%";
  $("compress-progress-stage").textContent = "Préparation…";
  $("compress-progress-meta").textContent = "";

  try {
    
      // ===== EXISTING PATH: directory selected via dialog =====
      const command = state.compressMode === "zip" ? "compress_zip" : "reencode_videos";
      const args = state.compressMode === "zip"
        ? {
            source: state.compressSource,
            outputDir: state.compressOutputDir,
            level: parseInt(state.zipLevel),
          }
        : {
            source: state.compressSource,
            outputDir: state.compressOutputDir,
            mode: state.reencodeMode,
            crf: parseInt(state.reencodeQuality),
            bitrateRatio: parseFloat(state.reencodeBitrate),
          };

      const result = await invoke(command, args);

      if (result.success) {
        $("compress-progress-fill").style.width = "100%";
        $("compress-progress-stage").textContent = "Terminé";
        $("compress-progress-meta").textContent = result.output_info || "";
        showToast("Compression terminée", 2500);
        setTimeout(() => {
          $("compress-progress-section").classList.add("hidden");
          clearCompressSource();
        }, 2500);
      } else {
        showToast("Erreur : " + (result.error || "inconnue"), 4000);
        console.error(result.error);
        $("compress-progress-section").classList.add("hidden");
      }
    
  } catch (err) {
    showToast("Erreur : " + err, 4000);
    console.error("Compress error:", err);
    $("compress-progress-section").classList.add("hidden");
  }

  state.compressing = false;
  updateCompressBtnState();
});

listen("compress-progress", (event) => {
  const { percent, stage, current_file, file_index, total_files } = event.payload;
  $("compress-progress-fill").style.width = percent + "%";
  let prefix = "";
  if (total_files && total_files > 1) prefix = `(${file_index}/${total_files}) `;
  if (stage === "zipping") {
    $("compress-progress-stage").textContent = `${prefix}Compression ${percent.toFixed(0)}%`;
    $("compress-progress-meta").textContent = current_file || "";
  } else if (stage === "reencoding") {
    $("compress-progress-stage").textContent = `${prefix}Réencodage ${percent.toFixed(0)}%`;
    $("compress-progress-meta").textContent = current_file || "";
  } else if (stage === "scanning") {
    $("compress-progress-stage").textContent = "Analyse…";
    if (current_file) $("compress-progress-meta").textContent = current_file;
  }
});

// ===== yt-dlp update =====
const checkYtdlpUpdate = async () => {
  const elSidebar = $("update-status-sidebar");
  try {
    if (elSidebar) elSidebar.textContent = "Vérification yt-dlp…";
    const result = await invoke("update_ytdlp");
    const msg = result.updated ? "yt-dlp à jour ✓" : "yt-dlp à jour";
    if (elSidebar) elSidebar.textContent = msg;
  } catch {
    if (elSidebar) elSidebar.textContent = "yt-dlp hors ligne";
  }
};

$("welcome-ok").addEventListener("click", () => {
  $("welcome-modal").classList.add("hidden");
  localStorage.setItem("welcome-seen-v3", "true");
});

// ============================================
// INIT
// ============================================
(async () => {
  applyTheme();
  updateFormatUI();
  updateCompressUI();
  renderHistory();
  updateBtnState();
  updateCompressBtnState();

  if (!localStorage.getItem("welcome-seen-v3")) {
    $("welcome-modal").classList.remove("hidden");
  }

  checkYtdlpUpdate();
})();

;
// ============================================
// PHASE B - AUDIO MODULE (Level 1 shell)
// ============================================
const AUDIO_SUPPORTED_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "ogg", "opus", "aac", "wma", "aiff", "aif"];
const AUDIO_PRESET_LABELS = {
  clear_voice: "Voix claire",
  voice_memo: "Note vocale lisible",
  podcast_interview: "Podcast / Interview",
  chain: "Chaine d'effets",
};
const AUDIO_USER_LEVELS = ["beginner", "amateur", "pro"];
const AUDIO_USER_LEVEL_STORAGE_KEY = "loadlink-user-level";

function loadAudioUserLevel() {
  try {
    const stored = localStorage.getItem(AUDIO_USER_LEVEL_STORAGE_KEY);
    if (stored && AUDIO_USER_LEVELS.includes(stored)) return stored;
  } catch (err) {
    console.warn("[audio] localStorage read failed:", err);
  }
  return "amateur";
}

function saveAudioUserLevel(level) {
  if (!AUDIO_USER_LEVELS.includes(level)) return;
  try {
    localStorage.setItem(AUDIO_USER_LEVEL_STORAGE_KEY, level);
  } catch (err) {
    console.warn("[audio] localStorage write failed:", err);
  }
}

function setAudioUserLevel(level) {
  if (!AUDIO_USER_LEVELS.includes(level) || level === audioState.userLevel) return;
  const previous = audioState.userLevel;
  // Bug E — Pro tweaks must survive a detour through Amateur/Beginner. Amateur
  // sliders deliberately overwrite effectChain.eq.bands; if the user had hand-
  // edited the Pro EQ first, those edits would be lost on level swap. Snapshot
  // the Pro state when leaving Pro and restore it on return.
  if (previous === "pro" && level !== "pro") {
    try {
      audioState.proChainSnapshot = JSON.parse(JSON.stringify(audioState.effectChain));
      audioState.proMasterSnapshot = JSON.parse(JSON.stringify(audioMasterState));
    } catch (err) {
      console.warn("[audio] Pro snapshot failed:", err);
    }
  }
  if (level === "pro" && audioState.proChainSnapshot) {
    try {
      audioState.effectChain = JSON.parse(JSON.stringify(audioState.proChainSnapshot));
      if (audioState.proMasterSnapshot) {
        Object.assign(audioMasterState, JSON.parse(JSON.stringify(audioState.proMasterSnapshot)));
      }
    } catch (err) {
      console.warn("[audio] Pro restore failed:", err);
    }
  }
  audioState.userLevel = level;
  saveAudioUserLevel(level);
  audioUpdateUI();
}

const AUDIO_DEFAULT_EFFECTS = [
  { key: "eq", label: "EQ Paramétrique", enabled: true },
  { key: "compressor", label: "Compresseur", enabled: true },
  { key: "deesser", label: "De-esser", enabled: false },
  { key: "denoise", label: "Denoise", enabled: false },
  { key: "reverb", label: "Réverbération", enabled: false },
  { key: "limiter", label: "Limiter", enabled: true },
];
const AUDIO_DEFAULT_EQ_BANDS = [
  { kind: "highpass", freq: 80, gain: 0, q: 0.7, color: "#10b981" },
  { kind: "peaking", freq: 250, gain: 0, q: 1, color: "#3b82f6" },
  { kind: "peaking", freq: 1200, gain: 0, q: 1, color: "#a855f7" },
  { kind: "peaking", freq: 4500, gain: 0, q: 1, color: "#f59e0b" },
  { kind: "highshelf", freq: 12000, gain: 0, q: 0.7, color: "#ef4444" },
];
const AUDIO_DEFAULT_COMPRESSOR = {
  threshold: -18,
  ratio: 3,
  attack: 10,
  release: 100,
  makeup: 2,
};

function createDefaultEffectChain() {
  return {
    eq: { enabled: true, bands: AUDIO_DEFAULT_EQ_BANDS.map((band) => ({ ...band })) },
    compressor: { enabled: true, ...AUDIO_DEFAULT_COMPRESSOR },
    deesser: { enabled: false, intensity: 0.35, frequency: 0.55, mode: 0.5 },
    denoise: { enabled: false, amount: 12, noiseFloor: -25 },
    reverb: { enabled: false },
    limiter: { enabled: true, ceiling: -0.5, attack: 5, release: 50 },
    silence: { enabled: false, threshold: -35, duration: 0.4 },
    loudnorm: { enabled: false, targetLufs: -16 },
  };
}

function resetAudioEffectChainForPreset(presetKey) {
  const chain = createDefaultEffectChain();
  if (presetKey === "clear_voice") {
    chain.eq.bands = [
      { ...AUDIO_DEFAULT_EQ_BANDS[0], freq: 80 },
      { ...AUDIO_DEFAULT_EQ_BANDS[1], freq: 250, gain: -1.5 },
      { ...AUDIO_DEFAULT_EQ_BANDS[2], freq: 1200, gain: 0.5 },
      { ...AUDIO_DEFAULT_EQ_BANDS[3], freq: 4500, gain: 3 },
      { ...AUDIO_DEFAULT_EQ_BANDS[4], freq: 12000, gain: 1 },
    ];
    chain.compressor = { enabled: true, threshold: -18, ratio: 3, attack: 5, release: 80, makeup: 2 };
    chain.denoise = { ...chain.denoise, enabled: true, amount: 14, noiseFloor: -25 };
    chain.loudnorm = { enabled: true, targetLufs: -16 };
  }
  if (presetKey === "voice_memo") {
    chain.eq.bands = [
      { ...AUDIO_DEFAULT_EQ_BANDS[0], freq: 100 },
      { ...AUDIO_DEFAULT_EQ_BANDS[1], freq: 250, gain: -3 },
      { ...AUDIO_DEFAULT_EQ_BANDS[2], freq: 1200, gain: 1 },
      { ...AUDIO_DEFAULT_EQ_BANDS[3], freq: 3500, gain: 4 },
      { ...AUDIO_DEFAULT_EQ_BANDS[4], freq: 10000, gain: 1.5 },
    ];
    chain.compressor = { enabled: true, threshold: -22, ratio: 4, attack: 3, release: 100, makeup: 3 };
    chain.denoise = { ...chain.denoise, enabled: true, amount: 22, noiseFloor: -30 };
    chain.loudnorm = { enabled: true, targetLufs: -15 };
  }
  if (presetKey === "podcast_interview") {
    chain.eq.bands = [
      { ...AUDIO_DEFAULT_EQ_BANDS[0], freq: 75 },
      { ...AUDIO_DEFAULT_EQ_BANDS[1], freq: 180, gain: -1.5 },
      { ...AUDIO_DEFAULT_EQ_BANDS[2], freq: 1200, gain: 0 },
      { ...AUDIO_DEFAULT_EQ_BANDS[3], freq: 4500, gain: 2 },
      { ...AUDIO_DEFAULT_EQ_BANDS[4], freq: 12000, gain: 1 },
    ];
    chain.compressor = { enabled: true, threshold: -20, ratio: 3, attack: 8, release: 120, makeup: 2 };
    chain.deesser = { ...chain.deesser, enabled: true, intensity: 0.35, frequency: 0.55, mode: 0.5 };
    chain.denoise = { ...chain.denoise, enabled: true, amount: 10, noiseFloor: -22 };
    chain.loudnorm = { enabled: true, targetLufs: -16 };
  }
  audioState.effectChain = chain;
  audioState.effects = AUDIO_DEFAULT_EFFECTS.map((effect) => ({
    ...effect,
    enabled: chain[effect.key] ? Boolean(chain[effect.key].enabled) : effect.enabled,
  }));
}

const audioState = {
  userLevel: loadAudioUserLevel(),
  fxOnPreview: true,
  mediaPath: null,
  mediaName: null,
  mediaSize: null,
  mediaDuration: null,
  resultDuration: null,
  currentPreset: null,
  processing: false,
  processingPreset: null,
  processingProgress: 0,
  resultPath: null,
  resultFormat: null,
  resultOutputDir: null,
  resultIsPreview: false,
  previewStartSeconds: 0,
  previewDurationSeconds: 5,
  previewProcessing: false,
  fullChainPath: null,
  fullChainStale: false,
  currentSrc: "original",
  lastErrorPreset: null,
  exportDir: null,
  exportProcessing: false,
  exportFormat: "wav",
  exportSampleRate: 48000,
  exportBitDepth: 24,
  exportMp3Mode: "cbr",
  exportMp3Quality: 320,
  exportFlacLevel: 5,
  exportAacBitrate: 256,
  exportOggQuality: 5,
  exportName: "",
  exportMetadata: { title: "", artist: "", album: "", year: "", genre: "", comment: "" },
  refineOpen: false,
  history: [],
  historyIndex: -1,
  track: { mute: false, solo: false, gainDb: 0 },
  extraTracks: [],
  refineSliders: {
    volume: 50,
    noise: 50,
    voice: 50,
    compression: 50,
    silence: 50,
    sibilance: 50,
  },
  studioTab: "edit",
  effectsTab: "effects",
  selectedEffect: "eq",
  effects: AUDIO_DEFAULT_EFFECTS.map((effect) => ({ ...effect })),
  effectChain: createDefaultEffectChain(),
  chainProcessing: false,
  chainPending: false,
  analysis: null,
};

let audioModuleInitialized = false;
let audioOriginalWave = null;
let audioResultWave = null;
let audioOriginalFallbackEl = null;
let audioResultFallbackEl = null;
let audioProgressUnlisten = null;
let audioOperationToken = 0;
let audioAnalyzeToken = 0;
let audioChainDebounce = null;
let audioChainToken = 0;
let audioPreviewDebounce = null;
let audioPreviewToken = 0;
let audioPreviewPending = false;
let audioEqDrag = null;
let audioHistoryDebounce = null;
const AUDIO_HISTORY_MAX = 20;
let audioMeterCtx = null;
let audioMeterFor = null; // wave instance the meter is wired to
let audioMeterAnalysers = null; // { left, right, audio }
let audioMeterRafId = null;
let audioMeterPeakL = 0;
let audioMeterPeakR = 0;
let audioMeterPeakHoldL = 0;
let audioMeterPeakHoldR = 0;
let audioLoadTokens = {
  original: 0,
  result: 0,
};

function initAudioModule(appState = state) {
  if (!audioModuleInitialized) {
    audioModuleInitialized = true;
    bindAudioModuleHandlers(appState);
  }
  audioUpdateUI();
}

function bindAudioModuleHandlers(appState) {
  const importCard = document.getElementById("audio-import-card");
  const recordCard = document.getElementById("audio-record-card");
  const urlLink = document.getElementById("audio-url-link");
  const fileChip = document.getElementById("audio-file-chip");
  const resetBtn = document.getElementById("audio-reset-btn");
  const playBtn = document.getElementById("audio-play-btn");
  const timeline = document.getElementById("audio-timeline");
  const exportBtn = document.getElementById("audio-export-btn");
  const exportCancelBtn = document.getElementById("audio-export-cancel");
  const exportConfirmBtn = document.getElementById("audio-export-confirm");
  const exportFolderBtn = document.getElementById("audio-export-folder-btn");
  const exportModal = document.getElementById("audio-export-modal");
  const backBtn = document.getElementById("audio-back-btn");
  const helpBtn = document.getElementById("audio-help-btn");
  const refineToggle = document.getElementById("audio-refine-toggle");
  const refineReset = document.getElementById("audio-refine-reset");

  backBtn?.addEventListener("click", goHome);
  helpBtn?.addEventListener("click", openAudioHelpModal);
  document.getElementById("audio-undo-btn")?.addEventListener("click", audioUndo);
  document.getElementById("audio-redo-btn")?.addEventListener("click", audioRedo);
  document.getElementById("audio-help-modal-close")?.addEventListener("click", closeAudioHelpModal);
  document.getElementById("audio-help-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "audio-help-modal") closeAudioHelpModal();
  });
  bindAudioTrackControls();
  bindAudioKeyboardShortcuts(appState);
  bindAudioTimelineTools();
  document.getElementById("audio-add-track-btn")?.addEventListener("click", addAudioExtraTrack);
  importCard?.addEventListener("click", pickAudioFile);
  playBtn?.addEventListener("click", audioTogglePlayback);
  timeline?.addEventListener("click", audioSeekFromTimelineEvent);
  exportBtn?.addEventListener("click", openAudioExportModal);
  exportCancelBtn?.addEventListener("click", closeAudioExportModal);
  exportConfirmBtn?.addEventListener("click", confirmAudioExport);
  exportFolderBtn?.addEventListener("click", chooseAudioExportDir);
  exportModal?.addEventListener("click", (event) => {
    if (event.target === exportModal && !audioState.exportProcessing) closeAudioExportModal();
  });
  document.querySelectorAll('input[name="audio-export-format"]').forEach((input) => {
    input.addEventListener("change", () => {
      audioState.exportFormat = input.value;
      renderAudioExportQualityPanel();
    });
  });
  document.getElementById("audio-export-meta-btn")?.addEventListener("click", () => {
    const fields = document.getElementById("audio-export-meta-fields");
    const btn = document.getElementById("audio-export-meta-btn");
    if (!fields || !btn) return;
    const wasHidden = fields.classList.contains("hidden");
    fields.classList.toggle("hidden");
    btn.textContent = wasHidden ? "− Masquer" : "+ Ajouter";
  });

  recordCard?.addEventListener("click", showAudioRecordingView);

  document.getElementById("audio-record-back")?.addEventListener("click", hideAudioRecordingView);
  document.getElementById("audio-record-refresh")?.addEventListener("click", audioPopulateDevices);
  document.getElementById("audio-record-device-select")?.addEventListener("change", (event) => {
    audioRecordState.deviceId = event.target.value;
  });
  document.getElementById("audio-record-gain")?.addEventListener("input", (event) => {
    const pct = Number(event.target.value);
    audioRecordState.digitalGain = pct / 100;
    document.getElementById("audio-record-gain-value").textContent = `${pct}%`;
    if (audioRecordState.gainNode) audioRecordState.gainNode.gain.value = audioRecordState.digitalGain;
  });
  document.getElementById("audio-record-monitor")?.addEventListener("change", (event) => {
    audioRecordState.monitor = event.target.checked;
    if (audioRecordState.monitorNode) audioRecordState.monitorNode.gain.value = audioRecordState.monitor ? 0.6 : 0;
  });
  document.getElementById("audio-record-format")?.addEventListener("change", (event) => {
    audioRecordState.format = event.target.value;
  });
  document.getElementById("audio-record-rec")?.addEventListener("click", audioRecordingStart);
  document.getElementById("audio-record-stop")?.addEventListener("click", () => audioRecordingStop());
  document.getElementById("audio-recording-done-discard")?.addEventListener("click", audioRecordingDiscard);
  document.getElementById("audio-recording-done-delete")?.addEventListener("click", audioRecordingDelete);
  document.getElementById("audio-recording-done-save")?.addEventListener("click", () => audioRecordingFinalize("save"));
  document.getElementById("audio-recording-done-load")?.addEventListener("click", () => audioRecordingFinalize("load"));
  document.getElementById("audio-recording-done-folder-btn")?.addEventListener("click", audioRecordingChooseFolder);

  audioRecordingCheckCrashRecovery().catch(() => {});

  document.getElementById("audio-master-render-btn")?.addEventListener("click", audioMasterRender);
  document.getElementById("audio-master-export-btn")?.addEventListener("click", audioMasterExportFinal);
  document.getElementById("audio-master-undo-preset")?.addEventListener("click", audioMasterUndoPreset);

  urlLink?.addEventListener("click", () => {
    showToast("URL audio disponible en Phase H", 2500);
  });

  fileChip?.addEventListener("click", async (event) => {
    if (event.target.closest("#audio-file-chip-clear")) {
      event.stopPropagation();
      resetAudioWithConfirm();
      return;
    }
    if (!audioState.mediaPath) return;
    await openAudioSourceFolder();
  });

  resetBtn?.addEventListener("click", resetAudioWithConfirm);

  document.querySelectorAll(".audio-preset-card").forEach((card) => {
    card.addEventListener("click", () => handleAudioPresetClick(card.dataset.preset));
  });

  document.querySelectorAll("#audio-ab-toggle [data-audio-source]").forEach((button) => {
    button.addEventListener("click", () => setActiveAudioSource(button.dataset.audioSource));
  });

  document.querySelectorAll("#audio-level-switch [data-audio-level]").forEach((button) => {
    button.addEventListener("click", () => setAudioUserLevel(button.dataset.audioLevel));
  });

  const fxBtn = document.getElementById("audio-shared-fx-toggle");
  fxBtn?.addEventListener("click", () => {
    if (!audioState.resultPath) {
      showToast("Applique un preset d'abord pour activer le preview FX", 2400);
      return;
    }
    const nextSrc = audioState.currentSrc === "result" ? "original" : "result";
    setActiveAudioSource(nextSrc, { preservePosition: true });
  });
  syncAudioFxToggle();

  document.querySelectorAll("#audio-side-tabs [data-audio-side-tab]").forEach((button) => {
    button.addEventListener("click", () => setAudioSideTab(button.dataset.audioSideTab));
  });

  document.getElementById("audio-add-effect-btn")?.addEventListener("click", () => {
    showToast("Ajout d'effet disponible en Phase D", 2500);
  });
  document.getElementById("audio-apply-full-btn")?.addEventListener("click", applyChainToFullFile);
  refineToggle?.addEventListener("click", toggleAudioRefinePanel);
  refineReset?.addEventListener("click", resetAudioRefineSliders);
  document.querySelectorAll("[data-audio-refine]").forEach((input) => {
    input.addEventListener("input", () => updateAudioRefineSlider(input.dataset.audioRefine, input.value));
  });
  window.addEventListener("mousemove", handleAudioEqDragMove);
  window.addEventListener("mouseup", handleAudioEqDragEnd);

  bindAudioNativeDragDrop(appState);
}

function bindAudioTrackControls() {
  const muteBtn = document.querySelector("#audio-track-card .audio-track-btn[title='Mute']");
  const soloBtn = document.querySelector("#audio-track-card .audio-track-btn[title='Solo']");
  const gainInput = document.getElementById("audio-track-gain");

  muteBtn?.addEventListener("click", () => {
    audioState.track.mute = !audioState.track.mute;
    muteBtn.classList.toggle("active", audioState.track.mute);
    applyAudioTrackGainToPlayers();
  });
  soloBtn?.addEventListener("click", () => {
    audioState.track.solo = !audioState.track.solo;
    soloBtn.classList.toggle("active", audioState.track.solo);
    // Single track: solo is informational only.
  });
  if (gainInput) {
    gainInput.disabled = false;
    gainInput.value = String(audioState.track.gainDb);
    gainInput.addEventListener("input", () => {
      audioState.track.gainDb = clampNumber(Number(gainInput.value), -24, 12);
      applyAudioTrackGainToPlayers();
    });
  }
}

// ============================================
// Beginner / Amateur panels — simplified UIs that map onto the same
// effect chain + master chain used by Pro mode.
// ============================================
const AUDIO_BEGINNER_PRESETS = [
  {
    key: "clear_voice",
    label: "Voix claire",
    description: "Voix off, narration, podcast.",
    icon: "🗣",
    presetKey: "clear_voice",
    target: -16,
  },
  {
    key: "podcast",
    label: "Podcast",
    description: "Émission radio, interview longue.",
    icon: "🎙",
    presetKey: "podcast_interview",
    target: -16,
  },
  {
    key: "music",
    label: "Musique",
    description: "Maquette musicale prête à publier.",
    icon: "🎵",
    presetKey: "voice_memo",
    target: -14,
  },
];

const AUDIO_AMATEUR_TARGETS = {
  youtube: { masterPreset: "voiceover_video", lufs: -23, label: "YouTube" },
  podcast: { masterPreset: "podcast_pro", lufs: -16, label: "Podcast" },
  music: { masterPreset: "music_streaming", lufs: -14, label: "Musique" },
  voiceover: { masterPreset: "voiceover_video", lufs: -23, label: "Voix off" },
};

const audioAmateurState = {
  low: 0,
  mid: 0,
  high: 0,
  compression: 0,
  reverb: false,
  deess: false,
  target: "podcast",
};

function renderAudioBeginnerPanel() {
  const root = document.getElementById("audio-beginner-presets");
  if (!root) return;
  const activePreset = audioState.currentPreset;
  const processingPreset = audioState.processingPreset;
  root.innerHTML = AUDIO_BEGINNER_PRESETS.map((p) => {
    const isActive = p.presetKey === activePreset && !processingPreset;
    const isProcessing = p.presetKey === processingPreset;
    const status = isProcessing ? "⟳ Application…" : (isActive ? "✓ Appliqué" : "Appliquer");
    const cls = `audio-beginner-preset${isActive ? " active" : ""}${isProcessing ? " processing" : ""}`;
    return `
      <button type="button" class="${cls}" data-beginner-preset="${p.key}"${isProcessing ? " disabled" : ""}>
        <span class="audio-beginner-preset-icon">${p.icon}</span>
        <span class="audio-beginner-preset-name">${p.label}</span>
        <span class="audio-beginner-preset-desc">${p.description}</span>
        <span class="audio-beginner-preset-status">${status}</span>
      </button>
    `;
  }).join("");
  root.querySelectorAll("[data-beginner-preset]").forEach((btn) => {
    btn.addEventListener("click", () => audioBeginnerApplyPreset(btn.dataset.beginnerPreset));
  });

  const volumeSlider = document.getElementById("audio-beginner-volume");
  const volumeValue = document.getElementById("audio-beginner-volume-value");
  // Map masterGainDb back to a 0..100 percent for the slider so reopening the
  // panel or switching levels reflects the current state.
  const currentLinear = Math.pow(10, (audioState.masterGainDb || 0) / 20);
  const currentPct = Math.max(0, Math.min(100, Math.round(currentLinear * 100)));
  if (volumeSlider && document.activeElement !== volumeSlider) {
    volumeSlider.value = currentPct;
  }
  if (volumeValue) volumeValue.textContent = `${currentPct}%`;
  if (volumeSlider && !volumeSlider.dataset.bound) {
    volumeSlider.dataset.bound = "1";
    volumeSlider.addEventListener("input", () => {
      const pct = Number(volumeSlider.value);
      if (volumeValue) volumeValue.textContent = `${pct}%`;
      // Map 0..100% → log-scaled dB (-60 at 0, 0 dB at 100). Beginner can only
      // attenuate; boost > 0 dB stays in Amateur/Pro modes.
      const dB = pct <= 0 ? -60 : 20 * Math.log10(pct / 100);
      audioState.masterGainDb = clampNumber(dB, -24, 0);
      // Live preview: apply the gain immediately to the playing wavesurfer so
      // the user actually hears the volume change. The same value also goes to
      // ffmpeg at "Exporter" time via masterGainDb.
      audioState.track.gainDb = audioState.masterGainDb;
      applyAudioTrackGainToPlayers();
      audioState.fullChainStale = Boolean(audioState.fullChainPath);
      renderAudioApplyFullButton();
    });
  }
  const exportBtn = document.getElementById("audio-beginner-export");
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", audioBeginnerExport);
  }
  const hint = document.getElementById("audio-beginner-hint");
  if (hint) {
    if (!audioState.mediaPath) {
      hint.textContent = "Charge ou enregistre un fichier audio pour commencer.";
    } else if (processingPreset) {
      hint.textContent = "Application du preset en cours…";
    } else if (!audioState.fullChainPath && !audioState.resultPath) {
      hint.textContent = "Clique un preset, puis Exporter pour générer ton fichier final.";
    } else {
      hint.textContent = "Fichier prêt à exporter.";
    }
  }
}

function audioBeginnerApplyPreset(key) {
  const preset = AUDIO_BEGINNER_PRESETS.find((p) => p.key === key);
  if (!preset || !audioState.mediaPath) return;
  // Reuse the existing preset pipeline; the preset name maps onto the Rust enum.
  runAudioPreset(preset.presetKey, { format: null, outputDir: null });
}

async function audioBeginnerExport() {
  if (!audioState.mediaPath) {
    showToast("Charge un fichier d'abord", 2500);
    return;
  }
  if (!audioState.fullChainPath && !audioState.resultPath) {
    showToast("Applique d'abord un preset", 2500);
    return;
  }
  openAudioExportModal();
}

function renderAudioAmateurPanel() {
  // Bind once, then keep slider values + LUFS readout in sync.
  ["low", "mid", "high", "comp"].forEach((key) => {
    const slider = document.getElementById(`audio-amateur-${key}`);
    if (!slider) return;
    if (!slider.dataset.bound) {
      slider.dataset.bound = "1";
      slider.addEventListener("input", () => {
        const value = Number(slider.value);
        if (key === "comp") audioAmateurState.compression = value;
        else if (key === "low") audioAmateurState.low = value;
        else if (key === "mid") audioAmateurState.mid = value;
        else if (key === "high") audioAmateurState.high = value;
        renderAudioAmateurReadouts();
        audioAmateurSyncMasterChain();
      });
    }
    slider.value = key === "comp" ? audioAmateurState.compression
      : key === "low" ? audioAmateurState.low
      : key === "mid" ? audioAmateurState.mid
      : audioAmateurState.high;
  });

  const reverb = document.getElementById("audio-amateur-reverb");
  const deess = document.getElementById("audio-amateur-deess");
  if (reverb && !reverb.dataset.bound) {
    reverb.dataset.bound = "1";
    reverb.addEventListener("change", () => {
      audioAmateurState.reverb = reverb.checked;
      audioAmateurSyncMasterChain();
    });
  }
  if (deess && !deess.dataset.bound) {
    deess.dataset.bound = "1";
    deess.addEventListener("change", () => {
      audioAmateurState.deess = deess.checked;
      audioAmateurSyncMasterChain();
    });
  }
  if (reverb) reverb.checked = audioAmateurState.reverb;
  if (deess) deess.checked = audioAmateurState.deess;

  document.querySelectorAll("#audio-amateur-targets [data-target]").forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        audioAmateurState.target = btn.dataset.target;
        renderAudioAmateurPanel();
        audioAmateurSyncMasterChain();
      });
    }
    btn.classList.toggle("active", btn.dataset.target === audioAmateurState.target);
  });

  const applyBtn = document.getElementById("audio-amateur-apply");
  const exportBtn = document.getElementById("audio-amateur-export");
  if (applyBtn && !applyBtn.dataset.bound) {
    applyBtn.dataset.bound = "1";
    applyBtn.addEventListener("click", audioAmateurApplyAndRender);
  }
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", audioBeginnerExport);
  }

  renderAudioAmateurReadouts();
  renderAudioAmateurLufs();
}

function renderAudioAmateurReadouts() {
  const fmt = (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)} dB`;
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("audio-amateur-low-val", fmt(audioAmateurState.low));
  setText("audio-amateur-mid-val", fmt(audioAmateurState.mid));
  setText("audio-amateur-high-val", fmt(audioAmateurState.high));
  setText("audio-amateur-comp-val", `${audioAmateurState.compression}%`);
}

function renderAudioAmateurLufs() {
  const measured = audioState.analysis?.loudnessLufs;
  const target = AUDIO_AMATEUR_TARGETS[audioAmateurState.target]?.lufs;
  const lufs = Number.isFinite(measured) ? measured : target;
  const dot = document.getElementById("audio-amateur-lufs-dot");
  const value = document.getElementById("audio-amateur-lufs-value");
  const text = document.getElementById("audio-amateur-lufs-text");
  if (!value || !dot || !text) return;
  if (!Number.isFinite(lufs)) {
    value.textContent = "--";
    text.textContent = audioState.mediaPath ? "Choisis une cible et un preset" : "Charge un fichier pour analyser";
    dot.style.color = "var(--text3)";
    return;
  }
  value.textContent = `${lufs.toFixed(1)} LUFS`;
  const prefix = Number.isFinite(measured) ? "Mesuré · " : "Cible · ";
  if (lufs >= -16 && lufs <= -14) {
    dot.style.color = "#22c55e";
    text.textContent = `${prefix}niveau optimal streaming`;
  } else if ((lufs >= -23 && lufs < -16) || (lufs > -14 && lufs <= -9)) {
    dot.style.color = "#facc15";
    text.textContent = `${prefix}niveau limite — ajustable`;
  } else {
    dot.style.color = "#ef4444";
    text.textContent = lufs < -23 ? `${prefix}trop faible` : `${prefix}trop fort — risque clipping`;
  }
}

function audioAmateurSyncMasterChain() {
  // Amateur sliders feed the per-clip effect chain (same one used by the live
  // preview) so the user gets audible/visible feedback as soon as they touch a
  // slider. The mastering bus only runs at "Appliquer et rendre" time.
  const target = AUDIO_AMATEUR_TARGETS[audioAmateurState.target] || AUDIO_AMATEUR_TARGETS.podcast;
  const c = audioAmateurState.compression / 100;

  const eq = audioState.effectChain?.eq;
  if (eq && eq.bands) {
    eq.enabled = true;
    // 5-band EQ default layout: [highpass 80, peaking 250, peaking 1200,
    // peaking 4500, highshelf 12000]. Map the 3 amateur sliders onto the
    // bands that are most audible for non-experts.
    if (eq.bands[1]) eq.bands[1].gain = audioAmateurState.low;   // 250 Hz
    if (eq.bands[2]) eq.bands[2].gain = audioAmateurState.mid;   // 1.2 kHz
    if (eq.bands[4]) eq.bands[4].gain = audioAmateurState.high;  // 12 kHz
  }

  const compressor = audioState.effectChain?.compressor;
  if (compressor) {
    compressor.enabled = c > 0.05;
    compressor.threshold = clampNumber(-12 - c * 12, -24, -12);
    compressor.ratio = clampNumber(2 + c * 4, 2, 6);
    compressor.attack = 8;
    compressor.release = 100;
    compressor.makeup = 2 + c * 2;
  }

  if (audioState.effectChain?.deesser) {
    audioState.effectChain.deesser.enabled = audioAmateurState.deess;
  }
  if (audioState.effectChain?.reverb) {
    audioState.effectChain.reverb.enabled = audioAmateurState.reverb;
  }
  if (audioState.effectChain?.loudnorm) {
    audioState.effectChain.loudnorm.targetLufs = target.lufs;
    audioState.effectChain.loudnorm.enabled = true;
  }

  // Mirror the same values into the master bus so the final render (button
  // "Appliquer et rendre") matches what the user heard in preview.
  audioMasterState.eq.enabled = true;
  audioMasterState.eq.lowShelfGain = audioAmateurState.low;
  audioMasterState.eq.lowMidGain = 0;
  audioMasterState.eq.highMidGain = audioAmateurState.mid;
  audioMasterState.eq.highShelfGain = audioAmateurState.high;
  audioMasterState.compressor.enabled = c > 0.05;
  audioMasterState.compressor.threshold = clampNumber(-12 - c * 12, -24, -12);
  audioMasterState.compressor.ratio = clampNumber(2 + c * 4, 2, 6);
  audioMasterState.limiter.targetLufs = target.lufs;

  audioState.fullChainStale = Boolean(audioState.fullChainPath);
  renderAudioApplyFullButton();
  // Trigger the same 5 s preview pipeline as Pro mode — fast feedback loop.
  if (audioState.mediaPath) scheduleAudioChainRender(400);
}

async function audioAmateurApplyAndRender() {
  if (!audioState.mediaPath) {
    showToast("Charge un fichier d'abord", 2500);
    return;
  }
  audioAmateurSyncMasterChain();
  // Run the full effect chain on the source, then master on top.
  const chainResult = await runAudioEffectChain();
  if (!chainResult) return;
  await audioMasterRender();
  showToast("Rendu Amateur terminé", 2000);
}

// ============================================
// CHANTIER C — Mastering studio
// ============================================
const AUDIO_MASTER_PRESETS = [
  {
    key: "podcast_pro",
    label: "Podcast professionnel",
    description: "EBU R128 -16 LUFS · voix présente",
    target: "Voix podcast / interview",
    chain: {
      eq: { enabled: true, lowShelfGain: 1, lowMidGain: -2, highMidGain: 2, highShelfGain: 0 },
      compressor: { enabled: true, threshold: -18, ratio: 3, attack: 10, release: 80, makeup: 2 },
      stereo: { enabled: true, width: 100 },
      saturation: { enabled: false, drive: 0 },
      limiter: { ceiling: -1, attack: 5, release: 50, targetLufs: -16 },
    },
  },
  {
    key: "music_streaming",
    label: "Musique streaming",
    description: "-14 LUFS · Spotify/Apple Music",
    target: "Musique illustrée / publication",
    chain: {
      eq: { enabled: true, lowShelfGain: 1.5, lowMidGain: 0, highMidGain: 1, highShelfGain: 1 },
      compressor: { enabled: true, threshold: -16, ratio: 4, attack: 5, release: 150, makeup: 2.5 },
      stereo: { enabled: true, width: 110 },
      saturation: { enabled: true, drive: 10 },
      limiter: { ceiling: -1, attack: 4, release: 80, targetLufs: -14 },
    },
  },
  {
    key: "voiceover_video",
    label: "Voix off vidéo",
    description: "-23 LUFS · broadcast TV / YouTube",
    target: "Narration vidéo · standard EBU",
    chain: {
      eq: { enabled: true, lowShelfGain: 2, lowMidGain: -1, highMidGain: 3, highShelfGain: -1 },
      compressor: { enabled: true, threshold: -20, ratio: 2.5, attack: 15, release: 100, makeup: 3 },
      stereo: { enabled: true, width: 95 },
      saturation: { enabled: false, drive: 0 },
      limiter: { ceiling: -2, attack: 7, release: 60, targetLufs: -23 },
    },
  },
  {
    key: "loud_master",
    label: "Loud master",
    description: "-9 LUFS · clubs / mobile · attention saturation",
    target: "Master agressif radio commerciale",
    chain: {
      eq: { enabled: true, lowShelfGain: 2, lowMidGain: 1, highMidGain: 2, highShelfGain: 2 },
      compressor: { enabled: true, threshold: -12, ratio: 6, attack: 3, release: 60, makeup: 4 },
      stereo: { enabled: true, width: 120 },
      saturation: { enabled: true, drive: 20 },
      limiter: { ceiling: -0.1, attack: 2, release: 30, targetLufs: -9 },
    },
  },
];

const audioMasterState = {
  eq: { enabled: true, lowShelfGain: 0, lowMidGain: 0, highMidGain: 0, highShelfGain: 0 },
  compressor: { enabled: true, threshold: -16, ratio: 3, attack: 8, release: 80, makeup: 2 },
  stereo: { enabled: false, width: 100 },
  saturation: { enabled: false, drive: 0 },
  limiter: { ceiling: -1, attack: 5, release: 50, targetLufs: -16 },
  activePreset: null,
  previousChain: null,
  finalPath: null,
  finalAnalysis: null,
  processing: false,
};

function audioMasterInputPath() {
  // Mastering source: full chain output if available, otherwise current preset result
  if (audioState.fullChainPath) return audioState.fullChainPath;
  if (audioState.resultPath && !audioState.resultIsPreview) return audioState.resultPath;
  return null;
}

function renderAudioMasteringView() {
  renderAudioMasterEqControls();
  renderAudioMasterCompControls();
  renderAudioMasterStereoControls();
  renderAudioMasterSaturationControls();
  renderAudioMasterLimiterControls();
  renderAudioMasterToggles();
  renderAudioMasterPresets();
  renderAudioMasterSource();
  renderAudioMasterVerdict();
}

function renderAudioMasterSource() {
  const nameEl = document.getElementById("audio-mastering-source-name");
  const renderBtn = document.getElementById("audio-master-render-btn");
  const exportBtn = document.getElementById("audio-master-export-btn");
  const path = audioMasterInputPath();
  if (nameEl) nameEl.textContent = path ? getPathName(path) : "aucune (applique d'abord la chaîne au fichier complet)";
  if (renderBtn) renderBtn.disabled = !path || audioMasterState.processing;
  if (exportBtn) exportBtn.disabled = !audioMasterState.finalPath || audioMasterState.processing;
}

function renderAudioMasterEqControls() {
  const root = document.getElementById("audio-master-eq-controls");
  if (!root) return;
  const bands = [
    { key: "lowShelfGain", label: "80 Hz Low Shelf" },
    { key: "lowMidGain", label: "250 Hz Low Mid" },
    { key: "highMidGain", label: "3 kHz High Mid" },
    { key: "highShelfGain", label: "12 kHz High Shelf" },
  ];
  root.innerHTML = bands.map((band) => `
    <label class="audio-master-eq-band">
      <span>${band.label}</span>
      <input type="range" min="-12" max="12" step="0.5" value="${audioMasterState.eq[band.key]}" data-master-eq="${band.key}" />
      <strong data-master-eq-display="${band.key}">${formatMasterDb(audioMasterState.eq[band.key])}</strong>
    </label>
  `).join("");
  root.querySelectorAll("[data-master-eq]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.masterEq;
      audioMasterState.eq[key] = Number(input.value);
      const display = root.querySelector(`[data-master-eq-display="${key}"]`);
      if (display) display.textContent = formatMasterDb(audioMasterState.eq[key]);
      audioMasterState.activePreset = null;
      renderAudioMasterPresets();
    });
  });
  root.querySelector ? null : null;
  root.parentElement?.querySelector("[data-master-reset='eq']")?.addEventListener("click", () => {
    Object.assign(audioMasterState.eq, { lowShelfGain: 0, lowMidGain: 0, highMidGain: 0, highShelfGain: 0 });
    renderAudioMasterEqControls();
    audioMasterState.activePreset = null;
    renderAudioMasterPresets();
  });
}

function renderAudioMasterCompControls() {
  const root = document.getElementById("audio-master-comp-controls");
  if (!root) return;
  const ctrls = [
    { key: "threshold", label: "Threshold", min: -60, max: 0, step: 1, unit: "dB" },
    { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, unit: ":1" },
    { key: "attack", label: "Attack", min: 1, max: 100, step: 1, unit: "ms" },
    { key: "release", label: "Release", min: 10, max: 500, step: 5, unit: "ms" },
    { key: "makeup", label: "Makeup", min: 0, max: 12, step: 0.5, unit: "dB" },
  ];
  root.innerHTML = ctrls.map((c) => `
    <label class="audio-master-comp-control">
      <span>${c.label}</span>
      <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${audioMasterState.compressor[c.key]}" data-master-comp="${c.key}" />
      <strong data-master-comp-display="${c.key}">${formatAudioCompressorValue(audioMasterState.compressor[c.key], c.unit)}</strong>
    </label>
  `).join("");
  root.querySelectorAll("[data-master-comp]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.masterComp;
      audioMasterState.compressor[key] = Number(input.value);
      const unit = key === "ratio" ? ":1" : (key === "attack" || key === "release" ? "ms" : "dB");
      const display = root.querySelector(`[data-master-comp-display="${key}"]`);
      if (display) display.textContent = formatAudioCompressorValue(audioMasterState.compressor[key], unit);
      audioMasterState.activePreset = null;
      renderAudioMasterPresets();
      updateAudioMasterGrEstimate();
    });
  });
  root.parentElement?.querySelector("[data-master-reset='compressor']")?.addEventListener("click", () => {
    Object.assign(audioMasterState.compressor, { enabled: audioMasterState.compressor.enabled, threshold: -16, ratio: 3, attack: 8, release: 80, makeup: 2 });
    renderAudioMasterCompControls();
    audioMasterState.activePreset = null;
    renderAudioMasterPresets();
  });
  updateAudioMasterGrEstimate();
}

function updateAudioMasterGrEstimate() {
  const peak = audioMasterState.finalAnalysis?.peakDbfs ?? audioState.analysis?.peakDbfs ?? -6;
  const c = audioMasterState.compressor;
  let reduction = 0;
  if (c.enabled && peak > c.threshold) {
    const above = peak - c.threshold;
    reduction = clampNumber((above * (c.ratio - 1)) / c.ratio, 0, 24);
  }
  const fill = document.getElementById("audio-master-comp-gr-fill");
  const value = document.getElementById("audio-master-comp-gr-value");
  if (fill) fill.style.width = `${(reduction / 24) * 100}%`;
  if (value) value.textContent = reduction > 0 ? `−${reduction.toFixed(1)} dB` : "−0.0 dB";
}

function renderAudioMasterStereoControls() {
  const slider = document.getElementById("audio-master-stereo-width");
  const value = document.getElementById("audio-master-stereo-value");
  if (slider) {
    slider.value = audioMasterState.stereo.width;
    slider.addEventListener("input", () => {
      let raw = Number(slider.value);
      if (Math.abs(raw - 100) < 3) raw = 100;
      audioMasterState.stereo.width = raw;
      if (value) value.textContent = `${raw}%`;
      slider.value = raw;
      audioMasterState.activePreset = null;
      renderAudioMasterPresets();
    });
  }
  if (value) value.textContent = `${audioMasterState.stereo.width}%`;
}

function renderAudioMasterSaturationControls() {
  const slider = document.getElementById("audio-master-sat-drive");
  const value = document.getElementById("audio-master-sat-value");
  if (slider) {
    slider.value = audioMasterState.saturation.drive;
    slider.addEventListener("input", () => {
      audioMasterState.saturation.drive = Number(slider.value);
      if (value) value.textContent = audioMasterState.saturation.drive;
      audioMasterState.activePreset = null;
      renderAudioMasterPresets();
    });
  }
  if (value) value.textContent = audioMasterState.saturation.drive;
}

function renderAudioMasterLimiterControls() {
  const root = document.getElementById("audio-master-lim-controls");
  if (!root) return;
  const ctrls = [
    { key: "ceiling", label: "Plafond (dBFS)", min: -3, max: 0, step: 0.1, unit: " dB" },
    { key: "attack", label: "Attack (ms)", min: 1, max: 50, step: 1, unit: " ms" },
    { key: "release", label: "Release (ms)", min: 10, max: 500, step: 5, unit: " ms" },
    { key: "targetLufs", label: "Cible LUFS", min: -30, max: -8, step: 0.5, unit: " LUFS" },
  ];
  root.innerHTML = ctrls.map((c) => `
    <label class="audio-master-comp-control">
      <span>${c.label}</span>
      <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${audioMasterState.limiter[c.key]}" data-master-lim="${c.key}" />
      <strong data-master-lim-display="${c.key}">${Number(audioMasterState.limiter[c.key]).toFixed(1)}${c.unit}</strong>
    </label>
  `).join("");
  root.querySelectorAll("[data-master-lim]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.masterLim;
      audioMasterState.limiter[key] = Number(input.value);
      const display = root.querySelector(`[data-master-lim-display="${key}"]`);
      const unit = key === "ceiling" ? " dB" : (key === "targetLufs" ? " LUFS" : " ms");
      if (display) display.textContent = `${Number(audioMasterState.limiter[key]).toFixed(1)}${unit}`;
      audioMasterState.activePreset = null;
      renderAudioMasterPresets();
    });
  });
}

function renderAudioMasterToggles() {
  document.querySelectorAll("[data-master-toggle]").forEach((btn) => {
    const key = btn.dataset.masterToggle;
    const section = audioMasterState[key];
    if (!section) return;
    btn.setAttribute("aria-pressed", section.enabled ? "true" : "false");
    btn.classList.toggle("on", section.enabled);
    const sectionEl = document.getElementById(`audio-master-section-${key === "compressor" ? "comp" : key === "saturation" ? "sat" : key === "limiter" ? "lim" : "eq"}`);
    if (sectionEl) sectionEl.classList.toggle("disabled", !section.enabled);
    btn.onclick = () => {
      section.enabled = !section.enabled;
      audioMasterState.activePreset = null;
      renderAudioMasterToggles();
      renderAudioMasterPresets();
    };
  });
}

function renderAudioMasterPresets() {
  const root = document.getElementById("audio-master-presets");
  if (!root) return;
  root.innerHTML = AUDIO_MASTER_PRESETS.map((preset) => {
    const active = audioMasterState.activePreset === preset.key;
    return `
      <button type="button" class="audio-master-preset-card${active ? " active" : ""}" data-master-preset="${preset.key}">
        ${active ? '<span class="audio-master-preset-check">✓</span>' : ""}
        <span class="audio-master-preset-label">${preset.label}</span>
        <span class="audio-master-preset-desc">${preset.description}</span>
        <span class="audio-master-preset-target">${preset.target}</span>
      </button>
    `;
  }).join("");
  root.querySelectorAll("[data-master-preset]").forEach((card) => {
    card.addEventListener("click", () => audioMasterApplyPreset(card.dataset.masterPreset));
  });
  const undoBtn = document.getElementById("audio-master-undo-preset");
  if (undoBtn) undoBtn.disabled = !audioMasterState.previousChain;
}

function audioMasterApplyPreset(presetKey) {
  const preset = AUDIO_MASTER_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return;
  audioMasterState.previousChain = JSON.parse(JSON.stringify({
    eq: audioMasterState.eq,
    compressor: audioMasterState.compressor,
    stereo: audioMasterState.stereo,
    saturation: audioMasterState.saturation,
    limiter: audioMasterState.limiter,
  }));
  audioMasterState.eq = { ...audioMasterState.eq, ...preset.chain.eq };
  audioMasterState.compressor = { ...audioMasterState.compressor, ...preset.chain.compressor };
  audioMasterState.stereo = { ...audioMasterState.stereo, ...preset.chain.stereo };
  audioMasterState.saturation = { ...audioMasterState.saturation, ...preset.chain.saturation };
  audioMasterState.limiter = { ...audioMasterState.limiter, ...preset.chain.limiter };
  audioMasterState.activePreset = presetKey;
  renderAudioMasteringView();
  showToast(`Preset "${preset.label}" appliqué`, 1800);
}

function audioMasterUndoPreset() {
  if (!audioMasterState.previousChain) return;
  Object.assign(audioMasterState.eq, audioMasterState.previousChain.eq);
  Object.assign(audioMasterState.compressor, audioMasterState.previousChain.compressor);
  Object.assign(audioMasterState.stereo, audioMasterState.previousChain.stereo);
  Object.assign(audioMasterState.saturation, audioMasterState.previousChain.saturation);
  Object.assign(audioMasterState.limiter, audioMasterState.previousChain.limiter);
  audioMasterState.previousChain = null;
  audioMasterState.activePreset = null;
  renderAudioMasteringView();
}

async function audioMasterRender() {
  const input = audioMasterInputPath();
  if (!input || audioMasterState.processing) return;
  audioMasterState.processing = true;
  audioMasterState.finalPath = null;
  audioMasterState.finalAnalysis = null;
  renderAudioMasterSource();
  renderAudioMasterVerdict();
  const renderBtn = document.getElementById("audio-master-render-btn");
  if (renderBtn) renderBtn.textContent = "Rendu en cours…";

  try {
    const req = {
      input,
      outputDir: null,
      format: "wav",
      eq: { ...audioMasterState.eq },
      compressor: { ...audioMasterState.compressor },
      stereo: { ...audioMasterState.stereo },
      saturation: { ...audioMasterState.saturation },
      limiter: { ...audioMasterState.limiter },
    };
    const result = await invoke("audio_apply_master", { req });
    if (!result || result.success === false) {
      throw new Error((result && result.error) || "Mastering échoué");
    }
    const outPath = result.outputPath || result.output_path;
    audioMasterState.finalPath = outPath;
    audioMasterState.finalAnalysis = await invoke("audio_analyze", { input: outPath }).catch(() => null);
    showToast("Mastering terminé", 2400);
  } catch (err) {
    console.error("[master] failed:", err);
    showToast("Erreur mastering : " + (err.message || err), 5000);
  } finally {
    audioMasterState.processing = false;
    if (renderBtn) renderBtn.textContent = "Rendre le master";
    renderAudioMasterSource();
    renderAudioMasterVerdict();
    updateAudioMasterGrEstimate();
  }
}

function renderAudioMasterVerdict() {
  const lufsEl = document.getElementById("audio-master-verdict-lufs");
  const peakEl = document.getElementById("audio-master-verdict-peak");
  const drEl = document.getElementById("audio-master-verdict-dr");
  const badge = document.getElementById("audio-master-verdict-badge");
  const exportBtn = document.getElementById("audio-master-export-btn");
  const analysis = audioMasterState.finalAnalysis;
  if (!analysis) {
    if (lufsEl) lufsEl.textContent = "--";
    if (peakEl) peakEl.textContent = "--";
    if (drEl) drEl.textContent = "--";
    if (badge) {
      badge.textContent = audioMasterState.processing ? "Analyse en cours…" : "Lance le rendu pour analyser";
      badge.className = "audio-master-verdict-badge";
    }
    if (exportBtn) exportBtn.disabled = true;
    return;
  }
  const lufs = analysis.loudnessLufs ?? analysis.loudness_lufs;
  const peak = analysis.peakDbfs ?? analysis.peak_dbfs;
  if (lufsEl) lufsEl.textContent = Number.isFinite(lufs) ? `${lufs.toFixed(1)} LUFS` : "--";
  if (peakEl) peakEl.textContent = Number.isFinite(peak) ? `${peak.toFixed(1)} dBFS` : "--";
  const dr = Number.isFinite(lufs) && Number.isFinite(peak) ? Math.abs(peak - lufs) : null;
  if (drEl) drEl.textContent = dr !== null ? `${dr.toFixed(1)} DR` : "--";

  if (badge) {
    const target = audioMasterState.limiter.targetLufs;
    const ceiling = audioMasterState.limiter.ceiling;
    let cls = "ok";
    let text = "Conforme broadcast";
    if (Number.isFinite(peak) && peak > -0.1) {
      cls = "danger"; text = "Risque de clipping (peak > -0.1 dB)";
    } else if (Number.isFinite(lufs) && lufs < -20) {
      cls = "warn"; text = "Trop calme pour streaming (< -20 LUFS)";
    } else if (Number.isFinite(lufs) && Math.abs(lufs - target) > 2) {
      cls = "soft"; text = `Hors cible (${lufs.toFixed(1)} vs ${target} LUFS)`;
    } else if (Number.isFinite(peak) && peak > ceiling + 0.5) {
      cls = "soft"; text = "Marge serrée — vérifier limiter";
    }
    badge.textContent = text;
    badge.className = `audio-master-verdict-badge ${cls}`;
  }
  if (exportBtn) exportBtn.disabled = false;
}

function renderAudioMixingView() {
  renderAudioMixingStrips();
  updateAudioMixInsights();
}

function ensureAudioMixingPanState() {
  if (!Number.isFinite(audioState.track.pan)) audioState.track.pan = 0;
  if (!Number.isFinite(audioState.masterGainDb)) audioState.masterGainDb = 0;
  (audioState.extraTracks || []).forEach((t) => {
    if (!Number.isFinite(t.pan)) t.pan = 0;
  });
}

function renderAudioMixingStrips() {
  ensureAudioMixingPanState();
  const root = document.getElementById("audio-mixing-strips");
  if (!root) return;
  const primary = {
    id: "primary",
    name: audioState.mediaName || "Piste principale",
    label: "Voix principale",
    color: "#3b82f6",
    gainDb: audioState.track.gainDb || 0,
    pan: audioState.track.pan || 0,
    mute: audioState.track.mute,
    solo: audioState.track.solo,
    primary: true,
  };
  const extras = (audioState.extraTracks || []).map((t) => ({ ...t }));
  const all = [primary, ...extras];

  const strips = all.map((track) => renderAudioMixStrip(track)).join("");
  const master = renderAudioMixMasterStrip();
  root.innerHTML = strips + master;

  // Bindings
  root.querySelectorAll(".audio-mix-strip[data-strip-id]").forEach((stripEl) => {
    const id = stripEl.dataset.stripId;
    stripEl.querySelector(".audio-mix-fader")?.addEventListener("input", (event) => {
      const value = clampNumber(Number(event.target.value), -24, 12);
      updateAudioMixStripField(id, "gainDb", value);
      const label = stripEl.querySelector(".audio-mix-fader-value");
      if (label) label.textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
    });
    stripEl.querySelector(".audio-mix-pan")?.addEventListener("input", (event) => {
      let value = clampNumber(Number(event.target.value), -100, 100);
      if (Math.abs(value) < 5) value = 0;
      event.target.value = value;
      updateAudioMixStripField(id, "pan", value);
      const label = stripEl.querySelector(".audio-mix-pan-value");
      if (label) label.textContent = audioMixPanLabel(value);
    });
    stripEl.querySelector("[data-mix-action='mute']")?.addEventListener("click", () => {
      const next = !audioMixGetField(id, "mute");
      updateAudioMixStripField(id, "mute", next);
      renderAudioMixingStrips();
    });
    stripEl.querySelector("[data-mix-action='solo']")?.addEventListener("click", () => {
      const next = !audioMixGetField(id, "solo");
      updateAudioMixStripField(id, "solo", next);
      renderAudioMixingStrips();
    });
    stripEl.querySelector("[data-mix-action='remove']")?.addEventListener("click", () => {
      removeAudioExtraTrack(id);
      renderAudioMixingStrips();
    });
  });

  const masterEl = root.querySelector(".audio-mix-master");
  if (masterEl) {
    masterEl.querySelector(".audio-mix-fader")?.addEventListener("input", (event) => {
      const value = clampNumber(Number(event.target.value), -24, 6);
      audioState.masterGainDb = value;
      const label = masterEl.querySelector(".audio-mix-fader-value");
      if (label) label.textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
      audioState.fullChainStale = Boolean(audioState.fullChainPath);
      renderAudioApplyFullButton();
    });
    masterEl.querySelector("[data-mix-master-action='goto-mastering']")?.addEventListener("click", () => {
      setAudioStudioTab("master");
    });
  }
}

function renderAudioMixStrip(track) {
  const initial = (track.label || track.name || "?").charAt(0).toUpperCase();
  const safeName = String(track.name || "Piste").replace(/[<>&"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
  }[c]));
  return `
    <div class="audio-mix-strip" data-strip-id="${track.id}" style="--track-color:${track.color}">
      <div class="audio-mix-strip-head">
        <span class="audio-mix-strip-color">${initial}</span>
        <div class="audio-mix-strip-meta">
          <div class="audio-mix-strip-name">${safeName}</div>
          <div class="audio-mix-strip-type">${track.label || ""}</div>
        </div>
        ${track.primary ? "" : '<button type="button" class="audio-mix-strip-remove" data-mix-action="remove" title="Retirer la piste">×</button>'}
      </div>
      <div class="audio-mix-strip-vu">
        <div class="audio-mix-strip-vu-bar"><div class="audio-mix-strip-vu-fill"></div></div>
        <div class="audio-mix-strip-vu-bar"><div class="audio-mix-strip-vu-fill"></div></div>
      </div>
      <div class="audio-mix-strip-pan">
        <label>PAN <strong class="audio-mix-pan-value">${audioMixPanLabel(track.pan)}</strong></label>
        <input type="range" class="audio-mix-pan" min="-100" max="100" step="1" value="${track.pan}" />
      </div>
      <div class="audio-mix-strip-fader">
        <label>Gain</label>
        <input type="range" class="audio-mix-fader" min="-24" max="12" step="0.5" value="${track.gainDb}" orient="vertical" />
        <strong class="audio-mix-fader-value">${track.gainDb > 0 ? "+" : ""}${Number(track.gainDb).toFixed(1)} dB</strong>
      </div>
      <div class="audio-mix-strip-actions">
        <button type="button" class="audio-track-btn${track.mute ? " active" : ""}" data-mix-action="mute" title="Mute">M</button>
        <button type="button" class="audio-track-btn audio-mix-solo${track.solo ? " active" : ""}" data-mix-action="solo" title="Solo">S</button>
      </div>
    </div>
  `;
}

function renderAudioMixMasterStrip() {
  const masterGain = audioState.masterGainDb || 0;
  return `
    <div class="audio-mix-strip audio-mix-master">
      <div class="audio-mix-strip-head">
        <span class="audio-mix-strip-color audio-mix-master-color">M</span>
        <div class="audio-mix-strip-meta">
          <div class="audio-mix-strip-name">MASTER</div>
          <div class="audio-mix-strip-type">Bus principal</div>
        </div>
      </div>
      <div class="audio-mix-strip-vu audio-mix-master-vu">
        <div class="audio-mix-strip-vu-bar"><div class="audio-mix-strip-vu-fill" id="audio-mix-master-vu-l"></div></div>
        <div class="audio-mix-strip-vu-bar"><div class="audio-mix-strip-vu-fill" id="audio-mix-master-vu-r"></div></div>
      </div>
      <div class="audio-mix-master-readout">
        <div><span>LUFS</span><strong id="audio-mix-master-lufs">--</strong></div>
        <div><span>True Peak</span><strong id="audio-mix-master-peak">--</strong></div>
      </div>
      <div class="audio-mix-strip-fader">
        <label>Master gain</label>
        <input type="range" class="audio-mix-fader" min="-24" max="6" step="0.5" value="${masterGain}" />
        <strong class="audio-mix-fader-value">${masterGain > 0 ? "+" : ""}${Number(masterGain).toFixed(1)} dB</strong>
      </div>
      <button type="button" class="audio-mix-master-goto" data-mix-master-action="goto-mastering">Mastering →</button>
    </div>
  `;
}

function audioMixPanLabel(value) {
  const v = Number(value) || 0;
  if (Math.abs(v) < 5) return "Centre";
  if (v < 0) return `L ${Math.abs(v).toFixed(0)}`;
  return `R ${v.toFixed(0)}`;
}

function audioMixGetField(stripId, field) {
  if (stripId === "primary") return audioState.track[field];
  const track = (audioState.extraTracks || []).find((t) => t.id === stripId);
  return track ? track[field] : undefined;
}

function updateAudioMixStripField(stripId, field, value) {
  if (stripId === "primary") {
    audioState.track[field] = value;
    if (field === "gainDb" || field === "mute") applyAudioTrackGainToPlayers();
  } else {
    updateAudioExtraTrack(stripId, { [field]: value });
  }
  audioState.fullChainStale = Boolean(audioState.fullChainPath);
  renderAudioApplyFullButton();
}

function updateAudioMixInsights() {
  const peak = audioState.analysis?.peakDbfs;
  const lufs = audioState.analysis?.loudnessLufs;
  const headroomEl = document.getElementById("audio-mix-headroom");
  const peakEl = document.getElementById("audio-mix-peak");
  const warning = document.getElementById("audio-mix-clip-warning");
  const adviceEl = document.getElementById("audio-mix-advice");
  const widthEl = document.getElementById("audio-mix-width");
  const masterLufs = document.getElementById("audio-mix-master-lufs");
  const masterPeak = document.getElementById("audio-mix-master-peak");

  if (Number.isFinite(peak)) {
    const headroom = -peak;
    if (headroomEl) headroomEl.textContent = `${headroom.toFixed(1)} dB`;
    if (peakEl) peakEl.textContent = `${peak.toFixed(1)} dBFS`;
    if (warning) warning.classList.toggle("hidden", peak < -0.1);
    if (adviceEl) {
      if (peak > -0.5) adviceEl.textContent = `Très peu de marge (${headroom.toFixed(1)} dB). Réduis le master de ${(0.5 - headroom).toFixed(1)} dB.`;
      else if (peak < -12) adviceEl.textContent = `Beaucoup de marge (${headroom.toFixed(1)} dB). Tu peux booster le master de ~6 dB.`;
      else adviceEl.textContent = `Marge confortable (${headroom.toFixed(1)} dB).`;
    }
  } else {
    if (headroomEl) headroomEl.textContent = "-- dB";
    if (peakEl) peakEl.textContent = "--";
    if (warning) warning.classList.add("hidden");
    if (adviceEl) adviceEl.textContent = "Lance \"Appliquer au fichier complet\" pour analyser.";
  }

  if (masterLufs) masterLufs.textContent = Number.isFinite(lufs) ? `${lufs.toFixed(1)}` : "--";
  if (masterPeak) masterPeak.textContent = Number.isFinite(peak) ? `${peak.toFixed(1)}` : "--";

  const extras = audioState.extraTracks || [];
  if (extras.length === 0) {
    if (widthEl) widthEl.textContent = "100% (mono mix)";
  } else {
    if (widthEl) widthEl.textContent = `${100 + extras.length * 5}% estimée`;
  }

  const fill = document.getElementById("audio-mix-balance-fill");
  if (fill) {
    const tracks = [audioState.track, ...extras];
    const avgPan = tracks.reduce((s, t) => s + (Number(t.pan) || 0), 0) / Math.max(1, tracks.length);
    const widthPct = Math.min(80, Math.abs(avgPan) + 20);
    fill.style.width = `${widthPct}%`;
    fill.style.left = avgPan < 0 ? `${50 - widthPct / 2}%` : `${50 - widthPct / 2 + avgPan / 100 * widthPct / 2}%`;
  }
}

function audioMasterExportFinal() {
  if (!audioMasterState.finalPath) return;
  // Reuse the existing export modal but point its source to the master file.
  audioState.fullChainPath = audioMasterState.finalPath;
  audioState.resultPath = audioMasterState.finalPath;
  audioState.resultIsPreview = false;
  audioState.currentPreset = "master";
  audioUpdateUI();
  openAudioExportModal();
}

function formatMasterDb(value) {
  const v = Number(value);
  if (Math.abs(v) < 0.05) return "0 dB";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
}

// ============================================
// CHANTIER E — Recording studio
// ============================================
const audioRecordState = {
  view: "hidden",
  devices: [],
  deviceId: null,
  format: "24/48000",
  digitalGain: 1.0,
  monitor: true,
  stream: null,
  recorder: null,
  recorderMime: "audio/webm",
  chunks: [],
  startTime: 0,
  pausedTime: 0,
  isRecording: false,
  isPaused: false,
  audioCtx: null,
  sourceNode: null,
  gainNode: null,
  monitorNode: null,
  analyserNode: null,
  splitterNode: null,
  lAnalyser: null,
  rAnalyser: null,
  rafId: null,
  timerId: null,
  peakL: 0,
  peakR: 0,
  peakHoldL: 0,
  peakHoldR: 0,
  peakHoldTimerL: 0,
  peakHoldTimerR: 0,
  scrollCanvas: null,
  scrollCtx: null,
  scrollX: 0,
  loudnessHistory: [],
  savedBlob: null,
  savedWebmPath: null,
  savedDurationMs: 0,
  savedSizeBytes: 0,
};

function showAudioRecordingView() {
  // Tear down any active wavesurfer instances — their hidden parent triggers
  // RangeError loops in renderMultiCanvas while we're on the recording view.
  destroyAudioPlayer("original");
  destroyAudioPlayer("result");
  document.getElementById("audio-empty")?.classList.add("hidden");
  document.getElementById("audio-workspace")?.classList.add("hidden");
  document.getElementById("audio-recording-view")?.classList.remove("hidden");
  audioRecordState.view = "recording";
  audioPopulateDevices().catch((err) => console.warn("[record] devices enum failed:", err));
}

function hideAudioRecordingView() {
  audioRecordingStop({ silent: true }).catch(() => {});
  audioRecordingTeardownStream();
  document.getElementById("audio-recording-view")?.classList.add("hidden");
  document.getElementById("audio-empty")?.classList.remove("hidden");
  audioRecordState.view = "hidden";
}

async function audioPopulateDevices() {
  const select = document.getElementById("audio-record-device-select");
  if (!select) return;
  try {
    // Trigger getUserMedia once so device labels become visible (browser policy).
    if (!audioRecordState.permissionPrimed) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        audioRecordState.permissionPrimed = true;
      } catch (err) {
        console.warn("[record] permission probe failed:", err);
      }
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    audioRecordState.devices = inputs;
    if (!inputs.length) {
      select.innerHTML = `<option value="">Aucune entrée détectée</option>`;
      select.disabled = true;
      const recBtn = document.getElementById("audio-record-rec");
      if (recBtn) recBtn.disabled = true;
      return;
    }
    select.disabled = false;
    const preferred = inputs.find((d) => /volt|universal audio|at2020|focusrite|scarlett/i.test(d.label));
    const previous = audioRecordState.deviceId;
    const chosen = previous && inputs.find((d) => d.deviceId === previous)
      ? previous
      : (preferred?.deviceId || inputs[0].deviceId);
    audioRecordState.deviceId = chosen;
    select.innerHTML = inputs.map((d) => {
      const label = d.label || `Entrée ${d.deviceId.slice(0, 8)}`;
      return `<option value="${d.deviceId}"${d.deviceId === chosen ? " selected" : ""}>${label}</option>`;
    }).join("");
    const recBtn = document.getElementById("audio-record-rec");
    if (recBtn) recBtn.disabled = false;
  } catch (err) {
    console.error("[record] enumerateDevices failed:", err);
    select.innerHTML = `<option value="">Erreur d'énumération</option>`;
    select.disabled = true;
  }
}

function audioRecordingPickRecorderMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

async function audioRecordingStart() {
  if (audioRecordState.isRecording) return;
  const permissionMsg = document.getElementById("audio-record-permission");
  permissionMsg?.classList.add("hidden");

  const [bitDepthRaw, sampleRateRaw] = (audioRecordState.format || "24/48000").split("/");
  const sampleRate = Number(sampleRateRaw) || 48000;
  const deviceId = audioRecordState.deviceId;
  if (!deviceId) {
    showToast("Choisis une entrée audio", 2200);
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { ideal: 2 },
        sampleRate: { ideal: sampleRate },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    console.error("[record] getUserMedia failed:", err);
    permissionMsg?.classList.remove("hidden");
    showToast("Permission micro refusée — autorise dans Windows", 4500);
    return;
  }

  audioRecordState.stream = stream;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  audioRecordState.audioCtx = ctx;
  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = audioRecordState.digitalGain;
  const splitter = ctx.createChannelSplitter(2);
  const lAnalyser = ctx.createAnalyser();
  const rAnalyser = ctx.createAnalyser();
  lAnalyser.fftSize = 2048;
  rAnalyser.fftSize = 2048;
  // Heavy smoothing — eliminates 60 fps jitter on the VU bars during REC.
  lAnalyser.smoothingTimeConstant = 0.85;
  rAnalyser.smoothingTimeConstant = 0.85;
  const monitor = ctx.createGain();
  monitor.gain.value = audioRecordState.monitor ? 0.6 : 0;

  source.connect(gain);
  gain.connect(splitter);
  splitter.connect(lAnalyser, 0);
  splitter.connect(rAnalyser, 1);
  gain.connect(monitor);
  monitor.connect(ctx.destination);

  audioRecordState.sourceNode = source;
  audioRecordState.gainNode = gain;
  audioRecordState.splitterNode = splitter;
  audioRecordState.lAnalyser = lAnalyser;
  audioRecordState.rAnalyser = rAnalyser;
  audioRecordState.monitorNode = monitor;

  // MediaRecorder takes the gain-processed stream so the gain slider audibly applies.
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);

  const mime = audioRecordingPickRecorderMime();
  audioRecordState.recorderMime = mime || "audio/webm";
  let recorder;
  try {
    recorder = mime
      ? new MediaRecorder(dest.stream, { mimeType: mime })
      : new MediaRecorder(dest.stream);
  } catch (err) {
    console.error("[record] MediaRecorder init failed:", err);
    showToast("MediaRecorder indisponible : " + err.message, 4500);
    audioRecordingTeardownStream();
    return;
  }

  audioRecordState.recorder = recorder;
  audioRecordState.chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) audioRecordState.chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    console.error("[record] MediaRecorder error:", event.error);
    showToast("Erreur d'enregistrement : " + (event.error?.message || event.error), 4500);
  };
  recorder.onstop = audioRecordingHandleStop;

  recorder.start(250);
  audioRecordState.isRecording = true;
  audioRecordState.startTime = performance.now();
  audioRecordState.pausedTime = 0;
  audioRecordState.peakL = 0;
  audioRecordState.peakR = 0;
  audioRecordState.peakHoldL = 0;
  audioRecordState.peakHoldR = 0;
  audioRecordState.scrollX = 0;
  audioRecordState.loudnessHistory = [];

  updateAudioRecordingButtons();
  document.getElementById("audio-record-state").innerHTML = `<span class="audio-record-badge rec">● ENREGISTREMENT</span>`;
  audioRecordingTickTimer();
  audioRecordingTick();
  if (audioRecordState.scrollCanvas) audioRecordingScrollReset();
}

async function audioRecordingStop(opts = {}) {
  if (!audioRecordState.isRecording) return;
  return new Promise((resolve) => {
    const recorder = audioRecordState.recorder;
    if (!recorder) {
      audioRecordState.isRecording = false;
      resolve();
      return;
    }
    const finalize = () => {
      audioRecordState.isRecording = false;
      audioRecordState.isPaused = false;
      if (audioRecordState.rafId) {
        cancelAnimationFrame(audioRecordState.rafId);
        audioRecordState.rafId = null;
      }
      if (audioRecordState.timerId) {
        clearInterval(audioRecordState.timerId);
        audioRecordState.timerId = null;
      }
      updateAudioRecordingButtons();
      if (!opts.silent) document.getElementById("audio-record-state").innerHTML = "";
      audioRecordingTeardownStream();
      resolve();
    };
    recorder.onstop = () => {
      audioRecordingHandleStop().finally(finalize);
    };
    try { recorder.stop(); } catch (_) { finalize(); }
  });
}

async function audioRecordingHandleStop() {
  if (!audioRecordState.chunks.length) return;
  const mime = audioRecordState.recorderMime || "audio/webm";
  const blob = new Blob(audioRecordState.chunks, { type: mime });
  audioRecordState.savedBlob = blob;
  audioRecordState.savedDurationMs = performance.now() - audioRecordState.startTime;
  audioRecordState.savedSizeBytes = blob.size;

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = audioRecordingArrayBufferToBase64(arrayBuffer);
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
    const filename = `recording_${Date.now()}.${ext}`;
    const result = await invoke("audio_save_recording_blob", { filename, bytesBase64: base64 });
    audioRecordState.savedWebmPath = result.path;
    openAudioRecordingDoneModal();
  } catch (err) {
    console.error("[record] save blob failed:", err);
    showToast("Erreur sauvegarde : " + (err.message || err), 5000);
  }
}

function audioRecordingArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function audioRecordingTeardownStream() {
  if (audioRecordState.stream) {
    audioRecordState.stream.getTracks().forEach((t) => t.stop());
    audioRecordState.stream = null;
  }
  try {
    audioRecordState.sourceNode?.disconnect();
    audioRecordState.gainNode?.disconnect();
    audioRecordState.splitterNode?.disconnect();
    audioRecordState.lAnalyser?.disconnect();
    audioRecordState.rAnalyser?.disconnect();
    audioRecordState.monitorNode?.disconnect();
  } catch (_) { /* ignore */ }
  if (audioRecordState.audioCtx && audioRecordState.audioCtx.state !== "closed") {
    audioRecordState.audioCtx.close().catch(() => {});
  }
  audioRecordState.audioCtx = null;
  audioRecordState.sourceNode = null;
  audioRecordState.gainNode = null;
  audioRecordState.splitterNode = null;
  audioRecordState.lAnalyser = null;
  audioRecordState.rAnalyser = null;
  audioRecordState.monitorNode = null;
  audioRecordState.recorder = null;
  audioRecordState.chunks = [];
}

function audioRecordingTick(timestamp) {
  if (!audioRecordState.lAnalyser || !audioRecordState.rAnalyser) return;

  // Throttle to ~30 fps to avoid VU jitter on raw 60 fps reads.
  const lastTick = audioRecordState.lastTickAt || 0;
  if (timestamp && timestamp - lastTick < 33) {
    audioRecordState.rafId = requestAnimationFrame(audioRecordingTick);
    return;
  }
  audioRecordState.lastTickAt = timestamp || performance.now();

  const fft = audioRecordState.lAnalyser.fftSize;
  const bufL = new Uint8Array(fft);
  const bufR = new Uint8Array(fft);
  audioRecordState.lAnalyser.getByteTimeDomainData(bufL);
  audioRecordState.rAnalyser.getByteTimeDomainData(bufR);

  let peakL = 0; let rmsLSum = 0;
  let peakR = 0; let rmsRSum = 0;
  for (let i = 0; i < fft; i++) {
    const l = (bufL[i] - 128) / 128;
    const r = (bufR[i] - 128) / 128;
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > peakL) peakL = al;
    if (ar > peakR) peakR = ar;
    rmsLSum += l * l;
    rmsRSum += r * r;
  }
  const rmsL = Math.sqrt(rmsLSum / fft);
  const rmsR = Math.sqrt(rmsRSum / fft);

  // Frame-to-frame interpolation eliminates remaining flicker.
  audioRecordState.peakL = peakL > audioRecordState.peakL
    ? audioRecordState.peakL * 0.4 + peakL * 0.6
    : audioRecordState.peakL * 0.78 + peakL * 0.22;
  audioRecordState.peakR = peakR > audioRecordState.peakR
    ? audioRecordState.peakR * 0.4 + peakR * 0.6
    : audioRecordState.peakR * 0.78 + peakR * 0.22;

  // Peak markers — gradual descent (~0.6 dB/frame ≈ 18 dB/s) rather than abrupt fall.
  if (peakL >= audioRecordState.peakHoldL) {
    audioRecordState.peakHoldL = peakL;
  } else {
    audioRecordState.peakHoldL = Math.max(0, audioRecordState.peakHoldL - 0.006);
  }
  if (peakR >= audioRecordState.peakHoldR) {
    audioRecordState.peakHoldR = peakR;
  } else {
    audioRecordState.peakHoldR = Math.max(0, audioRecordState.peakHoldR - 0.006);
  }

  const peakLdb = peakL > 0 ? 20 * Math.log10(peakL) : -Infinity;
  const peakRdb = peakR > 0 ? 20 * Math.log10(peakR) : -Infinity;
  const rmsLdb = rmsL > 0 ? 20 * Math.log10(rmsL) : -Infinity;
  const rmsRdb = rmsR > 0 ? 20 * Math.log10(rmsR) : -Infinity;

  audioRecordRenderVu();
  audioRecordRenderReadout(peakLdb, peakRdb, rmsLdb, rmsRdb);
  audioRecordPushLoudness(rmsL, rmsR);
  audioRecordingScrollPush(audioRecordState.peakL, audioRecordState.peakR);

  audioRecordState.rafId = requestAnimationFrame(audioRecordingTick);
}

function audioRecordRenderVu() {
  const lFill = document.getElementById("audio-record-vu-l-fill");
  const rFill = document.getElementById("audio-record-vu-r-fill");
  const lPeak = document.getElementById("audio-record-vu-l-peak");
  const rPeak = document.getElementById("audio-record-vu-r-peak");
  const lClip = document.getElementById("audio-record-vu-l-clip");
  const rClip = document.getElementById("audio-record-vu-r-clip");
  // transform scaleY is GPU-accelerated — no reflow, smoother than height updates.
  if (lFill) {
    lFill.style.transform = `scaleY(${audioRecordState.peakL.toFixed(3)})`;
    const cls = audioRecordLevelClass(audioRecordState.peakL);
    if (lFill.dataset.lvl !== cls) {
      lFill.dataset.lvl = cls;
      lFill.className = `audio-recording-vu-fill ${cls}`;
    }
  }
  if (rFill) {
    rFill.style.transform = `scaleY(${audioRecordState.peakR.toFixed(3)})`;
    const cls = audioRecordLevelClass(audioRecordState.peakR);
    if (rFill.dataset.lvl !== cls) {
      rFill.dataset.lvl = cls;
      rFill.className = `audio-recording-vu-fill ${cls}`;
    }
  }
  if (lPeak) lPeak.style.bottom = `${(audioRecordState.peakHoldL * 100).toFixed(1)}%`;
  if (rPeak) rPeak.style.bottom = `${(audioRecordState.peakHoldR * 100).toFixed(1)}%`;
  if (lClip) lClip.classList.toggle("active", audioRecordState.peakHoldL >= 0.99);
  if (rClip) rClip.classList.toggle("active", audioRecordState.peakHoldR >= 0.99);
}

function audioRecordLevelClass(value) {
  // value linear 0..1 — clipping at 0 dBFS means 1.0
  const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
  if (db >= -0.1) return "level-clip";
  if (db >= -6) return "level-red";
  if (db >= -18) return "level-yellow";
  return "level-green";
}

function audioRecordRenderReadout(peakL, peakR, rmsL, rmsR) {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = Number.isFinite(value) ? `${value.toFixed(1)} dB` : "-∞";
  };
  setText("audio-record-peak-l", peakL);
  setText("audio-record-peak-r", peakR);
  setText("audio-record-rms-l", rmsL);
  setText("audio-record-rms-r", rmsR);
}

function audioRecordPushLoudness(rmsL, rmsR) {
  // Quick LUFS short-term approximation (3s window) — not ITU but useful indicator.
  const now = performance.now();
  const combined = (rmsL + rmsR) / 2;
  audioRecordState.loudnessHistory.push({ t: now, value: combined });
  while (audioRecordState.loudnessHistory.length && now - audioRecordState.loudnessHistory[0].t > 3000) {
    audioRecordState.loudnessHistory.shift();
  }
  const avg = audioRecordState.loudnessHistory.reduce((s, p) => s + p.value, 0)
    / Math.max(1, audioRecordState.loudnessHistory.length);
  const lufsApprox = avg > 0 ? 20 * Math.log10(avg) - 0.691 : -Infinity;
  const el = document.getElementById("audio-record-lufs");
  if (el) el.textContent = Number.isFinite(lufsApprox) ? `${lufsApprox.toFixed(1)} LUFS` : "--";
}

function audioRecordingScrollReset() {
  const canvas = document.getElementById("audio-record-scroll");
  if (!canvas) return;
  audioRecordState.scrollCanvas = canvas;
  audioRecordState.scrollCtx = canvas.getContext("2d");
  audioRecordState.scrollCtx.clearRect(0, 0, canvas.width, canvas.height);
  audioRecordState.scrollX = 0;
}

function audioRecordingScrollPush(peakL, peakR) {
  const canvas = audioRecordState.scrollCanvas;
  const ctx = audioRecordState.scrollCtx;
  if (!canvas || !ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  // Hard guard: getImageData throws IndexSizeError/RangeError on zero/negative
  // sizes. Skip the frame if the canvas hasn't been laid out yet.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 4 || height < 4) return;
  try {
    const imageData = ctx.getImageData(2, 0, width - 2, height);
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(imageData, 0, 0);
    const x = width - 2;
    const center = height / 2;
    const peak = Math.max(peakL, peakR);
    const halfHeight = peak * center;
    ctx.fillStyle = peak > 0.95 ? "#ef4444" : peak > 0.6 ? "#facc15" : "#22c55e";
    ctx.fillRect(x, center - halfHeight, 2, halfHeight * 2);
  } catch (err) {
    // Don't crash the REC loop if the canvas state is transiently invalid.
    console.warn("[record] scroll frame skipped:", err);
  }
}

function audioRecordingTickTimer() {
  const timerEl = document.getElementById("audio-record-timer");
  audioRecordState.timerId = window.setInterval(() => {
    const elapsed = (performance.now() - audioRecordState.startTime) - audioRecordState.pausedTime;
    if (timerEl) timerEl.textContent = audioRecordingFormatTimer(elapsed);
  }, 33);
}

function audioRecordingFormatTimer(elapsedMs) {
  const totalCs = Math.max(0, Math.floor(elapsedMs / 10));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  return `${String(hours).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function updateAudioRecordingButtons() {
  const rec = document.getElementById("audio-record-rec");
  const stop = document.getElementById("audio-record-stop");
  if (rec) {
    rec.disabled = audioRecordState.isRecording || !audioRecordState.deviceId;
    rec.classList.toggle("recording", audioRecordState.isRecording);
  }
  if (stop) stop.disabled = !audioRecordState.isRecording;
}

function openAudioRecordingDoneModal() {
  const modal = document.getElementById("audio-recording-done-modal");
  if (!modal) return;
  const [bitDepth, sampleRate] = audioRecordState.format.split("/");
  document.getElementById("audio-recording-done-duration").textContent =
    audioRecordingFormatTimer(audioRecordState.savedDurationMs);
  document.getElementById("audio-recording-done-size").textContent =
    `${(audioRecordState.savedSizeBytes / 1_048_576).toFixed(2)} Mo`;
  document.getElementById("audio-recording-done-format").textContent =
    `WAV ${bitDepth}-bit · ${(Number(sampleRate) / 1000).toFixed(1)} kHz`;
  const nameInput = document.getElementById("audio-recording-done-name");
  if (nameInput) {
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    nameInput.value = `Enregistrement_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  }
  const folderInput = document.getElementById("audio-recording-done-folder");
  if (folderInput) {
    const userProfile = (typeof process !== "undefined" && process?.env?.USERPROFILE) || "";
    folderInput.value = userProfile ? `${userProfile}\\Music\\LoadLink-Audio` : "Music/LoadLink-Audio";
  }
  const audio = document.getElementById("audio-recording-done-audio");
  if (audio && audioRecordState.savedBlob) {
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(audioRecordState.savedBlob);
  }
  modal.classList.remove("hidden");
}

function closeAudioRecordingDoneModal() {
  document.getElementById("audio-recording-done-modal")?.classList.add("hidden");
}

async function audioRecordingFinalize(action) {
  const nameInput = document.getElementById("audio-recording-done-name");
  const folderInput = document.getElementById("audio-recording-done-folder");
  if (!audioRecordState.savedWebmPath) {
    showToast("Aucun enregistrement à finaliser", 2500);
    return;
  }
  const [bitDepthRaw, sampleRateRaw] = audioRecordState.format.split("/");
  const bitDepth = Number(bitDepthRaw) || 24;
  const sampleRate = Number(sampleRateRaw) || 48000;
  const outputDir = folderInput?.value || "";
  const outputName = (nameInput?.value || "Enregistrement").trim();

  try {
    showToast("Conversion en WAV…", 2000);
    const result = await invoke("audio_convert_recording", {
      input: audioRecordState.savedWebmPath,
      outputDir,
      outputName,
      sampleRate,
      bitDepth,
    });
    if (!result || result.success === false) {
      throw new Error((result && result.error) || "Conversion échouée");
    }
    const wavPath = result.outputPath || result.output_path;
    invoke("audio_discard_pending_recording", { path: audioRecordState.savedWebmPath }).catch(() => {});
    audioRecordState.savedWebmPath = null;
    closeAudioRecordingDoneModal();
    if (action === "load") {
      hideAudioRecordingView();
      loadAudioFile(wavPath);
    } else {
      showToast(`Enregistré dans ${wavPath}`, 3500);
      revealAudioOutput(wavPath).catch(() => {});
    }
  } catch (err) {
    console.error("[record] finalize failed:", err);
    showToast("Conversion échouée : " + (err.message || err), 5000);
  }
}

async function audioRecordingDiscard() {
  closeAudioRecordingDoneModal();
  if (audioRecordState.savedWebmPath) {
    invoke("audio_discard_pending_recording", { path: audioRecordState.savedWebmPath }).catch(() => {});
  }
  audioRecordState.savedWebmPath = null;
  audioRecordState.savedBlob = null;
}

async function audioRecordingDelete() {
  const ok = await audioConfirm("Supprimer définitivement cet enregistrement ? Le fichier temporaire sera effacé et ne pourra plus être récupéré.", {
    title: "Supprimer l'enregistrement",
    confirmLabel: "Supprimer",
  });
  if (!ok) return;
  if (audioRecordState.savedWebmPath) {
    try {
      await invoke("audio_discard_pending_recording", { path: audioRecordState.savedWebmPath });
    } catch (err) {
      console.warn("[record] delete failed:", err);
    }
  }
  audioRecordState.savedWebmPath = null;
  audioRecordState.savedBlob = null;
  closeAudioRecordingDoneModal();
  showToast("Enregistrement supprimé", 1800);
}

async function audioRecordingChooseFolder() {
  try {
    const tauriOpen =
      (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open)
      || (typeof open === "function" ? open : null);
    if (!tauriOpen) return;
    const selected = await tauriOpen({ directory: true, multiple: false });
    if (!selected) return;
    const dir = Array.isArray(selected) ? selected[0] : selected;
    const folderInput = document.getElementById("audio-recording-done-folder");
    if (folderInput) folderInput.value = dir;
  } catch (err) {
    console.warn("[record] folder pick failed:", err);
  }
}

async function audioRecordingCheckCrashRecovery() {
  try {
    const pending = await invoke("audio_list_pending_recordings");
    if (!Array.isArray(pending) || !pending.length) return;
    const recover = document.getElementById("audio-recording-recover");
    const text = document.getElementById("audio-recording-recover-text");
    if (!recover || !text) return;
    const first = pending[0];
    const sizeMo = (first.sizeBytes / 1_048_576).toFixed(2);
    text.textContent = `Un enregistrement non sauvegardé (${sizeMo} Mo) a été retrouvé. Veux-tu le récupérer ?`;
    recover.classList.remove("hidden");
    const loadBtn = document.getElementById("audio-recording-recover-load");
    const discardBtn = document.getElementById("audio-recording-recover-discard");
    const onLoad = () => {
      recover.classList.add("hidden");
      audioRecordState.savedWebmPath = first.path;
      audioRecordState.savedSizeBytes = first.sizeBytes;
      audioRecordState.savedDurationMs = 0;
      openAudioRecordingDoneModal();
    };
    const onDiscard = () => {
      recover.classList.add("hidden");
      invoke("audio_discard_pending_recording", { path: first.path }).catch(() => {});
    };
    loadBtn.addEventListener("click", onLoad, { once: true });
    discardBtn.addEventListener("click", onDiscard, { once: true });
  } catch (err) {
    console.warn("[record] crash recovery check failed:", err);
  }
}

const AUDIO_TRACK_TYPES = [
  { key: "voice", label: "Voix", color: "#3b82f6", hints: ["voix", "voice", "voc", "podcast", "interview"] },
  { key: "music", label: "Musique", color: "#a855f7", hints: ["music", "track", "song", "ost"] },
  { key: "ambient", label: "Ambiance", color: "#10b981", hints: ["ambient", "ambiance", "room", "noise", "background"] },
  { key: "fx", label: "Effets", color: "#f97316", hints: ["fx", "effect", "whoosh", "impact", "sfx"] },
];

function detectAudioTrackType(path) {
  const lower = String(path).toLowerCase();
  for (const t of AUDIO_TRACK_TYPES) {
    if (t.hints.some((hint) => lower.includes(hint))) return t;
  }
  return AUDIO_TRACK_TYPES[1];
}

async function addAudioExtraTrack() {
  try {
    const tauriOpen =
      (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open)
      || (typeof open === "function" ? open : null);
    if (!tauriOpen) {
      showToast("Dialogue Tauri non disponible", 3000);
      return;
    }
    const selected = await tauriOpen({
      multiple: false,
      filters: [{ name: "Fichiers audio", extensions: AUDIO_SUPPORTED_EXTENSIONS }],
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!isSupportedAudioPath(path)) {
      showToast("Format non supporté", 2500);
      return;
    }
    const type = detectAudioTrackType(path);
    audioState.extraTracks.push({
      id: `track-${Date.now()}`,
      path,
      name: getPathName(path).replace(/\.[^.]+$/, ""),
      type: type.key,
      color: type.color,
      label: type.label,
      gainDb: 0,
      mute: false,
      solo: false,
    });
    renderAudioExtraTracks();
    showToast(`Piste "${type.label}" ajoutée`, 1800);
    audioState.fullChainStale = Boolean(audioState.fullChainPath);
    renderAudioApplyFullButton();
  } catch (err) {
    console.error("[audio] add extra track failed:", err);
    showToast("Erreur ajout piste : " + err, 3500);
  }
}

function removeAudioExtraTrack(id) {
  audioState.extraTracks = audioState.extraTracks.filter((t) => t.id !== id);
  renderAudioExtraTracks();
  audioState.fullChainStale = Boolean(audioState.fullChainPath);
  renderAudioApplyFullButton();
}

function updateAudioExtraTrack(id, updates) {
  const track = audioState.extraTracks.find((t) => t.id === id);
  if (!track) return;
  Object.assign(track, updates);
  audioState.fullChainStale = Boolean(audioState.fullChainPath);
  renderAudioApplyFullButton();
}

function renderAudioExtraTracks() {
  const extraList = document.getElementById("audio-extra-tracks-list");
  if (!extraList) return;

  const tracks = Array.isArray(audioState.extraTracks) ? audioState.extraTracks : [];
  extraList.innerHTML = tracks.map((track) => {
    const safeName = String(track.name || "Piste").replace(/[<>&"]/g, (c) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
    }[c]));
    const initial = (track.label || track.name || "?").charAt(0).toUpperCase();
    return `
      <div class="audio-extra-track-card" data-track-id="${track.id}" style="--track-color:${track.color}">
        <div class="audio-extra-track-head">
          <span class="audio-extra-track-color">${initial}</span>
          <div class="audio-extra-track-meta">
            <div class="audio-extra-track-name" title="${String(track.path || "").replace(/"/g, "&quot;")}">${safeName}</div>
            <div class="audio-extra-track-type">${track.label || ""}</div>
          </div>
          <button type="button" class="audio-extra-track-remove" data-action="remove" title="Retirer">×</button>
        </div>
        <div class="audio-extra-track-ctrls">
          <button type="button" class="audio-track-btn${track.mute ? " active" : ""}" data-action="mute">M</button>
          <button type="button" class="audio-track-btn${track.solo ? " active" : ""}" data-action="solo">S</button>
          <label class="audio-extra-track-gain-wrap">
            <span>Gain</span>
            <input type="range" min="-24" max="12" step="0.5" value="${track.gainDb}" data-action="gain" />
            <strong>${track.gainDb > 0 ? "+" : ""}${Number(track.gainDb).toFixed(1)} dB</strong>
          </label>
        </div>
      </div>
    `;
  }).join("");

  extraList.querySelectorAll(".audio-extra-track-card").forEach((card) => {
    const id = card.dataset.trackId;
    card.querySelector("[data-action=remove]")?.addEventListener("click", () => removeAudioExtraTrack(id));
    card.querySelector("[data-action=mute]")?.addEventListener("click", (event) => {
      const track = audioState.extraTracks.find((t) => t.id === id);
      if (!track) return;
      track.mute = !track.mute;
      event.currentTarget.classList.toggle("active", track.mute);
      updateAudioExtraTrack(id, { mute: track.mute });
    });
    card.querySelector("[data-action=solo]")?.addEventListener("click", (event) => {
      const track = audioState.extraTracks.find((t) => t.id === id);
      if (!track) return;
      track.solo = !track.solo;
      event.currentTarget.classList.toggle("active", track.solo);
      updateAudioExtraTrack(id, { solo: track.solo });
    });
    const gainInput = card.querySelector("[data-action=gain]");
    const gainLabel = card.querySelector(".audio-extra-track-gain-wrap strong");
    gainInput?.addEventListener("input", () => {
      const value = clampNumber(Number(gainInput.value), -24, 12);
      updateAudioExtraTrack(id, { gainDb: value });
      if (gainLabel) gainLabel.textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
    });
  });
}

function applyAudioTrackGainToPlayers() {
  // HTMLMediaElement.volume is clamped to [0, 1]; gains > 0 dB (= linear > 1.0) are
  // routed to the ffmpeg pass instead. Playback stays at 1.0 max — boosts are
  // audible after "Appliquer au fichier complet" / "Exporter".
  const rawLinear = audioState.track.mute ? 0 : Math.pow(10, audioState.track.gainDb / 20);
  const playbackLinear = clampNumber(rawLinear, 0, 1);
  ["original", "result"].forEach((source) => {
    const player = getAudioPlayer(source);
    try {
      if (player.wave && typeof player.wave.setVolume === "function") {
        player.wave.setVolume(playbackLinear);
      }
      if (player.fallback) player.fallback.volume = playbackLinear;
    } catch (err) {
      console.warn("[audio] setVolume failed:", err);
    }
  });
}

function bindAudioKeyboardShortcuts(appState) {
  document.addEventListener("keydown", (event) => {
    if (!appState || appState.currentModule !== "audio") return;
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key === "z" && !event.shiftKey) {
      event.preventDefault();
      audioUndo();
    } else if ((event.key === "z" && event.shiftKey) || event.key === "y") {
      event.preventDefault();
      audioRedo();
    }
  });
}

function bindAudioTimelineTools() {
  const originalWrap = document.getElementById("audio-waveform-original");
  if (originalWrap) {
    originalWrap.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const wave = audioOriginalWave;
      if (!wave || typeof wave.zoom !== "function") return;
      const current = Number(wave.options?.minPxPerSec) || 0;
      const next = clampNumber(current + (event.deltaY > 0 ? -20 : 20), 0, 500);
      try { wave.zoom(next); } catch (err) { console.warn("[audio] zoom failed:", err); }
    }, { passive: false });

    originalWrap.addEventListener("click", (event) => {
      if (!event.shiftKey) return;
      const rect = originalWrap.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = (event.clientX - rect.left) / rect.width;
      const duration = audioState.mediaDuration || 0;
      if (!duration) return;
      const time = clampNumber(ratio * duration, 0, duration);
      audioState.markers = Array.isArray(audioState.markers) ? audioState.markers : [];
      audioState.markers.push(time);
      renderAudioMarkers();
      showToast(`Marqueur ajouté à ${formatAudioTime(time)}`, 1500);
    });
  }
}

function renderAudioMarkers() {
  const container = document.getElementById("audio-waveform-original");
  if (!container) return;
  container.querySelectorAll(".audio-marker").forEach((el) => el.remove());
  const duration = audioState.mediaDuration || 0;
  if (!duration) return;
  (audioState.markers || []).forEach((time, index) => {
    const marker = document.createElement("div");
    marker.className = "audio-marker";
    marker.style.left = `${(time / duration) * 100}%`;
    marker.title = `Marqueur ${index + 1} · ${formatAudioTime(time)}`;
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      seekAudioSource("original", time);
    });
    marker.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      audioState.markers.splice(index, 1);
      renderAudioMarkers();
    });
    container.appendChild(marker);
  });
}

function openAudioHelpModal() {
  document.getElementById("audio-help-modal")?.classList.remove("hidden");
}

function audioConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("audio-confirm-modal");
    const titleEl = document.getElementById("audio-confirm-title");
    const messageEl = document.getElementById("audio-confirm-message");
    const okBtn = document.getElementById("audio-confirm-ok");
    const cancelBtn = document.getElementById("audio-confirm-cancel");
    if (!modal || !okBtn || !cancelBtn) {
      resolve(true);
      return;
    }
    if (titleEl) titleEl.textContent = options.title || "Confirmer";
    if (messageEl) messageEl.textContent = message || "Continuer ?";
    if (okBtn) okBtn.textContent = options.confirmLabel || "Continuer";
    if (cancelBtn) cancelBtn.textContent = options.cancelLabel || "Annuler";

    const cleanup = (result) => {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      modal.classList.add("hidden");
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (event) => { if (event.target === modal) cleanup(false); };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); cleanup(false); }
      if (event.key === "Enter") { event.preventDefault(); cleanup(true); }
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    modal.classList.remove("hidden");
    setTimeout(() => okBtn.focus(), 30);
  });
}

function closeAudioHelpModal() {
  document.getElementById("audio-help-modal")?.classList.add("hidden");
}

async function pickAudioFile() {
  try {
    const tauriOpen =
      (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open)
      || (typeof open === "function" ? open : null);
    if (!tauriOpen) {
      showToast("Dialogue Tauri non disponible", 3000);
      return;
    }
    const selected = await tauriOpen({
      multiple: false,
      filters: [{
        name: "Fichiers audio",
        extensions: AUDIO_SUPPORTED_EXTENSIONS,
      }],
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    loadAudioFile(path);
  } catch (err) {
    console.error("[audio] file picker error:", err);
    showToast("Erreur : " + err, 3000);
  }
}

async function bindAudioNativeDragDrop(appState) {
  try {
    const wv =
      (window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrentWebview)
        ? window.__TAURI__.webview.getCurrentWebview()
        : null;
    if (wv && typeof wv.onDragDropEvent === "function") {
      await wv.onDragDropEvent((event) => {
        if (!appState || appState.currentModule !== "audio") return;
        const payload = event.payload;
        if (!payload) return;
        const audioContent = document.querySelector(".audio-content");
        const importCard = document.getElementById("audio-import-card");

        if (payload.type === "enter" || payload.type === "over") {
          audioContent?.classList.add("drag-over");
          importCard?.classList.add("drag-over");
          return;
        }
        if (payload.type === "leave") {
          audioContent?.classList.remove("drag-over");
          importCard?.classList.remove("drag-over");
          return;
        }
        if (payload.type === "drop") {
          audioContent?.classList.remove("drag-over");
          importCard?.classList.remove("drag-over");
          const paths = Array.isArray(payload.paths) ? payload.paths : [];
          if (paths.length === 0) {
            showToast("Aucun fichier détecté", 2500);
            return;
          }
          if (paths.length > 1) {
            showToast("Drag un seul fichier audio a la fois", 3000);
            return;
          }
          loadAudioFile(paths[0]);
        }
      });
    } else {
      console.warn("[audio] Tauri webview.getCurrentWebview indisponible, drag&drop desactive");
    }
  } catch (err) {
    console.error("[audio] onDragDropEvent setup failed:", err);
  }
}

function loadAudioFile(path) {
  if (!path || typeof path !== "string") return;
  if (audioState.processing) {
    showToast("Un traitement audio est deja en cours", 2800);
    return;
  }
  if (!isSupportedAudioPath(path)) {
    showToast("Format non supporté", 2800);
    return;
  }

  destroyAudioPlayer("original");
  destroyAudioPlayer("result");
  audioState.mediaPath = path;
  audioState.mediaName = getPathName(path);
  audioState.mediaSize = null;
  audioState.mediaDuration = null;
  audioState.resultDuration = null;
  audioState.currentPreset = null;
  audioState.processing = false;
  audioState.processingPreset = null;
  audioState.processingProgress = 0;
  audioState.chainProcessing = false;
  audioState.chainPending = false;
  audioState.resultPath = null;
  audioState.resultIsPreview = false;
  audioState.previewProcessing = false;
  audioState.previewStartSeconds = 0;
  audioState.fullChainPath = null;
  audioState.fullChainStale = false;
  audioState.resultFormat = null;
  audioState.resultOutputDir = null;
  audioState.currentSrc = "original";
  audioState.lastErrorPreset = null;
  audioState.exportDir = null;
  audioState.exportProcessing = false;
  audioState.refineOpen = false;
  resetAudioRefineState(false);
  audioState.analysis = null;

  audioState.markers = [];
  audioState.track = { mute: false, solo: false, gainDb: 0, pan: 0 };
  audioState.extraTracks = [];
  audioState.masterGainDb = 0;
  resetAudioHistory();
  commitAudioHistorySnapshot();
  audioUpdateUI();
  analyzeAudioFile(path);
  requestAnimationFrame(() => loadAudioWaveform("original", path, { activate: true }));
  showToast("Fichier audio chargé", 1800);
}

function audioUpdateUI() {
  const hasMedia = Boolean(audioState.mediaPath);
  const level = audioState.userLevel || "amateur";
  const isBeginner = level === "beginner";
  const isAmateur = level === "amateur";
  const isPro = level === "pro";
  const inRecordingView = audioRecordState?.view === "recording";

  // While the user is in the recording view we leave the workspace and empty
  // state hidden no matter what other state changes (re-mounting the workspace
  // would re-create wavesurfer instances inside a zero-width container and
  // trigger RangeError loops in renderMultiCanvas).
  if (!inRecordingView) {
    document.getElementById("audio-empty")?.classList.toggle("hidden", hasMedia);
    document.getElementById("audio-workspace")?.classList.toggle("hidden", !hasMedia);
  } else {
    document.getElementById("audio-empty")?.classList.add("hidden");
    document.getElementById("audio-workspace")?.classList.add("hidden");
    return; // skip the rest — nothing to render in REC view
  }

  // Shared player (toolbar + waveforms + transport) lives above the level panels
  // and stays visible whenever media is loaded, regardless of user level.
  const sharedPlayer = document.getElementById("audio-shared-player");
  if (sharedPlayer) {
    sharedPlayer.classList.toggle("hidden", !hasMedia);
    sharedPlayer.classList.toggle("amateur-mode", isAmateur);
    sharedPlayer.classList.toggle("beginner-mode", isBeginner);
    // Beginner keeps a simplified chrome: toolbar hidden (no zoom/FX/markers
    // clutter), but the A/B toggle STAYS visible so the user can decide what
    // they want to hear. Single waveform shown at a time — whichever matches
    // currentSrc — so layout is clean (no stacked original + result panes).
    document.getElementById("audio-tool-strip")?.classList.toggle("hidden", isBeginner);
    document.getElementById("audio-ab-toggle")?.classList.remove("beginner-hidden");
    const originalPanel = sharedPlayer.querySelector(":scope > .audio-wave-panel");
    const resultPanel = document.getElementById("audio-result-panel");
    if (isBeginner) {
      const showResult = audioState.currentSrc === "result" && Boolean(audioState.resultPath);
      if (originalPanel) originalPanel.classList.toggle("beginner-hidden", showResult);
      if (resultPanel) resultPanel.classList.toggle("beginner-hidden", !showResult);
    } else {
      if (originalPanel) originalPanel.classList.remove("beginner-hidden");
      if (resultPanel) resultPanel.classList.remove("beginner-hidden");
    }
  }

  // All three level panels live inside the workspace. We toggle them based on the
  // current user level instead of mutually-exclusive editor tabs.
  document.getElementById("audio-studio-shell")?.classList.toggle("hidden", !isPro);
  document.getElementById("audio-mixing-view")?.classList.toggle("hidden", !isPro || !hasMedia);
  document.getElementById("audio-mastering-view")?.classList.toggle("hidden", !isPro || !hasMedia);
  document.getElementById("audio-beginner-panel")?.classList.toggle("hidden", !isBeginner || !hasMedia);
  document.getElementById("audio-amateur-panel")?.classList.toggle("hidden", !isAmateur || !hasMedia);

  const placeholder = document.getElementById("audio-studio-placeholder");
  if (placeholder) placeholder.classList.add("hidden");

  if (isPro && hasMedia) {
    renderAudioMasteringView();
    renderAudioMixingView();
  }
  if (isAmateur && hasMedia) renderAudioAmateurPanel();
  if (isBeginner && hasMedia) renderAudioBeginnerPanel();

  document.querySelectorAll("#audio-level-switch [data-audio-level]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.audioLevel === level);
  });

  syncAudioFxToggle();
  document.getElementById("audio-file-chip")?.classList.toggle("hidden", !hasMedia);

  renderAudioStudioHeader(hasMedia);

  const chipName = document.getElementById("audio-file-chip-name");
  if (chipName) {
    chipName.textContent = audioState.mediaName || "fichier.audio";
    chipName.title = audioState.mediaPath || "";
  }

  const originalMeta = document.getElementById("audio-original-meta");
  if (originalMeta) {
    const ext = getPathExtension(audioState.mediaPath || "");
    originalMeta.textContent = hasMedia
      ? `${audioState.mediaName}${ext ? " · " + ext.toUpperCase() : ""}`
      : "Aucun fichier charge";
  }

  document.getElementById("audio-result-panel")?.classList.toggle("hidden", !audioState.resultPath);
  document.getElementById("audio-result-panel")?.classList.toggle("chain-processing", audioState.chainProcessing);
  const abToggle = document.getElementById("audio-ab-toggle");
  if (abToggle) {
    abToggle.classList.toggle("hidden", !hasMedia);
    const resultBtn = abToggle.querySelector("[data-audio-source='result']");
    if (resultBtn) {
      resultBtn.disabled = !audioState.resultPath;
      resultBtn.title = audioState.resultPath ? "Écouter le résultat traité" : "Applique un preset d'abord";
    }
    const originalBtn = abToggle.querySelector("[data-audio-source='original']");
    if (originalBtn) originalBtn.title = "Écouter le son brut original";
  }
  renderAudioRefinePanel();

  const hasFullResult = Boolean(audioState.resultPath) && !audioState.resultIsPreview;
  const exportBtn = document.getElementById("audio-export-btn");
  if (exportBtn) {
    exportBtn.disabled = !hasFullResult || audioState.processing;
    exportBtn.title = audioState.resultIsPreview
      ? "Applique la chaîne au fichier complet avant d'exporter"
      : "Exporter le résultat";
  }

  renderAudioPresetCards();
  renderAudioAbToggle();
  renderAudioEffectsSidebar();
  renderAudioMeters();
  renderAudioApplyFullButton();
  renderAudioResultHeader();
  renderAudioExtraTracks();
  updateAudioExportModal();

  if (hasMedia) {
    syncAudioTransportFromPlayer();
  } else {
    updateAudioTransport(0, 0);
    setAudioTransportEnabled(false);
    setAudioPlayButton(false);
  }
}

function setAudioSideTab(tab) {
  if (!["effects", "settings", "analysis"].includes(tab)) return;
  audioState.effectsTab = tab;
  renderAudioEffectsSidebar();
}

function renderAudioEffectsSidebar() {
  document.querySelectorAll("#audio-side-tabs [data-audio-side-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.audioSideTab === audioState.effectsTab);
  });

  document.getElementById("audio-side-panel-effects")?.classList.toggle("hidden", audioState.effectsTab !== "effects");
  document.getElementById("audio-side-panel-settings")?.classList.toggle("hidden", audioState.effectsTab !== "settings");
  document.getElementById("audio-side-panel-analysis")?.classList.toggle("hidden", audioState.effectsTab !== "analysis");

  const chain = document.getElementById("audio-effects-chain");
  if (!chain) return;
  document.getElementById("audio-effect-detail")?.classList.toggle("chain-processing", audioState.chainProcessing);
  chain.innerHTML = audioState.effects.map((effect) => `
    <button type="button" class="audio-effect-row${effect.key === audioState.selectedEffect ? " selected" : ""}${effect.enabled ? "" : " off"}" data-effect="${effect.key}">
      <span class="audio-effect-handle">⋮⋮</span>
      <span class="audio-effect-name">${effect.label}</span>
      <span class="audio-effect-switch${effect.enabled ? " on" : ""}" data-effect-toggle="${effect.key}" aria-hidden="true"><span></span></span>
      <span class="audio-effect-menu">...</span>
    </button>
  `).join("");

  chain.querySelectorAll(".audio-effect-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      const effectKey = row.dataset.effect;
      if (event.target.closest("[data-effect-toggle]")) {
        toggleAudioEffect(effectKey);
        return;
      }
      audioState.selectedEffect = effectKey;
      renderAudioEffectsSidebar();
    });
  });

  renderAudioEffectDetail();
}

function toggleAudioEffect(effectKey) {
  const effect = audioState.effects.find((item) => item.key === effectKey);
  if (!effect) return;
  effect.enabled = !effect.enabled;
  if (audioState.effectChain[effectKey]) {
    audioState.effectChain[effectKey].enabled = effect.enabled;
  }
  audioState.selectedEffect = effectKey;
  renderAudioEffectsSidebar();
  scheduleAudioChainRender(500);
}

function renderAudioEffectDetail() {
  const detail = document.getElementById("audio-effect-detail");
  if (!detail) return;
  const effect = audioState.effects.find((item) => item.key === audioState.selectedEffect) || audioState.effects[0];
  if (!effect) {
    detail.innerHTML = "";
    return;
  }

  let body = `<div class="audio-effect-detail-placeholder">Paramètres bientôt disponibles.</div>`;
  if (effect.key === "eq") body = renderAudioEqPanel();
  if (effect.key === "compressor") body = renderAudioCompressorPanel();
  if (effect.key === "deesser") body = renderAudioDeEsserPanel();
  if (effect.key === "denoise") body = renderAudioDenoisePanel();
  if (effect.key === "limiter") body = renderAudioLimiterPanel();
  if (effect.key === "reverb") body = `<div class="audio-effect-detail-placeholder">Réverbération bientôt disponible (impulse response).</div>`;

  detail.innerHTML = `
    <div class="audio-effect-detail-head">
      <div>
        <div class="audio-effect-detail-kicker">Effet sélectionné</div>
        <div class="audio-effect-detail-title">${effect.label}</div>
      </div>
      <button type="button" class="audio-effect-power${effect.enabled ? " on" : ""}" id="audio-effect-power" title="Activer / désactiver">
        <span></span>
      </button>
    </div>
    ${body}
  `;

  detail.querySelector("#audio-effect-power")?.addEventListener("click", () => toggleAudioEffect(effect.key));
  bindAudioEqPanel(detail);
  bindAudioCompressorPanel(detail);
  bindAudioDeEsserPanel(detail);
  bindAudioDenoisePanel(detail);
  bindAudioLimiterPanel(detail);
}

function renderAudioSliderPanel(chainKey, enabled, controls, resetId) {
  return `
    <div class="audio-slider-panel${enabled ? "" : " disabled"}">
      <div class="audio-slider-controls">
        ${controls.map((control) => {
          const value = control.value;
          return `
            <label class="audio-slider-control">
              <span class="audio-slider-label">${control.label}</span>
              <input type="range" data-slider-key="${chainKey}.${control.key}" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" />
              <strong data-slider-value="${chainKey}.${control.key}">${formatAudioSliderValue(value, control.unit, control.precision)}</strong>
              ${control.hint ? `<small class="audio-slider-hint">${control.hint}</small>` : ""}
            </label>
          `;
        }).join("")}
      </div>
      <button type="button" class="audio-effect-reset" data-reset="${resetId}">Reset</button>
    </div>
  `;
}

function formatAudioSliderValue(value, unit, precision) {
  const p = Number.isFinite(precision) ? precision : (Math.abs(value) < 10 ? 2 : 1);
  return `${Number(value).toFixed(p)}${unit ? unit : ""}`;
}

function renderAudioDeEsserPanel() {
  const d = audioState.effectChain.deesser;
  return renderAudioSliderPanel("deesser", d.enabled, [
    { key: "intensity", label: "Intensité", min: 0, max: 1, step: 0.01, value: d.intensity, precision: 2, hint: "0 = aucun · 1 = maximum" },
    { key: "frequency", label: "Fréquence", min: 0.2, max: 1, step: 0.01, value: d.frequency, precision: 2, hint: "0.2 = grave · 1.0 = aigu" },
    { key: "mode", label: "Mode", min: 0.1, max: 1, step: 0.01, value: d.mode, precision: 2, hint: "0.1 = doux · 1 = ferme" },
  ], "deesser");
}

function renderAudioDenoisePanel() {
  const d = audioState.effectChain.denoise;
  return renderAudioSliderPanel("denoise", d.enabled, [
    { key: "amount", label: "Intensité (dB)", min: 1, max: 30, step: 0.5, value: d.amount, precision: 1, hint: "1 = subtil · 30 = agressif" },
    { key: "noiseFloor", label: "Plancher de bruit (dB)", min: -50, max: -20, step: 0.5, value: d.noiseFloor, precision: 1, hint: "-50 = silence très bas · -20 = pièce bruyante" },
  ], "denoise");
}

function renderAudioLimiterPanel() {
  const l = audioState.effectChain.limiter;
  return renderAudioSliderPanel("limiter", l.enabled, [
    { key: "ceiling", label: "Plafond (dB)", min: -3, max: 0, step: 0.1, value: l.ceiling, precision: 1, hint: "True peak max · -0.5 dB conseillé" },
    { key: "attack", label: "Attaque (ms)", min: 1, max: 50, step: 1, value: l.attack, precision: 0, hint: "Plus court = plus réactif" },
    { key: "release", label: "Release (ms)", min: 10, max: 500, step: 5, value: l.release, precision: 0, hint: "Plus long = plus doux" },
  ], "limiter");
}

function bindAudioSliderPanel(root, chainKey, defaults, beforeSchedule) {
  root.querySelectorAll(`[data-slider-key^="${chainKey}."]`).forEach((input) => {
    input.addEventListener("input", () => {
      const [, paramKey] = input.dataset.sliderKey.split(".");
      audioState.effectChain[chainKey][paramKey] = Number(input.value);
      const valueEl = root.querySelector(`[data-slider-value="${chainKey}.${paramKey}"]`);
      if (valueEl) {
        const unit = paramKey === "intensity" || paramKey === "frequency" || paramKey === "mode" ? "" : (paramKey === "ceiling" || paramKey === "noiseFloor" || paramKey === "amount" ? " dB" : " ms");
        valueEl.textContent = formatAudioSliderValue(Number(input.value), unit, paramKey.includes("Floor") || paramKey === "ceiling" ? 1 : (paramKey === "attack" || paramKey === "release" ? 0 : 2));
      }
      if (typeof beforeSchedule === "function") beforeSchedule();
      if (audioState.effectChain[chainKey].enabled) scheduleAudioChainRender(400);
    });
  });
  root.querySelector(`[data-reset="${chainKey}"]`)?.addEventListener("click", () => {
    Object.assign(audioState.effectChain[chainKey], defaults);
    renderAudioEffectsSidebar();
    if (audioState.effectChain[chainKey].enabled) scheduleAudioChainRender(300);
  });
}

function bindAudioDeEsserPanel(root) {
  bindAudioSliderPanel(root, "deesser", { intensity: 0.35, frequency: 0.55, mode: 0.5 });
}

function bindAudioDenoisePanel(root) {
  bindAudioSliderPanel(root, "denoise", { amount: 12, noiseFloor: -25 });
}

function bindAudioLimiterPanel(root) {
  bindAudioSliderPanel(root, "limiter", { ceiling: -0.5, attack: 5, release: 50 });
}

function renderAudioEqPanel() {
  const eq = audioState.effectChain.eq;
  const bands = eq.bands;
  const points = bands.map((band, index) => {
    const pos = eqBandToPoint(band);
    return { ...pos, band, index };
  });
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const path = sorted.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const disabledClass = eq.enabled ? "" : " disabled";
  return `
    <div class="audio-eq-panel${disabledClass}">
      <svg class="audio-eq-graph" id="audio-eq-graph" viewBox="0 0 280 180" role="img" aria-label="Courbe EQ">
        ${[-24, -12, -6, 0, 6, 12, 24].map((db) => {
          const y = gainToEqY(db);
          const cls = db === 0 ? "audio-eq-grid audio-eq-grid-zero" : "audio-eq-grid";
          return `<line class="${cls}" x1="0" y1="${y}" x2="280" y2="${y}"></line><text class="audio-eq-label" x="4" y="${y - 3}">${db > 0 ? "+" : ""}${db}dB</text>`;
        }).join("")}
        ${[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((freq) => {
          const x = freqToEqX(freq);
          const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
          return `<line class="audio-eq-grid" x1="${x}" y1="0" x2="${x}" y2="180"></line><text class="audio-eq-label" x="${x + 2}" y="176">${label}</text>`;
        }).join("")}
        <polyline class="audio-eq-curve" points="${path}"></polyline>
        ${points.map((point) => `<circle class="audio-eq-point" data-band="${point.index}" cx="${point.x}" cy="${point.y}" r="8" style="--band-color:${point.band.color}"><title>${point.band.kind} · ${Math.round(point.band.freq)} Hz · ${point.band.gain.toFixed(1)} dB · Q ${point.band.q.toFixed(2)}</title></circle>`).join("")}
        <g class="audio-eq-tooltip-group" id="audio-eq-tooltip-group" style="display:none">
          <line class="audio-eq-tooltip-line" id="audio-eq-tooltip-line" x1="0" y1="0" x2="0" y2="180"></line>
          <rect class="audio-eq-tooltip-bg" id="audio-eq-tooltip-bg" x="0" y="0" width="96" height="32" rx="4"></rect>
          <text class="audio-eq-tooltip-text" id="audio-eq-tooltip-text" x="0" y="0"></text>
        </g>
      </svg>
      <div class="audio-eq-readout" id="audio-eq-readout">Bande 1 · ${Math.round(bands[0].freq)} Hz · ${bands[0].gain.toFixed(1)} dB · Q ${bands[0].q.toFixed(2)}</div>
      <div class="audio-eq-hints">Glisser·molette = Q · double-clic = reset · clic droit = type</div>
      <div class="audio-eq-table">
        ${bands.map((band, index) => `
          <div class="audio-eq-row">
            <select data-eq-kind="${index}">
              ${AUDIO_EQ_TYPES.map((kind) => `<option value="${kind}"${band.kind === kind ? " selected" : ""}>${kind}</option>`).join("")}
            </select>
            <input data-eq-freq="${index}" type="number" min="20" max="20000" value="${Math.round(band.freq)}" />
            <input data-eq-gain="${index}" type="number" min="-24" max="24" step="0.5" value="${band.gain}" />
            <input data-eq-q="${index}" type="number" min="0.1" max="18" step="0.1" value="${band.q}" />
          </div>
        `).join("")}
      </div>
      <button type="button" class="audio-effect-reset" id="audio-eq-reset">Reset EQ complet</button>
    </div>
  `;
}

function bindAudioEqPanel(root) {
  const graph = root.querySelector("#audio-eq-graph");

  root.querySelectorAll(".audio-eq-point").forEach((point) => {
    const bandIndex = Number(point.dataset.band);
    point.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      audioEqDrag = { band: bandIndex };
      updateAudioEqBandFromEvent(event);
      event.preventDefault();
    });
    point.addEventListener("dblclick", (event) => {
      event.preventDefault();
      resetAudioEqBand(bandIndex);
    });
    point.addEventListener("wheel", (event) => {
      event.preventDefault();
      const band = audioState.effectChain.eq.bands[bandIndex];
      if (!band) return;
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      band.q = Number(clampNumber(band.q + delta, 0.1, 18).toFixed(2));
      updateAudioEqVisuals();
      renderAudioEqTableValues();
      if (audioState.effectChain.eq.enabled) scheduleAudioChainRender(400);
    }, { passive: false });
    point.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const band = audioState.effectChain.eq.bands[bandIndex];
      if (!band) return;
      const currentIdx = AUDIO_EQ_TYPES.indexOf(band.kind);
      band.kind = AUDIO_EQ_TYPES[(currentIdx + 1) % AUDIO_EQ_TYPES.length];
      renderAudioEffectDetail();
      if (audioState.effectChain.eq.enabled) scheduleAudioChainRender(300);
      showToast(`Bande ${bandIndex + 1} → ${band.kind}`, 1500);
    });
  });

  if (graph) {
    graph.addEventListener("mousemove", (event) => {
      if (audioEqDrag) return;
      updateAudioEqTooltip(event);
    });
    graph.addEventListener("mouseleave", () => {
      hideAudioEqTooltip();
    });
  }

  root.querySelectorAll("[data-eq-kind], [data-eq-freq], [data-eq-gain], [data-eq-q]").forEach((input) => {
    input.addEventListener("input", () => {
      const bandIndex = Number(input.dataset.eqKind ?? input.dataset.eqFreq ?? input.dataset.eqGain ?? input.dataset.eqQ);
      const band = audioState.effectChain.eq.bands[bandIndex];
      if (!band) return;
      if (input.dataset.eqKind !== undefined) band.kind = input.value;
      if (input.dataset.eqFreq !== undefined) band.freq = clampNumber(Number(input.value), 20, 20000);
      if (input.dataset.eqGain !== undefined) band.gain = applyEqGainSnap(clampNumber(Number(input.value), -24, 24));
      if (input.dataset.eqQ !== undefined) band.q = clampNumber(Number(input.value), 0.1, 18);
      renderAudioEffectDetail();
      if (audioState.effectChain.eq.enabled) scheduleAudioChainRender(400);
    });
  });
  root.querySelector("#audio-eq-reset")?.addEventListener("click", () => {
    audioState.effectChain.eq.bands = AUDIO_DEFAULT_EQ_BANDS.map((band) => ({ ...band }));
    renderAudioEffectsSidebar();
    if (audioState.effectChain.eq.enabled) scheduleAudioChainRender(300);
  });
}

function resetAudioEqBand(index) {
  const defaults = AUDIO_DEFAULT_EQ_BANDS[index];
  const band = audioState.effectChain.eq.bands[index];
  if (!band) return;
  if (defaults) {
    Object.assign(band, { ...defaults });
  } else {
    Object.assign(band, { kind: "peaking", freq: 1000, gain: 0, q: 1 });
  }
  renderAudioEffectDetail();
  if (audioState.effectChain.eq.enabled) scheduleAudioChainRender(300);
  showToast(`Bande ${index + 1} réinitialisée`, 1200);
}

function renderAudioEqTableValues() {
  const bands = audioState.effectChain.eq.bands;
  bands.forEach((band, index) => {
    const freqInput = document.querySelector(`[data-eq-freq="${index}"]`);
    const gainInput = document.querySelector(`[data-eq-gain="${index}"]`);
    const qInput = document.querySelector(`[data-eq-q="${index}"]`);
    if (freqInput) freqInput.value = Math.round(band.freq);
    if (gainInput) gainInput.value = band.gain;
    if (qInput) qInput.value = band.q;
  });
}

function updateAudioEqTooltip(event) {
  const graph = document.getElementById("audio-eq-graph");
  const group = document.getElementById("audio-eq-tooltip-group");
  const bg = document.getElementById("audio-eq-tooltip-bg");
  const text = document.getElementById("audio-eq-tooltip-text");
  const line = document.getElementById("audio-eq-tooltip-line");
  if (!graph || !group || !bg || !text || !line) return;
  const rect = graph.getBoundingClientRect();
  const x = clampNumber(((event.clientX - rect.left) / rect.width) * 280, 0, 280);
  const y = clampNumber(((event.clientY - rect.top) / rect.height) * 180, 0, 180);
  const freq = eqXToFreq(x);
  const gain = eqYToGain(y);
  const label = freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 1 : 2).replace(/\.?0+$/, "")} kHz` : `${freq} Hz`;
  const gainLabel = `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`;
  text.textContent = `${label} · ${gainLabel}`;
  line.setAttribute("x1", x);
  line.setAttribute("x2", x);
  const boxX = clampNumber(x + 6, 0, 280 - 96);
  const boxY = clampNumber(y - 36, 4, 180 - 32);
  bg.setAttribute("x", boxX);
  bg.setAttribute("y", boxY);
  text.setAttribute("x", boxX + 6);
  text.setAttribute("y", boxY + 20);
  group.style.display = "";
}

function hideAudioEqTooltip() {
  const group = document.getElementById("audio-eq-tooltip-group");
  if (group) group.style.display = "none";
}

function handleAudioEqDragMove(event) {
  if (!audioEqDrag) return;
  updateAudioEqBandFromEvent(event);
}

function handleAudioEqDragEnd() {
  audioEqDrag = null;
}

function updateAudioEqBandFromEvent(event) {
  const graph = document.getElementById("audio-eq-graph");
  if (!graph || !audioEqDrag) return;
  const rect = graph.getBoundingClientRect();
  const x = clampNumber(((event.clientX - rect.left) / rect.width) * 280, 0, 280);
  const y = clampNumber(((event.clientY - rect.top) / rect.height) * 180, 0, 180);
  const band = audioState.effectChain.eq.bands[audioEqDrag.band];
  if (!band) return;
  band.freq = eqXToFreq(x);
  band.gain = applyEqGainSnap(eqYToGain(y));
  updateAudioEqVisuals();
  renderAudioEqTableValues();
  if (audioState.effectChain.eq.enabled) scheduleAudioChainRender(400);
}

function updateAudioEqVisuals() {
  const eq = audioState.effectChain.eq;
  const points = eq.bands.map((band, index) => ({ ...eqBandToPoint(band), band, index }));
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const curve = document.querySelector(".audio-eq-curve");
  const readout = document.getElementById("audio-eq-readout");
  if (curve) curve.setAttribute("points", sorted.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "));
  points.forEach((point) => {
    const circle = document.querySelector(`.audio-eq-point[data-band="${point.index}"]`);
    if (circle) {
      circle.setAttribute("cx", point.x);
      circle.setAttribute("cy", point.y);
      const title = circle.querySelector("title");
      if (title) title.textContent = `${point.band.kind} · ${Math.round(point.band.freq)} Hz · ${point.band.gain.toFixed(1)} dB · Q ${point.band.q.toFixed(2)}`;
    }
  });
  const activeIndex = audioEqDrag?.band ?? 0;
  const active = points[activeIndex]?.band || eq.bands[0];
  if (readout && active) {
    readout.textContent = `Bande ${activeIndex + 1} · ${active.kind} · ${Math.round(active.freq)} Hz · ${active.gain > 0 ? "+" : ""}${active.gain.toFixed(1)} dB · Q ${active.q.toFixed(2)}`;
  }
}

function renderAudioCompressorPanel() {
  const compressor = audioState.effectChain.compressor;
  const controls = [
    { key: "threshold", label: "Threshold", min: -60, max: 0, step: 1, unit: "dB" },
    { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, unit: ":1" },
    { key: "attack", label: "Attack", min: 1, max: 100, step: 1, unit: "ms" },
    { key: "release", label: "Release", min: 10, max: 500, step: 5, unit: "ms" },
    { key: "makeup", label: "Makeup", min: 0, max: 12, step: 0.5, unit: "dB" },
  ];
  return `
    <div class="audio-compressor-panel${compressor.enabled ? "" : " disabled"}">
      <div class="audio-compressor-gr-block">
        <div class="audio-compressor-gr-label">Gain reduction</div>
        <div class="audio-compressor-gr-bar">
          <div class="audio-compressor-gr-fill" id="audio-compressor-gr-fill"></div>
          <div class="audio-compressor-gr-scale">
            <span>0</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span>
          </div>
        </div>
        <div class="audio-compressor-gr-value" id="audio-compressor-gr-value">-- dB</div>
      </div>
      <div class="audio-compressor-controls">
        ${controls.map((control) => {
          const value = compressor[control.key];
          return `
            <label class="audio-compressor-control">
              <span>${control.label}</span>
              <input type="range" data-compressor-control="${control.key}" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" />
              <strong data-compressor-value="${control.key}">${formatAudioCompressorValue(value, control.unit)}</strong>
            </label>
          `;
        }).join("")}
      </div>
      <button type="button" class="audio-effect-reset" id="audio-compressor-reset">Reset Compresseur</button>
    </div>
  `;
}

function estimateAudioCompressorGainReduction() {
  const c = audioState.effectChain.compressor;
  if (!c.enabled) return 0;
  const peakDb = Number.isFinite(audioState.analysis?.peakDbfs) ? audioState.analysis.peakDbfs : -6;
  if (peakDb <= c.threshold) return 0;
  const above = peakDb - c.threshold;
  return clampNumber((above * (c.ratio - 1)) / c.ratio, 0, 24);
}

function renderAudioCompressorGainReduction() {
  const fill = document.getElementById("audio-compressor-gr-fill");
  const value = document.getElementById("audio-compressor-gr-value");
  if (!fill || !value) return;
  const reduction = estimateAudioCompressorGainReduction();
  const pct = clampNumber((reduction / 24) * 100, 0, 100);
  fill.style.width = `${pct}%`;
  value.textContent = reduction > 0 ? `−${reduction.toFixed(1)} dB` : "−0.0 dB";
}

function bindAudioCompressorPanel(root) {
  root.querySelectorAll("[data-compressor-control]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.compressorControl;
      audioState.effectChain.compressor[key] = Number(input.value);
      const unit = key === "ratio" ? ":1" : (key === "attack" || key === "release" ? "ms" : "dB");
      const value = root.querySelector(`[data-compressor-value="${key}"]`);
      if (value) value.textContent = formatAudioCompressorValue(audioState.effectChain.compressor[key], unit);
      renderAudioCompressorGainReduction();
      if (audioState.effectChain.compressor.enabled) scheduleAudioChainRender(400);
    });
  });
  root.querySelector("#audio-compressor-reset")?.addEventListener("click", () => {
    audioState.effectChain.compressor = {
      enabled: audioState.effectChain.compressor.enabled,
      ...AUDIO_DEFAULT_COMPRESSOR,
    };
    renderAudioEffectsSidebar();
    if (audioState.effectChain.compressor.enabled) scheduleAudioChainRender(300);
  });
  renderAudioCompressorGainReduction();
}

function formatAudioCompressorValue(value, unit) {
  const rounded = Number(value).toFixed(unit === ":1" || unit === "dB" ? 1 : 0);
  return `${rounded}${unit}`;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function freqToEqX(freq) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const normalized = (Math.log10(clampNumber(freq, 20, 20000)) - min) / (max - min);
  return clampNumber(normalized * 280, 0, 280);
}

function eqXToFreq(x) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const normalized = clampNumber(x, 0, 280) / 280;
  return Math.round(10 ** (min + normalized * (max - min)));
}

// Y axis spans ±24 dB across the 180px graph height.
function gainToEqY(gain) {
  return clampNumber(((24 - clampNumber(gain, -24, 24)) / 48) * 180, 0, 180);
}

function eqYToGain(y) {
  return Number((24 - (clampNumber(y, 0, 180) / 180) * 48).toFixed(1));
}

function applyEqGainSnap(gain) {
  return Math.abs(gain) < 0.5 ? 0 : gain;
}

const AUDIO_EQ_TYPES = ["peaking", "lowpass", "highpass", "lowshelf", "highshelf", "notch"];

function eqBandToPoint(band) {
  return {
    x: freqToEqX(band.freq),
    y: gainToEqY(band.gain),
  };
}

function scheduleAudioChainRender(delay = 400) {
  if (!audioState.mediaPath) return;
  audioState.fullChainStale = Boolean(audioState.fullChainPath);
  renderAudioApplyFullButton();
  scheduleAudioHistorySnapshot();
  if (audioState.previewProcessing) {
    audioPreviewPending = true;
    return;
  }
  clearTimeout(audioPreviewDebounce);
  audioPreviewDebounce = window.setTimeout(() => {
    runAudioPreviewChain();
  }, delay);
}

function captureAudioStateSnapshot() {
  return {
    effectChain: JSON.parse(JSON.stringify(audioState.effectChain)),
    effects: audioState.effects.map((effect) => ({ ...effect })),
    refineSliders: { ...audioState.refineSliders },
    currentPreset: audioState.currentPreset,
  };
}

function restoreAudioStateSnapshot(snapshot) {
  if (!snapshot) return;
  audioState.effectChain = JSON.parse(JSON.stringify(snapshot.effectChain));
  audioState.effects = snapshot.effects.map((effect) => ({ ...effect }));
  audioState.refineSliders = { ...snapshot.refineSliders };
  audioState.currentPreset = snapshot.currentPreset;
  audioUpdateUI();
  scheduleAudioChainRender(150);
}

function scheduleAudioHistorySnapshot(delay = 500) {
  clearTimeout(audioHistoryDebounce);
  audioHistoryDebounce = window.setTimeout(commitAudioHistorySnapshot, delay);
}

function commitAudioHistorySnapshot() {
  const snapshot = captureAudioStateSnapshot();
  const serialized = JSON.stringify(snapshot);
  const top = audioState.history[audioState.historyIndex];
  if (top && JSON.stringify(top) === serialized) return;
  audioState.history = audioState.history.slice(0, audioState.historyIndex + 1);
  audioState.history.push(snapshot);
  if (audioState.history.length > AUDIO_HISTORY_MAX) {
    audioState.history.shift();
  }
  audioState.historyIndex = audioState.history.length - 1;
  renderAudioHistoryButtons();
}

function resetAudioHistory() {
  audioState.history = [];
  audioState.historyIndex = -1;
  clearTimeout(audioHistoryDebounce);
  renderAudioHistoryButtons();
}

function audioUndo() {
  if (audioState.historyIndex <= 0) return;
  audioState.historyIndex -= 1;
  restoreAudioStateSnapshot(audioState.history[audioState.historyIndex]);
  renderAudioHistoryButtons();
}

function audioRedo() {
  if (audioState.historyIndex >= audioState.history.length - 1) return;
  audioState.historyIndex += 1;
  restoreAudioStateSnapshot(audioState.history[audioState.historyIndex]);
  renderAudioHistoryButtons();
}

function renderAudioHistoryButtons() {
  const undo = document.getElementById("audio-undo-btn");
  const redo = document.getElementById("audio-redo-btn");
  if (undo) undo.disabled = audioState.historyIndex <= 0;
  if (redo) redo.disabled = audioState.historyIndex >= audioState.history.length - 1;
}

function getAudioPreviewStartSeconds() {
  const duration = audioState.mediaDuration || 0;
  const dur = audioState.previewDurationSeconds || 5;
  const cursor = getAudioSourceCurrentTime("original") || 0;
  if (!duration) return Math.max(0, cursor);
  return Math.max(0, Math.min(cursor, Math.max(0, duration - dur)));
}

async function runAudioPreviewChain() {
  if (!audioState.mediaPath) return null;
  const startSeconds = getAudioPreviewStartSeconds();
  const durationSeconds = audioState.previewDurationSeconds || 5;
  const token = ++audioPreviewToken;
  audioPreviewPending = false;
  audioState.previewProcessing = true;
  audioState.previewStartSeconds = startSeconds;
  renderAudioApplyFullButton();
  renderAudioResultHeader();

  try {
    const result = await invoke("audio_preview_chain", {
      req: {
        input: audioState.mediaPath,
        startSeconds,
        durationSeconds,
        effects: buildAudioEffectPayload(),
      },
    });

    if (token !== audioPreviewToken) return null;
    if (!result || result.success === false) {
      throw new Error((result && result.error) || "Aperçu impossible");
    }
    const outputPath = result.outputPath || result.output_path;
    if (!outputPath) throw new Error("Aucun fichier d'aperçu retourné");

    destroyAudioPlayer("result");
    audioState.resultPath = outputPath;
    audioState.resultIsPreview = true;
    audioState.resultFormat = "wav";
    audioState.resultOutputDir = null;
    audioState.resultDuration = null;
    if (!audioState.currentPreset) audioState.currentPreset = "chain";
    audioState.previewProcessing = false;
    audioUpdateUI();
    requestAnimationFrame(() => loadAudioWaveform("result", outputPath, {
      activate: false,
      seekTime: 0,
    }));
    return outputPath;
  } catch (err) {
    if (token === audioPreviewToken) {
      audioState.previewProcessing = false;
      const message = err && err.message ? err.message : String(err);
      console.warn("[audio] preview failed:", message);
      audioUpdateUI();
    }
    return null;
  } finally {
    if (token === audioPreviewToken) {
      audioState.previewProcessing = false;
      renderAudioApplyFullButton();
      if (audioPreviewPending) {
        scheduleAudioChainRender(200);
      }
    }
  }
}

async function applyChainToFullFile() {
  if (!audioState.mediaPath || audioState.processing) return;
  await runAudioEffectChain();
}

async function runAudioEffectChain(options = {}) {
  if (!audioState.mediaPath || audioState.processing) return null;

  const token = ++audioOperationToken;
  const chainToken = ++audioChainToken;
  const previousResultPath = audioState.resultPath;
  const previousPreset = audioState.currentPreset;
  const previousTime = getAudioSourceCurrentTime(audioState.currentSrc);
  const format = options.format || null;
  const outputDir = options.outputDir || null;

  // TODO: add backend cancellation for stale FFmpeg jobs; UI currently keeps only the latest result.
  audioState.processing = true;
  audioState.chainProcessing = true;
  audioState.chainPending = false;
  audioState.processingPreset = "chain";
  audioState.processingProgress = 0;
  audioState.lastErrorPreset = null;
  audioUpdateUI();
  await startAudioProgressListener(token, "chain");

  try {
    const extraTracks = (audioState.extraTracks || []).map((t) => ({
      path: t.path,
      gainDb: Number(t.gainDb || 0),
      mute: Boolean(t.mute),
      pan: Number(t.pan || 0),
    }));
    const masterGainDb = Number(audioState.masterGainDb || 0);
    const primaryPan = Number(audioState.track?.pan || 0);
    const useMix = extraTracks.length > 0 || Math.abs(masterGainDb) > 0.05 || Math.abs(primaryPan) > 0.5;
    const commandName = useMix ? "audio_apply_mix" : "audio_apply_chain";
    const reqPayload = {
      input: audioState.mediaPath,
      outputDir,
      format,
      effects: buildAudioEffectPayload(),
    };
    if (useMix) {
      reqPayload.extraTracks = extraTracks;
      reqPayload.primaryPan = primaryPan;
      reqPayload.masterGainDb = masterGainDb;
    }
    const result = await invoke(commandName, { req: reqPayload });

    if (token !== audioOperationToken || chainToken !== audioChainToken) return null;
    if (!result || result.success === false) {
      throw new Error((result && result.error) || "Traitement de chaine echoue");
    }

    const outputPath = result.outputPath || result.output_path;
    if (!outputPath) throw new Error("Aucun fichier de sortie retourne");

    destroyAudioPlayer("result");
    audioState.resultPath = outputPath;
    audioState.resultIsPreview = false;
    audioState.resultFormat = format;
    audioState.resultOutputDir = outputDir || getAudioDefaultOutputDir();
    audioState.resultDuration = null;
    audioState.currentPreset = "chain";
    audioState.currentSrc = "result";
    audioState.processingProgress = 100;
    audioState.processing = false;
    audioState.chainProcessing = false;
    audioState.processingPreset = null;
    audioState.fullChainPath = outputPath;
    audioState.fullChainStale = false;
    audioUpdateUI();
    requestAnimationFrame(() => loadAudioWaveform("result", outputPath, {
      activate: true,
      seekTime: Number.isFinite(previousTime) ? previousTime : 0,
    }));
    audioState.analysis = null;
    renderAudioMeters();
    await analyzeAudioFile(outputPath);
    return outputPath;
  } catch (err) {
    if (token === audioOperationToken && chainToken === audioChainToken) {
      audioState.resultPath = previousResultPath;
      audioState.currentPreset = previousPreset;
      audioState.processing = false;
      audioState.chainProcessing = false;
      audioState.processingPreset = null;
      audioState.processingProgress = 0;
      audioUpdateUI();
      const message = err && err.message ? err.message : String(err);
      showToast("Erreur chaine audio : " + message, 5000);
    }
    return null;
  } finally {
    if (token === audioOperationToken) {
      stopAudioProgressListener();
      audioState.processing = false;
      audioState.chainProcessing = false;
      audioState.processingPreset = null;
      audioUpdateUI();
      if (audioState.chainPending) {
        scheduleAudioChainRender(250);
      }
    }
  }
}

function buildAudioEffectPayload() {
  const chain = cloneAudioEffectChainWithRefine();
  const ordered = [];

  audioState.effects.forEach((effect) => {
    if (effect.key === "eq") {
      ordered.push({
        type: "eq",
        enabled: Boolean(chain.eq.enabled),
        bands: chain.eq.bands.map((band) => ({
          kind: band.kind,
          freq: Number(band.freq),
          gain: Number(band.gain),
          q: Number(band.q),
        })),
      });
    }
    if (effect.key === "compressor") {
      ordered.push({
        type: "compressor",
        enabled: Boolean(chain.compressor.enabled),
        threshold: Number(chain.compressor.threshold),
        ratio: Number(chain.compressor.ratio),
        attack: Number(chain.compressor.attack),
        release: Number(chain.compressor.release),
        makeup: Number(chain.compressor.makeup),
      });
    }
    if (effect.key === "deesser") {
      ordered.push({
        type: "de_esser",
        enabled: Boolean(chain.deesser.enabled),
        intensity: Number(chain.deesser.intensity),
        frequency: Number(chain.deesser.frequency),
        mode: Number(chain.deesser.mode),
      });
    }
    if (effect.key === "denoise") {
      ordered.push({
        type: "denoise",
        enabled: Boolean(chain.denoise.enabled),
        amount: Number(chain.denoise.amount),
        noise_floor: Number(chain.denoise.noiseFloor),
      });
    }
    if (effect.key === "reverb") ordered.push({ type: "reverb", enabled: Boolean(chain.reverb.enabled) });
    if (effect.key === "limiter") {
      ordered.push({
        type: "limiter",
        enabled: Boolean(chain.limiter.enabled),
        ceiling: Number(chain.limiter.ceiling),
        attack: Number(chain.limiter.attack),
        release: Number(chain.limiter.release),
      });
    }
  });

  ordered.push({
    type: "silence",
    enabled: Boolean(chain.silence.enabled),
    threshold: chain.silence.threshold,
    duration: chain.silence.duration,
  });
  ordered.push({
    type: "loudnorm",
    enabled: Boolean(chain.loudnorm.enabled),
    target_lufs: chain.loudnorm.targetLufs,
  });

  return ordered;
}

function cloneAudioEffectChainWithRefine() {
  const chain = {
    eq: {
      ...audioState.effectChain.eq,
      bands: audioState.effectChain.eq.bands.map((band) => ({ ...band })),
    },
    compressor: { ...audioState.effectChain.compressor },
    deesser: { ...audioState.effectChain.deesser },
    denoise: { ...audioState.effectChain.denoise },
    reverb: { ...audioState.effectChain.reverb },
    limiter: { ...audioState.effectChain.limiter },
    silence: { ...audioState.effectChain.silence },
    loudnorm: { ...audioState.effectChain.loudnorm },
  };

  if (!audioState.resultPath) return chain;
  const sliders = audioState.refineSliders;
  // Niveau 2: translate human controls into FFmpeg-oriented chain overrides.
  chain.loudnorm.enabled = true;
  chain.loudnorm.targetLufs = mapAudioRefineVolume(sliders.volume, getAudioPresetDefaultLufs(audioState.currentPreset));
  chain.denoise.enabled = chain.denoise.enabled || sliders.noise !== 50;
  chain.denoise.amount = mapAudioSlider(sliders.noise, 6, getAudioPresetDefaultNoise(audioState.currentPreset), 30);
  applyAudioVoiceRefine(chain.eq.bands, sliders.voice);
  chain.compressor.ratio = mapAudioSlider(sliders.compression, 2, AUDIO_DEFAULT_COMPRESSOR.ratio, 6);
  chain.compressor.attack = mapAudioSlider(sliders.compression, 20, AUDIO_DEFAULT_COMPRESSOR.attack, 3);
  chain.silence.enabled = sliders.silence > 55;
  chain.silence.threshold = -35;
  chain.silence.duration = mapAudioSlider(sliders.silence, 0.9, 0.6, 0.4);
  chain.deesser.enabled = chain.deesser.enabled || sliders.sibilance > 55;
  chain.deesser.intensity = sliders.sibilance <= 50 ? chain.deesser.intensity : mapAudioSlider(sliders.sibilance, 0, 0.35, 1);
  return chain;
}

function mapAudioSlider(value, low, center, high) {
  const v = clampNumber(value, 0, 100);
  if (v <= 50) return Number((low + (center - low) * (v / 50)).toFixed(2));
  return Number((center + (high - center) * ((v - 50) / 50)).toFixed(2));
}

function mapAudioRefineVolume(value, defaultLufs) {
  return mapAudioSlider(value, -23, defaultLufs, -10);
}

function getAudioPresetDefaultLufs(preset) {
  if (preset === "voice_memo") return -15;
  return -16;
}

function getAudioPresetDefaultNoise(preset) {
  if (preset === "voice_memo") return 22;
  if (preset === "podcast_interview") return 10;
  return 14;
}

function applyAudioVoiceRefine(bands, value) {
  const warmth = mapAudioSlider(value, 2, 0, -2);
  const clarity = mapAudioSlider(value, -1, 0, 3);
  const air = mapAudioSlider(value, -0.5, 0, 2);
  const lowMid = bands.find((band) => band.freq >= 180 && band.freq <= 320);
  const presence = bands.find((band) => band.freq >= 3500 && band.freq <= 5500);
  const shelf = bands.find((band) => band.kind === "highshelf") || bands[bands.length - 1];
  if (lowMid) lowMid.gain = Number((lowMid.gain + warmth).toFixed(1));
  if (presence) presence.gain = Number((presence.gain + clarity).toFixed(1));
  if (shelf) shelf.gain = Number((shelf.gain + air).toFixed(1));
}

function setAudioStudioTab(tab) {
  // Legacy shim — early code paths still call this. Map onto user levels.
  if (tab === "master" || tab === "mix" || tab === "edit") {
    setAudioUserLevel("pro");
  }
}

function renderAudioStudioHeader(hasMedia) {
  const title = document.getElementById("audio-studio-title");
  const subtitle = document.getElementById("audio-studio-subtitle");
  if (title) title.textContent = hasMedia ? "Mon projet audio" : "Audio Studio";
  if (subtitle) {
    subtitle.textContent = hasMedia
      ? "Modifie aujourd'hui"
      : "Importe ou enregistre un fichier pour commencer";
  }

  const exportBtn = document.getElementById("audio-export-btn");
  if (exportBtn) exportBtn.disabled = !audioState.resultPath || audioState.processing;
}

// =============================================================================
// Master audio player (single source of truth for playback)
// =============================================================================
// We use a dedicated <audio id="audio-master-player"> as the only sound-emitting
// element. The two wavesurfer instances (original + result) are muted via
// setVolume(0) and used only to render waveforms. The master <audio> source is
// swapped between originalPath and resultPath when the user toggles A/B; the
// wavesurfer cursors are kept in sync via timeupdate. This fixes the bug where
// switching to "Résultat" left the user hearing the original because pause/play
// across two wavesurfer instances was unreliable on this build.

let audioMasterEl = null;
let audioMasterCurrentPath = null;

function getAudioMasterEl() {
  if (!audioMasterEl) audioMasterEl = document.getElementById("audio-master-player");
  return audioMasterEl;
}

function audioMasterPathFor(source) {
  return source === "result" ? audioState.resultPath : audioState.mediaPath;
}

function applyAudioMasterSource(source, options = {}) {
  const audio = getAudioMasterEl();
  if (!audio) return;
  const path = audioMasterPathFor(source);
  if (!path) return;
  const newSrc = getAudioAssetSrc(path);
  const preserveTime = options.preserveTime !== false;
  const previousTime = preserveTime ? (audio.currentTime || 0) : 0;
  const shouldPlay = options.autoplay === true
    || (options.resumeIfPlaying === true && !audio.paused);

  console.log("[audio] master source →", source, "(", newSrc, ") wasPlaying=", !audio.paused, "preserveTime=", previousTime);

  if (audioMasterCurrentPath === path && audio.src === newSrc) {
    if (shouldPlay && audio.paused) {
      audio.play().catch((err) => console.warn("[audio] master.play failed:", err));
    }
    return;
  }

  audioMasterCurrentPath = path;
  audio.src = newSrc;
  audio.load();

  const restoreAndMaybePlay = () => {
    if (previousTime > 0 && Number.isFinite(audio.duration) && previousTime < audio.duration) {
      try { audio.currentTime = previousTime; } catch (_) { /* ignore */ }
    }
    if (shouldPlay) {
      audio.play().catch((err) => console.warn("[audio] master.play failed:", err));
    }
  };

  if (audio.readyState >= 2) {
    // metadata already available (cached)
    restoreAndMaybePlay();
  } else {
    audio.addEventListener("loadedmetadata", restoreAndMaybePlay, { once: true });
  }
}

function audioMasterPlay() {
  const audio = getAudioMasterEl();
  if (!audio) return;
  if (!audio.src) {
    // No source yet — initialise from current state.
    applyAudioMasterSource(audioState.currentSrc || "original", { autoplay: true });
    return;
  }
  audio.play().catch((err) => console.warn("[audio] master.play failed:", err));
}

function audioMasterPause() {
  const audio = getAudioMasterEl();
  if (audio && !audio.paused) audio.pause();
}

function audioMasterIsPlaying() {
  const audio = getAudioMasterEl();
  return Boolean(audio && !audio.paused && audio.currentTime > 0 && !audio.ended);
}

function audioMasterSeek(time) {
  const audio = getAudioMasterEl();
  if (!audio || !Number.isFinite(time)) return;
  try { audio.currentTime = Math.max(0, time); } catch (_) { /* ignore */ }
}

function audioMasterCurrentTime() {
  const audio = getAudioMasterEl();
  return audio ? (audio.currentTime || 0) : 0;
}

function audioMasterDuration() {
  const audio = getAudioMasterEl();
  return audio ? (audio.duration || 0) : 0;
}

function bindAudioMasterPlayerOnce() {
  const audio = getAudioMasterEl();
  if (!audio || audio.dataset.bound) return;
  audio.dataset.bound = "1";
  audio.addEventListener("play", () => {
    setAudioPlayButton(true);
    // Hook the AnalyserNode on first play (autoplay policy can block creation
    // before user gesture, so we defer until the master actually starts).
    attachAudioLiveMeterToMaster();
  });
  audio.addEventListener("pause", () => {
    setAudioPlayButton(false);
  });
  audio.addEventListener("ended", () => {
    setAudioPlayButton(false);
  });
  audio.addEventListener("timeupdate", () => {
    const t = audio.currentTime || 0;
    const d = audio.duration || 0;
    updateAudioTransport(t, d);
    // Mirror cursor onto both wavesurfer instances so the visual follows.
    syncWavesurferCursorsToMaster(t);
  });
  audio.addEventListener("loadedmetadata", () => {
    const d = audio.duration || 0;
    updateAudioTransport(audio.currentTime || 0, d);
    setAudioTransportEnabled(d > 0);
  });
}

function syncWavesurferCursorsToMaster(time) {
  ["original", "result"].forEach((src) => {
    const wave = getAudioPlayer(src).wave;
    if (!wave) return;
    const duration = (typeof wave.getDuration === "function" ? wave.getDuration() : 0) || 0;
    if (!duration) return;
    const fraction = Math.min(1, Math.max(0, time / duration));
    try {
      if (typeof wave.seekTo === "function") wave.seekTo(fraction);
    } catch (_) { /* wavesurfer not ready yet */ }
  });
}

function audioTogglePlayback() {
  // Only the ACTIVE wave plays. The other one stays paused so there's no
  // race with the result wave that hasn't finished loading yet, and no double
  // audio. Switch source = pause active + play new (handled in
  // setActiveAudioSource).
  const original = audioOriginalWave;
  const result = audioResultWave;
  const active = audioState.currentSrc;
  const activeWave = active === "result" ? result : original;
  const inactiveWave = active === "result" ? original : result;

  console.log("[audio] togglePlayback active=", active,
    "activeWave?", Boolean(activeWave),
    "inactiveWave?", Boolean(inactiveWave));

  // Force the inactive wave to stop in case it was playing from a prior state.
  if (inactiveWave) {
    try { if (typeof inactiveWave.pause === "function") inactiveWave.pause(); } catch (_) {}
    try { if (typeof inactiveWave.setVolume === "function") inactiveWave.setVolume(0); } catch (_) {}
  }

  if (!activeWave) {
    console.warn("[audio] active source has no wave yet (still loading?)", active);
    showToast("Le résultat est encore en cours de chargement…", 2200);
    return;
  }

  // Ensure active wave has full volume before playing.
  try { if (typeof activeWave.setVolume === "function") activeWave.setVolume(1); } catch (_) {}

  const isPlaying = typeof activeWave.isPlaying === "function"
    ? activeWave.isPlaying()
    : !activeWave.paused;

  if (isPlaying) {
    try { activeWave.pause(); } catch (_) {}
    setAudioPlayButton(false);
  } else {
    try {
      const result = activeWave.play();
      if (result && typeof result.catch === "function") {
        result.catch((err) => console.warn("[audio] activeWave.play rejected:", err));
      }
    } catch (err) {
      console.warn("[audio] activeWave.play threw:", err);
    }
    setAudioPlayButton(true);
  }
}

function audioSeekFromTimelineEvent(event) {
  const timeline = document.getElementById("audio-timeline");
  if (!timeline) return;

  const rect = timeline.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

  const duration = getAudioSourceDuration(audioState.currentSrc);
  seekAudioSource(audioState.currentSrc, duration * ratio);
  updateAudioTransport(getAudioSourceCurrentTime(audioState.currentSrc), duration);
}

function syncAudioTransportFromPlayer() {
  const duration = getAudioSourceDuration(audioState.currentSrc);
  updateAudioTransport(getAudioSourceCurrentTime(audioState.currentSrc), duration);
  setAudioTransportEnabled(duration > 0);
  setAudioPlayButton(isAudioSourcePlaying(audioState.currentSrc));
}

function updateAudioTransport(current, duration) {
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const currentTime = document.getElementById("audio-current-time");
  const totalTime = document.getElementById("audio-total-time");
  const timelineFill = document.getElementById("audio-timeline-fill");
  const percent = safeDuration > 0 ? Math.min(100, Math.max(0, (safeCurrent / safeDuration) * 100)) : 0;

  if (currentTime) currentTime.textContent = formatAudioTime(safeCurrent);
  if (totalTime) totalTime.textContent = formatAudioTime(safeDuration);
  if (timelineFill) timelineFill.style.width = `${percent}%`;
}

function setAudioTransportEnabled(enabled) {
  const playBtn = document.getElementById("audio-play-btn");
  const timeline = document.getElementById("audio-timeline");
  if (playBtn) playBtn.disabled = !enabled;
  if (timeline) timeline.classList.toggle("disabled", !enabled);
}

function setAudioPlayButton(isPlaying) {
  const playBtn = document.getElementById("audio-play-btn");
  if (!playBtn) return;
  playBtn.innerHTML = isPlaying
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7z"/><path d="M13 5h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
}

function formatAudioTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getAudioAssetSrc(path) {
  const convertFileSrc =
    (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc)
    || ((p) => p);
  return convertFileSrc(path);
}

function getCssVar(name, fallback) {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

function renderAudioPresetCards() {
  document.querySelectorAll(".audio-preset-card").forEach((card) => {
    const preset = card.dataset.preset;
    const status = card.querySelector(".audio-preset-status");
    const progress = card.querySelector(".audio-preset-progress span");
    card.classList.remove("active", "processing", "disabled", "error");
    card.disabled = false;
    if (progress) progress.style.width = "0%";

    if (audioState.processing) {
      const isCurrent = preset === audioState.processingPreset;
      card.disabled = !isCurrent;
      card.classList.toggle("processing", isCurrent);
      card.classList.toggle("disabled", !isCurrent);
      if (status) {
        status.textContent = isCurrent
          ? `Traitement ${Math.round(audioState.processingProgress || 0)}%`
          : "En attente";
      }
      if (progress && isCurrent) progress.style.width = `${Math.min(audioState.processingProgress || 0, 100)}%`;
      return;
    }

    if (audioState.resultPath && audioState.currentPreset === preset) {
      card.classList.add("active");
      if (status) status.textContent = "✓ Applique";
      if (progress) progress.style.width = "100%";
      return;
    }

    if (audioState.lastErrorPreset === preset) {
      card.classList.add("error");
      if (status) status.textContent = "↻ Reessayer";
      return;
    }

    if (status) status.textContent = "Appliquer";
  });
}

function renderAudioAbToggle() {
  document.querySelectorAll("#audio-ab-toggle [data-audio-source]").forEach((button) => {
    button.classList.toggle("active", button.dataset.audioSource === audioState.currentSrc);
  });
}

function renderAudioApplyFullButton() {
  const btn = document.getElementById("audio-apply-full-btn");
  const hint = document.getElementById("audio-apply-full-hint");
  if (!btn) return;
  const hasMedia = Boolean(audioState.mediaPath);
  const isPreviewing = audioState.resultIsPreview;
  const fullStale = audioState.fullChainStale && Boolean(audioState.fullChainPath);
  const visible = hasMedia && (isPreviewing || fullStale);
  btn.classList.toggle("hidden", !visible);
  btn.disabled = audioState.processing || audioState.previewProcessing;
  if (audioState.processing) {
    btn.textContent = "Rendu en cours…";
  } else if (audioState.previewProcessing) {
    btn.textContent = "Aperçu en cours…";
  } else {
    btn.textContent = "Appliquer au fichier complet";
  }
  if (hint) {
    if (audioState.processing) {
      hint.textContent = "Traitement du fichier complet en cours…";
    } else if (audioState.previewProcessing) {
      hint.textContent = `Aperçu ${audioState.previewDurationSeconds || 5} s en cours…`;
    } else if (isPreviewing) {
      const start = formatAudioTime(audioState.previewStartSeconds || 0);
      hint.textContent = `Aperçu ${audioState.previewDurationSeconds || 5} s depuis ${start}`;
    } else if (fullStale) {
      hint.textContent = "Chaîne modifiée — rendu complet à refaire";
    } else {
      hint.textContent = "";
    }
    hint.classList.toggle("hidden", !visible);
  }
}

function renderAudioResultHeader() {
  const meta = document.getElementById("audio-result-meta");
  const title = document.querySelector("#audio-result-panel .audio-wave-title");
  if (!meta) return;
  if (!audioState.resultPath) {
    meta.textContent = "Preset appliqué";
    if (title) title.textContent = "Résultat";
    return;
  }
  if (audioState.resultIsPreview) {
    const start = formatAudioTime(audioState.previewStartSeconds || 0);
    meta.textContent = `Aperçu ${audioState.previewDurationSeconds || 5} s depuis ${start}`;
    if (title) title.textContent = "Aperçu";
    return;
  }
  const presetLabel = AUDIO_PRESET_LABELS[audioState.currentPreset] || "Preset appliqué";
  const resultName = getPathName(audioState.resultPath);
  meta.textContent = `${presetLabel} · ${resultName}`;
  if (title) title.textContent = "Résultat";
}

function renderAudioRefinePanel() {
  const panel = document.getElementById("audio-refine-panel");
  const body = document.getElementById("audio-refine-body");
  const chevron = document.getElementById("audio-refine-chevron");
  if (!panel || !body) return;
  const visible = Boolean(audioState.resultPath);
  panel.classList.toggle("hidden", !visible);
  body.classList.toggle("hidden", !visible || !audioState.refineOpen);
  panel.classList.toggle("open", visible && audioState.refineOpen);
  if (chevron) chevron.textContent = audioState.refineOpen ? "⌄" : "›";
  Object.entries(audioState.refineSliders).forEach(([key, value]) => {
    const input = panel.querySelector(`[data-audio-refine="${key}"]`);
    if (input && Number(input.value) !== value) input.value = value;
  });
}

function toggleAudioRefinePanel() {
  if (!audioState.resultPath) return;
  audioState.refineOpen = !audioState.refineOpen;
  renderAudioRefinePanel();
}

function updateAudioRefineSlider(key, value) {
  if (!Object.prototype.hasOwnProperty.call(audioState.refineSliders, key)) return;
  audioState.refineSliders[key] = clampNumber(Number(value), 0, 100);
  scheduleAudioChainRender(800);
}

function resetAudioRefineSliders() {
  resetAudioRefineState(audioState.refineOpen);
  renderAudioRefinePanel();
  scheduleAudioChainRender(800);
}

function resetAudioRefineState(open = false) {
  audioState.refineOpen = open;
  Object.keys(audioState.refineSliders).forEach((key) => {
    audioState.refineSliders[key] = 50;
  });
}

async function handleAudioPresetClick(presetKey) {
  if (!presetKey || !audioState.mediaPath || audioState.processing) return;
  if (audioState.resultPath && !audioState.resultIsPreview) {
    const message = audioState.currentPreset === presetKey
      ? "Relancer ce preset et remplacer le résultat actuel ?"
      : "Remplacer le résultat actuel par ce nouveau preset ?";
    const ok = await audioConfirm(message, { title: "Remplacer le résultat" });
    if (!ok) return;
  }
  await runAudioPreset(presetKey, {
    format: null,
    outputDir: null,
    revealOnSuccess: false,
  });
}

async function runAudioPreset(presetKey, options = {}) {
  if (!audioState.mediaPath || audioState.processing) return null;

  const token = ++audioOperationToken;
  const format = options.format || null;
  const outputDir = options.outputDir || null;
  audioState.processing = true;
  audioState.processingPreset = presetKey;
  audioState.processingProgress = 0;
  audioState.lastErrorPreset = null;
  audioUpdateUI();

  await startAudioProgressListener(token, presetKey);

  try {
    const result = await invoke("audio_apply_preset", {
      input: audioState.mediaPath,
      outputDir,
      preset: presetKey,
      format,
    });

    if (token !== audioOperationToken) return null;
    if (!result || result.success === false) {
      throw new Error((result && result.error) || "Traitement audio echoue");
    }

    const outputPath = result.outputPath || result.output_path;
    if (!outputPath) throw new Error("Aucun fichier de sortie retourne");

    destroyAudioPlayer("result");
    audioState.processing = false;
    audioState.processingPreset = null;
    audioState.processingProgress = 100;
    audioState.resultPath = outputPath;
    audioState.resultIsPreview = false;
    audioState.resultFormat = format;
    audioState.resultOutputDir = outputDir || getAudioDefaultOutputDir();
    audioState.resultDuration = null;
    audioState.currentPreset = presetKey;
    audioState.lastErrorPreset = null;
    audioState.fullChainPath = outputPath;
    audioState.fullChainStale = false;
    // NOTE: do NOT set currentSrc = "result" here. setActiveAudioSource fires
    // from the wave's "ready" event (activate: true) and needs to see the
    // previous source so the pause/play swap actually runs.
    resetAudioEffectChainForPreset(presetKey);
    resetAudioRefineState(false);
    audioUpdateUI();

    const previousTime = Math.min(getAudioSourceCurrentTime("original"), getAudioSourceDuration("original") || Infinity);
    requestAnimationFrame(() => loadAudioWaveform("result", outputPath, {
      activate: true,
      seekTime: Number.isFinite(previousTime) ? previousTime : 0,
    }));
    analyzeAudioFile(outputPath);
    showToast("Preset applique", 2200);
    return outputPath;
  } catch (err) {
    if (token === audioOperationToken) {
      audioState.processing = false;
      audioState.processingPreset = null;
      audioState.processingProgress = 0;
      audioState.lastErrorPreset = presetKey;
      audioUpdateUI();
      const message = err && err.message ? err.message : String(err);
      showToast("Erreur audio : " + message, 5000);
    }
    return null;
  } finally {
    if (token === audioOperationToken) {
      stopAudioProgressListener();
    }
  }
}

async function startAudioProgressListener(token, presetKey) {
  stopAudioProgressListener();
  const lst =
    (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen)
    || (typeof listen === "function" ? listen : null);
  if (!lst) return;

  try {
    audioProgressUnlisten = await lst("audio-progress", (event) => {
      if (token !== audioOperationToken) return;
      const payload = event.payload || {};
      const eventPreset = payload.preset || payload.preset_key;
      if (eventPreset && eventPreset !== presetKey) return;
      updateAudioPresetProgress(payload.percent || 0, payload.stage || "");
    });
  } catch (err) {
    console.error("[audio] progress listener setup failed:", err);
  }
}

function stopAudioProgressListener() {
  if (!audioProgressUnlisten) return;
  try {
    audioProgressUnlisten();
  } catch (err) {
    console.warn("[audio] progress unlisten failed:", err);
  }
  audioProgressUnlisten = null;
}

function updateAudioPresetProgress(percent, stage) {
  audioState.processingProgress = Math.min(100, Math.max(0, Number(percent) || 0));
  const card = document.querySelector(`.audio-preset-card[data-preset="${audioState.processingPreset}"]`);
  if (!card) return;
  const progress = card.querySelector(".audio-preset-progress span");
  const status = card.querySelector(".audio-preset-status");
  if (progress) progress.style.width = `${audioState.processingProgress}%`;
  if (status) {
    const label = stage === "finalizing" || audioState.processingProgress >= 99
      ? "Finalisation..."
      : `Traitement ${Math.round(audioState.processingProgress)}%`;
    status.textContent = label;
  }
}

function loadAudioWaveform(source, path, options = {}) {
  const container = getAudioWaveContainer(source);
  if (!container) return;

  destroyAudioPlayer(source);
  const token = ++audioLoadTokens[source];
  const seekTime = Number(options.seekTime || 0);

  container.classList.remove("error");
  container.classList.add("loading");
  container.textContent = "Chargement du waveform...";
  if (options.activate || audioState.currentSrc === source) {
    setAudioTransportEnabled(false);
    updateAudioTransport(0, getAudioSourceDuration(source));
  }

  const src = getAudioAssetSrc(path);
  const WaveSurferCtor = window.WaveSurfer;
  if (!WaveSurferCtor || typeof WaveSurferCtor.create !== "function") {
    renderAudioWaveFallback(source, src, "Impossible d'afficher ce fichier audio", options);
    return;
  }

  try {
    container.textContent = "";
    // Wavesurfer.renderMultiCanvas throws RangeError("Invalid array length") when the
    // container has 0 dimensions (hidden parent, just-attached panel, resize race).
    // Use a ResizeObserver-style retry loop and wrap the inner creation in its own
    // try/catch so RangeErrors from inside requestAnimationFrame don't bubble up
    // as uncaught promise rejections.
    let attempts = 0;
    const startCreate = () => {
      if (token !== audioLoadTokens[source]) return;
      const width = container.clientWidth || container.getBoundingClientRect().width || 0;
      const height = container.clientHeight || container.getBoundingClientRect().height || 0;
      if (!width || !height) {
        attempts += 1;
        if (attempts > 60) {
          // 60 frames ≈ 1 s with no layout — give up silently rather than spam.
          console.warn("[audio] wavesurfer container never gained size, skipping render");
          return;
        }
        requestAnimationFrame(startCreate);
        return;
      }
      let wave;
      try {
        wave = WaveSurferCtor.create({
          container,
          url: src,
          height: 100,
          waveColor: getCssVar("--text2", "#8a8f98"),
          progressColor: getCssVar("--accent", "#2563eb"),
          cursorColor: "#E8390C",
          cursorWidth: 2,
          barWidth: 2,
          barRadius: 2,
          barGap: 2,
          normalize: true,
          interact: true,
        });
      } catch (createErr) {
        console.warn("[audio] WaveSurfer.create failed, falling back:", createErr);
        renderAudioWaveFallback(source, src, "Impossible d'afficher ce fichier audio", options);
        return;
      }
      setAudioWave(source, wave);
      // Only the currently active source is audible. Mute non-active waves so
      // both can play in sync but the user only hears one at a time.
      try {
        if (typeof wave.setVolume === "function") {
          wave.setVolume(source === audioState.currentSrc ? 1 : 0);
        }
      } catch (_) { /* ignore */ }
      hookAudioWaveListeners(source, wave, container, token, options, src);
    };
    startCreate();
    return;
  } catch (err) {
    console.error("[audio] wavesurfer init failed:", err);
    renderAudioWaveFallback(source, src, "Impossible d'afficher ce fichier audio", options);
  }
}

function hookAudioWaveListeners(source, wave, container, token, options, src) {
  try {
    const seekTime = Number(options.seekTime || 0);

    trackAudioWaveSubscription(wave, wave.on("ready", () => {
      if (token !== audioLoadTokens[source]) return;
      container.classList.remove("loading");
      const duration = wave.getDuration();
      if (source === "original") audioState.mediaDuration = duration;
      if (source === "result") audioState.resultDuration = duration;
      if (seekTime > 0) seekAudioSource(source, seekTime);
      console.log("[audio] wave ready", source, "→ currentSrc=", audioState.currentSrc, "duration=", duration);
      if (options.activate || audioState.currentSrc === source) {
        // setActiveAudioSource will pause the previous wave, mute it, seek the
        // new wave, raise its volume, and resume playback if appropriate.
        setActiveAudioSource(source, { preservePosition: false });
      }
      if (source === audioState.currentSrc) attachAudioLiveMeter(wave);
    }));

    trackAudioWaveSubscription(wave, wave.on("timeupdate", (time) => {
      if (source !== audioState.currentSrc || token !== audioLoadTokens[source]) return;
      updateAudioTransport(time, wave.getDuration());
    }));
    trackAudioWaveSubscription(wave, wave.on("audioprocess", (time) => {
      if (source !== audioState.currentSrc || token !== audioLoadTokens[source]) return;
      updateAudioTransport(time, wave.getDuration());
    }));
    trackAudioWaveSubscription(wave, wave.on("seeking", (time) => {
      if (source !== audioState.currentSrc || token !== audioLoadTokens[source]) return;
      updateAudioTransport(time, wave.getDuration());
      // Keep the OTHER wave in sync so the mute-swap A/B stays aligned.
      const other = source === "original" ? "result" : "original";
      const otherWave = getAudioPlayer(other).wave;
      const otherDur = otherWave && typeof otherWave.getDuration === "function" ? otherWave.getDuration() : 0;
      if (otherWave && otherDur > 0) {
        try { otherWave.seekTo(Math.min(1, time / otherDur)); } catch (_) {}
      }
    }));
    trackAudioWaveSubscription(wave, wave.on("interaction", (time) => {
      if (source !== audioState.currentSrc || token !== audioLoadTokens[source]) return;
      const other = source === "original" ? "result" : "original";
      const otherWave = getAudioPlayer(other).wave;
      const otherDur = otherWave && typeof otherWave.getDuration === "function" ? otherWave.getDuration() : 0;
      if (otherWave && Number.isFinite(time) && otherDur > 0) {
        try { otherWave.seekTo(Math.min(1, time / otherDur)); } catch (_) {}
      }
    }));
    trackAudioWaveSubscription(wave, wave.on("play", () => {
      if (source === audioState.currentSrc) setAudioPlayButton(true);
    }));
    trackAudioWaveSubscription(wave, wave.on("pause", () => {
      if (source === audioState.currentSrc) setAudioPlayButton(false);
    }));
    trackAudioWaveSubscription(wave, wave.on("finish", () => {
      if (source !== audioState.currentSrc) return;
      setAudioPlayButton(false);
      updateAudioTransport(wave.getDuration(), wave.getDuration());
    }));
    trackAudioWaveSubscription(wave, wave.on("error", (err) => {
      if (token !== audioLoadTokens[source]) return;
      console.error("[audio] wavesurfer load error:", err);
      renderAudioWaveFallback(source, src, "Impossible d'afficher ce fichier audio", options);
    }));
  } catch (err) {
    console.error("[audio] wavesurfer init failed:", err);
    renderAudioWaveFallback(source, src, "Impossible d'afficher ce fichier audio", options);
  }
}

function destroyAudioPlayer(source) {
  audioLoadTokens[source] = (audioLoadTokens[source] || 0) + 1;

  const player = getAudioPlayer(source);
  if (player.wave) {
    if (audioMeterFor === player.wave) detachAudioLiveMeter();
    try {
      destroyAudioWaveInstance(player.wave);
    } catch (err) {
      console.warn("[audio] wavesurfer destroy failed:", err);
    } finally {
      setAudioWave(source, null);
    }
  }

  if (player.fallback) {
    try {
      player.fallback.pause();
      player.fallback.removeAttribute("src");
      player.fallback.load();
    } catch (err) {
      console.warn("[audio] fallback cleanup failed:", err);
    }
    setAudioFallback(source, null);
  }

  const container = getAudioWaveContainer(source);
  if (container) {
    container.replaceChildren();
    container.classList.remove("loading", "error");
  }
}

function trackAudioWaveSubscription(wave, unsubscribe) {
  if (typeof unsubscribe !== "function") return;
  if (!wave.__loadlinkUnsubs) wave.__loadlinkUnsubs = [];
  wave.__loadlinkUnsubs.push(unsubscribe);
}

function destroyAudioWaveInstance(wave) {
  if (!wave) return;
  try {
    if (typeof wave.pause === "function") wave.pause();
  } catch (err) {
    console.warn("[audio] wavesurfer pause before destroy failed:", err);
  }
  if (Array.isArray(wave.__loadlinkUnsubs)) {
    wave.__loadlinkUnsubs.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (err) {
        console.warn("[audio] wavesurfer listener cleanup failed:", err);
      }
    });
  }
  if (typeof wave.unAll === "function") {
    try {
      wave.unAll();
    } catch (err) {
      console.warn("[audio] wavesurfer unAll failed:", err);
    }
  }
  if (typeof wave.empty === "function") {
    try {
      wave.empty();
    } catch (err) {
      console.warn("[audio] wavesurfer empty failed:", err);
    }
  }
  wave.destroy();
}

function renderAudioWaveFallback(source, src, message, options = {}) {
  const container = getAudioWaveContainer(source);
  if (!container) return;

  const player = getAudioPlayer(source);
  if (player.wave) {
    try {
      destroyAudioWaveInstance(player.wave);
    } catch (err) {
      console.warn("[audio] wavesurfer fallback destroy failed:", err);
    }
    setAudioWave(source, null);
  }

  container.classList.remove("loading");
  container.classList.add("error");
  container.innerHTML = "";

  const error = document.createElement("div");
  error.className = "audio-wave-error";
  error.textContent = message;

  const audio = document.createElement("audio");
  audio.className = "audio-native-fallback";
  audio.controls = true;
  audio.src = src;
  setAudioFallback(source, audio);

  audio.addEventListener("loadedmetadata", () => {
    const duration = audio.duration || 0;
    if (source === "original") audioState.mediaDuration = duration;
    if (source === "result") audioState.resultDuration = duration;
    if (options.seekTime) seekAudioSource(source, options.seekTime);
    if (options.activate || audioState.currentSrc === source) {
      setActiveAudioSource(source, { preservePosition: false });
    }
  });
  audio.addEventListener("timeupdate", () => {
    if (source === audioState.currentSrc) updateAudioTransport(audio.currentTime || 0, audio.duration || 0);
  });
  audio.addEventListener("play", () => {
    if (source === audioState.currentSrc) setAudioPlayButton(true);
  });
  audio.addEventListener("pause", () => {
    if (source === audioState.currentSrc) setAudioPlayButton(false);
  });
  audio.addEventListener("ended", () => {
    if (source === audioState.currentSrc) setAudioPlayButton(false);
  });
  audio.addEventListener("error", () => {
    if (source === audioState.currentSrc) {
      setAudioTransportEnabled(false);
      updateAudioTransport(0, 0);
    }
  });

  container.append(error, audio);
}

function getAudioWaveContainer(source) {
  return document.getElementById(source === "result" ? "audio-waveform-result" : "audio-waveform-original");
}

function getAudioPlayer(source) {
  return {
    wave: source === "result" ? audioResultWave : audioOriginalWave,
    fallback: source === "result" ? audioResultFallbackEl : audioOriginalFallbackEl,
  };
}

function setAudioWave(source, wave) {
  if (source === "result") audioResultWave = wave;
  else audioOriginalWave = wave;
}

function setAudioFallback(source, fallback) {
  if (source === "result") audioResultFallbackEl = fallback;
  else audioOriginalFallbackEl = fallback;
}

function setActiveAudioSource(source, options = {}) {
  if (source === "result" && !audioState.resultPath) {
    showToast("Applique un preset d'abord pour entendre le résultat", 2400);
    return;
  }
  if (source === audioState.currentSrc) {
    if (Number.isFinite(options.seekTime) && options.seekTime > 0) {
      seekAudioSource(source, options.seekTime);
    }
    renderAudioAbToggle();
    syncAudioTransportFromPlayer();
    return;
  }
  const previousSrc = audioState.currentSrc;
  const original = audioOriginalWave;
  const result = audioResultWave;
  const previousWave = previousSrc === "result" ? result : original;
  const newWave = source === "result" ? result : original;
  const wasPlaying = previousWave && typeof previousWave.isPlaying === "function"
    ? (() => { try { return previousWave.isPlaying(); } catch (_) { return false; } })()
    : false;
  const previousTime = options.preservePosition === false
    ? 0
    : (previousWave && typeof previousWave.getCurrentTime === "function"
        ? (() => { try { return previousWave.getCurrentTime() || 0; } catch (_) { return 0; } })()
        : 0);

  audioState.currentSrc = source;

  // Pause the previous wave — single-wave-playing model. The mute is also set
  // to 0 in case anything else ever asks it to play.
  if (previousWave) {
    try { if (typeof previousWave.pause === "function") previousWave.pause(); } catch (_) {}
    try { if (typeof previousWave.setVolume === "function") previousWave.setVolume(0); } catch (_) {}
  }

  // Sync position on the new wave so the user picks up where they were.
  if (newWave && previousTime > 0) {
    const dur = typeof newWave.getDuration === "function"
      ? (() => { try { return newWave.getDuration() || 0; } catch (_) { return 0; } })()
      : 0;
    if (dur > 0) {
      try { newWave.seekTo(Math.min(1, previousTime / dur)); } catch (_) {}
    }
  }

  // Bring the new wave up to full volume and play if we were playing.
  if (newWave) {
    try { if (typeof newWave.setVolume === "function") newWave.setVolume(1); } catch (_) {}
    if (wasPlaying) {
      try {
        const p = newWave.play();
        if (p && typeof p.catch === "function") p.catch((err) => console.warn("[audio] newWave.play rejected:", err));
      } catch (err) {
        console.warn("[audio] newWave.play threw:", err);
      }
      setAudioPlayButton(true);
    } else {
      setAudioPlayButton(false);
    }
  } else {
    console.warn("[audio] new source has no wave yet:", source,
      "resultPath=", audioState.resultPath, "currentPreset=", audioState.currentPreset);
    setAudioPlayButton(false);
  }

  // Hook the VU meter to the now-active wave so the L/R footer matches what
  // the user hears.
  if (newWave) attachAudioLiveMeter(newWave);

  console.log("[audio] active source →", source,
    "wasPlaying=", wasPlaying, "previousTime=", previousTime,
    "newWave?", Boolean(newWave));
  renderAudioAbToggle();
  syncAudioTransportFromPlayer();
  syncAudioFxToggle();
}

function syncAudioFxToggle() {
  const fxBtn = document.getElementById("audio-shared-fx-toggle");
  if (!fxBtn) return;
  const playingResult = audioState.currentSrc === "result";
  audioState.fxOnPreview = playingResult;
  fxBtn.classList.toggle("active", playingResult);
  fxBtn.disabled = !audioState.resultPath;
  fxBtn.title = audioState.resultPath
    ? "Preview rapide : alterne entre son brut et son traité"
    : "Applique d'abord un preset pour activer le preview FX";
}

function getAudioSourceCurrentTime(source) {
  const player = getAudioPlayer(source);
  if (player.wave && typeof player.wave.getCurrentTime === "function") return player.wave.getCurrentTime() || 0;
  if (player.fallback) return player.fallback.currentTime || 0;
  return 0;
}

function getAudioSourceDuration(source) {
  const player = getAudioPlayer(source);
  if (player.wave && typeof player.wave.getDuration === "function") return player.wave.getDuration() || 0;
  if (player.fallback) return player.fallback.duration || 0;
  return source === "result" ? (audioState.resultDuration || 0) : (audioState.mediaDuration || 0);
}

function seekAudioSource(source, time) {
  const duration = getAudioSourceDuration(source);
  if (!duration || !Number.isFinite(duration)) return;
  const safeTime = Math.min(Math.max(time || 0, 0), duration);
  // Seek BOTH waves so they stay in lock-step (mute-swap A/B model).
  const fraction = safeTime / duration;
  ["original", "result"].forEach((s) => {
    const wave = getAudioPlayer(s).wave;
    if (wave && typeof wave.seekTo === "function") {
      try { wave.seekTo(fraction); } catch (_) { /* ignore */ }
    }
  });
  const player = getAudioPlayer(source);
  if (!player.wave && player.fallback) player.fallback.currentTime = safeTime;
}

function pauseAudioSource(source) {
  const player = getAudioPlayer(source);
  if (player.wave && typeof player.wave.pause === "function") {
    try { player.wave.pause(); } catch (_) {}
  }
  if (player.fallback && !player.fallback.paused) player.fallback.pause();
}

function isAudioSourcePlaying(source) {
  const player = getAudioPlayer(source);
  if (player.wave && typeof player.wave.isPlaying === "function") {
    try { return player.wave.isPlaying(); } catch (_) { return false; }
  }
  return Boolean(player.fallback && !player.fallback.paused);
}

function openAudioExportModal() {
  if (!audioState.resultPath || audioState.resultIsPreview) {
    showToast("Applique d'abord la chaîne au fichier complet", 2800);
    return;
  }
  audioState.exportDir = getAudioDefaultOutputDir();
  audioState.exportProcessing = false;
  if (!audioState.exportName) {
    const baseName = getPathName(audioState.mediaPath || "").replace(/\.[^.]+$/, "") || "export";
    audioState.exportName = `${baseName}_master`;
  }
  document.querySelectorAll('input[name="audio-export-format"]').forEach((input) => {
    input.checked = input.value === audioState.exportFormat;
  });
  renderAudioExportQualityPanel();
  renderAudioExportMetadataFields();
  updateAudioExportModal();
  document.getElementById("audio-export-modal")?.classList.remove("hidden");
}

function closeAudioExportModal() {
  if (audioState.exportProcessing) return;
  document.getElementById("audio-export-modal")?.classList.add("hidden");
}

async function chooseAudioExportDir() {
  if (audioState.exportProcessing) return;
  try {
    const tauriOpen =
      (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open)
      || (typeof open === "function" ? open : null);
    if (!tauriOpen) throw new Error("Dialogue Tauri non disponible");
    const selected = await tauriOpen({ directory: true, multiple: false });
    if (!selected) return;
    audioState.exportDir = Array.isArray(selected) ? selected[0] : selected;
    updateAudioExportModal();
  } catch (err) {
    console.error("[audio] export folder picker failed:", err);
    showToast("Impossible de choisir le dossier", 3000);
  }
}

function renderAudioExportQualityPanel() {
  const panel = document.getElementById("audio-export-quality");
  if (!panel) return;
  const fmt = audioState.exportFormat;
  let body = "";
  if (fmt === "wav") {
    body = `
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Sample rate</label>
        <div class="audio-export-quality-pills" data-quality-key="sampleRate">
          ${[44100, 48000, 96000].map((sr) => `<button type="button" class="audio-quality-pill${audioState.exportSampleRate === sr ? " active" : ""}" data-value="${sr}">${sr === 44100 ? "44.1 kHz" : sr === 48000 ? "48 kHz" : "96 kHz"}</button>`).join("")}
        </div>
      </div>
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Bit depth</label>
        <div class="audio-export-quality-pills" data-quality-key="bitDepth">
          ${[16, 24, 32].map((bd) => `<button type="button" class="audio-quality-pill${audioState.exportBitDepth === bd ? " active" : ""}" data-value="${bd}">${bd}-bit${bd === 32 ? " float" : ""}</button>`).join("")}
        </div>
      </div>
    `;
  } else if (fmt === "flac") {
    body = `
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Sample rate</label>
        <div class="audio-export-quality-pills" data-quality-key="sampleRate">
          ${[44100, 48000, 96000].map((sr) => `<button type="button" class="audio-quality-pill${audioState.exportSampleRate === sr ? " active" : ""}" data-value="${sr}">${sr === 44100 ? "44.1 kHz" : sr === 48000 ? "48 kHz" : "96 kHz"}</button>`).join("")}
        </div>
      </div>
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Bit depth</label>
        <div class="audio-export-quality-pills" data-quality-key="bitDepth">
          ${[16, 24].map((bd) => `<button type="button" class="audio-quality-pill${audioState.exportBitDepth === bd ? " active" : ""}" data-value="${bd}">${bd}-bit</button>`).join("")}
        </div>
      </div>
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Compression (0-12)</label>
        <input type="range" min="0" max="12" step="1" value="${audioState.exportFlacLevel}" data-quality-key="flacLevel" />
        <strong data-quality-display="flacLevel">${audioState.exportFlacLevel}</strong>
      </div>
    `;
  } else if (fmt === "mp3") {
    body = `
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Mode</label>
        <div class="audio-export-quality-pills" data-quality-key="mp3Mode">
          <button type="button" class="audio-quality-pill${audioState.exportMp3Mode === "cbr" ? " active" : ""}" data-value="cbr">CBR (débit fixe)</button>
          <button type="button" class="audio-quality-pill${audioState.exportMp3Mode === "vbr" ? " active" : ""}" data-value="vbr">VBR (qualité)</button>
        </div>
      </div>
      ${audioState.exportMp3Mode === "cbr"
        ? `<div class="audio-export-quality-row">
            <label class="audio-export-quality-label">Débit</label>
            <div class="audio-export-quality-pills" data-quality-key="mp3Quality">
              ${[128, 160, 192, 256, 320].map((b) => `<button type="button" class="audio-quality-pill${audioState.exportMp3Quality === b ? " active" : ""}" data-value="${b}">${b} kbps</button>`).join("")}
            </div>
           </div>`
        : `<div class="audio-export-quality-row">
            <label class="audio-export-quality-label">Qualité VBR (0=meilleur)</label>
            <input type="range" min="0" max="9" step="1" value="${Math.min(9, audioState.exportMp3Quality)}" data-quality-key="mp3Quality" />
            <strong data-quality-display="mp3Quality">${Math.min(9, audioState.exportMp3Quality)}</strong>
           </div>`
      }
    `;
  } else if (fmt === "aac") {
    body = `
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Débit</label>
        <div class="audio-export-quality-pills" data-quality-key="aacBitrate">
          ${[128, 160, 192, 256].map((b) => `<button type="button" class="audio-quality-pill${audioState.exportAacBitrate === b ? " active" : ""}" data-value="${b}">${b} kbps</button>`).join("")}
        </div>
      </div>
    `;
  } else if (fmt === "opus") {
    body = `
      <div class="audio-export-quality-row">
        <label class="audio-export-quality-label">Débit</label>
        <div class="audio-export-quality-pills" data-quality-key="aacBitrate">
          ${[64, 96, 128, 160, 192].map((b) => `<button type="button" class="audio-quality-pill${audioState.exportAacBitrate === b ? " active" : ""}" data-value="${b}">${b} kbps</button>`).join("")}
        </div>
      </div>
    `;
  } else {
    body = `<p class="audio-export-quality-info">Conserve l'extension du fichier source : <strong>${getPathExtension(audioState.mediaPath || "") || "wav"}</strong></p>`;
  }
  panel.innerHTML = body;

  panel.querySelectorAll("[data-quality-key]").forEach((el) => {
    if (el.tagName === "INPUT") {
      el.addEventListener("input", () => {
        const key = el.dataset.qualityKey;
        const value = Number(el.value);
        if (key === "flacLevel") audioState.exportFlacLevel = value;
        if (key === "mp3Quality") audioState.exportMp3Quality = value;
        const display = panel.querySelector(`[data-quality-display="${key}"]`);
        if (display) display.textContent = String(value);
      });
    } else {
      el.querySelectorAll("[data-value]").forEach((pill) => {
        pill.addEventListener("click", () => {
          const key = el.dataset.qualityKey;
          const rawValue = pill.dataset.value;
          const value = Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
          if (key === "sampleRate") audioState.exportSampleRate = value;
          if (key === "bitDepth") audioState.exportBitDepth = value;
          if (key === "mp3Mode") {
            audioState.exportMp3Mode = value;
            if (value === "vbr" && audioState.exportMp3Quality > 9) audioState.exportMp3Quality = 2;
            if (value === "cbr" && audioState.exportMp3Quality < 64) audioState.exportMp3Quality = 320;
          }
          if (key === "mp3Quality") audioState.exportMp3Quality = value;
          if (key === "aacBitrate") audioState.exportAacBitrate = value;
          if (key === "flacLevel") audioState.exportFlacLevel = value;
          renderAudioExportQualityPanel();
        });
      });
    }
  });
}

function renderAudioExportMetadataFields() {
  const ids = ["title", "artist", "album", "year", "genre", "comment"];
  ids.forEach((field) => {
    const el = document.getElementById(`audio-export-meta-${field}`);
    if (el) el.value = audioState.exportMetadata[field] || "";
  });
}

function updateAudioExportMetadataFromForm() {
  const ids = ["title", "artist", "album", "year", "genre", "comment"];
  ids.forEach((field) => {
    const el = document.getElementById(`audio-export-meta-${field}`);
    if (el) audioState.exportMetadata[field] = el.value;
  });
}

async function confirmAudioExport() {
  if (!audioState.resultPath || audioState.resultIsPreview || audioState.exportProcessing) return;
  const selectedFormat = document.querySelector('input[name="audio-export-format"]:checked')?.value || audioState.exportFormat;
  audioState.exportFormat = selectedFormat;
  const outputDir = audioState.exportDir || getAudioDefaultOutputDir();
  const nameInput = document.getElementById("audio-export-name-input");
  if (nameInput) audioState.exportName = nameInput.value.trim();
  updateAudioExportMetadataFromForm();

  const sourceForExport = audioState.fullChainPath || audioState.resultPath;
  if (!sourceForExport) {
    showToast("Aucun fichier prêt à exporter", 2800);
    return;
  }

  const metadata = {};
  ["title", "artist", "album", "year", "genre", "comment"].forEach((field) => {
    const value = audioState.exportMetadata[field];
    if (value && value.trim()) metadata[field] = value.trim();
  });

  audioState.exportProcessing = true;
  updateAudioExportModal();

  try {
    const result = await invoke("audio_export", {
      req: {
        input: sourceForExport,
        outputDir,
        outputName: audioState.exportName || null,
        format: selectedFormat,
        sampleRate: audioState.exportSampleRate,
        bitDepth: audioState.exportBitDepth,
        mp3Mode: audioState.exportMp3Mode,
        mp3Quality: audioState.exportMp3Quality,
        flacLevel: audioState.exportFlacLevel,
        aacBitrate: audioState.exportAacBitrate,
        metadata: Object.keys(metadata).length ? metadata : null,
      },
    });
    audioState.exportProcessing = false;
    updateAudioExportModal();

    if (!result || result.success === false) {
      throw new Error((result && result.error) || "Export échoué");
    }
    const outputPath = result.outputPath || result.output_path;
    if (outputPath) {
      await revealAudioOutput(outputPath);
      showToast("Export terminé", 2200);
      closeAudioExportModal();
    }
  } catch (err) {
    audioState.exportProcessing = false;
    updateAudioExportModal();
    const message = err && err.message ? err.message : String(err);
    showToast("Erreur export : " + message, 5000);
  }
}

function updateAudioExportModal() {
  const input = document.getElementById("audio-export-folder-input");
  const label = document.getElementById("audio-export-folder-label");
  const nameInput = document.getElementById("audio-export-name-input");
  const confirmBtn = document.getElementById("audio-export-confirm");
  const dir = audioState.exportDir || getAudioDefaultOutputDir();
  if (input) input.value = dir || "LoadLink-Audio";
  if (label) label.textContent = "Choisir";
  if (nameInput && document.activeElement !== nameInput) nameInput.value = audioState.exportName || "";
  if (confirmBtn) {
    confirmBtn.disabled = audioState.exportProcessing;
    confirmBtn.textContent = audioState.exportProcessing ? "Export en cours…" : "Exporter";
  }
}

async function revealAudioOutput(path) {
  if (!path) return;
  try {
    await invoke("reveal_path", { path });
  } catch (err) {
    console.warn("[audio] reveal_path failed, fallback to folder:", err);
    const folder = getPathDir(path);
    if (folder) await invoke("open_folder", { path: folder });
  }
}

function getAudioDefaultOutputDir() {
  const sourceDir = getPathDir(audioState.mediaPath || "");
  return sourceDir ? joinPath(sourceDir, "LoadLink-Audio") : "";
}

function joinPath(dir, child) {
  if (!dir) return child;
  const separator = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + child : dir + separator + child;
}

function normalizeAudioPath(path) {
  return String(path || "").replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
}

async function analyzeAudioFile(path) {
  if (!path) return;
  const token = ++audioAnalyzeToken;
  try {
    const analysis = await invoke("audio_analyze", { input: path });
    if (token !== audioAnalyzeToken) return;
    if (path !== audioState.mediaPath && path !== audioState.resultPath) return;
    audioState.analysis = analysis;
    renderAudioMeters();
  } catch (err) {
    if (token !== audioAnalyzeToken) return;
    console.warn("[audio] analyze failed:", err);
    audioState.analysis = null;
    renderAudioMeters();
  }
}

function renderAudioMeters() {
  const analysis = audioState.analysis || {};
  const peak = Number.isFinite(analysis.peakDbfs) ? analysis.peakDbfs : null;
  const lufs = Number.isFinite(analysis.loudnessLufs) ? analysis.loudnessLufs : null;
  const peakPercent = peak === null ? 0 : dbToPercent(peak);
  const lFill = document.getElementById("audio-meter-l-fill");
  const rFill = document.getElementById("audio-meter-r-fill");
  const lPeak = document.getElementById("audio-meter-l-peak");
  const rPeak = document.getElementById("audio-meter-r-peak");
  const lufsValue = document.getElementById("audio-lufs-value");
  const lufsShort = document.getElementById("audio-lufs-short");
  const peakValue = document.getElementById("audio-peak-value");

  if (lFill) lFill.style.width = `${peakPercent}%`;
  if (rFill) rFill.style.width = `${Math.max(0, peakPercent - 6)}%`;
  if (lPeak) lPeak.style.left = `${Math.min(100, peakPercent + 3)}%`;
  if (rPeak) rPeak.style.left = `${Math.min(100, Math.max(0, peakPercent - 2))}%`;
  if (lufsValue) lufsValue.textContent = lufs === null ? "--" : lufs.toFixed(1);
  if (lufsShort) lufsShort.textContent = lufs === null ? "-- Short Term" : `${(lufs + 0.4).toFixed(1)} Short Term`;
  if (peakValue) peakValue.textContent = peak === null ? "--" : peak.toFixed(1);
  renderAudioCompressorGainReduction();
  if (audioState.userLevel === "amateur") renderAudioAmateurLufs();
}

function dbToPercent(db) {
  const clamped = Math.min(0, Math.max(-60, db));
  return ((clamped + 60) / 60) * 100;
}

function ensureAudioMeterContext() {
  if (audioMeterCtx && audioMeterCtx.state !== "closed") return audioMeterCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioMeterCtx = new Ctx();
    return audioMeterCtx;
  } catch (err) {
    console.warn("[audio] AudioContext init failed:", err);
    return null;
  }
}

function attachAudioLiveMeterToMaster() {
  // VU meter is attached to the dedicated <audio> master so the bars react to
  // whatever buffer is currently playing (original or result), regardless of
  // which wavesurfer instance is rendering the waveform.
  const audio = getAudioMasterEl();
  if (!audio) return;
  if (audioMeterFor === audio) {
    if (audioMeterCtx?.state === "suspended") audioMeterCtx.resume().catch(() => {});
    return;
  }
  detachAudioLiveMeter();
  const ctx = ensureAudioMeterContext();
  if (!ctx) return;
  try {
    let source = audio.__loadlinkMediaSource;
    if (!source) {
      source = ctx.createMediaElementSource(audio);
      audio.__loadlinkMediaSource = source;
    }
    const splitter = ctx.createChannelSplitter(2);
    const lAnalyser = ctx.createAnalyser();
    const rAnalyser = ctx.createAnalyser();
    lAnalyser.fftSize = 1024;
    rAnalyser.fftSize = 1024;
    lAnalyser.smoothingTimeConstant = 0.2;
    rAnalyser.smoothingTimeConstant = 0.2;
    try { source.disconnect(); } catch (_) { /* may not be connected yet */ }
    source.connect(splitter);
    splitter.connect(lAnalyser, 0);
    splitter.connect(rAnalyser, 1);
    source.connect(ctx.destination);
    audioMeterFor = audio;
    audioMeterAnalysers = { lAnalyser, rAnalyser, source, splitter, audio };
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!audioMeterRafId) audioMeterRafId = requestAnimationFrame(audioMeterLoop);
  } catch (err) {
    console.warn("[audio] master meter attach failed:", err);
  }
}

function attachAudioLiveMeter(wave) {
  try {
    if (!wave || typeof wave.getMediaElement !== "function") return;
    if (audioMeterFor === wave) {
      if (audioMeterCtx?.state === "suspended") audioMeterCtx.resume().catch(() => {});
      return;
    }
    detachAudioLiveMeter();
    const audio = wave.getMediaElement();
    if (!audio) return;
    const ctx = ensureAudioMeterContext();
    if (!ctx) return;

    // An HTMLMediaElement can be wrapped in a MediaElementSource only once across
    // the document. Cache the node on the element itself so swapping back to a
    // previously analysed wave reuses the same source instead of throwing.
    let source = audio.__loadlinkMediaSource;
    if (!source) {
      source = ctx.createMediaElementSource(audio);
      audio.__loadlinkMediaSource = source;
    }
    const splitter = ctx.createChannelSplitter(2);
    const lAnalyser = ctx.createAnalyser();
    const rAnalyser = ctx.createAnalyser();
    lAnalyser.fftSize = 1024;
    rAnalyser.fftSize = 1024;
    lAnalyser.smoothingTimeConstant = 0.2;
    rAnalyser.smoothingTimeConstant = 0.2;
    try { source.disconnect(); } catch (_) { /* may not be connected yet */ }
    source.connect(splitter);
    splitter.connect(lAnalyser, 0);
    splitter.connect(rAnalyser, 1);
    source.connect(ctx.destination);

    audioMeterFor = wave;
    audioMeterAnalysers = { lAnalyser, rAnalyser, source, splitter, audio };
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!audioMeterRafId) audioMeterRafId = requestAnimationFrame(audioMeterLoop);
  } catch (err) {
    console.warn("[audio] meter attach failed:", err);
  }
}

function detachAudioLiveMeter() {
  if (audioMeterRafId) {
    cancelAnimationFrame(audioMeterRafId);
    audioMeterRafId = null;
  }
  if (audioMeterAnalysers) {
    try {
      audioMeterAnalysers.splitter?.disconnect();
      audioMeterAnalysers.lAnalyser?.disconnect();
      audioMeterAnalysers.rAnalyser?.disconnect();
    } catch (_) { /* ignore */ }
  }
  audioMeterAnalysers = null;
  audioMeterFor = null;
  audioMeterPeakL = 0;
  audioMeterPeakR = 0;
  audioMeterPeakHoldL = 0;
  audioMeterPeakHoldR = 0;
}

function audioMeterLoop() {
  audioMeterRafId = null;
  if (!audioMeterAnalysers) return;
  const { lAnalyser, rAnalyser } = audioMeterAnalysers;
  const bufL = new Uint8Array(lAnalyser.fftSize);
  const bufR = new Uint8Array(rAnalyser.fftSize);
  lAnalyser.getByteTimeDomainData(bufL);
  rAnalyser.getByteTimeDomainData(bufR);

  const peakL = computeAudioMeterPeak(bufL);
  const peakR = computeAudioMeterPeak(bufR);

  audioMeterPeakL = peakL > audioMeterPeakL ? peakL : audioMeterPeakL * 0.86;
  audioMeterPeakR = peakR > audioMeterPeakR ? peakR : audioMeterPeakR * 0.86;

  audioMeterPeakHoldL = peakL > audioMeterPeakHoldL ? peakL : audioMeterPeakHoldL - 0.005;
  audioMeterPeakHoldR = peakR > audioMeterPeakHoldR ? peakR : audioMeterPeakHoldR - 0.005;

  const lFill = document.getElementById("audio-meter-l-fill");
  const rFill = document.getElementById("audio-meter-r-fill");
  const lPeak = document.getElementById("audio-meter-l-peak");
  const rPeak = document.getElementById("audio-meter-r-peak");
  if (lFill) {
    lFill.style.width = `${(audioMeterPeakL * 100).toFixed(1)}%`;
    lFill.className = `audio-meter-fill ${audioRecordLevelClass(audioMeterPeakL)}`;
  }
  if (rFill) {
    rFill.style.width = `${(audioMeterPeakR * 100).toFixed(1)}%`;
    rFill.className = `audio-meter-fill ${audioRecordLevelClass(audioMeterPeakR)}`;
  }
  if (lPeak) lPeak.style.left = `${Math.min(100, (audioMeterPeakHoldL * 100)).toFixed(1)}%`;
  if (rPeak) rPeak.style.left = `${Math.min(100, (audioMeterPeakHoldR * 100)).toFixed(1)}%`;

  audioMeterRafId = requestAnimationFrame(audioMeterLoop);
}

function computeAudioMeterPeak(buffer) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = Math.abs(buffer[i] - 128) / 128;
    if (v > peak) peak = v;
  }
  return peak;
}

function audioStopTransientListeners() {
  stopAudioProgressListener();
}

async function resetAudioWithConfirm() {
  if (!audioState.mediaPath) return;
  const message = audioState.processing
    ? "Annuler le traitement en cours et abandonner ce fichier ?"
    : "Abandonner ce fichier et son projet courant ?";
  const ok = await audioConfirm(message, {
    title: "Recommencer",
    confirmLabel: "Recommencer",
  });
  if (!ok) return;
  resetAudioState();
}

function resetAudioState() {
  audioOperationToken += 1;
  audioAnalyzeToken += 1;
  audioPreviewToken += 1;
  audioPreviewPending = false;
  clearTimeout(audioPreviewDebounce);
  stopAudioProgressListener();
  destroyAudioPlayer("original");
  destroyAudioPlayer("result");
  audioState.mediaPath = null;
  audioState.mediaName = null;
  audioState.mediaSize = null;
  audioState.mediaDuration = null;
  audioState.resultDuration = null;
  audioState.currentPreset = null;
  audioState.processing = false;
  audioState.processingPreset = null;
  audioState.processingProgress = 0;
  audioState.chainProcessing = false;
  audioState.chainPending = false;
  audioState.resultPath = null;
  audioState.resultIsPreview = false;
  audioState.previewProcessing = false;
  audioState.previewStartSeconds = 0;
  audioState.fullChainPath = null;
  audioState.fullChainStale = false;
  audioState.resultFormat = null;
  audioState.resultOutputDir = null;
  audioState.currentSrc = "original";
  audioState.lastErrorPreset = null;
  audioState.exportDir = null;
  audioState.exportProcessing = false;
  audioState.refineOpen = false;
  resetAudioRefineState(false);
  audioState.analysis = null;
  audioState.studioTab = "edit";
  audioState.markers = [];
  audioState.track = { mute: false, solo: false, gainDb: 0, pan: 0 };
  audioState.extraTracks = [];
  audioState.masterGainDb = 0;
  audioState.proChainSnapshot = null;
  audioState.proMasterSnapshot = null;
  resetAudioHistory();
  detachAudioLiveMeter();
  ["audio-meter-l-fill", "audio-meter-r-fill"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.width = "0%";
  });
  ["audio-meter-l-peak", "audio-meter-r-peak"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.left = "0%";
  });
  document.getElementById("audio-export-modal")?.classList.add("hidden");
  audioUpdateUI();
}

async function openAudioSourceFolder() {
  const folder = getPathDir(audioState.mediaPath || "");
  if (!folder) return;
  try {
    await invoke("open_folder", { path: folder });
  } catch (err) {
    console.error("[audio] open source folder failed:", err);
    showToast("Impossible d'ouvrir le dossier source", 3000);
  }
}

function isSupportedAudioPath(path) {
  const ext = getPathExtension(path);
  return AUDIO_SUPPORTED_EXTENSIONS.includes(ext);
}

function getPathExtension(path) {
  const name = getPathName(path);
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function getPathName(path) {
  return String(path).split(/[\\/]/).pop() || String(path);
}

function getPathDir(path) {
  const normalized = String(path);
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return idx > 0 ? normalized.slice(0, idx) : "";
}

// ============================================
// PHASE 3 - CONVERT MODULE
// Leading semicolon to safely break from previous IIFE
// All code defined here; init called at the very end (no nested IIFE)
// ============================================

// ===== OPTIONS LISTS =====
const VIDEO_FORMATS_CONV = [
  { key: "mp4", label: "MP4", desc: "Standard universel" },
  { key: "webm", label: "WEBM", desc: "Web, plus leger" },
  { key: "mov", label: "MOV", desc: "Apple ProRes-compatible" },
  { key: "mkv", label: "MKV", desc: "Conteneur flexible" },
  { key: "avi", label: "AVI", desc: "Ancien standard" },
];

const VIDEO_CODECS = [
  { key: "auto", label: "Auto (conserver)", desc: "Selon le format de sortie" },
  { key: "h264", label: "H.264 / AVC", desc: "Compatibilite maximale" },
  { key: "h265", label: "H.265 / HEVC", desc: "50% plus petit que H.264" },
  { key: "vp9", label: "VP9", desc: "Open source, qualite elevee" },
  { key: "av1", label: "AV1", desc: "Tres efficace, encodage lent" },
];

const VIDEO_BITRATES = [
  { key: "auto", label: "Auto", desc: "Conserve le bitrate source" },
  { key: "1000", label: "1 Mbps", desc: "Tres leger" },
  { key: "3000", label: "3 Mbps", desc: "Standard 720p" },
  { key: "5000", label: "5 Mbps", desc: "Bonne qualite 1080p" },
  { key: "10000", label: "10 Mbps", desc: "Haute qualite 1080p" },
  { key: "20000", label: "20 Mbps", desc: "4K standard" },
  { key: "50000", label: "50 Mbps", desc: "4K master" },
];

const VIDEO_RESOLUTIONS = [
  { key: "auto", label: "Auto (conserver)", desc: "Resolution source" },
  { key: "3840x2160", label: "4K (3840x2160)", desc: "Ultra HD" },
  { key: "1920x1080", label: "1080p (1920x1080)", desc: "Full HD" },
  { key: "1280x720", label: "720p (1280x720)", desc: "HD" },
  { key: "854x480", label: "480p (854x480)", desc: "Standard" },
];

const VIDEO_FPS_LIST = [
  { key: "auto", label: "Auto (conserver)", desc: "FPS source" },
  { key: "24", label: "24 fps", desc: "Cinema" },
  { key: "30", label: "30 fps", desc: "Standard" },
  { key: "60", label: "60 fps", desc: "Fluide" },
];

const AUDIO_FORMATS_CONV = [
  { key: "mp3", label: "MP3", desc: "Compatible partout" },
  { key: "wav", label: "WAV", desc: "Sans perte" },
  { key: "flac", label: "FLAC", desc: "Sans perte compresse" },
  { key: "m4a", label: "M4A", desc: "Apple AAC" },
  { key: "ogg", label: "OGG", desc: "Open source" },
  { key: "aac", label: "AAC", desc: "Compact" },
  { key: "opus", label: "OPUS", desc: "Tres efficace" },
];

const AUDIO_BITRATES = [
  { key: "auto", label: "Auto", desc: "Conserve le bitrate source" },
  { key: "320", label: "320 kbps", desc: "Maximum MP3" },
  { key: "256", label: "256 kbps", desc: "Haute qualite" },
  { key: "192", label: "192 kbps", desc: "Standard" },
  { key: "128", label: "128 kbps", desc: "Compact" },
];

const AUDIO_SAMPLE_RATES = [
  { key: "auto", label: "Auto (conserver)", desc: "Sample rate source" },
  { key: "48000", label: "48 kHz", desc: "Studio / video" },
  { key: "44100", label: "44.1 kHz", desc: "CD audio" },
];

const AUDIO_CHANNELS = [
  { key: "auto", label: "Auto (conserver)", desc: "Canaux source" },
  { key: "2", label: "Stereo (2)", desc: "Standard" },
  { key: "1", label: "Mono (1)", desc: "Voix" },
];

const IMAGE_FORMATS_CONV = [
  { key: "jpg", label: "JPG", desc: "Photo, compresse" },
  { key: "png", label: "PNG", desc: "Sans perte, transparence" },
  { key: "webp", label: "WEBP", desc: "Tres efficace, web" },
  { key: "avif", label: "AVIF", desc: "Nouvelle generation" },
];

const IMAGE_QUALITIES = [
  { key: "auto", label: "Auto", desc: "Qualite par defaut" },
  { key: "100", label: "100 (Maximum)", desc: "Pas de perte visible" },
  { key: "90", label: "90 (Excellente)", desc: "Quasi parfait" },
  { key: "75", label: "75 (Bonne)", desc: "Standard web" },
  { key: "50", label: "50 (Moyenne)", desc: "Compact" },
];

const IMAGE_RESOLUTIONS = [
  { key: "auto", label: "Auto (conserver)", desc: "Taille source" },
  { key: "3840", label: "Max 4K (3840px)", desc: "Largeur max 3840" },
  { key: "1920", label: "Max 1920px", desc: "Web haute qualite" },
  { key: "1280", label: "Max 1280px", desc: "Web standard" },
];

const DOC_FORMATS = [
  { key: "pdf", label: "PDF", desc: "Universel, non editable" },
  { key: "docx", label: "DOCX", desc: "Word moderne" },
  { key: "odt", label: "ODT", desc: "OpenDocument" },
  { key: "rtf", label: "RTF", desc: "Texte enrichi" },
  { key: "txt", label: "TXT", desc: "Texte brut" },
  { key: "html", label: "HTML", desc: "Page web" },
];

// ===== EXTENSION TO KIND MAP =====
const EXT_TO_KIND = {
  mp4: "video", mov: "video", mkv: "video", avi: "video", webm: "video",
  m4v: "video", flv: "video", wmv: "video", mts: "video", ts: "video",
  "3gp": "video", ogv: "video", mpg: "video", mpeg: "video",
  mp3: "audio", wav: "audio", flac: "audio", m4a: "audio", ogg: "audio",
  aac: "audio", opus: "audio", aiff: "audio", aif: "audio",
  jpg: "image", jpeg: "image", png: "image", webp: "image", avif: "image",
  heic: "image", heif: "image", tiff: "image", tif: "image", bmp: "image",
  gif: "image",
  docx: "document", doc: "document", odt: "document", rtf: "document",
  pdf: "document", txt: "document", html: "document", htm: "document",
  xlsx: "document", xls: "document", ods: "document", csv: "document",
  pptx: "document", ppt: "document", odp: "document", md: "document",
};

function detectKindFromName(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return EXT_TO_KIND[ext] || "unknown";
}

// ===== STATE =====
const convertState = {
  files: [], // [{ path, name, kind }]
  outputDir: null,
  converting: false,
  libreofficeAvailable: false,
  history: [], // [{ name, format, kind, date, folder }]
  video: { target_format: "mp4", codec: "auto", bitrate: "auto", resolution: "auto", fps: "auto" },
  audio: { target_format: "mp3", codec: "auto", bitrate: "auto", sample_rate: "auto", channels: "auto" },
  image: { target_format: "jpg", quality: "auto", resolution: "auto" },
  document: { target_format: "pdf" },
};

// ===== UI UPDATER =====
function updateConvertUI() {
  const counts = { video: 0, audio: 0, image: 0, document: 0, unknown: 0 };
  convertState.files.forEach((f) => { counts[f.kind] = (counts[f.kind] || 0) + 1; });

  // Show/hide type cards
  const videoCard = document.getElementById("convert-video-card");
  const audioCard = document.getElementById("convert-audio-card");
  const imageCard = document.getElementById("convert-image-card");
  const docCard = document.getElementById("convert-doc-card");
  if (videoCard) videoCard.classList.toggle("hidden", counts.video === 0);
  if (audioCard) audioCard.classList.toggle("hidden", counts.audio === 0);
  if (imageCard) imageCard.classList.toggle("hidden", counts.image === 0);
  if (docCard) docCard.classList.toggle("hidden", counts.document === 0);

  // Counts
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setText("convert-video-count", counts.video);
  setText("convert-audio-count", counts.audio);
  setText("convert-image-count", counts.image);
  setText("convert-doc-count", counts.document);

  // Labels
  const findLabel = (list, key) => (list.find((x) => x.key === key) || { label: key }).label;
  setText("convert-video-format-label", `Format : ${findLabel(VIDEO_FORMATS_CONV, convertState.video.target_format)}`);
  setText("convert-video-codec-label", `Codec : ${findLabel(VIDEO_CODECS, convertState.video.codec)}`);
  setText("convert-video-bitrate-label", `Bitrate : ${findLabel(VIDEO_BITRATES, convertState.video.bitrate)}`);
  setText("convert-video-resolution-label", `Resolution : ${findLabel(VIDEO_RESOLUTIONS, convertState.video.resolution)}`);
  setText("convert-video-fps-label", `FPS : ${findLabel(VIDEO_FPS_LIST, convertState.video.fps)}`);

  setText("convert-audio-format-label", `Format : ${findLabel(AUDIO_FORMATS_CONV, convertState.audio.target_format)}`);
  setText("convert-audio-bitrate-label", `Bitrate : ${findLabel(AUDIO_BITRATES, convertState.audio.bitrate)}`);
  setText("convert-audio-samplerate-label", `Sample rate : ${findLabel(AUDIO_SAMPLE_RATES, convertState.audio.sample_rate)}`);
  setText("convert-audio-channels-label", `Canaux : ${findLabel(AUDIO_CHANNELS, convertState.audio.channels)}`);

  setText("convert-image-format-label", `Format : ${findLabel(IMAGE_FORMATS_CONV, convertState.image.target_format)}`);
  setText("convert-image-quality-label", `Qualite : ${findLabel(IMAGE_QUALITIES, convertState.image.quality)}`);
  setText("convert-image-resolution-label", `Taille : ${findLabel(IMAGE_RESOLUTIONS, convertState.image.resolution)}`);

  setText("convert-doc-format-label", `Format : ${findLabel(DOC_FORMATS, convertState.document.target_format)}`);

  // LibreOffice warning
  const loWarn = document.getElementById("libreoffice-warning");
  if (loWarn) {
    if (counts.document > 0 && !convertState.libreofficeAvailable) loWarn.classList.remove("hidden");
    else loWarn.classList.add("hidden");
  }

  // Source info
  const srcInfo = document.getElementById("convert-source-info");
  const srcInfoText = document.getElementById("convert-source-info-text");
  if (srcInfo && srcInfoText) {
    if (convertState.files.length > 0) {
      const parts = [];
      if (counts.video > 0) parts.push(`${counts.video} video${counts.video > 1 ? "s" : ""}`);
      if (counts.audio > 0) parts.push(`${counts.audio} audio${counts.audio > 1 ? "s" : ""}`);
      if (counts.image > 0) parts.push(`${counts.image} image${counts.image > 1 ? "s" : ""}`);
      if (counts.document > 0) parts.push(`${counts.document} document${counts.document > 1 ? "s" : ""}`);
      if (counts.unknown > 0) parts.push(`${counts.unknown} ignore${counts.unknown > 1 ? "s" : ""}`);
      srcInfoText.textContent = parts.join(" - ");
      srcInfo.classList.remove("hidden");
    } else {
      srcInfo.classList.add("hidden");
    }
  }

  // Output label
  const outLabel = document.getElementById("convert-output-label");
  if (outLabel) {
    if (convertState.outputDir) {
      const name = convertState.outputDir.split(/[\\/]/).pop() || convertState.outputDir;
      outLabel.textContent = `Sortie : ${name}`;
    } else {
      outLabel.textContent = "Sortie : Dossier par defaut";
    }
  }

  // Button state
  const btn = document.getElementById("convert-btn");
  const btnLabel = document.getElementById("convert-btn-label");
  if (btn && btnLabel) {
    const usable = counts.video + counts.audio + counts.image + counts.document;
    const blocked = counts.document > 0 && !convertState.libreofficeAvailable;
    btn.disabled = (usable === 0) || convertState.converting || blocked;
    if (convertState.converting) {
      btnLabel.textContent = "Conversion en cours...";
    } else if (usable > 0) {
      btnLabel.textContent = `Convertir (${usable} fichier${usable > 1 ? "s" : ""})`;
    } else {
      btnLabel.textContent = "Convertir";
    }
  }
}

// ===== MODAL =====
function showConvertModal(title, options, currentKey, onSelect) {
  // Try to reuse the existing modal infrastructure (showOptionsModal from main.js)
  if (typeof showOptionsModal === "function") {
    showOptionsModal(title, options, currentKey, onSelect);
    return;
  }
  // Fallback: build a simple modal
  const items = options.map((opt) =>
    `<div class="modal-option ${opt.key === currentKey ? 'selected' : ''}" data-key="${opt.key}">
      <div class="modal-option-label">${opt.label}</div>
      <div class="modal-option-desc">${opt.desc || ''}</div>
    </div>`
  ).join("");
  const html = `
    <div class="modal" id="convert-modal-temp">
      <div class="modal-card">
        <h2>${title}</h2>
        <div class="modal-options">${items}</div>
        <div class="modal-actions">
          <button class="btn-secondary" id="convert-modal-close">Annuler</button>
        </div>
      </div>
    </div>`;
  const container = document.createElement("div");
  container.innerHTML = html;
  const modalEl = container.firstElementChild;
  document.body.appendChild(modalEl);
  modalEl.querySelectorAll(".modal-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      onSelect(opt.dataset.key);
      modalEl.remove();
    });
  });
  modalEl.querySelector("#convert-modal-close").addEventListener("click", () => modalEl.remove());
}

// ===== TOAST =====
function convertToast(msg, duration) {
  if (typeof showToast === "function") {
    showToast(msg, duration || 2500);
  } else {
    console.log("[convert]", msg);
  }
}

// ===== ADD FILES =====
function addConvertFiles(paths) {
  const newOnes = paths.map((p) => {
    const name = p.split(/[\\/]/).pop() || p;
    return { path: p, name, kind: detectKindFromName(name) };
  });
  convertState.files = convertState.files.concat(newOnes);
  updateConvertUI();
  convertToast(`${newOnes.length} fichier${newOnes.length > 1 ? "s" : ""} ajoute${newOnes.length > 1 ? "s" : ""}`, 1800);
}

function clearConvertFiles() {
  convertState.files = [];
  updateConvertUI();
}

// ===== INIT =====
async function initConvertModule() {
  // Wait a short tick to ensure DOM ready (called from main IIFE post-init)
  await new Promise((r) => setTimeout(r, 50));

  // Drag & drop (Tauri 2.x webview API - returns absolute paths)
  const dropZone = document.getElementById("convert-drop-zone");
  if (dropZone) {
    try {
      const wv =
        (window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrentWebview)
          ? window.__TAURI__.webview.getCurrentWebview()
          : null;
      if (wv && typeof wv.onDragDropEvent === "function") {
        await wv.onDragDropEvent((event) => {
          if (typeof state !== "undefined" && state.currentModule !== "convert") return;
          const p = event.payload;
          if (!p) return;
          if (p.type === "enter" || p.type === "over") {
            dropZone.classList.add("drag-over");
          } else if (p.type === "leave") {
            dropZone.classList.remove("drag-over");
          } else if (p.type === "drop") {
            dropZone.classList.remove("drag-over");
            const paths = Array.isArray(p.paths) ? p.paths : [];
            if (paths.length === 0) {
              convertToast("Aucun fichier detecte", 2500);
              return;
            }
            addConvertFiles(paths);
          }
        });
      } else {
        console.warn("[convert] Tauri webview.getCurrentWebview indisponible, drag&drop desactive");
      }
    } catch (err) {
      console.error("[convert] onDragDropEvent setup failed:", err);
    }
  }

  // "Choisir des fichiers" button
  const selectBtn = document.getElementById("convert-select-files-btn");
  if (selectBtn) {
    selectBtn.addEventListener("click", async () => {
      try {
        const tauriOpen = (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open) || (typeof open === "function" ? open : null);
        if (!tauriOpen) {
          convertToast("Dialogue Tauri non disponible", 3000);
          return;
        }
        const selected = await tauriOpen({
          multiple: true,
          filters: [{
            name: "Fichiers convertibles",
            extensions: Object.keys(EXT_TO_KIND),
          }],
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        addConvertFiles(paths);
      } catch (err) {
        console.error("Convert select files error:", err);
        convertToast("Erreur : " + err, 3000);
      }
    });
  }

  // Clear source button
  const clearBtn = document.getElementById("convert-source-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearConvertFiles();
    });
  }

  // Option rows
  const bindOption = (rowId, title, list, getCurrent, setCurrent) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.addEventListener("click", () => {
      showConvertModal(title, list, getCurrent(), (key) => {
        setCurrent(key);
        updateConvertUI();
      });
    });
  };

  bindOption("convert-video-format-row", "Format video", VIDEO_FORMATS_CONV,
    () => convertState.video.target_format, (k) => convertState.video.target_format = k);
  bindOption("convert-video-codec-row", "Codec video", VIDEO_CODECS,
    () => convertState.video.codec, (k) => convertState.video.codec = k);
  bindOption("convert-video-bitrate-row", "Bitrate video", VIDEO_BITRATES,
    () => convertState.video.bitrate, (k) => convertState.video.bitrate = k);
  bindOption("convert-video-resolution-row", "Resolution", VIDEO_RESOLUTIONS,
    () => convertState.video.resolution, (k) => convertState.video.resolution = k);
  bindOption("convert-video-fps-row", "FPS", VIDEO_FPS_LIST,
    () => convertState.video.fps, (k) => convertState.video.fps = k);

  bindOption("convert-audio-format-row", "Format audio", AUDIO_FORMATS_CONV,
    () => convertState.audio.target_format, (k) => convertState.audio.target_format = k);
  bindOption("convert-audio-bitrate-row", "Bitrate audio", AUDIO_BITRATES,
    () => convertState.audio.bitrate, (k) => convertState.audio.bitrate = k);
  bindOption("convert-audio-samplerate-row", "Sample rate", AUDIO_SAMPLE_RATES,
    () => convertState.audio.sample_rate, (k) => convertState.audio.sample_rate = k);
  bindOption("convert-audio-channels-row", "Canaux audio", AUDIO_CHANNELS,
    () => convertState.audio.channels, (k) => convertState.audio.channels = k);

  bindOption("convert-image-format-row", "Format image", IMAGE_FORMATS_CONV,
    () => convertState.image.target_format, (k) => convertState.image.target_format = k);
  bindOption("convert-image-quality-row", "Qualite image", IMAGE_QUALITIES,
    () => convertState.image.quality, (k) => convertState.image.quality = k);
  bindOption("convert-image-resolution-row", "Taille image", IMAGE_RESOLUTIONS,
    () => convertState.image.resolution, (k) => convertState.image.resolution = k);

  bindOption("convert-doc-format-row", "Format document", DOC_FORMATS,
    () => convertState.document.target_format, (k) => convertState.document.target_format = k);

  // Output folder picker
  const outputRow = document.getElementById("convert-output-row");
  if (outputRow) {
    outputRow.addEventListener("click", async () => {
      try {
        const tauriOpen = (window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.dialog.open) || (typeof open === "function" ? open : null);
        if (!tauriOpen) return;
        const selected = await tauriOpen({ directory: true, multiple: false });
        if (selected) {
          convertState.outputDir = selected;
          updateConvertUI();
        }
      } catch (err) {
        console.error("Convert output picker error:", err);
      }
    });
  }

  // Open folder button (topbar)
  const openFolderBtn = document.getElementById("convert-open-folder-btn");
  if (openFolderBtn) {
    openFolderBtn.addEventListener("click", async () => {
      try {
        const inv = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || (typeof invoke === "function" ? invoke : null);
        if (inv) await inv("open_converted_folder");
      } catch (err) {
        console.error("Open converted folder error:", err);
      }
    });
  }

  // LibreOffice link
  const loLink = document.getElementById("libreoffice-link");
  if (loLink) {
    loLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const sh = (window.__TAURI__ && window.__TAURI__.shell);
        if (sh && sh.open) await sh.open("https://www.libreoffice.org/download/");
      } catch (err) {
        console.error("Open LO link error:", err);
      }
    });
  }

  // Convert button
  const convertBtn = document.getElementById("convert-btn");
  if (convertBtn) {
    convertBtn.addEventListener("click", async () => {
      if (convertState.converting || convertState.files.length === 0) return;

      const valid = convertState.files.filter((f) => f.kind !== "unknown");
      if (valid.length === 0) {
        convertToast("Aucun fichier convertible", 3000);
        return;
      }

      convertState.converting = true;
      updateConvertUI();

      const progSection = document.getElementById("convert-progress-section");
      const progFill = document.getElementById("convert-progress-fill");
      const progStage = document.getElementById("convert-progress-stage");
      const progMeta = document.getElementById("convert-progress-meta");
      if (progSection) progSection.classList.remove("hidden");
      if (progFill) progFill.style.width = "0%";
      if (progStage) progStage.textContent = "Conversion en cours...";
      if (progMeta) progMeta.textContent = "";

      // Build payload
      const filesPayload = valid.map((f) => {
        let opts;
        if (f.kind === "video") opts = { kind: "video", ...convertState.video };
        else if (f.kind === "audio") opts = { kind: "audio", ...convertState.audio };
        else if (f.kind === "image") opts = { kind: "image", ...convertState.image };
        else if (f.kind === "document") opts = { kind: "document", ...convertState.document };
        return { source_path: f.path, opts };
      });

      try {
        const inv = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || (typeof invoke === "function" ? invoke : null);
        if (!inv) throw new Error("Tauri invoke non disponible");

        const result = await inv("convert_files_batch", {
          files: filesPayload,
          outputDir: convertState.outputDir,
        });

        if (result && result.success) {
          if (progFill) progFill.style.width = "100%";
          if (progStage) progStage.textContent = "Termine";
          if (progMeta) progMeta.textContent = `${result.succeeded}/${result.total} converti${result.succeeded > 1 ? "s" : ""}`;
          convertToast(`Conversion terminee : ${result.succeeded}/${result.total}`, 3000);
          // Save to history
          try {
            const folder = result.output_path || "";
            valid.forEach((f) => {
              let outFormat;
              if (f.kind === "video") outFormat = convertState.video.target_format;
              else if (f.kind === "audio") outFormat = convertState.audio.target_format;
              else if (f.kind === "image") outFormat = convertState.image.target_format;
              else if (f.kind === "document") outFormat = convertState.document.target_format;
              addConvertHistoryEntry(f.name, outFormat || "?", f.kind, folder);
            });
          } catch (err) { console.error("History save error:", err); }
          setTimeout(() => {
            if (progSection) progSection.classList.add("hidden");
            clearConvertFiles();
          }, 3500);
        } else if (result && result.libreoffice_missing) {
          convertToast("LibreOffice non installe", 4000);
          if (progSection) progSection.classList.add("hidden");
        } else {
          const err = (result && result.error) || "Echec inconnu";
          convertToast("Erreur : " + err, 4000);
          if (progSection) progSection.classList.add("hidden");
        }
      } catch (err) {
        console.error("Convert error:", err);
        convertToast("Erreur : " + err, 4000);
        if (progSection) progSection.classList.add("hidden");
      }

      convertState.converting = false;
      updateConvertUI();
    });
  }

  // Progress event listener
  try {
    const lst = (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) || (typeof listen === "function" ? listen : null);
    if (lst) {
      lst("convert-progress", (event) => {
        const p = event.payload || {};
        const progFill = document.getElementById("convert-progress-fill");
        const progStage = document.getElementById("convert-progress-stage");
        const progMeta = document.getElementById("convert-progress-meta");
        if (progFill) progFill.style.width = Math.min(p.percent || 0, 100) + "%";
        if (progStage) {
          let prefix = "";
          if (p.total_files && p.total_files > 1) prefix = `(${p.file_index}/${p.total_files}) `;
          if (p.stage === "converting") progStage.textContent = `${prefix}Conversion ${(p.percent || 0).toFixed(0)}%`;
          else if (p.stage === "scanning") progStage.textContent = "Analyse...";
        }
        if (progMeta && p.current_file) progMeta.textContent = p.current_file;
      });
    }
  } catch (err) {
    console.error("Convert progress listener setup error:", err);
  }

  // Check LibreOffice availability
  try {
    const inv = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || (typeof invoke === "function" ? invoke : null);
    if (inv) {
      convertState.libreofficeAvailable = await inv("check_libreoffice");
    }
  } catch (err) {
    convertState.libreofficeAvailable = false;
  }

  loadConvertHistory();
  updateConvertUI();
  console.log("[convert] Module initialized");
}


function renderConvertHistory() {
  const list = document.getElementById("convert-history-list");
  const section = document.getElementById("convert-history-section");
  if (!list || !section) return;
  if (!convertState.history || convertState.history.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  list.innerHTML = "";
  convertState.history.slice(0, 10).forEach((item) => {
    const el = document.createElement("div");
    el.className = "history-item";
    let svg;
    if (item.kind === "video") {
      svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
    } else if (item.kind === "audio") {
      svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    } else if (item.kind === "image") {
      svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    } else {
      svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
    const dateStr = new Date(item.date).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    el.innerHTML = '<div class="type-icon">' + svg + '</div><div class="history-info"><div class="history-name">' + item.name + '</div><div class="history-meta">' + item.format.toUpperCase() + ' - ' + dateStr + '</div></div>';
    el.addEventListener("click", () => {
      try {
        const inv = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || (typeof invoke === "function" ? invoke : null);
        if (inv && item.folder) inv("open_folder", { path: item.folder });
      } catch (err) {
        console.error("Open folder error:", err);
      }
    });
    list.appendChild(el);
  });
}

function saveConvertHistory() {
  try {
    localStorage.setItem("convert-history", JSON.stringify(convertState.history.slice(0, 10)));
  } catch (err) {
    console.error("Save convert history error:", err);
  }
  renderConvertHistory();
}

function loadConvertHistory() {
  try {
    const raw = localStorage.getItem("convert-history");
    if (raw) convertState.history = JSON.parse(raw);
  } catch (err) {
    convertState.history = [];
  }
  renderConvertHistory();
}

function addConvertHistoryEntry(name, format, kind, folder) {
  if (!convertState.history) convertState.history = [];
  convertState.history.unshift({
    name,
    format,
    kind,
    date: Date.now(),
    folder,
  });
  saveConvertHistory();
}

// Call init - this is a single statement, no nested IIFE
initConvertModule();

// ============================================
// PHASE 4 - TRANSCRIRE MODULE
// ============================================

const TRANSCRIBE_MODELS = [
  { key: "tiny",     label: "Tiny",     desc: "Tres rapide, qualite basique (~75 Mo)" },
  { key: "base",     label: "Base",     desc: "Rapide, qualite correcte (~150 Mo)" },
  { key: "small",    label: "Small",    desc: "Equilibre vitesse/qualite (~470 Mo)" },
  { key: "medium",   label: "Medium",   desc: "Tres bonne qualite, plus lent (~1.5 Go)" },
  { key: "large-v3", label: "Large v3", desc: "Meilleure qualite (~3 Go), lent en CPU" },
];

const TRANSCRIBE_LANGUAGES = [
  { key: "auto", label: "Detection auto", desc: "Whisper detecte la langue" },
  { key: "fr",   label: "Francais",       desc: "" },
  { key: "en",   label: "Anglais",        desc: "" },
  { key: "es",   label: "Espagnol",       desc: "" },
  { key: "it",   label: "Italien",        desc: "" },
  { key: "de",   label: "Allemand",       desc: "" },
  { key: "pt",   label: "Portugais",      desc: "" },
  { key: "ja",   label: "Japonais",       desc: "" },
];

const TRANSCRIBE_FORMATS_OPTIONS = [
  { key: "all",         label: "Tous (TXT+SRT+VTT+JSON)", desc: "Texte + sous-titres + donnees brutes" },
  { key: "txt",         label: "TXT uniquement",          desc: "Texte simple" },
  { key: "srt",         label: "SRT uniquement",          desc: "Sous-titres SRT" },
  { key: "vtt",         label: "VTT uniquement",          desc: "Sous-titres VTT (web)" },
  { key: "txt-srt",     label: "TXT + SRT",                desc: "Texte + sous-titres SRT" },
  { key: "txt-srt-vtt", label: "TXT + SRT + VTT",          desc: "Texte + sous-titres tous formats" },
];

const TRANSCRIBE_FORMATS_MAP = {
  "all":         ["txt", "srt", "vtt", "json"],
  "txt":         ["txt"],
  "srt":         ["srt"],
  "vtt":         ["vtt"],
  "txt-srt":     ["txt", "srt"],
  "txt-srt-vtt": ["txt", "srt", "vtt"],
};

// Extend state with transcribe fields (state object must exist already)
if (typeof state !== "undefined") {
  state.transcribeSource = null;
  state.transcribeSourceType = "file"; // "file" or "youtube"
  state.transcribeYoutubeUrl = "";
  state.transcribeOutputDir = null;
  state.transcribeModel = "small";
  state.transcribeLanguage = "auto";
  state.transcribeFormatsKey = "all";
  state.transcribing = false;
}

const TRANSCRIBE_VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "webm", "avi", "flv", "m4v", "wmv", "ts", "mpg", "mpeg"]);
const TRANSCRIBE_AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "flac", "ogg", "aac", "wma", "opus"]);

function transcribeIsValidMedia(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return TRANSCRIBE_VIDEO_EXTS.has(ext) || TRANSCRIBE_AUDIO_EXTS.has(ext);
}

function transcribeShortPath(p) {
  if (!p) return "";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function transcribeUpdateUI() {
  const btn = document.getElementById("transcribe-btn");
  if (!btn) return;

  // Update label
  const modelOpt = TRANSCRIBE_MODELS.find(m => m.key === state.transcribeModel);
  const langOpt = TRANSCRIBE_LANGUAGES.find(l => l.key === state.transcribeLanguage);
  const formatsOpt = TRANSCRIBE_FORMATS_OPTIONS.find(f => f.key === state.transcribeFormatsKey);

  const modelLabel = document.getElementById("transcribe-model-label");
  if (modelLabel && modelOpt) modelLabel.textContent = "Modele : " + modelOpt.label;

  const langLabel = document.getElementById("transcribe-language-label");
  if (langLabel && langOpt) langLabel.textContent = "Langue : " + langOpt.label;

  const formatsLabel = document.getElementById("transcribe-formats-label");
  if (formatsLabel && formatsOpt) formatsLabel.textContent = "Formats : " + formatsOpt.label;

  const outputLabel = document.getElementById("transcribe-output-label");
  if (outputLabel) {
    outputLabel.textContent = state.transcribeOutputDir
      ? "Sortie : " + transcribeShortPath(state.transcribeOutputDir)
      : "Sortie : Meme dossier que la source";
  }

  // Source info
  const info = document.getElementById("transcribe-source-info");
  const infoText = document.getElementById("transcribe-source-info-text");

  let hasSource = false;
  if (state.transcribeSourceType === "file" && state.transcribeSource) {
    hasSource = true;
    if (infoText) infoText.textContent = transcribeShortPath(state.transcribeSource);
    if (info) info.classList.remove("hidden");
  } else if (state.transcribeSourceType === "youtube" && state.transcribeYoutubeUrl.trim()) {
    hasSource = true;
    if (info) info.classList.add("hidden");
  } else {
    if (info) info.classList.add("hidden");
  }

  // Button enable/disable
  btn.disabled = !hasSource || state.transcribing;
  const btnLabel = document.getElementById("transcribe-btn-label");
  if (btnLabel) {
    btnLabel.textContent = state.transcribing ? "Transcription en cours..." : "Lancer la transcription";
  }
  // Phase 2 : synchronise aussi la sidebar (no-op si pas montee)
  if (typeof transcribeSidebarSync === "function") transcribeSidebarSync();
  // Phase 3 : show/hide l'overlay de progress selon state.transcribing
  if (typeof transcribeShowProgressOverlay === "function") transcribeShowProgressOverlay(state.transcribing);
}

// Phase 3 : toggle l'overlay de progress (fixed, flottant)
function transcribeShowProgressOverlay(show) {
  const overlay = document.getElementById("transcribe-progress-overlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
}

// Phase 3 : update visuel de la progress (overlay + legacy en miroir)
function transcribeApplyProgress(pct, stage, metaText) {
  const fillO = document.getElementById("progress-overlay-fill");
  const stageO = document.getElementById("progress-overlay-stage");
  const metaO = document.getElementById("progress-overlay-meta-text");
  if (fillO) fillO.style.width = pct + "%";
  if (stageO) stageO.textContent = stage;
  if (metaO) metaO.textContent = metaText;
}

function transcribeSetSourceFromPath(path) {
  if (!path) return;
  if (!transcribeIsValidMedia(path)) {
    showToast("Format non supporte (audio/video uniquement)", 3000);
    return;
  }
  state.transcribeSource = path;
  state.transcribeSourceType = "file";
  showToast("Source ajoutee", 1800);
  // Phase 2 : bascule vers la nouvelle UI media + sidebar
  if (typeof transcribeShowMedia === "function") {
    transcribeShowMedia();
    transcribeRenderMediaPreview(path);
    transcribeSidebarSync();
  }
  transcribeUpdateUI();
}

function transcribeReadRecents() {
  try {
    return JSON.parse(localStorage.getItem("transcribe-recents") || "[]");
  } catch (e) {
    return [];
  }
}

function transcribeRenderRecents() {
  const recents = transcribeReadRecents();

  // Drawer Recents (Phase 5)
  const drawerList = document.getElementById("transcribe-recents-list");
  if (!drawerList) return;
  if (recents.length === 0) {
    drawerList.innerHTML = '<div class="recents-empty">Aucune transcription pour le moment.<br>Lance ta première transcription pour la voir ici.</div>';
    return;
  }
  drawerList.innerHTML = recents.map((r, i) => {
    const hasLoad = r.mediaPath && r.srtPath;
    const meta = [r.model, (r.language || "auto"), (r.formats || []).join("+")].filter(Boolean).join(" · ");
    const warn = hasLoad ? "" : '<span class="recents-item-warn">(ancienne entree — non chargeable)</span>';
    return `
      <button type="button" class="recents-item" data-idx="${i}" ${hasLoad ? '' : 'disabled style="opacity:0.5;cursor:not-allowed;"'}>
        <span class="recents-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
        </span>
        <span class="recents-item-info">
          <span class="recents-item-name">${r.name || "(sans nom)"}</span>
          <span class="recents-item-meta">${meta}${warn ? " " + warn : ""}</span>
        </span>
      </button>
    `;
  }).join("");
}

// Phase 5 : open/close du drawer Recents
function transcribeOpenRecentsDrawer() {
  transcribeRenderRecents();
  const drawer = document.getElementById("transcribe-recents-drawer");
  const backdrop = document.getElementById("transcribe-recents-backdrop");
  if (drawer) {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  if (backdrop) backdrop.classList.remove("hidden");
}
function transcribeCloseRecentsDrawer() {
  const drawer = document.getElementById("transcribe-recents-drawer");
  const backdrop = document.getElementById("transcribe-recents-backdrop");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.classList.add("hidden");
}

function transcribeAddRecent(entry) {
  let recents = [];
  try {
    recents = JSON.parse(localStorage.getItem("transcribe-recents") || "[]");
  } catch (e) {
    recents = [];
  }
  recents.unshift(entry);
  recents = recents.slice(0, 10);
  localStorage.setItem("transcribe-recents", JSON.stringify(recents));
  transcribeRenderRecents();
}

// ============================================
// Phase 1+2 refacto : helpers state VIDE / MEDIA / LEGACY
// ============================================
function transcribeShowEmpty() {
  const empty = document.getElementById("transcribe-empty");
  const media = document.getElementById("transcribe-media");
  const legacy = document.getElementById("transcribe-legacy");
  if (empty) empty.classList.remove("hidden");
  if (media) media.classList.add("hidden");
  if (legacy) legacy.classList.add("hidden");
}
function transcribeShowMedia() {
  const empty = document.getElementById("transcribe-empty");
  const media = document.getElementById("transcribe-media");
  const legacy = document.getElementById("transcribe-legacy");
  if (empty) empty.classList.add("hidden");
  if (media) media.classList.remove("hidden");
  if (legacy) legacy.classList.add("hidden");
}
function transcribeShowLegacy() {
  const empty = document.getElementById("transcribe-empty");
  const media = document.getElementById("transcribe-media");
  const edit = document.getElementById("transcribe-edit");
  const legacy = document.getElementById("transcribe-legacy");
  if (empty) empty.classList.add("hidden");
  if (media) media.classList.add("hidden");
  if (edit) edit.classList.add("hidden");
  if (legacy) legacy.classList.remove("hidden");
}
// Phase 4 : etat EDITION (media + srt charges)
function transcribeShowEdit() {
  const empty = document.getElementById("transcribe-empty");
  const media = document.getElementById("transcribe-media");
  const edit = document.getElementById("transcribe-edit");
  const legacy = document.getElementById("transcribe-legacy");
  if (empty) empty.classList.add("hidden");
  if (media) media.classList.add("hidden");
  if (legacy) legacy.classList.add("hidden");
  if (edit) edit.classList.remove("hidden");
}

// Phase 4 : met a jour le chip "media + srt" en haut de l'etat EDIT
function transcribeUpdateEditChip(mediaPath, srtPath) {
  const name = document.getElementById("transcribe-edit-chip-name");
  if (!name) return;
  const shortM = mediaPath ? mediaPath.split(/[\\/]/).pop() : null;
  const shortS = srtPath ? srtPath.split(/[\\/]/).pop() : null;
  if (shortM && shortS) name.textContent = shortM + "  +  " + shortS;
  else if (shortM) name.textContent = shortM;
  else if (shortS) name.textContent = shortS;
  else name.textContent = "fichiers";
}

// Phase 2 : preview du media dans la zone main
function transcribeRenderMediaPreview(path) {
  const preview = document.getElementById("transcribe-media-preview");
  if (!preview) return;
  preview.innerHTML = "";
  if (!path) {
    preview.innerHTML = '<div class="preview-empty">Aucun media charge</div>';
    return;
  }
  const ext = (path.split(".").pop() || "").toLowerCase();
  const isVideo = TRANSCRIBE_VIDEO_EXTS.has(ext);
  const tag = isVideo ? "video" : "audio";
  const el = document.createElement(tag);
  const convertFileSrc =
    (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc) ||
    ((p) => p);
  el.src = convertFileSrc(path);
  el.controls = true;
  preview.appendChild(el);
}

// Phase 2 : synchronise les labels et le bouton de la sidebar avec state.*
function transcribeSidebarSync() {
  const modelOpt = TRANSCRIBE_MODELS.find((m) => m.key === state.transcribeModel);
  const langOpt = TRANSCRIBE_LANGUAGES.find((l) => l.key === state.transcribeLanguage);
  const formatsOpt = TRANSCRIBE_FORMATS_OPTIONS.find((f) => f.key === state.transcribeFormatsKey);

  const modelLbl = document.getElementById("transcribe-sb-model-label");
  if (modelLbl && modelOpt) modelLbl.textContent = "Modele : " + modelOpt.label;
  const langLbl = document.getElementById("transcribe-sb-language-label");
  if (langLbl && langOpt) langLbl.textContent = "Langue : " + langOpt.label;
  const formatsLbl = document.getElementById("transcribe-sb-formats-label");
  if (formatsLbl && formatsOpt) formatsLbl.textContent = "Formats : " + formatsOpt.label;
  const outputLbl = document.getElementById("transcribe-sb-output-label");
  if (outputLbl) {
    outputLbl.textContent = state.transcribeOutputDir
      ? "Sortie : " + transcribeShortPath(state.transcribeOutputDir)
      : "Sortie : Meme dossier que la source";
  }

  const btn = document.getElementById("transcribe-sb-launch-btn");
  if (btn) {
    btn.disabled = !state.transcribeSource || state.transcribing;
    const lbl = btn.querySelector("span");
    if (lbl) lbl.textContent = state.transcribing ? "Transcription en cours..." : "Lancer la transcription";
  }

  const chipName = document.getElementById("transcribe-file-chip-name");
  if (chipName && state.transcribeSource) {
    chipName.textContent = transcribeShortPath(state.transcribeSource);
  }
}

// Routage d'un fichier deposé/choisi dans la zone hero
function transcribeRouteFile(path) {
  if (!path) return;
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "srt") {
    // SRT seul -> mode edition pure dans le player
    if (typeof window.__playerLoad === "function") {
      window.__playerLoad(null, path);
    }
    transcribeShowLegacy();
  } else if (TRANSCRIBE_VIDEO_EXTS.has(ext) || TRANSCRIBE_AUDIO_EXTS.has(ext)) {
    transcribeSetSourceFromPath(path);
    transcribeShowLegacy();
  } else {
    if (typeof showToast === "function") showToast("Format non supporte : ." + ext, 3000);
  }
}

// Routage multi-fichiers (drop ou picker)
function transcribeRoutePaths(paths) {
  if (!paths || paths.length === 0) return;
  if (paths.length === 1) {
    transcribeRouteFile(paths[0]);
    return;
  }
  let media = null, srt = null;
  for (const p of paths) {
    const ext = (p.split(".").pop() || "").toLowerCase();
    if (ext === "srt" && !srt) srt = p;
    else if (!media && (TRANSCRIBE_VIDEO_EXTS.has(ext) || TRANSCRIBE_AUDIO_EXTS.has(ext))) media = p;
  }
  if (media && srt) {
    if (typeof window.__playerLoad === "function") window.__playerLoad(media, srt);
    transcribeShowLegacy();
  } else if (media) {
    transcribeSetSourceFromPath(media);
    transcribeShowLegacy();
  } else if (srt) {
    if (typeof window.__playerLoad === "function") window.__playerLoad(null, srt);
    transcribeShowLegacy();
  } else {
    if (typeof showToast === "function") showToast("Aucun fichier valide detecte", 2500);
  }
}

async function initTranscribeModule() {
  // ===== Phase 1 : NEW EMPTY STATE HANDLERS =====
  const browseBtn = document.getElementById("transcribe-browse-btn");
  if (browseBtn) {
    browseBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const selected = await open({
          multiple: true,
          filters: [{
            name: "Audio / Video / SRT",
            extensions: ["mp3","wav","m4a","flac","ogg","aac","opus","mp4","mov","mkv","webm","avi","srt"]
          }],
        });
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected];
          transcribeRoutePaths(paths);
        }
      } catch (err) { console.error("[transcribe] browse error:", err); }
    });
  }

  // Toggle UI : drop hero <-> mode URL YouTube
  const ytToggle = document.getElementById("transcribe-yt-toggle");
  const ytMode = document.getElementById("transcribe-yt-mode");
  const ytBack = document.getElementById("transcribe-yt-back");
  const ytUrlNew = document.getElementById("transcribe-yt-url-new");
  const dropHero = document.getElementById("transcribe-drop-hero");

  if (ytToggle && ytMode && dropHero) {
    ytToggle.addEventListener("click", () => {
      dropHero.classList.add("hidden");
      ytToggle.classList.add("hidden");
      ytMode.classList.remove("hidden");
      if (ytUrlNew) ytUrlNew.focus();
    });
  }
  if (ytBack && ytMode && dropHero && ytToggle) {
    ytBack.addEventListener("click", () => {
      ytMode.classList.add("hidden");
      dropHero.classList.remove("hidden");
      ytToggle.classList.remove("hidden");
    });
  }
  if (ytUrlNew) {
    ytUrlNew.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && ytUrlNew.value.trim()) {
        // Bascule vers legacy avec mode YouTube actif (provisoire jusqu'a Phase 2)
        const oldInput = document.getElementById("transcribe-youtube-url");
        if (oldInput) oldInput.value = ytUrlNew.value;
        state.transcribeYoutubeUrl = ytUrlNew.value;
        state.transcribeSourceType = "youtube";
        transcribeShowLegacy();
        const ytTab = document.querySelector('#transcribe-tabs .tab-btn[data-tab="youtube"]');
        if (ytTab) ytTab.click();
        transcribeUpdateUI();
      }
    });
  }

  // Click sur la drop-hero (hors bouton Parcourir) ouvre aussi le picker
  if (dropHero && browseBtn) {
    dropHero.addEventListener("click", (e) => {
      // Si on a cliqué sur le bouton, le handler du bouton gère
      if (e.target.closest("#transcribe-browse-btn")) return;
      browseBtn.click();
    });
  }

  // ===== Phase 2 : SIDEBAR HANDLERS (model / language / formats / output / launch) =====
  const sbModelRow = document.getElementById("transcribe-sb-model-row");
  if (sbModelRow) {
    sbModelRow.addEventListener("click", () => {
      if (typeof showOptionsModal !== "function") return;
      showOptionsModal("Choisis le modele Whisper", TRANSCRIBE_MODELS, state.transcribeModel, (key) => {
        state.transcribeModel = key;
        transcribeUpdateUI();
      });
    });
  }
  const sbLangRow = document.getElementById("transcribe-sb-language-row");
  if (sbLangRow) {
    sbLangRow.addEventListener("click", () => {
      if (typeof showOptionsModal !== "function") return;
      showOptionsModal("Choisis la langue", TRANSCRIBE_LANGUAGES, state.transcribeLanguage, (key) => {
        state.transcribeLanguage = key;
        transcribeUpdateUI();
      });
    });
  }
  const sbFormatsRow = document.getElementById("transcribe-sb-formats-row");
  if (sbFormatsRow) {
    sbFormatsRow.addEventListener("click", () => {
      if (typeof showOptionsModal !== "function") return;
      showOptionsModal("Choisis les formats de sortie", TRANSCRIBE_FORMATS_OPTIONS, state.transcribeFormatsKey, (key) => {
        state.transcribeFormatsKey = key;
        transcribeUpdateUI();
      });
    });
  }
  const sbOutputRow = document.getElementById("transcribe-sb-output-row");
  if (sbOutputRow) {
    sbOutputRow.addEventListener("click", async () => {
      try {
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === "string") {
          state.transcribeOutputDir = selected;
          transcribeUpdateUI();
        }
      } catch (e) { console.error("[transcribe] output dir picker error:", e); }
    });
  }
  // Bouton Lancer dans la sidebar : delegue au pipeline legacy.
  // Phase 3 : on reste dans l'UI moderne, l'overlay couvre l'ecran pendant Whisper
  const sbLaunchBtn = document.getElementById("transcribe-sb-launch-btn");
  if (sbLaunchBtn) {
    sbLaunchBtn.addEventListener("click", () => {
      const legacyBtn = document.getElementById("transcribe-btn");
      if (legacyBtn && !legacyBtn.disabled) legacyBtn.click();
    });
  }
  // Chip clear : retire le media et revient a l'etat VIDE
  const chipClear = document.getElementById("transcribe-file-chip-clear");
  if (chipClear) {
    chipClear.addEventListener("click", () => {
      state.transcribeSource = null;
      // Vide aussi le preview
      const preview = document.getElementById("transcribe-media-preview");
      if (preview) preview.innerHTML = "";
      transcribeShowEmpty();
      transcribeUpdateUI();
    });
  }

  // ===== Phase 5 : DRAWER RECENTS - OPEN/CLOSE + CLICK ITEM =====
  const recentsBtn = document.getElementById("transcribe-recents-btn");
  if (recentsBtn) {
    recentsBtn.addEventListener("click", () => transcribeOpenRecentsDrawer());
  }
  const recentsClose = document.getElementById("transcribe-recents-close");
  if (recentsClose) {
    recentsClose.addEventListener("click", () => transcribeCloseRecentsDrawer());
  }
  const recentsBackdrop = document.getElementById("transcribe-recents-backdrop");
  if (recentsBackdrop) {
    recentsBackdrop.addEventListener("click", () => transcribeCloseRecentsDrawer());
  }
  // Escape pour fermer le drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const drawer = document.getElementById("transcribe-recents-drawer");
      if (drawer && drawer.classList.contains("open")) transcribeCloseRecentsDrawer();
    }
  });
  // Click sur un item recent : charge media + SRT dans le player, ferme drawer
  const recentsList = document.getElementById("transcribe-recents-list");
  if (recentsList) {
    recentsList.addEventListener("click", (e) => {
      const btn = e.target.closest(".recents-item");
      if (!btn || btn.disabled) return;
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      const recents = transcribeReadRecents();
      const r = recents[idx];
      if (!r || !r.mediaPath || !r.srtPath) return;
      // Garde dirty avant de charger un nouveau contenu
      if (typeof window.__playerCanLeave === "function" && !window.__playerCanLeave()) return;
      if (typeof window.__playerLoad === "function") {
        window.__playerLoad(r.mediaPath, r.srtPath);
      }
      transcribeCloseRecentsDrawer();
    });
  }

  // ===== Phase 4 : SIDEBAR EDIT - ONGLETS + CHIP CLEAR =====
  const editTabs = document.querySelectorAll("#edit-sidebar-tabs .sidebar-tab");
  editTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      editTabs.forEach((t) => t.classList.toggle("active", t === tab));
      const segPanel = document.getElementById("edit-tab-segments");
      const expPanel = document.getElementById("edit-tab-export");
      if (segPanel) segPanel.classList.toggle("hidden", target !== "segments");
      if (expPanel) expPanel.classList.toggle("hidden", target !== "export");
    });
  });

  // Chip clear EDIT : decharge media + srt, retour a l'etat VIDE
  // Garde "modifs non enregistrees" : __playerCanLeave + reset propre via __playerReset
  const editChipClear = document.getElementById("transcribe-edit-chip-clear");
  if (editChipClear) {
    editChipClear.addEventListener("click", () => {
      if (typeof window.__playerCanLeave === "function" && !window.__playerCanLeave()) return;
      if (typeof window.__playerReset === "function") window.__playerReset();
      state.transcribeSource = null;
      transcribeShowEmpty();
      transcribeUpdateUI();
    });
  }

  // ===== TABS =====
  const tabBtns = document.querySelectorAll("#transcribe-tabs .tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      tabBtns.forEach(b => {
        b.classList.toggle("active", b === btn);
        b.style.background = (b === btn) ? "rgba(255,255,255,0.05)" : "transparent";
        b.style.color = (b === btn) ? "#fff" : "#888";
      });
      document.getElementById("transcribe-tab-file").classList.toggle("hidden", tab !== "file");
      document.getElementById("transcribe-tab-youtube").classList.toggle("hidden", tab !== "youtube");
      state.transcribeSourceType = tab;
      transcribeUpdateUI();
    });
  });

  // ===== YOUTUBE URL INPUT =====
  const ytInput = document.getElementById("transcribe-youtube-url");
  if (ytInput) {
    ytInput.addEventListener("input", () => {
      state.transcribeYoutubeUrl = ytInput.value;
      transcribeUpdateUI();
    });
  }

  // ===== FILE PICKER =====
  const pickBtn = document.getElementById("transcribe-select-file-btn");
  if (pickBtn) {
    pickBtn.addEventListener("click", async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{
            name: "Audio / Video",
            extensions: ["mp3", "wav", "m4a", "flac", "ogg", "aac", "opus", "mp4", "mov", "mkv", "webm", "avi"]
          }]
        });
        if (selected && typeof selected === "string") {
          transcribeSetSourceFromPath(selected);
        }
      } catch (e) {
        console.error("[transcribe] file picker error:", e);
      }
    });
  }

  // ===== SOURCE CLEAR =====
  const clearBtn = document.getElementById("transcribe-source-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.transcribeSource = null;
      transcribeUpdateUI();
    });
  }

  // ===== OPTIONS: MODEL =====
  const modelRow = document.getElementById("transcribe-model-row");
  if (modelRow) {
    modelRow.addEventListener("click", () => {
      showOptionsModal("Choisis le modele Whisper", TRANSCRIBE_MODELS, state.transcribeModel, (key) => {
        state.transcribeModel = key;
        transcribeUpdateUI();
      });
    });
  }

  // ===== OPTIONS: LANGUAGE =====
  const langRow = document.getElementById("transcribe-language-row");
  if (langRow) {
    langRow.addEventListener("click", () => {
      showOptionsModal("Choisis la langue", TRANSCRIBE_LANGUAGES, state.transcribeLanguage, (key) => {
        state.transcribeLanguage = key;
        transcribeUpdateUI();
      });
    });
  }

  // ===== OPTIONS: FORMATS =====
  const formatsRow = document.getElementById("transcribe-formats-row");
  if (formatsRow) {
    formatsRow.addEventListener("click", () => {
      showOptionsModal("Choisis les formats de sortie", TRANSCRIBE_FORMATS_OPTIONS, state.transcribeFormatsKey, (key) => {
        state.transcribeFormatsKey = key;
        transcribeUpdateUI();
      });
    });
  }

  // ===== OPTIONS: OUTPUT DIR =====
  const outputRow = document.getElementById("transcribe-output-row");
  if (outputRow) {
    outputRow.addEventListener("click", async () => {
      try {
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === "string") {
          state.transcribeOutputDir = selected;
          transcribeUpdateUI();
        }
      } catch (e) {
        console.error("[transcribe] folder picker error:", e);
      }
    });
  }

  // ===== DRAG & DROP =====
  try {
    const wv =
      (window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrentWebview)
        ? window.__TAURI__.webview.getCurrentWebview()
        : null;
    if (wv && typeof wv.onDragDropEvent === "function") {
      await wv.onDragDropEvent((event) => {
        if (state.currentModule !== "transcribe") return;
        const p = event.payload;
        if (!p) return;
        const zone = document.getElementById("transcribe-drop-zone");
        if (p.type === "enter" || p.type === "over") {
          zone?.classList.add("drag-over");
        } else if (p.type === "leave") {
          zone?.classList.remove("drag-over");
        } else if (p.type === "drop") {
          zone?.classList.remove("drag-over");
          const paths = Array.isArray(p.paths) ? p.paths : [];
          if (paths.length === 0) {
            showToast("Aucun element detecte", 2500);
            return;
          }
          if (paths.length > 1) {
            showToast("Drag un seul fichier a la fois", 3000);
            return;
          }
          transcribeSetSourceFromPath(paths[0]);
        }
      });
    } else {
      console.warn("[transcribe] Tauri webview.getCurrentWebview indisponible, drag&drop desactive");
    }
  } catch (err) {
    console.error("[transcribe] onDragDropEvent setup failed:", err);
  }

  // ===== LAUNCH BUTTON =====
  const btn = document.getElementById("transcribe-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (state.transcribing) return;

      const input = state.transcribeSourceType === "youtube"
        ? state.transcribeYoutubeUrl.trim()
        : state.transcribeSource;

      if (!input) {
        showToast("Aucune source", 2500);
        return;
      }

      const formats = TRANSCRIBE_FORMATS_MAP[state.transcribeFormatsKey] || ["txt", "srt", "vtt", "json"];
      const language = state.transcribeLanguage === "auto" ? null : state.transcribeLanguage;

      state.transcribing = true;
      transcribeUpdateUI();

      const progressSection = document.getElementById("transcribe-progress-section");
      const progressFill = document.getElementById("transcribe-progress-fill");
      const progressStage = document.getElementById("transcribe-progress-stage");
      const progressMeta = document.getElementById("transcribe-progress-meta");

      if (progressSection) progressSection.classList.remove("hidden");
      if (progressFill) progressFill.style.width = "0%";
      if (progressStage) progressStage.textContent = "Preparation...";
      if (progressMeta) progressMeta.textContent = "";

      try {
        const result = await invoke("transcribe", {
          input,
          outputDir: state.transcribeOutputDir,
          model: state.transcribeModel,
          language,
          formats,
          translateToEnglish: false,
        });

        if (result && result.success) {
          showToast("Transcription terminee : " + (result.output_files?.length || 0) + " fichier(s)", 3500);
          // Phase 5 : enrichi avec mediaPath + srtPath pour le drawer Recents
          const srtFromResult = (result.output_files || []).find(f => f.toLowerCase().endsWith(".srt")) || "";
          transcribeAddRecent({
            name: transcribeShortPath(input),
            model: state.transcribeModel,
            language: result.language_detected || language || "auto",
            formats: formats,
            outputFile: result.output_files?.[0] || "",
            mediaPath: input || "",
            srtPath: srtFromResult,
            ts: Date.now(),
          });

          // Phase 4.5 Etape 5 : auto-switch vers le module Lire
          try {
            const srtFile = (result.output_files || []).find(f => f.toLowerCase().endsWith(".srt"));
            if (srtFile && input && typeof window.openInPlayer === "function") {
              setTimeout(() => window.openInPlayer(input, srtFile), 600);
            }
          } catch (e) { console.error("[transcribe->player] auto-switch failed:", e); }
        } else {
          const err = result?.error || "Erreur inconnue";
          showToast("Echec : " + err.substring(0, 80), 5000);
          console.error("[transcribe] failed:", err);
        }
      } catch (e) {
        console.error("[transcribe] invoke error:", e);
        showToast("Erreur : " + String(e).substring(0, 80), 5000);
      } finally {
        state.transcribing = false;
        transcribeUpdateUI();
        if (progressSection) {
          setTimeout(() => progressSection.classList.add("hidden"), 2500);
        }
      }
    });
  }

  // ===== EVENT LISTENERS =====
  listen("transcribe-progress", (event) => {
    const p = event.payload;
    if (!p) return;
    const progressFill = document.getElementById("transcribe-progress-fill");
    const progressStage = document.getElementById("transcribe-progress-stage");
    const progressMeta = document.getElementById("transcribe-progress-meta");

    const pct = typeof p.pct === "number" ? p.pct : 0;
    const stage = p.stage || "";
    const stageLabels = {
      "download_video":  "Telechargement YouTube...",
      "extract_audio":   "Extraction audio...",
      "load_model":      "Chargement du modele Whisper...",
      "transcribe":      "Transcription...",
    };
    const stageLabel = stageLabels[stage] || stage;
    const metaText = Math.round(pct) + " %";
    // Legacy progress section
    if (progressFill) progressFill.style.width = pct + "%";
    if (progressStage) progressStage.textContent = stageLabel;
    if (progressMeta) progressMeta.textContent = metaText;
    // Phase 3 : miroir dans l'overlay
    if (typeof transcribeApplyProgress === "function") transcribeApplyProgress(pct, stageLabel, metaText);
  }).catch(e => console.error("[transcribe] listen progress failed:", e));

  listen("transcribe-file", (event) => {
    const p = event.payload;
    if (!p || !p.path) return;
    console.log("[transcribe] file written:", p.path);
  }).catch(e => console.error("[transcribe] listen file failed:", e));

  // Init UI state
  transcribeUpdateUI();
  transcribeRenderRecents();
}

// Auto-init at startup
initTranscribeModule();
// player-module-snippet.js
// Snippet a appendre a main.js apres "initTranscribeModule();"
// PowerShell ne touche pas a ce fichier, donc pas de probleme d'interpolation $


// player-module-v2.js
// Etape 2 : vrai lecteur HTML5 + parsing SRT + segments synchronises
// Remplace l'ancien initPlayerModule du step 1


// player-module-v3.js
// Etape 4+5 : edition + sauvegarde + auto-switch depuis Transcribe
// Remplace l'ancien initPlayerModule v2


// ============================================
// MODULE LIRE (player) - Phase 4.5 Etapes 4+5
// Lecteur HTML5 + transcription synchronisee + edition + auto-switch
// ============================================

// Helper global expose pour auto-switch depuis Transcribe
window.openInPlayer = function(mediaPath, srtPath) {
  if (typeof openModule === "function") openModule("player");
  // Petit delai pour laisser la page se rendre
  setTimeout(() => {
    if (typeof window.__playerLoad === "function") {
      window.__playerLoad(mediaPath, srtPath);
    }
  }, 100);
};

async function initPlayerModule() {
  const getEl = (id) => document.getElementById(id);
  const convertFileSrc = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc) || ((p) => p);

  const playerState = {
    mediaPath: null,
    srtPath: null,
    segments: [],
    activeSegmentIdx: -1,
    mediaEl: null,
    editMode: false,
    dirty: false,
  };

  // Garde "modifications non enregistrees" - utilisable par openModule/goHome
  // Renvoie true si OK pour quitter (pas dirty, ou utilisateur a confirme).
  window.__playerCanLeave = () => {
    if (!playerState.dirty) return true;
    return confirm("Modifications de sous-titres non enregistrees.\nContinuer sans enregistrer ?");
  };

  // Hook fermeture fenetre Tauri 2.x : intercepte le clic sur la croix
  try {
    const winApi =
      (window.__TAURI__ && window.__TAURI__.webviewWindow && window.__TAURI__.webviewWindow.getCurrentWebviewWindow) ||
      (window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow);
    if (winApi) {
      const w = winApi();
      if (w && typeof w.onCloseRequested === "function") {
        await w.onCloseRequested(async (event) => {
          if (!playerState.dirty) return;
          const ok = confirm("Modifications de sous-titres non enregistrees.\nFermer l'application sans enregistrer ?");
          if (!ok) {
            event.preventDefault();
          }
        });
      }
    }
  } catch (err) {
    console.error("[player] onCloseRequested setup failed:", err);
  }

  const mediaWrap = () => getEl("player-media-wrap");
  const segmentsWrap = () => getEl("player-segments-wrap");

  // ===== Drag and drop =====
  try {
    const wv =
      (window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrentWebview)
        ? window.__TAURI__.webview.getCurrentWebview()
        : null;
    if (wv && typeof wv.onDragDropEvent === "function") {
      await wv.onDragDropEvent((event) => {
        if (typeof state === "undefined" || state.currentModule !== "transcribe") return;
        const p = event.payload;
        if (!p) return;
        // Route via la zone drop-hero (etat VIDE). Aux autres etats, le drag-drop
        // n'a pas de zone visible : on ignore le highlight et on route directement.
        const empty = document.getElementById("transcribe-empty");
        const isEmptyState = empty && !empty.classList.contains("hidden");
        const hero = document.getElementById("transcribe-drop-hero");
        if (p.type === "enter" || p.type === "over") {
          if (isEmptyState && hero) hero.classList.add("drag-over");
        } else if (p.type === "leave") {
          if (hero) hero.classList.remove("drag-over");
        } else if (p.type === "drop") {
          if (hero) hero.classList.remove("drag-over");
          const paths = Array.isArray(p.paths) ? p.paths : [];
          if (paths.length === 0) {
            if (typeof showToast === "function") showToast("Aucun element detecte", 2500);
            return;
          }
          if (typeof transcribeRoutePaths === "function") transcribeRoutePaths(paths);
        }
      });
    }
  } catch (err) {
    console.error("[player] onDragDropEvent setup failed:", err);
  }

  // ===== Bouton Modifier (toggle mode edition) =====
  const btnEdit = getEl("player-edit-btn");
  if (btnEdit) {
    btnEdit.addEventListener("click", () => {
      playerState.editMode = !playerState.editMode;
      btnEdit.classList.toggle("active", playerState.editMode);
      btnEdit.title = playerState.editMode ? "Quitter le mode édition" : "Modifier les sous-titres";
      renderSegments();
      updateSaveButton();
    });
  }

  // ===== Bouton Enregistrer =====
  const btnSave = getEl("player-save-btn");
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!playerState.dirty || !playerState.srtPath) return;
      const srtContent = serializeToSRT(playerState.segments);
      try {
        await invoke("write_text_file", { path: playerState.srtPath, content: srtContent });
        playerState.dirty = false;
        updateSaveButton();
        if (typeof showToast === "function") showToast("Sous-titres sauvegardés", 2500);
      } catch (err) {
        console.error("[player] save failed:", err);
        if (typeof showToast === "function") showToast("Erreur sauvegarde : " + err, 4000);
      }
    });
  }

  function updateSaveButton() {
    if (!btnSave) return;
    // Save button visible quand on est en mode edition ET qu'il y a des modifs
    const visible = playerState.editMode && playerState.dirty;
    btnSave.classList.toggle("hidden", !visible);
  }

  // ===== Parser SRT =====
  function parseSRT(text) {
    const segments = [];
    const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
    const blocks = cleaned.split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.split("\n");
      if (lines.length < 2) continue;
      let timeLineIdx = 0;
      if (/^\d+$/.test(lines[0].trim())) timeLineIdx = 1;
      const timeLine = lines[timeLineIdx];
      const match = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
      if (!match) continue;
      const start = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/1000;
      const end = parseInt(match[5])*3600 + parseInt(match[6])*60 + parseInt(match[7]) + parseInt(match[8])/1000;
      const text = lines.slice(timeLineIdx + 1).join(" ").trim();
      if (text) segments.push({ start, end, text });
    }
    return segments;
  }

  // ===== Serialiser vers SRT =====
  function formatSRTTime(seconds) {
    const totalMs = Math.round(seconds * 1000);
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const s = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const m = totalMin % 60;
    const h = Math.floor(totalMin / 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "," + String(ms).padStart(3, "0");
  }

  function serializeToSRT(segments) {
    return segments.map((seg, i) => {
      return (i + 1) + "\n" + formatSRTTime(seg.start) + " --> " + formatSRTTime(seg.end) + "\n" + seg.text + "\n";
    }).join("\n");
  }

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  // Decoupe d'un segment SRT en phrases sur ponctuation forte (. ! ? ...)
  function splitToSentences(text) {
    if (!text) return [];
    return text
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Conversion SRT -> WebVTT en eclatant chaque segment en cues phrase par phrase.
  // Le temps est reparti au prorata du nombre de caracteres de chaque phrase.
  function srtToVttPerSentence(segments) {
    const fmt = (t) => {
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const sec = (t % 60).toFixed(3).padStart(6, "0");
      return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + sec;
    };
    let vtt = "WEBVTT\n\n";
    let cueIdx = 1;
    segments.forEach((seg) => {
      const sentences = splitToSentences(seg.text || "");
      if (sentences.length <= 1) {
        vtt += cueIdx + "\n" + fmt(seg.start) + " --> " + fmt(seg.end) + "\n" + (seg.text || "") + "\n\n";
        cueIdx++;
        return;
      }
      const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
      const totalDur = Math.max(0, seg.end - seg.start);
      let t = seg.start;
      sentences.forEach((sentence, i) => {
        const portion = sentence.length / totalChars;
        const dur = totalDur * portion;
        const cueStart = t;
        const cueEnd = (i === sentences.length - 1) ? seg.end : t + dur;
        vtt += cueIdx + "\n" + fmt(cueStart) + " --> " + fmt(cueEnd) + "\n" + sentence + "\n\n";
        t = cueEnd;
        cueIdx++;
      });
    });
    return vtt;
  }

  // ===== Charger le SRT =====
  async function loadSRT() {
    if (!playerState.srtPath) return;
    try {
      const text = await invoke("read_text_file", { path: playerState.srtPath });
      playerState.segments = parseSRT(text);
      playerState.dirty = false;
      console.log("[player] SRT charge :", playerState.segments.length, "segments");
    } catch (err) {
      console.error("[player] read_text_file failed:", err);
      if (typeof showToast === "function") showToast("Impossible de lire le SRT : " + err, 4000);
      playerState.segments = [];
    }
  }

  function findCurrentSegment(time) {
    for (let i = 0; i < playerState.segments.length; i++) {
      const seg = playerState.segments[i];
      if (time >= seg.start && time <= seg.end) return i;
    }
    return -1;
  }

  function renderMedia() {
    const wrap = mediaWrap();
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!playerState.mediaPath) {
      wrap.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">Aucun média chargé</div>';
      playerState.mediaEl = null;
      return;
    }
    const ext = playerState.mediaPath.split(".").pop().toLowerCase();
    const isVideo = ["mp4","mov","mkv","webm","avi"].includes(ext);
    const src = convertFileSrc(playerState.mediaPath);
    const tag = isVideo ? "video" : "audio";
    const el = document.createElement(tag);
    el.src = src;
    el.controls = true;
    el.style.width = "100%";
    if (isVideo) {
      el.style.maxHeight = "400px";
      el.style.display = "block";
      // Ajout track HTML5 pour sous-titres live (decoupes par phrase)
      if (playerState.srtPath) {
        try {
          const track = document.createElement("track");
          track.kind = "subtitles";
          track.label = "Francais";
          track.srclang = "fr";
          track.default = true;
          if (playerState.segments && playerState.segments.length > 0) {
            const vttBlob = new Blob([srtToVttPerSentence(playerState.segments)], { type: "text/vtt" });
            track.src = URL.createObjectURL(vttBlob);
            el.appendChild(track);
          }
        } catch (e) { console.warn("Track injection failed:", e); }
      }
    } else {
      el.style.padding = "20px";
    }
    el.addEventListener("timeupdate", () => {
      const idx = findCurrentSegment(el.currentTime);
      if (idx !== playerState.activeSegmentIdx) {
        playerState.activeSegmentIdx = idx;
        updateSegmentHighlight();
      }
    });
    wrap.appendChild(el);
    playerState.mediaEl = el;
  }

  function updateSegmentsCount() {
    const el = getEl("player-segments-count");
    if (!el) return;
    const n = playerState.segments.length;
    if (n === 0) {
      el.textContent = playerState.srtPath ? "Aucun segment" : "—";
    } else if (n === 1) {
      el.textContent = "1 segment";
    } else {
      el.textContent = n + " segments";
    }
  }

  // Phase 7 : parser timestamp tolerant (MM:SS, H:MM:SS, MM:SS.ms, HH:MM:SS,ms)
  function parseTimestamp(str) {
    if (typeof str !== "string") return NaN;
    const s = str.trim().replace(",", ".");
    if (!s) return NaN;
    const parts = s.split(":").map((p) => p.trim());
    if (parts.length === 0 || parts.length > 3) return NaN;
    for (const p of parts) if (!/^\d+(\.\d+)?$/.test(p)) return NaN;
    if (parts.length === 1) return parseFloat(parts[0]);
    if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }

  // Phase 7 : valide les bornes d'un segment (start < end, pas de chevauchement)
  function validateSegmentBounds(start, end, excludeIdx) {
    if (isNaN(start) || isNaN(end)) return { ok: false, error: "Format de temps invalide." };
    if (start < 0) return { ok: false, error: "Le debut doit etre positif." };
    if (start >= end) return { ok: false, error: "La fin doit etre apres le debut." };
    for (let i = 0; i < playerState.segments.length; i++) {
      if (i === excludeIdx) continue;
      const seg = playerState.segments[i];
      if (start < seg.end && end > seg.start) {
        return { ok: false, error: "Chevauche le segment " + (i + 1) + " (" + formatTime(seg.start) + " - " + formatTime(seg.end) + ")." };
      }
    }
    return { ok: true };
  }

  // Phase 7 : suppression directe (dirty=true permet de revenir en arriere via reload)
  function deleteSegment(idx) {
    if (idx < 0 || idx >= playerState.segments.length) return;
    playerState.segments.splice(idx, 1);
    playerState.dirty = true;
    renderSegments();
    updateSaveButton();
    if (typeof showToast === "function") showToast("Segment supprime", 1500);
  }

  // Phase 7 : commit d'un nouveau start tape inline sur le timestamp
  function commitTimestampEdit(idx, newStr) {
    const seg = playerState.segments[idx];
    if (!seg) return false;
    const newStart = parseTimestamp(newStr);
    if (isNaN(newStart)) {
      if (typeof showToast === "function") showToast("Format de temps invalide", 2500);
      return false;
    }
    const newEnd = seg.end > newStart ? seg.end : newStart + 1; // garde une duree minimale
    const v = validateSegmentBounds(newStart, newEnd, idx);
    if (!v.ok) {
      if (typeof showToast === "function") showToast(v.error, 3000);
      return false;
    }
    seg.start = newStart;
    if (newEnd !== seg.end) seg.end = newEnd;
    // Tri par start au cas ou
    playerState.segments.sort((a, b) => a.start - b.start);
    playerState.dirty = true;
    renderSegments();
    updateSaveButton();
    return true;
  }

  function renderSegments() {
    const wrap = segmentsWrap();
    if (!wrap) return;
    updateSegmentsCount();
    wrap.innerHTML = "";
    if (playerState.segments.length === 0) {
      if (playerState.srtPath) {
        wrap.innerHTML = '<div style="padding:12px; color:#aaa; font-size:13px;">Aucun segment dans le SRT</div>';
      } else {
        wrap.innerHTML = '<div style="padding:12px; color:#aaa; font-size:13px;">Charge un .srt pour voir les sous-titres synchronisés</div>';
      }
      // En mode edition, on permet quand meme d'ajouter un premier segment
      if (playerState.editMode && playerState.srtPath) {
        const addEnd = makeAddSegmentEndButton();
        wrap.appendChild(addEnd);
      }
      return;
    }
    const list = document.createElement("div");
    list.className = "player-segments-list";
    if (playerState.editMode) list.classList.add("edit-mode");

    playerState.segments.forEach((seg, idx) => {
      // Separateur "+ Inserer ici" AVANT chaque segment sauf le premier (mode edit)
      if (playerState.editMode && idx > 0) {
        const insert = makeInsertSeparator(idx);
        list.appendChild(insert);
      }

      const item = document.createElement("div");
      item.className = "player-segment";
      item.dataset.idx = idx;

      const time = document.createElement("div");
      time.className = "player-segment-time";
      time.textContent = formatTime(seg.start);

      const text = document.createElement("div");
      text.className = "player-segment-text";
      text.textContent = seg.text;

      if (playerState.editMode) {
        // Edition inline du timestamp (start uniquement)
        time.contentEditable = "true";
        time.spellcheck = false;
        let originalTimeText = time.textContent;
        time.addEventListener("focus", () => {
          originalTimeText = time.textContent;
          // Selection complete au focus
          const range = document.createRange();
          range.selectNodeContents(time);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        time.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); time.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); time.textContent = originalTimeText; time.blur(); }
        });
        time.addEventListener("blur", () => {
          const newStr = time.textContent.trim();
          if (newStr === originalTimeText) return;
          const ok = commitTimestampEdit(idx, newStr);
          if (!ok) time.textContent = originalTimeText;
        });
        time.addEventListener("click", (e) => e.stopPropagation());

        // Edition texte
        text.contentEditable = "true";
        text.spellcheck = true;
        text.addEventListener("input", () => {
          playerState.segments[idx].text = text.textContent.trim();
          playerState.dirty = true;
          updateSaveButton();
        });
        text.addEventListener("click", (e) => e.stopPropagation());

        // Bouton poubelle (visible au hover)
        const del = document.createElement("button");
        del.type = "button";
        del.className = "player-segment-delete";
        del.title = "Supprimer ce segment";
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteSegment(idx);
        });
        item.appendChild(del);
      }

      item.appendChild(time);
      item.appendChild(text);

      // Le clic sur item = seek (sauf en mode edition sur les zones editables)
      item.addEventListener("click", (e) => {
        if (playerState.editMode) {
          const cls = e.target.classList;
          if (cls && (cls.contains("player-segment-text") || cls.contains("player-segment-time") || e.target.closest(".player-segment-delete"))) return;
        }
        if (playerState.mediaEl) {
          playerState.mediaEl.currentTime = seg.start;
          playerState.mediaEl.play();
        }
      });

      list.appendChild(item);
    });

    wrap.appendChild(list);

    // Bouton "+ Ajouter en fin" (mode edit)
    if (playerState.editMode) {
      const addEnd = makeAddSegmentEndButton();
      wrap.appendChild(addEnd);
    }
  }

  // Helper : separateur cliquable "+" entre 2 segments
  function makeInsertSeparator(insertIdx) {
    const sep = document.createElement("div");
    sep.className = "player-segment-insert";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-segment-insert-btn";
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Insérer ici</span>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSegmentModal(insertIdx);
    });
    sep.appendChild(btn);
    return sep;
  }

  // Helper : gros bouton "Ajouter un segment en fin"
  function makeAddSegmentEndButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-add-segment-end";
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Ajouter un segment</span>';
    btn.addEventListener("click", () => openSegmentModal(playerState.segments.length));
    return btn;
  }

  // ===== Phase 7 : MODAL d'ajout de segment =====
  let _segmentModalInsertIdx = -1;
  function openSegmentModal(insertIdx) {
    _segmentModalInsertIdx = insertIdx;
    const segs = playerState.segments;
    const prev = insertIdx > 0 ? segs[insertIdx - 1] : null;
    const next = insertIdx < segs.length ? segs[insertIdx] : null;
    const defaultStart = prev ? prev.end : 0;
    const defaultEnd = next ? next.start : defaultStart + 3;
    const startInput = getEl("segment-modal-start");
    const endInput = getEl("segment-modal-end");
    const textInput = getEl("segment-modal-text");
    const errorEl = getEl("segment-modal-error");
    if (startInput) startInput.value = formatTime(defaultStart);
    if (endInput) endInput.value = formatTime(defaultEnd);
    if (textInput) textInput.value = "";
    if (errorEl) { errorEl.classList.add("hidden"); errorEl.textContent = ""; }
    const modal = getEl("segment-modal");
    if (modal) modal.classList.remove("hidden");
    setTimeout(() => { if (textInput) textInput.focus(); }, 50);
  }
  function closeSegmentModal() {
    const modal = getEl("segment-modal");
    if (modal) modal.classList.add("hidden");
    _segmentModalInsertIdx = -1;
  }
  function submitSegmentModal() {
    const startInput = getEl("segment-modal-start");
    const endInput = getEl("segment-modal-end");
    const textInput = getEl("segment-modal-text");
    const errorEl = getEl("segment-modal-error");
    if (!startInput || !endInput || !textInput) return;
    const start = parseTimestamp(startInput.value);
    const end = parseTimestamp(endInput.value);
    const text = (textInput.value || "").trim();
    if (!text) {
      if (errorEl) { errorEl.textContent = "Le texte ne peut pas etre vide."; errorEl.classList.remove("hidden"); }
      textInput.focus();
      return;
    }
    const v = validateSegmentBounds(start, end, -1);
    if (!v.ok) {
      if (errorEl) { errorEl.textContent = v.error; errorEl.classList.remove("hidden"); }
      return;
    }
    // Insertion + tri
    playerState.segments.push({ start, end, text });
    playerState.segments.sort((a, b) => a.start - b.start);
    playerState.dirty = true;
    renderSegments();
    updateSaveButton();
    closeSegmentModal();
    if (typeof showToast === "function") showToast("Segment ajoute", 1500);
  }
  // Bind du modal (une seule fois)
  {
    const cancelBtn = getEl("segment-modal-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeSegmentModal);
    const okBtn = getEl("segment-modal-ok");
    if (okBtn) okBtn.addEventListener("click", submitSegmentModal);
    const modalEl = getEl("segment-modal");
    if (modalEl) {
      modalEl.addEventListener("click", (e) => {
        if (e.target === modalEl) closeSegmentModal();
      });
    }
    document.addEventListener("keydown", (e) => {
      const m = getEl("segment-modal");
      if (!m || m.classList.contains("hidden")) return;
      if (e.key === "Escape") closeSegmentModal();
    });
  }

  function updateSegmentHighlight() {
    const wrap = segmentsWrap();
    if (!wrap) return;
    const items = wrap.querySelectorAll(".player-segment");
    items.forEach((item, idx) => {
      if (idx === playerState.activeSegmentIdx) {
        item.classList.add("active");
        // Scroll uniquement dans le conteneur, jamais la page entiere
        const itemRect = item.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const itemTopInWrap = itemRect.top - wrapRect.top + wrap.scrollTop;
        const itemBottomInWrap = itemTopInWrap + item.offsetHeight;
        const viewTop = wrap.scrollTop;
        const viewBottom = viewTop + wrap.clientHeight;
        if (itemTopInWrap < viewTop || itemBottomInWrap > viewBottom) {
          const target = itemTopInWrap - wrap.clientHeight / 2 + item.offsetHeight / 2;
          wrap.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        }
      } else {
        item.classList.remove("active");
      }
    });
  }

  async function refreshPlayerUI() {
    if (playerState.mediaPath || playerState.srtPath) {
      // Bascule en etat EDIT (sidebar onglets [Segments] [Export])
      if (typeof transcribeShowEdit === "function") transcribeShowEdit();
      if (typeof transcribeUpdateEditChip === "function") {
        transcribeUpdateEditChip(playerState.mediaPath, playerState.srtPath);
      }
      if (playerState.srtPath) await loadSRT();
      renderMedia();
      renderSegments();

      // Activer le bouton edit si SRT charge
      const editBtn = getEl("player-edit-btn");
      if (editBtn) editBtn.disabled = !playerState.srtPath;
      updateSaveButton();
    }
  }

  // ===== EXPORT PANEL =====
  const exportState = { font: "DM Sans" };
  const FONT_OPTIONS = [
    { key: "DM Sans", label: "DM Sans", desc: "Sans-serif moderne (defaut)" },
    { key: "Syne", label: "Syne", desc: "Sans-serif editorial" },
    { key: "Inter", label: "Inter", desc: "Sans-serif neutre" },
    { key: "Arial", label: "Arial", desc: "Sans-serif systeme" },
    { key: "Helvetica", label: "Helvetica", desc: "Sans-serif classique" },
    { key: "Georgia", label: "Georgia", desc: "Serif lisible" },
    { key: "Times New Roman", label: "Times New Roman", desc: "Serif classique" },
    { key: "Courier New", label: "Courier New", desc: "Monospace" },
  ];

  const fontRow = getEl("export-font-row");
  if (fontRow) {
    fontRow.addEventListener("click", () => {
      if (typeof showOptionsModal !== "function") return;
      showOptionsModal("Police des sous-titres", FONT_OPTIONS, exportState.font, (key) => {
        exportState.font = key;
        const lbl = getEl("export-font-label");
        if (lbl) lbl.textContent = "Police : " + key;
      });
    });
  }

  const exportLaunchBtn = getEl("export-launch-btn");
  if (exportLaunchBtn) {
    exportLaunchBtn.addEventListener("click", () => {
      if (!playerState.mediaPath || !playerState.srtPath) {
        if (typeof showToast === "function") showToast("Charge un media et un SRT d'abord", 2500);
        return;
      }
      // Stub UI : le backend export n'est pas encore branche
      if (typeof showToast === "function") {
        showToast("Export bientot disponible - police : " + exportState.font, 3500);
      }
    });
  }

  window.__playerLoad = function(mediaPath, srtPath) {
    if (mediaPath) playerState.mediaPath = mediaPath;
    if (srtPath) playerState.srtPath = srtPath;
    refreshPlayerUI();
  };

  // Phase 6 : reset complet du player (utilise par le chip-clear edit)
  window.__playerReset = function() {
    playerState.mediaPath = null;
    playerState.srtPath = null;
    playerState.segments = [];
    playerState.activeSegmentIdx = -1;
    playerState.editMode = false;
    playerState.dirty = false;
    playerState.mediaEl = null;
    const mw = getEl("player-media-wrap");
    if (mw) mw.innerHTML = "";
    const sw = getEl("player-segments-wrap");
    if (sw) sw.innerHTML = "";
    const editBtn = getEl("player-edit-btn");
    if (editBtn) { editBtn.disabled = true; editBtn.classList.remove("active"); }
    const saveBtn = getEl("player-save-btn");
    if (saveBtn) saveBtn.classList.add("hidden");
    if (typeof updateSegmentsCount === "function") updateSegmentsCount();
  };
}

initPlayerModule();

