const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { supabase } = require('../config/supabase');
const { getPythonRuntime } = require('../utils/pythonRuntime');
const { ApiError } = require('../utils/ApiError');
const logger = require('../utils/logger');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const AD_RESULTS_DIR = path.join(STORAGE_DIR, 'ad-results');
const AD_INPUTS_DIR = path.join(STORAGE_DIR, 'ad-inputs');
const AD_INSERTER = path.join(PROJECT_ROOT, 'server', 'scripts', 'ad_inserter.py');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATIVE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.webm', '.mkv', '.avi']);

function runAdInserter(args) {
  return new Promise((resolve, reject) => {
    const runtime = getPythonRuntime();
    const child = spawn(runtime.command, [...runtime.prefixArgs, AD_INSERTER, ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      settled = true;
      reject(new ApiError(504, 'Ad insertion timed out'));
    }, 60 * 60 * 1000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new ApiError(500, `Could not start ad inserter (${runtime.command})`, error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      try {
        const result = JSON.parse(lastLine || '{}');
        if (code !== 0 || !result.success) {
          reject(new ApiError(500, result.error || 'Could not create the ad video', stderr.trim() || null));
          return;
        }
        resolve(result);
      } catch (error) {
        reject(new ApiError(500, 'Ad inserter returned an invalid response', stderr.trim() || error.message));
      }
    });
  });
}

async function insertAd({ videoId, slotId, creative }) {
  if (!UUID_REGEX.test(videoId) || !UUID_REGEX.test(slotId)) {
    throw new ApiError(400, 'Video id and slot id must be valid UUIDs');
  }
  if (!creative?.buffer?.length) throw new ApiError(400, 'Choose an ad image or video');
  const extension = path.extname(creative.originalname || '').toLowerCase();
  if (!CREATIVE_EXTENSIONS.has(extension)) {
    throw new ApiError(400, 'Ad creative must be JPG, PNG, MP4, MOV, WebM, MKV, or AVI');
  }
  if (!fs.existsSync(AD_INSERTER)) throw new ApiError(500, 'server/scripts/ad_inserter.py was not found');

  const [{ data: video, error: videoError }, { data: slot, error: slotError }] = await Promise.all([
    supabase.from('videos').select('id, analysis_status, analysis_meta').eq('id', videoId).single(),
    supabase.from('ad_slots')
      .select('id, slot_number, kind, start_sec, end_sec, frame_width, frame_height, track')
      .eq('video_id', videoId).eq('id', slotId).single(),
  ]);
  if (videoError || !video) throw new ApiError(404, 'Video not found');
  if (slotError || !slot) throw new ApiError(404, 'Detected billboard slot not found');
  if (video.analysis_status !== 'completed') {
    throw new ApiError(409, 'Wait for billboard analysis to finish before adding an ad');
  }

  const inputDir = path.join(AD_INPUTS_DIR, videoId);
  const sourceVideo = path.join(inputDir, 'normalized_input.mp4');
  const slotsJson = path.join(inputDir, 'slots.json');
  const coordinatesCsv = path.join(inputDir, 'coordinates.csv');
  if (!video.analysis_meta?.adInputReady || ![sourceVideo, slotsJson, coordinatesCsv].every((file) => fs.existsSync(file))) {
    throw new ApiError(409, 'Prepare this video for ad insertion by rerunning billboard analysis');
  }
  if (!Array.isArray(slot.track) || slot.track.length === 0) {
    throw new ApiError(409, 'This slot has no tracked rectangle data; re-run billboard analysis');
  }

  const runId = crypto.randomUUID();
  const outputDir = path.join(AD_RESULTS_DIR, videoId);
  const outputPath = path.join(outputDir, `${runId}.mp4`);
  const outputUrl = `/storage/ad-results/${videoId}/${runId}.mp4`;
  const temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'streamwise-ad-'));
  const imagePath = path.join(temporaryDir, `creative${extension}`);

  try {
    await fs.promises.writeFile(imagePath, creative.buffer);
    await fs.promises.mkdir(outputDir, { recursive: true });
    await runAdInserter([
      '--video', sourceVideo,
      '--slots', slotsJson,
      '--coords', coordinatesCsv,
      '--ad', imagePath,
      '--output', outputPath,
      '--slot-ids', String(slot.slot_number),
    ]);

    const record = {
      id: runId,
      slotId: slot.id,
      slotNumber: slot.slot_number,
      creativeName: path.basename(creative.originalname || 'ad-image').slice(0, 120),
      creativeType: ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(extension) ? 'video' : 'image',
      outputUrl,
      createdAt: new Date().toISOString(),
    };
    const { data: latest, error: latestError } = await supabase.from('videos')
      .select('analysis_meta').eq('id', videoId).single();
    if (latestError || !latest) throw new ApiError(502, 'Could not save the ad result');

    const previousAds = Array.isArray(latest.analysis_meta?.adResults) ? latest.analysis_meta.adResults : [];
    const { error: updateError } = await supabase.from('videos').update({
      analysis_meta: { ...(latest.analysis_meta || {}), adResults: [...previousAds, record] },
    }).eq('id', videoId);
    if (updateError) throw new ApiError(502, 'Could not save the ad result', updateError.message);

    return record;
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.promises.rm(temporaryDir, { recursive: true, force: true }).catch((error) => {
      logger.warn({ message: 'Could not clean temporary ad files', error: error.message });
    });
  }
}

async function deleteAdResults(videoId) {
  if (!UUID_REGEX.test(videoId)) return;
  for (const rootPath of [AD_RESULTS_DIR, AD_INPUTS_DIR]) {
    const root = path.resolve(rootPath);
    const target = path.resolve(root, videoId);
    if (!target.startsWith(`${root}${path.sep}`)) continue;
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
    } catch (error) {
      logger.warn({ message: 'Could not delete saved ad assets', videoId, error: error.message });
    }
  }
}

async function deleteAdResult({ videoId, adId }) {
  if (!UUID_REGEX.test(videoId) || !UUID_REGEX.test(adId)) {
    throw new ApiError(400, 'Video id and ad result id must be valid UUIDs');
  }

  const { data: video, error: videoError } = await supabase.from('videos')
    .select('id, analysis_meta').eq('id', videoId).single();
  if (videoError || !video) throw new ApiError(404, 'Video not found');

  const metadata = video.analysis_meta || {};
  const adResults = Array.isArray(metadata.adResults) ? metadata.adResults : [];
  const result = adResults.find((ad) => ad.id === adId);
  if (!result) throw new ApiError(404, 'Ad result not found');

  const { error: updateError } = await supabase.from('videos').update({
    analysis_meta: { ...metadata, adResults: adResults.filter((ad) => ad.id !== adId) },
  }).eq('id', videoId);
  if (updateError) throw new ApiError(502, 'Could not remove the ad result', updateError.message);

  const root = path.resolve(AD_RESULTS_DIR);
  const resultPath = path.resolve(root, videoId, `${adId}.mp4`);
  if (!resultPath.startsWith(`${root}${path.sep}`)) {
    throw new ApiError(400, 'Invalid ad result path');
  }
  try {
    await fs.promises.rm(resultPath, { force: true });
  } catch (error) {
    logger.warn({ message: 'Ad result was removed from analysis but its file could not be deleted', videoId, adId, error: error.message });
  }

  return { id: adId, deleted: true };
}

module.exports = { insertAd, deleteAdResult, deleteAdResults };
