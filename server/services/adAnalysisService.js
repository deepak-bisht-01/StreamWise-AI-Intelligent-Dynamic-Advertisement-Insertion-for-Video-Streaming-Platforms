/**
 * Background billboard / blank-wall analysis.
 *
 *   const adAnalysis = createAdAnalysisService({ supabase });
 *   adAnalysis.enqueue(videoId);      // call right after a video row is inserted
 *   adAnalysis.recoverPending();      // call once when the server starts
 *
 * Flow: download the stored video (Cloudinary URL) -> run Python detector ->
 * save slots in Supabase -> update videos.analysis_status. One video at a time.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { getPythonRuntime } = require('../utils/pythonRuntime');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PREVIEW_DIR = path.join(__dirname, '..', 'storage', 'ai-previews');
const AD_INPUTS_DIR = path.join(__dirname, '..', 'storage', 'ad-inputs');
const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p));

function resolveVideoAssetDir(root, id) {
  const base = path.resolve(root);
  const target = path.resolve(base, id);
  if (target === base || !target.startsWith(`${base}${path.sep}`)) {
    throw new Error('Invalid video asset directory');
  }
  return target;
}

function createAdAnalysisService({ supabase, logger = console }) {
  const queue = [];
  const queued = new Set();
  let running = false;

  const script = () => resolveFromRoot(process.env.AI_PROCESSOR_SCRIPT || 'server/scripts/colab_ad_insertion.py');
  const workDir = () => resolveFromRoot(process.env.AI_WORK_DIR || 'server/generated/ai');
  const timeoutMs = () => (Number(process.env.AI_TIMEOUT_MIN) || 60) * 60 * 1000;

  async function setStatus(id, fields) {
    const { error } = await supabase.from('videos').update(fields).eq('id', id);
    if (error) {
      logger.error({ message: 'Could not update video analysis status', videoId: id, error: error.message });
      return false;
    }
    return true;
  }

  async function download(url, dest) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  }

  function runDetector(input, output) {
    return new Promise((resolve, reject) => {
      const config = {};
      if (process.env.AI_DEVICE) config.device = process.env.AI_DEVICE;
      const runtime = getPythonRuntime();
      const child = spawn(runtime.command, [...runtime.prefixArgs, script(), '--input', input, '--output', output,
        '--work-dir', workDir(), '--config', JSON.stringify(config)], { windowsHide: true });
      let stdout = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        settled = true;
        reject(new Error('Analysis timed out'));
      }, timeoutMs());
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => {
        const output = String(d).trim();
        if (output) logger.info({ message: 'AI detector output', output });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new Error(`Cannot start Python (${runtime.command}): ${e.message}`));
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const last = stdout.trim().split('\n').filter(Boolean).pop();
        try {
          const result = JSON.parse(last);
          result.success ? resolve(result) : reject(new Error(result.error || 'Detector failed'));
        } catch {
          reject(new Error('Detector produced no valid result'));
        }
      });
    });
  }

  // coordinates.csv: slot_id,frame,time_sec,x1,y1,x2,y2,frame_rank,tracking_quality
  function readTracks(csvPath) {
    const tracks = {};
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);
    for (const line of lines) {
      const [slot, , t, x1, y1, x2, y2] = line.split(',');
      (tracks[slot] ||= []).push([+Number(t).toFixed(3), Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
    }
    return tracks;
  }

  async function analyse(id) {
    const { data: video, error } = await supabase.from('videos')
      .select('id, video_url, analysis_meta').eq('id', id).single();
    if (error || !video) {
      logger.error({ message: 'Video for billboard analysis was not found', videoId: id, error: error?.message });
      return;
    }

    const statusSaved = await setStatus(id, {
      analysis_status: 'processing',
      analysis_error: null,
      analysis_started_at: new Date().toISOString(),
      analysis_meta: { ...(video.analysis_meta || {}), adInputReady: false },
    });
    if (!statusSaved) return; // The analysis migration is required before running the detector.

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamwise-'));
    let runDir;
    try {
      const input = path.join(tmp, 'input.mp4');
      await download(video.video_url, input);
      const result = await runDetector(input, path.join(tmp, 'annotated.mp4'));
      runDir = result.runDir;

      const tracks = readTracks(result.files.coordinatesCsv);
      const { working_width: fw, working_height: fh } = result.metadata;
      const rows = result.slots.map((s) => ({
        video_id: id, slot_number: s.slot_id, rank_order: s.rank_order, kind: s.kind,
        start_sec: s.start_sec, end_sec: s.end_sec, duration_sec: s.duration_sec,
        x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, frame_width: fw, frame_height: fh,
        ranking_score: s.ranking_score, track: tracks[String(s.slot_id)] || [],
      }));

      // The bridge copies phase3_suggestions.mp4 here: selected billboards are
      // outlined only during their recommended time windows.
      const sourcePreview = result.outputVideoPath;
      if (!sourcePreview || !fs.existsSync(sourcePreview)) {
        throw new Error('Detector did not produce a detection preview video.');
      }

      await supabase.from('ad_slots').delete().eq('video_id', id);
      if (rows.length) {
        const { error: insErr } = await supabase.from('ad_slots').insert(rows);
        if (insErr) throw new Error(`Saving slots failed: ${insErr.message}`);
      }
      await fs.promises.mkdir(PREVIEW_DIR, { recursive: true });
      await fs.promises.copyFile(sourcePreview, path.join(PREVIEW_DIR, `${id}.mp4`));
      const previewUrl = `/storage/ai-previews/${id}.mp4`;

      let adInputReady = false;
      const adInputDir = resolveVideoAssetDir(AD_INPUTS_DIR, id);
      if (rows.length > 0) {
        const adFiles = {
          video: path.join(runDir, 'normalized_input.mp4'),
          slots: path.join(runDir, 'slots.json'),
          coords: result.files.coordinatesCsv,
        };
        if (!Object.values(adFiles).every((file) => file && fs.existsSync(file))) {
          throw new Error('Detector outputs required by ad_inserter.py are missing.');
        }
        await fs.promises.mkdir(adInputDir, { recursive: true });
        await Promise.all([
          fs.promises.copyFile(adFiles.video, path.join(adInputDir, 'normalized_input.mp4')),
          fs.promises.copyFile(adFiles.slots, path.join(adInputDir, 'slots.json')),
          fs.promises.copyFile(adFiles.coords, path.join(adInputDir, 'coordinates.csv')),
        ]);
        adInputReady = true;
      } else {
        await fs.promises.rm(adInputDir, { recursive: true, force: true });
      }

      await setStatus(id, {
        analysis_status: rows.length ? 'completed' : 'no_slots',
        analysis_completed_at: new Date().toISOString(),
        analysis_meta: { ...(video.analysis_meta || {}), elapsedSec: result.elapsedSec, device: result.device,
          candidateTracks: result.metadata.detected_candidate_tracks, previewUrl, adInputReady },
      });
      logger.info({ message: 'Billboard analysis completed', videoId: id, slots: rows.length, elapsedSec: result.elapsedSec });
    } catch (err) {
      logger.error({ message: 'Billboard analysis failed', videoId: id, error: err.message });
      await setStatus(id, { analysis_status: 'failed', analysis_error: err.message.slice(0, 500) });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (runDir) fs.rmSync(runDir, { recursive: true, force: true }); // large intermediate files
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const id = queue.shift();
      queued.delete(id);
      try { await analyse(id); } catch (e) {
        logger.error({ message: 'Unexpected billboard analysis error', error: e.message });
      }
    }
    running = false;
  }

  function enqueue(id) {
    if (queued.has(id)) return;
    queued.add(id);
    queue.push(id);
    setImmediate(drain); // never blocks the upload response
  }

  /** Re-queue anything unfinished (new videos, old videos, or a crash mid-run). */
  async function recoverPending() {
    const { data, error } = await supabase.from('videos').select('id')
      .in('analysis_status', ['pending', 'processing']).order('created_at', { ascending: true });
    if (error) {
      logger.error({
        message: 'Could not resume billboard analyses. Apply the ad analysis migration if it has not been run.',
        error: error.message,
      });
      return;
    }
    (data || []).forEach((v) => enqueue(v.id));
    if (data?.length) logger.info({ message: 'Queued pending billboard analyses', count: data.length });
  }

  async function getAnalysis(id) {
    const { data: video, error } = await supabase.from('videos')
      .select('id, analysis_status, analysis_error, analysis_started_at, analysis_completed_at, analysis_meta').eq('id', id).single();
    if (error?.code === 'PGRST116' || (!error && !video)) return null;
    if (error) throw new Error(`Could not load billboard analysis. Apply the ad analysis migration: ${error.message}`);
    const { data: slots, error: slotsError } = await supabase.from('ad_slots')
      .select('id, slot_number, rank_order, kind, start_sec, end_sec, duration_sec, x1, y1, x2, y2, frame_width, frame_height, ranking_score, track')
      .eq('video_id', id).order('start_sec', { ascending: true });
    if (slotsError) throw new Error(`Could not load detected billboard slots: ${slotsError.message}`);
    return { status: video.analysis_status, error: video.analysis_error,
      startedAt: video.analysis_started_at, completedAt: video.analysis_completed_at,
      previewUrl: video.analysis_meta?.previewUrl || null,
      adInputReady: video.analysis_meta?.adInputReady === true,
      adResults: Array.isArray(video.analysis_meta?.adResults) ? video.analysis_meta.adResults : [],
      slots: slots || [] };
  }

  async function retry(id) {
    const updated = await setStatus(id, { analysis_status: 'pending', analysis_error: null });
    if (!updated) return false;
    enqueue(id);
    return true;
  }

  async function deletePreview(id) {
    try {
      await fs.promises.rm(path.join(PREVIEW_DIR, `${id}.mp4`), { force: true });
    } catch (error) {
      logger.warn({ message: 'Could not delete billboard preview video', videoId: id, error: error.message });
    }
  }

  return { enqueue, recoverPending, getAnalysis, retry, deletePreview };
}

module.exports = { createAdAnalysisService };
