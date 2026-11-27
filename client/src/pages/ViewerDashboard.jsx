import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineMapPin, HiOutlinePlay, HiOutlineVideoCamera, HiOutlineCloudArrowUp, HiOutlineClock } from 'react-icons/hi2';
import api, { fetchVideos, getErrorMessage } from '../services/api.js';
import VideoCard from '../components/VideoCard.jsx';
import { formatDate, formatDuration } from '../utils/format.js';

export default function ViewerDashboard() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [myVideos, setMyVideos] = useState([]);
  const [submissionError, setSubmissionError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([fetchVideos(), api.get('/profile')])
      .then(([videoData, profileResponse]) => {
        if (!active) return;
        setVideos(videoData.videos || []);
        setProfile(profileResponse.data.data);
      })
      .catch((loadError) => { if (active) setError(getErrorMessage(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    api.get('/videos/mine')
      .then((response) => { if (active) setMyVideos(response.data.data?.videos || []); })
      .catch((loadError) => { if (active) setSubmissionError(getErrorMessage(loadError)); });
    return () => { active = false; };
  }, []);

  const viewerLocation = [profile?.city, profile?.district, profile?.state, profile?.country].filter(Boolean).join(', ');

  return (
    <div className="hero-glow min-h-screen">
      <section className="mx-auto max-w-7xl px-4 pb-8 pt-12 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-400">Viewer dashboard</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-100 sm:text-4xl">Your video library</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Watch administrator-approved ad videos for your region, or submit a regular video for the admin team to review.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/account" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-bold text-emerald-300 shadow-sm hover:bg-slate-800"><HiOutlineMapPin className="h-5 w-5" /> {viewerLocation || 'Set your location'}</Link>
            <Link to="/upload" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:brightness-110"><HiOutlineCloudArrowUp className="h-5 w-5" /> Upload a video</Link>
          </div>
        </div>
        {profile && <p className="mt-4 text-xs text-slate-500">Your location controls which approved version is selected. <Link to="/account" className="font-bold text-emerald-300 hover:underline">Update location</Link></p>}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
        {loading && <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3"><div className="h-72 animate-pulse rounded-2xl bg-white" /><div className="h-72 animate-pulse rounded-2xl bg-white" /><div className="h-72 animate-pulse rounded-2xl bg-white" /></div>}
        {!loading && !error && <section className="mb-10">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Creator space</p><h2 className="mt-1 text-xl font-bold text-slate-100">Your submissions</h2></div>
            <span className="text-xs font-medium text-slate-500">Only you and admins can see submission status</span>
          </div>
          {submissionError && <p role="status" className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">Could not load your submissions. Apply the creator review migration to enable upload attribution and submission status.</p>}
          {myVideos.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-400">Your uploads will appear here. Admins decide which videos enter ad review.</div> :
            <div className="grid gap-3 md:grid-cols-2">
              {myVideos.map((video) => <article key={video.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-black/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate font-bold text-slate-100">{video.title}</h3><p className="mt-1 text-xs text-slate-400">By {video.creatorName || profile?.display_name || 'You'} · Submitted {formatDate(video.createdAt)}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${video.adReviewEnabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{video.adReviewEnabled ? ({ pending: 'Queued for analysis', processing: 'Analysing', completed: 'Analysis complete', no_slots: 'No billboards found', failed: 'Analysis failed' }[video.analysisStatus] || 'In ad review') : 'Awaiting admin selection'}</span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-400">{video.description}</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><HiOutlineClock className="h-4 w-4" />{formatDuration(video.duration)} <span>·</span>{video.renderedVersions} rendered ad version{video.renderedVersions === 1 ? '' : 's'}</div>
              </article>)}
            </div>}
        </section>}
        {!loading && !error && <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-300"><HiOutlinePlay className="h-4 w-4 text-emerald-400" /> Approved for {viewerLocation || 'your location'}</div>}
        {!loading && !error && videos.length === 0 && (
          <div className="card-shadow rounded-3xl border border-slate-100 bg-white px-6 py-16 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><HiOutlineVideoCamera className="h-7 w-7" /></span>
            <h2 className="mt-5 text-xl font-bold text-slate-900">No approved videos for this location yet</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">When an administrator approves a rendered ad video that matches {viewerLocation || 'your location'}, it will appear here. Raw uploads are never shown in the viewer library.</p>
          </div>
        )}
        {!loading && !error && videos.length > 0 && <>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{videos.map((video) => <VideoCard key={video.id} video={video} />)}</div>
        </>}
      </section>
    </div>
  );
}
