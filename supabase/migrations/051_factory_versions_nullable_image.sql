-- Doc/version snapshots have no image. image_url was NOT NULL, which silently
-- broke text version history for every non-image factory item (the snapshot
-- insert threw and was swallowed). Make image_url and kind nullable so doc
-- versioning persists reliably from both the app and bulk edits.
alter table factory_item_versions alter column image_url drop not null;
alter table factory_item_versions alter column kind drop not null;
