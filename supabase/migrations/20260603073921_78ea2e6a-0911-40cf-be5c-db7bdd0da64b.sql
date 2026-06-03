-- Folders, assignments, dismissals for the flagged review section.
-- Previously stored in localStorage (per-browser, evictable). Moving to DB so they
-- sync across browsers/devices and survive storage clears.

CREATE TABLE public.flagged_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, folder_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flagged_folders TO authenticated;
GRANT ALL ON public.flagged_folders TO service_role;
ALTER TABLE public.flagged_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own flagged folders" ON public.flagged_folders
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own flagged folders" ON public.flagged_folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own flagged folders" ON public.flagged_folders
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own flagged folders" ON public.flagged_folders
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_flagged_folders_updated
  BEFORE UPDATE ON public.flagged_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.flagged_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, thread_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flagged_assignments TO authenticated;
GRANT ALL ON public.flagged_assignments TO service_role;
ALTER TABLE public.flagged_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own flagged assignments" ON public.flagged_assignments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own flagged assignments" ON public.flagged_assignments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own flagged assignments" ON public.flagged_assignments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own flagged assignments" ON public.flagged_assignments
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_flagged_assignments_updated
  BEFORE UPDATE ON public.flagged_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.flagged_dismissals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, thread_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flagged_dismissals TO authenticated;
GRANT ALL ON public.flagged_dismissals TO service_role;
ALTER TABLE public.flagged_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own flagged dismissals" ON public.flagged_dismissals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own flagged dismissals" ON public.flagged_dismissals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own flagged dismissals" ON public.flagged_dismissals
  FOR DELETE USING (auth.uid() = user_id);
