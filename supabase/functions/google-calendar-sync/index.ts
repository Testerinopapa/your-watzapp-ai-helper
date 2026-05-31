// Pulls upcoming events from the user's primary Google Calendar and upserts
// them into public.agenda_events. Refreshes access token if needed.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
];

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hasCalendarScope(scope: string | null | undefined) {
  const parts = (scope ?? "").split(/\s+/);
  return CALENDAR_SCOPES.some((s) => parts.includes(s));
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  return await res.json() as { access_token: string; expires_in: number; token_type: string; scope: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: tok, error: tokErr } = await admin
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (tokErr) throw tokErr;
    if (!tok) {
      return jsonResponse({ error: "not_connected", message: "Google Calendar is not connected." }, 400);
    }
    if (!hasCalendarScope(tok.scope)) {
      await admin.from("google_oauth_tokens").delete().eq("user_id", userId);
      return jsonResponse({
        error: "calendar_scope_missing",
        message: "Google Calendar permission is missing. Please reconnect Google Calendar and approve read-only calendar access.",
      }, 409);
    }

    let accessToken: string = tok.access_token;
    const expired = !tok.expires_at || new Date(tok.expires_at).getTime() < Date.now();
    if (expired) {
      if (!tok.refresh_token) {
        return new Response(JSON.stringify({ error: "reauth_required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const refreshed = await refreshAccessToken(tok.refresh_token);
      accessToken = refreshed.access_token;
      if (refreshed.scope && !hasCalendarScope(refreshed.scope)) {
        await admin.from("google_oauth_tokens").delete().eq("user_id", userId);
        return jsonResponse({
          error: "calendar_scope_missing",
          message: "Google Calendar permission is missing. Please reconnect Google Calendar and approve read-only calendar access.",
        }, 409);
      }
      await admin.from("google_oauth_tokens").update({
        access_token: refreshed.access_token,
        expires_at: new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString(),
        token_type: refreshed.token_type,
        scope: refreshed.scope ?? tok.scope,
      }).eq("user_id", userId);
    }

    // Pull events: now -> +30 days
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const params = new URLSearchParams({
      timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250",
    });
    const evRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!evRes.ok) {
      const t = await evRes.text();
      throw new Error(`Calendar fetch failed: ${evRes.status} ${t}`);
    }
    const ev = await evRes.json();
    const items: any[] = ev.items ?? [];

    const now = new Date().toISOString();
    const rows = items
      .filter((it) => it.status !== "cancelled")
      .map((it) => ({
        user_id: userId,
        source_type: "google_calendar",
        source_event_id: it.id,
        title: it.summary ?? "(no title)",
        description: it.description ?? null,
        location: it.location ?? null,
        start_time: it.start?.dateTime ?? (it.start?.date ? new Date(it.start.date).toISOString() : null),
        end_time: it.end?.dateTime ?? (it.end?.date ? new Date(it.end.date).toISOString() : null),
        timezone: it.start?.timeZone ?? null,
        status: "imported",
        html_link: it.htmlLink ?? null,
        last_synced_at: now,
      }));

    if (rows.length) {
      const { error: upErr } = await admin
        .from("agenda_events")
        .upsert(rows, { onConflict: "user_id,source_type,source_event_id" });
      if (upErr) throw upErr;
    }

    return new Response(JSON.stringify({ synced: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("google-calendar-sync error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
