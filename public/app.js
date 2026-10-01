/**
 * TikTok Dataset Explorer — Client Application
 * Handles data fetching, UI state, video playback, and rich inspection.
 */

// Application State
const state = {
  allVideos: [],
  filteredVideos: [],
  allProfiles: [],
  selectedProfile: null,
  activeFilter: 'all', // 'all' | 'single' | 'profile'
  activeSort: 'newest',
  searchQuery: '',
  selectedVideo: null,
  detailData: null,
  activeTab: 'overview',
  currentJobId: null,
  crawlPollTimer: null,
  currentProfileBaseViews: 0,
  activeMainTab: 'crawler',
  chatSessionId: null,
  isChatBusy: false,
};

// DOM Elements Cache
const elements = {
  mainTabs: {
    btnCrawler: document.getElementById('btnTabCrawler'),
    btnProfiles: document.getElementById('btnTabProfiles'),
    btnAnalytics: document.getElementById('btnTabAnalytics'),
    tabProfilesBadge: document.getElementById('tabProfilesBadge'),
    viewCrawler: document.getElementById('viewCrawler'),
    viewAnalytics: document.getElementById('viewAnalytics'),
  },
  chat: {
    messages: document.getElementById('chatMessages'),
    input: document.getElementById('chatInput'),
    btnSend: document.getElementById('btnSendChat'),
    btnClear: document.getElementById('btnClearChat'),
    modelIndicator: document.getElementById('chatModelIndicator'),
    suggChips: document.querySelectorAll('.sugg-chip'),
    workspace: document.getElementById('analyticsWorkspace'),
    videoSidebar: document.getElementById('aiVideoSidebar'),
    videoList: document.getElementById('aiVideoList'),
    sidebarTitle: document.getElementById('aiSidebarTitle'),
    sidebarBadge: document.getElementById('aiSidebarBadge'),
    btnCloseSidebar: document.getElementById('btnCloseVideoSidebar'),
    btnReopenSidebar: document.getElementById('btnReopenVideoSidebar'),
    btnToggleAllLocal: document.getElementById('btnToggleAllLocal'),
    btnToggleAllEmbed: document.getElementById('btnToggleAllEmbed'),
  },
  aiConfig: {
    backdrop: document.getElementById('aiConfigModalBackdrop'),
    card: document.getElementById('aiConfigModalCard'),
    closeBtn: document.getElementById('aiConfigModalClose'),
    btnOpen: document.getElementById('btnOpenAiConfig'),
    btnCancel: document.getElementById('btnCancelAiConfig'),
    form: document.getElementById('aiConfigForm'),
    presetChips: document.querySelectorAll('.preset-chip'),
    llmBaseUrl: document.getElementById('cfgLlmBaseUrl'),
    llmModel: document.getElementById('cfgLlmModel'),
    llmApiKey: document.getElementById('cfgLlmApiKey'),
    embeddingModel: document.getElementById('cfgEmbeddingModel'),
  },
  ingest: {
    input: document.getElementById('ingestInput'),
    concurrencySelect: document.getElementById('concurrencySelect'),
    btnClear: document.getElementById('btnClearIngest'),
    btnStart: document.getElementById('btnStartIngest'),
    quickChips: document.querySelectorAll('.chip-item'),
    profileHeroCard: document.getElementById('profileHeroCard'),
    profAvatar: document.getElementById('profAvatar'),
    profDisplayName: document.getElementById('profDisplayName'),
    profHandle: document.getElementById('profHandle'),
    profBio: document.getElementById('profBio'),
    profLink: document.getElementById('profLink'),
    profFollowers: document.getElementById('profFollowers'),
    profViews: document.getElementById('profViews'),
    profLikes: document.getElementById('profLikes'),
    profVideos: document.getElementById('profVideos'),
    crawlProgressCard: document.getElementById('crawlProgressCard'),
    progressStatusText: document.getElementById('progressStatusText'),
    progressCounter: document.getElementById('progressCounter'),
    progressBarFill: document.getElementById('progressBarFill'),
    progressVideoName: document.getElementById('progressVideoName'),
    btnStopCrawl: document.getElementById('btnStopCrawl'),
    progressIndicator: document.getElementById('progressIndicator'),
  },
  stats: {
    totalVideos: document.getElementById('statTotalVideos'),
    totalSize: document.getElementById('statTotalSize'),
    totalComments: document.getElementById('statTotalComments'),
    totalViews: document.getElementById('statTotalViews'),
  },
  filters: {
    pillBtns: document.querySelectorAll('.pill-btn'),
    allCount: document.getElementById('filterAllCount'),
    singleCount: document.getElementById('filterSingleCount'),
    profileCount: document.getElementById('filterProfileCount'),
    searchInput: document.getElementById('searchInput'),
    btnClearSearch: document.getElementById('btnClearSearch'),
    sortSelect: document.getElementById('sortSelect'),
  },
  grid: document.getElementById('videoGrid'),
  profilesGrid: document.getElementById('profilesGrid'),
  channelDetailBanner: document.getElementById('channelDetailBanner'),
  btnBackToProfiles: document.getElementById('btnBackToProfiles'),
  channelBannerAvatar: document.getElementById('channelBannerAvatar'),
  channelBannerName: document.getElementById('channelBannerName'),
  channelBannerUser: document.getElementById('channelBannerUser'),
  channelBannerLink: document.getElementById('channelBannerLink'),
  channelBannerBio: document.getElementById('channelBannerBio'),
  cbVideos: document.getElementById('cbVideos'),
  cbViews: document.getElementById('cbViews'),
  cbLikes: document.getElementById('cbLikes'),
  cbComments: document.getElementById('cbComments'),
  cbSize: document.getElementById('cbSize'),
  emptyState: document.getElementById('emptyState'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyDesc: document.getElementById('emptyDesc'),
  btnRefresh: document.getElementById('btnRefresh'),
  modal: {
    backdrop: document.getElementById('modalBackdrop'),
    card: document.getElementById('modalCard'),
    closeBtn: document.getElementById('modalClose'),
    player: document.getElementById('detailVideoPlayer'),
    fileSize: document.getElementById('modalFileSize'),
    resolution: document.getElementById('modalResolution'),
    sha256: document.getElementById('modalSha256'),
    btnCopySha: document.getElementById('btnCopySha'),
    dirPath: document.getElementById('modalDirPath'),
    btnDownloadVideo: document.getElementById('btnDownloadVideo'),
    btnDownloadThumb: document.getElementById('btnDownloadThumb'),
    btnOpenTikTok: document.getElementById('btnOpenTikTok'),
    authorAvatar: document.getElementById('detailAuthorAvatar'),
    authorName: document.getElementById('detailAuthorName'),
    authorHandle: document.getElementById('detailAuthorHandle'),
    statusChip: document.getElementById('detailStatusChip'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    // Tab Overview
    caption: document.getElementById('detailCaption'),
    engViews: document.getElementById('engViews'),
    engLikes: document.getElementById('engLikes'),
    engComments: document.getElementById('engComments'),
    engShares: document.getElementById('engShares'),
    engSaves: document.getElementById('engSaves'),
    musicTitle: document.getElementById('musicTitle'),
    musicAuthor: document.getElementById('musicAuthor'),
    publishedAt: document.getElementById('detailPublishedAt'),
    videoId: document.getElementById('detailVideoId'),
    // Tab Technical
    techTable: document.getElementById('techTable'),
    // Tab Comments
    commentsCount: document.getElementById('modalCommentsCount'),
    commentSearchInput: document.getElementById('commentSearchInput'),
    commentsTree: document.getElementById('commentsTree'),
    // Tab Raw JSON
    rawFileSelect: document.getElementById('rawFileSelect'),
    rawJsonViewer: document.getElementById('rawJsonViewer'),
  },
  toastContainer: document.getElementById('toastContainer'),
};

// ==========================================
// Formatting Helpers
// ==========================================

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toLocaleString();
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Không rõ';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightTags(text) {
  if (text === null || text === undefined) return '';
  const escaped = escapeHtml(String(text));
  return escaped
    .replace(/(#[a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]+)/g, '<span class="tag">$1</span>')
    .replace(/(@[a-zA-Z0-9_.-]+)/g, '<span class="tag">$1</span>');
}

function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ==========================================
// API & Data Fetching
// ==========================================

async function fetchVideos() {
  try {
    if (elements.btnRefresh) {
      elements.btnRefresh.classList.add('loading');
    }
    const res = await fetch('/api/videos?limit=5000');
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();
    state.allVideos = data.videos || [];

    updateStatsBar(data);
    updatePillCounters();
    applyFiltersAndSort();
    // Also fetch profiles in parallel
    fetchProfiles();
  } catch (err) {
    console.error('Failed to fetch videos:', err);
    showToast('Lỗi khi tải dữ liệu video: ' + err.message);
  } finally {
    if (elements.btnRefresh) {
      elements.btnRefresh.classList.remove('loading');
    }
  }
}

async function fetchProfiles() {
  try {
    const res = await fetch('/api/profiles');
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();
    state.allProfiles = data.profiles || [];
    updatePillCounters();
    if (state.activeFilter === 'profile' && !state.selectedProfile) {
      renderProfilesGrid();
    }
  } catch (err) {
    console.error('Failed to fetch profiles:', err);
  }
}

async function fetchVideoDetails(videoId, profileId) {
  try {
    const url = `/api/videos/${videoId}${profileId ? `?profileId=${profileId}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch details for video ${videoId}:`, err);
    return null;
  }
}

// ==========================================
// UI Updates & Stats
// ==========================================

function updateStatsBar(data) {
  const totalVideos = data.totalCount || state.allVideos.length;
  const totalSize = data.totalSize || state.allVideos.reduce((acc, v) => acc + (v.fileSize || 0), 0);
  const totalComments = data.totalComments || state.allVideos.reduce((acc, v) => acc + (v.commentsCount || 0), 0);
  const totalViews = state.allVideos.reduce((acc, v) => acc + (v.views || 0), 0);

  elements.stats.totalVideos.textContent = formatNumber(totalVideos);
  elements.stats.totalSize.textContent = formatBytes(totalSize);
  elements.stats.totalComments.textContent = formatNumber(totalComments);
  elements.stats.totalViews.textContent = formatNumber(totalViews);
}

function updatePillCounters() {
  const total = state.allVideos.length;
  const single = state.allVideos.filter((v) => !v.profileId).length;
  const profileCount = state.allProfiles.length;

  elements.filters.allCount.textContent = total;
  elements.filters.singleCount.textContent = single;
  elements.filters.profileCount.textContent = profileCount;
  if (elements.mainTabs.tabProfilesBadge) {
    elements.mainTabs.tabProfilesBadge.textContent = `${profileCount} kênh`;
  }
}

// ==========================================
// Filtering & Sorting
// ==========================================

async function selectProfile(profile) {
  state.selectedProfile = profile;
  state.activeFilter = 'profile';
  elements.filters.pillBtns.forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === 'profile');
  });

  renderChannelDetailBanner(profile);

  // Directly fetch all videos of this specific channel from the backend
  try {
    const pId = profile.profileId || '';
    const uName = profile.username || '';
    let url = `/api/videos?limit=5000`;
    if (pId) url += `&profileId=${encodeURIComponent(pId)}`;
    if (uName) url += `&username=${encodeURIComponent(uName)}`;

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.videos && data.videos.length > 0) {
        // Merge fetched channel videos into state.allVideos ensuring no missing records
        const existingIds = new Set(data.videos.map((v) => v.videoId));
        state.allVideos = [...data.videos, ...state.allVideos.filter((v) => !existingIds.has(v.videoId))];
      }
    }
  } catch (err) {
    console.error('Failed to load profile videos:', err);
  }

  applyFiltersAndSort();
  window.scrollTo({ top: document.querySelector('.toolbar')?.offsetTop - 70 || 0, behavior: 'smooth' });
}

function renderChannelDetailBanner(p) {
  if (!elements.channelDetailBanner) return;
  elements.channelDetailBanner.classList.remove('hidden');

  const avatarSrc = p.avatarUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="%236e7187"><circle cx="32" cy="22" r="14"/><path d="M32 40c-14 0-18 6-18 14v4h36v-4c0-8-4-14-18-14z"/></svg>';
  if (elements.channelBannerAvatar) elements.channelBannerAvatar.src = avatarSrc;
  if (elements.channelBannerName) elements.channelBannerName.textContent = p.displayName || p.username;
  if (elements.channelBannerUser) elements.channelBannerUser.textContent = `@${p.username}`;
  if (elements.channelBannerLink) {
    elements.channelBannerLink.href = p.profileUrl || `https://www.tiktok.com/@${p.username}`;
  }
  if (elements.channelBannerBio) {
    if (p.bio) {
      elements.channelBannerBio.textContent = p.bio;
      elements.channelBannerBio.style.display = 'block';
    } else {
      elements.channelBannerBio.style.display = 'none';
    }
  }
  if (elements.cbVideos) elements.cbVideos.textContent = formatNumber(p.localVideos);
  if (elements.cbViews) elements.cbViews.textContent = formatNumber(p.totalViews);
  if (elements.cbLikes) elements.cbLikes.textContent = formatNumber(p.totalLikes);
  if (elements.cbComments) elements.cbComments.textContent = formatNumber(p.totalComments);
  if (elements.cbSize) elements.cbSize.textContent = formatBytes(p.totalSize);
}

function renderProfilesGrid() {
  if (!elements.profilesGrid) return;
  elements.profilesGrid.innerHTML = '';

  let list = [...state.allProfiles];

  // 1. Search Query Filter for Profiles
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase().trim();
    list = list.filter((p) => {
      const u = (p.username || '').toLowerCase();
      const dn = (p.displayName || '').toLowerCase();
      const bio = (p.bio || '').toLowerCase();
      return u.includes(q) || dn.includes(q) || bio.includes(q);
    });
  }

  // 2. Sorting
  switch (state.activeSort) {
    case 'views':
      list.sort((a, b) => (b.totalViews || 0) - (a.totalViews || 0));
      break;
    case 'likes':
      list.sort((a, b) => (b.totalLikes || b.tiktokLikes || 0) - (a.totalLikes || a.tiktokLikes || 0));
      break;
    case 'comments':
      list.sort((a, b) => (b.totalComments || 0) - (a.totalComments || 0));
      break;
    case 'size':
      list.sort((a, b) => (b.totalSize || 0) - (a.totalSize || 0));
      break;
    case 'newest':
    default:
      list.sort((a, b) => (b.localVideos || 0) - (a.localVideos || 0) || (b.followers || 0) - (a.followers || 0));
      break;
  }

  if (list.length === 0) {
    elements.emptyState.classList.remove('hidden');
    if (elements.emptyTitle) elements.emptyTitle.textContent = 'Không tìm thấy kênh nào';
    if (elements.emptyDesc) elements.emptyDesc.textContent = 'Thử tìm với từ khóa khác hoặc cào thêm kênh mới.';
    return;
  }
  elements.emptyState.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  list.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'profile-card';

    const pct = p.tiktokVideos > 0 ? Math.min(100, Math.round((p.localVideos / p.tiktokVideos) * 100)) : (p.localVideos > 0 ? 100 : 0);
    const avatarSrc = p.avatarUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="%236e7187"><circle cx="32" cy="22" r="14"/><path d="M32 40c-14 0-18 6-18 14v4h36v-4c0-8-4-14-18-14z"/></svg>';

    card.innerHTML = `
      <div>
        <div class="profile-card-header">
          <div class="profile-card-avatar-wrap">
            <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(p.displayName)}" class="profile-card-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'64\\' height=\\'64\\' fill=\\'%236e7187\\'><circle cx=\\'32\\' cy=\\'22\\' r=\\'14\\'/><path d=\\'M32 40c-14 0-18 6-18 14v4h36v-4c0-8-4-14-18-14z\\'/></svg>'">
            <span class="profile-card-badge-online" title="Kênh đã trích xuất"></span>
          </div>
          <div class="profile-card-meta">
            <div class="profile-card-title-row">
              <h3 class="profile-card-name" title="${escapeHtml(p.displayName)}">${escapeHtml(p.displayName)}</h3>
              <a href="${escapeHtml(p.profileUrl)}" target="_blank" rel="noopener noreferrer" class="profile-card-tiktok-link" title="Xem trên TikTok" onclick="event.stopPropagation()">
                TikTok ↗
              </a>
            </div>
            <span class="profile-card-handle">@${escapeHtml(p.username)}</span>
          </div>
        </div>

        ${p.bio ? `<p class="profile-card-bio" title="${escapeHtml(p.bio)}">${escapeHtml(p.bio)}</p>` : '<p class="profile-card-bio" style="color:var(--text-muted);font-style:italic;">Chưa có tiểu sử</p>'}

        <div class="profile-card-public-stats">
          <div class="public-stat-item">
            <span class="public-stat-val">${formatNumber(p.followers)}</span>
            <span class="public-stat-lbl">Followers</span>
          </div>
          <div class="public-stat-item">
            <span class="public-stat-val">${formatNumber(p.tiktokLikes)}</span>
            <span class="public-stat-lbl">Likes</span>
          </div>
          <div class="public-stat-item">
            <span class="public-stat-val">${formatNumber(p.tiktokVideos)}</span>
            <span class="public-stat-lbl">Videos</span>
          </div>
        </div>
      </div>

      <div>
        <div class="profile-card-local-box">
          <div class="local-box-header">
            <span class="local-box-title">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Đã cào: ${formatNumber(p.localVideos)}${p.tiktokVideos > 0 ? ` / ${formatNumber(p.tiktokVideos)}` : ''} video
            </span>
            <span class="local-box-percent">${pct}%</span>
          </div>
          <div class="local-progress-bar">
            <div class="local-progress-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="local-metrics-row">
            <div class="local-metric-item">👁️ <strong>${formatNumber(p.totalViews)}</strong> views</div>
            <div class="local-metric-item">💬 <strong>${formatNumber(p.totalComments)}</strong> cmt</div>
            <div class="local-metric-item">📦 <strong>${formatBytes(p.totalSize)}</strong></div>
          </div>
        </div>

        <div class="profile-card-action" style="margin-top: 14px;">
          <button class="btn-channel-videos">
            <span>Xem ${formatNumber(p.localVideos)} video của kênh</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      selectProfile(p);
    });

    fragment.appendChild(card);
  });

  elements.profilesGrid.appendChild(fragment);
}

function applyFiltersAndSort() {
  // If active filter is Profiles and no individual channel is selected: Show Profiles Grid
  if (state.activeFilter === 'profile' && !state.selectedProfile) {
    elements.grid.classList.add('hidden');
    if (elements.channelDetailBanner) elements.channelDetailBanner.classList.add('hidden');
    if (elements.profilesGrid) elements.profilesGrid.classList.remove('hidden');
    renderProfilesGrid();
    return;
  }

  // Otherwise, we are showing Video Grid
  if (elements.profilesGrid) elements.profilesGrid.classList.add('hidden');
  elements.grid.classList.remove('hidden');

  let list = [...state.allVideos];

  // 1. Channel drill-down or Pill Filter
  if (state.selectedProfile) {
    renderChannelDetailBanner(state.selectedProfile);
    const pId = String(state.selectedProfile.profileId || '');
    const uName = (state.selectedProfile.username || '').toLowerCase();
    list = list.filter((v) => {
      const vProfileId = v.profileId ? String(v.profileId) : '';
      const vUsername = (v.username || '').toLowerCase();
      return (pId && vProfileId === pId) || (uName && vUsername === uName);
    });
  } else {
    if (elements.channelDetailBanner) elements.channelDetailBanner.classList.add('hidden');
    if (state.activeFilter === 'single') {
      list = list.filter((v) => !v.profileId);
    }
  }

  // 2. Search Query Filter
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase().trim();
    list = list.filter((v) => {
      const u = (v.username || '').toLowerCase();
      const dn = (v.displayName || '').toLowerCase();
      const desc = (v.description || '').toLowerCase();
      const id = (v.videoId || '').toLowerCase();
      return u.includes(q) || dn.includes(q) || desc.includes(q) || id.includes(q);
    });
  }

  // 3. Sorting
  switch (state.activeSort) {
    case 'views':
      list.sort((a, b) => (b.views || 0) - (a.views || 0));
      break;
    case 'likes':
      list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
      break;
    case 'comments':
      list.sort((a, b) => (b.commentsCount || 0) - (a.commentsCount || 0));
      break;
    case 'duration':
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      break;
    case 'size':
      list.sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
      break;
    case 'newest':
    default:
      list.sort((a, b) => {
        if (a.publishedAt && b.publishedAt) {
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        }
        return (b.videoId || '').localeCompare(a.videoId || '');
      });
      break;
  }

  state.filteredVideos = list;
  renderVideoGrid();
}

// ==========================================
// Render Video Grid
// ==========================================

function renderVideoGrid() {
  const container = elements.grid;
  container.innerHTML = '';

  if (state.filteredVideos.length === 0) {
    elements.emptyState.classList.remove('hidden');
    return;
  }
  elements.emptyState.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  for (const item of state.filteredVideos) {
    const card = document.createElement('article');
    card.className = 'video-card';
    card.setAttribute('data-id', item.videoId);

    const resBadge = item.width && item.height ? `${item.width}x${item.height}` : 'HD';
    const durationBadge = formatDuration(item.duration);
    const sourceLabel = item.profileId ? `👤 Profile: ${item.profileId}` : '🎯 Single';

    card.innerHTML = `
      <div class="card-media">
        <img class="card-thumb" src="${item.thumbnailUrl}" alt="${escapeHtml(item.description || item.videoId)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22400%22%20height%3D%22600%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20fill%3D%22%23111%22%20width%3D%22400%22%20height%3D%22600%22%2F%3E%3Ctext%20fill%3D%22%23666%22%20font-size%3D%2216%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3EThumbnail%20Unavailable%3C%2Ftext%3E%3C%2Fsvg%3E'">
        <div class="card-overlay">
          <div class="overlay-top">
            <span class="tag-duration">${durationBadge}</span>
            <span class="tag-resolution">${resBadge}</span>
          </div>
          <div class="overlay-bottom">
            <div class="card-stats">
              <span class="card-stat-pill" title="Lượt xem">👁️ ${formatNumber(item.views)}</span>
              <span class="card-stat-pill" title="Lượt thích">❤️ ${formatNumber(item.likes)}</span>
              <span class="card-stat-pill" title="Bình luận">💬 ${formatNumber(item.commentsCount)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-author">
          <img class="card-avatar" src="${item.avatarUrl || ''}" alt="@${escapeHtml(item.username)}" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%2240%22%20height%3D%2240%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ccircle%20cx%3D%2220%22%20cy%3D%2220%22%20r%3D%2220%22%20fill%3D%22%23333%22%2F%3E%3C%2Fsvg%3E'">
          <div class="card-author-info">
            <span class="card-author-name">${escapeHtml(item.displayName || item.username)}</span>
            <span class="card-author-handle">@${escapeHtml(item.username)}</span>
          </div>
        </div>
        <p class="card-caption" title="${escapeHtml(item.description)}">${highlightTags(item.description || '(Không có mô tả)')}</p>
        <div class="card-footer">
          <span class="status-badge"><span class="dot"></span> ${sourceLabel}</span>
          <span class="card-date">${formatBytes(item.fileSize)}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openDetailModal(item));
    fragment.appendChild(card);
  }

  container.appendChild(fragment);
}

// ==========================================
// Modal & Detail Inspection
// ==========================================

async function openDetailModal(item) {
  state.selectedVideo = item;
  state.detailData = null;

  const m = elements.modal;

  // 1. Prepare Player
  m.player.pause();
  m.player.src = item.videoUrl;
  m.player.load();

  // 2. Quick Media Box
  m.fileSize.textContent = formatBytes(item.fileSize);
  m.resolution.textContent = `${item.width || 0} × ${item.height || 0} (${item.fps || 30} fps, ${item.videoCodec || 'h264'})`;
  m.sha256.textContent = item.sha256 || 'Đang xác định...';
  m.dirPath.textContent = item.directory || '-';

  // Action links
  m.btnDownloadVideo.href = item.videoUrl;
  m.btnDownloadThumb.href = item.thumbnailUrl;
  m.btnOpenTikTok.href = `https://www.tiktok.com/@${item.username}/video/${item.videoId}`;

  // 3. Author Header
  m.authorAvatar.src = item.avatarUrl || '';
  m.authorName.textContent = item.displayName || item.username;
  m.authorHandle.textContent = `@${item.username}`;

  // 4. Initial Tab 1 (Overview) Population from Summary
  m.caption.innerHTML = highlightTags(item.description || 'Không có mô tả.');
  m.engViews.textContent = formatNumber(item.views);
  m.engLikes.textContent = formatNumber(item.likes);
  m.engComments.textContent = formatNumber(item.commentsCount);
  m.publishedAt.textContent = formatDate(item.publishedAt);
  m.videoId.textContent = item.videoId;
  m.commentsCount.textContent = item.commentsCount || 0;

  // Reset to Overview Tab
  switchTab('overview');

  // Placeholders while fetching full data
  m.techTable.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;">⏳ Đang tải thông số kỹ thuật...</div>';
  m.commentsTree.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;">⏳ Đang tải danh sách bình luận...</div>';
  m.rawJsonViewer.textContent = '// Đang tải dữ liệu JSON...';

  // Show Modal
  m.backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // 5. Fetch Full JSON Details (Metadata, Technical, Comments, Manifest)
  const fullData = await fetchVideoDetails(item.videoId, item.profileId);
  if (fullData) {
    state.detailData = fullData;
    populateFullModalDetails(fullData, item);
  }
}

function extractCommentsList(commentsData) {
  if (!commentsData) return [];
  if (Array.isArray(commentsData)) return commentsData;
  if (Array.isArray(commentsData.comments)) return commentsData.comments;
  if (Array.isArray(commentsData.data)) return commentsData.data;
  return [];
}

function populateFullModalDetails(data, item) {
  const m = elements.modal;
  const meta = data.metadata || {};
  const tech = data.technical || {};
  const manifest = data.manifest || {};
  const commentsList = extractCommentsList(data.comments);

  // 1. Update SHA-256 from manifest if present
  if (manifest.hash?.value) {
    m.sha256.textContent = manifest.hash.value;
  }

  // 2. Overview Tab
  if (meta.content?.description) {
    m.caption.innerHTML = highlightTags(meta.content.description);
  }
  if (meta.engagement) {
    m.engViews.textContent = formatNumber(meta.engagement.views);
    m.engLikes.textContent = formatNumber(meta.engagement.likes);
    m.engComments.textContent = formatNumber(meta.engagement.comments);
    m.engShares.textContent = formatNumber(meta.engagement.shares || 0);
    m.engSaves.textContent = formatNumber(meta.engagement.saves || 0);
  }

  // Music info
  const music = meta.content?.music || meta.music;
  if (music) {
    m.musicTitle.textContent = music.title || 'Original Sound';
    m.musicAuthor.textContent = music.author || meta.author?.username || 'TikTok';
  } else {
    m.musicTitle.textContent = 'Original Sound';
    m.musicAuthor.textContent = meta.author?.username || 'TikTok';
  }

  // 3. Technical Specs (FFprobe) Tab
  try {
    renderTechnicalSpecs(tech, manifest);
  } catch (err) {
    console.error('Failed to render technical specs:', err);
    m.techTable.innerHTML = `<div style="text-align:center;color:#ff5b79;padding:20px;">Lỗi hiển thị thông số: ${escapeHtml(err.message)}</div>`;
  }

  // 4. Comments Tab
  try {
    const totalComments = commentsList.length > 0 ? commentsList.length : (meta.engagement?.comments || 0);
    m.commentsCount.textContent = totalComments.toLocaleString();
    renderCommentsTree(commentsList);
  } catch (err) {
    console.error('Failed to render comments tree:', err);
    m.commentsTree.innerHTML = `<div style="text-align:center;color:#ff5b79;padding:20px;">Lỗi hiển thị bình luận: ${escapeHtml(err.message)}</div>`;
  }

  // 5. Raw JSON tab
  try {
    updateRawJsonViewer();
  } catch (err) {
    console.error('Failed to update raw JSON:', err);
  }
}

function renderTechnicalSpecs(tech, manifest) {
  const container = elements.modal.techTable;
  container.innerHTML = '';

  const specs = [
    { label: 'Thời lượng (Duration)', value: tech.duration ? `${tech.duration} giây (${formatDuration(tech.duration)})` : '-' },
    { label: 'Độ phân giải (Resolution)', value: tech.width && tech.height ? `${tech.width} × ${tech.height}` : '-' },
    { label: 'Tốc độ khung hình (FPS)', value: tech.fps ? `${tech.fps} fps` : '-' },
    { label: 'Chuẩn nén Video (Codec)', value: String(tech.video_codec || 'N/A').toUpperCase() },
    { label: 'Tốc độ bit Video (Bitrate)', value: tech.bitrate ? `${(Number(tech.bitrate) / 1000).toFixed(0)} kbps` : '-' },
    { label: 'Chuẩn nén Âm thanh (Audio)', value: String(tech.audio_codec || 'N/A').toUpperCase() },
    { label: 'Tần số lấy mẫu (Sample Rate)', value: tech.audio_sample_rate ? `${tech.audio_sample_rate} Hz` : '-' },
    { label: 'Số kênh âm thanh (Channels)', value: tech.audio_channels ? (Number(tech.audio_channels) === 2 ? 'Stereo (2)' : `${tech.audio_channels} kênh`) : '-' },
    { label: 'Định dạng Container', value: tech.container || 'mp4' },
    { label: 'Dung lượng file (Size)', value: formatBytes(tech.file_size) },
    { label: 'Tổng số Streams', value: tech.streams_count !== undefined ? String(tech.streams_count) : '2 (Video + Audio)' },
    { label: 'Thuật toán băm (Hash Alg)', value: manifest.hash?.algorithm || 'sha256' },
  ];

  for (const s of specs) {
    const cell = document.createElement('div');
    cell.className = 'tech-cell';
    cell.innerHTML = `
      <span class="tech-k">${escapeHtml(s.label)}</span>
      <span class="tech-v">${escapeHtml(s.value)}</span>
    `;
    container.appendChild(cell);
  }
}

let commentsPageState = {
  list: [],
  renderedCount: 0,
  pageSize: 50,
};

function renderCommentsTree(comments, filterText = '') {
  const container = elements.modal.commentsTree;
  container.innerHTML = '';

  if (!comments || comments.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 40px 10px;">
        💬 Chưa có bình luận nào được lưu cho video này.
      </div>
    `;
    return;
  }

  let filtered = comments;
  if (filterText && filterText.trim()) {
    const q = filterText.toLowerCase().trim();
    filtered = comments.filter((c) => {
      const txt = String(c.text || '').toLowerCase();
      const u = String(c.author?.username || '').toLowerCase();
      const dn = String(c.author?.display_name || '').toLowerCase();
      return txt.includes(q) || u.includes(q) || dn.includes(q);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 30px 10px;">
        Không tìm thấy bình luận phù hợp với "${escapeHtml(filterText)}"
      </div>
    `;
    return;
  }

  commentsPageState = {
    list: filtered,
    renderedCount: 0,
    pageSize: 50,
  };

  appendCommentsBatch(50);
}

function appendCommentsBatch(count = 50) {
  const container = elements.modal.commentsTree;

  // Remove existing action buttons if any
  const oldActions = container.querySelector('.comments-actions');
  if (oldActions) oldActions.remove();

  const { list, renderedCount } = commentsPageState;
  const nextBatch = list.slice(renderedCount, renderedCount + count);
  const fragment = document.createDocumentFragment();

  for (const c of nextBatch) {
    const isReply = Boolean(c.is_reply) || (c.parent_comment_id && String(c.parent_comment_id) !== '0') || (c.parentCommentId && String(c.parentCommentId) !== '0');
    const card = document.createElement('div');
    card.className = `comment-card ${isReply ? 'is-reply' : ''}`;

    const authorName = c.author?.display_name || c.author?.username || 'Ẩn danh';
    const authorHandle = c.author?.username ? `@${c.author.username}` : '';
    const avatar = c.author?.avatar_url || '';
    const likeCount = c.like_count ? `❤️ ${formatNumber(c.like_count)}` : '';
    const dateFormatted = formatDate(c.published_at);

    card.innerHTML = `
      <div class="comment-header">
        <div class="comment-author">
          <img src="${avatar}" alt="${escapeHtml(authorName)}" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%2222%22%20height%3D%2222%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ccircle%20cx%3D%2211%22%20cy%3D%2211%22%20r%3D%2211%22%20fill%3D%22%23444%22%2F%3E%3C%2Fsvg%3E'">
          <span>${escapeHtml(authorName)}</span>
          <span style="font-weight: 400; color: var(--text-muted); font-size: 11px;">${escapeHtml(authorHandle)}</span>
        </div>
        ${likeCount ? `<span class="comment-likes">${likeCount}</span>` : ''}
      </div>
      <div class="comment-text">${highlightTags(c.text || '(Nội dung trống)')}</div>
      <div class="comment-date">${dateFormatted}</div>
    `;

    fragment.appendChild(card);
  }

  container.appendChild(fragment);
  commentsPageState.renderedCount += nextBatch.length;

  // Add load more button if still remaining
  const remaining = list.length - commentsPageState.renderedCount;
  if (remaining > 0) {
    const actions = document.createElement('div');
    actions.className = 'comments-actions';

    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'btn-load-more';
    loadMoreBtn.textContent = `Tải thêm 50 bình luận (Đang hiện ${commentsPageState.renderedCount} / ${list.length})`;
    loadMoreBtn.addEventListener('click', () => appendCommentsBatch(50));

    const loadAllBtn = document.createElement('button');
    loadAllBtn.className = 'btn-load-more secondary';
    loadAllBtn.textContent = `Hiện tất cả (${remaining})`;
    loadAllBtn.addEventListener('click', () => appendCommentsBatch(remaining));

    actions.appendChild(loadMoreBtn);
    actions.appendChild(loadAllBtn);
    container.appendChild(actions);
  }
}

function updateRawJsonViewer() {
  const fileKey = elements.modal.rawFileSelect.value;
  const viewer = elements.modal.rawJsonViewer;

  if (!state.detailData) {
    viewer.textContent = '// Đang tải dữ liệu JSON...';
    return;
  }

  let content = null;
  if (fileKey === 'metadata') content = state.detailData.metadata;
  else if (fileKey === 'technical') content = state.detailData.technical;
  else if (fileKey === 'manifest') content = state.detailData.manifest;
  else if (fileKey === 'comments') content = state.detailData.comments;

  if (content === null || content === undefined) {
    viewer.textContent = `// File "${fileKey}.json" không tồn tại hoặc rỗng.`;
  } else {
    viewer.textContent = JSON.stringify(content, null, 2);
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;

  elements.modal.tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  elements.modal.tabContents.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab${capitalize(tabId)}`);
  });

  if (tabId === 'raw') {
    updateRawJsonViewer();
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function closeModal() {
  const m = elements.modal;
  m.backdrop.classList.add('hidden');
  m.player.pause();
  m.player.removeAttribute('src');
  m.player.load();
  document.body.style.overflow = '';
  state.selectedVideo = null;
  state.detailData = null;
}

// ==========================================
// Event Listeners Initialization
// ==========================================

function initEvents() {
  // 1. Refresh Button
  elements.btnRefresh.addEventListener('click', () => {
    fetchVideos();
    showToast('Đang làm mới danh sách video...');
  });

  // 2. Search Input
  setupMentionForInput(elements.filters.searchInput, 'below');
  let searchTimeout = null;
  elements.filters.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    state.searchQuery = e.target.value;
    elements.filters.btnClearSearch.classList.toggle('hidden', !state.searchQuery);
    searchTimeout = setTimeout(() => {
      applyFiltersAndSort();
    }, 200);
  });

  elements.filters.btnClearSearch.addEventListener('click', () => {
    elements.filters.searchInput.value = '';
    state.searchQuery = '';
    elements.filters.btnClearSearch.classList.add('hidden');
    applyFiltersAndSort();
    elements.filters.searchInput.focus();
  });

  // 3. Pill Filters
  elements.filters.pillBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      elements.filters.pillBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const prevProfile = state.selectedProfile;
      state.activeFilter = btn.dataset.filter;
      if (state.activeFilter !== 'profile') {
        state.selectedProfile = null;
      }
      if (prevProfile && state.activeFilter !== 'profile') {
        await fetchVideos();
      } else {
        applyFiltersAndSort();
      }
    });
  });

  // 3.1 Back to Profiles Button
  if (elements.btnBackToProfiles) {
    elements.btnBackToProfiles.addEventListener('click', () => {
      state.selectedProfile = null;
      state.activeFilter = 'profile';
      applyFiltersAndSort();
    });
  }

  // 4. Sort Select
  elements.filters.sortSelect.addEventListener('change', (e) => {
    state.activeSort = e.target.value;
    applyFiltersAndSort();
  });

  // 5. Modal Tab Switching
  elements.modal.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // 6. Modal Close
  elements.modal.closeBtn.addEventListener('click', closeModal);

  elements.modal.backdrop.addEventListener('click', (e) => {
    if (e.target === elements.modal.backdrop) {
      closeModal();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.modal.backdrop.classList.contains('hidden')) {
      closeModal();
    }
    // Quick search shortcut "/"
    if (e.key === '/' && document.activeElement !== elements.filters.searchInput && elements.modal.backdrop.classList.contains('hidden')) {
      e.preventDefault();
      elements.filters.searchInput.focus();
    }
  });

  // 7. Copy SHA-256 Button
  elements.modal.btnCopySha.addEventListener('click', () => {
    const text = elements.modal.sha256.textContent;
    if (text && text !== '-' && text !== 'N/A') {
      navigator.clipboard.writeText(text).then(() => {
        showToast('✓ Đã sao chép mã SHA-256 vào bộ nhớ tạm!');
      }).catch(() => {
        showToast('Không thể sao chép mã SHA-256');
      });
    }
  });

  // 8. Raw JSON Select Change
  elements.modal.rawFileSelect.addEventListener('change', () => {
    updateRawJsonViewer();
  });

  // 9. Comments Search Filter
  elements.modal.commentSearchInput.addEventListener('input', (e) => {
    const list = extractCommentsList(state.detailData?.comments);
    renderCommentsTree(list, e.target.value);
  });

  // 10. Ingest & Crawl Controls
  if (elements.ingest.input) {
    setupMentionForInput(elements.ingest.input, 'below');
    elements.ingest.input.addEventListener('input', (e) => {
      if (e.target.value.trim().length > 0) {
        elements.ingest.btnClear.classList.remove('hidden');
      } else {
        elements.ingest.btnClear.classList.add('hidden');
      }
    });

    elements.ingest.input.addEventListener('keydown', (e) => {
      if (isMentionDropdownOpen()) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleIngest();
      }
    });
  }

  if (elements.ingest.btnClear) {
    elements.ingest.btnClear.addEventListener('click', () => {
      elements.ingest.input.value = '';
      elements.ingest.btnClear.classList.add('hidden');
      elements.ingest.input.focus();
    });
  }

  if (elements.ingest.btnStart) {
    elements.ingest.btnStart.addEventListener('click', handleIngest);
  }

  if (elements.ingest.quickChips) {
    elements.ingest.quickChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        elements.ingest.input.value = chip.dataset.url;
        elements.ingest.btnClear.classList.remove('hidden');
        handleIngest();
      });
    });
  }

  if (elements.ingest.btnStopCrawl) {
    elements.ingest.btnStopCrawl.addEventListener('click', stopCrawlJob);
  }
}

// ==========================================
// Ingestion & Profile Priority Actions
// ==========================================

async function handleIngest() {
  const rawInput = elements.ingest.input.value.trim();
  if (!rawInput) {
    showToast('⚠️ Vui lòng nhập link Kênh (@username) hoặc Link Video!');
    elements.ingest.input.focus();
    return;
  }

  // 1. Phản hồi giao diện: Trạng thái đang phân giải
  elements.ingest.btnStart.disabled = true;
  elements.ingest.btnStart.innerHTML = `
    <span class="pulse-indicator" style="display:inline-block;width:10px;height:10px;margin-right:6px;"></span>
    <span>Đang kiểm tra...</span>
  `;

  try {
    // 2. GỌI API RESOLVE ĐỂ LẤY THÔNG TIN HỒ SƠ NGAY TỨC THÌ (< 1 GIÂY)
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: rawInput }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Không thể tìm thấy kênh hoặc video TikTok này.');
    }

    if (data.type === 'profile') {
      // ƯU TIÊN HIỂN THỊ TỨC THÌ: Số Follower, Tổng lượt View, Tổng lượt Like, Tổng số Video đã đăng!
      displayProfileHero(data.profile);
      showToast(`✓ Đã kết nối kênh: ${data.profile.displayName || data.profile.username}! Bắt đầu trích xuất...`);

      // 3. TỰ ĐỘNG BẮT ĐẦU TRÍCH XUẤT TOÀN BỘ VIDEO CỦA KÊNH
      await startCrawlJob(rawInput, 'profile');
    } else if (data.type === 'video') {
      // Single video
      elements.ingest.profileHeroCard.classList.add('hidden');
      showToast(`✓ Nhận diện video: ${data.videoId}! Đang tải và trích xuất dữ liệu...`);
      await startCrawlJob(rawInput, 'video');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`);
  } finally {
    elements.ingest.btnStart.disabled = false;
    elements.ingest.btnStart.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
      </svg>
      <span>Trích Xuất</span>
    `;
  }
}

function displayProfileHero(profile) {
  elements.ingest.profileHeroCard.classList.remove('hidden');
  elements.ingest.profAvatar.src = profile.avatarUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" fill="%23333"><rect width="100%" height="100%"/></svg>';
  elements.ingest.profDisplayName.textContent = profile.displayName || profile.username;
  elements.ingest.profHandle.textContent = `@${profile.username}`;
  elements.ingest.profBio.textContent = profile.bio || 'Chưa cập nhật tiểu sử kênh.';
  elements.ingest.profLink.href = profile.profileUrl || `https://www.tiktok.com/@${profile.username}`;

  state.currentProfileBaseViews = profile.stats.views || 0;

  // 4 THẺ THỐNG KÊ QUAN TRỌNG THEO YÊU CẦU CỦA USER:
  // 1. Số Follower
  elements.ingest.profFollowers.textContent = formatNumber(profile.stats.followers);
  // 2. Tổng lượt View (hiển thị số thực tế, realtime)
  elements.ingest.profViews.textContent = formatNumber(state.currentProfileBaseViews);
  // 3. Tổng lượt Like
  elements.ingest.profLikes.textContent = formatNumber(profile.stats.likes);
  // 4. Tổng số Video đã đăng
  elements.ingest.profVideos.textContent = `${(profile.stats.videos || 0).toLocaleString()} video`;

  // Cuộn nhẹ xuống Profile Card
  elements.ingest.profileHeroCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function startCrawlJob(input, type) {
  if (state.crawlPollTimer) {
    clearInterval(state.crawlPollTimer);
    state.crawlPollTimer = null;
  }

  // Mở Monitor Card
  elements.ingest.crawlProgressCard.classList.remove('hidden');
  elements.ingest.progressStatusText.textContent = 'Đang khởi chạy tiến trình trích xuất dữ liệu...';
  elements.ingest.progressBarFill.style.width = '5%';
  elements.ingest.progressCounter.textContent = 'Khởi tạo...';
  elements.ingest.btnStopCrawl.disabled = false;
  elements.ingest.btnStopCrawl.textContent = 'Dừng cào';

  try {
    const concurrency = parseInt(elements.ingest.concurrencySelect?.value || '16', 10);
    const res = await fetch('/api/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, limit: 1000, concurrency }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Không thể bắt đầu crawl');
    }

    state.currentJobId = data.jobId;

    let previousCompletedCount = 0;

    // Polling progress every 1200ms
    state.crawlPollTimer = setInterval(async () => {
      if (!state.currentJobId) return;

      try {
        const sRes = await fetch(`/api/crawl/status/${state.currentJobId}`);
        if (!sRes.ok) return;

        const sData = await sRes.json();
        const progress = sData.progress || {};

        // Update progress UI
        elements.ingest.progressStatusText.textContent = progress.message || 'Đang xử lý...';
        
        const total = progress.total || 1;
        const current = progress.current || 0;
        const percent = Math.min(100, Math.max(5, Math.round((current / total) * 100)));
        elements.ingest.progressBarFill.style.width = `${percent}%`;
        elements.ingest.progressCounter.textContent = `${current}/${total}`;

        if (progress.currentVideoTitle) {
          elements.ingest.progressVideoName.textContent = progress.currentVideoTitle;
        }

        // Cập nhật Tổng lượt View theo thời gian thực khi cào video
        if (progress.viewsAccumulated && progress.viewsAccumulated > 0) {
          const liveTotalViews = Math.max(state.currentProfileBaseViews, progress.viewsAccumulated);
          elements.ingest.profViews.textContent = formatNumber(liveTotalViews);
        }

        // Nếu có video mới vừa hoàn tất: tự động fetch và cập nhật danh sách video
        const currentCompletedCount = (progress.completedVideos || []).length;
        const currentSkippedCount = (progress.skippedVideos || []).length;
        if (currentCompletedCount > previousCompletedCount) {
          previousCompletedCount = currentCompletedCount;
          // Reload videos list in background
          fetchVideos();
        }

        // Check if finished
        if (sData.status === 'completed') {
          clearInterval(state.crawlPollTimer);
          state.crawlPollTimer = null;
          elements.ingest.progressBarFill.style.width = '100%';
          elements.ingest.progressCounter.textContent = `${total}/${total}`;
          if (progress.message) {
            elements.ingest.progressStatusText.textContent = progress.message;
          } else if (currentCompletedCount === 0 && currentSkippedCount > 0) {
            elements.ingest.progressStatusText.textContent = `✓ Hoàn tất! Toàn bộ ${currentSkippedCount} video đã có sẵn trên máy.`;
          } else if (currentCompletedCount === 0) {
            elements.ingest.progressStatusText.textContent = `⚠️ Hoàn tất! Không tìm thấy video mới nào cần tải.`;
          } else {
            elements.ingest.progressStatusText.textContent = `✓ Hoàn tất trích xuất! Đã tải mới ${currentCompletedCount} video${currentSkippedCount > 0 ? ` (${currentSkippedCount} video đã có sẵn)` : ''}.`;
          }
          elements.ingest.btnStopCrawl.disabled = true;
          elements.ingest.btnStopCrawl.textContent = 'Hoàn tất';
          showToast(`🎉 Trích xuất hoàn tất!`);
          fetchVideos();
        } else if (sData.status === 'stopped') {
          clearInterval(state.crawlPollTimer);
          state.crawlPollTimer = null;
          elements.ingest.progressStatusText.textContent = progress.message || '⏹ Tiến trình cào đã được dừng.';
          elements.ingest.btnStopCrawl.disabled = true;
          showToast('Tiến trình đã dừng.');
          fetchVideos();
        } else if (sData.status === 'failed') {
          clearInterval(state.crawlPollTimer);
          state.crawlPollTimer = null;
          elements.ingest.progressStatusText.textContent = `❌ Lỗi: ${sData.error || 'Thất bại'}`;
          elements.ingest.btnStopCrawl.disabled = true;
          showToast(`Lỗi crawl: ${sData.error || 'Thất bại'}`);
        }
      } catch (err) {
        console.error('Lỗi kiểm tra tiến trình:', err);
      }
    }, 1200);

  } catch (err) {
    elements.ingest.progressStatusText.textContent = `❌ Lỗi: ${err.message}`;
    showToast(`Không thể khởi chạy crawl: ${err.message}`);
  }
}

async function stopCrawlJob() {
  if (!state.currentJobId) return;
  elements.ingest.btnStopCrawl.disabled = true;
  elements.ingest.btnStopCrawl.textContent = 'Đang dừng...';

  try {
    await fetch(`/api/crawl/stop/${state.currentJobId}`, { method: 'POST' });
    showToast('Đang gửi lệnh dừng tiến trình cào...');
  } catch (err) {
    showToast(`Lỗi khi dừng: ${err.message}`);
  }
}

async function fetchSystemInfo() {
  try {
    const res = await fetch('/api/system-info');
    if (!res.ok) return;
    const info = await res.json();
    if (elements.ingest.concurrencySelect && info.cpuCores) {
      const cores = info.cpuCores;
      const opts = elements.ingest.concurrencySelect.options;
      let matched = false;
      for (let i = 0; i < opts.length; i++) {
        if (parseInt(opts[i].value, 10) === cores) {
          const cpuTag = info.cpuModel.includes('1240P') ? 'Intel i5-1240P' : `${cores} Threads CPU`;
          opts[i].textContent = `${cores} luồng (${cpuTag})`;
          opts[i].selected = true;
          matched = true;
          break;
        }
      }
      if (!matched && cores > 0) {
        const opt = document.createElement('option');
        opt.value = String(cores);
        opt.textContent = `${cores} luồng (${cores} Cores/Threads)`;
        opt.selected = true;
        elements.ingest.concurrencySelect.appendChild(opt);
      }
    }
  } catch {}
}

// ─── AI Analytics RAG Q&A Assistant ────────────────────────

function initMainTabs() {
  if (!elements.mainTabs.btnCrawler || !elements.mainTabs.btnAnalytics) return;

  function switchTab(tabName) {
    state.activeMainTab = tabName;
    if (tabName === 'crawler') {
      elements.mainTabs.btnCrawler.classList.add('active');
      if (elements.mainTabs.btnProfiles) elements.mainTabs.btnProfiles.classList.remove('active');
      elements.mainTabs.btnAnalytics.classList.remove('active');
      elements.mainTabs.viewCrawler.classList.remove('hidden');
      elements.mainTabs.viewAnalytics.classList.add('hidden');
      if (state.activeFilter === 'profile' && !state.selectedProfile) {
        state.activeFilter = 'all';
        elements.filters.pillBtns.forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));
        applyFiltersAndSort();
      }
    } else if (tabName === 'profiles') {
      if (elements.mainTabs.btnProfiles) elements.mainTabs.btnProfiles.classList.add('active');
      elements.mainTabs.btnCrawler.classList.remove('active');
      elements.mainTabs.btnAnalytics.classList.remove('active');
      elements.mainTabs.viewCrawler.classList.remove('hidden');
      elements.mainTabs.viewAnalytics.classList.add('hidden');

      state.activeFilter = 'profile';
      state.selectedProfile = null;
      elements.filters.pillBtns.forEach((b) => b.classList.toggle('active', b.dataset.filter === 'profile'));
      applyFiltersAndSort();
      window.scrollTo({ top: document.querySelector('.toolbar')?.offsetTop - 70 || 0, behavior: 'smooth' });
    } else {
      elements.mainTabs.btnCrawler.classList.remove('active');
      if (elements.mainTabs.btnProfiles) elements.mainTabs.btnProfiles.classList.remove('active');
      elements.mainTabs.btnAnalytics.classList.add('active');
      elements.mainTabs.viewCrawler.classList.add('hidden');
      elements.mainTabs.viewAnalytics.classList.remove('hidden');
      elements.chat.input.focus();
    }
  }

  elements.mainTabs.btnCrawler.addEventListener('click', () => switchTab('crawler'));
  if (elements.mainTabs.btnProfiles) {
    elements.mainTabs.btnProfiles.addEventListener('click', () => switchTab('profiles'));
  }
  elements.mainTabs.btnAnalytics.addEventListener('click', () => switchTab('analytics'));
}

