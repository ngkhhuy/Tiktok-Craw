/**
 * End-to-End TikTok Analytics RAG Service Orchestrator
 * 
 * Pipeline flow (update2.md):
 * 1. User Natural Language Query ->
 * 2. Conversation Session Context Lookup ->
 * 3. Deterministic Query Plan Generation ->
 * 4. Context Builder & Evidence Assembler ->
 * 5. External LLM (Reasoning & Explanation Only) ->
 * 6. Multi-turn Session State Update ->
 * 7. Deliver Zero-Hallucination Structured Response
 */

import { contextBuilder, EvidenceObject } from '../context/context-builder.js';
import { conversationManager } from '../conversation/conversation-manager.js';
import { llmClient } from '../llm/llm-client.js';
import { QueryPlan } from '../query/intents.js';
import { queryPlanner } from '../query/query-planner.js';

export interface RAGQueryResult {
  answer: string;
  sessionId: string;
  intent: string;
  plan: QueryPlan;
  evidence: EvidenceObject;
  model: string;
  latencyMs: number;
  sources: {
    tables: string[];
    videosAnalyzed: number;
    commentsAnalyzed: number;
  };
}

export class RAGService {
  /**
   * Executes end-to-end RAG analysis for a user question.
   */
  async query(question: string, sessionId?: string): Promise<RAGQueryResult> {
    const startTime = Date.now();

    // 1. Session & Context Resolution
    const session = conversationManager.getOrCreateSession(sessionId);
    const context = conversationManager.getContext(session.sessionId);

    // 2. Query Understanding & Planning
    const plan = queryPlanner.plan(question, context);

    // 3. Evidence Assembly
    const evidence = await contextBuilder.buildEvidence(question, plan);

    // 4. Prompt Synthesis & Guard Enforcing
    const { systemPrompt, userPrompt } = contextBuilder.buildPrompt(evidence);

    // 5. LLM Reasoning (or Deterministic Narrator Fallback)
    const llmResponse = await llmClient.generate({
      systemPrompt,
      userPrompt,
      evidence,
    });

    // 6. Record Conversation Turn & Preserve Entity Context
    conversationManager.recordTurn(
      session.sessionId,
      question,
      llmResponse.content,
      {
        videoIds: plan.entities.videoIds,
        creator: plan.entities.creator,
        metrics: plan.entities.metrics,
      }
    );

    const totalLatency = Date.now() - startTime;

    return {
      answer: llmResponse.content,
      sessionId: session.sessionId,
      intent: plan.intent,
      plan,
      evidence,
      model: llmResponse.model,
      latencyMs: totalLatency,
      sources: {
        tables: evidence.data_provenance.source_tables,
        videosAnalyzed: evidence.data_provenance.videos_analyzed,
        commentsAnalyzed: evidence.data_provenance.comments_analyzed,
      },
    };
  }
}

export const ragService = new RAGService();
