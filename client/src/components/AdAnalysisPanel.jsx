import { useEffect, useRef, useState } from 'react';
import './AdAnalysisPanel.css';

const API = import.meta.env.VITE_API_BASE_URL || '/api';

const LABELS = {
  pending: 'Queued for analysis',
  processing: 'Analysing billboards…',
  completed: 'Analysis complete',
  no_slots: 'No suitable billboard found',
  failed: 'Analysis failed',
};
const COLORS = { pending: '#a16207', processing: '#1d4ed8', completed: '#15803d', no_slots: '#475569', failed: '#b91c1c' };

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

async function readApiResponse(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`Analysis API returned a non-JSON response (${response.status}). Check that the API server is running.`);
  }
}

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
  const [isAddingAd, setIsAddingAd] = useState(false);
  const [adError, setAdError] = useState('');
  const [adDeleteError, setAdDeleteError] = useState('');
  const [deletingAdId, setDeletingAdId] = useState('');
  const creativeInputRef = useRef(null);
  const [isCreativeDropActive, setIsCreativeDropActive] = useState(false);

  const uploadInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    async function load() {
      try {
        const res = await fetch(`${API}/videos/${videoId}/analysis`);
        const json = await readApiResponse(res);
        if (!res.ok || !json?.success) throw new Error(json?.message || `Analysis request failed (${res.status})`);
        if (cancelled) return;
        setAnalysis(json.data);
        setError('');
        if (['pending', 'processing'].includes(json.data.status)) timer = setTimeout(load, 4000);
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          timer = setTimeout(load, 8000);
        }
      }
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [videoId, attempt]);

  async function retry() {
    try {
      const response = await fetch(`${API}/videos/${videoId}/analyze`, { method: 'POST' });
      const json = await readApiResponse(response);
      if (!response.ok || !json?.success) throw new Error(json?.message || `Could not retry analysis (${response.status})`);
      setError('');
      setAttempt((n) => n + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  async function addAd(event) {
    event.preventDefault();
    if (!creative || !analysis?.slots?.length || uploadInFlight.current) return;

    const slotId = selectedSlotId || analysis.slots[0].id;
    const formData = new FormData();
    formData.append('slotId', slotId);
    formData.append('creative', creative);
    uploadInFlight.current = true;
    setIsAddingAd(true);
    setAdError('');

    try {
      const response = await fetch(`${API}/videos/${videoId}/ads`, { method: 'POST', body: formData });
      const json = await readApiResponse(response);
      if (!response.ok || !json?.success) throw new Error(json?.message || `Ad insertion failed (${response.status})`);
      setCreative(null);
      if (creativeInputRef.current) creativeInputRef.current.value = '';
      setAttempt((n) => n + 1);
    } catch (e) {
      setAdError(e.message);
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
      const response = await fetch(`${API}/videos/${videoId}/ads/${ad.id}`, { method: 'DELETE' });
      const json = await readApiResponse(response);
      if (!response.ok || !json?.success) throw new Error(json?.message || `Could not delete ad video (${response.status})`);
      setAnalysis((current) => current ? {
        ...current,
        adResults: (current.adResults || []).filter((result) => result.id !== ad.id),
      } : current);
    } catch (e) {
      setAdDeleteError(e.message);
    } finally {
      setDeletingAdId('');
    }
  }

  if (error) {
    return (
      <p style={{ color: '#b91c1c' }}>
        Could not load analysis: {error} (retrying automatically) {' '}
        <button onClick={() => { setError(''); setAttempt((n) => n + 1); }} style={{ fontWeight: 600 }}>
          Retry now
        </button>
      </p>
    );
  }
  if (!analysis) return <p>Loading analysis…</p>;

  const apiOrigin = new URL(API, window.location.origin).origin;
  const previewSrc = analysis.previewUrl ? new URL(analysis.previewUrl, apiOrigin).toString() : null;

  return (
    <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Billboard detection</h3>
        <AnalysisBadge status={analysis.status} />
      </header>

      {previewSrc && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>Result video with detected billboard boxes</h4>
          <p style={{ margin: '0 0 10px', color: '#64748b', fontSize: 13 }}>
            The selected billboard areas are outlined during their recommended time windows.
          </p>
          <video
            key={previewSrc}
            src={previewSrc}
            controls
            preload="metadata"
            style={{ width: '100%', aspectRatio: '16 / 9', background: '#020617', borderRadius: 8 }}
          >
            Your browser does not support the HTML5 video player.
          </video>
        </div>
      )}

      {analysis.status === 'failed' && (
        <p style={{ color: '#b91c1c' }}>
          {analysis.error} <button onClick={retry} style={{ marginLeft: 8 }}>Retry</button>
        </p>
      )}

      {!previewSrc && ['completed', 'no_slots'].includes(analysis.status) && (
        <p style={{ margin: '12px 0 0' }}>
          The result video has not been generated for this analysis yet.{' '}
          <button onClick={retry} style={{ color: '#047857', fontWeight: 600 }}>Generate detection video</button>
        </p>
      )}

      {analysis.status === 'completed' && analysis.slots.length > 0 && !analysis.adInputReady && (
        <p style={{ margin: '12px 0 0' }}>
          Prepare the detector files before inserting an ad.{' '}
          <button onClick={retry} style={{ color: '#047857', fontWeight: 600 }}>Prepare for ad insertion</button>
        </p>
      )}

      {analysis.status === 'completed' && analysis.adInputReady && analysis.slots.length > 0 && (
        <form onSubmit={addAd} className="ad-upload-form">
          <div className="ad-upload-heading">
            <span className="ad-upload-eyebrow">Ad placement</span>
            <h4>Add a creative to your billboard</h4>
            <p>Choose a detected slot, then upload the image or video you want placed in it.</p>
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

          <div className="ad-creative-field">
            <span className="ad-field-label"><span className="ad-step-number">2</span> Ad creative</span>
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
                accept="image/jpeg,image/png,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.jpg,.jpeg,.png,.mp4,.mov,.webm,.mkv,.avi"
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
            <p className="ad-upload-hint">JPG, PNG, MP4, MOV, WebM, MKV, or AVI <span>Up to 100 MB</span></p>
          </div>

          {adError && <p className="ad-upload-error" role="alert">{adError}</p>}

          <div className="ad-upload-actions">
            <p>Your original video stays unchanged. The ad is rendered into a new video.</p>
            <button type="submit" className="ad-submit-button" disabled={!creative || isAddingAd}>
              {isAddingAd && <span className="ad-submit-spinner" aria-hidden="true" />}
              {isAddingAd ? 'Rendering ad video...' : 'Create video with ad'}
            </button>
          </div>
        </form>
      )}

      {analysis.adResults?.length > 0 && (
        <div className="ad-results-section">
          <h4>Videos with inserted ads</h4>
          {adDeleteError && <p className="ad-upload-error" role="alert">{adDeleteError}</p>}
          {analysis.adResults.map((ad) => (
            <article className="ad-result-card" key={ad.id}>
              <div className="ad-result-heading">
                <p>Slot {ad.slotNumber} - {ad.creativeName}</p>
                <button
                  type="button"
                  className="ad-result-delete"
                  onClick={() => removeAdResult(ad)}
                  disabled={Boolean(deletingAdId)}
                  aria-label={`Delete ad video for slot ${ad.slotNumber}`}
                >
                  {deletingAdId === ad.id ? 'Deleting...' : 'Delete video'}
                </button>
              </div>
              <video
                key={ad.outputUrl}
                src={new URL(ad.outputUrl, apiOrigin).toString()}
                controls
                preload="metadata"
                className="ad-result-video"
              >
                Your browser does not support the HTML5 video player.
              </video>
            </article>
          ))}
        </div>
      )}
      {analysis.slots.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {analysis.slots.map((s) => (
            <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
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
