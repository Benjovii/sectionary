# Sectionary web

The browse app, in Next Level's design language. Next 16, React 19, Tailwind 4.
Live at https://sectionary-pink.vercel.app (Vercel project `sectionary`).

```powershell
cd D:\dev\sectionary\web
$env:npm_config_cache="D:\dev\_claude-tmp\npm-cache"; $env:TEMP="D:\dev\_claude-tmp\temp"; $env:TMP="D:\dev\_claude-tmp\temp"
npm install
npm run dev          # http://localhost:3000
npm run build
vercel deploy --prod --yes
```

Until the database exists (SEC-10, SEC-11) the wall reads
`public/sample/blocks.json`, produced by `node scripts/export-sample.mjs` in
the repo root. The folder is git-ignored; the Vercel CLI uploads it with each
deploy.

Where things are:

- `src/app/globals.css`: Next Level tokens (light and dark), base layer, the
  masonry `.wall` and the `.shimmer` skeleton.
- `src/app/layout.tsx`: fonts (Inter, Bricolage Grotesque, Geist Mono) and the
  theme provider, dark by default.
- `src/components/app-shell.tsx`: 48px top bar with the block-mark logo.
- `src/components/wall.tsx`: the browse wall, filters synced to the URL
  (`?page=&block=&vp=&q=`), skeletons, empty state.
- `src/components/block-card.tsx`: aspect-ratio-reserving card with blur-up.
- `src/components/block-dialog.tsx`: native `<dialog>` detail view.
- `vercel.json` pins the framework; without it a CLI-created project served
  only `/public`.
