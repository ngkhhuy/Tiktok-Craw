/**
 * Conversation Manager for Multi-turn RAG Dialogues
 * 
 * update2.md Requirement:
 * - "Handle follow-up questions ('video đó có bao nhiêu like?', 'so sánh nó với video trước')"
 * - Preserves entity context (lastVideoIds, lastCreator, lastMetric)
 */

import crypto from 'crypto';
import { ContextHistory } from '../query/entity-resolver.js';
import { SupportedMetric } from '../analytics/metric-definitions.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ConversationSession {
  sessionId: string;
  history: ChatMessage[];
  context: ContextHistory;
  createdAt: number;
  lastActiveAt: number;
}

export class ConversationManager {
  private sessions = new Map<string, ConversationSession>();
  private readonly SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Retrieves an existing session or creates a new one.
   */
  getOrCreateSession(sessionId?: string): ConversationSession {
    this.cleanupStaleSessions();

    if (sessionId && this.sessions.has(sessionId)) {
      const sess = this.sessions.get(sessionId)!;
      sess.lastActiveAt = Date.now();
      return sess;
    }

    const newId = sessionId || crypto.randomUUID();
    const newSession: ConversationSession = {
      sessionId: newId,
      history: [],
      context: {
        lastVideoIds: [],
      },
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(newId, newSession);
    return newSession;
  }

  /**
   * Appends user message and updates context entities.
   */
  recordTurn(
    sessionId: string,
    userQuery: string,
    assistantReply: string,
    extractedEntities?: {
      videoIds?: string[];
      creator?: string;
      metrics?: SupportedMetric[];
    }
  ): void {
    const session = this.getOrCreateSession(sessionId);

    session.history.push({
      role: 'user',
      content: userQuery,
      timestamp: new Date().toISOString(),
    });

    session.history.push({
      role: 'assistant',
      content: assistantReply,
      timestamp: new Date().toISOString(),
    });

    // Update active context entities if new ones were mentioned
    if (extractedEntities?.videoIds && extractedEntities.videoIds.length > 0) {
      session.context.lastVideoIds = extractedEntities.videoIds;
    }
    if (extractedEntities?.creator) {
      session.context.lastCreator = extractedEntities.creator;
    }
    if (extractedEntities?.metrics && extractedEntities.metrics.length > 0) {
      session.context.lastMetric = extractedEntities.metrics[0];
    }

    session.lastActiveAt = Date.now();
  }

  /**
   * Gets session context for the query planner.
   */
  getContext(sessionId: string): ContextHistory | undefined {
    return this.sessions.get(sessionId)?.context;
  }

  /**
   * Removes sessions inactive for more than TTL.
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    for (const [id, sess] of this.sessions.entries()) {
      if (now - sess.lastActiveAt > this.SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Clears a session.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export const conversationManager = new ConversationManager();
