# TikTok Standalone Crawler

An independent, local TikTok data-acquisition system built from scratch in TypeScript and Node.js. It ingests public TikTok videos and creator profiles, produces normalized datasets, and maintains resumable, incremental crawl manifests.

> **CRITICAL ARCHITECTURAL GUARANTEE**:
> This crawler is completely independent. It does **NOT** use TikWM, the TikWM API, SnapTik, RapidAPI, or any other third-party scraping or downloader service. All acquisition is performed directly against official public TikTok endpoints using an **HTTP-First Architecture** with graceful Playwright browser fallback.

---

## Features

- **HTTP-First Pipeline**: Direct HTTP requests against public TikTok endpoints, extracting server-side rehydration JSON (`__UNIVERSAL_DATA_FOR_REHYDRATION__`).
- **Full Video Ingestion**: Streams video directly to disk into `.part` temporary files, verifies integrity, calculates SHA-256 hashes, and atomically renames to final `.mp4`.
- **Thumbnail / Cover**: Extracts and downloads original high-resolution cover images.
- **Technical Metadata (FFprobe)**: Inspects duration, width, height, fps, video/audio codecs, sample rates, channels, bitrate, and container format into `technical.json`.
- **Public Comments & Replies**: Fetches top-level comments and nested replies directly from TikTok's public comment API with cursor-based pagination and deduplication.
- **Profile Crawler**: Resolves user details, follower counts, and bio directly via HTTP; discovers videos and processes them concurrently.
- **Resume & Idempotency**: Automatically skips completed videos on repeated runs, validates file presence and size > 0, and resumes interrupted crawls.
- **Incremental Crawling**: Skips existing videos and only processes newly discovered videos.
- **Selective Refresh**: Supports `--refresh` (refreshes metadata without re-downloading media) and `--refresh-comments` (only refreshes comments).
- **Concurrency & Rate Limiting**: Configurable concurrency pool, request delays, exponential backoff with jitter, and graceful shutdown handling.
- **No AI Processing**: Ingestion only. Raw structured datasets are preserved cleanly for downstream multimodal pipelines (Whisper, Vision, Embeddings, etc.).

---

## Architecture

```text
                     CLI (npm run start -- video / profile)
                                   │
                           Crawler Orchestrator
                       (VideoCrawler / ProfileCrawler)
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
      TikTokAcquisition                         Storage Engine
      ├── HttpAcquisition (Default)             ├── LocalStorage
      │   ├── UrlResolver                       ├── ArtifactWriter
      │   ├── VideoAcquisition                  └── ManifestManager
      │   ├── ProfileAcquisition
      │   └── CommentsAcquisition
      └── BrowserFallback (Playwright)
          └── ProfileDiscovery
              │
              ▼
      Media Downloader & Utilities
      ├── Streaming Downloader (.part -> atomic rename)
      ├── SHA-256 Hasher
      ├── FFprobe Runner
      └── Concurrency / Rate Limiter / Retry
```

---

## Directory Structure

```text
tiktok-crawler/
├── data/
│   ├── videos/
│   │   └── <VIDEO_ID>/
│   │       ├── video.mp4
│   │       ├── thumbnail.jpg
│   │       ├── metadata.json
│   │       ├── technical.json
│   │       ├── comments.json
│   │       └── manifest.json
│   └── profiles/
│       └── <PROFILE_ID>/
│           ├── profile.json
│           ├── videos.json
│           ├── crawl-manifest.json
│           └── videos/
│               └── <VIDEO_ID>/...
├── docs/
│   └── tiktok-acquisition.md
├── src/
│   ├── acquisition/tiktok/
│   │   ├── http/
│   │   ├── browser/
│   │   ├── parser.ts
│   │   ├── resolver.ts
│   │   └── types.ts
│   ├── cli/
│   ├── crawler/
│   ├── downloader/
│   ├── media/
│   ├── storage/
│   ├── utils/
│   └── config/
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Prerequisites

1. **Node.js**: Version 20.0.0 or higher.
2. **FFmpeg / FFprobe**: Installed and available in PATH (or specified via `FFPROBE_PATH` in `.env`).
3. **Microsoft Edge or Chromium**: Pre-installed on Windows for Playwright fallback.

---

## Installation

```bash
# Clone or navigate to the directory
cd "e:\TikTok Craw"

# Install dependencies
npm install