// ==========================================
// @Mention Autocomplete System
// ==========================================

let mentionState = {
  activeInput: null,
  dropdownEl: null,
  filteredProfiles: [],
  selectedIndex: 0,
  position: 'above',
};

function initMentionDropdown() {
  if (mentionState.dropdownEl) return mentionState.dropdownEl;

  const dropdown = document.createElement('div');
  dropdown.id = 'mentionDropdown';
  dropdown.className = 'mention-dropdown hidden';
  document.body.appendChild(dropdown);
  mentionState.dropdownEl = dropdown;

  // Prevent input blur when clicking inside dropdown
  dropdown.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  // Global click outside to close
  document.addEventListener('click', (e) => {
    if (mentionState.dropdownEl && !mentionState.dropdownEl.classList.contains('hidden')) {
      if (!mentionState.dropdownEl.contains(e.target) && e.target !== mentionState.activeInput) {
        hideMentionDropdown();
      }
    }
  });

  // Window resize/scroll close
  window.addEventListener('resize', hideMentionDropdown);

  return dropdown;
}

function getAvailableProfilesForMention() {
  if (state.allProfiles && state.allProfiles.length > 0) {
    return state.allProfiles;
  }
  // Fallback: extract distinct channels from state.allVideos
  const map = new Map();
  for (const v of state.allVideos || []) {
    if (v.username && !map.has(v.username.toLowerCase())) {
      map.set(v.username.toLowerCase(), {
        username: v.username,
        displayName: v.displayName || v.username,
        avatarUrl: v.avatarUrl || '',
        localVideos: 1,
      });
    }
  }
  return Array.from(map.values());
}

