-- support_docs
CREATE TABLE public.support_docs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  filename TEXT,
  content TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_docs TO authenticated;
GRANT ALL ON public.support_docs TO service_role;

ALTER TABLE public.support_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own support docs" ON public.support_docs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own support docs" ON public.support_docs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own support docs" ON public.support_docs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own support docs" ON public.support_docs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_support_docs_updated_at
  BEFORE UPDATE ON public.support_docs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_support_docs_user ON public.support_docs(user_id, created_at DESC);

-- support_doc_chunks
CREATE TABLE public.support_doc_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_id UUID NOT NULL REFERENCES public.support_docs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_doc_chunks TO authenticated;
GRANT ALL ON public.support_doc_chunks TO service_role;

ALTER TABLE public.support_doc_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own support chunks" ON public.support_doc_chunks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own support chunks" ON public.support_doc_chunks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own support chunks" ON public.support_doc_chunks
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own support chunks" ON public.support_doc_chunks
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_support_doc_chunks_doc ON public.support_doc_chunks(doc_id, chunk_index);
CREATE INDEX idx_support_doc_chunks_search ON public.support_doc_chunks USING GIN(search_vector);
CREATE INDEX idx_support_doc_chunks_user ON public.support_doc_chunks(user_id);