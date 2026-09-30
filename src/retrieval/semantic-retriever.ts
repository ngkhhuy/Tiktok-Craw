/**
 * Semantic Retriever with Hybrid Search & MMR Diversity Filtering
 * 
 * update2.md Requirements:
 * - "Vector search finds evidence (comments, transcripts, captions)"
 * - Diversity filtering (MMR) so results aren't redundant
 * - Provenance tracking for evidence chunks
 */

import { getDb } from '../storage/database.js';
import { embeddingService } from '../embeddings/embedding-service.js';
import { SQLiteVectorStore, vectorStore, VectorRecord } from '../vector/vector-store.js';

export interface RetrievedChunk {
  id: string;
  entity_type: 'comment' | 'caption' | 'video_summary';
  entity_id: string;
  text: string;
  score: number;
  metadata: {
    video_id?: string;
    username?: string;
    like_count?: number;
    published_at?: string | null;
    [key: string]: any;
  };
}

export interface RetrievalOptions {
  entityType?: 'comment' | 'caption' | 'video_summary';
  limit?: number;
  minSimilarity?: number;
  videoId?: string;
  diversityLambda?: number; // 0 to 1, higher means more relevance, lower means more diversity (MMR)
}

export class SemanticRetriever {
  private db = getDb();

  /**
   * Indexes all video captions and descriptions into vector store.
   */
  async indexVideoCaptions(): Promise<number> {
    const videos = this.db
      .prepare(`SELECT video_id, username, description, published_at FROM videos WHERE status = 'completed' AND description IS NOT NULL AND description != ''`)
      .all() as any[];

    if (videos.length === 0) return 0;

    const texts = videos.map((v) => `Caption by @${v.username}: ${v.description}`);
    const embeddings = await embeddingService.embedBatch(texts);
    const dims = embeddingService.getDimensions();
    const model = embeddingService.getModelName();

    const records: VectorRecord[] = videos.map((v, i) => ({
      id: `caption_${v.video_id}`,
      entityType: 'caption',
      entityId: v.video_id,
      chunkText: v.description,
      embedding: embeddings[i],
      dimensions: dims,
      model,
      metadata: {
        video_id: v.video_id,
        username: v.username,
        published_at: v.published_at,
      },
    }));

    return vectorStore.upsertBatch(records);
  }

  /**
   * Indexes comments into vector store.
   */
  async indexComments(maxPerVideo: number = 20, maxTotal: number = 2000): Promise<number> {
    const comments = this.db
      .prepare(`
        SELECT comment_id, video_id, author_username, text, like_count, published_at
        FROM comments
        WHERE text IS NOT NULL AND length(trim(text)) > 3
        ORDER BY like_count DESC, published_at DESC
        LIMIT ?
      `)
      .all(maxTotal) as any[];

    if (comments.length === 0) return 0;

    // Filter to at most maxPerVideo comments per video to avoid skewing
    const perVideoCount = new Map<string, number>();
    const filteredComments: any[] = [];
    for (const c of comments) {
      const current = perVideoCount.get(c.video_id) || 0;
      if (current < maxPerVideo) {
        perVideoCount.set(c.video_id, current + 1);
        filteredComments.push(c);
      }
    }

    const batchSize = 100;
    let totalIndexed = 0;
    const dims = embeddingService.getDimensions();
    const model = embeddingService.getModelName();

    for (let i = 0; i < filteredComments.length; i += batchSize) {
      const batch = filteredComments.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);
      const embeddings = await embeddingService.embedBatch(texts);

      const records: VectorRecord[] = batch.map((c, idx) => ({
        id: `comment_${c.comment_id}`,
        entityType: 'comment',
        entityId: c.comment_id,
        chunkText: c.text,
        embedding: embeddings[idx],
        dimensions: dims,
        model,
        metadata: {
          video_id: c.video_id,
          username: c.author_username,
          like_count: c.like_count,
          published_at: c.published_at,
        },
      }));

      totalIndexed += vectorStore.upsertBatch(records);
    }

    return totalIndexed;
  }

  /**
   * Auto-indexes dataset if vector store is empty.
   */
  async ensureIndexed(): Promise<void> {
    const count = vectorStore.count();
    if (count === 0) {
      console.log('[RETRIEVER] Vector store is empty. Auto-indexing video captions and top comments...');
      const caps = await this.indexVideoCaptions();
      const comms = await this.indexComments(15, 1000);
      console.log(`[RETRIEVER] Indexed ${caps} captions and ${comms} comments.`);
    }
  }

  /**
   * Hybrid semantic search with MMR diversity re-ranking.
   */
  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievedChunk[]> {
    await this.ensureIndexed();

    const limit = options.limit || 8;
    const lambda = options.diversityLambda !== undefined ? options.diversityLambda : 0.7; // 0.7 balances relevance and diversity
    const queryVector = await embeddingService.embedText(query);

    // Initial pool of candidate matches (fetch 3x requested limit)
    const candidateLimit = Math.max(limit * 3, 25);
    const matches = vectorStore.search(queryVector, {
      entityType: options.entityType,
      limit: candidateLimit,
      minSimilarity: options.minSimilarity ?? 0.05,
    });

    if (matches.length === 0) {
      // Fallback: direct SQLite text search
      return this.keywordFallback(query, options);
    }

    // MMR Re-Ranking (Maximal Marginal Relevance)
    // Select candidates that are similar to the query but dissimilar to already selected items
    const selected: typeof matches = [];
    const remaining = [...matches];

    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const relevance = cand.similarity;

        // Maximum similarity to any already-selected item
        let maxSimToSelected = 0;
        if (selected.length > 0) {
          for (const s of selected) {
            // Rough text overlap heuristic for inter-item similarity
            const sim = this.jaccardSimilarity(cand.chunkText, s.chunkText);
            if (sim > maxSimToSelected) maxSimToSelected = sim;
          }
        }

        const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return selected.map((m) => ({
      id: m.id,
      entity_type: m.entityType as any,
      entity_id: m.entityId,
      text: m.chunkText,
      score: m.similarity,
      metadata: m.metadata || {},
    }));
  }

  private jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private keywordFallback(query: string, options: RetrievalOptions): RetrievedChunk[] {
    const limit = options.limit || 8;
    const clean = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const tokens = clean.split(/\s+/).filter((t) => t.length > 2);
    if (tokens.length === 0) return [];

    const likeClauses = tokens.map(() => 'text LIKE ?').join(' OR ');
    const params = tokens.map((t) => `%${t}%`);

    const rows = this.db
      .prepare(`SELECT comment_id, video_id, author_username, text, like_count, published_at FROM comments WHERE ${likeClauses} ORDER BY like_count DESC LIMIT ?`)
      .all(...params, limit) as any[];

    return rows.map((r) => ({
      id: `comment_${r.comment_id}`,
      entity_type: 'comment',
      entity_id: r.comment_id,
      text: r.text,
      score: 0.5,
      metadata: {
        video_id: r.video_id,
        username: r.author_username,
        like_count: r.like_count,
        published_at: r.published_at,
      },
    }));
  }
}

export const semanticRetriever = new SemanticRetriever();
