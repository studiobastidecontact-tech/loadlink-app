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
  transcribe: { title: "Transcrire", sub: "Convertit un fichier audio ou vidéo en texte horodaté.", ready: false },
  compress:   { title: "Compresser", sub: "Archive en ZIP ou réencode des vidéos en H.265.", ready: true },
  convert:    { title: "Convertir", sub: "Change le format d'un fichier local sans perte de qualité.", ready: false },
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

const setCompressSourceFromFiles = (fileList, rootName) => {
  state.compressSource = fileList;
  state.compressSourceType = "files";
  state.compressSourceLabel = rootName || null;
  const count = fileList.length;
  const totalSize = fileList.reduce((sum, item) => sum + item.file.size, 0);
  const mb = (totalSize / 1_048_576).toFixed(1);
  let label;
  if (rootName) {
    label = `Dossier « ${rootName} » : ${count} fichier${count > 1 ? "s" : ""} (${mb} Mo)`;
  } else {
    label = count === 1
      ? `${fileList[0].file.name} (${mb} Mo)`
      : `${count} fichiers (${mb} Mo)`;
  }
  showCompressSourceInfo(label);
  updateCompressBtnState();
};

// ============================================
// HTML5 DRAG & DROP
// ============================================
window.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
window.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); });

const dropZone = () => $("compress-drop-zone");

const onDragEnter = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (state.currentModule !== "compress") return;
  dropZone()?.classList.add("drag-over");
};

const onDragOver = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (state.currentModule !== "compress") return;
  e.dataTransfer.dropEffect = "copy";
  dropZone()?.classList.add("drag-over");
};

const onDragLeave = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.target === dropZone()) {
    dropZone()?.classList.remove("drag-over");
  }
};

const readDirectoryRecursive = (dirEntry, pathPrefix = "") => {
  return new Promise((resolve, reject) => {
    const reader = dirEntry.createReader();
    const allEntries = [];

    const readBatch = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            const promises = allEntries.map((entry) => {
              const newPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
              if (entry.isFile) {
                return new Promise((res, rej) => {
                  entry.file(
                    (f) => res([{ file: f, relativePath: newPath }]),
                    (err) => rej(err)
                  );
                });
              } else if (entry.isDirectory) {
                return readDirectoryRecursive(entry, newPath);
              }
              return Promise.resolve([]);
            });
            Promise.all(promises)
              .then((results) => resolve(results.flat()))
              .catch(reject);
          } else {
            allEntries.push(...entries);
            readBatch();
          }
        },
        (err) => reject(err)
      );
    };

    readBatch();
  });
};

const processEntry = (entry, pathPrefix = "") => {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file(
        (f) => resolve([{ file: f, relativePath: pathPrefix ? `${pathPrefix}/${f.name}` : f.name }]),
        (err) => reject(err)
      );
    } else if (entry.isDirectory) {
      readDirectoryRecursive(entry, pathPrefix || entry.name)
        .then(resolve)
        .catch(reject);
    } else {
      resolve([]);
    }
  });
};

const onDrop = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone()?.classList.remove("drag-over");

  if (state.currentModule !== "compress") {
    showToast("Le drag & drop n'est dispo que sur Compresser pour l'instant", 2500);
    return;
  }

  const dt = e.dataTransfer;
  if (!dt) return;

  const items = dt.items;
  if (!items || items.length === 0) {
    if (dt.files && dt.files.length > 0) {
      const fileList = Array.from(dt.files).map((f) => ({ file: f, relativePath: f.name }));
      setCompressSourceFromFiles(fileList, null);
      showToast(`${fileList.length} fichier${fileList.length > 1 ? "s" : ""} ajouté${fileList.length > 1 ? "s" : ""}`, 1800);
      return;
    }
    showToast("Aucun fichier détecté", 2500);
    return;
  }

  const entries = [];
  let rootName = null;
  let hasDirectory = false;

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
      if (entry.isDirectory) {
        hasDirectory = true;
        if (items.length === 1) rootName = entry.name;
      }
    }
  }

  if (entries.length === 0) {
    showToast("Impossible de lire les éléments dropés", 3000);
    return;
  }

  showToast(hasDirectory ? "Lecture du contenu…" : "Préparation des fichiers…", 1500);

  try {
    const allFilesArrays = await Promise.all(
      entries.map((entry) => processEntry(entry, ""))
    );
    const allFiles = allFilesArrays.flat();

    if (allFiles.length === 0) {
      showToast("Aucun fichier trouvé dans les éléments dropés", 3000);
      return;
    }

    let finalFiles = allFiles;
    if (rootName && items.length === 1) {
      finalFiles = allFiles.map((item) => ({
        file: item.file,
        relativePath: `${rootName}/${item.relativePath}`,
      }));
    }

    setCompressSourceFromFiles(finalFiles, rootName);

    const fileCount = finalFiles.length;
    if (rootName) {
      showToast(`Dossier « ${rootName} » : ${fileCount} fichier${fileCount > 1 ? "s" : ""}`, 2200);
    } else {
      showToast(fileCount === 1 ? "Fichier ajouté" : `${fileCount} fichiers ajoutés`, 1800);
    }
  } catch (err) {
    console.error("Drop processing error:", err);
    showToast("Erreur lors de la lecture : " + err, 4000);
  }
};

