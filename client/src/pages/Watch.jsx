import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import { HiOutlineCalendarDays, HiOutlineClock, HiOutlineServer, HiOutlineTrash, HiOutlineArrowLeft } from 'react-icons/hi2';
import { deleteVideo, fetchVideo, getErrorMessage } from '../services/api.js';
import { formatBytes, formatDate, formatDuration } from '../utils/format.js';
import Button from '../components/Button.jsx';
import ErrorState from '../components/ErrorState.jsx';
import VideoCard from '../components/VideoCard.jsx';
import { WatchPageSkeleton } from '../components/Skeleton.jsx';
import AdAnalysisPanel from '../components/AdAnalysisPanel.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Watch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoElement = useRef(null);
  const [video, setVideo] = useState(null);
  const [related, setRelated] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [error, setError] = useState('');
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  async function loadVideo() {
    setIsLoading(true);
    setError('');
    setPlaybackError('');
    try {
      const data = await fetchVideo(id);
      setVideo(data.video);
      setRelated(data.related);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadVideo();
  }, [id]);

  async function handleDelete() {
    const confirmed = window.confirm('Delete this video from Cloudinary and the database?');
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteVideo(id);
      toast.success('Video removed from the library');
      navigate('/');
    } catch (deleteError) {
      toast.error(getErrorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  }

  const playbackUrl = video?.videoUrl;

  if (isLoading) {
    return <WatchPageSkeleton />;
  }

  if (error || !video) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 animate-scale-in">
        <ErrorState message={error || 'Video not found'} onRetry={loadVideo} variant="server" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Button 
          variant="ghost" 
          onClick={() => navigate(-1)} 
          className="mb-6 group"
        >
          <HiOutlineArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to library
        </Button>

        <div className="grid gap-8 lg:grid-cols-[1.7fr_0.8fr]">
          <section className="animate-fade-in">
            <div className="card-shadow-elevated overflow-hidden rounded-2xl bg-slate-950">
              {playbackUrl ? <video
                ref={videoElement}
                key={playbackUrl}
                className="aspect-video w-full bg-black"
                src={playbackUrl}
                poster={video.thumbnailUrl}
                controls
                preload="metadata"
                onError={() => setPlaybackError('StreamWise could not load this approved video. Check your connection and retry. If it keeps failing, ask an admin to republish the ad video from the review page.')}
                onCanPlay={() => setPlaybackError('')}
              >
                Your browser does not support the HTML5 video player.
              </video> : <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-white/70">Approved ad version is unavailable.</div>}
            </div>
            {playbackError && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"><span>{playbackError}</span><button type="button" onClick={() => { setPlaybackError(''); videoElement.current?.load(); }} className="rounded-lg border border-rose-300/30 px-3 py-1.5 font-bold text-rose-100 hover:bg-rose-300/10">Retry</button></div>}
            {!isAdmin && video.approvedAd && <p className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">This is an administrator-approved ad video for {[video.approvedAd.city, video.approvedAd.district, video.approvedAd.state, video.approvedAd.country].filter(Boolean).join(', ')}.</p>}

            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{video.title}</h1>
                <p className="mt-2 text-sm text-slate-400 font-medium">Uploaded by {video.creatorName || 'StreamWise creator'}</p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
                    <HiOutlineCalendarDays className="h-4 w-4" />
                    {formatDate(video.createdAt)}
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
                    <HiOutlineServer className="h-4 w-4" />
                    {formatBytes(video.fileSize)}
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
                    <HiOutlineClock className="h-4 w-4" />
                    {formatDuration(video.duration)}
                  </span>
                </div>
              </div>
              {isAdmin && <Button variant="danger" onClick={handleDelete} disabled={isDeleting} size="lg">
                <HiOutlineTrash className="h-4 w-4" />{isDeleting ? 'Deleting...' : 'Delete source video'}
              </Button>}
            </div>

            <div className="card-shadow mt-6 rounded-2xl border border-slate-100 bg-white p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">Description</h2>
              <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-600">{video.description}</p>
            </div>

            {isAdmin && <div className="mt-6">
              <AdAnalysisPanel
                videoId={id}
                onSeek={(seconds) => {
                  if (!videoElement.current) return;
                  videoElement.current.currentTime = seconds;
                  videoElement.current.play().catch(() => {});
                }}
              />
            </div>}
          </section>

          <aside className="animate-slide-in">
            <h2 className="mb-6 text-xl font-bold text-slate-900">Recommended Videos</h2>
            <div className="grid gap-4">
              {related.length === 0 ? (
                <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-6 text-center">
                  <p className="text-sm text-slate-500 mb-4">
                    More videos will appear here as the library grows.
                  </p>
                  <div className="space-y-2 text-left">
                    <p className="text-sm font-medium text-slate-700">• AI in Computer Vision</p>
                    <p className="text-sm font-medium text-slate-700">• Machine Learning Fundamentals</p>
                    <p className="text-sm font-medium text-slate-700">• Intelligent Video Processing</p>
                    <p className="text-sm font-medium text-slate-700">• Future of Digital Advertising</p>
                    <p className="text-sm font-medium text-slate-700">• Deep Learning Applications</p>
                  </div>
                </div>
              ) : (
                related.map((item) => <VideoCard key={item.id} video={item} />)
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
