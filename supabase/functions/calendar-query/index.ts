// AI-tool endpoint: returns the authenticated user's Google Calendar data
// in a compact form, designed to be called by the draft-reply agent.
//
// Two operations (selected by `op` in the request body or query):
//   1. op="events"      → list events in [from, to]
//   2. op="freebusy"    → "am I free between from and to?" + conflicting events
//
// Auth: requires the user's Supabase access token in the Authorization header.
// We read from `agenda_events` (already synced via google-calendar-sync) so the
// response is fast and doesn't burn a Google API call per draft.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  op: z.enum(["events", "freebusy"]).default("events"),
  // ISO 8601 strings; default window = now → +14 days for events
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Cap result size
  limit: z.number().int().min(1).max(100).default(25),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub as string | undefined;
    if (claimsErr || !userId) return json({ error: "Unauthorized" }, 401);

    // Accept body OR query params (GET-friendly for tool callers)
    let raw: Record<string, unknown> = {};
    if (req.method === "GET") {
      const u = new URL(req.url);
      raw = Object.fromEntries(u.searchParams.entries());
      if (raw.limit) raw.limit = Number(raw.limit);
    } else {
      raw = await req.json().catch(() => ({}));
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
    }
    const { op, limit } = parsed.data;

    const now = Date.now();
    const from = parsed.data.from ?? new Date(now).toISOString();
    const to =
      parsed.data.to ??
      new Date(now + (op === "freebusy" ? 60 * 60 * 1000 : 14 * 24 * 3600 * 1000)).toISOString();

    const { data: rows, error: qErr } = await userClient
      .from("agenda_events")
      .select("id, title, description, location, start_time, end_time, timezone, html_link, source_type")
      .eq("user_id", userId)
      .gte("end_time", from)
      .lte("start_time", to)
      .order("start_time", { ascending: true })
      .limit(limit);

    if (qErr) throw qErr;

    const events = (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title ?? "(no title)",
      start: r.start_time,
      end: r.end_time,
      timezone: r.timezone,
      location: r.location,
      description: r.description,
      url: r.html_link,
      source: r.source_type,
    }));

    if (op === "freebusy") {
      return json({
        window: { from, to },
        busy: events.length > 0,
        conflicts: events,
      });
    }

    return json({
      window: { from, to },
      count: events.length,
      events,
    });
  } catch (e) {
    console.error("calendar-query error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
