# CineBlock cross-device sync

## Design

- IndexedDB remains the primary local cache; localStorage remains a compatibility fallback.
- Supabase Auth anonymous sessions provide a per-browser identity without email, password, or magic-link login.
- The user's display name is stored in local browser preferences and Supabase user metadata.
- Each cloud project stores a project snapshot in `public.cineblock_projects.payload`; `revision` is a compare-and-swap guard.
- Supabase Realtime notifies connected devices about newer project revisions.
- If two devices edit the same revision, the stale write is rejected and the UI offers explicit choices instead of silently overwriting either version.
- Editor links are bearer links: anyone who has one can edit the project. Owners can revoke links through the existing project-access Edge Function.

## First-device activation

The first device needs a one-time owner bootstrap URL for the existing NEPTU cloud record. That link is created by trusted administration and is single-use. Open it on the laptop that already contains the local NEPTU project. If the cloud record is empty, the app seeds it from the local project. The bootstrap token is removed from the address bar after redemption.

## Pair another device

1. Open the synced project on the owner device.
2. Open **Sinkronisasi** and choose **Buat tautan editor**.
3. Open that URL on the phone and enter a display name when prompted.
4. The phone redeems the share link, downloads the cloud snapshot, and subscribes to realtime updates.
5. Both devices keep a local cache. Edits made offline stay local and are pushed when online, unless the cloud revision has changed; in that case, the app asks which version to keep.

## Local development

Copy `.env.example` to `.env.local`, then run `npm install` and `npm run dev`. The publishable key is intended for browser use. Never add a Supabase service-role/secret key to Vite environment variables or client code.

Anonymous sign-ins must be enabled in Supabase Auth settings for this project. The Edge Function `cineblock-project-access` must stay deployed with JWT verification enabled.
