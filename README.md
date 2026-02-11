# LEAP-LA OCR Challenge UI

Next.js (App Router) UI for browsing OCR samples from Supabase and running server-side critiques via `POST /api/critique` (HF Router).

## Features
- Homepage lists samples from Supabase
- `/samples/[id]` detail view (PRD + buggy code + failure info)
- “Run Critique” calls serverless route and renders structured output

## Local Dev
```bash
npm install
npm run dev

