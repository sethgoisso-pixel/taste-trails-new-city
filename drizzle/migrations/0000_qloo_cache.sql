CREATE TABLE public.qloo_cache (
  cache_key TEXT PRIMARY KEY,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.qloo_cache TO service_role;
ALTER TABLE public.qloo_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX qloo_cache_created_at_idx ON public.qloo_cache (created_at);