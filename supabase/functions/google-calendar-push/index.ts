// Creates / updates / deletes an event on the user's primary Google Calendar
// based on a row in public.agenda_events. Refreshes access token if needed.
//
// Request body:
//   { agenda_event_id: string, action?: "upsert" | "delete" }
//
// Behavior:
//   - "upsert" (default): POST or PATCH `/calendars/primary/events`.
//     Writes back source_event_id, html_link, source_type='google_calendar',
//     last_synced_at to the agenda_events row.
//   - "delete": DELETE on Google, then leaves the row to caller to delete locally.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;

const WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hasWriteScope(scope: string | null | undefined) {
  const parts = (scope ?? "").split(/\s+/);
  return WRITE_SCOPES.some((s) => parts.includes(s));
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
  return await res.json() as {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const agendaId: string | undefined = body?.agenda_event_id;
    const action: "upsert" | "delete" = body?.action === "delete" ? "delete" : "upsert";
    const sourceEventId: string | null = body?.source_event_id ?? null;
    if (!agendaId) return json({ error: "agenda_event_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // For delete with explicit source_event_id we can skip row lookup
    // because the caller already removed the DB row.
    let row: any = null;
    if (action !== "delete" || !sourceEventId) {
      const { data: rowData, error: rowErr } = await admin
        .from("agenda_events")
        .select("*")
        .eq("id", agendaId)
        .eq("user_id", userId)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!rowData) return json({ error: "not_found" }, 404);
      row = rowData;
    }

    const { data: tok, error: tokErr } = await admin
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (tokErr) throw tokErr;
    if (!tok) return json({ error: "not_connected", message: "Google Calendar is not connected." }, 400);
    if (!hasWriteScope(tok.scope)) {
      return json({
        error: "calendar_scope_missing",
        message: "Write access to Google Calendar is missing. Reconnect Google Calendar and approve event editing.",
      }, 409);
    }

    // Refresh token if expired
    let accessToken: string = tok.access_token;
    const expired = !tok.expires_at || new Date(tok.expires_at).getTime() < Date.now();
    if (expired) {
      if (!tok.refresh_token) return json({ error: "reauth_required" }, 400);
      const refreshed = await refreshAccessToken(tok.refresh_token);
      accessToken = refreshed.access_token;
      if (refreshed.scope && !hasWriteScope(refreshed.scope)) {
        return json({ error: "calendar_scope_missing" }, 409);
      }
      await admin.from("google_oauth_tokens").update({
        access_token: refreshed.access_token,
        expires_at: new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString(),
        token_type: refreshed.token_type,
        scope: refreshed.scope ?? tok.scope,
      }).eq("user_id", userId);
    }

    const baseUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const existingEventId: string | null = row.source_event_id ?? null;

    if (action === "delete") {
      if (!existingEventId) return json({ ok: true, skipped: "no_google_event" });
      const res = await fetch(`${baseUrl}/${encodeURIComponent(existingEventId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        const t = await res.text();
        throw new Error(`Google delete failed: ${res.status} ${t}`);
      }
      return json({ ok: true });
    }

    // Upsert
    if (!row.start_time) return json({ error: "start_time_required" }, 400);
    const startISO = row.start_time as string;
    const endISO = (row.end_time as string | null) ??
      new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();

    const payload: Record<string, unknown> = {
      summary: row.title ?? row.contact_name ?? "Appointment",
      description: row.description ?? row.notes ?? undefined,
      location: row.location ?? undefined,
      start: row.timezone
        ? { dateTime: startISO, timeZone: row.timezone }
        : { dateTime: startISO },
      end: row.timezone
        ? { dateTime: endISO, timeZone: row.timezone }
        : { dateTime: endISO },
    };

    const url = existingEventId
      ? `${baseUrl}/${encodeURIComponent(existingEventId)}`
      : baseUrl;
    const method = existingEventId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Google ${method} failed: ${res.status} ${t}`);
    }
    const ev = await res.json();

    const { error: updErr } = await admin
      .from("agenda_events")
      .update({
        source_type: "google_calendar",
        source_event_id: ev.id ?? existingEventId,
        html_link: ev.htmlLink ?? row.html_link ?? null,
        last_synced_at: new Date().toISOString(),
        status: row.status === "imported" ? "confirmed" : row.status,
      })
      .eq("id", agendaId);
    if (updErr) throw updErr;

    return json({ ok: true, event_id: ev.id, html_link: ev.htmlLink });
  } catch (e) {
    console.error("google-calendar-push error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
