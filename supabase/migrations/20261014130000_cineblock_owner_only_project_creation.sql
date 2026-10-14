drop policy if exists cineblock_projects_insert_owner on public.cineblock_projects;
create policy cineblock_projects_insert_cineblock_operator on public.cineblock_projects for insert to authenticated with check (auth.uid() = 'cf4a51e8-825e-4db4-8b8a-037d3908663c'::uuid and owner_id = 'cf4a51e8-825e-4db4-8b8a-037d3908663c'::uuid);
