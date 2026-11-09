-- Platform pieces bot needs. CI only; the real ones live elsewhere.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT USAGE ON SCHEMA public TO app_rw, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid UNIQUE,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'active',
  terms_accepted_at timestamptz,
  terms_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telegram_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL UNIQUE
);

-- Other owners' tables bot rows point at (foreign keys only).
CREATE TABLE IF NOT EXISTS public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS public.ugc_campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS public.ugc_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

-- The platform audit log; tests clean it, the core never writes it.
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  diff jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
