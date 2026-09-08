export default function Loader({ label = 'Loading library...', size = 'md' }) {
  const sizeClasses = {
    sm: 'h-8 w-8 border-3',
    md: 'h-12 w-12 border-4',
    lg: 'h-16 w-16 border-4',
  };

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 animate-fade-in">
      <div className={`animate-spin rounded-full border-slate-200 border-t-primary ${sizeClasses[size]}`} />
      <p className="text-sm font-medium text-slate-500 animate-pulse-soft">{label}</p>
    </div>
  );
}
