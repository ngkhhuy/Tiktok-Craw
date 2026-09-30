Bạn là một Senior Backend/AI Engineer. Hãy xây dựng cho tôi một hệ thống **TikTok Analytics RAG / Q&A** có khả năng trả lời câu hỏi và phân tích dữ liệu từ dataset TikTok mà tôi **đã crawl sẵn**.

## 1. MỤC TIÊU

Tôi đã có dữ liệu TikTok được crawler thu thập, bao gồm tối thiểu:

* Video
* Video URL / TikTok Video ID
* Creator / Author
* Caption / Description
* Hashtags
* Views
* Likes / Hearts
* Comments
* Shares / Forwards
* Comment content
* Comment likes
* Comment replies nếu có
* Published time nếu có
* Crawl time
* Một số metadata khác tùy dữ liệu thực tế

Tôi muốn xây dựng hệ thống cho phép người dùng hỏi bằng ngôn ngữ tự nhiên, ví dụ:

### Metric questions

* "Video này có bao nhiêu view?"
* "Video này có bao nhiêu like?"
* "Tỷ lệ share của video này là bao nhiêu?"
* "Engagement rate của video này là bao nhiêu?"
* "Video nào có nhiều share nhất?"
* "Top 10 video có engagement rate cao nhất?"
* "Creator nào có tổng view cao nhất?"
* "Trung bình mỗi video có bao nhiêu lượt like?"

### Comparison

* "Video này có performance tốt hơn trung bình không?"
* "Video A và video B khác nhau như thế nào?"
* "Video này có share rate cao hơn các video khác không?"
* "Video này nằm top bao nhiêu % trong dataset?"

### Aggregation

* "Tổng view của tất cả video là bao nhiêu?"
* "Trong tháng này có bao nhiêu video?"
* "Tổng likes của creator X là bao nhiêu?"
* "Trung bình share mỗi video của creator X?"
* "Top 5 creator theo tổng engagement?"

### Semantic / comment analysis

* "Người xem đang nói gì về video này?"
* "Các comment phổ biến nhất đang đề cập đến vấn đề gì?"
* "Có nhiều người thích sản phẩm này không?"
* "Người xem phản ứng tích cực hay tiêu cực với video?"
* "Có comment nào nhắc đến giá không?"
* "Tìm các comment nói về chất lượng sản phẩm."

### Hybrid analytical questions

Ví dụ:

> "Tại sao video này có nhiều share?"

Hệ thống phải kết hợp:

1. Metrics của video
2. Metrics derived
3. So sánh với baseline
4. Percentile/ranking
5. Comment semantic retrieval
6. Các evidence liên quan
7. Sau đó mới gửi context cho External LLM để suy luận và giải thích.

---

# 2. KIẾN TRÚC TỔNG QUAN

Thiết kế hệ thống theo pipeline:

```text
                    TikTok Crawler
                         │
                         ▼
                  Raw TikTok Data
                         │
                         ▼
                  Data Normalization
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       Structured Database       Vector Database
             │                       │
             ▼                       ▼
      Analytics Engine        Semantic Retrieval
             │                       │
             └───────────┬───────────┘
                         ▼
                  Query Understanding
                         │
                         ▼
                    Query Planning
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       Metric Retrieval       Semantic Retrieval
             │                       │
             └───────────┬───────────┘
                         ▼
                   Context Assembly
                         │
                         ▼
                External LLM API
                         │
                         ▼
                    Final Answer
```

### Nguyên tắc quan trọng

**Database = Source of Truth**

**Analytics Engine = tính toán deterministic**

**RAG = tìm evidence**

**External LLM = reasoning + explanation**

External LLM KHÔNG được trực tiếp truy cập database.

External LLM KHÔNG được tự quyết định số liệu quan trọng nếu backend có thể tính chính xác.

External LLM chỉ nhận context/evidence đã được backend chuẩn bị.

---

# 3. TRƯỚC KHI CODE

Đầu tiên hãy **inspect toàn bộ project hiện tại**.

Không được tự ý giả định schema crawler.

Hãy kiểm tra:

