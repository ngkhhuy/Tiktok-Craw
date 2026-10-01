/**
 * Embedding Service with OpenAI API Integration & Deterministic Local Fallback
 * 
 * Supports:
 * - OpenAI-compatible REST API (/v1/embeddings)
 * - Deterministic, normalized local vector fallback (dimension 384) for offline/test environments
 */

import { config } from '../config/index.js';
import crypto from 'crypto';

export interface EmbeddingService {
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModelName(): string;
}

export class DefaultEmbeddingService implements EmbeddingService {
  private remoteDisabled: boolean = false;

  get apiKey(): string {
    return config.embeddingApiKey;
  }

  get baseUrl(): string {
    return config.embeddingBaseUrl.replace(/\/+$/, '');
  }

  get model(): string {
    return config.embeddingModel;
  }

  getDimensions(): number {
    return (!this.apiKey || this.remoteDisabled) ? 384 : 1536;
  }

  getModelName(): string {
    return (!this.apiKey || this.remoteDisabled) ? 'local-deterministic-384' : this.model;
  }

  /**
   * Deterministic local embedding generator using hashed subword/n-gram features.
   * L2-normalized so dot product is cosine similarity.
   */
  private generateLocalEmbedding(text: string, dims: number = 384): number[] {
    const clean = text.toLowerCase().trim();
    const vec = new Float32Array(dims);

    if (!clean) {
      return Array.from(vec);
    }

    // Tokenize words and character n-grams
    const words = clean.split(/[\s,.\-!?:;"'()\[\]{}#@/\\_]+/).filter((w) => w.length > 0);
    const tokens: string[] = [...words];

    // Add character 3-grams for morphological/semantic overlap
    for (const w of words) {
      if (w.length >= 3) {
        for (let i = 0; i <= w.length - 3; i++) {
          tokens.push(w.slice(i, i + 3));
        }
      }
    }

    for (const token of tokens) {
      // 32-bit FNV-1a hash
      let hash = 2166136261;
      for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const index = Math.abs(hash) % dims;
      const sign = (hash & 1) === 0 ? 1.0 : -1.0;
      vec[index] += sign;
    }

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        vec[i] /= norm;
      }
    }

    return Array.from(vec);
  }

  async embedText(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (!this.apiKey || this.remoteDisabled) {
      return texts.map((t) => this.generateLocalEmbedding(t, this.getDimensions()));
    }

    try {
      const url = `${this.baseUrl}/embeddings`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[EMBEDDING] Remote API returned status ${response.status}. Switching to local deterministic embeddings.`);
        if (response.status === 404 || response.status === 400 || response.status === 401 || response.status === 403) {
          this.remoteDisabled = true;
        }
        return texts.map((t) => this.generateLocalEmbedding(t, 384));
      }

      const json: any = await response.json();
      if (json.data && Array.isArray(json.data)) {
        return json.data.map((item: any) => item.embedding);
      }

      return texts.map((t) => this.generateLocalEmbedding(t, 384));
    } catch (err: any) {
      console.warn(`[EMBEDDING] Remote request failed: ${err.message}. Switching to local deterministic embeddings.`);
      this.remoteDisabled = true;
      return texts.map((t) => this.generateLocalEmbedding(t, 384));
    }
  }
}

export const embeddingService = new DefaultEmbeddingService();