function showMentionDropdown(inputEl, position = 'above') {
  const dropdown = initMentionDropdown();
  mentionState.activeInput = inputEl;
  mentionState.position = position;

  const textBeforeCaret = inputEl.value.slice(0, inputEl.selectionStart);
  // Match @username right before caret
  const match = textBeforeCaret.match(/(?:^|\s)@([a-zA-Z0-9_.]*)$/);
  if (!match) {
    hideMentionDropdown();
    return;
  }

  const query = match[1].toLowerCase();
  const all = getAvailableProfilesForMention();
  
  // Filter & sort: exact match or startsWith comes first
  const filtered = all.filter((p) => {
    const u = (p.username || '').toLowerCase();
    const d = (p.displayName || '').toLowerCase();
    return !query || u.includes(query) || d.includes(query);
  }).sort((a, b) => {
    const uA = (a.username || '').toLowerCase();
    const uB = (b.username || '').toLowerCase();
    const aStarts = uA.startsWith(query) ? 1 : 0;
    const bStarts = uB.startsWith(query) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;
    return (b.localVideos || 0) - (a.localVideos || 0);
  });

  if (filtered.length === 0) {
    hideMentionDropdown();
    return;
  }

  mentionState.filteredProfiles = filtered;
  mentionState.selectedIndex = 0;

  renderMentionList();
  positionMentionDropdown();
  dropdown.classList.remove('hidden');
}

