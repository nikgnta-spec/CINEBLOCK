# CineBlock Supabase backend foundation

This migration is additive and does not modify or delete the legacy `public.projects` table.

## First migration

1. Open the intended Supabase project and verify its project name before running SQL.
2. Open SQL Editor and create a new query.
3. Paste the complete contents of `supabase/migrations/202610110001_cineblock_cloud_storage.sql`.
4. Run it, then verify that `cineblock_projects` and `cineblock_project_members` exist in the `public` schema.
5. Do not delete or repurpose `public.projects`; the existing NEPTU row is left untouched.

## Initial security posture

- Row Level Security is enabled on both new tables.
- Signed-in owners can create, read, update, and delete their own cloud projects.
- A user can read their membership rows; project owners can manage membership rows.
- Members can read shared project data. Member write permissions are intentionally not enabled until conflict-safe collaboration writes are implemented.
- No service-role secret belongs in frontend code or Vite environment variables.

## Application connection

The app does not yet switch its active save/load path to cloud storage. That change must follow only after the migration is applied and the authentication UX, local-to-cloud import/migration, revision conflict behavior, and offline queue have been implemented and tested. The local IndexedDB/localStorage path remains the active storage path for now.

When frontend SDK integration is added, use a Supabase publishable/anon key only:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never commit real keys or a `.env.local` file.

## Collaboration roadmap

1. Authenticated cloud project CRUD and explicit import of local projects.
2. Optimistic concurrency using the `revision` column; reject stale writes instead of silently overwriting.
3. IndexedDB outbox for offline edits and explicit sync state.
4. Realtime invalidation/refresh for other clients; do not treat realtime events as durable storage.
5. Enable editor write policy only after conflict-safe mutation RPCs or equivalent transactional checks are in place.
6. Revisit H-1, M-3, and M-4 after the cloud/local synchronization behavior is implemented.
