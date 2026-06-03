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

/**
 * Builds a draft instruction enriched with relevant support knowledge.
 *
 * 1. Derives a search query from the incoming message + user instruction.
 * 2. Queries `support_doc_chunks` via full-text search for the most
 *    relevant chunks across all uploaded support documents.
 * 3. Formats them as a "RELEVANT SUPPORT KNOWLEDGE" block prepended
 *    to the user's instruction.
 * 4. Includes an anti-hallucination guard telling the AI to only use
 *    the provided information.
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
    // Build a search query from the incoming message and user instruction.
    // Strip common stop words and punctuation to get meaningful terms.
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

    // Search chunks via full-text search.
    const { data: chunks, error: searchErr } = await (supabase
      .from("support_doc_chunks") as any)
      .select("id,doc_id,chunk_index,content")
      .textSearch("search_vector", query, { type: "websearch" })
      .limit(8);

    if (searchErr) {
      console.error("support doc search failed", searchErr);
      throw searchErr;
    }

    const matchedChunks = (chunks ?? []) as {
      id: string;
      doc_id: string;
      chunk_index: number;
      content: string;
    }[];

    if (matchedChunks.length > 0) {
      // Fetch the document titles for grouping.
      const docIds = [...new Set(matchedChunks.map((c) => c.doc_id))];
      const { data: matchedDocs, error: docsErr } = await supabase
        .from("support_docs")
        .select("id,title")
        .in("id", docIds);

      if (docsErr) {
        console.error("support doc title fetch failed", docsErr);
        // Continue without titles — chunks are still useful.
      }

      const titleMap = new Map<string, string>();
      for (const d of matchedDocs ?? []) {
        titleMap.set(d.id, (d as { title: string }).title);
      }

      // Group chunks by document, preserving rank order.
      const seen = new Set<string>();
      const docChunks: {
        title: string;
        excerpts: string[];
      }[] = [];
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

      const knowledgeBlock = [
        "RELEVANT SUPPORT KNOWLEDGE",
        "(from uploaded documents — ONLY use information found below. If nothing below answers the question, say you don't have that information and should flag this for manual human review. Do NOT invent policies, prices, rules, refund policies, cancellation terms, or technical instructions that are not explicitly in the text below.)",
        "",
        ...docChunks.flatMap((dc) => [
          `[Document: "${dc.title}"]`,
          ...dc.excerpts.map((e) => `- ${e}`),
          "",
        ]),
      ].join("\n");

      // Prepend the knowledge to the instruction, capping at 8000 chars.
      const combined = `${knowledgeBlock}\n---\nUser instruction: ${userInstruction}`;
      instruction =
        combined.length > 8000 ? combined.slice(0, 7997) + "..." : combined;
    } else {
      // No chunks found — tell the AI not to guess.
      const noContextBlock = [
        "No relevant support knowledge was found in the uploaded documents for this query.",
        "ONLY respond using the following rules:",
        "- If you definitively know the answer from general knowledge (e.g., business hours, basic greetings), you may respond politely.",
        "- If the question asks about policies, prices, returns, refunds, warranties, shipping, or technical procedures — say you don't have that information and flag this for manual human review.",
        "- Do NOT invent or assume any business-specific rules.",
        "",
      ].join("\n");
      const combined = `${noContextBlock}\n---\nUser instruction: ${userInstruction}`;
      instruction =
        combined.length > 8000 ? combined.slice(0, 7997) + "..." : combined;
    }
  } catch (e) {
    console.error("buildSupportInstruction failed", e);
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
