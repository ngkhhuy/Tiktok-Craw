Bạn hãy debug và fix **lỗi tính toán hashtag aggregation** trong hệ thống TikTok Analytics AI hiện tại.

## 1. Bug hiện tại

Tôi vừa test các query:

### Query 1

`Có bao nhiêu video trong toàn bộ dataset sử dụng hashtag #AnDo?`

Kết quả:

```text
COUNT = 10
```

→ Đúng.

### Query 2

`Tổng lượt xem của tất cả video sử dụng hashtag #AnDo là bao nhiêu?`

Kết quả:

```text
SUM(views) = 45,185,000
```

10 video được liệt kê:

```text
7547434275306523905  → 30,300,000
7548060486755962120  →  5,800,000
7548834343687359751  →  3,100,000
7549483294526557456  →  2,300,000
7224449009052699910  →  1,800,000
7501332843511991559  →  1,100,000
7496134606480018696  →    530,400
7437148621708987656  →    155,200
7546633453656116536  →    100,800
7514729720106257720  →     98,600
```

Tổng thực tế:

```text
45,185,000
```

→ Đúng.

### Query 3

`Lượt xem trung bình của tất cả video sử dụng hashtag #AnDo là bao nhiêu?`

Hệ thống trả:

```text
AVG = 4,518,960
SUM = 45,189,600
COUNT = 10
```

→ **SAI.**

Với cùng population 10 video:

```text
AVG = 45,185,000 / 10
    = 4,518,500
```

Đặc biệt, hệ thống đang sử dụng một SUM khác với SUM của query trước.

---

# 2. Mục tiêu fix

Fix để:

> **COUNT, SUM, AVG và các aggregation khác luôn sử dụng cùng một population và cùng một source of truth.**

Không được để mỗi query tự xây population hoặc tự tính lại dữ liệu theo cách khác nhau.

Nguyên tắc:

```text
Database
   ↓
Deterministic Analytics Engine
   ↓
Validated Analytics Result
   ↓
Evidence
   ↓
LLM
```

LLM **không được tự tính lại SUM/AVG/COUNT** nếu Analytics Engine đã cung cấp kết quả.

---

# 3. Kiểm tra codebase trước khi sửa

Trước tiên hãy inspect toàn bộ implementation hiện tại và tìm:

* hashtag query planner
* HASHTAG_ANALYSIS intent
* hashtag repository/service
* Analytics Engine
* aggregation logic
* COUNT / SUM / AVG implementation
* population/filter construction
* evidence builder
* LLM context builder
* các code path riêng cho:

  * `COUNT`
  * `SUM`
  * `AVG`
  * hashtag listing
  * hashtag ranking

Không sửa ngay.

Hãy xác định chính xác:

1. Query `COUNT #AnDo` lấy population từ đâu.
2. Query `SUM #AnDo` lấy population từ đâu.
3. Query `AVG #AnDo` lấy population từ đâu.
4. Tại sao SUM trả `45,185,000` nhưng AVG lại sử dụng `45,189,600`.
5. Có phải AVG đang:

   * lấy dữ liệu từ một query khác,
   * sử dụng stale/cached result,
   * lấy top-K retrieval,
   * tính từ danh sách evidence khác,
   * hoặc để LLM tự cộng lại hay không.

**Không được đoán nguyên nhân. Hãy trace code và xác định root cause trước.**

---

# 4. Population phải được tạo một lần

Thiết kế lại nếu cần để tất cả aggregation trên cùng một query dùng chung một population.

Ví dụ:

```text
Query:
"Lượt xem trung bình của tất cả video sử dụng #AnDo"

Query Plan:

{
  "intent": "HASHTAG_ANALYSIS",
  "scope": "DATASET",
  "hashtag": "#ando",
  "operation": "AVG",
  "metric": "views"
}
```

Analytics Engine phải resolve population:

```text
P = all videos where hashtag = #ando
```

Sau đó aggregation:

