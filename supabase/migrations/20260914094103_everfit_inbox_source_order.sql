-- Everfit uses lexically ordered native message keys. Database locale ordering
-- must not move uppercase/lowercase/underscore keys out of source order.
alter table public.everfit_inbox_messages alter column message_id type text collate "C";
