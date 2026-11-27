const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { env } = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const { runAdInserter } = require('./adInsertionService');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const AD_INPUTS_DIR = path.join(__dirname, '..', 'storage', 'ad-inputs');
const PERSONALIZED_ADS_DIR = path.join(__dirname, '..', 'storage', 'personalized-ads');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm', '.mkv', '.avi']);
const inFlight = new Map();

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('en');
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function campaignScore(campaign, profile) {
  if (normalize(campaign.country) !== normalize(profile.country)) return null;
  const hasCity = Boolean(campaign.city);
  const hasState = Boolean(campaign.state);
  const cityMatches = hasCity && normalize(campaign.city) === normalize(profile.city);
  const stateMatches = hasState && normalize(campaign.state) === normalize(profile.state);
  const regionMatches = (!hasCity || cityMatches) && (!hasState || stateMatches);

  const hasCoordinates = campaign.latitude !== null && campaign.latitude !== undefined
    && campaign.longitude !== null && campaign.longitude !== undefined;
  let geoDistance = null;
  let geoMatches = false;
  if (hasCoordinates) {
    if (profile.latitude === null || profile.latitude === undefined
      || profile.longitude === null || profile.longitude === undefined) {
      if (!(hasCity || hasState) || !regionMatches) return null;
    } else {
      geoDistance = distanceKm(profile.latitude, profile.longitude, campaign.latitude, campaign.longitude);
      const radius = Number(campaign.radius_km) || 50;
      geoMatches = geoDistance <= radius;
      if (!regionMatches && !geoMatches) return null;
    }
  } else if (!regionMatches) return null;

  let score = cityMatches ? 10000 : stateMatches ? 5000 : 100;
  if (geoMatches) {
    const radius = Number(campaign.radius_km) || 50;
    if (geoDistance <= radius) score += 1000 + (1 - geoDistance / radius) * 500;
  }
  score += Number(campaign.priority) || 0;
  return score;
}

