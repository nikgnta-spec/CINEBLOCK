-- CineBlock relational collaboration schema.
-- Additive migration. Legacy public.projects and local-first browser storage are preserved.
-- These two tables were initially created outside version-controlled migrations, so
-- include their baseline definitions here for reproducible setup on a fresh Supabase project.
create table if not exists public.cineblock_projects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null default 'Proyek tanpa judul' check (char_length(name) between 1 and 200),
 payload jsonb not null default '{}'::jsonb,
 revision bigint not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.cineblock_project_members (
 project_id uuid not null references public.cineblock_projects(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'editor' check (role in ('owner','editor','viewer')),
 created_at timestamptz not null default now(),
 primary key (project_id,user_id)
);
alter table public.cineblock_projects enable row level security;
alter table public.cineblock_project_members enable row level security;
create index if not exists cineblock_projects_owner_updated_idx on public.cineblock_projects(owner_id,updated_at desc);
create index if not exists cineblock_project_members_user_idx on public.cineblock_project_members(user_id);

create or replace function public.cineblock_touch_project()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := pg_catalog.now(); new.revision := old.revision + 1; return new; end; $$;
drop trigger if exists cineblock_projects_touch on public.cineblock_projects;
create trigger cineblock_projects_touch before update on public.cineblock_projects
for each row execute function public.cineblock_touch_project();

create table if not exists public.cineblock_scenes (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.cineblock_projects(id) on delete cascade,
 name text not null default 'Scene 01' check (char_length(name) between 1 and 120),
 location text not null default '',
 int_ext text not null default 'INT' check (int_ext in ('INT','EXT','INT/EXT')),
 day_night text not null default 'DAY' check (day_night in ('DAY','NIGHT','DAWN','DUSK')),
 position integer not null default 0 check (position >= 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 version integer not null default 1 check (version > 0), unique (id, project_id)
);
create table if not exists public.cineblock_shots (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null references public.cineblock_scenes(id) on delete cascade,
 position integer not null default 0 check (position >= 0),
 subject text not null default '', size text not null default '', camera text not null default '',
 angle text not null default '', lens text not null default '',
 status text not null default 'planned' check (status in ('planned','done','skip')),
 storyboard_image text not null default '', sound text not null default '', take text not null default '',
 script text not null default '', setup text not null default '', est_shoot text not null default '',
 notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 version integer not null default 1 check (version > 0), unique (id, scene_id)
);
create table if not exists public.cineblock_floorplan_elements (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null references public.cineblock_scenes(id) on delete cascade,
 shot_id uuid,
 element_type text not null check (element_type in ('room','wall','door','window','opening','other')),
 label text not null default '',
 x double precision not null default 0, y double precision not null default 0,
 width double precision not null default 0, height double precision not null default 0,
 rotation double precision not null default 0,
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 version integer not null default 1 check (version > 0),
 foreign key (shot_id, scene_id) references public.cineblock_shots(id, scene_id) on delete cascade
);
create table if not exists public.cineblock_cameras (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null references public.cineblock_scenes(id) on delete cascade,
 shot_id uuid not null, label text not null default '',
 x double precision not null default 0, y double precision not null default 0,
 angle double precision not null default 0, movement text not null default '',
 path jsonb not null default '[]'::jsonb check (jsonb_typeof(path) = 'array'),
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 version integer not null default 1 check (version > 0), unique (shot_id),
 foreign key (shot_id, scene_id) references public.cineblock_shots(id, scene_id) on delete cascade
);
create table if not exists public.cineblock_actors (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null references public.cineblock_scenes(id) on delete cascade,
 shot_id uuid, label text not null default '',
 x double precision not null default 0, y double precision not null default 0, angle double precision not null default 0,
 path jsonb not null default '[]'::jsonb check (jsonb_typeof(path) = 'array'),
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null, version integer not null default 1 check (version > 0),
 foreign key (shot_id, scene_id) references public.cineblock_shots(id, scene_id) on delete cascade
);
create table if not exists public.cineblock_lighting (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null references public.cineblock_scenes(id) on delete cascade,
 shot_id uuid, label text not null default '', light_type text not null default 'Key',
 x double precision not null default 0, y double precision not null default 0, angle double precision not null default 0,
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null, version integer not null default 1 check (version > 0),
 foreign key (shot_id, scene_id) references public.cineblock_shots(id, scene_id) on delete cascade
);
create table if not exists public.cineblock_props (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null references public.cineblock_scenes(id) on delete cascade,
 shot_id uuid, label text not null default '', prop_type text not null default 'Custom',
 x double precision not null default 0, y double precision not null default 0,
 width double precision not null default 52, height double precision not null default 36,
 angle double precision not null default 0, locked boolean not null default false,
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null, version integer not null default 1 check (version > 0),
 foreign key (shot_id, scene_id) references public.cineblock_shots(id, scene_id) on delete cascade
);
create table if not exists public.cineblock_movements (
 id uuid primary key default gen_random_uuid(),
 shot_id uuid not null references public.cineblock_shots(id) on delete cascade,
 movement_type text not null, position integer not null default 0 check (position >= 0),
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null, version integer not null default 1 check (version > 0)
);

create index if not exists cineblock_scenes_project_position_idx on public.cineblock_scenes(project_id,position);
create index if not exists cineblock_shots_scene_position_idx on public.cineblock_shots(scene_id,position);
create index if not exists cineblock_floorplan_scene_idx on public.cineblock_floorplan_elements(scene_id);
create index if not exists cineblock_floorplan_shot_idx on public.cineblock_floorplan_elements(shot_id) where shot_id is not null;
create index if not exists cineblock_floorplan_shot_scene_idx on public.cineblock_floorplan_elements(shot_id,scene_id);
create index if not exists cineblock_floorplan_updated_by_idx on public.cineblock_floorplan_elements(updated_by);
create index if not exists cineblock_cameras_scene_idx on public.cineblock_cameras(scene_id);
create index if not exists cineblock_cameras_shot_scene_idx on public.cineblock_cameras(shot_id,scene_id);
create index if not exists cineblock_cameras_updated_by_idx on public.cineblock_cameras(updated_by);
create index if not exists cineblock_actors_scene_idx on public.cineblock_actors(scene_id);
create index if not exists cineblock_actors_shot_scene_idx on public.cineblock_actors(shot_id,scene_id);
create index if not exists cineblock_actors_updated_by_idx on public.cineblock_actors(updated_by);
create index if not exists cineblock_lighting_scene_idx on public.cineblock_lighting(scene_id);
create index if not exists cineblock_lighting_shot_scene_idx on public.cineblock_lighting(shot_id,scene_id);
create index if not exists cineblock_lighting_updated_by_idx on public.cineblock_lighting(updated_by);
create index if not exists cineblock_props_scene_idx on public.cineblock_props(scene_id);
create index if not exists cineblock_props_shot_scene_idx on public.cineblock_props(shot_id,scene_id);
create index if not exists cineblock_props_updated_by_idx on public.cineblock_props(updated_by);
create index if not exists cineblock_movements_shot_position_idx on public.cineblock_movements(shot_id,position);
create index if not exists cineblock_movements_updated_by_idx on public.cineblock_movements(updated_by);
create index if not exists cineblock_scenes_updated_by_idx on public.cineblock_scenes(updated_by);
create index if not exists cineblock_shots_updated_by_idx on public.cineblock_shots(updated_by);
create index if not exists cineblock_project_members_user_idx on public.cineblock_project_members(user_id);

create or replace function public.cineblock_touch_versioned_row()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := pg_catalog.now(); new.version := old.version + 1; new.updated_by := (select auth.uid()); return new; end; $$;
drop trigger if exists cineblock_scenes_touch_version on public.cineblock_scenes;
create trigger cineblock_scenes_touch_version before update on public.cineblock_scenes for each row execute function public.cineblock_touch_versioned_row();
drop trigger if exists cineblock_shots_touch_version on public.cineblock_shots;
create trigger cineblock_shots_touch_version before update on public.cineblock_shots for each row execute function public.cineblock_touch_versioned_row();
do $$ declare tbl text; begin
 foreach tbl in array array['cineblock_floorplan_elements','cineblock_cameras','cineblock_actors','cineblock_lighting','cineblock_props','cineblock_movements'] loop
  execute format('drop trigger if exists %I on public.%I',tbl||'_touch_version',tbl);
  execute format('create trigger %I before update on public.%I for each row execute function public.cineblock_touch_versioned_row()',tbl||'_touch_version',tbl);
 end loop;
end $$;

alter table public.cineblock_project_members drop constraint if exists cineblock_project_members_role_check;
alter table public.cineblock_project_members add constraint cineblock_project_members_role_check check (role in ('owner','editor','viewer'));

create or replace function public.cineblock_project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select case when exists(select 1 from public.cineblock_projects p where p.id=p_project_id and p.owner_id=(select auth.uid()))
 then 'owner' else (select m.role from public.cineblock_project_members m where m.project_id=p_project_id and m.user_id=(select auth.uid()) limit 1) end; $$;
create or replace function public.cineblock_scene_role(p_scene_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select public.cineblock_project_role(s.project_id) from public.cineblock_scenes s where s.id=p_scene_id; $$;
create or replace function public.cineblock_shot_role(p_shot_id uuid)
returns text language sql stable security definer set search_path = '' as $$
 select public.cineblock_scene_role(s.scene_id) from public.cineblock_shots s where s.id=p_shot_id; $$;
revoke all on function public.cineblock_project_role(uuid) from public,anon;
revoke all on function public.cineblock_scene_role(uuid) from public,anon;
revoke all on function public.cineblock_shot_role(uuid) from public,anon;
grant execute on function public.cineblock_project_role(uuid) to authenticated;
grant execute on function public.cineblock_scene_role(uuid) to authenticated;
grant execute on function public.cineblock_shot_role(uuid) to authenticated;

create or replace function public.cineblock_add_project_owner_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.cineblock_project_members(project_id,user_id,role) values(new.id,new.owner_id,'owner') on conflict(project_id,user_id) do update set role='owner'; return new; end; $$;
drop trigger if exists cineblock_projects_add_owner_membership on public.cineblock_projects;
revoke all on function public.cineblock_add_project_owner_membership() from public,anon,authenticated;
create trigger cineblock_projects_add_owner_membership after insert on public.cineblock_projects for each row execute function public.cineblock_add_project_owner_membership();
create or replace function public.cineblock_prevent_project_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin if new.owner_id is distinct from old.owner_id then raise exception 'Project ownership cannot be changed through a regular update'; end if; return new; end; $$;
drop trigger if exists cineblock_projects_prevent_owner_change on public.cineblock_projects;
create trigger cineblock_projects_prevent_owner_change before update on public.cineblock_projects for each row execute function public.cineblock_prevent_project_owner_change();

alter table public.cineblock_scenes enable row level security;
alter table public.cineblock_shots enable row level security;
alter table public.cineblock_floorplan_elements enable row level security;
alter table public.cineblock_cameras enable row level security;
alter table public.cineblock_actors enable row level security;
alter table public.cineblock_lighting enable row level security;
alter table public.cineblock_props enable row level security;
alter table public.cineblock_movements enable row level security;

drop policy if exists "CineBlock members can read shared projects" on public.cineblock_projects;
drop policy if exists "CineBlock owners can create projects" on public.cineblock_projects;
drop policy if exists "CineBlock owners can delete projects" on public.cineblock_projects;
drop policy if exists "CineBlock owners can read projects" on public.cineblock_projects;
drop policy if exists "CineBlock owners can update projects" on public.cineblock_projects;
drop policy if exists cineblock_projects_select_member on public.cineblock_projects;
drop policy if exists cineblock_projects_insert_owner on public.cineblock_projects;
drop policy if exists cineblock_projects_update_owner_editor on public.cineblock_projects;
drop policy if exists cineblock_projects_delete_owner on public.cineblock_projects;
create policy cineblock_projects_select_member on public.cineblock_projects for select to authenticated using(public.cineblock_project_role(id) is not null);
create policy cineblock_projects_insert_owner on public.cineblock_projects for insert to authenticated with check(owner_id=(select auth.uid()));
create policy cineblock_projects_update_owner_editor on public.cineblock_projects for update to authenticated using(public.cineblock_project_role(id) in ('owner','editor')) with check(public.cineblock_project_role(id) in ('owner','editor'));
create policy cineblock_projects_delete_owner on public.cineblock_projects for delete to authenticated using(public.cineblock_project_role(id)='owner');

drop policy if exists "CineBlock members can read memberships" on public.cineblock_project_members;
drop policy if exists "CineBlock owners can add memberships" on public.cineblock_project_members;
drop policy if exists "CineBlock owners can remove memberships" on public.cineblock_project_members;
drop policy if exists cineblock_members_select_project on public.cineblock_project_members;
drop policy if exists cineblock_members_insert_owner on public.cineblock_project_members;
drop policy if exists cineblock_members_update_owner on public.cineblock_project_members;
drop policy if exists cineblock_members_delete_owner on public.cineblock_project_members;
create policy cineblock_members_select_project on public.cineblock_project_members for select to authenticated using(public.cineblock_project_role(project_id) is not null);
create policy cineblock_members_insert_owner on public.cineblock_project_members for insert to authenticated with check(public.cineblock_project_role(project_id)='owner' and role in ('editor','viewer') and user_id <> (select p.owner_id from public.cineblock_projects p where p.id=project_id));
create policy cineblock_members_update_owner on public.cineblock_project_members for update to authenticated using(public.cineblock_project_role(project_id)='owner' and role <> 'owner') with check(public.cineblock_project_role(project_id)='owner' and role in ('editor','viewer') and user_id <> (select p.owner_id from public.cineblock_projects p where p.id=project_id));
create policy cineblock_members_delete_owner on public.cineblock_project_members for delete to authenticated using(public.cineblock_project_role(project_id)='owner' and role <> 'owner');

create policy cineblock_scenes_select on public.cineblock_scenes for select to authenticated using(public.cineblock_project_role(project_id) is not null);
create policy cineblock_scenes_insert on public.cineblock_scenes for insert to authenticated with check(public.cineblock_project_role(project_id) in ('owner','editor'));
create policy cineblock_scenes_update on public.cineblock_scenes for update to authenticated using(public.cineblock_project_role(project_id) in ('owner','editor')) with check(public.cineblock_project_role(project_id) in ('owner','editor'));
create policy cineblock_scenes_delete on public.cineblock_scenes for delete to authenticated using(public.cineblock_project_role(project_id)='owner');

create policy cineblock_shots_select on public.cineblock_shots for select to authenticated using(public.cineblock_scene_role(scene_id) is not null);
create policy cineblock_shots_insert on public.cineblock_shots for insert to authenticated with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_shots_update on public.cineblock_shots for update to authenticated using(public.cineblock_scene_role(scene_id) in ('owner','editor')) with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_shots_delete on public.cineblock_shots for delete to authenticated using(public.cineblock_scene_role(scene_id)='owner');

create policy cineblock_floorplan_select on public.cineblock_floorplan_elements for select to authenticated using(public.cineblock_scene_role(scene_id) is not null);
create policy cineblock_floorplan_insert on public.cineblock_floorplan_elements for insert to authenticated with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_floorplan_update on public.cineblock_floorplan_elements for update to authenticated using(public.cineblock_scene_role(scene_id) in ('owner','editor')) with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_floorplan_delete on public.cineblock_floorplan_elements for delete to authenticated using(public.cineblock_scene_role(scene_id)='owner');

create policy cineblock_cameras_select on public.cineblock_cameras for select to authenticated using(public.cineblock_shot_role(shot_id) is not null);
create policy cineblock_cameras_insert on public.cineblock_cameras for insert to authenticated with check(public.cineblock_shot_role(shot_id) in ('owner','editor'));
create policy cineblock_cameras_update on public.cineblock_cameras for update to authenticated using(public.cineblock_shot_role(shot_id) in ('owner','editor')) with check(public.cineblock_shot_role(shot_id) in ('owner','editor'));
create policy cineblock_cameras_delete on public.cineblock_cameras for delete to authenticated using(public.cineblock_shot_role(shot_id)='owner');

create policy cineblock_actors_select on public.cineblock_actors for select to authenticated using(public.cineblock_scene_role(scene_id) is not null);
create policy cineblock_actors_insert on public.cineblock_actors for insert to authenticated with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_actors_update on public.cineblock_actors for update to authenticated using(public.cineblock_scene_role(scene_id) in ('owner','editor')) with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_actors_delete on public.cineblock_actors for delete to authenticated using(public.cineblock_scene_role(scene_id)='owner');

create policy cineblock_lighting_select on public.cineblock_lighting for select to authenticated using(public.cineblock_scene_role(scene_id) is not null);
create policy cineblock_lighting_insert on public.cineblock_lighting for insert to authenticated with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_lighting_update on public.cineblock_lighting for update to authenticated using(public.cineblock_scene_role(scene_id) in ('owner','editor')) with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_lighting_delete on public.cineblock_lighting for delete to authenticated using(public.cineblock_scene_role(scene_id)='owner');

create policy cineblock_props_select on public.cineblock_props for select to authenticated using(public.cineblock_scene_role(scene_id) is not null);
create policy cineblock_props_insert on public.cineblock_props for insert to authenticated with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_props_update on public.cineblock_props for update to authenticated using(public.cineblock_scene_role(scene_id) in ('owner','editor')) with check(public.cineblock_scene_role(scene_id) in ('owner','editor'));
create policy cineblock_props_delete on public.cineblock_props for delete to authenticated using(public.cineblock_scene_role(scene_id)='owner');

create policy cineblock_movements_select on public.cineblock_movements for select to authenticated using(public.cineblock_shot_role(shot_id) is not null);
create policy cineblock_movements_insert on public.cineblock_movements for insert to authenticated with check(public.cineblock_shot_role(shot_id) in ('owner','editor'));
create policy cineblock_movements_update on public.cineblock_movements for update to authenticated using(public.cineblock_shot_role(shot_id) in ('owner','editor')) with check(public.cineblock_shot_role(shot_id) in ('owner','editor'));
create policy cineblock_movements_delete on public.cineblock_movements for delete to authenticated using(public.cineblock_shot_role(shot_id)='owner');

grant select,insert,update,delete on public.cineblock_projects,public.cineblock_project_members,public.cineblock_scenes,public.cineblock_shots,public.cineblock_floorplan_elements,public.cineblock_cameras,public.cineblock_actors,public.cineblock_lighting,public.cineblock_props,public.cineblock_movements to authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['cineblock_scenes','cineblock_shots','cineblock_floorplan_elements','cineblock_cameras','cineblock_actors','cineblock_lighting','cineblock_props','cineblock_movements'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tbl) then execute format('alter publication supabase_realtime add table public.%I',tbl); end if;
 end loop;
end $$;