function hideMentionDropdown() {
  if (mentionState.dropdownEl) {
    mentionState.dropdownEl.classList.add('hidden');
  }
  mentionState.activeInput = null;
  mentionState.filteredProfiles = [];
  mentionState.selectedIndex = 0;
}

function isMentionDropdownOpen() {
  return mentionState.dropdownEl && !mentionState.dropdownEl.classList.contains('hidden');
}

function positionMentionDropdown() {
  if (!mentionState.activeInput || !mentionState.dropdownEl) return;
  const rect = mentionState.activeInput.getBoundingClientRect();
  const dropdown = mentionState.dropdownEl;

  dropdown.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`;

  if (mentionState.position === 'above') {
    dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    dropdown.style.top = 'auto';
  } else {
    dropdown.style.top = `${rect.bottom + 8}px`;
    dropdown.style.bottom = 'auto';
  }
}

function renderMentionList() {
  const dropdown = mentionState.dropdownEl;
  if (!dropdown) return;

  const profiles = mentionState.filteredProfiles;
  dropdown.innerHTML = `
    <div class="mention-dropdown-header">
      <span>Chọn Kênh TikTok (@)</span>
      <span class="hint">↑↓ Chọn • Enter</span>
    </div>
  `;

  profiles.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = `mention-item ${idx === mentionState.selectedIndex ? 'active' : ''}`;
    item.dataset.index = idx;

    const avatarSrc = p.avatarUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="%236e7187"><circle cx="16" cy="11" r="7"/><path d="M16 20c-7 0-9 3-9 7v2h18v-2c0-4-2-7-9-7z"/></svg>';
    const videoCountText = p.localVideos ? `${formatNumber(p.localVideos)} video` : (p.tiktokVideos ? `${formatNumber(p.tiktokVideos)} video` : 'Kênh');

    item.innerHTML = `
      <div class="mention-avatar-wrap">
        <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(p.displayName)}" class="mention-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'32\\' height=\\'32\\' fill=\\'%236e7187\\'><circle cx=\\'16\\' cy=\\'11\\' r=\\'7\\'/><path d=\\'M16 20c-7 0-9 3-9 7v2h18v-2c0-4-2-7-9-7z\\'/></svg>'">
      </div>
      <div class="mention-info">
        <div class="mention-name-row">
          <span class="mention-display-name">${escapeHtml(p.displayName || p.username)}</span>
        </div>
        <span class="mention-handle">@${escapeHtml(p.username)}</span>
      </div>
      <span class="mention-badge">${videoCountText}</span>
    `;

    item.addEventListener('mouseenter', () => {
      mentionState.selectedIndex = idx;
      updateActiveMentionItem();
    });

    item.addEventListener('click', (e) => {
      e.preventDefault();
      selectMentionProfile(p);
    });

    dropdown.appendChild(item);
  });
}

function updateActiveMentionItem() {
  if (!mentionState.dropdownEl) return;
  const items = mentionState.dropdownEl.querySelectorAll('.mention-item');
  items.forEach((item, idx) => {
    const isActive = idx === mentionState.selectedIndex;
    item.classList.toggle('active', isActive);
    if (isActive) {
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

function selectMentionProfile(profile) {
  const input = mentionState.activeInput;
  if (!input || !profile) return;

  const value = input.value;
  const caret = input.selectionStart;
  const before = value.slice(0, caret);
  const after = value.slice(caret);

  const atPos = before.lastIndexOf('@');
  if (atPos === -1) {
    hideMentionDropdown();
    return;
  }

  const newBefore = before.slice(0, atPos) + `@${profile.username} `;
  input.value = newBefore + after;

  const newCaret = newBefore.length;
  input.focus();
  input.setSelectionRange(newCaret, newCaret);

  // Trigger input event so any listeners (auto-resize, search filter, etc.) get notified
  input.dispatchEvent(new Event('input', { bubbles: true }));

  hideMentionDropdown();
}

function setupMentionForInput(inputEl, position = 'above') {
  if (!inputEl) return;

  // Listen to input
  inputEl.addEventListener('input', () => {
    showMentionDropdown(inputEl, position);
  });

  // Listen to keyup for arrows/navigation within text
  inputEl.addEventListener('keyup', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;
    showMentionDropdown(inputEl, position);
  });

  // Listen to keydown to capture navigation & Enter
  inputEl.addEventListener('keydown', (e) => {
    if (!isMentionDropdownOpen()) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      mentionState.selectedIndex = (mentionState.selectedIndex + 1) % mentionState.filteredProfiles.length;
      updateActiveMentionItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      mentionState.selectedIndex = (mentionState.selectedIndex - 1 + mentionState.filteredProfiles.length) % mentionState.filteredProfiles.length;
      updateActiveMentionItem();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (mentionState.filteredProfiles.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const selected = mentionState.filteredProfiles[mentionState.selectedIndex];
        selectMentionProfile(selected);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      hideMentionDropdown();
    }
  }, true); // Use capture phase so we intercept Enter before chat submission!
}

function initChatEvents() {
  if (!elements.chat.btnSend || !elements.chat.input) return;

  // Set up @mention autocomplete on chat input (opens above the bar)
  setupMentionForInput(elements.chat.input, 'above');

  // Send on click
  elements.chat.btnSend.addEventListener('click', () => {
    sendChatMessage();
  });

  // Send on Enter (Shift+Enter for newline)
  elements.chat.input.addEventListener('keydown', (e) => {
    if (isMentionDropdownOpen()) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Suggested Chips
  elements.chat.suggChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-query');
      if (q) {
        elements.chat.input.value = q;
        sendChatMessage();
      }
    });
  });

  // Video Sidebar Close
  if (elements.chat.btnCloseSidebar) {
    elements.chat.btnCloseSidebar.addEventListener('click', () => {
      if (elements.chat.videoSidebar) {
        elements.chat.videoSidebar.classList.add('hidden');
      }
      if (elements.chat.workspace) {
        elements.chat.workspace.classList.remove('has-sidebar');
      }
      if (elements.chat.btnReopenSidebar) {
        elements.chat.btnReopenSidebar.classList.remove('hidden');
      }
    });
  }

  // Video Sidebar Reopen
  if (elements.chat.btnReopenSidebar) {
    elements.chat.btnReopenSidebar.addEventListener('click', () => {
      if (elements.chat.videoSidebar) {
        elements.chat.videoSidebar.classList.remove('hidden');
      }
      if (elements.chat.workspace) {
        elements.chat.workspace.classList.add('has-sidebar');
      }
      elements.chat.btnReopenSidebar.classList.add('hidden');
    });
  }

  // Toggle all to Local MP4
  if (elements.chat.btnToggleAllLocal) {
    elements.chat.btnToggleAllLocal.addEventListener('click', () => {
      if (!elements.chat.videoList) return;
      elements.chat.videoList.querySelectorAll('.btn-switch-player').forEach(btn => {
        if (btn.dataset.mode === 'embed') {
          btn.click();
        }
      });
      elements.chat.btnToggleAllLocal.classList.add('active');
      if (elements.chat.btnToggleAllEmbed) {
        elements.chat.btnToggleAllEmbed.classList.remove('active');
      }
    });
  }

  // Toggle all to TikTok Embed
  if (elements.chat.btnToggleAllEmbed) {
    elements.chat.btnToggleAllEmbed.addEventListener('click', () => {
      if (!elements.chat.videoList) return;
      elements.chat.videoList.querySelectorAll('.btn-switch-player').forEach(btn => {
        if (btn.dataset.mode === 'local') {
          btn.click();
        }
      });
      elements.chat.btnToggleAllEmbed.classList.add('active');
      if (elements.chat.btnToggleAllLocal) {
        elements.chat.btnToggleAllLocal.classList.remove('active');
      }
    });
  }

  // Clear Session
  if (elements.chat.btnClear) {
    elements.chat.btnClear.addEventListener('click', async () => {
      if (state.chatSessionId) {
        try {
          await fetch(`/api/rag/sessions/${state.chatSessionId}`, { method: 'DELETE' });
        } catch {}
      }
      state.chatSessionId = null;
      if (elements.chat.videoSidebar) {
        elements.chat.videoSidebar.classList.add('hidden');
      }
      if (elements.chat.workspace) {
        elements.chat.workspace.classList.remove('has-sidebar');
      }
      if (elements.chat.btnReopenSidebar) {
        elements.chat.btnReopenSidebar.classList.add('hidden');
      }
      elements.chat.messages.innerHTML = `
        <div class="chat-message assistant welcome-message">
          <div class="msg-avatar">🤖</div>
          <div class="msg-body">
            <div class="msg-header">
              <span class="msg-sender">TikTok Analytics AI</span>
              <span class="msg-time">Hệ thống</span>
            </div>
            <div class="msg-content">
              <p>Đã làm mới phiên hội thoại! Bạn có thể đặt câu hỏi phân tích dữ liệu mới bất cứ lúc nào.</p>
            </div>
          </div>
        </div>
      `;
      showToast('Đã bắt đầu phiên hội thoại phân tích mới');
    });
  }
}

async function sendChatMessage() {
  const query = elements.chat.input.value.trim();
  if (!query || state.isChatBusy) return;

  state.isChatBusy = true;
  elements.chat.input.value = '';
  elements.chat.btnSend.disabled = true;

  // Append User Message
  appendUserMessage(query);

  // Append Thinking Indicator
  const thinkingId = appendThinkingMessage();

  try {
    const res = await fetch('/api/rag/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: query,
        sessionId: state.chatSessionId || undefined,
      }),
    });

    removeThinkingMessage(thinkingId);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Lỗi server' }));
      appendAssistantMessage(`❌ **Lỗi:** ${err.error || 'Không thể xử lý câu hỏi.'}`);
      return;
    }

    const data = await res.json();
    state.chatSessionId = data.sessionId;

    if (elements.chat.modelIndicator) {
      elements.chat.modelIndicator.textContent = `⚡ ${data.model} (${data.latencyMs}ms)`;
    }

    // Extract videos mentioned or ranked in RAG results
    const relatedVideos = extractVideosFromRagResult(data);

    appendAssistantMessage(data.answer, data.intent, relatedVideos);

    if (relatedVideos && relatedVideos.length > 0) {
      displayAiVideoDeck(relatedVideos, getDeckTitleFromIntent(data.intent, query));
    }
  } catch (err) {
    removeThinkingMessage(thinkingId);
    appendAssistantMessage(`❌ **Lỗi kết nối:** ${err.message}`);
  } finally {
    state.isChatBusy = false;
    elements.chat.btnSend.disabled = false;
    elements.chat.input.focus();
  }
}

function extractVideosFromRagResult(data) {
  if (!data) return [];
  const videos = [];
  const seenIds = new Set();

  function addVideo(v) {
    if (!v || !v.video_id || seenIds.has(v.video_id)) return;
    seenIds.add(v.video_id);
    videos.push(v);
  }

  // 1. Ranking list
  if (data.evidence?.metrics?.ranking?.videos && Array.isArray(data.evidence.metrics.ranking.videos)) {
    data.evidence.metrics.ranking.videos.forEach(addVideo);
  }

  // 2. Top video from aggregation MAX / MIN
  if (data.evidence?.metrics?.aggregation?.top_video) {
    addVideo(data.evidence.metrics.aggregation.top_video);
  }

  // 3. Creator analysis top videos
  if (data.evidence?.metrics?.creator_analysis?.top_videos && Array.isArray(data.evidence.metrics.creator_analysis.top_videos)) {
    data.evidence.metrics.creator_analysis.top_videos.forEach(addVideo);
  }

  // 4. Single video lookup
  if (data.evidence?.metrics?.video) {
    const vm = data.evidence.metrics.video;
    addVideo({
      video_id: vm.video_id,
      username: vm.username,
      display_name: vm.display_name,
      description: vm.description,
      views: vm.raw?.views || 0,
      likes: vm.raw?.likes || 0,
      comments: vm.raw?.comments || 0,
      shares: vm.raw?.shares || 0,
      like_rate: vm.rates?.like_rate || null,
      engagement_rate: vm.rates?.engagement_rate || null,
      duration: vm.raw?.duration || 0,
      tiktok_url: `https://www.tiktok.com/@${vm.username}/video/${vm.video_id}`,
    });
  }

  // 5. Comparisons
  if (data.evidence?.comparisons?.video_a) {
    addVideo(data.evidence.comparisons.video_a);
  }
  if (data.evidence?.comparisons?.video_b) {
    addVideo(data.evidence.comparisons.video_b);
  }
  if (data.evidence?.comparisons?.comparison?.video_a) {
    addVideo(data.evidence.comparisons.comparison.video_a);
  }
  if (data.evidence?.comparisons?.comparison?.video_b) {
    addVideo(data.evidence.comparisons.comparison.video_b);
  }

  // 6. Fallback: Parse 18-19 digit video IDs in text or plan entities
  if (videos.length === 0) {
    const rawIds = data.plan?.entities?.videoIds || [];
    const textMatches = (data.answer || '').match(/\b\d{18,20}\b/g) || [];
    const allCandidateIds = Array.from(new Set([...rawIds, ...textMatches]));

    for (const vid of allCandidateIds) {
      const localVid = state.allVideos.find(x => x.video_id === vid);
      if (localVid) {
        addVideo({
          video_id: localVid.video_id,
          username: localVid.username,
          display_name: localVid.display_name,
          description: localVid.description,
          views: localVid.views,
          likes: localVid.likes,
          comments: localVid.comments_count,
          shares: localVid.shares,
          like_rate: localVid.like_rate,
          engagement_rate: localVid.engagement_rate,
          duration: localVid.duration,
          tiktok_url: `https://www.tiktok.com/@${localVid.username}/video/${localVid.video_id}`,
        });
      } else {
        addVideo({
          video_id: vid,
          username: 'tiktok',
          description: `Video ID: ${vid}`,
          views: 0,
          likes: 0,
          tiktok_url: `https://www.tiktok.com/video/${vid}`,
        });
      }
    }
  }

  return videos;
}

