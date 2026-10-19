-- Allow a single-use owner bootstrap link for pairing the first device without login.
-- Ordinary share links remain editor/viewer; owner links are only created by trusted administration.
alter table public.cineblock_share_links
  drop constraint if exists cineblock_share_links_role_check;

alter table public.cineblock_share_links
  add constraint cineblock_share_links_role_check
  check (role = any (array['owner'::text, 'editor'::text, 'viewer'::text]));
