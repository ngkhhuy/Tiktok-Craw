/**
 * TikTok Dataset Explorer — Client Application
 * Handles data fetching, UI state, video playback, and rich inspection.
 */

// Application State
const state = {
  allVideos: [],
  filteredVideos: [],
  activeFilter: 'all', // 'all' | 'single' | 'profile'
  activeSort: 'newest',
  searchQuery: '',
  selectedVideo: null,
  detailData: null,
  activeTab: 'overview',
  currentJobId: null,
  crawlPollTimer: null,
  currentProfileBaseViews: 0,
};

// DOM Elements Cache
const elements = {
  ingest: {
    input: document.getElementById('ingestInput'),
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
  emptyState: document.getElementById('emptyState'),
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
    const res = await fetch('/api/videos');
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();
    state.allVideos = data.videos || [];

    updateStatsBar(data);
    updatePillCounters();
    applyFiltersAndSort();
  } catch (err) {
    console.error('Failed to fetch videos:', err);
    showToast('Lỗi khi tải dữ liệu video: ' + err.message);
  } finally {
    if (elements.btnRefresh) {
      elements.btnRefresh.classList.remove('loading');
    }
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
  const profile = state.allVideos.filter((v) => !!v.profileId).length;

  elements.filters.allCount.textContent = total;
  elements.filters.singleCount.textContent = single;
  elements.filters.profileCount.textContent = profile;
}

// ==========================================
// Filtering & Sorting
// ==========================================

function applyFiltersAndSort() {
  let list = [...state.allVideos];

  // 1. Pill Filter (all / single / profile)
  if (state.activeFilter === 'single') {
    list = list.filter((v) => !v.profileId);
  } else if (state.activeFilter === 'profile') {
    list = list.filter((v) => !!v.profileId);
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
    btn.addEventListener('click', () => {
      elements.filters.pillBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.dataset.filter;
      applyFiltersAndSort();
    });
  });

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
    elements.ingest.input.addEventListener('input', (e) => {
      if (e.target.value.trim().length > 0) {
        elements.ingest.btnClear.classList.remove('hidden');
      } else {
        elements.ingest.btnClear.classList.add('hidden');
      }
    });

    elements.ingest.input.addEventListener('keydown', (e) => {
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
    const res = await fetch('/api/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, limit: 1000 }),
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

// Initial Execution
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  fetchVideos();
});
