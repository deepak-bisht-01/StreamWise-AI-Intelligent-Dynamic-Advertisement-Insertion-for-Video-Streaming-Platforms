import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowPath, HiOutlineBanknotes, HiOutlineCheckBadge, HiOutlineCurrencyRupee, HiOutlineReceiptPercent } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '../services/api.js';
import { formatDate } from '../utils/format.js';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const fieldClass = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400';

function locationRateFor(rate, location) {
  const matches = (rate.locationRates || []).filter((rule) => ['country', 'state', 'district', 'city'].every((field) => !rule[field] || String(rule[field]).trim().toLowerCase() === String(location[field] || '').trim().toLowerCase()));
  matches.sort((a, b) => ['country', 'state', 'district', 'city'].filter((field) => b[field]).length - ['country', 'state', 'district', 'city'].filter((field) => a[field]).length);
  return matches[0] || null;
}

function calculate(rate, videos, radiusKm) {
  const items = Array.isArray(videos) ? videos : [];
  const count = items.length;
  const tierCounts = { standard: 0, featured: 0, premium: 0 };
  const tierAmounts = { standard: 0, featured: 0, premium: 0 };
  items.forEach((video) => {
    const tier = ['standard', 'featured', 'premium'].includes(video.priorityTier) ? video.priorityTier : 'standard';
    tierCounts[tier] += 1;
    tierAmounts[tier] += Number(rate.baseFeePerVideo || 0) * Number(rate.priorityMultipliers?.[tier] || 1);
  });
  const blocks = Math.ceil(Number(radiusKm || 0) / 10);
  const baseAmount = Object.values(tierAmounts).reduce((sum, amount) => sum + amount, 0);
  const locationAmount = count * Number(rate.locationFeePerVideo || 0);
  const radiusAmount = count * blocks * Number(rate.radiusFeePer10Km || 0);
  const subtotal = baseAmount + locationAmount + radiusAmount;
  const taxAmount = Math.round(subtotal * Number(rate.taxPercent || 0)) / 100;
  return { count, baseAmount, locationAmount, radiusAmount, subtotal, taxAmount, total: subtotal + taxAmount, blocks,
    tierCounts, tierAmounts, priorityMultipliers: rate.priorityMultipliers || { standard: 1, featured: 1.5, premium: 2 },
    locationFeePerVideo: Number(rate.locationFeePerVideo || 0), locationRateLabel: rate.locationRateLabel || 'Selected location' };
}

function NumberField({ label, value, onChange, max = '1000000' }) {
  return <label className="text-xs font-semibold text-slate-400">{label}<input type="number" min="0" max={max} step="0.01" value={value ?? 0} onChange={(event) => onChange(event.target.value)} className={fieldClass} /></label>;
}

