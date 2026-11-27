const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { adminSupabase } = require('../config/supabase');
const { getPythonRuntime } = require('../utils/pythonRuntime');
const { ApiError } = require('../utils/ApiError');
const { env } = require('../config/env');
const logger = require('../utils/logger');
const { uploadRenderedAd, deleteRenderedAdAsset } = require('./cloudinaryService');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const AD_RESULTS_DIR = path.join(STORAGE_DIR, 'ad-results');
const AD_INPUTS_DIR = path.join(STORAGE_DIR, 'ad-inputs');
const PERSONALIZED_ADS_DIR = path.join(STORAGE_DIR, 'personalized-ads');
const AD_INSERTER = path.join(PROJECT_ROOT, 'server', 'scripts', 'ad_inserter.py');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATIVE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm', '.mkv', '.avi']);
const MAX_CREATIVE_BYTES = 100 * 1024 * 1024;

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
          const diagnostics = {
            exitCode: code,
            pythonError: result.error || null,
            stderr: stderr.trim().slice(-8000),
            stdoutTail: stdout.trim().slice(-2000),
          };
          logger.error({ message: 'Ad inserter process failed', ...diagnostics });
          reject(new ApiError(500, result.error || `Ad inserter exited with code ${code ?? 'unknown'}`, diagnostics));
          return;
        }
        resolve(result);
      } catch (error) {
        const diagnostics = {
          exitCode: code,
          parseError: error.message,
          stderr: stderr.trim().slice(-8000),
          stdoutTail: stdout.trim().slice(-2000),
        };
        logger.error({ message: 'Ad inserter returned invalid JSON', ...diagnostics });
        reject(new ApiError(500, 'Ad inserter returned an invalid response', diagnostics));
      }
    });
  });
}

function parseTargeting(targeting = {}) {
  const country = String(targeting.country || '').trim();
  const state = String(targeting.state || '').trim();
  const district = String(targeting.district || '').trim();
  const city = String(targeting.city || '').trim();
  const latitude = targeting.latitude === '' || targeting.latitude === undefined || targeting.latitude === null ? null : Number(targeting.latitude);
  const longitude = targeting.longitude === '' || targeting.longitude === undefined || targeting.longitude === null ? null : Number(targeting.longitude);
  const radiusKm = Number(targeting.radiusKm || 50);
  const priority = Number(targeting.priority || 0);
  if (!country || country.length > 100 || state.length > 100 || district.length > 100 || city.length > 100) {
    throw new ApiError(400, 'Enter a country and keep region names under 100 characters');
  }
  if ((latitude === null) !== (longitude === null)) throw new ApiError(400, 'Enter both GPS coordinates or leave both blank');
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new ApiError(400, 'Latitude must be between -90 and 90');
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new ApiError(400, 'Longitude must be between -180 and 180');
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 5000) throw new ApiError(400, 'Target radius must be between 1 and 5000 km');
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) throw new ApiError(400, 'Priority must be between 0 and 1000');
  return { country, state: state || null, district: district || null, city: city || null, latitude, longitude, radiusKm, priority };
}

function storagePathFromCampaignUrl(creativeUrl) {
  let url;
  try { url = new URL(creativeUrl); } catch { throw new ApiError(400, 'Brand campaign creative URL is invalid'); }
  const projectUrl = new URL(env.supabase.url);
  const prefix = '/storage/v1/object/public/brand-creatives/';
  if (url.origin !== projectUrl.origin || !url.pathname.startsWith(prefix)) {
    throw new ApiError(400, 'Brand campaign creative must be stored in this project’s brand-creatives bucket');
  }
  let storagePath;
  try { storagePath = decodeURIComponent(url.pathname.slice(prefix.length)); }
  catch { throw new ApiError(400, 'Brand campaign creative path is invalid'); }
  if (!storagePath || storagePath.split('/').some((part) => part === '..' || part === '.')) {
    throw new ApiError(400, 'Brand campaign creative path is invalid');
  }
  return storagePath;
}

