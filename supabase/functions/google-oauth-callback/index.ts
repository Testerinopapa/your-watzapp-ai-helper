// Google redirects here with ?code & ?state. We exchange the code, store tokens,
// then redirect the browser back to the app.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;
const DEFAULT_APP = "https://your-watzapp-ai-helper.lovable.app";
const REQUIRED_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function hasCalendarScope(scope: string | null | undefined) {
  return (scope ?? "").split(/\s+/).includes(REQUIRED_CALENDAR_SCOPE);
}

function htmlRedirect(target: string, message: string) {
  // Use a 302 redirect — most reliable, no CSP/inline-script concerns.
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}">
<title>Connecting…</title>
<body style="font-family:system-ui;background:#0a1620;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><p>${message}</p><p><a style="color:#73ffb8" href="${target}">Continue</a></p></div>`,
    { status: 302, headers: { "Content-Type": "text/html; charset=utf-8", "Location": target } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Look up state -> user
  let userId: string | null = null;
  let redirectTo: string = DEFAULT_APP + "/dashboard?gcal=ok";

  if (state) {
    const { data: st } = await admin
      .from("google_oauth_states")
      .select("user_id, redirect_to, expires_at")
      .eq("state", state)
      .maybeSingle();
    if (st && new Date(st.expires_at).getTime() > Date.now()) {
      userId = st.user_id;
      if (st.redirect_to) redirectTo = st.redirect_to + (st.redirect_to.includes("?") ? "&" : "?") + "gcal=ok";
    }
    await admin.from("google_oauth_states").delete().eq("state", state);
  }

  if (error || !code || !userId) {
    const target = (redirectTo || DEFAULT_APP).replace("gcal=ok", "gcal=error");
    return htmlRedirect(target, "Google connection failed.");
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${t}`);
    }
    const tok = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
      id_token?: string;
    };

    // Fetch userinfo
    let email: string | null = null;
    let sub: string | null = null;
    try {
      const uRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (uRes.ok) {
        const ui = await uRes.json();
        email = ui.email ?? null;
        sub = ui.sub ?? null;
      }
    } catch (_) { /* ignore */ }

    const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();

    if (!hasCalendarScope(tok.scope)) {
      console.error("google-oauth-callback missing required Calendar scope", {
        required_scope: REQUIRED_CALENDAR_SCOPE,
        granted_scope: tok.scope,
      });
      await admin.from("google_oauth_tokens").delete().eq("user_id", userId);
      const target = redirectTo.replace("gcal=ok", "gcal=scope_missing");
      return htmlRedirect(target, "Google Calendar access was not granted.");
    }

    // Upsert tokens (preserve refresh_token if Google didn't return a new one)
    const { data: existing } = await admin
      .from("google_oauth_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    const refresh = tok.refresh_token ?? existing?.refresh_token ?? null;

    const { error: upErr } = await admin.from("google_oauth_tokens").upsert({
      user_id: userId,
      access_token: tok.access_token,
      refresh_token: refresh,
      token_type: tok.token_type,
      scope: tok.scope,
      expires_at: expiresAt,
      google_email: email,
      google_sub: sub,
    }, { onConflict: "user_id" });
    if (upErr) throw upErr;

    return htmlRedirect(redirectTo, "Connected! Returning to app…");
  } catch (e) {
    console.error("google-oauth-callback error", e);
    const target = redirectTo.replace("gcal=ok", "gcal=error");
    return htmlRedirect(target, "Google connection failed.");
  }
});