function getDeckTitleFromIntent(intent, query = '') {
  const lower = query.toLowerCase();
  if (lower.includes('like') || lower.includes('tim') || lower.includes('thích')) {
    return 'Top Video Nhiều Lượt Thích Nhất';
  }
  if (lower.includes('view') || lower.includes('xem')) {
    return 'Top Video Nhiều Lượt Xem Nhất';
  }
  if (lower.includes('comment') || lower.includes('bình luận')) {
    return 'Top Video Nhiều Bình Luận Nhất';
  }
  if (lower.includes('tương tác') || lower.includes('engagement')) {
    return 'Top Video Tương Tác Cao Nhất';
  }
  if (intent === 'RANKING') return 'Bảng Xếp Hạng Video';
  if (intent === 'COMPARISON') return 'Video Đang So Sánh';
  if (intent === 'METRIC_LOOKUP') return 'Chi Tiết Video Đã Chọn';
  return 'Video Nổi Bật Được Đề Cập';
}

function displayAiVideoDeck(videos, title = 'Video Nổi Bật') {
  if (!elements.chat.videoSidebar || !elements.chat.videoList) return;
  if (!videos || videos.length === 0) return;

  // Set titles
  if (elements.chat.sidebarTitle) {
    elements.chat.sidebarTitle.textContent = title;
  }
  if (elements.chat.sidebarBadge) {
    elements.chat.sidebarBadge.textContent = `${videos.length} video sẵn sàng phát`;
  }

  // Clear current list
  elements.chat.videoList.innerHTML = '';

  // Render cards
  videos.forEach((v, idx) => {
    const rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : 'rank-other';
    const cardEl = document.createElement('div');
    cardEl.className = 'ai-video-card';
    cardEl.dataset.videoId = v.video_id;

    const desc = v.description || 'Không có mô tả video';
    const username = v.username || 'tiktok';
    const tiktokUrl = v.tiktok_url || `https://www.tiktok.com/@${username}/video/${v.video_id}`;

    cardEl.innerHTML = `
      <div class="ai-video-card-top">
        <div class="ai-rank-badge ${rankClass}">#${idx + 1}</div>
        <div class="ai-video-card-author">
          <span class="ai-author-name">@${escapeHtml(username)}</span>
          <span class="ai-video-id-chip">ID: ${v.video_id}</span>
        </div>
        <div class="ai-video-stats-pills">
          <span class="stat-pill views" title="Lượt xem">👁️ ${formatNumber(v.views)}</span>
          <span class="stat-pill likes" title="Lượt thích">❤️ ${formatNumber(v.likes)}</span>
        </div>
      </div>

      <p class="ai-video-desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</p>

      <div class="ai-player-wrapper" id="playerWrap-${v.video_id}">
        <iframe 
          class="tiktok-embed-frame"
          src="https://www.tiktok.com/player/v1/${v.video_id}?autoplay=0"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowfullscreen
          loading="lazy"
          title="TikTok player - ${v.video_id}"
        ></iframe>
      </div>

      <div class="ai-card-actions">
        <a href="${tiktokUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary" title="Mở trang video TikTok gốc">
          TikTok ↗
        </a>
        <button class="btn btn-sm btn-secondary btn-switch-player" data-video-id="${v.video_id}" data-mode="embed" title="Chuyển sang phát file MP4 cục bộ">
          💾 Phát Local MP4
        </button>
        <button class="btn btn-sm btn-secondary btn-open-detail" data-video-id="${v.video_id}" title="Mở modal phân tích chi tiết">
          🔍 Chi tiết
        </button>
      </div>
    `;

    elements.chat.videoList.appendChild(cardEl);
  });

  // Attach card action listeners
  elements.chat.videoList.querySelectorAll('.btn-switch-player').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const vid = e.currentTarget.dataset.videoId;
      const currentMode = e.currentTarget.dataset.mode;
      const wrap = document.getElementById(`playerWrap-${vid}`);
      if (!wrap) return;

      if (currentMode === 'embed') {
        wrap.innerHTML = `
          <video class="local-video-player" controls autoplay playsinline preload="metadata">
            <source src="/media/stream/${vid}" type="video/mp4">
            Trình duyệt không hỗ trợ phát thẻ video HTML5.
          </video>
        `;
        e.currentTarget.dataset.mode = 'local';
        e.currentTarget.innerHTML = '▶️ TikTok Embed';
        showToast(`Đang phát video ${vid} qua file MP4 cục bộ`);
      } else {
        wrap.innerHTML = `
          <iframe 
            class="tiktok-embed-frame"
            src="https://www.tiktok.com/player/v1/${vid}?autoplay=0"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowfullscreen
            loading="lazy"
            title="TikTok player - ${vid}"
          ></iframe>
        `;
        e.currentTarget.dataset.mode = 'embed';
        e.currentTarget.innerHTML = '💾 Phát Local MP4';
        showToast(`Đang nhúng TikTok Player chính thức cho video ${vid}`);
      }
    });
  });

  elements.chat.videoList.querySelectorAll('.btn-open-detail').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const vid = e.currentTarget.dataset.videoId;
      openDetailModal(vid);
    });
  });

  // Show sidebar and expand layout
  elements.chat.videoSidebar.classList.remove('hidden');
  if (elements.chat.workspace) {
    elements.chat.workspace.classList.add('has-sidebar');
  }
  if (elements.chat.btnReopenSidebar) {
    elements.chat.btnReopenSidebar.classList.add('hidden');
  }
}

