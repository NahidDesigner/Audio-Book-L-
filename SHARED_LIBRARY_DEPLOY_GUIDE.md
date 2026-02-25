# Shared Library Deploy Guide (Coolify + Supabase + Google Drive Audio)

This guide configures Lumina so:

- Audio files stay in Google Drive.
- Library data (books/chapters/parts metadata) is shared for all visitors via Supabase.
- Different browsers/users see the same library.

## 1) Supabase Setup

Run this in Supabase SQL Editor:

```sql
create table if not exists public.lumina_library (
  device_id text primary key,
  books jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.lumina_library enable row level security;

drop policy if exists "anon_rw_lumina_library" on public.lumina_library;
create policy "anon_rw_lumina_library"
on public.lumina_library
for all
using (true)
with check (true);

insert into public.lumina_library (device_id, books)
values ('public-library', '[]'::jsonb)
on conflict (device_id) do nothing;
```

## 2) Coolify Build Arguments

Open these pages in Coolify:

1. Dashboard -> Projects -> your project.
2. Open your application resource.
3. Go to `Settings` -> `Build` (or `Build & Deploy`, depending on Coolify version).
4. Find `Build Arguments` and add:

- Key: `VITE_SUPABASE_URL` | Value: your Supabase URL
- Key: `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Value: your Supabase publishable key
- Key: `VITE_LIBRARY_KEY` | Value: `public-library`

`VITE_LIBRARY_KEY` is not something you fetch from Supabase.
It is a custom shared identifier you choose.
Use `public-library` unless you want a different shared namespace.

Important: `VITE_*` values are compiled at build time. If changed, force rebuild.

## 3) Coolify Runtime Environment Variables

Open these pages in Coolify:

1. Dashboard -> Projects -> your project.
2. Open your application resource.
3. Go to `Environment Variables` (or `Settings` -> `Environment Variables`).
4. Add these as runtime env vars:

- `GEMINI_API_KEY`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `PORT=3000` (optional if your target is 3000)

If Coolify shows scope options, keep these as runtime/application env vars.
Do not put backend-only keys in Build Arguments.

## 4) Force Rebuild and Deploy

Do all of these:

1. Push latest code to your branch.
2. In Coolify, open your app resource.
3. Go to `Deployments`.
4. Click `Deploy` / `Redeploy`.
5. Enable `Force rebuild` or `Rebuild without cache`.
6. Start deployment and wait for finish.

If logs say "Build step skipped", your new frontend env/build changes were not applied.

## 5) Migrate Old Per-Browser Data (If Needed)

If older data was stored under a browser-specific key, use one of these methods.

Method A (automatic):

1. Open the app in the old browser/profile where your data existed.
2. Wait for load.
3. The app auto-copies legacy data to `public-library`.

Method B (manual SQL):

```sql
select device_id, updated_at, jsonb_array_length(books) as books_count
from public.lumina_library
order by updated_at desc;
```

Then copy the old row to shared key (replace `OLD_DEVICE_ID`):

```sql
update public.lumina_library dst
set books = src.books, updated_at = now()
from public.lumina_library src
where dst.device_id = 'public-library'
  and src.device_id = 'OLD_DEVICE_ID';
```

## 6) Verification Checklist

1. Open app in Browser A.
2. Add/edit a book as admin.
3. Open app in Browser B/incognito.
4. Confirm same library appears.
5. Play audio and confirm Drive streaming works.
6. On mobile, verify browser shows `Add to Home Screen` / `Install app`.

## 7) Moving to Another Supabase Later (No Audio Re-Generation)

When migrating to a new Supabase project, keep these part fields in JSON:

- `audioUrl`
- `driveFileId`
- `drivePublicUrl`

If those fields are preserved, existing generated audio stays playable after migration.

After migration and deploy:

1. Login as admin.
2. Connect Google Drive.
3. Click `Repair Public Audio` once to refresh public sharing/URLs if needed.

## 8) Common Issues

Blank or empty library:

- Check browser console/network for Supabase errors.
- Confirm build args exist and rebuild was forced.
- Confirm `public-library` row exists in `lumina_library`.

Different browsers showing different data:

- Usually old build or missing `VITE_LIBRARY_KEY`.
- Rebuild without cache.

Endless loading:

- Usually backend/env misconfiguration or blocked Supabase calls.
- Verify runtime env vars and app logs.