async function getCampaignCreative(campaignId) {
  if (!UUID_REGEX.test(campaignId)) throw new ApiError(400, 'Choose a valid brand campaign');
  const { data: campaign, error } = await adminSupabase.from('brand_ads')
    .select('id, name, creative_url, storage_path, creative_type, country, state, district, city, latitude, longitude, radius_km, priority, active, brands(name, category)')
    .eq('id', campaignId).eq('active', true).single();
  if (['PGRST204', '42703'].includes(error?.code)) {
    throw new ApiError(503, 'Apply server/database/location_district_migration.sql in the Supabase SQL Editor, then retry.');
  }
  if (error || !campaign) throw new ApiError(404, 'Active brand campaign not found');

  const storagePath = campaign.storage_path || storagePathFromCampaignUrl(campaign.creative_url);
  const extension = path.extname(storagePath || new URL(campaign.creative_url).pathname).toLowerCase();
  if (!CREATIVE_EXTENSIONS.has(extension)) throw new ApiError(400, 'The brand campaign has an unsupported creative file type');
  const { data, error: downloadError } = await adminSupabase.storage.from('brand-creatives').download(storagePath);
  if (downloadError || !data) throw new ApiError(502, 'Could not download the selected brand creative', downloadError?.message);
  if (data.size > MAX_CREATIVE_BYTES) throw new ApiError(413, 'The selected brand creative exceeds the 100 MB insertion limit');
  const buffer = Buffer.from(await data.arrayBuffer());
  if (!buffer.length) throw new ApiError(400, 'The selected brand creative is empty');

  return {
    campaign,
    creative: {
      buffer,
      originalname: `${campaign.brands?.name || 'brand'}-${campaign.name || 'campaign'}${extension}`,
      mimetype: data.type || 'application/octet-stream',
    },
  };
}

