# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.


## Supabase cloud (development)

CineBlock remains local-first: IndexedDB continues to store the active workspace and Backup/Import remains available offline. The cloud UI uses the project's browser-safe Supabase publishable key; no service-role key belongs in frontend code.

Optional local overrides go in `.env.local` (do not commit private values):

```dotenv
VITE_SUPABASE_URL=https://pycxqqghkpkoqqgatprv.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_GRixB_y1fBvVfa777zhjXw_O7LCmSS_
```

The initial **Salin lokal ke cloud** action only imports into a cloud project that has no scenes. The import runs through a single database function/transaction and writes scenes, shots, floorplan elements, cameras, actors, lighting, props, and movements into separate relational rows. It refuses to overwrite a non-empty cloud project. Manual local-to-cloud sync now uses version-guarded OCC for project metadata, Scene, Shot, Floorplan elements, Camera, Actor, Lighting, Props, and Movement rows. Cloud-side edits are detected and reported rather than silently overwritten, but automatic cloud-to-local merge, live Realtime notifications, and an interactive conflict-resolution workflow are not enabled yet.
