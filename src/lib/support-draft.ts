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
 * 2. Queries `support_doc_chunks` via full-text search for the most
 *    relevant chunks across all uploaded support documents.
 * 3. Formats them as a "RELEVANT SUPPORT KNOWLEDGE" block prepended
 *    to the user's instruction.
 * 4. Includes an anti-hallucination guard telling the AI to only use
 *    the provided information and to never reference the calendar.
 *
 * Returns null when a DB error occurs (caller should abort the draft).
 */
export async function buildSupportInstruction({
  item,
  incomingMessage,
  userInstruction,
  updateDraft,
  toast,
}: {
  item: FlaggedMessage;
  incomingMessage: string;
  userInstruction: string;
  updateDraft: (id: string, patch: Partial<DraftState>) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void;
}): Promise<string | null> {
  let instruction = userInstruction;

  try {
    // 0. Check how many docs exist so we can log whether the KB is empty.
    const { count: totalDocs, error: countErr } = await (supabase
      .from("support_docs") as any)
      .select("*", { count: "exact", head: true });

    const docCount = countErr ? 0 : (totalDocs ?? 0);

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

    console.log("[flagged][support] searching knowledge base", {
      thread_id: item.thread_id,
      sender: item.sender,
      intent_category: item.intent_category,
      total_docs: docCount,
      query: query.slice(0, 200),
    });

    // 2. Search chunks via full-text search.
    const { data: chunks, error: searchErr } = await (supabase
      .from("support_doc_chunks") as any)
      .select("id,doc_id,chunk_index,content")
      .textSearch("search_vector", query, { type: "websearch" })
      .limit(8);

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
    });

    if (matchedChunks.length > 0) {
      // 3a. Fetch document titles for grouping.
      const docIds = [...new Set(matchedChunks.map((c) => c.doc_id))];
      const { data: matchedDocs, error: docsErr } = await supabase
        .from("support_docs")
        .select("id,title")
        .in("id", docIds);

      if (docsErr) {
        console.error("[flagged][support] doc title fetch failed", docsErr);
      }

      const titleMap = new Map<string, string>();
      for (const d of matchedDocs ?? []) {
        titleMap.set(d.id, (d as { title: string }).title);
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
      });

      const knowledgeBlock = [
        SUPPORT_HEADER,
        "RELEVANT SUPPORT KNOWLEDGE",
        "(from uploaded business documents — ONLY use the information below to answer. If nothing below answers the question, say you don't have that specific information and suggest the customer contact the business directly. Do NOT invent policies, prices, rules, refund terms, cancellation terms, shipping details, or technical procedures.)",
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
      });

      const noContextBlock = [
        SUPPORT_HEADER,
        docCount === 0
          ? "No support documents have been uploaded yet. Treat this as a general customer service inquiry."
          : "No relevant support knowledge was found in the uploaded documents for this specific query.",
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
