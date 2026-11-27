import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../services/api.js';
import IndiaLocationFields from './IndiaLocationFields.jsx';
import './AdAnalysisPanel.css';

const LABELS = {
  pending: 'Queued for analysis',
  processing: 'Analysing billboards…',
  completed: 'Analysis complete',
  no_slots: 'No suitable billboard found',
  failed: 'Analysis failed',
};
const COLORS = { pending: '#fbbf24', processing: '#93c5fd', completed: '#6ee7b7', no_slots: '#cbd5e1', failed: '#fda4af' };

export function AnalysisBadge({ status }) {
  if (!status) return null;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      color: COLORS[status], background: `${COLORS[status]}1a` }}>
      {LABELS[status] || status}
    </span>
  );
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Props: videoId, onSeek(seconds) -> jump the <video> player to a slot.
 * Polls every 4 s while the server is still working.
 */
export default function AdAnalysisPanel({ videoId, onSeek }) {
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); // bump to restart polling
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [creative, setCreative] = useState(null);
  const [targeting, setTargeting] = useState({ country: 'India', state: '', district: '', city: '', latitude: '', longitude: '', radiusKm: '50', priority: '0' });
  const [campaigns, setCampaigns] = useState([]);
  const [campaignLoadError, setCampaignLoadError] = useState('');
  const [adSource, setAdSource] = useState('upload');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isAddingAd, setIsAddingAd] = useState(false);
  const [adError, setAdError] = useState('');
  const [adDeleteError, setAdDeleteError] = useState('');
  const [adApprovalError, setAdApprovalError] = useState('');
  const [deletingAdId, setDeletingAdId] = useState('');
  const [updatingApprovalId, setUpdatingApprovalId] = useState('');
  const creativeInputRef = useRef(null);
  const [isCreativeDropActive, setIsCreativeDropActive] = useState(false);

  const uploadInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    async function load() {
      try {
        const response = await api.get(`/videos/${videoId}/analysis`);
        const json = response.data;
        if (!json?.success) throw new Error(json?.message || 'Could not load billboard analysis');
        if (cancelled) return;
        setAnalysis(json.data);
        setError('');
        if (json.data.adReviewEnabled && ['pending', 'processing'].includes(json.data.status)) timer = setTimeout(load, 4000);
      } catch (e) {
        if (!cancelled) {
          setError(getErrorMessage(e));
          timer = setTimeout(load, 8000);
        }
      }
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [videoId, attempt]);

  useEffect(() => {
    let cancelled = false;
    api.get('/brands/ads').then((response) => {
      if (!cancelled) setCampaigns((response.data.data || []).filter((campaign) => campaign.active));
    }).catch((loadError) => {
      if (!cancelled) setCampaignLoadError(getErrorMessage(loadError));
    });
    return () => { cancelled = true; };
  }, []);

  async function retry() {
    try {
      const response = await api.post(`/videos/${videoId}/analyze`);
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not retry analysis');
      setError('');
      setAttempt((n) => n + 1);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function addAd(event) {
    event.preventDefault();
    if (!analysis?.slots?.length || uploadInFlight.current) return;
    if (adSource === 'campaign' && !selectedCampaignId) return;
    if (adSource === 'upload' && !creative) return;

    const slotId = selectedSlotId || analysis.slots[0].id;
    const formData = new FormData();
    formData.append('slotId', slotId);
    if (adSource === 'campaign') {
      formData.append('campaignId', selectedCampaignId);
    } else {
      formData.append('creative', creative);
      Object.entries(targeting).forEach(([key, value]) => formData.append(key, value));
    }
    uploadInFlight.current = true;
    setIsAddingAd(true);
    setAdError('');

    try {
      const response = await api.post(`/videos/${videoId}/ads`, formData);
      if (!response.data?.success) throw new Error(response.data?.message || 'Ad insertion failed');
      setCreative(null);
      setSelectedCampaignId('');
      if (creativeInputRef.current) creativeInputRef.current.value = '';
      setAttempt((n) => n + 1);
    } catch (e) {
      setAdError(getErrorMessage(e));
    } finally {
      uploadInFlight.current = false;
      setIsAddingAd(false);
    }
  }

  async function removeAdResult(ad) {
    if (deletingAdId || !window.confirm('Delete this generated ad video? This cannot be undone.')) return;

    setDeletingAdId(ad.id);
    setAdDeleteError('');
    try {
      await api.delete(`/videos/${videoId}/ads/${ad.id}`);
      setAnalysis((current) => current ? {
        ...current,
        adResults: (current.adResults || []).filter((result) => result.id !== ad.id),
      } : current);
    } catch (e) {
      setAdDeleteError(getErrorMessage(e));
    } finally {
      setDeletingAdId('');
    }
  }

  async function toggleApproval(ad) {
    setUpdatingApprovalId(ad.id);
    setAdApprovalError('');
    try {
      const response = await api.post(`/videos/${videoId}/ads/${ad.id}/approval`, { approved: !ad.approved });
      const updated = response.data.data;
      setAnalysis((current) => current ? {
        ...current,
        adResults: (current.adResults || []).map((item) => item.id === ad.id ? updated : item),
      } : current);
    } catch (e) {
      setAdApprovalError(getErrorMessage(e));
    } finally {
      setUpdatingApprovalId('');
    }
  }

  if (error) {
    return (
      <p style={{ color: '#fda4af' }}>
        Could not load analysis: {error} (retrying automatically) {' '}
        <button onClick={() => { setError(''); setAttempt((n) => n + 1); }} style={{ fontWeight: 600 }}>
          Retry now
        </button>
      </p>
    );
  }
  if (!analysis) return <p>Loading analysis…</p>;

  const hasPreview = Boolean(analysis.previewUrl);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId);

  if (!analysis.adReviewEnabled) {
    return (
      <section style={{ border: '1px solid #273449', borderRadius: 16, padding: 20, background: '#111827', color: '#e2e8f0' }}>
        <h3 style={{ margin: 0, color: '#f1f5f9' }}>Waiting for admin selection</h3>
        <p style={{ margin: '8px 0 0', color: '#9aa8bd', lineHeight: 1.6 }}>This creator submission has not been selected for ad review yet. Select it from the admin dashboard to start billboard analysis and add location-targeted ads.</p>
      </section>
    );
  }

  return (
    <section style={{ border: '1px solid #273449', borderRadius: 16, padding: 20, background: '#111827', color: '#e2e8f0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Billboard detection</h3>
        <AnalysisBadge status={analysis.status} />
      </header>

      {hasPreview && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>Result video with detected billboard boxes</h4>
          <p style={{ margin: '0 0 10px', color: '#9aa8bd', fontSize: 13 }}>
            The selected billboard areas are outlined during their recommended time windows.
          </p>
          <video className="w-full rounded-lg bg-slate-950" style={{ aspectRatio: '16 / 9' }} src={analysis.previewUrl} controls preload="metadata">
            Your browser does not support the HTML5 video player.
          </video>
        </div>
      )}

      {analysis.status === 'failed' && (
        <p style={{ color: '#fda4af' }}>
          {analysis.error} <button onClick={retry} style={{ marginLeft: 8 }}>Retry</button>
        </p>
      )}

      {!hasPreview && ['completed', 'no_slots'].includes(analysis.status) && (
        <p style={{ margin: '12px 0 0' }}>
          The result video has not been generated for this analysis yet.{' '}
          <button onClick={retry} style={{ color: '#6ee7b7', fontWeight: 600 }}>Generate detection video</button>
        </p>
      )}

      {analysis.status === 'completed' && analysis.slots.length > 0 && !analysis.adInputReady && (
        <p style={{ margin: '12px 0 0' }}>
          Prepare the detector files before inserting an ad.{' '}
          <button onClick={retry} style={{ color: '#6ee7b7', fontWeight: 600 }}>Prepare for ad insertion</button>
        </p>
      )}

      {analysis.status === 'completed' && analysis.adInputReady && analysis.slots.length > 0 && (
        <form onSubmit={addAd} className="ad-upload-form">
          <div className="ad-upload-heading">
            <span className="ad-upload-eyebrow">Ad placement</span>
            <h4>Place a brand campaign in this video</h4>
            <p>Reuse a saved regional campaign or upload a one-off creative. Rendered videos stay hidden until an admin approves them.</p>
          </div>

          <label className="ad-slot-field">
            <span className="ad-field-label"><span className="ad-step-number">1</span> Billboard slot</span>
            <select
              value={selectedSlotId || analysis.slots[0].id}
              onChange={(event) => setSelectedSlotId(event.target.value)}
              className="ad-slot-select"
            >
              {analysis.slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  Slot {slot.slot_number} - {fmt(slot.start_sec)} to {fmt(slot.end_sec)}
                </option>
              ))}
            </select>
          </label>

          <label className="ad-source-field">
            <span className="ad-field-label"><span className="ad-step-number">2</span> Creative source</span>
            <select className="ad-slot-select" value={adSource} onChange={(event) => setAdSource(event.target.value)}>
              <option value="upload">Upload a one-off creative</option>
              <option value="campaign">Choose from Brand inventory ({campaigns.length})</option>
            </select>
            {campaignLoadError && <small className="ad-targeting-help">Could not load campaign inventory: {campaignLoadError}</small>}
          </label>

          {adSource === 'campaign' ? (
            <div className="ad-targeting-section">
              <div>
                <span className="ad-field-label"><span className="ad-step-number">3</span> Saved brand campaign</span>
                <p className="ad-targeting-help">The campaign creative and saved location targeting are reused automatically.</p>
              </div>
              <div className="ad-campaign-choice">
                <select className="ad-slot-select" value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)} disabled={campaigns.length === 0}>
                  <option value="">{campaigns.length ? 'Choose a campaign' : 'No active campaigns in Brand inventory'}</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {[campaign.brands?.name, campaign.name, campaign.district, campaign.state, campaign.country].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
                {selectedCampaign && <div className="ad-campaign-summary">
                  <strong>{selectedCampaign.brands?.name || 'Brand'} — {selectedCampaign.name}</strong>
                  <span>Target: {[selectedCampaign.city, selectedCampaign.district, selectedCampaign.state, selectedCampaign.country].filter(Boolean).join(', ') || 'all locations'}{selectedCampaign.latitude != null ? ` · ${selectedCampaign.radius_km} km radius` : ''} · Priority {selectedCampaign.priority}</span>
                </div>}
                {!campaigns.length && <a href="/brands" className="ad-campaign-link">Create a campaign in Brand inventory</a>}
              </div>
            </div>
          ) : (
            <>
              <div className="ad-targeting-section">
                <div>
                  <span className="ad-field-label"><span className="ad-step-number">3</span> Viewer location</span>
                  <p className="ad-targeting-help">Set a country-wide, state, district, city, or GPS-radius target.</p>
                </div>
                <div className="ad-targeting-grid">
                  <label>Country
                    <input required maxLength={100} value={targeting.country} onChange={(event) => setTargeting({ ...targeting, country: event.target.value, state: '', district: '', city: '' })} />
                  </label>
                  <IndiaLocationFields
                    country={targeting.country}
                    state={targeting.state}
                    district={targeting.district}
                    onChange={(location) => setTargeting({ ...targeting, ...location })}
                  />
                  <label>City / locality (optional)
                    <input maxLength={100} value={targeting.city} onChange={(event) => setTargeting({ ...targeting, city: event.target.value })} placeholder="Any city" />
                  </label>
                  <label>Center latitude
                    <input type="number" step="any" min="-90" max="90" value={targeting.latitude} onChange={(event) => setTargeting({ ...targeting, latitude: event.target.value })} placeholder="Optional" />
                  </label>
                  <label>Center longitude
                    <input type="number" step="any" min="-180" max="180" value={targeting.longitude} onChange={(event) => setTargeting({ ...targeting, longitude: event.target.value })} placeholder="Optional" />
                  </label>
                  <label>Radius (km)
                    <input type="number" min="1" max="5000" value={targeting.radiusKm} onChange={(event) => setTargeting({ ...targeting, radiusKm: event.target.value })} />
                  </label>
                  <label>Priority
                    <input type="number" min="0" max="1000" value={targeting.priority} onChange={(event) => setTargeting({ ...targeting, priority: event.target.value })} />
                  </label>
                </div>
              </div>

              <div className="ad-creative-field">
            <span className="ad-field-label"><span className="ad-step-number">4</span> Ad creative</span>
            <label
              className={`ad-dropzone${creative ? ' has-file' : ''}${isCreativeDropActive ? ' is-dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setIsCreativeDropActive(true); }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsCreativeDropActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsCreativeDropActive(false);
                setCreative(event.dataTransfer.files?.[0] || null);
              }}
            >
              <input
                ref={creativeInputRef}
                className="ad-creative-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.mkv,.avi"
                onChange={(event) => setCreative(event.target.files?.[0] || null)}
                aria-label="Choose an ad image or video"
              />
              <span className="ad-upload-icon" aria-hidden="true">
                {creative ? (
                  <svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </span>
              <span className="ad-dropzone-copy">
                <strong>{creative ? creative.name : 'Drop your creative here'}</strong>
                <span>{creative ? `${(creative.size / (1024 * 1024)).toFixed(1)} MB - click to replace` : 'or click to browse files'}</span>
              </span>
              <span className="ad-browse-button">Browse files</span>
            </label>
            <p className="ad-upload-hint">JPG, PNG, WebP, MP4, MOV, WebM, MKV, or AVI <span>Up to 100 MB</span></p>
              </div>
            </>
          )}

          {adError && <p className="ad-upload-error" role="alert">{adError}</p>}
          {adApprovalError && <p className="ad-upload-error" role="alert">{adApprovalError}</p>}

          <div className="ad-upload-actions">
            <p>Your original video stays unchanged. The ad is rendered into a new video.</p>
            <button type="submit" className="ad-submit-button" disabled={isAddingAd || (adSource === 'upload' ? !creative : !selectedCampaignId)}>
              {isAddingAd && <span className="ad-submit-spinner" aria-hidden="true" />}
              {isAddingAd ? 'Rendering ad video...' : 'Render campaign into video'}
            </button>
          </div>
        </form>
      )}

      {analysis.adResults?.length > 0 && (
        <div className="ad-results-section">
          <h4>Videos with inserted ads</h4>
          {adDeleteError && <p className="ad-upload-error" role="alert">{adDeleteError}</p>}
          {adApprovalError && <p className="ad-upload-error" role="alert">{adApprovalError}</p>}
          {analysis.adResults.map((ad) => (
            <article className="ad-result-card" key={ad.id}>
              <div className="ad-result-heading">
                <div>
                  <p>Slot {ad.slotNumber} - {ad.creativeName}</p>
                  <small>{ad.brandName ? `${ad.brandName} · ` : ''}{[ad.city, ad.district, ad.state, ad.country].filter(Boolean).join(', ')}{ad.latitude != null ? ` · ${ad.radiusKm} km radius` : ''}</small>
                </div>
                <div className="ad-result-actions">
                  <span className={`ad-approval-badge${ad.approved ? ' is-approved' : ''}`}>{ad.approved ? 'Approved' : 'Pending review'}</span>
                  <button type="button" className="ad-approve-button" onClick={() => toggleApproval(ad)} disabled={Boolean(updatingApprovalId)}>
                    {updatingApprovalId === ad.id ? 'Saving...' : ad.approved ? 'Remove approval' : 'Approve for viewers'}
                  </button>
                  <button type="button" className="ad-result-delete" onClick={() => removeAdResult(ad)} disabled={Boolean(deletingAdId)} aria-label={`Delete ad video for slot ${ad.slotNumber}`}>
                    {deletingAdId === ad.id ? 'Deleting...' : 'Delete video'}
                  </button>
                </div>
              </div>
              <video className="ad-result-video" src={ad.outputUrl} controls preload="metadata">
                Your browser does not support the HTML5 video player.
              </video>
            </article>
          ))}
        </div>
      )}
      {analysis.slots.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {analysis.slots.map((s) => (
            <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #273449', color: '#cbd5e1' }}>
              <span>
                Slot {s.slot_number} · {s.kind === 'existing_board' ? 'Empty billboard' : 'Blank wall'}
                {' '}· {fmt(s.start_sec)}–{fmt(s.end_sec)} ({s.duration_sec.toFixed(1)}s)
              </span>
              {onSeek && <button onClick={() => onSeek(s.start_sec)}>Jump to</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
