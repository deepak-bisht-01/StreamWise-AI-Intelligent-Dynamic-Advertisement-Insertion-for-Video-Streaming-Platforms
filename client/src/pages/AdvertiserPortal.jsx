import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlinePhoto, HiOutlineVideoCamera } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '../services/api.js';
import IndiaLocationFields from '../components/IndiaLocationFields.jsx';
import { formatDate, formatDuration } from '../utils/format.js';

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10';
const initialForm = { brandName: '', contactName: '', contactPhone: '', websiteUrl: '', country: 'India', state: '', district: '', city: '', latitude: '', longitude: '', radiusKm: '10', notes: '' };

function quotePreview(rateCard, videos, radiusKm, targetLocation) {
  const selectedVideos = Array.isArray(videos) ? videos : [];
  const tiers = ['standard', 'featured', 'premium'];
  const defaultMultipliers = { standard: 1, featured: 1.5, premium: 2 };
  const tierCounts = Object.fromEntries(tiers.map((tier) => [tier, selectedVideos.filter((video) => (video.priorityTier || 'standard') === tier).length]));
  const priorityMultipliers = { ...defaultMultipliers, ...(rateCard?.priorityMultipliers || {}) };
  const tierAmounts = Object.fromEntries(tiers.map((tier) => [tier, tierCounts[tier] * Number(rateCard?.baseFeePerVideo || 0) * Number(priorityMultipliers[tier])]));
  const matches = (rateCard?.locationRates || []).filter((rule) => ['country', 'state', 'district', 'city'].every((field) => !rule[field] || String(rule[field]).trim().toLowerCase() === String(targetLocation?.[field] || '').trim().toLowerCase()));
  matches.sort((a, b) => ['country', 'state', 'district', 'city'].filter((field) => b[field]).length - ['country', 'state', 'district', 'city'].filter((field) => a[field]).length);
  const locationRule = matches[0];
  const locationFeePerVideo = Number(locationRule?.feePerVideo ?? rateCard?.locationFeePerVideo ?? 0);
  const radiusBlocks = Math.ceil(Number(radiusKm || 0) / 10);
  const base = Object.values(tierAmounts).reduce((sum, amount) => sum + amount, 0);
  const location = selectedVideos.length * locationFeePerVideo;
  const radius = selectedVideos.length * radiusBlocks * Number(rateCard?.radiusFeePer10Km || 0);
  const subtotal = base + location + radius;
  const tax = Math.round(subtotal * Number(rateCard?.taxPercent || 0)) / 100;
  const locationRateLabel = locationRule ? [locationRule.city, locationRule.district, locationRule.state, locationRule.country].filter(Boolean).join(', ') : 'Default regional rate';
  return { count: selectedVideos.length, base, location, radius, subtotal, tax, total: subtotal + tax, radiusBlocks,
    tierCounts, tierAmounts, priorityMultipliers, locationFeePerVideo, locationRateLabel };
}

