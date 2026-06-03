import { supabase } from "@/integrations/supabase/client";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { SUPPORT_CATEGORIES } from "./flagged-utils";
import type { DraftState } from "./flagged-utils";

/**
 * Returns true when the flagged message looks like a support question
 * and should have support knowledge injected into the draft instruction.
 */
export function needsSupportContext(item: FlaggedMessage): boolean {
  return SUPPORT_CATEGORIES.has(
    (item.intent_category ?? "").toLowerCase().trim(),
  );
}

// Shared header prepended to every support instruction. Explicitly scopes the
// AI to the support domain so it does not wander into calendar / scheduling.
const SUPPORT_HEADER = [
  "=== SUPPORT WORKFLOW ===",
  "You are handling a SUPPORT inquiry. This is NOT an appointment or scheduling request.",
  "Do NOT check, reference, or mention the user's calendar, agenda, appointments, or bookings.",
  "Do NOT suggest rescheduling, cancelling, or modifying any appointment.",
  "Focus ONLY on the customer's support issue using the knowledge below.",
  "",
].join("\n");

/**
 * Builds a draft instruction enriched with relevant support knowledge.
 *
 * 1. Derives a search query from the incoming message + user instruction.
 * 2. Queries `support_doc_chunks` via full-text search — scoped to a single
 *    document when `supportDocId` is provided, or across all documents when
 *    `supportDocId === "all"` or `null`.
 * 3. Formats matched chunks as a "RELEVANT SUPPORT KNOWLEDGE" block prepended
 *    to the user's instruction.
 * 4. Includes an anti-hallucination guard.
 *
 * Returns null when a DB error occurs (caller should abort the draft).
 */
