You are a senior backend/reverse-engineering engineer.

Build a **standalone TikTok crawler from scratch**. This project must be completely independent and must **NOT use TikWM or any third-party TikTok scraping API/service as its core acquisition layer**.

The goal is to build a reliable local TikTok data-acquisition system that can collect public TikTok videos and profiles and save a reproducible local dataset.

---

# 1. HARD REQUIREMENTS

## Absolutely do NOT use

* TikWM
* TikWM API
* Any TikTok downloader API
* Any third-party "TikTok scraping API"
* Hard-coded URLs copied from DevTools sessions
* Hard-coded temporary CDN URLs
* Fake/mock data presented as real data
* AI processing at this stage

Do not solve the problem by simply wrapping another service.

The crawler itself must perform the acquisition.

## Allowed approaches

Use legitimate public/accessible mechanisms such as:

1. TikTok's documented/public APIs where applicable
2. Public TikTok web pages
3. Publicly accessible web/network endpoints
4. HTTP requests to TikTok
5. Browser automation when necessary
6. Parsing data embedded in TikTok HTML
7. Extracting structured state embedded in public pages
8. Following redirects from TikTok short URLs
9. Directly downloading publicly accessible media URLs obtained during acquisition

If TikTok requires browser execution for a particular acquisition step, use Playwright rather than pretending a simple HTTP request works.

Do not bypass authentication, CAPTCHA, access controls, paywalls, or other security mechanisms.

If a capability is genuinely unavailable without authentication or restricted access, report it clearly instead of fabricating data.

---

# 2. PROJECT MUST BE COMPLETELY STANDALONE

Create a new project.

Do NOT inspect, import, copy, or depend on my existing YouTube crawler.

Do NOT create shared packages with the YouTube project.

Do NOT reuse its source code or schemas unless explicitly necessary for generic engineering reasons.

This project should have its own:

```text
tiktok-crawler/
├── src/
├── data/
├── tests/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

Recommended stack:

* Node.js 20+
* TypeScript
* ESM
* npm
* Playwright if browser automation is required
* native `fetch` / `undici` for HTTP
* `ffmpeg` / `ffprobe`
* streaming file downloads
* SHA-256 hashing

Keep dependencies minimal.

---

# 3. FIRST TASK: INVESTIGATE TIKTOK'S CURRENT PUBLIC WEB FLOW

Before writing the crawler, investigate how TikTok currently exposes public video/profile data.

Do NOT immediately start coding based on assumptions.

Determine:

### Single video

For:

```text
https://www.tiktok.com/@username/video/123456789
```

determine:

* how the public page exposes metadata
* whether structured JSON exists in HTML
* whether there is serialized application state
* how video/media URLs are exposed
* whether redirects are required
* whether browser execution is required
* whether comments are exposed
* how pagination works
* what data is stable vs temporary

### Profile

For:

```text
https://www.tiktok.com/@username
```

determine:

* how profile metadata is exposed
* how videos are discovered
* whether videos are embedded in page state
* whether pagination/cursor mechanisms exist
* whether browser execution is required
* whether infinite scrolling is required

### Short URLs

Support:

```text
https://vm.tiktok.com/...
https://vt.tiktok.com/...
```

Resolve these to canonical TikTok URLs.

Do not assume the redirect behavior is permanent.

Document what you discovered in:

```text
docs/tiktok-acquisition.md
```

If a technique is unstable, explicitly mark it as unstable.

---

# 4. ARCHITECTURE

Use a clean acquisition architecture.

Suggested:

```text
src/
├── cli/
│
├── acquisition/
│   └── tiktok/
│       ├── client.ts
│       ├── browser.ts
│       ├── resolver.ts
│       ├── video.ts
│       ├── profile.ts
│       ├── comments.ts
│       ├── pagination.ts
│       ├── parser.ts
│       └── types.ts
│
├── downloader/
│   ├── media-downloader.ts
│   └── hash.ts
│
├── media/
│   └── ffprobe.ts
│
├── storage/
│   ├── metadata.ts
│   ├── comments.ts
│   └── manifest.ts
│
├── crawler/
│   ├── video-crawler.ts
│   └── profile-crawler.ts
│
├── utils/
│   ├── retry.ts
│   ├── rate-limit.ts
│   └── logger.ts
│
└── index.ts
```

Keep TikTok-specific acquisition logic isolated.

The rest of the crawler should not know how TikTok internally exposes its data.

---

# 5. SUPPORTED INPUTS

Implement:

### Video

```text
npm run start -- video "<URL>"
```

Support:

```text
https://www.tiktok.com/@username/video/123456789
https://vm.tiktok.com/xxxxx/
https://vt.tiktok.com/xxxxx/
```

### Profile

```text
npm run start -- profile "<URL>"
```

Support:

```text
https://www.tiktok.com/@username
```

---

# 6. SINGLE VIDEO PIPELINE

Implement:

```text
URL
 ↓