function appendUserMessage(text) {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message user';
  msgEl.innerHTML = `
    <div class="msg-avatar">👤</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-time">${timeStr}</span>
        <span class="msg-sender">Bạn</span>
      </div>
      <div class="msg-content">
        <p>${escapeHtml(text)}</p>
      </div>
    </div>
  `;
  elements.chat.messages.appendChild(msgEl);
  elements.chat.messages.scrollTop = elements.chat.messages.scrollHeight;
}

function appendThinkingMessage() {
  const id = 'thinking-' + Date.now();
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message assistant';
  msgEl.id = id;
  msgEl.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-sender">TikTok Analytics AI</span>
        <span class="msg-time">Đang truy vấn database...</span>
      </div>
      <div class="msg-content thinking-bubble">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  elements.chat.messages.appendChild(msgEl);
  elements.chat.messages.scrollTop = elements.chat.messages.scrollHeight;
  return id;
}

function removeThinkingMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function appendAssistantMessage(markdownText, intent, relatedVideos = []) {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message assistant';
  const htmlContent = renderMarkdownToHtml(markdownText);
  const msgId = 'msg-' + Date.now();

  let deckActionHtml = '';
  if (relatedVideos && relatedVideos.length > 0) {
    deckActionHtml = `
      <div class="chat-deck-action-row">
        <button class="chat-action-deck-chip" id="btnFocusDeck-${msgId}">
          🎬 Đã mở ${relatedVideos.length} video trên khung phát TikTok (Bên phải) ↗
        </button>
      </div>
    `;
  }

  msgEl.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-sender">TikTok Analytics AI</span>
        <span class="msg-time">${timeStr}</span>
        ${intent ? `<span class="badge" style="font-size:0.68rem; padding: 1px 6px;">${intent}</span>` : ''}
      </div>
      <div class="msg-content">
        ${htmlContent}
        ${deckActionHtml}
      </div>
    </div>
  `;
  elements.chat.messages.appendChild(msgEl);
  elements.chat.messages.scrollTop = elements.chat.messages.scrollHeight;

  // Add click handler to deck focus button
  if (relatedVideos && relatedVideos.length > 0) {
    const btn = document.getElementById(`btnFocusDeck-${msgId}`);
    if (btn) {
      btn.addEventListener('click', () => {
        displayAiVideoDeck(relatedVideos, 'Video Được Đề Cập');
        if (elements.chat.videoSidebar) {
          elements.chat.videoSidebar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }
}

function renderMarkdownToHtml(md) {
  if (!md) return '';

  const lines = md.split('\n');
  const out = [];
  let inTable = false;
  let tableHeaderParsed = false;
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Table handling
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        if (inList) { out.push('</ul>'); inList = false; }
        inTable = true;
        tableHeaderParsed = false;
        const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
        out.push('<table><thead><tr>' + cells.map(c => `<th>${inlineFormat(c)}</th>`).join('') + '</tr></thead><tbody>');
        continue;
      } else if (!tableHeaderParsed && trimmed.includes('---')) {
        tableHeaderParsed = true;
        continue;
      } else {
        const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
        out.push('<tr>' + cells.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>');
        continue;
      }
    } else if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }

    // List handling
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`);
      continue;
    } else if (inList && trimmed === '') {
      out.push('</ul>');
      inList = false;
    }

    if (!trimmed) {
      continue;
    }

    // Headers
    if (trimmed.startsWith('#### ')) {
      out.push(`<h4>${inlineFormat(trimmed.slice(5))}</h4>`);
    } else if (trimmed.startsWith('### ')) {
      out.push(`<h3>${inlineFormat(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      out.push(`<h2>${inlineFormat(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('> ')) {
      out.push(`<blockquote>${inlineFormat(trimmed.slice(2))}</blockquote>`);
    } else if (trimmed.startsWith('---')) {
      out.push('<hr>');
    } else {
      out.push(`<p>${inlineFormat(trimmed)}</p>`);
    }
  }

  if (inTable) out.push('</tbody></table>');
  if (inList) out.push('</ul>');

  return out.join('\n');
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ─── AI Config Settings Modal Handlers ──────────────────────

function initAiConfigEvents() {
  const { aiConfig } = elements;
  if (!aiConfig.btnOpen || !aiConfig.backdrop) return;

  const presets = {
    offline: {
      url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      key: '',
      embed: '',
    },
    openai: {
      url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      embed: 'text-embedding-3-small',
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-2.0-flash',
      embed: '',
    },
    deepseek: {
      url: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      embed: '',
    },
    groq: {
      url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      embed: '',
    },
    ollama: {
      url: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
      key: 'ollama',
      embed: '',
    },
  };

  async function openModal() {
    try {
      const res = await fetch('/api/rag/config');
      if (res.ok) {
        const data = await res.json();
        aiConfig.llmBaseUrl.value = data.llmBaseUrl || '';
        aiConfig.llmModel.value = data.llmModel || '';
        aiConfig.llmApiKey.value = '';
        aiConfig.llmApiKey.placeholder = data.hasLlmApiKey ? `Đã lưu key: ${data.llmApiKeyMasked}` : 'sk-... (để trống nếu dùng Offline Engine)';
        aiConfig.embeddingModel.value = data.embeddingModel || '';
      }
    } catch {}
    aiConfig.backdrop.classList.remove('hidden');
  }

  function closeModal() {
    aiConfig.backdrop.classList.add('hidden');
  }

  aiConfig.btnOpen.addEventListener('click', openModal);
  aiConfig.closeBtn.addEventListener('click', closeModal);
  aiConfig.btnCancel.addEventListener('click', closeModal);
  aiConfig.backdrop.addEventListener('click', (e) => {
    if (e.target === aiConfig.backdrop) closeModal();
  });

  // Preset Chips
  aiConfig.presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      aiConfig.presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const p = chip.getAttribute('data-provider');
      const cfg = presets[p];
      if (cfg) {
        aiConfig.llmBaseUrl.value = cfg.url;
        aiConfig.llmModel.value = cfg.model;
        if (cfg.key !== undefined) {
          aiConfig.llmApiKey.value = cfg.key;
        }
        if (cfg.embed !== undefined) {
          aiConfig.embeddingModel.value = cfg.embed;
        }
      }
    });
  });

  // Save Config
  aiConfig.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      llmBaseUrl: aiConfig.llmBaseUrl.value.trim(),
      llmModel: aiConfig.llmModel.value.trim(),
      embeddingModel: aiConfig.embeddingModel.value.trim(),
    };
    if (aiConfig.llmApiKey.value.trim() !== '') {
      payload.llmApiKey = aiConfig.llmApiKey.value.trim();
    }

    try {
      const res = await fetch('/api/rag/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Đã lưu cấu hình AI thành công!');
        closeModal();
      } else {
        showToast(`Lỗi: ${data.error}`);
      }
    } catch (err) {
      showToast(`Lỗi khi lưu cấu hình: ${err.message}`);
    }
  });
}

// Initial Execution
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  initMainTabs();
  initChatEvents();
  initAiConfigEvents();
  fetchVideos();
  fetchProfiles();
  fetchSystemInfo();
});
