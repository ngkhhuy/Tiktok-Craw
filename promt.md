Bạn hãy xây dựng một **project TikTok crawler hoàn toàn độc lập** trong thư mục hiện tại.

# 1. IMPORTANT — Project isolation

Đây là một project MỚI.

**KHÔNG liên quan đến bất kỳ project YouTube nào khác.**

Không:

* import code từ project YouTube
* đọc source code project YouTube
* reuse package/module của project YouTube
* reuse database của project YouTube
* reuse data directory của project YouTube
* tạo dependency vào project YouTube
* tạo common provider/schema với YouTube

Project phải có:

```text
TikTok Crawler
    ↓
Standalone
    ↓
Own dependencies
Own config
Own storage
Own tests
Own CLI
Own data
```

Nếu thư mục hiện tại chưa có project thì initialize project mới.

---

# 2. Goal

Xây dựng một hệ thống **TikTok Video & Profile Crawler** dùng để thu thập dataset TikTok phục vụ nghiên cứu/content intelligence.

Có 2 chức năng chính:

## Single video

```text
TikTok Video URL
       ↓
Resolve Video
       ↓
Metadata
       ↓
Full Video Download
       ↓
Thumbnail/Cover
       ↓
Technical Metadata
       ↓
Comments
       ↓
Replies
       ↓
SHA-256
       ↓
manifest.json
```

## Profile

```text
TikTok Profile URL
       ↓
Resolve Profile
       ↓
Discover Videos
       ↓
Pagination
       ↓
For each video:
    ├── Metadata
    ├── Full Video
    ├── Thumbnail
    ├── Technical Metadata
    ├── Comments
    └── Replies
       ↓
crawl-manifest.json
```

---

# 3. Technology

Ưu tiên:

```text
Node.js
JavaScript hoặc TypeScript
```

Nếu codebase mới thì **ưu tiên TypeScript** để schema rõ ràng.

Recommended:

```text
Node.js 20+
TypeScript
ESM
```

Package manager:

```text
npm
```

Nếu environment hiện tại có package manager khác thì có thể dùng package manager đó.

Dependencies tối thiểu chỉ thêm khi thực sự cần.

---

# 4. Project structure

Thiết kế standalone:

```text
tiktok-crawler/
│
├── src/
│   ├── cli/
│   │   └── index.ts
│   │
│   ├── tiktok/
│   │   ├── client.ts
│   │   ├── parser.ts
│   │   ├── video.ts
│   │   ├── profile.ts
│   │   ├── comments.ts
│   │   └── types.ts
│   │
│   ├── downloader/
│   │   ├── video.ts
│   │   ├── thumbnail.ts
│   │   └── retry.ts
│   │
│   ├── media/
│   │   ├── ffprobe.ts
│   │   └── hash.ts
│   │
│   ├── crawler/
│   │   ├── profile-crawler.ts
│   │   └── crawl-manifest.ts
│   │
│   ├── storage/
│   │   └── local-storage.ts
│   │
│   ├── config/
│   │   └── index.ts
│   │
│   └── utils/
│       ├── logger.ts
│       ├── retry.ts
│       └── concurrency.ts
│
├── tests/
│
├── data/
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

Có thể điều chỉnh structure nếu cần, nhưng phải giữ module boundaries rõ ràng.

---

# 5. TikTok URL parser

Hỗ trợ:

```text
https://www.tiktok.com/@username/video/123456789
https://www.tiktok.com/@username
https://vm.tiktok.com/...
https://vt.tiktok.com/...
```

Parser phải xác định:

```text
type:
    video
    profile
    unknown