```text
COUNT(P)
SUM(P.views)
AVG(P.views)
```

Tất cả phải sử dụng **cùng P**.

Không được:

```text
COUNT → query A
SUM   → query B
AVG   → query C
```

nếu các query đó có khả năng tạo population khác nhau.

---

# 5. AVG phải deterministic

Nếu metric là `views`, công thức phải rõ ràng:

```text
AVG(views) = SUM(views) / COUNT(videos)
```

Với #AnDo:

```text
SUM = 45,185,000
COUNT = 10

AVG = 4,518,500
```

Không cho phép LLM tính:

```text
45,189,600 / 10
```

nếu Analytics Engine đã trả:

```text
sum = 45,185,000
count = 10
```

---

# 6. Chống Top-K contamination

Đây là một vấn đề quan trọng cần kiểm tra.

Semantic/vector retrieval hoặc UI pagination có thể chỉ trả một số video.

Ví dụ:

```text
hashtag #AnDo
→ retrieve top 10 videos
→ SUM
```

Cách này **không được dùng cho analytics aggregation**.

Aggregation phải query toàn bộ matching population trong SQLite.

Phân biệt rõ:

```text
Semantic Retrieval:
→ top_k evidence

Analytics:
→ complete population
```

Nếu database có 100 video chứa `#ando`, query:

```text
SUM(views)
AVG(views)
COUNT(videos)
```

phải chạy trên cả 100 video.

Không phụ thuộc `top_k`.

---

# 7. Chống duplicated hashtag rows

Kiểm tra schema.

Nếu database có dạng:

```text
videos
video_hashtags
```

thì phải đảm bảo một video không bị nhân bản khi JOIN.

Ví dụ:

```text
video A
#ando
#dulich
```

JOIN sai có thể khiến:

```text
video A → 2 rows
```

và SUM views bị tính 2 lần.

Analytics phải đảm bảo population là unique theo:

```text
video_id
```

Ví dụ:

```sql
SELECT DISTINCT video_id
```

hoặc aggregation trên một subquery đã deduplicate.

Đặc biệt kiểm tra trường hợp:

```text
same hashtag appears multiple times
```

hoặc duplicate records trong bảng mapping.

---

# 8. Canonical hashtag normalization

Đảm bảo:

```text
#AnDo
#ando
#ANDO
```

được normalize thống nhất, ví dụ:

```text
ando
```

Nhưng normalization không được làm mất thông tin gốc cần hiển thị.

Nên có:

```text
normalized_tag = "ando"
display_tag = "#AnDo"
```

Analytics filter sử dụng normalized value.

---

# 9. Analytics result phải có audit information

Nếu architecture hiện tại phù hợp, chuẩn hóa result theo dạng tương tự:

```typescript
interface AnalyticsResult {
  operation: string;
  metric?: string;

  population: {
    count: number;
    scope: string;
    filters: Record<string, unknown>;
  };

  aggregation?: {
    sum?: number;
    avg?: number;
    min?: number;
    max?: number;
    median?: number;
  };

  entity_ids?: string[];

  source: "sqlite";
}
```

Ví dụ query #AnDo:

```json
{
  "operation": "AVG",
  "metric": "views",
  "population": {
    "count": 10,
    "scope": "DATASET",
    "filters": {
      "hashtag": "ando"
    }
  },
  "aggregation": {
    "sum": 45185000,
    "avg": 4518500
  },
  "source": "sqlite"
}
```

Nếu không cần thay đổi interface hiện tại thì giữ architecture hiện tại, nhưng phải đảm bảo result chứa đủ thông tin để debug.

---

# 10. Evidence phải lấy từ Analytics Result

Evidence builder không được tự query lại một population khác chỉ để tạo context.

Ví dụ:

```text
Analytics Engine
→ count = 10
→ sum = 45,185,000
→ avg = 4,518,500
```

thì Evidence phải preserve đúng các giá trị này.

Không được tạo:

```text
sum = 45,189,600
```

