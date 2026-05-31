-- Durable storage of ad creative images.
-- Facebook's preview image URLs (external-*.fbcdn.net/emg1/...) expire within days,
-- so the Deep Dive can show blanks on older date ranges. At sync time we download
-- each ad's preview bytes (while Meta's URL is fresh) into our own public Storage
-- bucket and record the stable URL here, keyed by ad_id. The dashboard payload then
-- prefers stored_image_url, falling back to the live Facebook URL.
create table if not exists ad_creative_image (
  ad_id text primary key,
  client_key text,
  source_image_url text,
  stored_image_url text,
  stored_at timestamptz default now()
);

create index if not exists ad_creative_image_stored_idx
  on ad_creative_image (ad_id)
  where stored_image_url is not null;