video_id
username
url
```

Ví dụ:

```ts
parseTikTokUrl(url)
```

Return:

```ts
{
  type: "video",
  videoId: "...",
  username: "...",
  url: "..."
}
```

Short URL cần resolve redirect nếu cần.

Không crash với malformed URL.

---

# 6. TikTok acquisition strategy

Trước khi implementation:

**đánh giá cách truy cập dữ liệu TikTok hiện tại.**

Ưu tiên theo thứ tự:

1. Official TikTok API nếu dữ liệu/capability phù hợp.
2. Publicly accessible mechanisms.
3. Maintained extractor/downloader library nếu cần.
4. Browser/network extraction nếu thực sự cần và phù hợp.

Không hard-code một URL CDN lấy từ DevTools.

Không coi signed/ephemeral media URL là permanent URL.

Nếu source/API hiện tại không cung cấp một field:

```text
return null
```

Không fabricate dữ liệu.

---

# 7. Single video metadata

Implement:

```ts
getVideo(videoId)
```

Normalize thành:

```json
{
  "source": "tiktok",
  "video_id": "...",
  "url": "...",

  "author": {
    "id": "...",
    "username": "...",
    "display_name": "...",
    "avatar_url": "..."
  },

  "content": {
    "description": "...",
    "hashtags": [],
    "mentions": []
  },

  "engagement": {
    "views": 0,
    "likes": 0,
    "comments": 0,
    "shares": 0,
    "favorites": 0
  },

  "published_at": "...",

  "media": {
    "duration_ms": 0,
    "width": 0,
    "height": 0,
    "cover_url": "..."
  }
}
```

Optional fields:

```text
null
```

nếu unavailable.

Giữ raw TikTok-specific data nếu có giá trị:

```json
{
  "platform_specific": {}
}
```

Không làm mất thông tin chỉ vì schema normalize.

---

# 8. Full video download

Single video phải tải được full video.

Function:

```ts
downloadVideo(videoId, outputPath)
```

Requirements:

* stream response → file
* không load toàn bộ video vào RAM
* timeout
* retry
* validate HTTP response
* validate file size
* detect corrupt file
* calculate SHA-256
* safe temporary file
* atomic rename khi download hoàn thành

Nên dùng:

```text
video.mp4.part
        ↓
download complete
        ↓
validate
        ↓
video.mp4
```

Nếu process chết giữa chừng:

```text
*.part
```

không được coi là completed video.

---

# 9. Thumbnail / cover

Download cover image nếu available.

Output:

```text
thumbnail.jpg
```

Nếu unavailable:

```text
thumbnail status = UNAVAILABLE
```

Không fail toàn bộ video.

---

# 10. FFprobe

Nếu machine có FFprobe:

```bash
ffprobe
```

extract:

```text
duration
width
height
fps
video codec
audio codec
sample rate
channels
bitrate
container format
file size
```

Output:

```text
technical.json
```

Nếu FFprobe không tồn tại:

* báo lỗi rõ ràng
* không silently fake metadata.

---

# 11. Comments

Implement:

```ts
getComments(videoId, options)
```

Lấy comments công khai nếu acquisition method hiện tại hỗ trợ.

Normalize:

```json
{
  "comment_id": "...",
  "video_id": "...",
  "parent_comment_id": null,

  "author": {
    "id": "...",
    "username": "...",
    "display_name": "..."
  },

  "text": "...",
  "like_count": 0,
  "published_at": "...",
  "is_reply": false
}
```

Giữ:

```text
parent_comment_id
```

để reconstruct conversation.

---

# 12. Replies

Nếu TikTok source hiện tại cung cấp replies:

```text
parent_comment_id
```

phải được preserve.

Không flatten khiến mất relationship.

Output có thể flat:

```text
comment A
comment B
reply C → parent A
reply D → parent A
reply E → parent B
```

Đây là format ưu tiên vì dễ đưa vào database sau này.

---

# 13. Comment pagination

Phải hỗ trợ pagination/cursor của source đang sử dụng.

Không chỉ lấy page đầu.

Config:

```env
MAX_COMMENTS_PER_VIDEO=1000
MAX_COMMENT_PAGES=20
```

Có protection chống infinite pagination.

Deduplicate bằng:

```text
comment_id
```

Không dùng comment text làm unique key.

---

# 14. Single video output

Mỗi video:

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

Manifest:

```json
{
  "source": "tiktok",
  "video_id": "...",

  "status": "COMPLETED",

  "artifacts": {
    "video": {
      "path": "video.mp4",
      "status": "COMPLETED"
    },
    "thumbnail": {
      "path": "thumbnail.jpg",
      "status": "COMPLETED"
    },
    "metadata": {
      "path": "metadata.json",
      "status": "COMPLETED"
    },
    "technical": {
      "path": "technical.json",
      "status": "COMPLETED"
    },
    "comments": {
      "path": "comments.json",
      "status": "COMPLETED",
      "count": 0
    }
  }
}
```

---

# 15. CLI

Implement:

```bash
npm run dev -- video "<TIKTOK_VIDEO_URL>"
```

or:

```bash
npm run start -- video "<TIKTOK_VIDEO_URL>"
```

Profile:

```bash
npm run start -- profile "<TIKTOK_PROFILE_URL>"
```

Options:

```text
--limit
--concurrency
--refresh
--refresh-comments
--force
```

Example:

```bash
npm run start -- profile "https://www.tiktok.com/@username" --limit 20
```

---

# 16. Profile resolver

Implement:

```ts
resolveProfile(url)
```

Output:

```json
{
  "platform": "tiktok",
  "profile_id": "...",
  "username": "...",
  "display_name": "...",
  "avatar_url": "...",
  "profile_url": "..."
}
```

Save:

```text
data/profiles/<PROFILE_ID>/profile.json
```

---

# 17. Discover profile videos

Implement:

```ts
listProfileVideos(profileId, options)
```

Must support pagination.

Do not only fetch first page.

Output:

```text
data/profiles/<PROFILE_ID>/videos.json
```

Example:

```json
{
  "profile_id": "...",
  "username": "...",
  "fetched_at": "...",
  "total_discovered": 500,

  "videos": [
    {
      "video_id": "...",
      "url": "...",
      "published_at": "...",
      "description": "..."
    }
  ]
}
```

Do not download everything before discovering the video IDs.

Discovery and processing are separate stages.

---

# 18. Profile dataset

Final structure:

```text
data/
└── profiles/
    └── <PROFILE_ID>/
        ├── profile.json
        ├── videos.json
        ├── crawl-manifest.json
        │
        └── videos/
            ├── VIDEO_ID_1/
            │   ├── video.mp4
            │   ├── thumbnail.jpg
            │   ├── metadata.json
            │   ├── technical.json
            │   ├── comments.json
            │   └── manifest.json
            │
            ├── VIDEO_ID_2/
            └── ...