* package.json
* source code
* crawler output
* JSON/CSV/database hiện tại
* cấu trúc folder
* các model/schema hiện có
* cách lưu video
* cách lưu comments
* cách lưu metrics
* timestamp
* ID
* duplicate handling

Sau đó tạo một báo cáo ngắn:

```text
Current architecture:
...

Current data format:
...

Existing entities:
...

Existing fields:
...

Existing database:
...

Existing crawler:
...

Recommended integration:
...
```

### Quy tắc

Không rewrite crawler nếu không cần thiết.

Không thay đổi data format hiện tại một cách phá vỡ backward compatibility.

Nếu đã có database thì ưu tiên integrate vào database hiện tại.

Nếu dữ liệu chỉ đang nằm ở JSON/CSV thì xây ingestion pipeline từ dữ liệu đó.

---

# 4. DATA MODEL

Thiết kế structured storage để analytics chính xác.

Có thể dùng PostgreSQL nếu project hiện tại chưa có database phù hợp.

Nếu sử dụng PostgreSQL, có thể dùng:

* PostgreSQL
* pgvector
* Prisma / Drizzle / tương đương

Nhưng trước tiên phải inspect project và chọn stack phù hợp với codebase hiện tại.

---

# 5. VIDEO ENTITY

Video cần lưu tối thiểu:

```text
id
platform
platform_video_id
url
canonical_url

creator_id
creator_username
creator_display_name

caption
description

published_at

views
likes
comments_count
shares

crawled_at
updated_at
```

Nếu crawler có thêm metadata thì giữ lại.

Không được làm mất raw information.

---

# 6. CREATOR ENTITY

Nếu dữ liệu có creator:

```text
creator_id
platform
platform_creator_id
username
display_name
profile_url
```

Quan hệ:

```text
Creator
   │
   └── Videos
```

---

# 7. COMMENTS

Comment schema cần hỗ trợ:

```text
id
platform_comment_id
video_id
parent_comment_id

author_id
author_username

text

like_count

published_at
crawled_at

is_reply
```

Nếu comment là reply:

```text
parent_comment_id != null
```

Giữ quan hệ parent-child.

---

# 8. CRAWL SNAPSHOT

Nếu crawler có thể crawl cùng một video nhiều lần, hãy thiết kế để future-proof.

Không nên overwrite hoàn toàn historical metrics.

Ví dụ:

```text
video
video_metric_snapshot
```

Snapshot:

```text
video_id
views
likes
comments
shares
captured_at
```

Điều này cho phép sau này hỏi:

* view tăng bao nhiêu?
* tốc độ tăng view?
* engagement thay đổi thế nào?
* video performance theo thời gian?

Nếu dataset hiện tại chỉ có một snapshot thì vẫn thiết kế schema có khả năng mở rộng.

---

# 9. DERIVED METRICS

Tất cả metric calculation phải nằm trong Analytics Engine.

Không để LLM tự tính.

Tối thiểu:

### Like rate

```text
like_rate = likes / views
```

### Comment rate

```text
comment_rate = comments / views
```

### Share rate

```text
share_rate = shares / views
```

### Engagement rate

```text
engagement_rate =
(likes + comments + shares) / views
```

Nếu views = 0:

```text
return null
```

Không chia cho 0.

---

# 10. METRIC DEFINITIONS

Tạo một centralized metric definition layer.

Ví dụ:

```typescript
MetricDefinition {
  name
  description
  formula
  requiredFields
}
```

Ví dụ:

```text
share_rate
= shares / views

like_rate
= likes / views

engagement_rate
= (likes + comments + shares) / views
```

Mục đích là tránh việc mỗi module hiểu metric theo một cách khác nhau.

---

# 11. BASELINE

Một vấn đề rất quan trọng:

Không được trả lời:

> "Video này có performance cao."

nếu chưa xác định "cao so với cái gì".

Phải xác định comparison population.

Ví dụ:

```text
all videos
same creator
same hashtag
same time period
same content category
same dataset
```

Ví dụ:

```text
Video X
share_rate = 2.4%

Dataset median:
share_rate = 0.8%

Dataset p90:
share_rate = 2.1%
```

Backend có thể kết luận factual:

```text
share_rate của video X nằm trên p90 của dataset.
```

LLM chỉ giải thích:

```text
Điều này cho thấy video có mức share rate tương đối cao
so với population được chọn...
```

Không được tự chọn population một cách mơ hồ.

---

# 12. ANALYTICS ENGINE

Xây một Analytics Engine độc lập.

Hỗ trợ:

```text
COUNT
SUM
AVG
MEDIAN
MIN
MAX
PERCENTILE
RANK
RATIO
DISTRIBUTION
```

Ví dụ:

```typescript
AnalyticsEngine.getVideoMetrics(videoId)

AnalyticsEngine.compareVideos(videoA, videoB)

AnalyticsEngine.getRanking(metric, filters)

AnalyticsEngine.getAggregate(metric, filters)

AnalyticsEngine.getPercentile(videoId, metric, population)

AnalyticsEngine.getDistribution(metric, filters)
```

Tất cả kết quả phải deterministic.

---

# 13. QUERY UNDERSTANDING

Người dùng hỏi bằng natural language.

Ví dụ:

```text
"Video này có bao nhiêu share?"
```

Hệ thống cần parse thành structured intent.

Ví dụ:

```json
{
  "intent": "VIDEO_METRIC",
  "metric": "shares",
  "entity": {
    "type": "video",
    "id": "..."
  }
}
```

---

# 14. INTENTS

Tối thiểu hỗ trợ:

```text
VIDEO_METRIC
VIDEO_OVERVIEW
RANKING
COMPARISON
AGGREGATION
PERCENTILE
COMMENT_ANALYSIS
SEMANTIC_SEARCH
HYBRID_ANALYSIS
```

Ví dụ:

### VIDEO_METRIC

```text
"Video này có bao nhiêu like?"
```

### RANKING

```text
"Top 10 video theo shares?"
```

### COMPARISON

```text
"Video A hay B có share rate cao hơn?"
```

### AGGREGATION

```text
"Tổng views của creator X?"
```

### PERCENTILE

```text
"Video này nằm top bao nhiêu %?"
```

### COMMENT_ANALYSIS

```text
"Người xem đang nói gì về video này?"
```

### SEMANTIC_SEARCH

```text
"Tìm comment nói về giá."
```

### HYBRID_ANALYSIS

```text
"Tại sao video này có nhiều share?"
```

---

# 15. QUERY PLAN

Không cho LLM generate SQL tự do.

Thay vào đó tạo structured Query Plan.

Ví dụ:

```json
{
  "intent": "HYBRID_ANALYSIS",
  "entity": {
    "type": "video",
    "id": "video_123"
  },
  "operations": [
    {
      "type": "GET_METRICS"
    },
    {
      "type": "CALCULATE_DERIVED_METRICS"
    },
    {
      "type": "CALCULATE_PERCENTILE",
      "metric": "share_rate"
    },
    {
      "type": "RETRIEVE_COMMENTS",
      "query": "reasons people share this video"
    }
  ]
}
```

Validate Query Plan bằng schema validation.

Có thể dùng Zod nếu TypeScript.

Không execute arbitrary SQL từ LLM.

---

# 16. ENTITY RESOLUTION

Hệ thống phải resolve:

```text
video URL
TikTok video ID
creator username
creator ID
```

Ví dụ:

```text
https://www.tiktok.com/@abc/video/123456
```

→

```text
video_id = 123456
```

Nếu user nói:

> "video này"

thì phải lấy `current_video_id` từ conversation context.

---

# 17. CONVERSATION CONTEXT

Không dựa hoàn toàn vào LLM memory.

Lưu structured context:

```json
{
  "current_video_id": "...",
  "current_creator_id": "...",
  "last_metric": "share_rate",
  "last_population": "all_videos"
}
```

Ví dụ:

User:

> Video này có bao nhiêu share?

Assistant:

> 12,340 shares.

User:

> Còn share rate?

System phải hiểu:

```text
current_video_id = video trước đó
metric = share_rate
```

---

# 18. VECTOR DATABASE

RAG không dùng vector DB để thay thế structured database.

Structured DB dùng cho:

