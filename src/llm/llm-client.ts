/**
 * External LLM Client & Deterministic Fallback Adapter
 * 
 * update2.md Requirements:
 * - "External LLM is used ONLY for reasoning, formatting, and explanation"
 * - "Zero hallucination"
 * - Remote OpenAI-compatible API support with automatic fallback to deterministic offline narrator
 */

import { config } from '../config/index.js';
import { EvidenceObject } from '../context/context-builder.js';

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  evidence?: EvidenceObject;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

export interface LLMClient {
  generate(req: LLMRequest): Promise<LLMResponse>;
}

export class OpenAILLMClient implements LLMClient {
  get apiKey(): string {
    return config.llmApiKey;
  }

  get baseUrl(): string {
    return config.llmBaseUrl.replace(/\/+$/, '');
  }

  get model(): string {
    return config.llmModel;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();

    if (this.apiKey) {
      try {
        const url = `${this.baseUrl}/chat/completions`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: req.systemPrompt },
              { role: 'user', content: req.userPrompt },
            ],
            temperature: req.temperature ?? 0.1,
            max_tokens: req.maxTokens ?? 1500,
          }),
        });

        if (res.ok) {
          const json: any = await res.json();
          const content = json.choices?.[0]?.message?.content || '';
          return {
            content,
            model: json.model || this.model,
            usage: {
              promptTokens: json.usage?.prompt_tokens || 0,
              completionTokens: json.usage?.completion_tokens || 0,
              totalTokens: json.usage?.total_tokens || 0,
            },
            latencyMs: Date.now() - start,
          };
        } else {
          const errText = await res.text();
          console.warn(`[LLM] Remote API error (${res.status}): ${errText}. Using deterministic narrator fallback.`);
        }
      } catch (err: any) {
        console.warn(`[LLM] Connection to external LLM failed: ${err.message}. Using deterministic narrator fallback.`);
      }
    }

    // Fallback: Deterministic narrative generator based directly on the EvidenceObject
    const content = this.generateDeterministicNarrative(req.evidence);
    return {
      content,
      model: 'deterministic-offline-narrator',
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Deterministically synthesizes a structured Vietnamese response from the EvidenceObject.
   * Guarantees 0% hallucination and exact numbers.
   */
  private generateDeterministicNarrative(evidence?: EvidenceObject): string {
    if (!evidence) {
      return 'Không nhận được dữ liệu bằng chứng từ hệ thống phân tích.';
    }

    const { intent, metrics, comparisons, benchmarks, retrieved_chunks, data_provenance } = evidence;
    const lines: string[] = [];

    switch (intent) {
      case 'METRIC_LOOKUP': {
        const v = metrics.video;
        if (!v) {
          lines.push(`❌ **Không tìm thấy video**: ${metrics.error || 'Video không tồn tại trong tập dữ liệu completed.'}`);
          break;
        }

        lines.push(`### 📊 Báo cáo số liệu video \`${v.video_id}\``);
        lines.push(`- **Kênh:** @${v.username} (${v.display_name})`);
        lines.push(`- **Mô tả:** ${v.description || '*(Không có mô tả)*'}`);
        lines.push(`- **Thời lượng:** ${v.raw.duration}s`);
        lines.push('');
        lines.push('#### 📈 Chỉ số tương tác:');
        lines.push(`- **Lượt xem (Views):** ${v.raw.views.toLocaleString()}`);
        lines.push(`- **Lượt thích (Likes):** ${v.raw.likes.toLocaleString()} (Like rate: ${(v.rates.like_rate ? (v.rates.like_rate * 100).toFixed(2) : 0)}%)`);
        lines.push(`- **Bình luận (Comments):** ${v.raw.comments.toLocaleString()} (Comment rate: ${(v.rates.comment_rate ? (v.rates.comment_rate * 100).toFixed(3) : 0)}%)`);
        lines.push(`- **Lượt chia sẻ (Shares):** ${v.raw.shares.toLocaleString()}`);
        lines.push(`- **Tỉ lệ tương tác tổng thể (Engagement Rate):** ${(v.rates.engagement_rate ? (v.rates.engagement_rate * 100).toFixed(2) : 0)}%`);
        lines.push('');
        lines.push('#### 🎯 So sánh với Benchmark:');
        lines.push(`- **Thứ hạng trong toàn bộ dataset (${v.ranks.overall.total_videos} video):** Xếp hạng #${v.ranks.overall.views_rank} về Views (Percentile: P${v.ranks.overall.views_percentile}).`);
        lines.push(`- **So với Median dataset (${v.comparison_to_baseline.dataset_median_views.toLocaleString()} views):** ${v.comparison_to_baseline.views_percent_diff !== null && v.comparison_to_baseline.views_percent_diff >= 0 ? `Cao hơn +${v.comparison_to_baseline.views_percent_diff}%` : `Thấp hơn ${v.comparison_to_baseline.views_percent_diff}%`}.`);
        if (v.ranks.creator) {
          lines.push(`- **Trong kênh @${v.username} (${v.ranks.creator.total_videos} video):** Xếp hạng #${v.ranks.creator.views_rank} về lượt xem.`);
        }
        break;
      }

      case 'COMPARISON': {
        if (comparisons && (comparisons as any).comparison) {
          const comp = comparisons as any;
          lines.push(`### ⚖️ So sánh chi tiết 2 Video`);
          lines.push(`- **Video A:** \`${comp.video_a.video_id}\` (@${comp.video_a.username})`);
          lines.push(`- **Video B:** \`${comp.video_b.video_id}\` (@${comp.video_b.username})`);
          lines.push('');
          lines.push('| Chỉ số | Video A | Video B | Chênh lệch (%) | Kết luận |');
          lines.push('| :--- | :--- | :--- | :--- | :--- |');

          const tableMetrics = ['views', 'likes', 'comments', 'shares', 'duration', 'like_rate', 'engagement_rate'];
          for (const m of tableMetrics) {
            const item = comp.comparison[m];
            if (!item) continue;
            const valA = item.value_a !== null ? (m.includes('rate') ? (item.value_a * 100).toFixed(2) + '%' : item.value_a.toLocaleString()) : 'N/A';
            const valB = item.value_b !== null ? (m.includes('rate') ? (item.value_b * 100).toFixed(2) + '%' : item.value_b.toLocaleString()) : 'N/A';
            const diffPct = item.percent_diff !== null ? `${item.percent_diff >= 0 ? '+' : ''}${item.percent_diff}%` : '0%';
            const higherText = item.higher === 'video_b' ? 'Video B cao hơn' : item.higher === 'video_a' ? 'Video A cao hơn' : 'Bằng nhau';
            lines.push(`| **${m}** | ${valA} | ${valB} | ${diffPct} | ${higherText} |`);
          }
          lines.push('');
          lines.push(`**Tóm tắt:** ${comp.summary}`);
        } else if (comparisons && (comparisons as any).creator_a && (comparisons as any).creator_b) {
          const comp = comparisons as any;
          lines.push(`### ⚖️ So sánh chi tiết 2 Kênh`);
          const uA = comp.creator_a.username.replace(/^@/, '');
          const uB = comp.creator_b.username.replace(/^@/, '');
          lines.push(`- **Kênh A:** @${uA} (${comp.creator_a.total_videos} video)`);
          lines.push(`- **Kênh B:** @${uB} (${comp.creator_b.total_videos} video)`);
          lines.push('');

          if (comp.comparison_rows && comp.comparison_rows.length > 0) {
            lines.push(
              `| Chỉ số | Phép tính | @${uA} | @${uB} | Chênh lệch (%) | Kết luận |`
            );
            lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
            for (const r of comp.comparison_rows) {
              const metricLabel =
                r.metric === 'views'
                  ? 'Lượt xem (Views)'
                  : r.metric === 'likes'
                  ? 'Lượt thích (Likes)'
                  : r.metric === 'shares'
                  ? 'Lượt chia sẻ (Shares)'
                  : r.metric === 'comments'
                  ? 'Bình luận (Comments)'
                  : r.metric === 'video_id' || r.metric === 'videos'
                  ? 'Số lượng video'
                  : r.metric;
              const valA = r.value_a !== null ? Number(r.value_a).toLocaleString() : 'N/A';
              const valB = r.value_b !== null ? Number(r.value_b).toLocaleString() : 'N/A';
              const diffPct =
                r.percent_diff !== null
                  ? (r.percent_diff >= 0 ? '+' : '') + r.percent_diff + '%'
                  : 'N/A';
              lines.push(
                `| **${metricLabel}** | ${r.aggregation} | ${valA} | ${valB} | ${diffPct} | ${r.higher} cao hơn |`
              );
            }
          } else {
            lines.push(`| Chỉ số | @${uA} | @${uB} | Chênh lệch (%) |`);
            lines.push(`| :--- | :--- | :--- | :--- |`);
            lines.push(
              `| **Median Views** | ${comp.creator_a.median_views.toLocaleString()} | ${comp.creator_b.median_views.toLocaleString()} | ${comp.differences.views_diff.percent_change !== null ? (comp.differences.views_diff.percent_change >= 0 ? '+' : '') + comp.differences.views_diff.percent_change + '%' : 'N/A'} |`
            );
            lines.push(
              `| **Mean Views** | ${comp.creator_a.mean_views.toLocaleString()} | ${comp.creator_b.mean_views.toLocaleString()} | N/A |`
            );
            lines.push(
              `| **Median Likes** | ${comp.creator_a.median_likes.toLocaleString()} | ${comp.creator_b.median_likes.toLocaleString()} | ${comp.differences.likes_diff.percent_change !== null ? (comp.differences.likes_diff.percent_change >= 0 ? '+' : '') + comp.differences.likes_diff.percent_change + '%' : 'N/A'} |`
            );
            lines.push(
              `| **Engagement Rate** | ${(comp.creator_a.median_engagement * 100).toFixed(2)}% | ${(comp.creator_b.median_engagement * 100).toFixed(2)}% | ${comp.differences.engagement_diff.percent_change !== null ? (comp.differences.engagement_diff.percent_change >= 0 ? '+' : '') + comp.differences.engagement_diff.percent_change + '%' : 'N/A'} |`
            );
          }
          lines.push('');
          lines.push(`**Tóm tắt:** ${comp.summary}`);
        } else if (comparisons && (comparisons as any).creator) {
          const c = comparisons as any;
          lines.push(`### 📈 Đánh giá hiệu suất kênh @${c.creator} so với toàn bộ Dataset`);
          lines.push(`- **Tổng số video cào được:** ${c.creator_total_videos}`);
          lines.push(`- **Median Views của kênh:** ${c.creator_median_views.toLocaleString()} views`);
          lines.push(`- **Median Views của Dataset:** ${c.dataset_median_views.toLocaleString()} views`);
          lines.push(`- **Chênh lệch Views:** ${c.views_percent_diff !== null && c.views_percent_diff >= 0 ? `Cao hơn +${c.views_percent_diff}%` : `Thấp hơn ${c.views_percent_diff}%`} so với median chung.`);
          lines.push(`- **Median Engagement Rate:** ${(c.creator_median_engagement * 100).toFixed(2)}% (toàn dataset: ${(c.dataset_median_engagement * 100).toFixed(2)}%).`);
        }
        break;
      }

      case 'RANKING': {
        const r = metrics.ranking;
        const metricName =
          r.metric === 'views'
            ? 'Lượt xem (Views)'
            : r.metric === 'likes'
            ? 'Lượt thích (Likes)'
            : r.metric === 'engagement_rate'
            ? 'Tỉ lệ tương tác (Engagement Rate)'
            : r.metric;

        if (r.target === 'creator' && r.creators) {
          lines.push(`### 🏆 Bảng xếp hạng Top ${r.creators.length} Kênh theo ${metricName}`);
          lines.push('');
          lines.push('| Hạng | Kênh | Tên hiển thị | Tổng Views | Tổng Likes | Số Video | Avg Views |');
          lines.push('| :---: | :--- | :--- | :--- | :--- | :--- | :--- |');
          r.creators.forEach((c: any, idx: number) => {
            lines.push(
              `| **#${idx + 1}** | @${c.username} | ${c.display_name || c.username} | ${Number(c.total_views || 0).toLocaleString()} | ${Number(c.total_likes || 0).toLocaleString()} | ${c.total_videos} | ${Number(c.avg_views || 0).toLocaleString()} |`
            );
          });
          break;
        }

        const videosList = r.videos || [];
        lines.push(`### 🏆 Bảng xếp hạng Top ${videosList.length} Video theo ${metricName}`);
        lines.push('');
        lines.push('| Hạng | Kênh | Lượt xem | Lượt thích | Tương tác | Thời lượng | Video ID |');
        lines.push('| :---: | :--- | :--- | :--- | :--- | :--- | :--- |');
        videosList.forEach((v: any, idx: number) => {
          const eng = v.engagement_rate ? (v.engagement_rate * 100).toFixed(2) + '%' : '0%';
          lines.push(
            `| **#${idx + 1}** | @${v.username} | ${Number(v.views).toLocaleString()} | ${Number(v.likes).toLocaleString()} | ${eng} | ${v.duration}s | \`${v.video_id}\` |`
          );
        });

        lines.push('');
        lines.push('#### 🎬 Danh sách chi tiết từng video:');
        videosList.forEach((v: any, idx: number) => {
          const eng = v.engagement_rate ? (v.engagement_rate * 100).toFixed(2) + '%' : '0%';
          const desc = v.description
            ? `"${v.description.replace(/\r?\n/g, ' ').slice(0, 160)}${v.description.length > 160 ? '...' : ''}"`
            : '*(Không có mô tả)*';
          const link = v.tiktok_url || `https://www.tiktok.com/@${v.username}/video/${v.video_id}`;

          lines.push(`**#${idx + 1}. Kênh @${v.username}** — Video ID: \`${v.video_id}\``);
          lines.push(`- **Mô tả / Caption:** ${desc}`);
          lines.push(
            `- **Chỉ số:** 👁️ **${Number(v.views).toLocaleString()}** views | ❤️ **${Number(v.likes).toLocaleString()}** likes | 💬 **${Number(v.comments || 0).toLocaleString()}** comments | ⚡ Tương tác: **${eng}**`
          );
          lines.push(`- **Link trực tiếp:** [Xem video trên TikTok ↗](${link})`);
          lines.push('');
        });
        break;
      }

      case 'AGGREGATION': {
        const results = metrics.results || [];
        const entityLabel = evidence.plan.entity
          ? `${evidence.plan.entity.type === 'CHANNEL' ? 'kênh' : 'video'} ${evidence.plan.entity.id}`
          : 'toàn bộ dataset';

        lines.push(`### 📐 Kết quả tổng hợp số liệu (${entityLabel})`);

        if (results.length > 0) {
          for (const item of results) {
            if (item.aggregation === 'PERCENTAGE_OF_GLOBAL') {
              const metricName =
                item.metric === 'views'
                  ? 'lượt xem'
                  : item.metric === 'likes'
                  ? 'lượt thích'
                  : item.metric === 'shares'
                  ? 'lượt share'
                  : item.metric;
              lines.push(
                `- **Tỉ lệ chiếm của kênh ${item.scope}:** **${item.value}%** tổng ${metricName} của toàn bộ dataset (${Number(item.channel_value).toLocaleString()} / ${Number(item.dataset_value).toLocaleString()})`
              );
              continue;
            }

            const isRate = [
              'like_rate',
              'comment_rate',
              'share_rate',
              'save_rate',
              'engagement_rate',
            ].includes(item.metric);

            if (isRate) {
              const rateName =
                item.metric === 'share_rate'
                  ? 'Tỉ lệ chia sẻ (Share rate)'
                  : item.metric === 'like_rate'
                  ? 'Tỉ lệ thích (Like rate)'
                  : item.metric === 'comment_rate'
                  ? 'Tỉ lệ bình luận (Comment rate)'
                  : item.metric === 'save_rate'
                  ? 'Tỉ lệ lưu (Save rate)'
                  : item.metric === 'engagement_rate'
                  ? 'Tỉ lệ tương tác (Engagement rate)'
                  : item.metric;

              const formulaTag = item.formula ? ` [${item.formula}]` : ` [${item.aggregation}]`;
              const pct = item.value !== null ? `${(Number(item.value) * 100).toFixed(2)}%` : 'N/A';
              const rawDec = item.value !== null ? Number(item.value).toFixed(4) : 'N/A';
              lines.push(
                `- **${rateName}${formulaTag}:** **${pct}** (tỉ lệ ${rawDec})`
              );
              continue;
            }

            const metricName =
              item.metric === 'video_id' || item.metric === 'videos'
                ? 'Số lượng video'
                : item.metric === 'views'
                ? 'Lượt xem (Views)'
                : item.metric === 'likes'
                ? 'Lượt thích (Likes)'
                : item.metric === 'comments'
                ? 'Bình luận (Comments)'
                : item.metric === 'shares'
                ? 'Lượt chia sẻ (Shares)'
                : item.metric === 'saves'
                ? 'Lưu lại (Saves)'
                : item.metric;

            if (item.metric === 'video_id' || item.metric === 'videos') {
              lines.push(`- **${metricName}:** **${Number(item.value).toLocaleString()}** video`);
            } else if (item.aggregation === 'AVG' && item.metric === 'shares') {
              lines.push(
                `- **Lượt chia sẻ trung bình mỗi video (Avg Shares) [AVG]:** **${item.value !== null ? Number(item.value).toLocaleString() : 'N/A'}** lượt chia sẻ / video`
              );
            } else {
              const aggPrefix =
                item.aggregation === 'SUM' ? 'Tổng ' : item.aggregation === 'AVG' ? 'Trung bình ' : '';
              lines.push(
                `- **${aggPrefix}${metricName} [${item.aggregation}]:** **${item.value !== null ? Number(item.value).toLocaleString() : 'N/A'}**`
              );
            }
          }
        } else {
          const aggs =
            metrics.aggregations ||
            (metrics.aggregation ? { [metrics.aggregation.metric]: metrics.aggregation } : {});
          const keys = Object.keys(aggs);
          for (const k of keys) {
            const a = aggs[k];
            lines.push(`- **${k} [${a.agg}]:** **${a.value !== null ? Number(a.value).toLocaleString() : 'N/A'}**`);
          }
        }
        break;
      }

      case 'CORRELATION': {
        const c = metrics.correlation;
        lines.push(`### 🔬 Phân tích tương quan thống kê: \`${c.metric_x}\` vs \`${c.metric_y}\``);
        lines.push(`- **Hệ số tương quan Pearson (r):** **${c.r !== null ? c.r : 'N/A'}**`);
        lines.push(`- **Kích thước mẫu (n):** ${c.n} video`);
        lines.push(`- **Đánh giá thống kê:** ${c.interpretation}`);
        lines.push('');
        lines.push(`> ⚠️ **LƯU Ý QUAN TRỌNG:** ${c.warning}`);
        break;
      }

      case 'CREATOR_ANALYSIS': {
        const ca = metrics.creator_analysis;
        lines.push(`### 👤 Phân tích toàn diện kênh @${ca.creator}`);
        lines.push(`- **Tổng số video:** ${ca.creator_total_videos}`);
        lines.push(`- **Median Views:** ${ca.creator_median_views.toLocaleString()} (so với toàn dataset: ${ca.views_percent_diff !== null && ca.views_percent_diff >= 0 ? `+${ca.views_percent_diff}%` : `${ca.views_percent_diff}%`})`);
        lines.push(`- **Median Engagement:** ${(ca.creator_median_engagement * 100).toFixed(2)}%`);
        lines.push('');
        lines.push('#### Top video nhiều view nhất của kênh:');
        ca.top_videos.forEach((v: any, idx: number) => {
          lines.push(`${idx + 1}. **\`${v.video_id}\`** - ${v.views.toLocaleString()} views (${v.likes.toLocaleString()} likes): "${v.description?.slice(0, 80)}..."`);
        });
        break;
      }

      case 'SEMANTIC_SEARCH':
      case 'HYBRID': {
        lines.push(`### 💬 Phân tích nội dung & Bình luận`);
        if (metrics.video) {
          lines.push(`- **Video:** \`${metrics.video.video_id}\` (@${metrics.video.username}) - ${metrics.video.raw.views.toLocaleString()} views, ${metrics.video.raw.comments.toLocaleString()} bình luận.`);
        }
        if (retrieved_chunks && retrieved_chunks.length > 0) {
          lines.push(`\n**Các bình luận & nội dung tìm thấy liên quan nhất:**`);
          retrieved_chunks.forEach((chunk, i) => {
            const author = chunk.metadata.username ? `@${chunk.metadata.username}` : 'Người dùng';
            const likes = chunk.metadata.like_count ? ` (${chunk.metadata.like_count} likes)` : '';
            lines.push(`${i + 1}. **${author}${likes}:** "${chunk.text}" *(Độ khớp: ${(chunk.score * 100).toFixed(1)}%)*`);
          });
        } else {
          lines.push(`Không tìm thấy bình luận hoặc nội dung nào phù hợp với yêu cầu.`);
        }
        break;
      }

      case 'DATASET_OVERVIEW':
      default: {
        const ds = metrics.dataset;
        lines.push(`### 🗄️ Tổng quan dữ liệu TikTok Crawl trong hệ thống`);
        lines.push(`- **Tổng số video hoàn tất:** ${ds?.total?.toLocaleString() || data_provenance.videos_analyzed.toLocaleString()}`);
        lines.push(`- **Tổng số bình luận đã lưu:** ${ds?.totalComments?.toLocaleString() || data_provenance.comments_analyzed.toLocaleString()}`);
        lines.push(`- **Tổng lượt xem tích lũy:** ${ds?.totalViews?.toLocaleString() || 0}`);
        lines.push(`- **Dung lượng media lưu trữ:** ${((ds?.totalSize || 0) / (1024 * 1024)).toFixed(2)} MB`);
        if (benchmarks?.dataset_baseline) {
          const vBase = benchmarks.dataset_baseline.metrics.views;
          lines.push(`- **Median Views toàn dataset:** ${vBase.median.toLocaleString()} (P90: ${vBase.p90.toLocaleString()})`);
        }
        break;
      }
    }

    lines.push('');
    lines.push(`---`);
    lines.push(`*Dữ liệu nguồn: Bảng [${data_provenance.source_tables.join(', ')}] | ${data_provenance.videos_analyzed} video phân tích | Thời gian: ${new Date(data_provenance.timestamp).toLocaleTimeString()}*`);

    return lines.join('\n');
  }
}

export const llmClient = new OpenAILLMClient();
