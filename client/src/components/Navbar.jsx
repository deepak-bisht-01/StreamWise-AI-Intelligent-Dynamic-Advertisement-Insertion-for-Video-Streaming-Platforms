import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { HiOutlineCloudArrowUp, HiOutlineSquares2X2, HiOutlineMegaphone, HiOutlineBars3, HiOutlineXMark } from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';
  const links = !user ? [{ to: '/account', label: 'Sign in', icon: HiOutlineSquares2X2 }]
    : isAdmin ? [
      { to: '/admin', label: 'Admin dashboard', icon: HiOutlineSquares2X2 },
      { to: '/admin/advertiser-requests', label: 'Ad requests', icon: HiOutlineMegaphone },
      { to: '/brands', label: 'Brand inventory', icon: HiOutlineMegaphone },
      { to: '/upload', label: 'Upload video', icon: HiOutlineCloudArrowUp },
    ] : [
      { to: '/dashboard', label: 'Viewer dashboard', icon: HiOutlineSquares2X2 },
      { to: '/advertise', label: 'Advertise with us', icon: HiOutlineMegaphone },
      { to: '/upload', label: 'Upload video', icon: HiOutlineCloudArrowUp },
    ];

  async function leaveAccount() {
    await signOut();
    setMobileMenuOpen(false);
    navigate('/account');
  }

  const linkClass = ({ isActive }) => `flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-slate-800 text-emerald-300 shadow-sm' : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100'}`;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 shadow-lg shadow-black/10 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <NavLink to="/" className="group flex shrink-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-indigo-500 text-lg font-bold text-white shadow-lg shadow-emerald-500/20">S</span>
          <span><span className="block text-sm font-extrabold tracking-tight text-slate-100 group-hover:text-emerald-300">StreamWise AI</span><span className="hidden text-[11px] font-medium text-slate-500 sm:block">Location-aware approved video streaming</span></span>
        </NavLink>

        <nav className="hidden items-center gap-1 rounded-2xl border border-slate-800 bg-slate-900/80 p-1 md:flex">
          {links.map((link) => <NavLink key={link.to} to={link.to} className={linkClass}><link.icon className="h-4 w-4" />{link.label}</NavLink>)}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? <>
            <NavLink to="/account" className="max-w-40 truncate rounded-lg px-2 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">{profile?.display_name || user.email}</NavLink>
            <button onClick={leaveAccount} className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">Sign out</button>
          </> : <NavLink to="/account" className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">Sign in</NavLink>}
        </div>

        <button type="button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} className="rounded-xl p-2 text-slate-300 hover:bg-slate-800 md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <HiOutlineXMark className="h-6 w-6" /> : <HiOutlineBars3 className="h-6 w-6" />}
        </button>
      </div>

      {mobileMenuOpen && <nav className="space-y-1 border-t border-slate-800 bg-slate-950 px-4 py-3 md:hidden">
        {links.map((link) => <NavLink key={link.to} to={link.to} onClick={() => setMobileMenuOpen(false)} className={linkClass}><link.icon className="h-5 w-5" />{link.label}</NavLink>)}
        {user && <>
          <NavLink to="/account" onClick={() => setMobileMenuOpen(false)} className={linkClass}>My profile and location</NavLink>
          <button onClick={leaveAccount} className="w-full rounded-xl px-3 py-3 text-left text-sm font-semibold text-slate-300 hover:bg-slate-800">Sign out</button>
        </>}
      </nav>}
    </header>
  );
}
