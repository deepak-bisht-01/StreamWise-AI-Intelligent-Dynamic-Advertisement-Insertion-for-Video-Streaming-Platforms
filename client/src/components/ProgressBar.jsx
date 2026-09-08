export default function ProgressBar({ value = 0, label = 'Uploading media' }) {
  const percent = Math.min(100, Math.max(0, value));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="font-bold text-primary">{percent}%</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-slate-100 shadow-inner">
        <div
          className="absolute inset-y-0 left-0 h-full rounded-full bg-gradient-to-r from-primary via-primary-light to-accent transition-all duration-300 ease-out shadow-lg"
          style={{ width: `${percent}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
        </div>
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Started upload</span>
        <span>{percent === 100 ? 'Complete!' : 'In progress...'}</span>
      </div>
    </div>
  );
}
