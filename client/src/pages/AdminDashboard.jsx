import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineCloudArrowUp, HiOutlineFilm, HiOutlineMegaphone, HiOutlineShieldCheck, HiOutlineSparkles } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '../services/api.js';
import { formatDuration } from '../utils/format.js';
import { AnalysisBadge } from '../components/AdAnalysisPanel.jsx';

export default function AdminDashboard() {
  const [videos, setVideos] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectingId, setSelectingId] = useState('');
  const [updatingTierId, setUpdatingTierId] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/videos/admin'), api.get('/videos/stats')])
      .then(([videoResponse, statsResponse]) => {
        if (!active) return;
        setVideos(videoResponse.data.data?.videos || []);
        setStats(statsResponse.data.data || null);
      })
      .catch((loadError) => { if (active) setError(getErrorMessage(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function selectForAdReview(video) {
    setSelectingId(video.id);
    try {
      await api.post(`/videos/${video.id}/ad-review`);
      setVideos((current) => current.map((item) => item.id === video.id
        ? { ...item, adReviewEnabled: true, analysisStatus: item.analysisStatus || 'pending' }
        : item));
      toast.success('Selected for ad review. Billboard analysis is queued.');
    } catch (selectError) {
      toast.error(getErrorMessage(selectError));
    } finally {
      setSelectingId('');
    }
  }

  async function updatePriorityTier(video, priorityTier) {
    setUpdatingTierId(video.id);
    try {
      await api.patch(`/videos/${video.id}/advertiser-priority`, { priorityTier });
      setVideos((current) => current.map((item) => item.id === video.id ? { ...item, advertiserPriorityTier: priorityTier } : item));
      toast.success(`${video.title} set to ${priorityTier} advertiser priority.`);
    } catch (tierError) {
      toast.error(getErrorMessage(tierError));
    } finally {
      setUpdatingTierId('');
    }
  }

  const approvedCount = videos.reduce((total, video) => total + video.adResults.filter((ad) => ad.approved).length, 0);
  const unselectedCount = videos.filter((video) => !video.adReviewEnabled).length;

  return (
    <div className="hero-glow min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-indigo-300">Administrator workspace</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-100 sm:text-4xl">Admin dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Review creator submissions, choose which videos get billboard analysis, add regional ads, then approve the finished version for viewers.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/brands" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-bold text-indigo-200 shadow-sm hover:bg-slate-800"><HiOutlineMegaphone className="h-5 w-5" /> Brand inventory</Link>
            <Link to="/upload" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-300 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:brightness-110"><HiOutlineCloudArrowUp className="h-5 w-5" /> Upload video</Link>
          </div>
        </header>

        {error && <p role="alert" className="mb-6 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</p>}

        <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Videos', stats?.totalVideos ?? videos.length, HiOutlineFilm, 'bg-emerald-400/10 text-emerald-300'],
            ['Awaiting selection', unselectedCount, HiOutlineShieldCheck, 'bg-amber-400/10 text-amber-300'],
            ['Approved placements', approvedCount, HiOutlineShieldCheck, 'bg-indigo-400/10 text-indigo-300'],
            ['Library runtime', formatDuration(stats?.totalDuration), HiOutlineFilm, 'bg-sky-400/10 text-sky-300'],
          ].map(([label, value, Icon, color]) => (
            <article key={label} className="card-shadow rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <span className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></span>
              <p className="text-sm font-medium text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-100">{value}</p>
            </article>
          ))}
        </section>

        <section className="card-shadow overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-5 sm:p-6">
            <div><h2 className="text-xl font-bold text-slate-100">Creator video review queue</h2><p className="mt-1 text-sm text-slate-400">Choose submissions for analysis and set advertiser value tiers. Premium placement can reflect cast recognition, creator reach, or expected audience demand.</p></div>
            <span className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300">{videos.length} video{videos.length === 1 ? '' : 's'}</span>
          </div>
          {loading ? <p className="p-8 text-center text-sm text-slate-400">Loading admin library…</p>
            : videos.length === 0 ? <div className="p-10 text-center"><p className="font-semibold text-slate-200">No creator videos yet</p><p className="mt-1 text-sm text-slate-400">Viewer uploads will appear here for your review.</p></div>
              : <div className="divide-y divide-slate-800">
                {videos.map((video) => {
                  const approved = video.adResults.filter((ad) => ad.approved).length;
                  const pending = video.adResults.length - approved;
                  return (
                    <article key={video.id} className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-slate-100">{video.title}</h3>{video.adReviewEnabled && <AnalysisBadge status={video.analysisStatus} />}</div>
                        <p className="mt-1 text-xs font-semibold text-indigo-300">Uploaded by {video.creatorName || 'Legacy creator'}</p>
                        <p className="mt-1 line-clamp-1 text-sm text-slate-400">{video.description}</p>
                        <p className="mt-2 text-xs font-medium text-slate-500">{video.adResults.length} rendered version{video.adResults.length === 1 ? '' : 's'} · {approved} approved · {pending} awaiting review</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs font-bold text-slate-400">Ad value<select aria-label={`Advertiser priority for ${video.title}`} value={video.advertiserPriorityTier || 'standard'} disabled={updatingTierId === video.id} onChange={(event) => updatePriorityTier(video, event.target.value)} className="ml-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs font-bold text-slate-100 disabled:opacity-50"><option value="standard">Standard</option><option value="featured">Featured</option><option value="premium">Premium</option></select></label>
                        {!video.adReviewEnabled
                          ? <button type="button" disabled={selectingId === video.id} onClick={() => selectForAdReview(video)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-300 px-4 py-2.5 text-sm font-extrabold text-slate-950 shadow-lg shadow-emerald-500/10 disabled:opacity-60"><HiOutlineSparkles className="h-4 w-4" />{selectingId === video.id ? 'Selecting…' : 'Select for ad review'}</button>
                          : <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2.5 text-sm font-bold text-emerald-300">Selected for ad review</span>}
                        <Link to={`/watch/${video.id}`} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-bold text-indigo-200 hover:bg-slate-700">Manage video</Link>
                      </div>
                    </article>
                  );
                })}
              </div>}
        </section>
      </div>
    </div>
  );
}