async function insertAd({ videoId, slotId, creative, campaignId, targeting, createdBy, brandNameOverride = null, advertiserRequestId = null }) {
  if (!UUID_REGEX.test(videoId) || !UUID_REGEX.test(slotId)) {
    throw new ApiError(400, 'Video id and slot id must be valid UUIDs');
  }
  let selectedCampaign = null;
  if (campaignId) {
    const resolved = await getCampaignCreative(campaignId);
    selectedCampaign = resolved.campaign;
    creative = resolved.creative;
    targeting = {
      country: selectedCampaign.country,
      state: selectedCampaign.state,
      district: selectedCampaign.district,
      city: selectedCampaign.city,
      latitude: selectedCampaign.latitude,
      longitude: selectedCampaign.longitude,
      radiusKm: selectedCampaign.radius_km,
      priority: selectedCampaign.priority,
    };
  }
  if (!creative?.buffer?.length) throw new ApiError(400, 'Choose a brand campaign or upload an ad creative');
  if (creative.buffer.length > MAX_CREATIVE_BYTES) throw new ApiError(413, 'Ad creative exceeds the 100 MB insertion limit');
  const extension = path.extname(creative.originalname || '').toLowerCase();
  if (!CREATIVE_EXTENSIONS.has(extension)) {
    throw new ApiError(400, 'Ad creative must be JPG, PNG, MP4, MOV, WebM, MKV, or AVI');
  }
  if (!fs.existsSync(AD_INSERTER)) throw new ApiError(500, 'server/scripts/ad_inserter.py was not found');
  const location = parseTargeting(targeting);

  const [{ data: video, error: videoError }, { data: slot, error: slotError }] = await Promise.all([
    adminSupabase.from('videos').select('id, analysis_status, analysis_meta, ad_review_enabled').eq('id', videoId).single(),
    adminSupabase.from('ad_slots')
      .select('id, slot_number, kind, start_sec, end_sec, frame_width, frame_height, track')
      .eq('video_id', videoId).eq('id', slotId).single(),
  ]);
  if (videoError || !video) throw new ApiError(404, 'Video not found');
  if (video.ad_review_enabled !== true) throw new ApiError(403, 'Select this video for admin ad review before adding a creative');
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
  const outputUrl = `/api/videos/${videoId}/ads/${runId}/file`;
  const temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'streamwise-ad-'));
  const imagePath = path.join(temporaryDir, `creative${extension}`);
  let cloudinaryAsset = null;

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
    cloudinaryAsset = await uploadRenderedAd(outputPath, videoId, runId);

    const record = {
      id: runId,
      slotId: slot.id,
      slotNumber: slot.slot_number,
      creativeName: path.basename(creative.originalname || 'ad-image').slice(0, 120),
      creativeType: ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(extension) ? 'video' : 'image',
      campaignId: selectedCampaign?.id || null,
      brandName: selectedCampaign?.brands?.name || brandNameOverride || null,
      advertiserRequestId,
      outputUrl,
      cloudinaryPublicId: cloudinaryAsset.publicId,
      cloudinaryUrl: cloudinaryAsset.secureUrl,
      createdAt: new Date().toISOString(),
      ...location,
      createdBy,
      approved: false,
      approvedBy: null,
      approvedAt: null,
    };
    const { data: latest, error: latestError } = await adminSupabase.from('videos')
      .select('analysis_meta').eq('id', videoId).single();
    if (latestError || !latest) throw new ApiError(502, 'Could not save the ad result');

    const previousAds = Array.isArray(latest.analysis_meta?.adResults) ? latest.analysis_meta.adResults : [];
    const { error: updateError } = await adminSupabase.from('videos').update({
      analysis_meta: { ...(latest.analysis_meta || {}), adResults: [...previousAds, record] },
    }).eq('id', videoId);
    if (updateError) throw new ApiError(502, 'Could not save the ad result', updateError.message);

    return record;
  } catch (error) {
    if (cloudinaryAsset?.publicId) {
      await deleteRenderedAdAsset(cloudinaryAsset.publicId).catch((cleanupError) => {
        logger.warn({ message: 'Could not remove incomplete rendered video from Cloudinary', publicId: cloudinaryAsset.publicId, error: cleanupError.message });
      });
    }
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
  for (const rootPath of [AD_RESULTS_DIR, AD_INPUTS_DIR, PERSONALIZED_ADS_DIR]) {
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

  const { data: video, error: videoError } = await adminSupabase.from('videos')
    .select('id, analysis_meta').eq('id', videoId).single();
  if (videoError || !video) throw new ApiError(404, 'Video not found');

  const metadata = video.analysis_meta || {};
  const adResults = Array.isArray(metadata.adResults) ? metadata.adResults : [];
  const result = adResults.find((ad) => ad.id === adId);
  if (!result) throw new ApiError(404, 'Ad result not found');

  if (result.cloudinaryPublicId) await deleteRenderedAdAsset(result.cloudinaryPublicId);

  const { error: updateError } = await adminSupabase.from('videos').update({
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

async function setAdApproval({ videoId, adId, approved, reviewedBy }) {
  if (!UUID_REGEX.test(videoId) || !UUID_REGEX.test(adId)) {
    throw new ApiError(400, 'Video id and ad result id must be valid UUIDs');
  }
  const { data: video, error: readError } = await adminSupabase.from('videos')
    .select('id, analysis_meta').eq('id', videoId).single();
  if (readError || !video) throw new ApiError(404, 'Video not found');
  const metadata = video.analysis_meta || {};
  const adResults = Array.isArray(metadata.adResults) ? metadata.adResults : [];
  const existing = adResults.find((item) => item.id === adId);
  if (!existing) throw new ApiError(404, 'Ad result not found');
  const nextAdResults = adResults.map((item) => item.id === adId ? {
    ...item,
    approved,
    approvedBy: approved ? reviewedBy : null,
    approvedAt: approved ? new Date().toISOString() : null,
  } : item);
  const { error } = await adminSupabase.from('videos').update({
    analysis_meta: { ...metadata, adResults: nextAdResults },
  }).eq('id', videoId);
  if (error) throw new ApiError(502, 'Could not update ad approval', error.message);
  return nextAdResults.find((item) => item.id === adId);
}

module.exports = { insertAd, runAdInserter, deleteAdResult, deleteAdResults, setAdApproval };
