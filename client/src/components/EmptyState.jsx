import { HiOutlineFilm, HiOutlinePlus, HiOutlineCloudArrowUp } from 'react-icons/hi2';
import Button from './Button.jsx';

export default function EmptyState({
  title = 'No videos yet',
  message = 'Upload your first clip to start building the library.',
  actionLabel = 'Upload video',
  to = '/upload',
  icon = HiOutlineFilm,
  variant = 'default',
}) {
  const iconStyles = {
    default: 'bg-indigo-50 text-primary',
    upload: 'bg-emerald-50 text-emerald-600',
    search: 'bg-amber-50 text-amber-600',
  };

  const iconComponent = icon;

  return (
    <div className="card-shadow flex flex-col items-center rounded-2xl border border-slate-100 bg-white px-8 py-16 text-center animate-scale-in">
      <div className={`mb-6 flex h-20 w-20 items-center justify-center rounded-3xl ${iconStyles[variant]} animate-pulse-soft`}>
        <iconComponent className="h-10 w-10" />
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-3">{title}</h3>
      <p className="max-w-md text-base text-slate-500 leading-relaxed mb-8">{message}</p>
      {to && (
        <Button to={to} variant="gradient" size="lg" className="group">
          {variant === 'upload' ? <HiOutlineCloudArrowUp className="h-5 w-5" /> : <HiOutlinePlus className="h-5 w-5" />}
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