function StatusPill({ status }) {
  const classes = status === 'completed' ? 'bg-emerald-400/10 text-emerald-300'
    : ['paid', 'processing', 'quoted'].includes(status) ? 'bg-sky-400/10 text-sky-300'
      : ['failed', 'rejected'].includes(status) ? 'bg-rose-400/10 text-rose-300'
        : 'bg-amber-400/10 text-amber-300';
  const label = ({ submitted: 'Submitted', quoted: 'Quote ready', paid: 'Paid · rendering queued', processing: 'Rendering logos', completed: 'Rendered · admin review', partial: 'Partially rendered', failed: 'Rendering failed', rejected: 'Declined' })[status] || status;
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${classes}`}>{label}</span>;
}

function Breakdown({ breakdown, title }) {
  if (!breakdown) return null;
  return <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</p>
    <dl className="space-y-1.5 text-sm text-slate-300">
      <div className="flex justify-between gap-4"><dt>Video placements - priority adjusted</dt><dd>{money(breakdown.baseAmount ?? breakdown.base)}</dd></div>
      {breakdown.tierCounts && ['standard', 'featured', 'premium'].filter((tier) => breakdown.tierCounts[tier]).map((tier) => <div key={tier} className="flex justify-between gap-4 pl-3 text-xs text-slate-500"><dt className="capitalize">{tier} - {breakdown.tierCounts[tier]} x {money(breakdown.baseFeePerVideo)} x {breakdown.priorityMultipliers?.[tier] || 1}</dt><dd>{money(breakdown.tierAmounts?.[tier])}</dd></div>)}
      <div className="flex justify-between gap-4"><dt>Location fee - {breakdown.locationRateLabel || 'selected region'} ({breakdown.count} x {money(breakdown.locationFeePerVideo)})</dt><dd>{money(breakdown.locationAmount ?? breakdown.location)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Radius ({breakdown.radiusBlocks} blocks x {breakdown.count} videos)</dt><dd>{money(breakdown.radiusAmount ?? breakdown.radius)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-slate-800 pt-2"><dt>Subtotal</dt><dd>{money(breakdown.subtotal)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Tax ({breakdown.taxPercent}%)</dt><dd>{money(breakdown.taxAmount ?? breakdown.tax)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-slate-700 pt-2 text-base font-extrabold text-emerald-300"><dt>Total</dt><dd>{money(breakdown.total)}</dd></div>
    </dl>
  </div>;
}

export default function AdvertiserPortal() {
  const [inventory, setInventory] = useState([]);
  const [requests, setRequests] = useState([]);
  const [rateCard, setRateCard] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [logo, setLogo] = useState(null);
  const [videoIds, setVideoIds] = useState([]);
  const [videoLinks, setVideoLinks] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paymentReferences, setPaymentReferences] = useState({});
  const [paymentSubmittingId, setPaymentSubmittingId] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [inventoryResponse, requestResponse, rateResponse] = await Promise.all([
        api.get('/advertiser-requests/inventory'), api.get('/advertiser-requests'), api.get('/advertiser-requests/rate-card'),
      ]);
      setInventory(inventoryResponse.data.data || []);
      setRequests(requestResponse.data.data || []);
      setRateCard(rateResponse.data.data || null);
    } catch (loadError) { setError(getErrorMessage(loadError)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const selectedIds = useMemo(() => {
    const parsed = [...videoLinks.matchAll(uuidPattern)].map((match) => match[0].toLowerCase());
    return [...new Set([...videoIds, ...parsed])];
  }, [videoIds, videoLinks]);
  const preview = quotePreview(rateCard, selectedIds.map((id) => inventory.find((video) => video.id === id) || { priorityTier: 'standard' }), form.radiusKm, form);

  function toggleVideo(id) {
    setVideoIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  async function copyVideoLink(video) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${video.link}`);
      toast.success('Video link copied.');
    } catch { toast.error('Could not copy the video link.'); }
  }

  async function submitPaymentReference(request) {
    const paymentReference = paymentReferences[request.id]?.trim();
    if (!paymentReference) { setError('Enter the UTR or transaction reference after paying.'); return; }
    setPaymentSubmittingId(request.id); setError('');
    try {
      await api.post(`/advertiser-requests/${request.id}/payment-reference`, { paymentReference });
      toast.success('Payment reference sent to the admin for verification.');
      await load();
    } catch (paymentError) { setError(getErrorMessage(paymentError)); }
    finally { setPaymentSubmittingId(''); }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!logo) { setError('Choose your brand logo first.'); return; }
    if (!selectedIds.length) { setError('Select one or more ad-ready videos or paste their video links.'); return; }
    if (videoLinks.trim() && ![...videoLinks.matchAll(uuidPattern)].length) { setError('The pasted video links did not contain a valid StreamWise video ID.'); return; }
    setSaving(true);
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
    payload.append('videoIds', JSON.stringify(selectedIds));
    payload.append('logo', logo);
    try {
      await api.post('/advertiser-requests', payload);
      toast.success('Your advertising request has been sent to the admin.');
      setForm(initialForm); setLogo(null); setVideoIds([]); setVideoLinks('');
      await load();
    } catch (submitError) { setError(getErrorMessage(submitError)); }
    finally { setSaving(false); }
  }

  return <div className="hero-glow min-h-screen px-4 py-10 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-300">Advertiser studio</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-100 sm:text-4xl">Place your brand on local videos</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Send your logo, targeting area and the videos you want. An admin reviews the request, issues the final quote, and confirms payment before logo rendering begins.</p></div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-300 hover:bg-slate-800"><HiOutlineArrowPath className="h-4 w-4" /> Refresh requests</button>
      </header>

      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <form onSubmit={submit} className="card-shadow rounded-3xl border border-slate-800 bg-slate-900/80 p-5 sm:p-7">
          <div className="mb-6"><h2 className="text-xl font-bold text-slate-100">Create an ad request</h2><p className="mt-1 text-sm text-slate-400">Your estimate changes with the target location, radius, and admin-assigned value tier of every video.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-300">Brand / business name<input required maxLength={160} value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} className={inputClass} placeholder="Your brand" /></label>
            <label className="text-sm font-semibold text-slate-300">Contact person<input required maxLength={160} value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} className={inputClass} placeholder="Name" /></label>
            <label className="text-sm font-semibold text-slate-300">Phone / WhatsApp<input maxLength={40} value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} className={inputClass} placeholder="Optional" /></label>
            <label className="text-sm font-semibold text-slate-300">Website<input maxLength={300} value={form.websiteUrl} onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })} className={inputClass} placeholder="https://" /></label>
            <label className="text-sm font-semibold text-slate-300 sm:col-span-2">Brand logo<input required type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => setLogo(event.target.files?.[0] || null)} className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-400/10 file:px-3 file:py-2 file:font-semibold file:text-emerald-300`} /><span className="mt-1 block text-xs font-normal text-slate-500">Transparent PNG recommended · JPG, PNG or WebP · up to 20 MB</span>{logo && <span className="mt-1 block text-xs text-emerald-300">Selected: {logo.name}</span>}</label>
            <label className="text-sm font-semibold text-slate-300">Country<input required maxLength={100} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value, state: '', district: '', city: '' })} className={inputClass} /></label>
            <IndiaLocationFields country={form.country} state={form.state} district={form.district} onChange={(location) => setForm({ ...form, ...location })} />
            <label className="text-sm font-semibold text-slate-300">City / locality<input maxLength={100} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={inputClass} placeholder="Optional" /></label>
            <label className="text-sm font-semibold text-slate-300">Target radius (km)<input required type="number" min="1" max="5000" value={form.radiusKm} onChange={(event) => setForm({ ...form, radiusKm: event.target.value })} className={inputClass} /></label>
            <label className="text-sm font-semibold text-slate-300">Center latitude<input type="number" step="any" min="-90" max="90" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} className={inputClass} placeholder="Optional GPS" /></label>
            <label className="text-sm font-semibold text-slate-300">Center longitude<input type="number" step="any" min="-180" max="180" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} className={inputClass} placeholder="Optional GPS" /></label>
            <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Add GPS coordinates for precise radius matching. Without them, the ad uses the selected city, district or state region.</p>
            <label className="text-sm font-semibold text-slate-300 sm:col-span-2">Message to admin - urgency / contact instructions<textarea maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={inputClass} rows={3} placeholder="Urgency, preferred dates, campaign instructions, or best contact time" /></label>
          </div>

          <div className="mt-7 border-t border-slate-800 pt-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-bold text-slate-100">Choose videos</h3><p className="mt-1 text-xs text-slate-400">Select ad-ready videos; each card shows its admin-assigned value tier and estimated rate.</p></div><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">{selectedIds.length} selected</span></div>
            <textarea value={videoLinks} onChange={(event) => setVideoLinks(event.target.value)} rows={2} className={`${inputClass} mt-3`} placeholder="Or paste one or more StreamWise video links / IDs, one per line" />
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {loading ? <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-500">Loading eligible videos…</p> : inventory.length ? inventory.map((video) => <div key={video.id} className={`flex items-start gap-3 rounded-xl border p-3 transition ${videoIds.includes(video.id) ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'}`}>
                <input id={`video-${video.id}`} type="checkbox" checked={videoIds.includes(video.id)} onChange={() => toggleVideo(video.id)} className="mt-1 accent-emerald-400" />
                <HiOutlineVideoCamera className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" /><span className="rounded-full bg-indigo-400/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-indigo-200">{video.priorityTier || 'standard'}</span>
                <label htmlFor={`video-${video.id}`} className="min-w-0 flex-1 cursor-pointer"><strong className="block truncate text-sm text-slate-100">{video.title}</strong><span className="mt-1 block text-xs text-slate-400">By {video.creatorName} · {formatDuration(video.duration)} · {video.slotCount} detected slot{video.slotCount === 1 ? '' : 's'}</span><code className="mt-1 block truncate text-[10px] text-slate-600">{video.id}</code></label>
                <button type="button" onClick={() => copyVideoLink(video)} className="shrink-0 text-[11px] font-bold text-indigo-300 hover:text-indigo-200">Copy link</button>
              </div>) : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">No videos are ready for ad insertion yet. Ask the admin to complete billboard detection first.</p>}
            </div>
          </div>
          {rateCard && <div className="mt-6">{[rateCard.baseFeePerVideo, rateCard.locationFeePerVideo, rateCard.radiusFeePer10Km].some((value) => Number(value) > 0) || (rateCard.locationRates || []).length > 0
            ? <><p className="text-xs text-slate-500">Indicative estimate uses your target area and each video's admin-assigned advertiser tier. The admin confirms the final amount.</p><Breakdown breakdown={{ ...preview, baseFeePerVideo: rateCard.baseFeePerVideo, baseAmount: preview.base, locationAmount: preview.location, radiusAmount: preview.radius, taxAmount: preview.tax, radiusFeePer10Km: rateCard.radiusFeePer10Km, taxPercent: rateCard.taxPercent }} title="Estimated total - final quote from admin" /></>
            : <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-200">The admin rate card is not configured yet. You can submit your request; the admin will set regional pricing and provide your final quote.</p>}</div>}
          <button type="submit" disabled={saving} className="mt-6 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-300 px-5 py-3.5 text-sm font-extrabold text-slate-950 shadow-lg shadow-emerald-500/10 transition hover:brightness-110 disabled:opacity-60">{saving ? 'Sending request…' : 'Send request to admin'}</button>
        </form>

        <section className="card-shadow rounded-3xl border border-slate-800 bg-slate-900/80 p-5 sm:p-7">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold text-slate-100">Your requests</h2><p className="mt-1 text-sm text-slate-400">Quotes, payment and rendering status</p></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-300">{requests.length}</span></div>
          {loading ? <p className="py-10 text-center text-sm text-slate-500">Loading requests…</p> : requests.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-500"><HiOutlinePhoto className="mx-auto mb-3 h-8 w-8 text-slate-600" />Your submitted campaigns will show here.</div> : <div className="space-y-4">
            {requests.map((request) => <article key={request.id} className="rounded-2xl border border-slate-800 bg-slate-950/65 p-4">
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{request.logoUrl && <img src={request.logoUrl} alt="Brand logo" className="h-10 w-10 rounded-lg bg-white object-contain p-1" />}<div className="min-w-0"><h3 className="truncate font-bold text-slate-100">{request.brandName}</h3><p className="text-xs text-slate-500">{formatDate(request.createdAt)}</p></div></div><StatusPill status={request.status} /></div>
              <p className="mt-3 text-xs leading-5 text-slate-400">{request.videos.length} video{request.videos.length === 1 ? '' : 's'} · {[request.city, request.district, request.state, request.country].filter(Boolean).join(', ')} · {request.radiusKm} km radius</p>
              {request.quotedBreakdown ? <Breakdown breakdown={request.quotedBreakdown} title="Admin quote" /> : <Breakdown breakdown={request.estimatedBreakdown} title="Current estimate · awaiting admin quote" />}
              {request.status === 'quoted' && <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-400/5 p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <img src={request.quotedBreakdown?.paymentQrUrl || '/demo-payment-qr.svg'} alt="Campaign payment QR" className="h-40 w-40 rounded-xl bg-white object-contain p-2" />
                  <div className="min-w-[220px] flex-1"><p className="font-bold text-sky-100">Final quote ready - {money(request.quotedTotal)}</p>{request.adminQuoteNote && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-200">Admin message: {request.adminQuoteNote}</p>}<p className="mt-2 text-xs leading-5 text-sky-200">{request.quotedBreakdown?.paymentInstructions || 'Scan the QR to pay, then submit the UTR or transaction reference for admin verification.'}</p>
                    {(request.quotedBreakdown?.paymentQrUrl || '').includes('demo-payment-qr.svg') && <p className="mt-2 text-xs font-bold text-amber-300">Demo QR only. Ask the admin to configure the real payment QR before paying.</p>}
                    {request.advertiserPaymentReference && <p className="mt-3 text-xs text-emerald-300">Submitted reference: <span className="font-mono">{request.advertiserPaymentReference}</span>{request.paymentSubmittedAt ? ` - ${formatDate(request.paymentSubmittedAt)}` : ''}. Waiting for admin verification.</p>}
                    <label className="mt-3 block text-xs font-semibold text-slate-300">UPI UTR / bank transaction reference<input value={paymentReferences[request.id] ?? request.advertiserPaymentReference ?? ''} onChange={(event) => setPaymentReferences({ ...paymentReferences, [request.id]: event.target.value })} maxLength={120} className={inputClass} placeholder="Enter after completing payment" /></label>
                    <button type="button" onClick={() => submitPaymentReference(request)} disabled={paymentSubmittingId === request.id} className="mt-3 rounded-xl bg-sky-300 px-4 py-2.5 text-xs font-extrabold text-slate-950 disabled:opacity-50">{paymentSubmittingId === request.id ? 'Sending...' : request.advertiserPaymentReference ? 'Update payment reference' : 'Send payment reference'}</button>
                  </div>
                </div>
              </div>}
              {request.adminNote && <p className="mt-3 text-xs text-rose-300">Admin note: {request.adminNote}</p>}
              {request.receiptNumber && <Link to={`/advertiser-receipt/${request.id}`} className="mt-3 inline-flex rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-400/15">Open receipt · {request.receiptNumber}</Link>}
              {request.videos.some((video) => video.status === 'failed') && <ul className="mt-3 space-y-1 text-xs text-rose-300">{request.videos.filter((video) => video.status === 'failed').map((video) => <li key={video.id}>{video.title}: {video.error || 'Render failed'}</li>)}</ul>}
            </article>)}
          </div>}
        </section>
      </div>
    </div>
  </div>;
}