```text
views
likes
comments count
shares
dates
ranking
aggregation
percentiles
```

Vector DB dùng cho:

```text
semantic search
comments
caption
hashtags
textual video information
```

---

# 19. EMBEDDINGS

Ban đầu embed:

### Video

```text
caption
description
hashtags
creator metadata nếu phù hợp
```

### Comment

```text
comment text
```

Không giả vờ rằng đây là "video embedding".

Hiện tại chưa cần:

```text
visual embedding
video frame embedding
audio embedding
ASR embedding
OCR embedding
```

Có thể thiết kế interface để thêm sau.

---

# 20. VECTOR RECORD

Ví dụ:

```json
{
  "id": "comment_123",
  "type": "comment",
  "video_id": "video_123",
  "text": "Sản phẩm này dùng rất ổn",
  "embedding": [...]
}
```

Video:

```json
{
  "id": "video_123",
  "type": "video",
  "caption": "...",
  "embedding": [...]
}
```

---

# 21. SEMANTIC RETRIEVAL

Hỗ trợ:

```text
query embedding
top_k
similarity threshold
metadata filtering
```

Ví dụ:

```text
query:
"comment nói về chất lượng sản phẩm"

filter:
video_id = video_123

top_k:
20
```

---

# 22. COMMENT RETRIEVAL

Comment retrieval cần hỗ trợ:

```text
video_id
creator_id
date range
minimum like_count
semantic similarity
```

Ví dụ:

```text
"Người xem nói gì về giá?"
```

→ semantic search trên comments.

Không chỉ search keyword `"giá"`.

---

# 23. DIVERSITY

Nếu có nhiều comment gần giống nhau:

```text
"Sản phẩm tốt"
"Xài rất tốt"
"Chất lượng tốt"
"Tốt quá"
```

Không nên trả cả 20 comment tương tự nhau.

Có thể dùng:

```text
MMR
diversity filtering
clustering
```

để lấy các evidence đa dạng hơn.

---

# 24. HYBRID ANALYSIS

Đây là phần quan trọng nhất.

Ví dụ user hỏi:

> "Tại sao video này có nhiều share?"

Không được chỉ search vector.

Pipeline:

```text
Question
   ↓
Resolve Video
   ↓
Get Raw Metrics
   ↓
Calculate Derived Metrics
   ↓
Calculate Baseline
   ↓
Calculate Percentile / Rank
   ↓
Retrieve Relevant Comments
   ↓
Retrieve Similar Videos nếu cần
   ↓
Build Evidence
   ↓
External LLM API
   ↓
Answer
```

---

# 25. EVIDENCE OBJECT

Tạo một format thống nhất:

```json
{
  "video": {
    "id": "...",
    "caption": "...",
    "creator": "..."
  },

  "metrics": {
    "views": 100000,
    "likes": 12000,
    "comments": 500,
    "shares": 8000
  },

  "derived_metrics": {
    "like_rate": 0.12,
    "comment_rate": 0.005,
    "share_rate": 0.08,
    "engagement_rate": 0.205
  },

  "benchmark": {
    "population": "all_videos",
    "median_share_rate": 0.012,
    "p90_share_rate": 0.041,
    "percentile": 96.3
  },

  "comments": [
    {
      "id": "comment_1",
      "text": "...",
      "like_count": 123
    }
  ]
}
```

---

# 26. EVIDENCE-FIRST

External LLM chỉ được sử dụng những evidence backend cung cấp.

Prompt cho LLM phải yêu cầu:

```text
Do not invent metrics.
Do not invent comments.
Do not invent video IDs.
Do not invent statistics.
Do not claim causality when evidence only supports correlation or inference.
Clearly distinguish:
- observed facts
- calculated metrics
- benchmark comparisons
- inferred explanations
```

Ví dụ:

Không nói:

> "Video này viral vì người xem thích nội dung."

nếu không có evidence.

Có thể nói:

> "Video có share rate 8%, cao hơn p90 của dataset là 4.1%. Một số comment được retrieve cũng cho thấy nhiều người đề cập đến việc chia sẻ video cho bạn bè. Đây là các dấu hiệu có thể góp phần giải thích mức share cao, nhưng không chứng minh quan hệ nhân quả."

