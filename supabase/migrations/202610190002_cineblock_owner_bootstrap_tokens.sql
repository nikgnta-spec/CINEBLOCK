-- One-time owner activation token for the first device.
-- Only the Edge Function service role can read or redeem these records.
create table if not exists public.cineblock_owner_bootstrap_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id)
);

alter table public.cineblock_owner_bootstrap_tokens enable row level security;
revoke all on table public.cineblock_owner_bootstrap_tokens from anon, authenticated;

insert into public.cineblock_owner_bootstrap_tokens (token_hash, expires_at)
values ('f93517065f5fba91ce02e5bfda73e5af9ea75346c36aecd5eafc54792c1cf914', now() + interval '24 hours')
on conflict (token_hash) do nothing;
