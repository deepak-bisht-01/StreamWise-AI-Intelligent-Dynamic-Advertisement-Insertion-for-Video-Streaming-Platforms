import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import IndiaLocationFields from '../components/IndiaLocationFields.jsx';

const initialProfile = {
  display_name: '',
  location_mode: 'manual',
  country: 'India',
  state: '',
  district: '',
  city: '',
  latitude: '',
  longitude: '',
};

export default function Account() {
  const { user, profile, setProfile, authError, loading, signIn, signUp, signOut } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('sign-in');
  const [credentials, setCredentials] = useState({ displayName: '', email: '', password: '' });
  const [form, setForm] = useState(initialProfile);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingCredentials, setIsSubmittingCredentials] = useState(false);
  const credentialsInFlight = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setForm({
      display_name: profile.display_name || '',
      location_mode: profile.location_mode || 'manual',
      country: profile.country || 'India',
      state: profile.state || '',
      district: profile.district || '',
      city: profile.city || '',
      latitude: profile.latitude ?? '',
      longitude: profile.longitude ?? '',
    });
  }, [profile]);

  async function submitCredentials(event) {
    event.preventDefault();
    if (credentialsInFlight.current) return;
    credentialsInFlight.current = true;
    setIsSubmittingCredentials(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'sign-up') {
        await signUp(credentials.displayName, credentials.email, credentials.password);
        setMessage('Account created. Set your location below. No confirmation email is needed.');
      } else {
        await signIn(credentials.email, credentials.password);
        setMessage('Signed in. You can now set your location.');
      }
    } catch (authError) {
      const detail = getErrorMessage(authError);
      if (/already registered|already exists|user exists/i.test(detail)) {
        setMode('sign-in');
        setError('This email already has an account. Sign in with it instead.');
      } else {
        setError(detail);
      }
    } finally {
      credentialsInFlight.current = false;
      setIsSubmittingCredentials(false);
    }
  }

  function useGps() {
    setError('');
    setMessage('');
    if (!navigator.geolocation) {
      setError('GPS location is not available in this browser. Enter your location manually.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setForm((current) => ({
        ...current,
        location_mode: 'gps',
        state: '',
        district: '',
        city: '',
        latitude: coords.latitude.toFixed(6),
        longitude: coords.longitude.toFixed(6),
      })),
      (locationError) => setError(locationError.message || 'Could not get your location. Enter it manually.'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSaving(true);
    try {
      const response = await api.put('/profile', {
        displayName: form.display_name,
        locationMode: form.location_mode,
        country: form.country,
        state: form.state,
        district: form.district,
        city: form.city,
        latitude: form.latitude,
        longitude: form.longitude,
      });
      setProfile(response.data.data);
      setMessage('Profile and ad location saved. Future video playback will use matching local campaigns.');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-slate-500">Loading your account...</div>;
  }

  if (!user) {
    return (
      <div className="hero-glow min-h-screen px-4 py-12">
        <section className="card-shadow-elevated mx-auto max-w-lg rounded-3xl border border-slate-100 bg-white p-6 sm:p-9">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-600">Your StreamWise profile</p>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">{mode === 'sign-up' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Save your location and get local ad campaigns when you watch videos.</p>

          <form className="mt-7 space-y-4" onSubmit={submitCredentials}>
            {mode === 'sign-up' && (
              <label className="block text-sm font-semibold text-slate-700">
                Name
                <input required maxLength={100} value={credentials.displayName} onChange={(event) => setCredentials({ ...credentials, displayName: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
              </label>
            )}
            <label className="block text-sm font-semibold text-slate-700">
              Email
              <input required type="email" autoComplete="email" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Password
              <input required type="password" minLength={8} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
            <button disabled={isSubmittingCredentials} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-3 font-bold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700 disabled:cursor-wait disabled:opacity-60">
              {isSubmittingCredentials ? 'Please wait...' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-500">
            {mode === 'sign-up' ? 'Already have an account?' : 'New to StreamWise?'}{' '}
            <button className="font-bold text-emerald-700 hover:text-emerald-800" onClick={() => { setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up'); setError(''); setMessage(''); }}>
              {mode === 'sign-up' ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="hero-glow min-h-screen px-4 py-12">
        <section className="card-shadow-elevated mx-auto max-w-4xl rounded-3xl border border-slate-700 bg-slate-900 p-6 sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-600">Personal profile</p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Location and preferences</h1>
            <p className="mt-2 text-sm text-slate-500">Signed in as {user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {profile?.role === 'admin' && <Link to="/brands" className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100">Manage brands</Link>}
            <button onClick={() => { signOut(); navigate('/account'); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Sign out</button>
          </div>
        </div>

        {authError && <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{authError}</p>}

        <form className="mt-8 space-y-5" onSubmit={saveProfile}>
          <label className="block text-sm font-semibold text-slate-700">
            Display name
            <input required maxLength={100} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-normal text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/15" />
          </label>

          <div className="relative overflow-hidden rounded-2xl border border-emerald-400/25 bg-slate-950/80 p-4 shadow-lg shadow-black/20 sm:p-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-emerald-300">Campaign targeting</p>
                <h2 className="mt-1 text-lg font-extrabold text-white">Ad location</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-300">Choose where you watch from to match approved campaigns in your area.</p>
              </div>
              <button type="button" onClick={useGps} className="rounded-xl border border-emerald-300/50 bg-emerald-300 px-4 py-2.5 text-sm font-extrabold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-200 focus:outline-none focus:ring-4 focus:ring-emerald-300/25">Detect my location</button>
            </div>

            <div className="mt-5 inline-flex rounded-xl border border-slate-700 bg-slate-900 p-1" role="group" aria-label="Location selection mode">
              <button type="button" aria-pressed={form.location_mode !== 'gps'} onClick={() => setForm({ ...form, location_mode: 'manual', latitude: '', longitude: '' })} className={`rounded-lg px-4 py-2.5 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-300/50 ${form.location_mode !== 'gps' ? 'bg-emerald-300 text-slate-950 shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>Manual location</button>
              <button type="button" aria-pressed={form.location_mode === 'gps'} onClick={useGps} className={`rounded-lg px-4 py-2.5 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-300/50 ${form.location_mode === 'gps' ? 'bg-emerald-300 text-slate-950 shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>GPS mode</button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-bold text-slate-200 sm:col-span-1">
                Country
                <input required maxLength={100} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value, state: '', district: '', city: '' })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 font-normal text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/15" />
              </label>
              <IndiaLocationFields
                country={form.country}
                state={form.state}
                district={form.district}
                onChange={(location) => setForm({ ...form, ...location })}
              />
              <label className="text-sm font-bold text-slate-200">
                City / locality (optional)
                <input maxLength={100} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 font-normal text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/15" />
              </label>
            </div>
            {form.location_mode === 'gps' && form.latitude !== '' && (
              <p className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200">GPS coordinates: {form.latitude}, {form.longitude}</p>
            )}
            <p className="mt-4 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">GPS requires browser permission. Your coordinates are saved only when you press <strong className="text-slate-200">Save profile</strong>.</p>
          </div>

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
          <button disabled={isSaving} className="rounded-xl border border-emerald-300/40 bg-emerald-400 px-7 py-3.5 font-extrabold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-300/25 disabled:cursor-wait disabled:opacity-60">
            {isSaving ? 'Saving profile...' : 'Save profile'}
          </button>
        </form>
      </section>
    </div>
  );
}