resolve short URL
 ↓
canonicalize URL
 ↓
extract video ID
 ↓
acquire public metadata
 ↓
acquire public media URL
 ↓
download full video
 ↓
download cover/thumbnail
 ↓
FFprobe
 ↓
acquire comments
 ↓
SHA-256
 ↓
manifest
```

Output:

```text
data/
└── videos/
    └── <VIDEO_ID>/
        ├── video.mp4
        ├── thumbnail.jpg
        ├── metadata.json
        ├── technical.json
        ├── comments.json
        └── manifest.json
```

---

# 7. VIDEO METADATA

Normalize metadata into:

```json
{
  "source": "tiktok",
  "video_id": "...",
  "url": "...",
  "canonical_url": "...",
  "author": {
    "id": "...",
    "username": "...",
    "display_name": "...",
    "avatar_url": "..."
  },
  "content": {
    "description": "...",
    "hashtags": [],
    "mentions": [],
    "music": {
      "id": "...",
      "title": "...",
      "author": "..."
    }
  },
  "engagement": {
    "views": 0,
    "likes": 0,
    "comments": 0,
    "shares": 0,
    "saves": 0
  },
  "published_at": "...",
  "media": {
    "video_url": "...",
    "thumbnail_url": "...",
    "duration": null,
    "width": null,
    "height": null
  },
  "platform_specific": {}
}
```

Do not invent fields that TikTok does not actually expose.

If a value is unavailable:

```json
null
```

rather than a fake value.

Preserve useful raw TikTok-specific fields under:

```json
"platform_specific"
```

---

# 8. MEDIA DOWNLOAD

The crawler must download the actual video file.

Requirements:

* stream directly to disk
* never load the entire video into memory
* use temporary `.part` files
* validate HTTP response
* validate content length where available
* validate resulting file size
* retry transient failures
* remove corrupted partial files
* atomically rename `.part` → final file
* calculate SHA-256 after download

Example:

```text
video.mp4.part
        ↓
download
        ↓
validate
        ↓
SHA-256
        ↓
video.mp4
```

Do not persist temporary CDN URLs as permanent identifiers.

---

# 9. THUMBNAIL / COVER

Download the best publicly available cover/thumbnail.

Save:

```text
thumbnail.jpg
```

If TikTok exposes multiple cover images, choose the highest-quality stable public one available.

Record its source URL in metadata if appropriate.

---

# 10. FFMPEG / FFPROBE

Use `ffprobe` to extract:

* duration
* width
* height
* fps
* video codec
* audio codec
* audio sample rate
* audio channels
* bitrate
* container format
* file size

Example:

```json
{
  "duration": 23.41,
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "video_codec": "h264",
  "audio_codec": "aac",
  "audio_sample_rate": 44100,
  "audio_channels": 2,
  "bitrate": 2500000,
  "container": "mp4",
  "file_size": 12345678
}
```

Do not assume these values before running ffprobe.

---

# 11. COMMENTS

Implement public comment acquisition if it is currently possible through legitimate public access.

Support:

* top-level comments
* replies
* pagination
* cursors
* deduplication
* configurable limits
* retry/backoff

Normalize:

```json
{
  "comment_id": "...",
  "video_id": "...",
  "parent_comment_id": null,
  "author": {
    "id": "...",
    "username": "..."
  },
  "text": "...",
  "like_count": 0,
  "published_at": "...",
  "is_reply": false
}
```

For replies:

```json
{
  "comment_id": "...",
  "parent_comment_id": "...",
  "is_reply": true
}
```

Never flatten replies.

Preserve the relationship.

Deduplicate by:

```text
comment_id
```

If comments are inaccessible, the video crawler must still succeed.

Example:

```json
{
  "status": "unavailable",
  "reason": "comments_not_publicly_accessible"
}
```

Do not fail the entire video because comments are unavailable.

---

# 12. PROFILE CRAWLER

Implement:

```text
npm run start -- profile "<PROFILE_URL>"
```

Pipeline:

```text
profile URL
 ↓
