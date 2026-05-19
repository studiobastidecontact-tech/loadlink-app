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
  video:      { title: "Vidéo", sub: "Découpage, recadrage, sous-titres et effets vidéo.", ready: false },
  ai:         { title: "IA Studio", sub: "Traitements assistés par intelligence artificielle.", ready: false },
  import:     { title: "Importer", sub: "Importe automatiquement depuis carte SD, drone, caméra.", ready: false },
  plugins:    { title: "Plugins", sub: "Extensions tierces pour étendre LoadLink.", ready: false }
};

// Streaming threshold: files >= this size will use chunked upload
const STREAMING_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk

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
  state.currentModule = moduleKey;
  homePage().classList.add("hidden");
  appPage().classList.remove("hidden");
  $$(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.module === moduleKey);
  });
  hideAllModulePages();
  if (info.ready) {
    showModulePage("page-" + moduleKey);
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

function transcribeRenderRecents() {
  const section = document.getElementById("transcribe-history-section");
  const list = document.getElementById("transcribe-history-list");
  if (!section || !list) return;

  let recents = [];
  try {
    recents = JSON.parse(localStorage.getItem("transcribe-recents") || "[]");
  } catch (e) {
    recents = [];
  }

  if (recents.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  list.innerHTML = recents.slice(0, 5).map(r => `
    <div class="history-item" data-path="${r.outputFile || ''}">
      <div class="history-item-name">${r.name}</div>
      <div class="history-item-meta">${r.model} - ${r.language || 'auto'} - ${r.formats.join(', ')}</div>
    </div>
  `).join("");
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

// Phase 4 : deplace une seule fois les elements du player legacy vers les slots edit.
// Apres ce deplacement, les IDs (#player-media-wrap, #player-segments-wrap, etc.)
// restent valides donc le JS du player continue a fonctionner sans modification.
let _editDOMMounted = false;
function transcribeMountEditFromLegacy() {
  if (_editDOMMounted) return;
  const moves = [
    { src: "player-media-wrap", dst: "edit-media-slot" },
    { src: "player-waveform-wrap", dst: "edit-waveform-slot" },
    { src: "player-segments-wrap", dst: "edit-segments-slot" },
  ];
  for (const m of moves) {
    const srcEl = document.getElementById(m.src);
    const dstEl = document.getElementById(m.dst);
    if (srcEl && dstEl && srcEl.parentElement !== dstEl) {
      dstEl.appendChild(srcEl);
    }
  }
  // Deplace aussi les boutons du header segments (compteur + edit + save)
  const actionsSlot = document.getElementById("edit-segments-actions-slot");
  if (actionsSlot) {
    ["player-segments-count", "player-edit-btn", "player-save-btn"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== actionsSlot) actionsSlot.appendChild(el);
    });
  }
  // Deplace les controles du panneau Export (option-row police + bouton primary)
  const exportSlot = document.getElementById("edit-export-slot");
  if (exportSlot) {
    ["export-font-row", "export-launch-btn"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== exportSlot) exportSlot.appendChild(el);
    });
  }
  _editDOMMounted = true;
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
  // Garde "modifs non enregistrees" : reutilise window.__playerCanLeave si dispo
  const editChipClear = document.getElementById("transcribe-edit-chip-clear");
  if (editChipClear) {
    editChipClear.addEventListener("click", () => {
      if (typeof window.__playerCanLeave === "function" && !window.__playerCanLeave()) return;
      // Reuse les boutons clear legacy qui font deja le bon reset state
      const clrM = document.getElementById("player-clear-media-btn");
      const clrS = document.getElementById("player-clear-srt-btn");
      // Force le reset sans re-confirmer (on a deja confirme via __playerCanLeave)
      // -> on clique mais le handler legacy va re-prompter si dirty. On contourne en
      //    mettant playerState.dirty a false avant (deja fait par canLeave si OK).
      if (clrM) clrM.click();
      if (clrS) clrS.click();
      // Reset aussi la source transcribe
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
          transcribeAddRecent({
            name: transcribeShortPath(input),
            model: state.transcribeModel,
            language: result.language_detected || language || "auto",
            formats: formats,
            outputFile: result.output_files?.[0] || "",
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

  const dropZone = () => getEl("player-drop-zone");
  const playerZone = () => getEl("player-zone");
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
        // Phase 1 : detecte si on est en etat VIDE (nouveau drop hero) ou LEGACY (ancien player drop zone)
        const empty = document.getElementById("transcribe-empty");
        const isEmptyState = empty && !empty.classList.contains("hidden");
        const hero = document.getElementById("transcribe-drop-hero");
        const zone = dropZone();
        const visibleZone = isEmptyState ? hero : zone;
        if (p.type === "enter" || p.type === "over") {
          if (visibleZone) visibleZone.classList.add("drag-over");
        } else if (p.type === "leave") {
          if (visibleZone) visibleZone.classList.remove("drag-over");
        } else if (p.type === "drop") {
          if (visibleZone) visibleZone.classList.remove("drag-over");
          const paths = Array.isArray(p.paths) ? p.paths : [];
          if (paths.length === 0) {
            if (typeof showToast === "function") showToast("Aucun élément détecté", 2500);
            return;
          }
          if (isEmptyState && typeof transcribeRoutePaths === "function") {
            transcribeRoutePaths(paths);
          } else {
            paths.forEach(autoAssignFile);
            refreshPlayerUI();
          }
        }
      });
    }
  } catch (err) {
    console.error("[player] onDragDropEvent setup failed:", err);
  }

  function autoAssignFile(path) {
    const ext = path.split(".").pop().toLowerCase();
    if (ext === "srt") {
      playerState.srtPath = path;
      const label = getEl("player-srt-label");
      if (label) label.textContent = path.split(/[\\/]/).pop();
    } else if (["mp3","wav","m4a","flac","ogg","mp4","mov","mkv","webm","avi"].includes(ext)) {
      playerState.mediaPath = path;
      const label = getEl("player-media-label");
      if (label) label.textContent = path.split(/[\\/]/).pop();
    } else {
      if (typeof showToast === "function") showToast("Format non supporté : " + ext, 3000);
    }
  }

  // ===== File pickers =====
  const btnMedia = getEl("player-select-media-btn");
  if (btnMedia) {
    btnMedia.addEventListener("click", async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: "Audio/Vidéo", extensions: ["mp3","wav","m4a","flac","ogg","mp4","mov","mkv","webm","avi"] }],
        });
        if (selected) {
          playerState.mediaPath = selected;
          const label = getEl("player-media-label");
          if (label) label.textContent = selected.split(/[\\/]/).pop();
          refreshPlayerUI();
        }
      } catch (e) { console.error("[player] picker media error:", e); }
    });
  }

  const btnSrt = getEl("player-select-srt-btn");
  if (btnSrt) {
    btnSrt.addEventListener("click", async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: "Sous-titres SRT", extensions: ["srt"] }],
        });
        if (selected) {
          playerState.srtPath = selected;
          const label = getEl("player-srt-label");
          if (label) label.textContent = selected.split(/[\\/]/).pop();
          refreshPlayerUI();
        }
      } catch (e) { console.error("[player] picker srt error:", e); }
    });
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

  // Gestion de la carte "Charger un fichier" collapsible : resume + auto-collapse une fois
  let _autoCollapsedOnce = false;
  function updateLoadCardSummary() {
    const summary = getEl("player-load-summary-text");
    const card = getEl("player-load-card");
    if (!summary) return;
    const m = playerState.mediaPath ? playerState.mediaPath.split(/[\\/]/).pop() : null;
    const s = playerState.srtPath ? playerState.srtPath.split(/[\\/]/).pop() : null;
    if (m && s) {
      summary.textContent = m + "  +  " + s;
    } else if (m) {
      summary.textContent = m;
    } else if (s) {
      summary.textContent = s;
    } else {
      summary.textContent = "Charger un fichier";
      _autoCollapsedOnce = false;
    }
    // Auto-collapse une seule fois quand au moins un fichier est charge
    if (card && (m || s) && !_autoCollapsedOnce) {
      card.classList.add("collapsed");
      _autoCollapsedOnce = true;
    }
  }

  // Toggle manuel : clic sur le header de la carte "Charger"
  const loadSummaryBtn = getEl("player-load-summary-btn");
  const loadCard = getEl("player-load-card");
  if (loadSummaryBtn && loadCard) {
    loadSummaryBtn.addEventListener("click", () => {
      loadCard.classList.toggle("collapsed");
    });
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
      return;
    }
    const list = document.createElement("div");
    list.className = "player-segments-list";
    if (playerState.editMode) list.classList.add("edit-mode");

    playerState.segments.forEach((seg, idx) => {
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
        text.contentEditable = "true";
        text.spellcheck = true;
        text.addEventListener("input", () => {
          playerState.segments[idx].text = text.textContent.trim();
          playerState.dirty = true;
          updateSaveButton();
        });
        // Empecher le seek sur clic en mode edition
        text.addEventListener("click", (e) => e.stopPropagation());
      }

      item.appendChild(time);
      item.appendChild(text);

      // Le clic sur item (pas sur le texte editable) = seek
      item.addEventListener("click", (e) => {
        // En mode edition, seul le clic sur la zone temps fait seek
        if (playerState.editMode && e.target.classList.contains("player-segment-text")) return;
        if (playerState.mediaEl) {
          playerState.mediaEl.currentTime = seg.start;
          playerState.mediaEl.play();
        }
      });

      list.appendChild(item);
    });
    wrap.appendChild(list);
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
    // Toujours synchroniser les boutons clear (visibles si fichier charge)
    updateClearButtons();
    // Toujours rafraichir le resume du <details> "Charger" (auto-collapse inclus)
    updateLoadCardSummary();
    if (playerState.mediaPath || playerState.srtPath) {
      // Phase 4 : monte les elements dans la nouvelle UI et bascule en EDIT
      if (typeof transcribeMountEditFromLegacy === "function") transcribeMountEditFromLegacy();
      if (typeof transcribeShowEdit === "function") transcribeShowEdit();
      else if (typeof transcribeShowLegacy === "function") transcribeShowLegacy();
      if (typeof transcribeUpdateEditChip === "function") {
        transcribeUpdateEditChip(playerState.mediaPath, playerState.srtPath);
      }
      playerZone().classList.remove("hidden");
      if (playerState.srtPath) await loadSRT();
      renderMedia();
      renderSegments();

      // Activer les boutons selon ce qui est charge
      const exportBtn = getEl("player-export-btn");
      const editBtn = getEl("player-edit-btn");
      const exportCard = getEl("player-export-card");
      const hasMedia = !!playerState.mediaPath;
      const hasSrt = !!playerState.srtPath;
      if (exportBtn) exportBtn.disabled = !(hasMedia && hasSrt);
      if (editBtn) editBtn.disabled = !hasSrt;
      if (exportCard) exportCard.classList.toggle("hidden", !(hasMedia && hasSrt));
      updateSaveButton();
    } else {
      // Tout est vide : cacher le panneau export
      const exportCard = getEl("player-export-card");
      if (exportCard) exportCard.classList.add("hidden");
    }
  }

  // ===== API publique pour auto-switch depuis Transcribe =====
  // Handlers boutons clear (Patch E)
  function updateClearButtons() {
    const clrM = getEl("player-clear-media-btn");
    const clrS = getEl("player-clear-srt-btn");
    if (clrM) clrM.classList.toggle("hidden", !playerState.mediaPath);
    if (clrS) clrS.classList.toggle("hidden", !playerState.srtPath);
  }
  const clearMediaBtn = getEl("player-clear-media-btn");
  if (clearMediaBtn) {
    clearMediaBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playerState.mediaPath = null;
      playerState.mediaEl = null;
      const lbl = getEl("player-media-label");
      if (lbl) lbl.textContent = "Choisir l'audio/video";
      refreshPlayerUI();
      updateClearButtons();
    });
  }
  const clearSrtBtn = getEl("player-clear-srt-btn");
  if (clearSrtBtn) {
    clearSrtBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (playerState.dirty && !confirm("Modifications de sous-titres non enregistrees.\nAbandonner les modifications ?")) return;
      playerState.srtPath = null;
      playerState.segments = [];
      playerState.dirty = false;
      const lbl = getEl("player-srt-label");
      if (lbl) lbl.textContent = "Choisir le fichier .srt";
      refreshPlayerUI();
      updateSegmentsCount();
      updateClearButtons();
      updateSaveButton();
    });
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

  // Bouton export du header : scroll vers le panneau si visible
  const exportHeaderBtn = getEl("player-export-btn");
  if (exportHeaderBtn) {
    exportHeaderBtn.addEventListener("click", () => {
      const card = getEl("player-export-card");
      if (card && !card.classList.contains("hidden")) {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

    window.__playerLoad = function(mediaPath, srtPath) {
    if (mediaPath) {
      playerState.mediaPath = mediaPath;
      const lblM = getEl("player-media-label");
      if (lblM) lblM.textContent = mediaPath.split(/[\\/]/).pop();
    }
    if (srtPath) {
      playerState.srtPath = srtPath;
      const lblS = getEl("player-srt-label");
      if (lblS) lblS.textContent = srtPath.split(/[\\/]/).pop();
    }
    refreshPlayerUI();
    updateClearButtons();
  };
}

initPlayerModule();