---

# 27. EXTERNAL LLM API

**Tôi đã có External LLM API để thực hiện reasoning/analysis.**

Không implement local LLM.

Không implement model serving.

Không implement Ollama.

Không implement inference server.

Chỉ xây abstraction:

```typescript
interface LLMClient {
  generate(request: LLMRequest): Promise<LLMResponse>
}
```

Ví dụ:

```typescript
interface LLMRequest {
  systemPrompt: string
  userPrompt: string
  context: EvidenceContext
}
```

Config thông qua environment:

```env
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

Không hardcode API key.

---

# 28. LLM ROLE

LLM chịu trách nhiệm:

```text
understand evidence
reason over evidence
summarize
explain
answer natural language
```

LLM KHÔNG chịu trách nhiệm:

```text
database querying
arbitrary SQL
metric calculation
ranking calculation
percentile calculation
data validation
entity resolution
```

Backend phải làm các phần deterministic đó.

---

# 29. CONTEXT ASSEMBLY

Trước khi gọi LLM, tạo Context Builder.

```typescript
ContextBuilder.build({
  question,
  video,
  metrics,
  analytics,
  retrievedComments,
  retrievedVideos
})
```

Output:

```text
SYSTEM INSTRUCTIONS

USER QUESTION

VIDEO INFORMATION

METRICS

DERIVED METRICS

BENCHMARK

RETRIEVED COMMENTS

RETRIEVED VIDEOS

EVIDENCE IDs
```

Không gửi toàn bộ database vào LLM.

Chỉ gửi relevant evidence.

---

# 30. TOKEN / CONTEXT CONTROL

Context Builder phải:

```text
deduplicate
truncate
rank evidence
limit comments
limit similar videos
```

Ví dụ:

```text
Top 10 comments
Top 5 similar videos
Required metrics
Required benchmark
```

Nếu context quá lớn:

```text
prioritize structured metrics
prioritize highly relevant comments
remove duplicate evidence
```

---

# 31. CITATIONS / SOURCES

Final answer nên có source references.

Ví dụ:

```json
{
  "source": {
    "type": "video",
    "id": "video_123"
  }
}
```

Hoặc:

```text
video:123
comment:456
analytics:query_789
```

Mục tiêu là có thể trace:

```text
Answer
   ↓
Evidence
   ↓
Database record
```

---

# 32. API

Tạo endpoint:

```http
POST /api/rag/query
```

Request:

```json
{
  "question": "Tại sao video này có nhiều share?",
  "video_id": "optional",
  "conversation_id": "optional"
}
```

Response:

```json
{
  "answer": "...",

  "intent": "HYBRID_ANALYSIS",

  "entities": {
    "video_id": "..."
  },

  "metrics": {},

  "sources": [],

  "debug": {}
}
```

---

# 33. DEBUG MODE

Có debug mode:

```json
{
  "debug": {
    "intent": "...",
    "query_plan": {},
    "resolved_entities": {},
    "analytics_operations": [],
    "retrieved_comments": [],
    "retrieved_videos": [],
    "context_size": 12345,
    "llm_latency_ms": 1200,
    "total_latency_ms": 1800
  }
}
```

Debug mode chỉ bật khi:

```env
RAG_DEBUG=true
```

Không expose sensitive information trong production.

---

# 34. ERROR HANDLING

Phải xử lý:

```text
video không tồn tại
video ID không hợp lệ
không đủ dữ liệu
views = 0
comments = 0
missing shares
missing published_at
LLM API timeout
LLM API error
embedding API error
vector DB unavailable
database unavailable
ambiguous video
```

Ví dụ:

Nếu user hỏi:

> "Video này có share rate bao nhiêu?"

nhưng views = 0:

Không trả:

```text
0%
```

Phải trả:

```text
Không thể tính share rate vì video chưa có dữ liệu lượt xem hợp lệ.
```

---

# 35. RETRY / TIMEOUT

External LLM API cần:

```text
timeout
retry
exponential backoff
```

Nhưng phải tránh duplicate side effects nếu provider có behavior đặc biệt.

Ví dụ:

```text
timeout: 30s
retry: 2-3
backoff: exponential
```

Các config phải nằm trong environment/config.

---

# 36. INGESTION PIPELINE

Xây ingestion từ crawler data hiện tại.

Pipeline:

```text
Raw crawler data
      ↓
