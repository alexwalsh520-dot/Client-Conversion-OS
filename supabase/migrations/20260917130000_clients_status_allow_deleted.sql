-- clients.status: allow 'deleted' so soft-delete can flip a client out
-- of every V3 surface without hard-removing the row.
--
-- Applied live in Supabase alongside this file (MAS 2026-09-17). The
-- V3 clients_status_check previously only accepted 'active' or
-- 'completed', which made the soft_delete_client action fail with a
-- constraint violation.

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'deleted'::text]));
