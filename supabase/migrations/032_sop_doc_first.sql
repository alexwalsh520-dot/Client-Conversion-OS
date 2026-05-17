-- 032_sop_doc_first.sql
-- Pivot the SOP library to be doc-first per user/Alex feedback. All SOPs
-- are now native HTML rendered inline in CCOS dark mode (Notion-style).
-- PDF/DOCX upload becomes an import path that extracts text into the
-- TipTap editor; the original file is kept only as an optional audit ref.
--
-- Zero SOPs exist in production, so this is a pure schema add. No data
-- migration needed.

BEGIN;

ALTER TABLE public.sops
  ADD COLUMN IF NOT EXISTS body_html TEXT NOT NULL DEFAULT '';

ALTER TABLE public.sops
  ALTER COLUMN file_path DROP NOT NULL,
  ALTER COLUMN file_name DROP NOT NULL;

COMMENT ON COLUMN public.sops.body_html IS
  'SOP body as sanitized HTML. Rendered inline by the viewer (no PDF preview). Source of truth for SOP content; file_* columns are only an audit reference of the original imported file if one was used.';

COMMENT ON COLUMN public.sops.file_path IS
  'Optional audit reference: path to the original imported source file (PDF/DOCX). The SOP itself is rendered from body_html, not from this file.';

COMMIT;