function locationHash(profile) {
  const key = [
    normalize(profile.country), normalize(profile.state), normalize(profile.city),
    profile.latitude === null ? '' : Number(profile.latitude).toFixed(2),
    profile.longitude === null ? '' : Number(profile.longitude).toFixed(2),
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
}

function trustedCreativePath(creativeUrl) {
  let url;
  let supabaseUrl;
  try {
    url = new URL(creativeUrl);
    supabaseUrl = new URL(env.supabase.url);
  } catch {
    throw new ApiError(400, 'The selected brand creative URL is invalid');
  }
  if (url.protocol !== 'https:' || url.origin !== supabaseUrl.origin
    || !url.pathname.startsWith('/storage/v1/object/public/brand-creatives/')) {
    throw new ApiError(400, 'The selected creative is outside the approved brand storage bucket');
  }
  const extension = path.extname(url.pathname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new ApiError(400, 'The selected brand creative format is not supported');
  return { url: url.toString(), extension };
}

async function downloadCreative(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new ApiError(502, `Could not download brand creative (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function readyResult(db, userId, videoId, ad, hash) {
  const { data, error } = await db.from('user_ad_renders').select('output_url, created_at')
    .eq('user_id', userId).eq('video_id', videoId).eq('brand_ad_id', ad.id)
    .eq('location_hash', hash).maybeSingle();
  if (error) throw new ApiError(502, 'Could not load your saved regional ad video', error.message);
  if (!data) return null;
  const prefix = `/storage/personalized-ads/${videoId}/${userId}/`;
  const filename = data.output_url.startsWith(prefix) ? data.output_url.slice(prefix.length) : '';
  if (!/^[0-9a-f-]{36}\.mp4$/i.test(filename)) return null;
  const userOutputDir = path.resolve(PERSONALIZED_ADS_DIR, videoId, userId);
  const localPath = path.resolve(userOutputDir, filename);
  if (!localPath.startsWith(`${userOutputDir}${path.sep}`)) return null;
  if (!fs.existsSync(localPath)) {
    const { error: cleanupError } = await db.from('user_ad_renders').delete()
      .eq('user_id', userId).eq('video_id', videoId).eq('brand_ad_id', ad.id).eq('location_hash', hash);
    if (cleanupError) throw new ApiError(502, 'Could not refresh your regional ad cache', cleanupError.message);
    return null;
  }
  return {
    status: 'ready',
    videoUrl: data.output_url,
    createdAt: data.created_at,
    brand: ad.brands,
    campaign: { id: ad.id, name: ad.name },
    cached: true,
  };
}

async function renderForLocation({ db, user, videoId, ad, slots, hash }) {
  const cacheKey = `${user.id}:${videoId}:${ad.id}:${hash}`;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const job = (async () => {
    const cached = await readyResult(db, user.id, videoId, ad, hash);
    if (cached) return cached;

    const assetsDir = path.join(AD_INPUTS_DIR, videoId);
    const sourceVideo = path.join(assetsDir, 'normalized_input.mp4');
    const slotsJson = path.join(assetsDir, 'slots.json');
    const coordinatesCsv = path.join(assetsDir, 'coordinates.csv');
    if (![sourceVideo, slotsJson, coordinatesCsv].every((file) => fs.existsSync(file))) {
      throw new ApiError(409, 'Prepare this video for ad insertion by rerunning billboard analysis');
    }

    const { url, extension } = trustedCreativePath(ad.creative_url);
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'streamwise-personal-ad-'));
    const creativePath = path.join(tempDir, `brand-creative${extension}`);
    const resultId = crypto.randomUUID();
    const outputDir = path.join(PERSONALIZED_ADS_DIR, videoId, user.id);
    const outputPath = path.join(outputDir, `${resultId}.mp4`);
    const outputUrl = `/storage/personalized-ads/${videoId}/${user.id}/${resultId}.mp4`;

    try {
      await downloadCreative(url, creativePath);
      await fs.promises.mkdir(outputDir, { recursive: true });
      const slotIds = slots.map((slot) => slot.slot_number).join(',');
      await runAdInserter([
        '--video', sourceVideo,
        '--slots', slotsJson,
        '--coords', coordinatesCsv,
        '--ad', creativePath,
        '--output', outputPath,
        '--slot-ids', slotIds,
      ]);

      const { data: saved, error } = await db.from('user_ad_renders').insert({
        user_id: user.id,
        video_id: videoId,
        brand_ad_id: ad.id,
        location_hash: hash,
        output_url: outputUrl,
      }).select('created_at').single();
      if (error || !saved) throw new ApiError(502, 'Could not save your personalized ad video', error?.message);
      return {
        status: 'ready', videoUrl: outputUrl, createdAt: saved.created_at,
        brand: ad.brands, campaign: { id: ad.id, name: ad.name }, cached: false,
      };
    } catch (error) {
      await fs.promises.rm(outputPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })();
  inFlight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function getPersonalizedAd({ db, user, videoId }) {
  if (!UUID_REGEX.test(videoId)) throw new ApiError(400, 'Video id must be a valid UUID');
  const [{ data: profile, error: profileError }, { data: video, error: videoError }] = await Promise.all([
    db.from('profiles').select('country, state, city, latitude, longitude, location_mode').eq('id', user.id).single(),
    db.from('videos').select('id, analysis_status, analysis_meta').eq('id', videoId).single(),
  ]);
  if (profileError || !profile) throw new ApiError(404, 'Profile not found');
  if (videoError || !video) throw new ApiError(404, 'Video not found');
  if (video.analysis_status !== 'completed' || !video.analysis_meta?.adInputReady) {
    return { status: 'not_ready', videoUrl: null, message: 'Billboard analysis is not ready for personalized ads.' };
  }

  const { data: slots, error: slotsError } = await db.from('ad_slots')
    .select('slot_number').eq('video_id', videoId).order('slot_number', { ascending: true });
  if (slotsError) throw new ApiError(502, 'Could not load detected billboard slots', slotsError.message);
  if (!slots?.length) return { status: 'no_slots', videoUrl: null, message: 'No billboard slots were found.' };

  const { data: campaigns, error: campaignsError } = await db.from('brand_ads')
    .select('id, name, creative_url, creative_type, country, state, city, latitude, longitude, radius_km, priority, created_at, brands(name, category)')
    .eq('active', true).order('priority', { ascending: false });
  if (campaignsError) throw new ApiError(502, 'Could not load local brand campaigns', campaignsError.message);

  const selected = (campaigns || [])
    .map((campaign) => ({ campaign, score: campaignScore(campaign, profile) }))
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => right.score - left.score
      || new Date(right.campaign.created_at).getTime() - new Date(left.campaign.created_at).getTime())[0]?.campaign;
  if (!selected) return { status: 'no_match', videoUrl: null, message: 'No active campaign matches your saved location.' };

  const hash = locationHash(profile);
  const cached = await readyResult(db, user.id, videoId, selected, hash);
  if (cached) return cached;
  return renderForLocation({ db, user, videoId, ad: selected, slots, hash });
}

module.exports = { getPersonalizedAd };
