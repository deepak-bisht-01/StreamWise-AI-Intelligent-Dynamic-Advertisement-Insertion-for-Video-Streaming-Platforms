import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import api, { getErrorMessage } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import IndiaLocationFields from '../components/IndiaLocationFields.jsx';

const initialCampaign = {
  brandName: '', category: '', name: '', country: 'India', state: '', district: '', city: '',
  latitude: '', longitude: '', radiusKm: '50', priority: '0',
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value.trim()); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one campaign row.');
  const headers = rows.shift().map((header) => header.toLowerCase());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
}

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-normal text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100';

export default function BrandManager() {
  const { user, profile, loading } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(initialCampaign);
  const [creative, setCreative] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [importFile, setImportFile] = useState(null);
  const creativeInput = useRef(null);

  async function loadCampaigns() {
    const response = await api.get('/brands/ads');
    setCampaigns(response.data.data || []);
  }

  useEffect(() => {
    if (!loading && user && profile?.role === 'admin') {
      loadCampaigns().catch((loadError) => setError(getErrorMessage(loadError)));
    }
  }, [loading, user?.id, profile?.role]);

  if (loading) return <div className="px-4 py-16 text-center text-slate-500">Checking administrator access...</div>;
  if (!user) return <Navigate to="/account" replace />;
  if (profile?.role !== 'admin') {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center"><h1 className="text-2xl font-bold text-slate-900">Administrator access required</h1><p className="mt-2 text-slate-600">Ask a project administrator to enable brand inventory access for your account.</p><Link to="/account" className="mt-5 inline-flex font-semibold text-emerald-700">Return to your profile</Link></div>;
  }

  async function createCampaign(event) {
    event.preventDefault();
    if (!creative) { setError('Choose an ad creative file.'); return; }
    setIsSaving(true); setError(''); setMessage('');
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
    payload.append('creative', creative);
    try {
      await api.post('/brands/ads', payload);
      setForm(initialCampaign);
      setCreative(null);
      if (creativeInput.current) creativeInput.current.value = '';
      setMessage('Brand campaign saved. It is now available for location matching.');
      await loadCampaigns();
    } catch (saveError) { setError(getErrorMessage(saveError)); }
    finally { setIsSaving(false); }
  }

  async function importCsv() {
    if (!importFile) return;
    setError(''); setMessage('');
    try {
      const rows = parseCsv(await importFile.text());
      const response = await api.post('/brands/ads/import', { rows });
      const result = response.data.data;
      setMessage(`Imported ${result.imported} campaign(s); ${result.failed} row(s) failed.`);
      const failures = result.results.filter((item) => !item.success).map((item) => `Row ${item.row}: ${item.error}`);
      if (failures.length) setError(failures.join(' | '));
      setImportFile(null);
      await loadCampaigns();
    } catch (importError) { setError(getErrorMessage(importError)); }
  }

  async function deleteCampaign(campaign) {
    if (!window.confirm(`Remove the ${campaign.brands?.name || 'brand'} campaign and its uploaded creative?`)) return;
    setDeletingId(campaign.id); setError(''); setMessage('');
    try {
      await api.delete(`/brands/ads/${campaign.id}`);
      setCampaigns((items) => items.filter((item) => item.id !== campaign.id));
      setMessage('Campaign removed from regional ad selection.');
    } catch (deleteError) { setError(getErrorMessage(deleteError)); }
    finally { setDeletingId(''); }
  }

  async function copyCreativeUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Creative URL copied. Paste it into the CSV creative_url column.');
      setError('');
    } catch {
      setError('Clipboard access is unavailable. Open the creative URL and copy it from the address bar.');
    }
  }

  return (
    <div className="hero-glow min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-600">Regional ad inventory</p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">Manage brand campaigns</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Store reusable local-brand creatives with their targeting. Add these campaigns to billboard slots from a video's review page, or upload a one-off creative there.</p>
          </div>
          <Link to="/account" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Profile and location</Link>
        </header>

        {(error || message) && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role={error ? 'alert' : 'status'}>{error || message}</div>}

        <div className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
          <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-5 sm:p-7">
            <h2 className="text-xl font-bold text-slate-900">Add a brand campaign</h2>
            <p className="mt-1 text-sm text-slate-500">One brand can have multiple creatives for different locations.</p>
            <form onSubmit={createCampaign} className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">Brand name<input required maxLength={160} value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700">Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Food, retail, travel..." className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Campaign label<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Optional; defaults to brand name" className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700">Country<input required value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value, state: '', district: '', city: '' })} className={inputClass} /></label>
              <IndiaLocationFields
                country={form.country}
                state={form.state}
                district={form.district}
                onChange={(location) => setForm({ ...form, ...location })}
              />
              <label className="text-sm font-semibold text-slate-700">City / locality (optional)<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700">Priority (0-1000)<input type="number" min="0" max="1000" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700">Campaign latitude<input type="number" step="any" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="Optional" className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700">Campaign longitude<input type="number" step="any" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="Optional" className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700">GPS target radius (km)<input required type="number" min="1" max="5000" value={form.radiusKm} onChange={(event) => setForm({ ...form, radiusKm: event.target.value })} className={inputClass} /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Creative image or video<input ref={creativeInput} required type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.mkv,.avi" onChange={(event) => setCreative(event.target.files?.[0] || null)} className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:font-semibold file:text-emerald-700`} /><span className="mt-1 block text-xs font-normal text-slate-500">Uploaded to the brand-creatives Supabase bucket (max 100 MB).</span></label>
              <button disabled={isSaving} className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-60 sm:col-span-2">{isSaving ? 'Saving campaign...' : 'Save campaign'}</button>
            </form>
          </section>

          <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-5 sm:p-7">
            <h2 className="text-xl font-bold text-slate-900">Import campaign CSV</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Bulk import up to 500 rows. Upload each creative through the form first, then use its public URL from the inventory list.</p>
            <div className="mt-4 rounded-xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
              <p className="font-bold text-emerald-300">Required CSV headers</p>
              <code className="break-all">brand_name,category,name,creative_url,creative_type,country,state,district,city,latitude,longitude,radius_km,priority</code>
              <p className="mt-2 text-slate-300">Creative URLs must point to this project's public brand-creatives bucket.</p>
            </div>
            <a href="/brand-campaigns-template.csv" download className="mt-3 inline-flex text-sm font-semibold text-indigo-700 hover:underline">Download CSV template</a>
            <input type="file" accept=".csv,text/csv" onChange={(event) => setImportFile(event.target.files?.[0] || null)} className={`${inputClass} mt-4`} />
            <button type="button" disabled={!importFile} onClick={importCsv} className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">Import campaigns</button>
          </section>
        </div>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Campaign inventory</h2><p className="mt-1 text-sm text-slate-500">{campaigns.length} saved campaign{campaigns.length === 1 ? '' : 's'}</p></div><button onClick={() => loadCampaigns().catch((loadError) => setError(getErrorMessage(loadError)))} className="rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Refresh</button></div>
          {campaigns.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No campaigns yet. Add a local brand campaign or import your CSV.</div> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {campaigns.map((campaign) => (
                <article key={campaign.id} className="card-shadow min-w-0 overflow-hidden rounded-2xl border border-slate-100 bg-white">
                  {campaign.creative_type === 'image' ? <img src={campaign.creative_url} alt={`${campaign.brands?.name || 'Brand'} creative`} className="aspect-video w-full bg-slate-100 object-cover" /> : <video src={campaign.creative_url} controls preload="metadata" className="aspect-video w-full bg-slate-950" />}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-bold text-slate-900">{campaign.brands?.name || 'Brand'}</h3><p className="text-xs text-slate-500">{campaign.name} · {campaign.brands?.category}</p></div><button onClick={() => deleteCampaign(campaign)} disabled={Boolean(deletingId)} className="shrink-0 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{deletingId === campaign.id ? 'Removing...' : 'Remove'}</button></div>
                    <p className="mt-3 text-xs leading-5 text-slate-600">{[campaign.city, campaign.district, campaign.state, campaign.country].filter(Boolean).join(', ')}{campaign.latitude !== null ? ` · within ${campaign.radius_km} km` : ' · regional targeting'} · Priority {campaign.priority}</p>
                    <div className="mt-2 flex items-center gap-3"><a href={campaign.creative_url} target="_blank" rel="noreferrer" className="truncate text-xs font-medium text-indigo-700 hover:underline">Open creative</a><button type="button" onClick={() => copyCreativeUrl(campaign.creative_url)} className="shrink-0 text-xs font-semibold text-slate-500 hover:text-slate-800">Copy URL</button></div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
