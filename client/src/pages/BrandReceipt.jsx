import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlinePrinter, HiOutlineReceiptPercent } from 'react-icons/hi2';
import api, { getErrorMessage } from '../services/api.js';
import { formatDate } from '../utils/format.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));

export default function BrandReceipt() {
  const { id } = useParams();
  const { profile } = useAuth();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get(`/advertiser-requests/${id}/receipt`)
      .then((response) => { if (active) setReceipt(response.data.data); })
      .catch((loadError) => { if (active) setError(getErrorMessage(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  if (loading) return <div className="px-4 py-20 text-center text-slate-400">Loading receipt…</div>;
  if (error || !receipt) return <div className="mx-auto max-w-xl px-4 py-20 text-center"><p role="alert" className="text-rose-300">{error || 'Receipt not found'}</p><Link to={profile?.role === 'admin' ? '/admin/advertiser-requests' : '/advertise'} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-emerald-300"><HiOutlineArrowLeft /> Back to advertiser studio</Link></div>;

  const breakdown = receipt.quotedBreakdown;
  return <div className="min-h-screen bg-slate-950 px-4 py-10 sm:px-6">
    <div className="no-print mx-auto mb-5 flex max-w-4xl items-center justify-between gap-3"><Link to={profile?.role === 'admin' ? '/admin/advertiser-requests' : '/advertise'} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-300"><HiOutlineArrowLeft /> Back</Link><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-slate-950"><HiOutlinePrinter /> Print / Save as PDF</button></div>
    <article className="receipt-paper mx-auto max-w-4xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-10">
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-700 pb-7">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-300">Payment receipt</p><h1 className="mt-2 text-2xl font-extrabold text-slate-100">{breakdown.issuerName || 'StreamWise AI'}</h1>{breakdown.issuerAddress && <p className="mt-1 max-w-md whitespace-pre-wrap text-sm text-slate-400">{breakdown.issuerAddress}</p>}{breakdown.issuerTaxId && <p className="mt-1 text-xs text-slate-400">Tax registration: {breakdown.issuerTaxId}</p>}</div>
        <div className="text-right"><p className="text-xs uppercase tracking-wider text-slate-500">Receipt number</p><p className="mt-1 font-mono text-base font-bold text-slate-100">{receipt.receiptNumber}</p><p className="mt-2 text-sm text-slate-400">Issued {formatDate(receipt.paidAt)}</p></div>
      </div>

      <div className="grid gap-6 border-b border-slate-800 py-7 sm:grid-cols-2">
        <section><h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Received from</h2><div className="mt-2 flex items-center gap-3">{receipt.logoUrl && <img src={receipt.logoUrl} alt={`${receipt.brandName} logo`} className="h-11 w-11 rounded-lg bg-white object-contain p-1" />}<div><p className="font-bold text-slate-100">{receipt.brandName}</p><p className="text-sm text-slate-300">{receipt.contactName}</p></div></div><p className="mt-1 text-sm text-slate-300">{receipt.contactEmail}</p>{receipt.contactPhone && <p className="text-sm text-slate-300">{receipt.contactPhone}</p>}</section>
        <section><h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Campaign targeting</h2><p className="mt-2 font-semibold text-slate-100">{[receipt.city, receipt.district, receipt.state, receipt.country].filter(Boolean).join(', ')}</p><p className="text-sm text-slate-300">{receipt.radiusKm} km radius{receipt.latitude != null ? ` · center ${receipt.latitude}, ${receipt.longitude}` : ''}</p><p className="text-sm text-slate-400">{receipt.videos.length} selected video placement{receipt.videos.length === 1 ? '' : 's'}</p></section>
      </div>

      <section className="py-7"><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Video placements</h2><div className="divide-y divide-slate-800">{receipt.videos.map((video, index) => <div key={video.id} className="flex justify-between gap-4 py-2.5 text-sm"><span className="text-slate-200">{index + 1}. {video.title}<small className="mt-0.5 block text-xs text-slate-500">Creator: {video.creatorName} · {video.videoId || 'Source video deleted'}</small></span><span className="shrink-0 text-slate-400">{video.status === 'completed' ? 'Logo rendered' : video.status}</span></div>)}</div></section>

      <section className="ml-auto max-w-md border-t border-slate-700 pt-5">
        <div className="space-y-2 text-sm text-slate-300">
          <div className="flex justify-between gap-4"><span>Video placements - priority adjusted</span><span>{money(breakdown.baseAmount)}</span></div>{breakdown.tierCounts && ['standard', 'featured', 'premium'].filter((tier) => breakdown.tierCounts[tier]).map((tier) => <div key={tier} className="flex justify-between gap-4 pl-3 text-xs text-slate-500"><span className="capitalize">{tier} - {breakdown.tierCounts[tier]} x {breakdown.priorityMultipliers?.[tier] || 1}</span><span>{money(breakdown.tierAmounts?.[tier])}</span></div>)}
          <div className="flex justify-between gap-4"><span>Location fee - {breakdown.locationRateLabel || 'selected region'} · {breakdown.count} x {money(breakdown.locationFeePerVideo)}</span><span>{money(breakdown.locationAmount)}</span></div>
          <div className="flex justify-between gap-4"><span>Radius fee · {breakdown.count} × {breakdown.radiusBlocks} × {money(breakdown.radiusFeePer10Km)}</span><span>{money(breakdown.radiusAmount)}</span></div>
          <div className="flex justify-between gap-4 border-t border-slate-800 pt-2"><span>Subtotal</span><span>{money(breakdown.subtotal)}</span></div>
          <div className="flex justify-between gap-4"><span>Tax ({breakdown.taxPercent}%)</span><span>{money(breakdown.taxAmount)}</span></div>
          <div className="mt-2 flex justify-between gap-4 border-t-2 border-slate-600 pt-3 text-lg font-extrabold text-emerald-300"><span>Amount received</span><span>{money(receipt.quotedTotal)}</span></div>
        </div>
      </section>

      <div className="mt-7 grid gap-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Payment reference</p><p className="mt-1 font-mono text-slate-200">{receipt.paymentReference}</p></div><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Payment status</p><p className="mt-1 inline-flex items-center gap-2 font-bold text-emerald-300"><HiOutlineReceiptPercent /> Paid · {formatDate(receipt.paidAt)}</p></div></div>
      <p className="mt-7 border-t border-slate-800 pt-5 text-center text-xs leading-5 text-slate-500">This receipt records payment confirmation entered by the StreamWise administrator. Keep it with your campaign records.</p>
    </article>
  </div>;
}
