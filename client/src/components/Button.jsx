import { Link } from 'react-router-dom';

export default function Button({
  children,
  to,
  type = 'button',
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
  onClick,
}) {
  const baseStyles = 'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2.5 text-sm rounded-xl',
    lg: 'px-6 py-3 text-base rounded-xl',
  };

  const variantStyles = {
    primary: `
      bg-primary text-white shadow-lg shadow-primary/25 hover:bg-primary-dark hover:shadow-xl hover:shadow-primary/30
      focus:ring-primary focus:ring-offset-2
    `,
    secondary: `
      bg-white text-slate-700 border-2 border-slate-200 hover:border-primary hover:text-primary hover:bg-slate-50
      focus:ring-primary focus:ring-offset-2
    `,
    danger: `
      bg-rose-50 text-rose-600 border-2 border-rose-200 hover:bg-rose-100 hover:border-rose-300
      focus:ring-rose-500 focus:ring-offset-2
    `,
    ghost: `
      bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900
      focus:ring-slate-400 focus:ring-offset-2
    `,
    gradient: `
      bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30
      focus:ring-primary focus:ring-offset-2
    `,
  };

  const classes = `${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`;

  const content = loading ? (
    <>
      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {children}
    </>
  ) : children;

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button 
      type={type} 
      className={classes} 
      disabled={disabled || loading} 
      onClick={onClick}
    >
      {content}
    </button>
  );
}