Validation
      ↓
Normalization
      ↓
Deduplication
      ↓
Database upsert
      ↓
Embedding generation
      ↓
Vector upsert
```

Phải idempotent.

Chạy ingestion nhiều lần không được tạo duplicate.

---

# 37. DEDUPLICATION

Ưu tiên identifier:

```text
platform_video_id
platform_comment_id
```

Nếu không có:

```text
canonical URL
hash
composite key
```

Không duplicate comment/video khi re-run crawler ingestion.

---

# 38. EMBEDDING PIPELINE

Embedding generation phải tách khỏi crawler.

Ví dụ:

```text
crawler
  ↓
raw data

ingestion
  ↓
structured DB

embedding worker
  ↓
vector DB
```

Không block toàn bộ ingestion nếu embedding provider tạm thời unavailable.

Có trạng thái:

```text
pending
processing
completed
failed
```

---

# 39. FUTURE EXTENSIBILITY

Hiện tại KHÔNG implement:

```text
ASR
OCR
Vision
video frame analysis
audio analysis
visual embeddings
temporal video segments
```

Nhưng architecture phải cho phép thêm sau.

Ví dụ:

```text
ContentEvidence
├── text
├── comment
├── transcript
├── OCR
├── visual
└── audio
```

Sau này có thể thêm:

```text
"What happens at 00:15?"
"What text appears on screen?"
"What is the person doing?"
```

Nhưng hiện tại chỉ implement text/comments/metrics.

---

# 40. QUERY EXAMPLES PHẢI PASS

Sau khi implement, tạo test cases.

## Test 1

```text
Video này có bao nhiêu view?
```

Expected:

```text
GET views
```

## Test 2

```text
Share rate của video này là bao nhiêu?
```

Expected:

```text
shares / views
```

## Test 3

```text
Top 10 video có nhiều share nhất?
```

Expected:

```text
ORDER BY shares DESC
LIMIT 10
```

## Test 4

```text
Video này nằm top bao nhiêu %?
```

Expected:

```text
defined population
percentile
```

## Test 5

```text
Người xem đang nói gì về video này?
```

Expected:

```text
semantic comment retrieval
+
LLM summarization
```

## Test 6

```text
Tại sao video này có nhiều share?
```

Expected:

```text
metrics
+
benchmark
+
semantic comments
+
LLM reasoning
```

## Test 7

```text
Comment nào nói về giá?
```

Expected:

```text
semantic retrieval
```

## Test 8

```text
Creator này có tổng bao nhiêu view?
```

Expected:

```text
SUM(video.views)
WHERE creator_id = ...
```

---

# 41. NUMERICAL CORRECTNESS

Đây là requirement rất quan trọng.

Ví dụ database:

```text
views = 100000
likes = 10000
comments = 500
shares = 2500
```

Backend phải tính:

```text
like_rate = 10%
comment_rate = 0.5%
share_rate = 2.5%
engagement_rate = 13%
```

LLM không được tự tính lại theo cách khác.

LLM nhận:

```json
{
  "like_rate": 0.10,
  "comment_rate": 0.005,
  "share_rate": 0.025,
  "engagement_rate": 0.13
}
```

và chỉ giải thích.

---

# 42. NO HALLUCINATION

Nếu database không có dữ liệu:

Không được tự tạo.

Ví dụ:

```text
User:
Video này có bao nhiêu người xem đến cuối?

