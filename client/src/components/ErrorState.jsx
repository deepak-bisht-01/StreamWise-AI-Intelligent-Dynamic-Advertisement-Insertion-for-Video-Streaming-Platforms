import { HiOutlineExclamationTriangle, HiOutlineArrowPath } from 'react-icons/hi2';
import Button from './Button.jsx';

export default function ErrorState({
  title = 'Unable to load content',
  message = 'Please check your connection and try again.',
  onRetry,
  variant = 'default',
}) {
  const variantStyles = {
    default: 'border-rose-100',
    network: 'border-amber-100',
    server: 'border-slate-200',
  };

  const iconStyles = {
    default: 'bg-rose-50 text-rose-500',
    network: 'bg-amber-50 text-amber-500',
    server: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className={`card-shadow flex flex-col items-center rounded-2xl border ${variantStyles[variant]} bg-white px-8 py-16 text-center animate-scale-in`}>
      <div className={`mb-6 flex h-20 w-20 items-center justify-center rounded-3xl ${iconStyles[variant]}`}>
        <HiOutlineExclamationTriangle className="h-10 w-10" />
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-3">{title}</h3>
      <p className="max-w-md text-base text-slate-500 leading-relaxed mb-8">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="secondary" size="lg" className="group">
          <HiOutlineArrowPath className="h-5 w-5 group-hover:rotate-180 transition-transform duration-500" />
          Try again
        </Button>
      )}
    </div>
  );
}