export default function AdminAdvertiserRequests() {
  const [requests, setRequests] = useState([]);
  const [rateCard, setRateCard] = useState({ baseFeePerVideo: 0, locationFeePerVideo: 0, radiusFeePer10Km: 0, taxPercent: 0, locationRates: [], priorityMultipliers: { standard: 1, featured: 1.5, premium: 2 }, paymentQrUrl: '/demo-payment-qr.svg', paymentInstructions: '' });
  const [drafts, setDrafts] = useState({});
  const [paymentRefs, setPaymentRefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [requestResponse, rateResponse] = await Promise.all([api.get('/advertiser-requests/admin'), api.get('/advertiser-requests/rate-card')]);
      setRequests(requestResponse.data.data || []);
      setRateCard(rateResponse.data.data || rateCard);
    } catch (loadError) { setError(getErrorMessage(loadError)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const openCount = useMemo(() => requests.filter((item) => ['submitted', 'quoted', 'paid', 'processing', 'partial', 'failed'].includes(item.status)).length, [requests]);

  function draftFor(request) {
    if (drafts[request.id]) return drafts[request.id];
    const match = locationRateFor(rateCard, request);
    return { ...rateCard, quoteNote: request.adminQuoteNote || '', locationFeePerVideo: match?.feePerVideo ?? rateCard.locationFeePerVideo,
      locationRateLabel: match ? [match.city, match.district, match.state, match.country].filter(Boolean).join(', ') : 'Default regional rate' };
  }

  async function saveRateCard(event) {
    event.preventDefault(); setBusy('rate-card'); setError('');
    try {
      const response = await api.put('/advertiser-requests/rate-card', rateCard);
      setRateCard(response.data.data);
      toast.success('Default advertiser rates saved.');
    } catch (saveError) { setError(getErrorMessage(saveError)); }
    finally { setBusy(''); }
  }

  async function issueQuote(request) {
    setBusy(request.id); setError('');
    try {
      await api.post(`/advertiser-requests/${request.id}/quote`, draftFor(request));
      toast.success(`Quote issued for ${request.brandName}.`);
      await load();
    } catch (quoteError) { setError(getErrorMessage(quoteError)); }
    finally { setBusy(''); }
  }

  async function confirmPayment(request) {
    const paymentReference = paymentRefs[request.id]?.trim() || request.advertiserPaymentReference?.trim();
    if (!paymentReference) { setError('Enter the verified payment reference before issuing a receipt.'); return; }
    setBusy(request.id); setError('');
    try {
      await api.post(`/advertiser-requests/${request.id}/payment`, { paymentReference });
      toast.success('Payment recorded. Receipt issued and logo renders queued.');
      await load();
    } catch (paymentError) { setError(getErrorMessage(paymentError)); }
    finally { setBusy(''); }
  }

  async function reject(request) {
    const reason = window.prompt(`Optional note for ${request.brandName}:`);
    if (reason === null) return;
    setBusy(request.id); setError('');
    try { await api.post(`/advertiser-requests/${request.id}/reject`, { reason }); toast.success('Request declined.'); await load(); }
    catch (rejectError) { setError(getErrorMessage(rejectError)); }
    finally { setBusy(''); }
  }

  async function retry(request) {
    setBusy(request.id); setError('');
    try { await api.post(`/advertiser-requests/${request.id}/retry`); toast.success('Failed video renders queued again.'); await load(); }
    catch (retryError) { setError(getErrorMessage(retryError)); }
    finally { setBusy(''); }
  }

  function updateLocationRate(index, field, value) {
    const next = [...(rateCard.locationRates || [])];
    next[index] = { ...next[index], [field]: value };
    setRateCard({ ...rateCard, locationRates: next });
  }

  function addLocationRate() {
    setRateCard({ ...rateCard, locationRates: [...(rateCard.locationRates || []), { country: 'India', state: '', district: '', city: '', feePerVideo: 0 }] });
  }

  function removeLocationRate(index) {
    setRateCard({ ...rateCard, locationRates: (rateCard.locationRates || []).filter((_rule, ruleIndex) => ruleIndex !== index) });
  }

  return <div className="hero-glow min-h-screen px-4 py-10 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-indigo-300">Advertiser operations</p><h1 className="mt-2 text-3xl font-extrabold text-slate-100 sm:text-4xl">Brand ad requests</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Set default INR rates, issue location-aware quotes, record verified payments and track automatic logo renders.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-300 hover:bg-slate-800"><HiOutlineArrowPath className="h-4 w-4" /> Refresh</button></header>
      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</p>}

      <section className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-black/10 sm:p-7">
        <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-emerald-400/10 p-2.5 text-emerald-300"><HiOutlineCurrencyRupee className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-100">Default INR rate card</h2><p className="text-xs text-slate-500">Set rates before inviting advertisers. Each quote saves a snapshot; adjust the location fee per request before issuing it.</p></div></div>
        <form onSubmit={saveRateCard}>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-semibold text-slate-400">Receipt issuer / registered name<input maxLength={160} value={rateCard.issuerName || ''} onChange={(event) => setRateCard({ ...rateCard, issuerName: event.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-semibold text-slate-400">Business address<textarea maxLength={500} rows={2} value={rateCard.issuerAddress || ''} onChange={(event) => setRateCard({ ...rateCard, issuerAddress: event.target.value })} className={fieldClass} placeholder="Optional registered or business address" /></label>
          <label className="text-xs font-semibold text-slate-400">Tax registration number<input maxLength={100} value={rateCard.issuerTaxId || ''} onChange={(event) => setRateCard({ ...rateCard, issuerTaxId: event.target.value })} className={fieldClass} placeholder="Optional, if applicable" /></label>
        </div>
        <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-200">Location-specific fees</h3><p className="mt-1 text-xs text-slate-500">The most specific matching city, district, or state rule sets the advertiser estimate.</p></div><button type="button" onClick={addLocationRate} className="rounded-lg border border-indigo-400/20 px-3 py-2 text-xs font-bold text-indigo-200 hover:bg-indigo-400/10">Add location rule</button></div>
          {(rateCard.locationRates || []).length === 0 ? <p className="mt-3 text-xs text-slate-500">No overrides yet; the default location fee will apply everywhere.</p> : <div className="mt-3 space-y-3">{rateCard.locationRates.map((rule, index) => <div key={index} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-2 lg:grid-cols-6">
            {['country', 'state', 'district', 'city'].map((field) => <label key={field} className="text-[10px] font-bold capitalize text-slate-500">{field}<input value={rule[field] || ''} onChange={(event) => updateLocationRate(index, field, event.target.value)} className={fieldClass} placeholder={field === 'country' ? 'Required' : 'Any'} /></label>)}
            <NumberField label="Fee / video (INR)" value={rule.feePerVideo} onChange={(value) => updateLocationRate(index, 'feePerVideo', value)} />
            <button type="button" onClick={() => removeLocationRate(index)} className="self-end rounded-lg border border-rose-400/20 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-400/10">Remove</button>
          </div>)}</div>}
        </div>
        <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
          <h3 className="text-sm font-bold text-slate-200">Video priority multipliers</h3><p className="mt-1 text-xs text-slate-500">Admins assign tiers in the video review dashboard. Set higher factors for premium cast, creator reach, or expected demand.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">{['standard', 'featured', 'premium'].map((tier) => <label key={tier} className="text-xs font-semibold capitalize text-slate-400">{tier} multiplier<input type="number" min="0.1" max="10" step="0.1" value={rateCard.priorityMultipliers?.[tier] ?? 1} onChange={(event) => setRateCard({ ...rateCard, priorityMultipliers: { standard: 1, featured: 1.5, premium: 2, ...(rateCard.priorityMultipliers || {}), [tier]: event.target.value } })} className={fieldClass} /></label>)}</div>
        </div>
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-400">Payment QR image URL<input value={rateCard.paymentQrUrl || '/demo-payment-qr.svg'} onChange={(event) => setRateCard({ ...rateCard, paymentQrUrl: event.target.value })} className={fieldClass} placeholder="/demo-payment-qr.svg or HTTPS image URL" /><span className="mt-1 block font-normal text-amber-300">The default demo QR is not scannable. Replace it with your actual UPI QR image before accepting payment.</span></label>
          <label className="text-xs font-semibold text-slate-400">Payment instructions<textarea maxLength={1000} rows={3} value={rateCard.paymentInstructions || ''} onChange={(event) => setRateCard({ ...rateCard, paymentInstructions: event.target.value })} className={fieldClass} placeholder="How should the advertiser pay and submit the UTR?" /></label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <NumberField label="Base fee / video (₹)" value={rateCard.baseFeePerVideo} onChange={(value) => setRateCard({ ...rateCard, baseFeePerVideo: value })} />
          <NumberField label="Location fee / video (₹)" value={rateCard.locationFeePerVideo} onChange={(value) => setRateCard({ ...rateCard, locationFeePerVideo: value })} />
          <NumberField label="Radius fee / 10 km (₹)" value={rateCard.radiusFeePer10Km} onChange={(value) => setRateCard({ ...rateCard, radiusFeePer10Km: value })} />
          <NumberField label="Tax (%)" value={rateCard.taxPercent} onChange={(value) => setRateCard({ ...rateCard, taxPercent: value })} max="100" />
          <button disabled={busy === 'rate-card'} className="self-end rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">{busy === 'rate-card' ? 'Saving…' : 'Save rate card'}</button>
        </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">Quote formula per video: base + location fee + ceil(radius ÷ 10 km) × radius fee. Tax is calculated on the subtotal. Currency is fixed to INR.</p>
      </section>

      <section className="mb-4 flex items-end justify-between"><div><h2 className="text-xl font-bold text-slate-100">Request queue</h2><p className="mt-1 text-sm text-slate-400">{openCount} active request{openCount === 1 ? '' : 's'} · confirm payment only after checking the UTR or transaction in your payment account.</p></div></section>
      {loading ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-slate-400">Loading requests…</div> : requests.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center text-sm text-slate-400">No advertiser requests yet.</div> : <div className="space-y-5">
        {requests.map((request) => {
          const draft = draftFor(request);
          const preview = calculate(draft, request.videos, request.radiusKm);
          return <article key={request.id} className="card-shadow rounded-3xl border border-slate-800 bg-slate-900/80 p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">{request.logoUrl && <img src={request.logoUrl} alt={`${request.brandName} logo`} className="h-16 w-16 rounded-2xl bg-white object-contain p-2" />}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-extrabold text-slate-100">{request.brandName}</h3><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-300">{request.status}</span></div><p className="mt-1 text-sm text-slate-400">{request.contactName} · <a className="text-sky-300 hover:underline" href={`mailto:${request.contactEmail}`}>{request.contactEmail}</a>{request.contactPhone && <> · <a className="text-sky-300 hover:underline" href={`tel:${request.contactPhone}`}>{request.contactPhone}</a></>}</p><p className="mt-1 text-xs text-slate-500">Submitted {formatDate(request.createdAt)}{request.websiteUrl ? <> · <a href={request.websiteUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">Website</a></> : null}</p></div></div>
              {request.receiptNumber && <Link to={`/advertiser-receipt/${request.id}`} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300"><HiOutlineReceiptPercent className="h-4 w-4" /> {request.receiptNumber}</Link>}
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <h4 className="text-sm font-bold text-slate-200">Targeting & selected inventory</h4>
                <p className="mt-2 text-sm text-slate-400">{[request.city, request.district, request.state, request.country].filter(Boolean).join(', ')}</p><p className="text-xs text-slate-500">{request.radiusKm} km radius{request.latitude != null ? ` · GPS ${request.latitude}, ${request.longitude}` : ''}</p>
                {request.notes && <p className="mt-3 whitespace-pre-wrap text-sm leading-5 text-slate-300">{request.notes}</p>}
                <ul className="mt-4 space-y-2">{request.videos.map((video) => <li key={video.id} className="rounded-xl bg-slate-900 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-slate-200">{video.title}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${video.status === 'completed' ? 'bg-emerald-400/10 text-emerald-300' : video.status === 'failed' ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-800 text-slate-400'}`}>{video.status}</span></div><p className="mt-1 text-xs text-slate-500">By {video.creatorName} · ID {video.videoId || 'Source video deleted'}</p>{video.videoId && <Link to={`/watch/${video.videoId}`} className="mt-2 inline-flex text-xs font-bold text-indigo-300 hover:underline">Open video review</Link>}{video.error && <p className="mt-1 text-xs text-rose-300">{video.error}</p>}</li>)}</ul>
              </div>

              <div className="space-y-4">
                {['submitted', 'quoted'].includes(request.status) && <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <h4 className="mb-3 text-sm font-bold text-slate-200">Quote components · {request.videos.length} videos · {request.radiusKm} km</h4>
                  <div className="grid gap-3 sm:grid-cols-2"><NumberField label="Base fee / video (₹)" value={draft.baseFeePerVideo} onChange={(value) => setDrafts({ ...drafts, [request.id]: { ...draft, baseFeePerVideo: value } })} /><NumberField label="Location surcharge / video (₹)" value={draft.locationFeePerVideo} onChange={(value) => setDrafts({ ...drafts, [request.id]: { ...draft, locationFeePerVideo: value } })} /><NumberField label="Radius fee / 10 km (₹)" value={draft.radiusFeePer10Km} onChange={(value) => setDrafts({ ...drafts, [request.id]: { ...draft, radiusFeePer10Km: value } })} /><NumberField label="Tax (%)" value={draft.taxPercent} onChange={(value) => setDrafts({ ...drafts, [request.id]: { ...draft, taxPercent: value } })} max="100" /></div>
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400"><p className="font-bold text-slate-300">Priority pricing breakdown</p><div className="mt-2 space-y-1">{['standard', 'featured', 'premium'].filter((tier) => preview.tierCounts[tier]).map((tier) => <p key={tier} className="flex justify-between gap-3"><span className="capitalize">{tier} · {preview.tierCounts[tier]} placement(s) × {draft.priorityMultipliers?.[tier] || 1} multiplier</span><span>{money(preview.tierAmounts[tier])}</span></p>)}</div><p className="mt-2 border-t border-slate-800 pt-2">Location rate: {preview.locationRateLabel} · {money(preview.locationFeePerVideo)} per video</p></div>
                  <label className="mt-3 block text-xs font-semibold text-slate-400">QR image URL included with this quote<input value={draft.paymentQrUrl || '/demo-payment-qr.svg'} onChange={(event) => setDrafts({ ...drafts, [request.id]: { ...draft, paymentQrUrl: event.target.value } })} className={fieldClass} /></label>
                  <img src={draft.paymentQrUrl || '/demo-payment-qr.svg'} alt="Payment QR preview" className="mt-3 h-32 w-32 rounded-xl bg-white object-contain p-2" />
                  <label className="mt-3 block text-xs font-semibold text-slate-400">Message to advertiser<textarea maxLength={2000} rows={3} value={draft.quoteNote || ''} onChange={(event) => setDrafts({ ...drafts, [request.id]: { ...draft, quoteNote: event.target.value } })} className={fieldClass} placeholder="Quote details, urgency response, or payment notes" /></label>
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-sm"><span className="text-slate-400">Calculated quote</span><strong className="text-emerald-300">{money(preview.total)}</strong></div>
                  <button onClick={() => issueQuote(request)} disabled={busy === request.id} className="mt-3 w-full rounded-xl bg-indigo-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 hover:bg-indigo-300 disabled:opacity-50">{busy === request.id ? 'Saving…' : request.status === 'quoted' ? 'Update & issue quote' : 'Issue final quote'}</button>
                  <button onClick={() => reject(request)} disabled={busy === request.id} className="mt-2 w-full rounded-xl border border-rose-400/20 px-4 py-2 text-xs font-bold text-rose-300 hover:bg-rose-400/10">Decline request</button>
                </div>}

                {request.quotedBreakdown && <div className="rounded-2xl border border-indigo-400/15 bg-indigo-400/5 p-4"><div className="flex items-center gap-2 text-sm font-bold text-indigo-200"><HiOutlineCheckBadge className="h-5 w-5" /> Final quote · {money(request.quotedTotal)}</div><p className="mt-1 text-xs text-slate-400">Location and radius-based breakdown is saved in the receipt record.</p>
                  {request.status === 'quoted' && <div className="mt-3"><label className="text-xs font-semibold text-slate-400">{request.advertiserPaymentReference ? 'Advertiser-submitted reference - verify with the payment provider' : 'Verified payment transaction / reference'}<input value={paymentRefs[request.id] ?? request.advertiserPaymentReference ?? ''} onChange={(event) => setPaymentRefs({ ...paymentRefs, [request.id]: event.target.value })} className={fieldClass} placeholder="Enter the reference after payment is received" /></label><button onClick={() => confirmPayment(request)} disabled={busy === request.id} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"><HiOutlineBanknotes className="h-4 w-4" />{busy === request.id ? 'Confirming…' : 'Confirm payment & issue receipt'}</button></div>}
                </div>}

                {request.receiptNumber && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="text-sm text-emerald-200">Paid {request.paidAt ? formatDate(request.paidAt) : ''} · Ref {request.paymentReference}</p><Link to={`/advertiser-receipt/${request.id}`} className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-extrabold text-slate-950">Print receipt</Link></div>}
                {['paid', 'processing', 'partial', 'failed', 'completed'].includes(request.status) && <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-sm font-bold text-slate-200">Logo render status: <span className="text-emerald-300">{request.status}</span></p><p className="mt-1 text-xs text-slate-500">Generated outputs are added to each video's admin review panel. Approve them there before viewer playback.</p>{['partial', 'failed'].includes(request.status) && <button onClick={() => retry(request)} disabled={busy === request.id} className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">{busy === request.id ? 'Queueing…' : 'Retry failed video renders'}</button>}</div>}
              </div>
            </div>
          </article>;
        })}
      </div>}
    </div>
  </div>;
}
