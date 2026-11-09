-- Bot: conversations, messages, memory facts, reminders, confirmations and the
-- action journal (final state of platform migrations 0018, 0047, 0052, 0058,
-- 0059, 0070 and 0088 for these tables). Idempotent.

CREATE TABLE IF NOT EXISTS public.bot_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid,
    channel text DEFAULT 'web'::text NOT NULL,
    tool text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    confirmation_id uuid,
    args_hash text,
    entity_type text,
    entity_id text,
    error_code text,
    confirmed_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_actions_card_check CHECK (((kind = 'card'::text) = (confirmation_id IS NOT NULL))),
    CONSTRAINT bot_actions_channel_check CHECK ((channel = ANY (ARRAY['web'::text, 'telegram'::text]))),
    CONSTRAINT bot_actions_entity_check CHECK ((((entity_type IS NULL) = (entity_id IS NULL)) AND ((entity_id IS NULL) OR (char_length(entity_id) <= 64)))),
    CONSTRAINT bot_actions_error_check CHECK (((error_code IS NULL) OR (error_code ~ '^[A-Z0-9_]{1,64}$'::text))),
    CONSTRAINT bot_actions_kind_check CHECK ((kind = ANY (ARRAY['card'::text, 'direct'::text]))),
    CONSTRAINT bot_actions_status_check CHECK ((status = ANY (ARRAY['awaiting_confirmation'::text, 'executing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'expired'::text, 'interrupted'::text]))),
    CONSTRAINT bot_actions_tool_check CHECK (((char_length(tool) >= 1) AND (char_length(tool) <= 64)))
);

ALTER TABLE ONLY public.bot_actions FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bot_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    tool text NOT NULL,
    args jsonb NOT NULL,
    args_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    accepted boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.bot_confirmations FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bot_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    channel text DEFAULT 'web'::text NOT NULL,
    session_token_hash text NOT NULL,
    locale text,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary text,
    linked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    campaign_id uuid,
    invite_id uuid,
    CONSTRAINT bot_conversations_channel_check CHECK ((channel = ANY (ARRAY['web'::text, 'mcp'::text])))
);

ALTER TABLE ONLY public.bot_conversations FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bot_memory_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    fact text NOT NULL,
    source text DEFAULT 'chat'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_memory_facts_fact_check CHECK (((char_length(fact) >= 1) AND (char_length(fact) <= 200))),
    CONSTRAINT bot_memory_facts_source_check CHECK ((source = ANY (ARRAY['chat'::text, 'site'::text])))
);

ALTER TABLE ONLY public.bot_memory_facts FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bot_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    tool_call jsonb,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    cost_micro_usd bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text, 'system_event'::text]))),
    CONSTRAINT bot_messages_usage_check CHECK (((tokens_in >= 0) AND (tokens_out >= 0) AND (cost_micro_usd >= 0)))
);

ALTER TABLE ONLY public.bot_messages FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bot_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    text text NOT NULL,
    remind_at timestamp with time zone NOT NULL,
    time_zone text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT bot_reminders_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 200)))
);

