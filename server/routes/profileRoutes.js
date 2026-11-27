const express = require('express');
const { requireAuth } = require('../middlewares/requireAuth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await req.db.from('profiles').select('*').eq('id', req.user.id).single();
  if (error || !data) throw new ApiError(404, 'Profile not found. Apply the personalization database migration.');
  res.json(ApiResponse.success('Profile loaded', data));
}));

router.put('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const locationMode = body.locationMode;
  const country = String(body.country || '').trim();
  const state = String(body.state || '').trim();
  const district = String(body.district || '').trim();
  const city = String(body.city || '').trim();
  const displayName = String(body.displayName || '').trim();
  const latitude = body.latitude === null || body.latitude === '' || body.latitude === undefined ? null : Number(body.latitude);
  const longitude = body.longitude === null || body.longitude === '' || body.longitude === undefined ? null : Number(body.longitude);

  if (!displayName || displayName.length > 100) throw new ApiError(400, 'Name is required and must be under 100 characters');
  if (!['manual', 'gps'].includes(locationMode)) throw new ApiError(400, 'Choose manual location or GPS');
  if (!country || country.length > 100 || state.length > 100 || district.length > 100 || city.length > 100) {
    throw new ApiError(400, 'Enter a country and keep region names under 100 characters');
  }
  if ((latitude === null) !== (longitude === null)) throw new ApiError(400, 'Latitude and longitude must be provided together');
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new ApiError(400, 'Latitude must be between -90 and 90');
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new ApiError(400, 'Longitude must be between -180 and 180');
  if (locationMode === 'gps' && latitude === null) throw new ApiError(400, 'Use GPS to set coordinates before saving');

  const { data, error } = await req.db.from('profiles').update({
    display_name: displayName,
    location_mode: locationMode,
    country,
    state: state || null,
    district: district || null,
    city: city || null,
    latitude,
    longitude,
  }).eq('id', req.user.id).select('*').single();
  if (['PGRST204', '42703'].includes(error?.code)) {
    throw new ApiError(503, 'Apply server/database/location_district_migration.sql in the Supabase SQL Editor, then retry.');
  }
  if (error || !data) throw new ApiError(502, 'Could not save your profile', error?.message);
  res.json(ApiResponse.success('Profile updated', data));
}));

module.exports = router;