resolve profile
 ↓
collect profile metadata
 ↓
discover videos
 ↓
pagination
 ↓
for each video
    ↓
metadata
    ↓
video
    ↓
thumbnail
    ↓
technical
    ↓
comments
    ↓
hash
    ↓
manifest
```

Output:

```text
data/
└── profiles/
    └── <PROFILE_ID>/
        ├── profile.json
        ├── videos.json
        ├── crawl-manifest.json
        └── videos/
            ├── <VIDEO_ID>/
            │   ├── video.mp4
            │   ├── thumbnail.jpg
            │   ├── metadata.json
            │   ├── technical.json
            │   ├── comments.json
            │   └── manifest.json
            └── ...
```

---

# 13. PROFILE PAGINATION

Do not implement fake pagination.

Determine how TikTok currently exposes the next page/cursor.

Support:

* cursor-based pagination
* continuation tokens
* browser scrolling if that is the actual mechanism
* duplicate detection
* stopping when no more videos are available

Maintain:

```json
{
  "cursor": "...",
  "page": 1,
  "items_fetched": 30
}
```

in crawl state where useful.

Avoid infinite loops.

Detect repeated cursors.

---

# 14. RESUME / INCREMENTAL CRAWLING

The crawler must be resumable.

If:

```text
video A
video B
video C
```

were successfully processed and the process crashes on video D, restarting should NOT re-download A/B/C unnecessarily.

Use:

```text
manifest.json
crawl-manifest.json
```

to determine completed stages.

Each video should have explicit stage status:

```json
{
  "metadata": "completed",
  "video": "completed",
  "thumbnail": "completed",
  "technical": "completed",
  "comments": "completed",
  "hash": "completed"
}
```

Possible states:

```text
pending
running
completed
failed
skipped
unavailable
```

---

# 15. INCREMENTAL MODE

Default behavior should be incremental.

If a video already exists and its manifest indicates successful acquisition:

```text
skip
```

unless:

```text
--refresh
```

is specified.

Support:

```text
--refresh
--refresh-comments
--force
```

Semantics:

### `--refresh`

Refresh metadata and acquisition information but avoid unnecessary media downloads when possible.

### `--refresh-comments`

Only refresh comments.

### `--force`

Reprocess the entire video.

---

# 16. CONCURRENCY

Implement configurable concurrency.

Defaults:

```env
TIKTOK_VIDEO_CONCURRENCY=2
TIKTOK_COMMENT_CONCURRENCY=2
```

CLI:

```bash
--concurrency 2
```

Do NOT create uncontrolled parallel requests.

Implement:

* concurrency limits
* request delay
* retry with exponential backoff
* jitter
* timeout
* graceful shutdown

Default:

```env
TIKTOK_REQUEST_DELAY_MS=500
MAX_RETRIES=3
REQUEST_TIMEOUT_MS=120000
```

Do not aggressively hammer TikTok.

---

# 17. ERROR ISOLATION

One failed video must not destroy the profile crawl.

Example:

```text
Video A → SUCCESS
Video B → SUCCESS
Video C → FAILED
Video D → SUCCESS
Video E → SUCCESS
```

Record:

```json
{
  "video_id": "C",
  "status": "failed",
  "error": {
    "code": "...",
    "message": "...",
    "stage": "download"
  }
}
```

Continue processing.

---

# 18. MANIFEST

Each video should have:

```json
{
  "video_id": "...",
  "source": "tiktok",
  "started_at": "...",
  "completed_at": "...",
  "status": "completed",
  "stages": {
    "metadata": {},
    "video": {},
    "thumbnail": {},
    "technical": {},
    "comments": {},
    "hash": {}
  },
  "files": {
    "video": "video.mp4",
    "thumbnail": "thumbnail.jpg",
    "metadata": "metadata.json",
    "technical": "technical.json",
    "comments": "comments.json"
  },
  "hash": {
    "algorithm": "sha256",
    "value": "..."
  }
}
```

The manifest should allow the crawler to determine what work has already completed.

---

# 19. PROFILE CRAWL MANIFEST

Maintain:

```text
crawl-manifest.json
```

with:

* profile ID
* profile URL
* crawl start/end
* total discovered videos
* successful videos
* failed videos
* skipped videos
* pagination state
* cursor
* errors
* timestamps

Example:

```json
{
  "profile_id": "...",
  "status": "completed",
  "videos_discovered": 100,
  "videos_completed": 96,
  "videos_failed": 4,
  "videos_skipped": 0
}
```

---

# 20. CLI

Implement:

```bash
npm run start -- video "<TIKTOK_VIDEO_URL>"
```

```bash
npm run start -- profile "<TIKTOK_PROFILE_URL>"
```

Options:

```bash
--limit 10
--concurrency 2
--refresh
--refresh-comments
--force
--headless
--verbose
```

Examples:

```bash
npm run start -- video "https://www.tiktok.com/@example/video/123"
```

```bash
npm run start -- profile "https://www.tiktok.com/@example" --limit 10
```

---

# 21. CONFIGURATION

Create:

```text
.env.example
```

with:

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
```

