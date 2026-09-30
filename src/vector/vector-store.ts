/**
 * SQLite-backed In-Process Vector Store
 * 
 * update2.md Requirement:
 * - "Vector search finds evidence (comments, transcripts, captions)"
 * - Store embeddings as Float32Array BLOBs in SQLite
 * - Efficient cosine similarity calculation
 */

import { getDb } from '../storage/database.js';

export interface VectorRecord {
  id: string;
  entityType: 'comment' | 'video_summary' | 'caption';
  entityId: string;
  chunkText: string;
  embedding: number[];
  dimensions: number;
  model: string;
  metadata?: Record<string, any>;
}

export interface SearchMatch {
  id: string;
  entityType: string;
  entityId: string;
  chunkText: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface VectorSearchOptions {
  entityType?: 'comment' | 'video_summary' | 'caption';
  limit?: number;
  minSimilarity?: number;
  entityId?: string;
}

export class SQLiteVectorStore {
  private db = getDb();

  /**
   * Helper: compute cosine similarity between two float vectors.
   */
  public static cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      const valA = a[i];
      const valB = b[i];
      dot += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    if (normA <= 0 || normB <= 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Upsert a vector embedding record.
   */
  upsert(record: VectorRecord): void {
    const buffer = Buffer.from(new Float32Array(record.embedding).buffer);
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO vector_embeddings (
          embedding_id, entity_type, entity_id, chunk_text,
          embedding, dimensions, model, metadata_json, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(embedding_id) DO UPDATE SET
          chunk_text = excluded.chunk_text,
          embedding = excluded.embedding,
          dimensions = excluded.dimensions,
          model = excluded.model,
          metadata_json = excluded.metadata_json
      `)
      .run(
        record.id,
        record.entityType,
        record.entityId,
        record.chunkText,
        buffer,
        record.dimensions,
        record.model,
        record.metadata ? JSON.stringify(record.metadata) : null,
        now
      );
  }

  /**
   * Batch upsert vectors inside a transaction for performance.
   */
  upsertBatch(records: VectorRecord[]): number {
    if (!records || records.length === 0) return 0;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO vector_embeddings (
        embedding_id, entity_type, entity_id, chunk_text,
        embedding, dimensions, model, metadata_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(embedding_id) DO UPDATE SET
        chunk_text = excluded.chunk_text,
        embedding = excluded.embedding,
        dimensions = excluded.dimensions,
        model = excluded.model,
        metadata_json = excluded.metadata_json
    `);

    const runBatch = this.db.transaction((items: VectorRecord[]) => {
      let count = 0;
      for (const r of items) {
        const buffer = Buffer.from(new Float32Array(r.embedding).buffer);
        stmt.run(
          r.id,
          r.entityType,
          r.entityId,
          r.chunkText,
          buffer,
          r.dimensions,
          r.model,
          r.metadata ? JSON.stringify(r.metadata) : null,
          now
        );
        count++;
      }
      return count;
    });

    return runBatch(records);
  }

  /**
   * Search for closest vector embeddings using cosine similarity.
   */
  search(queryVector: number[], options: VectorSearchOptions = {}): SearchMatch[] {
    const limit = options.limit || 10;
    const minSim = options.minSimilarity !== undefined ? options.minSimilarity : -1;

    let sql = 'SELECT embedding_id, entity_type, entity_id, chunk_text, embedding, dimensions, metadata_json FROM vector_embeddings WHERE 1=1';
    const params: any[] = [];

    if (options.entityType) {
      sql += ' AND entity_type = ?';
      params.push(options.entityType);
    }
    if (options.entityId) {
      sql += ' AND entity_id = ?';
      params.push(options.entityId);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    if (rows.length === 0) return [];

    const queryVecFloat = new Float32Array(queryVector);
    const matches: SearchMatch[] = [];

    for (const r of rows) {
      const buffer = r.embedding as Buffer;
      // Reconstruct Float32Array from Buffer
      const vector = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      const similarity = SQLiteVectorStore.cosineSimilarity(queryVecFloat, vector);

      if (similarity >= minSim) {
        let meta: Record<string, any> | undefined;
        if (r.metadata_json) {
          try {
            meta = JSON.parse(r.metadata_json);
          } catch {}
        }

        matches.push({
          id: r.embedding_id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          chunkText: r.chunk_text,
          similarity: Number(similarity.toFixed(4)),
          metadata: meta,
        });
      }
    }

    // Sort descending by similarity
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, limit);
  }

  /**
   * Count stored embeddings.
   */
  count(entityType?: string): number {
    if (entityType) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM vector_embeddings WHERE entity_type = ?').get(entityType) as any;
      return row?.cnt || 0;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM vector_embeddings').get() as any;
    return row?.cnt || 0;
  }
}

export const vectorStore = new SQLiteVectorStore();
