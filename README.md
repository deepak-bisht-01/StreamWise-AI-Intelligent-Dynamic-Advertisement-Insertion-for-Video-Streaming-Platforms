# StreamWise AI

StreamWise AI is a production-style video sharing application for a final year project. It uses a light dashboard interface (not a YouTube clone), stores media in Cloudinary, and saves metadata in Supabase PostgreSQL through `@supabase/supabase-js`.

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
SUPABASE_SERVICE_ROLE_KEY=
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
5. Copy the **service_role** key into `SUPABASE_SERVICE_ROLE_KEY` for the Express server only. Never put it in `client/.env` or frontend code.
6. Open **SQL Editor** and run:

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

-- Do not add public/anon policies. Apply viewer_admin_access_migration.sql
-- so only the authenticated StreamWise API service role can access source rows.
```

The video table and source files are not public. The server uses its service role key after checking StreamWise sessions and roles; viewer endpoints return only location-matched, administrator-approved ad renders. Keep the service role key on the server.

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

## Google Colab / AI Processor Integration

The detector from `server/scripts/Copy_of_Phase3_FIXED_V4.ipynb` is checked in as `server/scripts/ad_slot_detector_v4.py`; the notebook's detector cell and the checked-in script match. `server/scripts/colab_ad_insertion.py` is the command-line bridge used by the API.

Video uploads from signed-in viewers are normal creator submissions. They are stored with the creator's display name and are not played in the viewer library. An administrator explicitly selects a submission for ad review before billboard detection is queued. Slot data is stored in Supabase, and the rectangle-marked detection video is saved under `server/storage/ai-previews/` and shown on the admin watch page. The original upload remains available only in the admin workflow for review and rendering.

### One-time database setup

Run `server/database/ad_analysis_migration.sql` in the Supabase SQL Editor after setting up the main video schema. It adds analysis status fields and the `ad_slots` table. The API resumes pending analyses when it starts.

## User Profiles and Regional Ads

Run `server/database/personalized_ads_migration.sql` after the main schema and `ad_analysis_migration.sql`, then run `server/database/manual_auth_migration.sql`, `server/database/location_district_migration.sql`, `server/database/viewer_admin_access_migration.sql`, `server/database/video_creator_review_migration.sql`, and `server/database/advertiser_orders_migration.sql`, followed by `server/database/advertiser_priority_payment_migration.sql`. The manual-auth migration creates StreamWise accounts and sessions. The district migration adds district-level targeting to viewer profiles and campaigns. The viewer/admin migration removes public access to source videos and detector slots; server routes then enforce app roles. The creator review migration adds upload attribution and the admin-controlled ad-review flag. The advertiser orders migration adds advertiser submissions, the INR rate card, payment confirmation, and receipts. The advertiser priority/payment migration adds location rate rules, admin-assigned video tiers, QR payment instructions, and advertiser-submitted payment references. The app does not use Supabase Auth or send confirmation emails; passwords are hashed by the API and sessions can be revoked on sign-out. Email is used as the account name but is not verified by email. Existing Supabase Auth accounts need to create a new StreamWise account; their old profile rows and campaign data remain in the database but are not automatically attached to the new account.

If account creation reports a database migration error, run the **entire** `manual_auth_migration.sql` file in the SQL Editor for the same Supabase project referenced by `SUPABASE_URL` in `server/.env`, then restart the API. You can check the API role's required privileges in the SQL Editor with:

```sql
select
  has_table_privilege('service_role', 'public.app_users', 'SELECT') as can_read_users,
  has_table_privilege('service_role', 'public.app_users', 'INSERT') as can_create_users,
  has_table_privilege('service_role', 'public.profiles', 'INSERT') as can_create_profiles,
  has_table_privilege('service_role', 'public.app_sessions', 'INSERT') as can_create_sessions;
```

Users create an account from **Sign in** in the navigation, then choose **Use GPS** or enter a manual country/state/district on their profile. India state/UT and district options come from the Local Government Directory and fall back to manual entry if the location service is unavailable. GPS coordinates are only saved after they press **Save profile**. For GPS-radius campaigns, enter the campaign center coordinates and radius in kilometres; state, district, and city can be used for exact regional targeting.

Advertisers open **Advertise with us** to submit a logo, campaign location/radius, contact details, and one or more ad-ready video links. Admins assign Standard, Featured, or Premium value tiers to videos, configure location-specific INR rates and a payment QR image, then issue a revised quote. Advertisers can submit a payment reference from the quote page; admins verify it and confirm payment before rendering. That action issues a printable receipt and queues `server/scripts/ad_inserter.py` to render the logo into the highest-ranked detected billboard slot for every selected video. Each rendered video remains pending until an admin approves it in the video review page; only approved versions are shown to viewers.

The first brand administrator must be assigned manually in the Supabase SQL Editor after creating a StreamWise account:

```sql
update public.profiles p
set role = 'admin'
from public.app_users u
where p.id = u.id and lower(u.email) = lower('admin@example.com');
```

Administrators use `/admin` for the video review queue and `/brands` for reusable regional campaign inventory. A campaign stores the brand creative and its country/state/district targeting. On an analyzed video's admin view, choose **Brand inventory** as the creative source to place that saved campaign into a detected slot; its creative and saved location are reused automatically. Upload a one-off creative when it should only be used for that video. India state/UT and district lists are provided by the Government of India's Local Government Directory. Preview the rendered video and press **Approve for viewers** only after review. Approval and location targeting are stored with the video analysis result.

Viewers use `/dashboard`. The API returns only videos that have an approved ad version matching their saved location, and streams that ad video after checking the viewer's session and location. Raw source URLs and detector previews are available only to administrators. If there is no approved version for the viewer's region, the video is omitted; the raw upload is never used as a fallback.

### Python setup

Use Python 3.10–3.12. The server automatically uses the repository's `.venv` interpreter when present; otherwise, it uses `py -3` on Windows or `python3` on macOS/Linux.

Install PyTorch and torchvision first using the command for your machine from [PyTorch's install guide](https://pytorch.org/get-started/locally/), then install the remaining dependencies:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r server/scripts/requirements-ai.txt
```

Set `PYTHON_EXECUTABLE` in `server/.env` only if you want to use a different interpreter. `AI_PROCESSOR_SCRIPT` can point to another compatible bridge script.

### Analysis endpoints

```http
GET  /api/videos/:id/analysis
POST /api/videos/:id/analyze
```

The first endpoint returns the current status and detected slots. The second queues a retry after a failed analysis. Uploading a video starts analysis automatically.

When analysis is complete, the watch page lets you choose a detected slot and upload an image or video creative (JPG, PNG, MP4, MOV, WebM, MKV, or AVI; up to 100 MB). The API runs `server/scripts/ad_inserter.py` with the detector's normalized video, `slots.json`, and `coordinates.csv`. It perspective-warps the creative into the tracked billboard, writes a local working copy under `server/storage/ad-results/`, and uploads the playable render to Cloudinary so viewers on other devices and API instances can access it. The detector inputs needed for insertion stay under `server/storage/ad-inputs/` on the API machine.

The lower-level processor endpoint is also available for local input paths:

```http
POST /api/ai/process
```

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
