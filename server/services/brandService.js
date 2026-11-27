const crypto = require('crypto');
const path = require('path');
const { ApiError } = require('../utils/ApiError');
const { env } = require('../config/env');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);

function requireDistrictMigration(error) {
  if (['PGRST204', '42703'].includes(error?.code)) {
    throw new ApiError(503, 'Apply server/database/location_district_migration.sql in the Supabase SQL Editor, then retry.');
  }
}

function validateCampaign(row) {
  const brandName = String(row.brandName || row.brand_name || '').trim();
  const country = String(row.country || 'India').trim();
  const state = String(row.state || '').trim();
  const district = String(row.district || '').trim();
  const city = String(row.city || '').trim();
  const creativeUrl = String(row.creativeUrl || row.creative_url || '').trim();
  if (!brandName || brandName.length > 160) throw new ApiError(400, 'Brand name is required and must be under 160 characters');
  if (!country || country.length > 100) throw new ApiError(400, 'Country is required and must be under 100 characters');
  if (state.length > 100 || district.length > 100 || city.length > 100) throw new ApiError(400, 'State, district, and city must be under 100 characters');
  if (!/^https:\/\//i.test(creativeUrl)) throw new ApiError(400, 'Creative URL must use HTTPS');

  const latitude = row.latitude === '' || row.latitude === undefined || row.latitude === null ? null : Number(row.latitude);
  const longitude = row.longitude === '' || row.longitude === undefined || row.longitude === null ? null : Number(row.longitude);
  const radiusKm = Number(row.radiusKm ?? row.radius_km ?? 50);
  const priority = Number(row.priority ?? 0);
  if ((latitude === null) !== (longitude === null)) throw new ApiError(400, 'GPS targeting requires both latitude and longitude');
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new ApiError(400, 'Latitude must be between -90 and 90');
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new ApiError(400, 'Longitude must be between -180 and 180');
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 5000) throw new ApiError(400, 'Target radius must be between 1 and 5000 km');
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) throw new ApiError(400, 'Priority must be between 0 and 1000');

  return {
    brandName,
    category: String(row.category || 'General').trim().slice(0, 100) || 'General',
    websiteUrl: String(row.websiteUrl || row.website_url || '').trim() || null,
    name: String(row.name || row.creativeName || row.creative_name || brandName).trim().slice(0, 180),
    creativeUrl,
    creativeType: String(row.creativeType || row.creative_type || '').toLowerCase(),
    country,
    state: state || null,
    district: district || null,
    city: city || null,
    latitude,
    longitude,
    radiusKm,
    priority,
  };
}

function validateCreativeUrl(creativeUrl) {
  let url;
  let supabaseUrl;
  try {
    url = new URL(creativeUrl);
    supabaseUrl = new URL(env.supabase.url);
  } catch {
    throw new ApiError(400, 'Creative URL is invalid');
  }
  if (url.origin !== supabaseUrl.origin || !url.pathname.startsWith('/storage/v1/object/public/brand-creatives/')) {
    throw new ApiError(400, 'Imported creatives must already be uploaded to the public brand-creatives bucket');
  }
}

async function upsertBrand(db, campaign) {
  const { data, error } = await db.from('brands').upsert({
    name: campaign.brandName,
    category: campaign.category,
    website_url: campaign.websiteUrl,
    active: true,
  }, { onConflict: 'name' }).select('id, name, category').single();
  if (error || !data) throw new ApiError(502, 'Could not save brand', error?.message);
  return data;
}

async function saveCampaign(db, userId, rawCampaign, storagePath = null) {
  const campaign = validateCampaign(rawCampaign);
  if (!['image', 'video'].includes(campaign.creativeType)) throw new ApiError(400, 'Creative type must be image or video');
  if (!storagePath) validateCreativeUrl(campaign.creativeUrl);
  const brand = await upsertBrand(db, campaign);
  const { data, error } = await db.from('brand_ads').insert({
    brand_id: brand.id,
    name: campaign.name,
    creative_url: campaign.creativeUrl,
    storage_path: storagePath,
    creative_type: campaign.creativeType,
    country: campaign.country,
    state: campaign.state,
    district: campaign.district,
    city: campaign.city,
    latitude: campaign.latitude,
    longitude: campaign.longitude,
    radius_km: campaign.radiusKm,
    priority: campaign.priority,
    active: true,
    created_by: userId,
  }).select('id, brand_id, name, creative_url, creative_type, country, state, district, city, latitude, longitude, radius_km, priority, active').single();
  requireDistrictMigration(error);
  if (error || !data) throw new ApiError(502, 'Could not save brand campaign', error?.message);
  return { ...data, brand };
}

async function createCampaignFromUpload({ db, userId, file, fields }) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const creativeType = VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image';
  const row = validateCampaign({ ...fields, creativeType, creativeUrl: 'https://pending.invalid/creative' });
  const brand = await upsertBrand(db, row);
  const storagePath = `${brand.id}/${crypto.randomUUID()}${extension}`;
  const { error: uploadError } = await db.storage.from('brand-creatives').upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (uploadError) throw new ApiError(502, 'Could not upload campaign creative', uploadError.message);

  const { data: publicData } = db.storage.from('brand-creatives').getPublicUrl(storagePath);
  try {
    return await saveCampaign(db, userId, { ...fields, creativeType, creativeUrl: publicData.publicUrl }, storagePath);
  } catch (error) {
    await db.storage.from('brand-creatives').remove([storagePath]).catch(() => {});
    throw error;
  }
}

async function listCampaigns(db) {
  const { data, error } = await db.from('brand_ads')
    .select('id, brand_id, name, creative_url, creative_type, country, state, district, city, latitude, longitude, radius_km, priority, active, created_at, storage_path, brands(name, category)')
    .order('created_at', { ascending: false });
  requireDistrictMigration(error);
  if (error) throw new ApiError(502, 'Could not load brand campaigns', error.message);
  return data || [];
}

async function importCampaigns(db, userId, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
    throw new ApiError(400, 'Import between 1 and 500 campaign rows at a time');
  }
  const results = [];
  for (let index = 0; index < rows.length; index += 1) {
    try {
      results.push({ row: index + 1, success: true, campaign: await saveCampaign(db, userId, rows[index]) });
    } catch (error) {
      results.push({ row: index + 1, success: false, error: error.message });
    }
  }
  return { imported: results.filter((row) => row.success).length, failed: results.filter((row) => !row.success).length, results };
}

async function deleteCampaign(db, campaignId) {
  const { data: campaign, error: readError } = await db.from('brand_ads')
    .select('id, storage_path').eq('id', campaignId).single();
  if (readError || !campaign) throw new ApiError(404, 'Brand campaign not found');
  const { error } = await db.from('brand_ads').delete().eq('id', campaignId);
  if (error) throw new ApiError(502, 'Could not delete brand campaign', error.message);
  if (campaign.storage_path) {
    const { error: storageError } = await db.storage.from('brand-creatives').remove([campaign.storage_path]);
    if (storageError) throw new ApiError(502, 'Campaign was deleted but its creative file could not be removed', storageError.message);
  }
  return { id: campaignId, deleted: true };
}

module.exports = { createCampaignFromUpload, listCampaigns, importCampaigns, deleteCampaign };
