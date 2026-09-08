# Lumina — Video Library

Lumina is a production-style video sharing application for a final year project. It uses a light dashboard interface (not a YouTube clone), stores media in Cloudinary, and saves metadata in Supabase PostgreSQL through `@supabase/supabase-js`.

## Features

- Upload a video and thumbnail with drag-and-drop
- HTML5 playback on a dedicated watch page
- Search, library statistics, and related videos
- Delete a video from both Cloudinary and Supabase
- Validation for file type, size, title, and description

## Folder Structure

```
project/
  client/          React (Vite) frontend
  server/          Express API
  README.md
```

## Prerequisites

- Node.js 18 or newer
- A Supabase project (PostgreSQL)
- A Cloudinary account

## Installation

From the `project` directory:

```bash
cd server
npm install

cd ../client
npm install
```

## Environment Variables

Copy the example files and fill in real values.

```bash
copy .env.example .env
copy server\.env.example server\.env
copy client\.env.example client\.env
```

On macOS/Linux use `cp` instead of `copy`.

Root / server `.env`:

```
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
SUPABASE_URL=
SUPABASE_ANON_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
MAX_VIDEO_SIZE_MB=500
MAX_THUMBNAIL_SIZE_MB=10
NODE_ENV=development
```

Client `.env`:

```
VITE_API_BASE_URL=/api
VITE_DEV_PROXY_TARGET=http://localhost:5000
```

The Vite dev server proxies `/api` to the Express server, so the client can call relative API URLs.

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → API**.
3. Copy the **Project URL** into `SUPABASE_URL`.
4. Copy the **anon public** key into `SUPABASE_ANON_KEY`.
5. Open **SQL Editor** and run:

### For New Installations:
Run the complete schema from `server/database/schema.sql`:

```sql
-- Copy the entire content from server/database/schema.sql
-- This includes all constraints, indexes, functions, and triggers
```

### For Existing Installations:
Run the migration script from `server/database/migration.sql`:

```sql
-- Copy the entire content from server/database/migration.sql
-- This adds constraints, indexes, and functions to your existing table
```

### Manual Setup (Original Schema):
If you prefer the original schema without enhancements:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  video_url text not null,
  thumbnail_url text not null,
  cloudinary_video_id text not null,
  cloudinary_thumbnail_id text not null,
  duration double precision not null default 0,
  file_size integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists videos_created_at_idx on public.videos (created_at desc);
create index if not exists videos_title_idx on public.videos (title);

alter table public.videos enable row level security;

create policy "Allow public read on videos"
  on public.videos for select
  using (true);

create policy "Allow public insert on videos"
  on public.videos for insert
  with check (true);

create policy "Allow public delete on videos"
  on public.videos for delete
  using (true);
```

The API uses the anon key with no authentication, so the policies above allow the Express server to read, insert, and delete rows.

### Enhanced Schema Features:
- **Data Validation**: CHECK constraints for field lengths and formats
- **Performance**: Additional indexes for common queries
- **Automatic Timestamps**: Trigger to auto-update `updated_at`
- **Optimized Functions**: SQL-based library stats calculation
- **Search Function**: Optional full-text search capability
- **Documentation**: Table and column comments

## Cloudinary Setup

1. Create an account at [cloudinary.com](https://cloudinary.com).
2. Copy **Cloud Name**, **API Key**, and **API Secret**.
3. Put them in `.env`.
4. Uploads are stored in:
   - `videos/`
   - `thumbnails/`
5. Deleting a library item also deletes both Cloudinary assets.

## Running the Server

```bash
cd server
npm run dev
```

The API listens on `http://localhost:5000`.

Health check: `GET http://localhost:5000/api/health`

## Running the Client

```bash
cd client
npm run dev
```

Open `http://localhost:5173`.

## API Documentation

Base URL: `http://localhost:5000/api`

Successful responses:

```json
{
  "success": true,
  "message": "Videos fetched successfully",
  "data": []
}
```

Error responses:

```json
{
  "success": false,
  "message": "Video not found",
  "data": null
}
```

### GET `/videos`

Returns all videos, newest first.

### GET `/videos/stats`

Returns library totals:

```json
{
  "totalVideos": 3,
  "totalDuration": 412.5,
  "totalStorage": 18432000
}
```

### GET `/videos/:id`

Returns one video plus related recordings:

```json
{
  "video": {},
  "related": []
}
```

### POST `/videos/upload`

`multipart/form-data`

| Field | Type | Rules |
| --- | --- | --- |
| title | text | 3–120 characters |
| description | text | 10–2000 characters |
| video | file | mp4, mov, avi, mkv · max 500MB |
| thumbnail | file | jpg, jpeg, png, webp |

### DELETE `/videos/:id`

Removes the Supabase row and the Cloudinary video + thumbnail.

## Video Table

```
videos
  id
  title
  description
  video_url
  thumbnail_url
  cloudinary_video_id
  cloudinary_thumbnail_id
  duration
  file_size
  created_at
  updated_at
```

The API still returns camelCase fields (`videoUrl`, `fileSize`, `createdAt`, and so on).

## Production Notes

- Set `NODE_ENV=production`
- Point `CLIENT_ORIGIN` at the deployed frontend origin
- Point `VITE_API_BASE_URL` at the deployed API
- Keep secrets out of git; only `.env.example` is committed
