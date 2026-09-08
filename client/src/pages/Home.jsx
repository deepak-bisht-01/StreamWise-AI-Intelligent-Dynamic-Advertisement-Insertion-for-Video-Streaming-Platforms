import { useEffect, useMemo, useState } from 'react';
import { HiOutlineClock, HiOutlineFilm, HiOutlineServer, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import { fetchStats, fetchVideos, getErrorMessage } from '../services/api.js';
import { formatBytes, formatDuration } from '../utils/format.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import Input from '../components/Input.jsx';
import VideoCard from '../components/VideoCard.jsx';
import { StatsCardSkeleton, VideoCardSkeleton } from '../components/Skeleton.jsx';

export default function Home() {
  const [videos, setVideos] = useState([]);
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadLibrary() {
    setIsLoading(true);
    setError('');
    try {
      const [videoData, statsData] = await Promise.all([fetchVideos(), fetchStats()]);
      // Handle both old array format and new pagination format
      setVideos(Array.isArray(videoData) ? videoData : videoData.videos || []);
      setStats(statsData);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadLibrary();
  }, []);

  const filteredVideos = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return videos;
    }
    return videos.filter((video) =>
      `${video.title} ${video.description}`.toLowerCase().includes(term),
    );
  }, [query, videos]);

  const statsCards = [
    {
      label: 'Published videos',
      value: stats?.totalVideos ?? 0,
      icon: HiOutlineFilm,
      color: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Library duration',
      value: formatDuration(stats?.totalDuration),
      icon: HiOutlineClock,
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Stored media',
      value: formatBytes(stats?.totalStorage),
      icon: HiOutlineServer,
      color: 'bg-amber-50 text-amber-600',
    },
  ];

  return (
    <div className="hero-glow min-h-screen">
      <section className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 lg:px-8">
        <div className="grid items-end gap-8 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="animate-fade-in">
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.3em] text-primary">
              Academic media studio
            </p>
            <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl leading-tight">
              A calm workspace for{' '}
              <span className="gradient-text">every uploaded recording.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-600 leading-relaxed">
              Lumina stores your videos in the cloud, keeps metadata in PostgreSQL, and presents
              the library as a clean research dashboard.
            </p>
          </div>
          <div className="animate-slide-in">
            <div className="relative">
              <HiOutlineMagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <Input
                id="search"
                placeholder="Search titles or descriptions..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-12"
              />
            </div>
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3 stagger-in">
          {isLoading ? (
            statsCards.map((_, index) => <StatsCardSkeleton key={index} />)
          ) : (
            statsCards.map((card) => (
              <article
                key={card.label}
                className="card-shadow rounded-2xl border border-slate-100 bg-white p-6 hover:border-primary/30 transition-all duration-300"
              >
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${card.color}`}>
                  <card.icon className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-slate-500">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{card.value}</p>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        {isLoading && videos.length === 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 stagger-in">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <VideoCardSkeleton key={i} />
            ))}
          </div>
        ) : null}
        
        {!isLoading && error ? (
          <div className="animate-scale-in">
            <ErrorState message={error} onRetry={loadLibrary} variant="network" />
          </div>
        ) : null}
        
        {!isLoading && !error && filteredVideos.length === 0 ? (
          <div className="animate-scale-in">
            <EmptyState
              title={query ? 'No matching videos' : 'The library is empty'}
              message={
                query
                  ? 'Try a different search term or clear the filter.'
                  : 'Publish a recording to see it appear in this grid.'
              }
              actionLabel={query ? 'Clear search' : 'Upload video'}
              to={query ? '/' : '/upload'}
              icon={query ? HiOutlineMagnifyingGlass : HiOutlineFilm}
              variant={query ? 'search' : 'default'}
            />
          </div>
        ) : null}
        
        {!isLoading && !error && filteredVideos.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 stagger-in">
            {filteredVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
