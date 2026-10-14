create or replace function public.cineblock_guard_project_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is distinct from 'cf4a51e8-825e-4db4-8b8a-037d3908663c'::uuid
       or new.owner_id is distinct from 'cf4a51e8-825e-4db4-8b8a-037d3908663c'::uuid then
      raise exception 'Only the CineBlock operator can create cloud projects'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'Project ownership cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists cineblock_guard_project_owner on public.cineblock_projects;
create trigger cineblock_guard_project_owner
before insert or update of owner_id on public.cineblock_projects
for each row execute function public.cineblock_guard_project_owner();

revoke all on function public.cineblock_guard_project_owner() from public, anon;
grant execute on function public.cineblock_guard_project_owner() to authenticated, service_role;