export async function buildSupportInstruction({
  item,
  incomingMessage,
  userInstruction,
  supportDocId,
  updateDraft,
  toast,
}: {
  item: FlaggedMessage;
  incomingMessage: string;
  userInstruction: string;
  supportDocId: string | null;
  updateDraft: (id: string, patch: Partial<DraftState>) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void;
}): Promise<string | null> {
  let instruction = userInstruction;

  try {
    // 0. Fetch all doc titles so every log line can show what's in the KB.
    const { data: allDocs, error: docsLoadErr } = await (supabase
      .from("support_docs") as any)
      .select("id,title")
      .order("created_at", { ascending: false });

    const docCount = docsLoadErr ? 0 : (allDocs?.length ?? 0);
    const docTitles: string[] = (allDocs ?? []).map((d: any) => d.title ?? "Untitled");
    const selectedTitle =
      supportDocId && supportDocId !== "all"
        ? ((allDocs ?? []) as any[]).find((d: any) => d.id === supportDocId)?.title ?? null
        : null;

    // 1. Build a search query from the incoming message and user instruction.
    const rawQuery =
      `${incomingMessage} ${userInstruction}`
        .replace(/[^\w\s]/g, " ")
        .replace(
          /\b(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|shall|should|may|might|must|can|could|am|of|in|to|for|with|on|at|from|by|about|as|into|like|through|after|over|between|out|against|during|without|before|under|around|among|and|or|not|but|if|then|else|when|up|down|all|each|every|both|few|more|most|other|some|such|only|own|same|so|than|too|very|just|now|it|its|i|my|me|we|our|us|you|your|he|she|they|them|their|this|that|these|those|here|there|what|which|who|whom|where|when|why|how)\b/gi,
          "",
        )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

    const query = rawQuery || incomingMessage.trim().slice(0, 200);

    const scopeLabel =
      !supportDocId || supportDocId === "all"
        ? "all documents"
        : `"${selectedTitle ?? supportDocId}"`;

    console.log("[flagged][support] searching knowledge base", {
      thread_id: item.thread_id,
      sender: item.sender,
      intent_category: item.intent_category,
      total_docs: docCount,
      kb_documents: docTitles,
      selected_doc_id: supportDocId,
      selected_doc_title: selectedTitle,
      scope: scopeLabel,
      query: query.slice(0, 200),
    });

    // 2. Search chunks via full-text search — filter by doc when a specific
    //    document is selected (not "all" and not null).
    let chunkQuery = (supabase
      .from("support_doc_chunks") as any)
      .select("id,doc_id,chunk_index,content")
      .textSearch("search_vector", query, { type: "websearch" })
      .limit(8);

    if (supportDocId && supportDocId !== "all") {
      chunkQuery = chunkQuery.eq("doc_id", supportDocId);
    }

    const { data: chunks, error: searchErr } = await chunkQuery;

    if (searchErr) {
      console.error("[flagged][support] search failed", searchErr);
      throw searchErr;
    }

    const matchedChunks = (chunks ?? []) as {
      id: string;
      doc_id: string;
      chunk_index: number;
      content: string;
    }[];

    console.log("[flagged][support] search results", {
      thread_id: item.thread_id,
      chunk_count: matchedChunks.length,
      doc_ids: [...new Set(matchedChunks.map((c) => c.doc_id))],
      scope: scopeLabel,
    });

    if (matchedChunks.length > 0) {
      // 3a. Build title map from the upfront fetch (no extra DB round-trip).
      const docIds = [...new Set(matchedChunks.map((c) => c.doc_id))];
      const titleMap = new Map<string, string>();
      for (const d of allDocs ?? []) {
        if (docIds.includes(d.id)) {
          titleMap.set(d.id, (d as { title: string }).title);
        }
      }

      // Group chunks by document, preserving rank order.
      const seen = new Set<string>();
      const docChunks: { title: string; excerpts: string[] }[] = [];
      for (const c of matchedChunks) {
        const docId = c.doc_id;
        if (seen.has(docId)) continue;
        seen.add(docId);
        const title = titleMap.get(docId) ?? "Uploaded document";
        const excerpts = matchedChunks
          .filter((x) => x.doc_id === docId)
          .sort((a, b) => a.chunk_index - b.chunk_index)
          .map((x) => x.content);
        docChunks.push({ title, excerpts });
      }

      console.log("[flagged][support] using knowledge blocks", {
        thread_id: item.thread_id,
        matched_docs: docChunks.map((d) => d.title),
        excerpt_count: docChunks.reduce((s, d) => s + d.excerpts.length, 0),
        scope: scopeLabel,
      });

      const knowledgeBlock = [
        SUPPORT_HEADER,
        "RELEVANT SUPPORT KNOWLEDGE",
        supportDocId && supportDocId !== "all"
          ? `(Source: "${selectedTitle}" — ONLY use the information below to answer. If nothing below answers the question, say you don't have that specific information and suggest the customer contact the business directly. Do NOT invent policies, prices, rules, refund terms, cancellation terms, shipping details, or technical procedures.)`
          : "(from uploaded business documents — ONLY use the information below to answer. If nothing below answers the question, say you don't have that specific information and suggest the customer contact the business directly. Do NOT invent policies, prices, rules, refund terms, cancellation terms, shipping details, or technical procedures.)",
        "",
        ...docChunks.flatMap((dc) => [
          `[Document: "${dc.title}"]`,
          ...dc.excerpts.map((e) => `- ${e}`),
          "",
        ]),
      ].join("\n");

      const combined = `${knowledgeBlock}\n---\nUser instruction: ${userInstruction}`;
      instruction =
        combined.length > 8000 ? combined.slice(0, 7997) + "..." : combined;
    } else {
      // 3b. No chunks matched — or no documents uploaded at all.
      console.log("[flagged][support] no matching chunks", {
        thread_id: item.thread_id,
        total_docs: docCount,
        kb_documents: docTitles,
        scope: scopeLabel,
        selected_doc_id: supportDocId,
        query: query.slice(0, 200),
      });

      const noContextBlock = [
        SUPPORT_HEADER,
        docCount === 0
          ? "No support documents have been uploaded yet. Treat this as a general customer service inquiry."
          : supportDocId && supportDocId !== "all"
            ? `The selected document ("${selectedTitle}") did not contain relevant information for this query.`
            : "No relevant support knowledge was found in the uploaded documents for this specific query.",
        supportDocId && supportDocId !== "all"
          ? `IMPORTANT: You are restricted to the document "${selectedTitle}". If nothing in that document answers the question, say: "The document I have on file doesn't cover this specific situation. Let me check with the team and get back to you."`
          : "",
        "",
        "HOW TO RESPOND:",
        "- Answer ONLY from general customer service best practices.",
        "- Be polite, empathetic, and acknowledge the customer's problem.",
        "- If the question is about a specific policy, price, refund, warranty, shipping procedure, or technical instruction — say: \"I don't have that specific information on hand. Let me check with the team and get back to you.\"",
        "- Do NOT invent business-specific rules, prices, timelines, or procedures.",
        "- If appropriate, suggest the customer call or email the business directly for urgent matters.",
        "- Keep the reply concise and friendly.",
        "",
      ].join("\n");
      const combined = `${noContextBlock}\n---\nUser instruction: ${userInstruction}`;
      instruction =
        combined.length > 8000 ? combined.slice(0, 7997) + "..." : combined;
    }

    console.log("[flagged][support] instruction built", {
      thread_id: item.thread_id,
      instruction_len: instruction.length,
      has_chunks: matchedChunks.length > 0,
      scope: scopeLabel,
    });
  } catch (e) {
    console.error("[flagged][support] buildSupportInstruction failed", e);
    updateDraft(item.thread_id, {
      loading: false,
      error: "Could not query support knowledge base.",
    });
    toast({
      title: "Support search failed",
      description:
        "Could not query the support knowledge base. Try again.",
      variant: "destructive",
    });
    return null;
  }

  return instruction;
}