Database:
Không có completion rate.
```

Response:

```text
Dataset hiện tại không có dữ liệu completion rate nên chưa thể xác định.
```

Không được suy đoán.

---

# 43. CAUSALITY

Đặc biệt với câu hỏi:

```text
"Tại sao?"
```

Không được biến correlation thành causation.

Backend/LLM phải dùng wording như:

```text
có thể liên quan
có dấu hiệu
một yếu tố có khả năng góp phần
dựa trên các evidence hiện có
```

nếu evidence chưa đủ chứng minh causal relationship.

---

# 44. PERFORMANCE

Không query toàn bộ database cho mỗi request.

Tối ưu:

```text
indexes
pagination
limit
aggregation
cached analytics nếu cần
vector filtering
```

Index tối thiểu:

```text
platform_video_id
creator_id
published_at
views
likes
shares
video_id
comment video_id
comment published_at
```

Nếu PostgreSQL + pgvector:

```text
appropriate vector index
```

chỉ khi dataset đủ lớn để cần.

Đừng over-engineer index ngay từ đầu.

---

# 45. ARCHITECTURE

Tách module rõ ràng.

Ví dụ:

```text
src/
├── ingestion/
├── database/
├── models/
├── analytics/
├── embeddings/
├── vector/
├── retrieval/
├── query-understanding/
├── query-planner/
├── entity-resolution/
├── context/
├── llm/
├── rag/
├── api/
├── conversation/
├── evaluation/
└── utils/
```

Có thể điều chỉnh theo architecture hiện tại.

Không ép structure này nếu project đã có convention tốt hơn.

---

# 46. SEPARATION OF CONCERNS

Không để:

```text
controller
```

tự query DB + calculate metrics + call LLM.

Pipeline nên rõ:

```text
Controller
   ↓
RAG Service
   ↓
Query Understanding
   ↓
Query Planner
   ↓
Entity Resolver
   ↓
Analytics / Retrieval
   ↓
Context Builder
   ↓
External LLM Client
   ↓
Response Formatter
```

---

# 47. LOGGING

Log:

```text
request_id
conversation_id
question
intent
resolved video
query execution time
retrieval time
LLM latency
total latency
error
```

Không log:

```text
API keys
secrets
sensitive credentials
```

---

# 48. OBSERVABILITY

Tạo metrics cơ bản:

```text
total_queries
queries_by_intent
average_latency
LLM_latency
retrieval_latency
database_latency
error_rate
embedding_failures
```

---

# 49. TESTING

Tạo unit tests cho:

```text
metric calculations
percentile
ranking
entity resolution
query planner
context builder
deduplication
```

Integration tests:

```text
database
vector retrieval
RAG pipeline
LLM adapter
```

LLM integration nên mock trong automated tests.

---

# 50. EVALUATION DATASET

Tạo ít nhất 20–30 câu hỏi.

Phân nhóm:

```text
5 direct metrics
5 derived metrics
5 ranking/comparison
5 aggregation
5 semantic retrieval
5 hybrid analysis
```

Mỗi câu cần expected behavior.

Ví dụ:

```json
{
  "question": "Share rate của video X là bao nhiêu?",
  "expected_intent": "VIDEO_METRIC",
  "expected_metric": "share_rate"
}
```

---

# 51. RESPONSE FORMAT

Final answer nên có cấu trúc rõ ràng.

Ví dụ:

```text
Video này có 120,000 views và 8,400 shares.

Share rate:
7.0%

So với dataset:
Median: 1.2%
P90: 4.1%
Percentile: 96.3%

Một số evidence từ comments:
- ...
- ...
- ...

Nhận định:
...
```

Nhưng không bắt buộc mọi query đều phải hiển thị toàn bộ section.

Response phải adaptive theo loại câu hỏi.

---

# 52. KHÔNG OVER-ENGINEER

Không tự thêm:

```text
Kafka
Kubernetes
microservices
Airflow
agent framework
multi-agent
event bus
```

trừ khi project hiện tại thực sự cần.

Mục tiêu là xây một hệ thống:

```text
simple
modular
testable
scalable
maintainable
```

---

# 53. IMPLEMENTATION STRATEGY

Thực hiện theo phase.

## Phase 1 — Inspect

Inspect project + dataset.

Không code ngay.

## Phase 2 — Data Layer

Chuẩn hóa database.

## Phase 3 — Analytics

Implement:

```text
metrics
derived metrics
ranking
aggregation
percentile
comparison
```

## Phase 4 — Embeddings

Implement:

```text
embedding generation
vector storage
semantic retrieval
```

## Phase 5 — Query Understanding

Implement:

```text
intent
entities
filters
query plan
```

## Phase 6 — Hybrid Retrieval

Kết hợp:

```text
structured analytics
+
semantic retrieval
```

## Phase 7 — External LLM

Implement:

```text
LLM adapter
context builder
evidence prompt
response parser
```

## Phase 8 — Conversation

Implement:

```text
current video
conversation context
follow-up questions
```

## Phase 9 — Evaluation

Build evaluation dataset + tests.

---

# 54. IMPORTANT ARCHITECTURAL RULE

Luôn giữ flow:

```text
USER QUESTION
      ↓
