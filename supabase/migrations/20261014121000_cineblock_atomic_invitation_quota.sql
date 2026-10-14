create or replace function public.cineblock_consume_invitation_quota(
  p_inviter_id uuid,
  p_project_id uuid,
  p_invitee_email text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_inviter_id::text, 0));

  select count(*) into v_count
  from public.cineblock_invitation_events
  where inviter_id = p_inviter_id
    and created_at >= pg_catalog.now() - interval '1 hour';

  if v_count >= 8 then
    return false;
  end if;

  insert into public.cineblock_invitation_events(project_id, inviter_id, invitee_email)
  values (p_project_id, p_inviter_id, pg_catalog.lower(pg_catalog.btrim(p_invitee_email)));

  return true;
end;
$$;

revoke all on function public.cineblock_consume_invitation_quota(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cineblock_consume_invitation_quota(uuid, uuid, text) to service_role;