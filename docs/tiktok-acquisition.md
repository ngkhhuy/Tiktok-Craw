# TikTok Public Acquisition Architecture & Findings

This document records the empirical findings from probing TikTok's public web flow and defines the acquisition strategy for the standalone crawler.

---

## 1. Executive Summary & Principles

1. **Strictly Independent**: Zero dependencies on third-party scraping APIs (such as TikWM, SnapTik, RapidAPI, etc.).
2. **HTTP-First**: Direct HTTP requests to TikTok's official web servers form the primary acquisition pipeline.
3. **No Fabricated Data**: If an endpoint or capability is restricted or unavailable without authentication, the system records it as `unavailable` with structured rationale rather than fabricating mock data.
4. **Resilience & Graceful Degradation**: If secondary artifacts (such as comments) are blocked or restricted, the core video ingestion pipeline continues and succeeds.

---

## 2. Investigation Findings

### 2.1 Single Video Flow

* **URL Patterns**:
  - Desktop: `https://www.tiktok.com/@username/video/<video_id>`
  - Short links: `https://vm.tiktok.com/<code/`, `https://vt.tiktok.com/<code>/`, `https://www.tiktok.com/t/<code>/`
* **Short Link Redirection**:
  - TikTok responds with HTTP `302 Found` and a `Location` header pointing to the canonical video URL.
  - Can be resolved via standard HTTP `HEAD` or `GET` with redirect tracking.
* **HTML State & Metadata**:
  - The public video page embeds server-side rendered (SSR) JSON inside:
    ```html
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
    ```
  - Under `__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct`, TikTok provides:
    - `id`: Video ID
    - `desc`: Video description / caption
    - `createTime`: UNIX timestamp of publication
    - `author`: ID, uniqueId, nickname, avatar URLs, signature, verified badge
    - `stats`: playCount, diggCount (likes), commentCount, shareCount, collectCount
    - `music`: ID, title, authorName, playUrl
    - `video`: playAddr, downloadAddr, cover, dynamicCover, originCover, duration, width, height, format
* **Media Stream Ingestion**:
  - `itemStruct.video.playAddr` and `itemStruct.video.downloadAddr` provide the CDN video URLs (`v16-webapp-prime.tiktok.com` etc.).
  - Direct HTTP streaming requires passing:
    1. The cookies captured from the initial video page request (e.g. `ttwid`).
    2. `Referer: https://www.tiktok.com/`.
    3. A consistent desktop or mobile `User-Agent`.
  - With these headers, TikTok's CDN returns HTTP `200 OK` or `206 Partial Content`, enabling direct streaming to disk into temporary `.part` files without third-party services.
* **Thumbnail / Cover**:
  - Directly accessible from `itemStruct.video.cover` or `originCover` with `Referer: https://www.tiktok.com/`.

---

### 2.2 Comments Acquisition

* **Public Web API Endpoint**:
  ```text
  GET https://www.tiktok.com/api/comment/list/?aid=1988&aweme_id=<VIDEO_ID>&count=20&cursor=0
  ```
* **Headers Required**:
  - `Referer: https://www.tiktok.com/@username/video/<VIDEO_ID>`
  - Standard Browser `User-Agent`
* **Behavior**:
  - Returns raw JSON containing `comments`, `cursor`, `has_more`, `total`.
  - Each comment provides `cid` (comment ID), `text`, `create_time`, `digg_count`, `reply_comment_total`, and `user` object.
  - For replies, TikTok exposes:
    ```text
    GET https://www.tiktok.com/api/comment/list/reply/?aid=1988&item_id=<VIDEO_ID>&comment_id=<CID>&count=20&cursor=0
    ```
* **Pagination**:
  - Controlled by `cursor` and `has_more` fields.
  - Safe guards implemented against infinite pagination and repeated cursor loops.

---

### 2.3 Profile Flow

* **Profile Metadata**:
  - Direct HTTP request to `https://www.tiktok.com/@username` with a mobile User-Agent (`iPhone Safari`) bypasses web desktop WAF challenges and returns the full SSR JSON in `__UNIVERSAL_DATA_FOR_REHYDRATION__`.
  - Under `__DEFAULT_SCOPE__["webapp.user-detail"].userInfo`, TikTok provides:
    - User details: `id`, `secUid`, `uniqueId`, `nickname`, `avatarLarger`, `signature`, `verified`
    - Stats: `followerCount`, `followingCount`, `heartCount`, `videoCount`
* **Profile Video Discovery**:
  - Web HTTP requests for `api/post/item_list` require dynamic client-side signatures (`X-Bogus`, `_signature`).
  - When unauthenticated on web, TikTok returns empty post feeds for certain profiles unless client scripts execute or an active session is provided.
  - **Strategy**:
    1. HTTP-first: Check SSR state and preload feeds.
    2. Browser fallback (`Playwright`): Launch isolated headless browser (`msedge`/`chromium`) with mobile/desktop context to trigger video card loading and pagination.
    3. If TikTok limits unauthenticated profile video feeds, discover all visible items, record exact counts in `videos.json` and `crawl-manifest.json`, and report the limitation transparently.

---

## 3. Architecture Overview

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
