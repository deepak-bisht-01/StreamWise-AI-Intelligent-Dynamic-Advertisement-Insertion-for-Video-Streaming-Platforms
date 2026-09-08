export default function Input({
  label,
  id,
  error,
  hint,
  className = '',
  ...props
}) {
  const errorClass = error ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-200' : 'border-slate-200 focus:border-primary focus:ring-primary/20';
  
  return (
    <label className="block" htmlFor={id}>
      {label ? (
        <span className="mb-2 block text-sm font-semibold text-slate-700 flex items-center gap-2">
          {label}
          {props.required && <span className="text-rose-500">*</span>}
        </span>
      ) : null}
      <div className="relative">
        <input
          id={id}
          className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all duration-200 placeholder:text-slate-400 focus:ring-4 ${errorClass} ${className}`}
          {...props}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {error ? (
          <p className="text-sm text-rose-500 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        ) : hint ? (
          <p className="text-sm text-slate-500">{hint}</p>
        ) : (
          <p></p>
        )}
      </div>
    </label>
  );
}
