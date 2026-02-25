# Lumina Studio

Lumina Studio is a mobile-first audiobook creation app.

## Features

- Public users can browse library and listen to published narration
- Admin login protects create/edit/delete/generate actions
- Create books, chapters, and parts (admin only)
- Generate narrated MP3 audio from text using Gemini TTS
- Play parts individually or autoplay chapter queue
- Analyze chapters with Gemini summary + questions
- Upload generated MP3 files to Google Drive and stream them back
- Persist migration-safe audio metadata (`audioUrl` + Drive IDs), so moving Supabase does not require re-generation
- Persist shared library in Supabase (same data for all visitors)
- PWA-ready on mobile (manifest + service worker + home screen install support)

## Tech Stack

- React + TypeScript + Vite (frontend)
- Express + TypeScript (backend)
- Gemini API (`@google/genai`) for TTS and analysis
- Google Drive OAuth + Drive file API
- Supabase (`@supabase/supabase-js`) for cloud persistence

## Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Required backend variables:

- `GEMINI_API_KEY`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

Required frontend build variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- `VITE_LIBRARY_KEY` (default: `public-library`)

## Supabase Setup

Create table and policy in Supabase SQL editor:

```sql
create table if not exists public.lumina_library (
  device_id text primary key,
  books jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.lumina_library enable row level security;

create policy "anon_rw_lumina_library"
on public.lumina_library
for all
using (true)
with check (true);
```

This policy allows anonymous read/write for publishable key usage.
If you add auth later, replace policy with user-scoped rules.

Seed a shared row once (or set your own `VITE_LIBRARY_KEY` value):

```sql
insert into public.lumina_library (device_id, books)
values ('public-library', '[]'::jsonb)
on conflict (device_id) do nothing;
```

## Google OAuth Setup

In Google Cloud console, set OAuth client URLs to your deployed domain:

- Authorized JavaScript origin: `https://your-domain`
- Authorized redirect URI: `https://your-domain/auth/callback`

## PWA Install (Mobile)

Requirements:

- Deploy over `https://` (required by browsers for service worker).
- Open the site once after deploy to register service worker.

Android (Chrome):

- Open app URL.
- Tap browser menu -> `Add to Home screen` (or `Install app` prompt if shown).

iPhone/iPad (Safari):

- Open app URL in Safari.
- Tap Share icon -> `Add to Home Screen`.

## Local Run

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Production Run

```bash
npm run build
npm start
```

## Coolify Docker Deploy

Project includes `Dockerfile` and `.dockerignore`.

In Coolify:

1. Use Dockerfile deploy type.
2. Set build args:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
   - `VITE_LIBRARY_KEY=public-library`
3. Set runtime env vars:
   - `GEMINI_API_KEY`
   - `CLIENT_ID`
   - `CLIENT_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `ADMIN_SESSION_SECRET`
   - `PORT=3000` (optional; default 3000)
4. Expose port `3000`.

The container serves frontend (`dist`) and backend API from one process.