ALTER TABLE ONLY public.bot_reminders FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_actions_confirmation_id_key') THEN
    ALTER TABLE public.bot_actions ADD CONSTRAINT bot_actions_confirmation_id_key UNIQUE (confirmation_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_actions_pkey') THEN
    ALTER TABLE public.bot_actions ADD CONSTRAINT bot_actions_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_confirmations_pkey') THEN
    ALTER TABLE public.bot_confirmations ADD CONSTRAINT bot_confirmations_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_pkey') THEN
    ALTER TABLE public.bot_conversations ADD CONSTRAINT bot_conversations_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_session_token_hash_key') THEN
    ALTER TABLE public.bot_conversations ADD CONSTRAINT bot_conversations_session_token_hash_key UNIQUE (session_token_hash);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_memory_facts_pkey') THEN
    ALTER TABLE public.bot_memory_facts ADD CONSTRAINT bot_memory_facts_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_messages_pkey') THEN
    ALTER TABLE public.bot_messages ADD CONSTRAINT bot_messages_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_reminders_pkey') THEN
    ALTER TABLE public.bot_reminders ADD CONSTRAINT bot_reminders_pkey PRIMARY KEY (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS bot_actions_open_idx ON public.bot_actions USING btree (status, created_at) WHERE (status = ANY (ARRAY['awaiting_confirmation'::text, 'executing'::text]));

CREATE INDEX IF NOT EXISTS bot_actions_user_idx ON public.bot_actions USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bot_confirmations_conversation_idx ON public.bot_confirmations USING btree (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bot_conversations_guest_idx ON public.bot_conversations USING btree (last_message_at) WHERE (user_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS bot_conversations_user_campaign_idx ON public.bot_conversations USING btree (user_id, campaign_id) WHERE ((user_id IS NOT NULL) AND (campaign_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS bot_conversations_user_idx ON public.bot_conversations USING btree (user_id, last_message_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS bot_conversations_user_invite_idx ON public.bot_conversations USING btree (user_id, invite_id) WHERE ((user_id IS NOT NULL) AND (invite_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS bot_conversations_user_job_idx ON public.bot_conversations USING btree (user_id, job_id) WHERE ((user_id IS NOT NULL) AND (job_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS bot_memory_facts_user_idx ON public.bot_memory_facts USING btree (user_id, created_at);

CREATE INDEX IF NOT EXISTS bot_messages_conversation_idx ON public.bot_messages USING btree (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS bot_messages_cost_idx ON public.bot_messages USING btree (created_at) WHERE (cost_micro_usd > 0);

CREATE INDEX IF NOT EXISTS bot_reminders_due_idx ON public.bot_reminders USING btree (remind_at) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS bot_reminders_user_idx ON public.bot_reminders USING btree (user_id, remind_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_actions_conversation_id_fkey') THEN
    ALTER TABLE public.bot_actions ADD CONSTRAINT bot_actions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_actions_user_id_fkey') THEN
    ALTER TABLE public.bot_actions ADD CONSTRAINT bot_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_confirmations_conversation_id_fkey') THEN
    ALTER TABLE public.bot_confirmations ADD CONSTRAINT bot_confirmations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_confirmations_user_id_fkey') THEN
    ALTER TABLE public.bot_confirmations ADD CONSTRAINT bot_confirmations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_campaign_id_fkey') THEN
    ALTER TABLE public.bot_conversations ADD CONSTRAINT bot_conversations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ugc_campaigns(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_invite_id_fkey') THEN
    ALTER TABLE public.bot_conversations ADD CONSTRAINT bot_conversations_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.ugc_invites(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_job_id_fkey') THEN
    ALTER TABLE public.bot_conversations ADD CONSTRAINT bot_conversations_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_conversations_user_id_fkey') THEN
    ALTER TABLE public.bot_conversations ADD CONSTRAINT bot_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_memory_facts_user_id_fkey') THEN
    ALTER TABLE public.bot_memory_facts ADD CONSTRAINT bot_memory_facts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_messages_conversation_id_fkey') THEN
    ALTER TABLE public.bot_messages ADD CONSTRAINT bot_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_reminders_user_id_fkey') THEN
    ALTER TABLE public.bot_reminders ADD CONSTRAINT bot_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.bot_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_actions' AND policyname = 'bot_actions_anon_deny') THEN
    CREATE POLICY bot_actions_anon_deny ON public.bot_actions TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_actions' AND policyname = 'bot_actions_app_rw_all') THEN
    CREATE POLICY bot_actions_app_rw_all ON public.bot_actions TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_actions' AND policyname = 'bot_actions_authenticated_deny') THEN
    CREATE POLICY bot_actions_authenticated_deny ON public.bot_actions TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.bot_confirmations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_confirmations' AND policyname = 'bot_confirmations_anon_deny') THEN
    CREATE POLICY bot_confirmations_anon_deny ON public.bot_confirmations TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_confirmations' AND policyname = 'bot_confirmations_app_rw_all') THEN
    CREATE POLICY bot_confirmations_app_rw_all ON public.bot_confirmations TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_confirmations' AND policyname = 'bot_confirmations_authenticated_deny') THEN
    CREATE POLICY bot_confirmations_authenticated_deny ON public.bot_confirmations TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_conversations' AND policyname = 'bot_conversations_anon_deny') THEN
    CREATE POLICY bot_conversations_anon_deny ON public.bot_conversations TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_conversations' AND policyname = 'bot_conversations_app_rw_all') THEN
    CREATE POLICY bot_conversations_app_rw_all ON public.bot_conversations TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_conversations' AND policyname = 'bot_conversations_authenticated_deny') THEN
    CREATE POLICY bot_conversations_authenticated_deny ON public.bot_conversations TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.bot_memory_facts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_memory_facts' AND policyname = 'bot_memory_facts_anon_deny') THEN
    CREATE POLICY bot_memory_facts_anon_deny ON public.bot_memory_facts TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_memory_facts' AND policyname = 'bot_memory_facts_app_rw_all') THEN
    CREATE POLICY bot_memory_facts_app_rw_all ON public.bot_memory_facts TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_memory_facts' AND policyname = 'bot_memory_facts_authenticated_deny') THEN
    CREATE POLICY bot_memory_facts_authenticated_deny ON public.bot_memory_facts TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.bot_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_messages' AND policyname = 'bot_messages_anon_deny') THEN
    CREATE POLICY bot_messages_anon_deny ON public.bot_messages TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_messages' AND policyname = 'bot_messages_app_rw_all') THEN
    CREATE POLICY bot_messages_app_rw_all ON public.bot_messages TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_messages' AND policyname = 'bot_messages_authenticated_deny') THEN
    CREATE POLICY bot_messages_authenticated_deny ON public.bot_messages TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.bot_reminders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_reminders' AND policyname = 'bot_reminders_anon_deny') THEN
    CREATE POLICY bot_reminders_anon_deny ON public.bot_reminders TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_reminders' AND policyname = 'bot_reminders_app_rw_all') THEN
    CREATE POLICY bot_reminders_app_rw_all ON public.bot_reminders TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bot_reminders' AND policyname = 'bot_reminders_authenticated_deny') THEN
    CREATE POLICY bot_reminders_authenticated_deny ON public.bot_reminders TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

-- Table rights for the app role, as on the platform.
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bot_actions TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bot_confirmations TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bot_conversations TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bot_memory_facts TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bot_messages TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bot_reminders TO app_rw;
