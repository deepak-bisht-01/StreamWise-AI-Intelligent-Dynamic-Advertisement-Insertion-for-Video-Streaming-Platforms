import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { HiOutlineCloudArrowUp, HiOutlineSquares2X2, HiOutlineBars3, HiOutlineXMark } from 'react-icons/hi2';
import Button from './Button.jsx';

const links = [
  { to: '/', label: 'Library', icon: HiOutlineSquares2X2 },
  { to: '/upload', label: 'Upload', icon: HiOutlineCloudArrowUp },
];

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <NavLink to="/" className="flex items-center gap-3 group">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-indigo-500 text-xl font-bold text-white shadow-lg shadow-emerald-500/25 group-hover:shadow-xl group-hover:shadow-emerald-500/30 transition-all duration-300">
            S
          </span>
          <span className="hidden sm:block">
            <span className="block text-base font-bold tracking-tight text-slate-900 group-hover:text-emerald-500 transition-colors">StreamWise AI</span>
            <span className="block text-xs text-slate-500 font-medium">AI-Powered Video Streaming Platform with Intelligent Dynamic Advertisement Insertion</span>
          </span>
        </NavLink>

        <nav className="hidden items-center gap-2 rounded-2xl bg-slate-100/80 p-1.5 md:flex">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  isActive 
                    ? 'bg-white text-emerald-500 shadow-md' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`
              }
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Button to="/upload" variant="gradient" size="md" className="hidden sm:flex">
            <HiOutlineCloudArrowUp className="h-4 w-4" />
            Upload
          </Button>
          
          <button
            type="button"
            className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <HiOutlineXMark className="h-6 w-6" />
            ) : (
              <HiOutlineBars3 className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white/95 backdrop-blur-md animate-slide-in">
          <div className="px-4 py-4 space-y-2 sm:px-6">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
                    isActive 
                      ? 'bg-emerald-500/10 text-emerald-500' 
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                <link.icon className="h-5 w-5" />
                {link.label}
              </NavLink>
            ))}
            <NavLink
              to="/upload"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-emerald-500 hover:bg-emerald-500/10 transition-all"
            >
              <HiOutlineCloudArrowUp className="h-5 w-5" />
              Upload
            </NavLink>
          </div>
        </div>
      )}
    </header>
  );
}