const attachDropListeners = () => {
  const zone = dropZone();
  if (!zone) return;
  zone.addEventListener("dragenter", onDragEnter);
  zone.addEventListener("dragover", onDragOver);
  zone.addEventListener("dragleave", onDragLeave);
  zone.addEventListener("drop", onDrop);
};

// ============================================
// FILE → BASE64 (full file, for small files)
// ============================================
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    const commaIdx = result.indexOf(",");
    if (commaIdx < 0) {
      reject(new Error("Impossible de lire le fichier"));
      return;
    }
    resolve(result.substring(commaIdx + 1));
  };
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// ============================================
// FILE BLOB → BASE64 (one chunk at a time, for large files)
// ============================================
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    const commaIdx = result.indexOf(",");
    if (commaIdx < 0) {
      reject(new Error("Impossible de lire le chunk"));
      return;
    }
    resolve(result.substring(commaIdx + 1));
  };
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// ============================================
// STREAMING CHUNKED UPLOAD for large files (>= 100 MB)
// ============================================

/**
 * Stream a single large file to the Rust backend in chunks.
 * Returns the upload_id once complete.
 */
const streamFileToBackend = async (file, relativePath, onProgress) => {
  // Start a new upload session for this file
  const uploadId = await invoke("chunked_upload_start", { relativePath });

  const totalSize = file.size;
  let bytesSent = 0;
  let offset = 0;

  while (offset < totalSize) {
    const end = Math.min(offset + CHUNK_SIZE, totalSize);
    const chunkBlob = file.slice(offset, end);
    const chunkB64 = await blobToBase64(chunkBlob);

    await invoke("chunked_upload_append", {
      uploadId,
      chunk: chunkB64,
    });

    bytesSent = end;
    offset = end;

    if (onProgress) {
      onProgress(bytesSent, totalSize);
    }
  }

  return uploadId;
};

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
    if (state.compressSourceType === "files") {
      if (state.compressMode === "reencode") {
        showToast("Réencodage par drag & drop non encore supporté. Utilise « Choisir un dossier ».", 4000);
        $("compress-progress-section").classList.add("hidden");
        state.compressing = false;
        updateCompressBtnState();
        return;
      }

      const items = state.compressSource;
      const totalBytes = items.reduce((sum, it) => sum + it.file.size, 0);
      const hasLargeFile = items.some((it) => it.file.size >= STREAMING_THRESHOLD);
      const useStreaming = hasLargeFile || totalBytes >= STREAMING_THRESHOLD;

      const archiveName = state.compressSourceLabel
        || (items.length === 1
          ? items[0].file.name.replace(/\.[^.]+$/, "") || "archive"
          : `drop-${items.length}-fichiers`);

      let result;

      if (useStreaming) {
        // ===== CHUNKED STREAMING PATH =====
        const totalMB = (totalBytes / 1_048_576).toFixed(1);
        $("compress-progress-stage").textContent = `Upload streaming (${totalMB} Mo)…`;

        const uploadIds = [];
        let globalBytesSent = 0;

        try {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const fileSizeMB = (item.file.size / 1_048_576).toFixed(1);
            $("compress-progress-meta").textContent =
              `Fichier ${i + 1}/${items.length} : ${item.relativePath} (${fileSizeMB} Mo)`;

            const uploadId = await streamFileToBackend(
              item.file,
              item.relativePath,
              (bytesInFile, fileTotal) => {
                const filePct = bytesInFile / fileTotal;
                const overallSent = globalBytesSent + bytesInFile;
                const overallPct = (overallSent / totalBytes) * 100;
                $("compress-progress-fill").style.width = Math.min(overallPct, 99) + "%";
                $("compress-progress-stage").textContent =
                  `Upload ${overallPct.toFixed(0)}% (fichier ${i + 1}/${items.length})`;
              }
            );

            uploadIds.push(uploadId);
            globalBytesSent += item.file.size;
          }

          // All files uploaded, launch compression
          $("compress-progress-stage").textContent = "Compression en cours…";
          $("compress-progress-meta").textContent = "";
          $("compress-progress-fill").style.width = "0%";

          result = await invoke("chunked_upload_compress", {
            uploadIds,
            outputDir: state.compressOutputDir,
            level: parseInt(state.zipLevel),
            archiveName,
          });
        } catch (uploadErr) {
          // Cleanup on error
          await invoke("chunked_upload_cancel").catch(() => {});
          throw uploadErr;
        }
      } else {
        // ===== BASE64 IN-MEMORY PATH (fast, small files) =====
        $("compress-progress-stage").textContent = "Lecture des fichiers…";
        const filesPayload = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          $("compress-progress-meta").textContent = `${i + 1}/${items.length} : ${item.relativePath}`;
          const data = await fileToBase64(item.file);
          filesPayload.push({ filename: item.relativePath, data });
        }

        $("compress-progress-stage").textContent = "Envoi au moteur de compression…";
        $("compress-progress-meta").textContent = "";

        result = await invoke("compress_files_from_data", {
          files: filesPayload,
          outputDir: state.compressOutputDir,
          level: parseInt(state.zipLevel),
          archiveName,
        });
      }

      // Handle result (same for both paths)
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
    } else {
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
  attachDropListeners();

  if (!localStorage.getItem("welcome-seen-v3")) {
    $("welcome-modal").classList.remove("hidden");
  }

  checkYtdlpUpdate();
})();