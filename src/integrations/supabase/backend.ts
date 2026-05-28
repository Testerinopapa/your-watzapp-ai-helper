// Second Supabase client pointing at the send-smart-backend project.
// Used for Realtime subscriptions on thread_states / thread_state_history.
// Auth tokens are bridged: we set the user's session JWT on this client too,
// because the backend project trusts JWTs from the dashboard project (same
// JWT secret / shared auth) — confirmed by usage-get returning 200 with the
// dashboard's access_token.
import { createClient } from "@supabase/supabase-js";

export const SEND_SMART_URL = "https://ocpphyjkstvfespxrajk.supabase.co";
export const SEND_SMART_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcHBoeWprc3R2ZmVzcHhyYWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODExMzUsImV4cCI6MjA5Mjc1NzEzNX0.wcqrpSVkgDZRPet_4yLcF5YYISsWqRacVNOHf_eW8uY";

export const sendSmartBackend = createClient(SEND_SMART_URL, SEND_SMART_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});
