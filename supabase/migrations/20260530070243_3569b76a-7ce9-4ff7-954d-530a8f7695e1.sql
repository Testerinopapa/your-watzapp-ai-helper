
-- Per-user Google OAuth tokens for Google Calendar
CREATE TABLE public.google_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  google_email TEXT,
  google_sub TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_tokens TO authenticated;
GRANT ALL ON public.google_oauth_tokens TO service_role;

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own google tokens"
  ON public.google_oauth_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own google tokens"
  ON public.google_oauth_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own google tokens"
  ON public.google_oauth_tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own google tokens"
  ON public.google_oauth_tokens FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_google_oauth_tokens_updated
BEFORE UPDATE ON public.google_oauth_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- OAuth state (CSRF protection for /authorize -> /callback)
CREATE TABLE public.google_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  redirect_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_states TO authenticated;
GRANT ALL ON public.google_oauth_states TO service_role;

ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
-- No policies for end users; only service_role (edge functions) accesses this.

-- Normalized agenda events
CREATE TABLE public.agenda_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_event_id TEXT,
  thread_id TEXT,
  contact_name TEXT,
  contact_channel TEXT,
  title TEXT,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'imported',
  notes TEXT,
  html_link TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_events TO authenticated;
GRANT ALL ON public.agenda_events TO service_role;

ALTER TABLE public.agenda_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own agenda events"
  ON public.agenda_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own agenda events"
  ON public.agenda_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own agenda events"
  ON public.agenda_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own agenda events"
  ON public.agenda_events FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_agenda_events_user_start ON public.agenda_events(user_id, start_time);

CREATE TRIGGER trg_agenda_events_updated
BEFORE UPDATE ON public.agenda_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