```

---

# 19. Resume / Idempotency

Nếu:

```text
1000 videos
```

và crawler chết ở:

```text
video 427
```

rerun:

```bash
npm run start -- profile "<URL>"
```

phải:

```text
completed → SKIP
incomplete → RESUME
failed → RETRY
```

Không redownload valid MP4.

Artifact validation:

```text
exists
file size > 0
manifest status
technical metadata
```

Nếu video file corrupt:

```text
delete/replace invalid file
redownload
```

---

# 20. Incremental crawl

Ngày 1:

```text
500 videos
```

Ngày 2:

```text
+20 videos
```

Rerun crawler:

```text
discover
 ↓
compare video IDs
 ↓
20 new videos → process
 ↓
500 existing → skip
```

Không reprocess toàn bộ profile.

`--refresh` mới force reprocessing.

---

# 21. Crawl manifest

```text
data/profiles/<PROFILE_ID>/crawl-manifest.json
```

Schema:

```json
{
  "platform": "tiktok",
  "profile_id": "...",

  "started_at": "...",
  "updated_at": "...",

  "stats": {
    "discovered": 500,
    "completed": 480,
    "skipped": 15,
    "failed": 5,
    "pending": 0
  },

  "videos": {
    "123456": {
      "status": "COMPLETED",
      "attempts": 1,
      "started_at": "...",
      "completed_at": "..."
    }
  }
}
```

---

# 22. Concurrency

Default local testing:

```env
TIKTOK_VIDEO_CONCURRENCY=2
TIKTOK_COMMENT_CONCURRENCY=2
```

Không dùng unlimited:

```js
Promise.all(allVideos.map(...))
```

Phải có queue/concurrency limiter.

---

# 23. Retry / Rate limiting

Implement:

```text
exponential backoff
jitter
max retries
request timeout
```

Config:

```env
MAX_RETRIES=3
REQUEST_TIMEOUT_MS=120000
TIKTOK_REQUEST_DELAY_MS=500
```

Nếu TikTok source trả về rate-limit response:

```text
429 / equivalent
```

phải backoff.

Không retry vô hạn.

---

# 24. Failure isolation

Một video lỗi không được kill toàn bộ profile crawler.

Ví dụ:

```text
100 videos