Do not put secrets in source code.

If a legitimate API requires credentials, use environment variables.

---

# 22. BROWSER AUTOMATION

If Playwright is required:

* keep browser logic isolated
* reuse browser instances where possible
* avoid launching a new browser for every video
* reuse contexts carefully
* close resources correctly
* support headless mode
* handle browser crashes
* capture useful diagnostics when acquisition fails

Do not use browser automation merely because it is easier if HTTP acquisition is sufficient.

Prefer:

```text
HTTP
```

when reliable.

Use:

```text
Playwright
```

when TikTok's public web application actually requires browser execution.

---

# 23. URL HANDLING

Implement robust URL parsing.

Support:

```text
www.tiktok.com
tiktok.com
vm.tiktok.com
vt.tiktok.com
```

Handle:

* trailing slashes
* query parameters
* fragments
* redirects
* URL encoding

Extract:

```text
username
video_id
```

when available.

Reject unrelated URLs cleanly.

---

# 24. RAW DATA PRESERVATION

Where useful, preserve raw acquisition responses separately.

For example:

```text
raw/
```

or:

```text
metadata.raw.json
```

Do NOT expose private/session-sensitive information.

Do not persist:

* authentication cookies
* access tokens
* browser credentials
* sensitive headers

unless explicitly required and safely configured.

---

# 25. OBSERVABILITY

CLI output should clearly show:

```text
[DISCOVER]
[METADATA]
[VIDEO]
[THUMBNAIL]
[FFPROBE]
[COMMENTS]
[HASH]
[MANIFEST]
```

Example:

```text
[VIDEO] 731928371
  ✓ metadata
  ✓ video
  ✓ thumbnail
  ✓ technical
  ✓ comments
  ✓ sha256

[RESULT] completed
```

For profile:

```text
[PROFILE] @example
[DISCOVER] 100 videos

[1/100] ...
[2/100] ...
[3/100] ...

[SUMMARY]
Completed: 96
Failed: 4
Skipped: 0
```

---

# 26. TESTS

Write real tests.

At minimum:

### Unit tests

* URL parsing
* short URL handling
* canonical URL generation
* video ID extraction
* profile URL parsing
* metadata normalization
* comment normalization
* reply relationship
* comment deduplication
* pagination state
* repeated cursor detection
* manifest state
* resume logic
* incremental logic

### Integration tests

Use real public TikTok data where legally and technically appropriate.

Test:

```text
single public video
```

and:

```text
public profile --limit 5
```

Verify that actual files are created.

Do NOT create fake success tests that merely mock the entire acquisition layer.

---

# 27. REAL-WORLD VALIDATION

Before declaring the project complete, actually run:

### Test 1

One public TikTok video.

Verify:

```text
video.mp4 exists
thumbnail.jpg exists
metadata.json exists
technical.json exists
comments.json exists OR explicitly reports unavailable
manifest.json exists
```

### Test 2

A public TikTok profile:

```bash
--limit 5
```

Verify:

* profile resolved
* videos discovered
* multiple videos downloaded
* manifests generated