QUERY UNDERSTANDING
      ↓
QUERY PLAN
      ↓
STRUCTURED ANALYTICS / RETRIEVAL
      ↓
EVIDENCE
      ↓
CONTEXT BUILDER
      ↓
EXTERNAL LLM
      ↓
FINAL ANSWER
```

Không làm:

```text
USER
 ↓
LLM
 ↓
LLM tự query database
 ↓
LLM tự tính toán
```

---

# 55. DELIVERABLES

Sau khi implement hãy cung cấp:

### 1. Architecture

Giải thích architecture thực tế đã triển khai.

### 2. Database schema

Tất cả tables/models.

### 3. API

Document:

```text
POST /api/rag/query
```

### 4. Query pipeline

Giải thích từ question → answer.

### 5. Analytics engine

Danh sách metrics + formulas.

### 6. Retrieval

Structured retrieval + semantic retrieval.

### 7. External LLM integration

LLM client + config.

### 8. Example queries

Ít nhất 20 examples.

### 9. Tests

Unit + integration tests.

### 10. README

Hướng dẫn:

```text
setup
environment variables
database migration
ingestion
embedding generation
start server
API usage
testing
debugging
```

---

# 56. ENVIRONMENT VARIABLES

Không hardcode credentials.

Ví dụ:

```env
DATABASE_URL=

VECTOR_DATABASE_URL=

LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=

EMBEDDING_API_KEY=
EMBEDDING_MODEL=

RAG_DEBUG=false
```

Nếu embedding cũng đang dùng provider khác thì adapt theo project.

---

# 57. FINAL REQUIREMENT

Trước khi hoàn thành hãy kiểm tra:

* [ ] Existing crawler data được giữ nguyên
* [ ] Ingestion idempotent
* [ ] Duplicate video không xảy ra
* [ ] Duplicate comment không xảy ra
* [ ] Metrics deterministic
* [ ] Derived metrics chính xác
* [ ] Division by zero được xử lý
* [ ] Ranking chính xác
* [ ] Percentile chính xác
* [ ] Baseline population rõ ràng
* [ ] Semantic retrieval hoạt động
* [ ] Comment retrieval hoạt động
* [ ] Hybrid retrieval hoạt động
* [ ] Entity resolution hoạt động
* [ ] Conversation context hoạt động
* [ ] External LLM API hoạt động
* [ ] LLM không truy cập DB trực tiếp
* [ ] LLM không tự tính metric quan trọng
* [ ] Evidence được traceable
* [ ] Không hallucinate data
* [ ] Không claim causal relationship khi không đủ evidence
* [ ] Timeout/retry cho external API
* [ ] Debug mode
* [ ] Unit tests
* [ ] Integration tests
* [ ] Evaluation dataset
* [ ] README hoàn chỉnh

## Quan trọng nhất

**Hãy ưu tiên tính đúng của analytics hơn khả năng "nói hay" của LLM.**

Hệ thống này trước hết phải trả lời đúng:

```text
WHAT happened?
HOW MUCH?
HOW MANY?
HOW DOES IT COMPARE?
WHERE DOES IT RANK?
```

Sau đó mới dùng External LLM để trả lời:

```text
WHAT MIGHT EXPLAIN IT?
WHAT PATTERNS ARE PRESENT?
WHAT DO USERS SEEM TO BE SAYING?
```

Không được để LLM tạo ra số liệu không tồn tại trong evidence.

Bắt đầu bằng việc **inspect codebase và dataset hiện tại**, sau đó đề xuất implementation plan cụ thể trước khi thay đổi code.
