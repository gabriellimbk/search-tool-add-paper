This folder is the hosted converter package intended for Git and deployment.

Included:
- `app/`
- `lib/`
- `package.json`
- `package-lock.json`
- `next.config.ts`
- `tsconfig.json`
- `next-env.d.ts`
- `.gitignore`
- `.env.example`
- `README.md`

Excluded on purpose:
- `.env.local`
- `node_modules/`
- `.next/`
- local output/test artifacts
- local PDF/OCR corpora

Before pushing:
- keep the repo private until secrets and auth are configured
- set `GEMINI_API_KEY` only on the server, never in the repo
- later add Supabase environment variables on the server