### Test 3

Interrupt a profile crawl.

Restart it.

Verify already completed videos are skipped/resumed rather than unnecessarily re-downloaded.

### Test 4

Run again without `--force`.

Verify incremental behavior.

### Test 5

Run:

```bash
--refresh-comments
```

Verify only comments are refreshed.

---

# 28. IMPORTANT: DO NOT FAKE CAPABILITIES

If TikTok currently blocks a capability:

DO NOT:

* invent an endpoint
* invent a response structure
* hard-code example data
* claim comments work when they do not
* claim profile pagination works when it does not
* claim video downloads work when they have not been tested

Instead report:

```text
CAPABILITY
STATUS
CURRENT METHOD
LIMITATION
POSSIBLE FUTURE APPROACH
```

For example:

```text
Comments
STATUS: unavailable
REASON: TikTok currently requires restricted access for this endpoint
```

The system should degrade gracefully.

---

# 29. ANTI-BOT / RATE LIMITING

Do NOT attempt to bypass:

* CAPTCHA
* authentication
* access controls
* account restrictions
* security protections

If requests are rate-limited:

* respect the response
* back off
* retry according to policy
* slow down
* report the limitation

The crawler should prioritize reliability and respectful request behavior over aggressive scraping.

---

# 30. NO AI PROCESSING

This project is ONLY acquisition.

Do NOT implement:

* ASR
* Whisper
* OCR
* computer vision
* embeddings
* vector database
* RAG
* reranking
* LLM
* sentiment analysis
* topic classification
* viral score
* trend detection
* AI summarization

Those belong to a later processing pipeline.

The output of this project is the raw structured dataset.

---

# 31. DATASET DESIGN

The crawler should produce data suitable for a later multimodal processing pipeline.

Future pipeline:

```text
TikTok crawler
      ↓
raw dataset
      ↓
ASR
      ↓
OCR
      ↓
visual extraction
      ↓
temporal segmentation
      ↓
embeddings
      ↓
vector index
      ↓
trend detection
      ↓
viral scoring
      ↓
AI reasoning
```

Therefore preserve:

* original video
* original thumbnail
* metadata
* engagement
* timestamps
* comments
* stable IDs
* source URLs
* hashes
* technical metadata
* crawl timestamps

Do not prematurely transform or discard source information.

---

# 32. SECURITY / PRIVACY

Never commit:

```text
.env
cookies
session files
authentication tokens
```

Add:

```gitignore
node_modules/
dist/
.env
data/
*.part
playwright-report/
test-results/
```

---

# 33. README

Create a complete README explaining:

1. prerequisites
2. installation
3. ffmpeg/ffprobe installation
4. Playwright installation if required
5. environment variables
6. single-video crawling
7. profile crawling
8. resume behavior
9. incremental crawling
10. comments
11. rate limiting
12. architecture
13. known TikTok limitations
14. how acquisition works
15. how to troubleshoot failures

Most importantly, explicitly state that the crawler does **not** depend on TikWM or another third-party TikTok scraping service.

---

# 34. FINAL ENGINEERING REQUIREMENT

The most important architectural rule is:

```text
TikTok-specific acquisition
        ↓
normalized internal data
        ↓
storage
        ↓
crawler orchestration
```

Do not scatter TikTok-specific selectors, endpoints, response parsing, or browser logic throughout the application.

If TikTok changes its web implementation, I should ideally only need to modify:

```text
src/acquisition/tiktok/
```

rather than the entire crawler.

---

# 35. FINAL DELIVERABLE

When finished, report:

```text
PROJECT STATUS

Architecture:
...

Acquisition method:
...

Video acquisition:
PASS / FAIL

Metadata:
PASS / FAIL

Thumbnail:
PASS / FAIL

FFprobe:
PASS / FAIL

Comments:
PASS / FAIL / UNAVAILABLE

Profile crawling:
PASS / FAIL

Pagination:
PASS / FAIL

Resume:
PASS / FAIL

Incremental:
PASS / FAIL

Short URLs:
PASS / FAIL

Real-world test:
PASS / FAIL

Known limitations:
...

Files created:
...
```

Do not say "complete" unless you actually ran the relevant tests.

The final result must be a **real independent TikTok crawler**, not a wrapper around TikWM or another scraping API.