97 COMPLETED
2 SKIPPED
1 FAILED
```

Process vẫn kết thúc bình thường.

Error ghi vào manifest:

```json
{
  "status": "FAILED",
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

Không ghi credentials vào error.

---

# 25. Graceful shutdown

Ctrl+C:

```text
stop scheduling
persist crawl manifest
finish safe active tasks
exit
```

Rerun:

```text
resume
```

---

# 26. Storage abstraction

Dù hiện tại chỉ local filesystem, tạo abstraction nhỏ:

```ts
Storage
├── exists()
├── write()
├── read()
├── remove()
├── ensureDir()
└── getPath()
```

Không cần S3/MinIO.

Chỉ cần để sau này có thể thay storage.

---

# 27. Logging

Structured logs:

```text
platform=tiktok
profile_id=...
video_id=...
stage=download
status=success
duration_ms=...
```

Không log:

```text
API keys
cookies
authorization
private tokens
signed CDN URLs
```

---

# 28. Security

`.env`:

```env
TIKTOK_API_KEY=
TIKTOK_API_SECRET=
```

nếu acquisition method thực sự cần.

Không commit `.env`.

`.gitignore`:

```text
.env
data/
*.part
node_modules/
dist/
```

---

# 29. Tests

Viết tests cho:

### URL parser

```text
video URL
profile URL
short URL
invalid URL
```

### Metadata

```text
all fields
missing optional fields
unicode
emoji
```

### Comments

```text
pagination
replies
dedup
missing author
```

### Profile

```text
pagination
empty profile
new videos
existing videos
```

### Resume

```text
completed → skip
partial → resume
corrupt → redownload
```

### Incremental

```text
existing 100
new 5
→ only 5 processed
```

### Error

```text
timeout
429
5xx
invalid response
```

### Failure isolation

```text
one failed video
remaining videos continue
```

---

# 30. No AI processing

Đây là ingestion project.

KHÔNG implement:

```text
Whisper
ASR
OCR
Vision
Embeddings
Vector DB
RAG
Reranker
LLM
Sentiment
Topic extraction
Viral scoring
Trend analysis
```

Mục tiêu hiện tại chỉ là tạo raw TikTok dataset hoàn chỉnh.

---

# 31. Real local test

Sau implementation:

### Test 1 — single video

```bash
npm run start -- video "<PUBLIC_TIKTOK_VIDEO_URL>"
```

Verify:

```text
✓ video ID
✓ metadata
✓ full MP4
✓ thumbnail
✓ technical.json
✓ comments.json
✓ manifest.json
✓ SHA-256
```

### Test 2 — profile

```bash
npm run start -- profile "<PUBLIC_TIKTOK_PROFILE_URL>" --limit 10
```

Verify:

```text
✓ profile resolved
✓ videos discovered
✓ 10 videos processed
✓ full videos downloaded
✓ comments fetched where available
✓ manifests generated
```

### Test 3 — resume

Stop process giữa chừng rồi chạy lại.

Verify:

```text
completed videos → skipped
incomplete videos → resumed
```

### Test 4 — incremental

Run profile lần 2.

Verify:

```text
existing videos → skipped
new videos → processed
```

---

# 32. Important TikTok limitation

TikTok acquisition có thể phụ thuộc vào:

```text
public/private status
region
login requirements
rate limits
anti-bot mechanisms
endpoint changes
```

Không được fake hoặc hard-code response để làm test pass.

Nếu một capability không thể lấy được bằng phương thức hiện tại:

1. ghi rõ limitation
2. isolate module
3. return structured error
4. để pipeline tiếp tục các artifact khác nếu có thể

Không báo `COMPLETED` nếu dữ liệu thực tế chưa lấy được.

---

# 33. Final acceptance criteria

Project chỉ được coi là hoàn thành khi:

* [ ] Standalone project
* [ ] Không dependency vào YouTube project
* [ ] TikTok URL parser
* [ ] Single video ingestion
* [ ] Full video download
* [ ] Metadata
* [ ] Thumbnail/cover
* [ ] FFprobe
* [ ] SHA-256
* [ ] Comments
* [ ] Replies nếu source hỗ trợ
* [ ] Comment pagination
* [ ] Profile resolver
* [ ] Profile video discovery
* [ ] Pagination
* [ ] Full profile crawl
* [ ] Concurrency limit
* [ ] Retry
* [ ] Rate limiting
* [ ] Resume
* [ ] Incremental crawl
* [ ] Per-video manifest
* [ ] Profile crawl manifest
* [ ] Failure isolation
* [ ] Graceful shutdown
* [ ] Tests
* [ ] Real local test
* [ ] Không AI processing

---

# 34. Final report

Sau khi hoàn thành implementation, báo cáo:

```text
TikTok Crawler

Project:
<path>

Architecture:
...

Files created:
...

Single video:
PASS / FAIL

Profile crawler:
PASS / FAIL

Pagination:
PASS / FAIL

Full video:
PASS / FAIL

Comments:
PASS / FAIL / LIMITED

Replies:
PASS / FAIL / LIMITED

Resume:
PASS / FAIL

Incremental crawl:
PASS / FAIL

Tests:
...

Real test:
Profile:
Videos discovered:
Videos downloaded:
Comments fetched:
Failed:
Disk usage:

Known limitations:
...
```

**Không được báo PASS cho capability chưa thực sự test.**