# Build TypeScript
npm run build
```

---

## Configuration (`.env`)

Copy `.env.example` to `.env`:

```env
TIKTOK_VIDEO_CONCURRENCY=2
TIKTOK_COMMENT_CONCURRENCY=2
TIKTOK_REQUEST_DELAY_MS=500

MAX_COMMENTS_PER_VIDEO=1000
MAX_COMMENT_PAGES=20

MAX_RETRIES=3
REQUEST_TIMEOUT_MS=120000

DATA_DIR=./data

HEADLESS=true
# Optional: Set custom ffprobe path if not in system PATH
# FFPROBE_PATH=C:\path\to\ffprobe.exe
```

---

## CLI Usage

### 1. Ingest Single Video

```bash
# Ingest single public video
npm run start -- video "https://www.tiktok.com/@tiktok/video/7106594312292453675"

# Ingest via short URL (vm.tiktok.com or vt.tiktok.com)
npm run start -- video "https://vm.tiktok.com/ZMh5yU7G8/"

# Only refresh comments for an already completed video
npm run start -- video "https://www.tiktok.com/@tiktok/video/7106594312292453675" --refresh-comments

# Force re-download and re-processing
npm run start -- video "https://www.tiktok.com/@tiktok/video/7106594312292453675" --force
```

### 2. Ingest Profile

```bash
# Crawl creator profile with video limit
npm run start -- profile "https://www.tiktok.com/@tiktok" --limit 5

# Set custom concurrency
npm run start -- profile "https://www.tiktok.com/@tiktok" --limit 10 --concurrency 3

# Force re-processing all videos
npm run start -- profile "https://www.tiktok.com/@tiktok" --limit 10 --force
```

---

## Testing

Run the automated test suite (Unit & Integration tests):

```bash
npm test
```

Test coverage includes:
- URL parser (canonicalization, query params, fragments, `@/video/`, short links).
- Metadata normalization (full schemas, null fallbacks, unicode/emojis).
- Comments normalization and nested reply hierarchies.
- ConcurrencyLimiter and queueing.
- SHA-256 file verification.
- Manifest states, corrupted file detection, and resume idempotency.
- Real public TikTok single-video ingestion integration test.
- Real public TikTok profile discovery and crawl-manifest integration test.

---

## How Acquisition Works

1. **Short URL Resolution**:
   - Sends an HTTP request tracking redirects (`301`/`302`/`Location`) to resolve short links (`vm.tiktok.com`, `vt.tiktok.com`, `/t/`) into canonical URLs.
2. **Metadata Acquisition**:
   - Direct HTTP request to the public TikTok video page.
   - Extracts server-side rendered state in `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">`.
   - Normalizes into a standard JSON schema (`metadata.json`).
3. **Media Streaming**:
   - Extracts `playAddr` from the video item.
   - Passes the captured session cookies (`ttwid`) and `Referer: https://www.tiktok.com/`.
   - TikTok CDN responds with HTTP 200/206.
   - Streams directly into `video.mp4.part`, computes SHA-256, and atomically renames to `video.mp4`.
4. **Technical Inspection**:
   - Executes `ffprobe -print_format json -show_format -show_streams` on the local file.
   - Saves duration, resolution, fps, codecs, and bitrate into `technical.json`.
5. **Comments**:
   - Queries `https://www.tiktok.com/api/comment/list/?aid=1988&aweme_id=<ID>&count=20&cursor=<CURSOR>`.
   - Normalizes comments and nested replies into `comments.json`.
6. **Profile Discovery & Fallback**:
   - Resolves user profile information via direct HTTP.
   - Uses HTTP-first discovery for initial video listings.
   - Invokes an isolated Playwright browser instance (`BrowserFallback`) only if the HTTP route discovers fewer videos than requested.

---

## Known TikTok Limitations & Handling

1. **Anti-Bot WAF (SlardarWAF)**:
   - TikTok web desktop sometimes returns a 1.4KB SlardarWAF challenge for unauthenticated desktop browser requests.
   - The crawler handles this automatically by adapting user-agents to mobile profiles (`iPhone Safari`), where TikTok serves the full SSR HTML rehydration payload.
2. **Profile Video Feeds**:
   - Unauthenticated web requests for historical user video feeds may be restricted or capped by TikTok.
   - The crawler executes the isolated Playwright fallback to trigger video loading, saves all discovered items, and transparently records discovered vs. requested counts in `crawl-manifest.json`.
3. **Disabled Video Comments**:
   - Some creators disable comments or set them to private. The crawler gracefully records `{ "status": "unavailable", "reason": "..." }` and continues the pipeline without failing the video ingestion.
