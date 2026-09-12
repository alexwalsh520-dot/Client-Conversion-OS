-- Shared coaching questions can exist before any report is imported.
begin;
alter table public.everfit_questions alter column report_id drop not null;
commit;