ở một layer khác.

---

# 11. LLM không được override deterministic result

System prompt/context cho LLM cần có rule:

```text
For deterministic numeric metrics such as COUNT, SUM, AVG,
MIN, MAX, MEDIAN and PERCENTILE:

Use the Analytics Engine result as the authoritative source.
Do not recalculate or modify numeric values.
Do not infer a different population.
```

Nếu LLM thấy:

```text
count = 10
sum = 45,185,000
avg = 4,518,500
```

thì phải trả đúng các giá trị đó.

---

# 12. Viết regression tests

Bắt buộc thêm test cho case hiện tại.

### Test A

```text
Query:
Có bao nhiêu video trong toàn bộ dataset sử dụng hashtag #AnDo?
```

Expected:

```text
count = 10
```

### Test B

```text
Query:
Tổng lượt xem của tất cả video sử dụng hashtag #AnDo là bao nhiêu?
```

Expected:

```text
sum = 45,185,000
```

### Test C

```text
Query:
Lượt xem trung bình của tất cả video sử dụng hashtag #AnDo là bao nhiêu?
```

Expected:

```text
count = 10
sum = 45,185,000
avg = 4,518,500
```

### Test D

Kiểm tra consistency:

```text
assert avg === sum / count
```

hoặc với floating-point:

```text
assert approximatelyEqual(avg, sum / count)
```

---

# 13. Test chống top-K

Tạo hoặc sử dụng dataset có:

```text
> 10 videos
```

cùng hashtag.

Ví dụ:

```text
#test
20 videos
```

Query:

```text
COUNT
SUM
AVG
```

Expected:

```text
COUNT = 20
```

và SUM/AVG phải sử dụng cả 20 video.

Không được chỉ lấy 10 video.

---

# 14. Test chống duplicate JOIN

Tạo test:

```text
video_1 → #ando
video_1 → #dulich
```

Query:

```text
SUM views WHERE hashtag = #ando
```

`video_1` chỉ được tính **một lần**.

Không được:

```text
views × number_of_hashtag_rows
```

---

# 15. Test scope

Đảm bảo các scope sau không bị trộn:

```text
DATASET
CREATOR
VIDEO
```

Ví dụ:

```text
DATASET + #ando
→ tất cả video #ando

CREATOR + #ando
→ chỉ video của creator có #ando

VIDEO + #ando
→ chỉ video đó
```

Không được fallback:

```text
VIDEO
→ CREATOR
→ DATASET
```

để lấy số liệu khi scope hiện tại không có evidence.

---

# 16. Không over-engineer

Không rewrite toàn bộ RAG system.

Chỉ sửa những phần thực sự liên quan đến:

```text
HASHTAG_ANALYSIS
Analytics Engine
population resolution
aggregation
evidence consistency
```

Giữ nguyên các chức năng đang chạy đúng.

---

# 17. Sau khi sửa

Hãy chạy lại toàn bộ hashtag regression tests hiện có, đặc biệt:

1. Video có những hashtag nào?
2. Video có `#AnDo` không?
3. Creator thường sử dụng hashtag nào?
4. Top 5 hashtag của creator.
5. COUNT video có `#AnDo`.
6. SUM views của `#AnDo`.
7. AVG views của `#AnDo`.
8. Creator + hashtag filter.
9. Hashtag intersection.
10. So sánh hai hashtag.
11. Video-level hashtag popularity.

Cuối cùng báo cáo:

```text
Root cause:
...

Files changed:
...

Fix:
...

Tests:
...

Before:
SUM = 45,185,000
AVG = 4,518,960 ❌

After:
SUM = 45,185,000
COUNT = 10
AVG = 4,518,500 ✅
```

Quan trọng nhất: **không chỉ sửa output 4,518,960 thành 4,518,500 bằng hardcode hoặc prompt LLM. Phải tìm và sửa root cause khiến SUM/AVG đang sử dụng hai population/result khác nhau.**
