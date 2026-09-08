export function Skeleton({ className = '', variant = 'default' }) {
  const baseClass = 'animate-pulse rounded-lg bg-slate-200';
  
  const variantClasses = {
    default: 'h-4 w-full',
    text: 'h-4 w-3/4',
    title: 'h-6 w-1/2',
    avatar: 'h-10 w-10 rounded-full',
    thumbnail: 'aspect-video w-full',
    button: 'h-10 w-24',
    card: 'h-32 w-full',
  };

  return (
    <div className={`${baseClass} ${variantClasses[variant]} ${className}`} />
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="card-shadow rounded-2xl border border-slate-100 bg-white overflow-hidden animate-fade-in">
      <Skeleton variant="thumbnail" className="rounded-t-2xl" />
      <div className="p-4 space-y-3">
        <Skeleton variant="title" />
        <Skeleton variant="text" />
        <div className="flex gap-4 pt-2">
          <Skeleton variant="button" className="h-4 w-16" />
          <Skeleton variant="button" className="h-4 w-16" />
          <Skeleton variant="button" className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-5 animate-fade-in">
      <div className="flex items-start justify-between mb-4">
        <Skeleton variant="avatar" />
        <Skeleton variant="button" className="h-6 w-12" />
      </div>
      <Skeleton variant="text" className="mb-2" />
      <Skeleton variant="title" />
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <Skeleton variant="text" className="h-5 w-24" />
        <Skeleton variant="card" className="h-12" />
      </div>
      <div className="space-y-2">
        <Skeleton variant="text" className="h-5 w-32" />
        <Skeleton variant="card" className="h-32" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Skeleton variant="text" className="h-5 w-20" />
          <Skeleton variant="card" className="h-24" />
        </div>
        <div className="space-y-2">
          <Skeleton variant="text" className="h-5 w-24" />
          <Skeleton variant="card" className="h-24" />
        </div>
      </div>
      <Skeleton variant="button" className="h-12 w-full" />
    </div>
  );
}

export function WatchPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 animate-fade-in">
      <div className="grid gap-8 lg:grid-cols-[1.7fr_0.8fr]">
        <section className="space-y-6">
          <Skeleton variant="thumbnail" className="rounded-2xl" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3 flex-1">
              <Skeleton variant="title" className="h-8 w-3/4" />
              <div className="flex flex-wrap gap-4">
                <Skeleton variant="button" className="h-5 w-24" />
                <Skeleton variant="button" className="h-5 w-20" />
                <Skeleton variant="button" className="h-5 w-20" />
              </div>
            </div>
            <Skeleton variant="button" className="h-10 w-24" />
          </div>
          <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-5 space-y-3">
            <Skeleton variant="text" className="h-5 w-20" />
            <div className="space-y-2">
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" className="w-2/3" />
            </div>
          </div>
        </section>
        <aside className="space-y-4">
          <Skeleton variant="title" className="h-6 w-40" />
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <VideoCardSkeleton key={i} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}