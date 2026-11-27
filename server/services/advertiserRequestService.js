const crypto = require('crypto');
const path = require('path');
const { adminSupabase } = require('../config/supabase');
const { ApiError } = require('../utils/ApiError');
const { insertAd } = require('./adInsertionService');
const logger = require('../utils/logger');

const LOGO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_LOGO_BYTES = 20 * 1024 * 1024;
const STORAGE_BUCKET = 'brand-creatives';
const RATE_CARD_ID = 'default';
const PRIORITY_TIERS = new Set(['standard', 'featured', 'premium']);
const DEFAULT_PRIORITY_MULTIPLIERS = { standard: 1, featured: 1.5, premium: 2 };

const queue = [];
const queued = new Set();
let running = false;

function migrationError(error) {
  if (['PGRST205', 'PGRST204', '42P01', '42703'].includes(error?.code)) {
    throw new ApiError(503, 'Apply server/database/advertiser_orders_migration.sql and server/database/advertiser_priority_payment_migration.sql after the earlier advertiser migrations in Supabase.');
  }
}

function trimField(value, label, max = 160, required = false) {
  const text = String(value || '').trim();
  if (required && text.length < 2) throw new ApiError(400, `${label} is required`);
  if (text.length > max) throw new ApiError(400, `${label} must be under ${max} characters`);
  return text || null;
}

function numberField(value, label, { min = 0, max = 1_000_000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new ApiError(400, `${label} must be between ${min} and ${max}`);
  return Math.round(number * 100) / 100;
}

function parseVideoIds(value) {
  let entries = value;
  if (typeof entries === 'string') {
    try { entries = JSON.parse(entries); } catch { entries = entries.split(/[\n,;]+/); }
  }
  if (!Array.isArray(entries)) throw new ApiError(400, 'Choose one or more videos from the inventory or paste video links');
  const ids = [];
  for (const entry of entries) {
    const text = String(entry || '').trim();
    const matches = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig) || [];
    if (matches.length !== 1) throw new ApiError(400, `Could not read a video ID from: ${text.slice(0, 100)}`);
    if (!ids.includes(matches[0].toLowerCase())) ids.push(matches[0].toLowerCase());
  }
  if (ids.length < 1 || ids.length > 30) throw new ApiError(400, 'Select between 1 and 30 videos per request');
  return ids;
}

function normalizedText(value) { return String(value || '').trim().toLocaleLowerCase('en'); }

function matchingLocationRate(locationRates, location) {
  const candidates = (Array.isArray(locationRates) ? locationRates : []).filter((rule) => {
    const fields = ['country', 'state', 'district', 'city'];
    return fields.every((field) => !rule[field] || normalizedText(rule[field]) === normalizedText(location[field]));
  });
  candidates.sort((a, b) => ['country', 'state', 'district', 'city'].filter((field) => b[field]).length
    - ['country', 'state', 'district', 'city'].filter((field) => a[field]).length);
  return candidates[0] || null;
}

function calculateBreakdown({ items, count, location = {}, radiusKm, baseFeePerVideo, locationFeePerVideo, radiusFeePer10Km, taxPercent, priorityMultipliers = DEFAULT_PRIORITY_MULTIPLIERS, locationRates = [], forceLocationFee = false }) {
  const videoItems = Array.isArray(items) ? items : Array.from({ length: Number(count || 0) }, () => ({ priorityTier: 'standard' }));
  const resolvedLocationRate = matchingLocationRate(locationRates, location);
  const effectiveLocationFee = resolvedLocationRate && !forceLocationFee ? Number(resolvedLocationRate.feePerVideo || 0) : Number(locationFeePerVideo || 0);
  const tierCounts = { standard: 0, featured: 0, premium: 0 };
  const tierAmounts = { standard: 0, featured: 0, premium: 0 };
  for (const item of videoItems) {
    const tier = PRIORITY_TIERS.has(item.priorityTier || item.videoPriorityTier) ? (item.priorityTier || item.videoPriorityTier) : 'standard';
    tierCounts[tier] += 1;
    const multiplier = Number(priorityMultipliers?.[tier] || DEFAULT_PRIORITY_MULTIPLIERS[tier]);
    tierAmounts[tier] += Number(baseFeePerVideo || 0) * multiplier;
  }
  const videoCount = videoItems.length;
  const radiusBlocks = Math.ceil(radiusKm / 10);
  const baseAmount = Math.round(Object.values(tierAmounts).reduce((sum, amount) => sum + amount, 0) * 100) / 100;
  const locationAmount = Math.round(videoCount * effectiveLocationFee * 100) / 100;
  const radiusAmount = Math.round(videoCount * radiusBlocks * radiusFeePer10Km * 100) / 100;
  const subtotal = Math.round((baseAmount + locationAmount + radiusAmount) * 100) / 100;
  const taxAmount = Math.round(subtotal * taxPercent) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  return {
    currency: 'INR', count: videoCount, radiusKm, radiusBlocks,
    baseFeePerVideo, locationFeePerVideo: effectiveLocationFee, radiusFeePer10Km, taxPercent,
    priorityMultipliers, tierCounts, tierAmounts,
    locationRateLabel: resolvedLocationRate ? [resolvedLocationRate.city, resolvedLocationRate.district, resolvedLocationRate.state, resolvedLocationRate.country].filter(Boolean).join(', ') : 'Default regional rate',
    baseAmount, locationAmount, radiusAmount, subtotal, taxAmount, total,
  };
}

function normalizeRateCard(row) {
  return {
    currency: 'INR',
    issuerName: row?.issuer_name || 'StreamWise AI',
    issuerAddress: row?.issuer_address || '',
    issuerTaxId: row?.issuer_tax_id || '',
    baseFeePerVideo: Number(row?.base_fee_per_video || 0),
    locationFeePerVideo: Number(row?.location_fee_per_video || 0),
    radiusFeePer10Km: Number(row?.radius_fee_per_10km || 0),
    taxPercent: Number(row?.tax_percent || 0),
    locationRates: Array.isArray(row?.location_rates) ? row.location_rates : [],
    priorityMultipliers: { ...DEFAULT_PRIORITY_MULTIPLIERS, ...(row?.priority_multipliers || {}) },
    paymentQrUrl: row?.payment_qr_url || '/demo-payment-qr.svg',
    paymentInstructions: row?.payment_instructions || 'Scan the QR to pay, then submit the UTR or transaction reference for admin verification.',
    updatedAt: row?.updated_at || null,
  };
}

function normalizeLocationRates(value) {
  let rules = value;
  if (typeof rules === 'string') {
    try { rules = JSON.parse(rules); } catch { throw new ApiError(400, 'Location rates must be valid JSON'); }
  }
  if (rules === undefined || rules === null) return [];
  if (!Array.isArray(rules) || rules.length > 100) throw new ApiError(400, 'Add no more than 100 location rate rules');
  return rules.map((rule, index) => {
    const country = trimField(rule.country, `Location rule ${index + 1} country`, 100, true);
    const state = trimField(rule.state, `Location rule ${index + 1} state`, 100);
    const district = trimField(rule.district, `Location rule ${index + 1} district`, 100);
    const city = trimField(rule.city, `Location rule ${index + 1} city`, 100);
    if (!state && !district && !city) throw new ApiError(400, `Location rule ${index + 1} needs a state, district, or city`);
    return { country, state, district, city, feePerVideo: numberField(rule.feePerVideo, `Location rule ${index + 1} fee`) };
  });
}

function normalizePriorityMultipliers(value) {
  const tiers = value || DEFAULT_PRIORITY_MULTIPLIERS;
  return Object.fromEntries(['standard', 'featured', 'premium'].map((tier) => [
    tier, numberField(tiers[tier] ?? DEFAULT_PRIORITY_MULTIPLIERS[tier], `${tier} multiplier`, { min: 0.1, max: 10 }),
  ]));
}

function normalizePaymentQrUrl(value) {
  const qrUrl = String(value || '/demo-payment-qr.svg').trim();
  if (qrUrl.length > 1000) throw new ApiError(400, 'Payment QR URL is too long');
  if (qrUrl.startsWith('/') && !qrUrl.startsWith('//')) return qrUrl;
  let parsed;
  try { parsed = new URL(qrUrl); } catch { throw new ApiError(400, 'Payment QR must be an HTTPS image URL or an app-relative image path'); }
  if (parsed.protocol !== 'https:') throw new ApiError(400, 'Payment QR URL must use HTTPS');
  return qrUrl;
}

async function getRateCard() {
  const { data, error } = await adminSupabase.from('advertiser_rate_cards').select('*').eq('id', RATE_CARD_ID).maybeSingle();
  migrationError(error);
  if (error) throw new ApiError(502, 'Could not load the advertiser rate card', error.message);
  if (!data) throw new ApiError(503, 'The advertiser rate card has not been initialized');
  return normalizeRateCard(data);
}

async function updateRateCard(userId, values) {
  const row = {
    id: RATE_CARD_ID,
    currency: 'INR',
    issuer_name: trimField(values.issuerName || 'StreamWise AI', 'Receipt issuer name', 160, true),
    issuer_address: trimField(values.issuerAddress, 'Receipt issuer address', 500),
    issuer_tax_id: trimField(values.issuerTaxId, 'Tax registration number', 100),
    base_fee_per_video: numberField(values.baseFeePerVideo, 'Base fee per video'),
    location_fee_per_video: numberField(values.locationFeePerVideo, 'Location surcharge per video'),
    radius_fee_per_10km: numberField(values.radiusFeePer10Km, 'Radius fee per 10 km'),
    tax_percent: numberField(values.taxPercent, 'Tax percent', { max: 100 }),
    location_rates: normalizeLocationRates(values.locationRates),
    priority_multipliers: normalizePriorityMultipliers(values.priorityMultipliers),
    payment_qr_url: normalizePaymentQrUrl(values.paymentQrUrl),
    payment_instructions: trimField(values.paymentInstructions, 'Payment instructions', 1000) || 'Scan the QR to pay, then submit the UTR or transaction reference for admin verification.',
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await adminSupabase.from('advertiser_rate_cards').upsert(row).select('*').single();
  migrationError(error);
  if (error || !data) throw new ApiError(502, 'Could not save the advertiser rate card', error?.message);
  return normalizeRateCard(data);
}

async function listEligibleVideos() {
  const { data, error } = await adminSupabase.from('videos')
    .select('id, title, creator_name, duration, created_at, analysis_meta, advertiser_priority_tier')
    .eq('ad_review_enabled', true).eq('analysis_status', 'completed')
    .order('created_at', { ascending: false }).limit(200);
  migrationError(error);
  if (error) throw new ApiError(502, 'Could not load ad-ready videos', error.message);
  const ready = (data || []).filter((video) => video.analysis_meta?.adInputReady === true);
  if (!ready.length) return [];
  const { data: slots, error: slotsError } = await adminSupabase.from('ad_slots')
    .select('video_id').in('video_id', ready.map((video) => video.id));
  if (slotsError) throw new ApiError(502, 'Could not load billboard inventory', slotsError.message);
  const counts = (slots || []).reduce((result, slot) => {
    result[slot.video_id] = (result[slot.video_id] || 0) + 1;
    return result;
  }, {});
  return ready.filter((video) => counts[video.id] > 0).map((video) => ({
    id: video.id,
    title: video.title,
    creatorName: video.creator_name || 'Legacy creator',
    duration: Number(video.duration || 0),
    priorityTier: PRIORITY_TIERS.has(video.advertiser_priority_tier) ? video.advertiser_priority_tier : 'standard',
    createdAt: video.created_at,
    slotCount: counts[video.id],
    link: `/watch/${video.id}`,
  }));
}

async function createRequest({ user, profile, file, fields }) {
  if (!file) throw new ApiError(400, 'Upload your brand logo');
  if (file.size > MAX_LOGO_BYTES) throw new ApiError(413, 'Logo file must be 20 MB or smaller');
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!LOGO_EXTENSIONS.has(extension)) throw new ApiError(400, 'Logo must be JPG, PNG, or WebP');

  const videoIds = parseVideoIds(fields.videoIds);
  const brandName = trimField(fields.brandName, 'Brand name', 160, true);
  const contactName = trimField(fields.contactName || profile?.display_name, 'Contact name', 160, true);
  const contactPhone = trimField(fields.contactPhone, 'Phone number', 40, false);
  const websiteUrl = trimField(fields.websiteUrl, 'Website', 300, false);
  if (websiteUrl) {
    let parsed;
    try { parsed = new URL(websiteUrl); } catch { throw new ApiError(400, 'Enter a valid brand website URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new ApiError(400, 'Brand website must use HTTP or HTTPS');
  }
  const country = trimField(fields.country || 'India', 'Country', 100, true);
  const state = trimField(fields.state, 'State', 100);
  const district = trimField(fields.district, 'District', 100);
  const city = trimField(fields.city, 'City', 100);
  const latitude = fields.latitude === '' || fields.latitude === undefined ? null : Number(fields.latitude);
  const longitude = fields.longitude === '' || fields.longitude === undefined ? null : Number(fields.longitude);
  if ((latitude === null) !== (longitude === null)) throw new ApiError(400, 'Enter both GPS coordinates or leave both blank');
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new ApiError(400, 'Latitude must be between -90 and 90');
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new ApiError(400, 'Longitude must be between -180 and 180');
  if (!state && !district && !city && latitude === null) throw new ApiError(400, 'Provide a state, district, city, or GPS location for targeting');
  const radiusKm = numberField(fields.radiusKm, 'Radius in kilometres', { min: 1, max: 5000 });

  const { data: videos, error: videoError } = await adminSupabase.from('videos')
    .select('id, title, creator_name, analysis_status, analysis_meta, ad_review_enabled, advertiser_priority_tier')
    .in('id', videoIds);
  migrationError(videoError);
  if (videoError) throw new ApiError(502, 'Could not verify selected videos', videoError.message);
  const videoById = new Map((videos || []).map((video) => [video.id, video]));
  const notReady = videoIds.filter((id) => {
    const video = videoById.get(id);
    return !video || !video.ad_review_enabled || video.analysis_status !== 'completed' || video.analysis_meta?.adInputReady !== true;
  });
  if (notReady.length) throw new ApiError(400, 'Some selected videos are no longer ready for ad insertion. Refresh the video inventory.');
  const { data: slots, error: slotError } = await adminSupabase.from('ad_slots').select('video_id').in('video_id', videoIds);
  if (slotError) throw new ApiError(502, 'Could not verify billboard slots', slotError.message);
  const withSlots = new Set((slots || []).map((slot) => slot.video_id));
  if (videoIds.some((id) => !withSlots.has(id))) throw new ApiError(400, 'Every selected video must have at least one detected billboard slot');

  const location = { country, state, district, city };
  const rates = await getRateCard();
  const estimatedBreakdown = calculateBreakdown({ items: videoIds.map((id) => ({ priorityTier: videoById.get(id).advertiser_priority_tier })), radiusKm, location,
    baseFeePerVideo: rates.baseFeePerVideo, locationFeePerVideo: rates.locationFeePerVideo,
    radiusFeePer10Km: rates.radiusFeePer10Km, taxPercent: rates.taxPercent,
    priorityMultipliers: rates.priorityMultipliers, locationRates: rates.locationRates });

  const logoPath = `advertisers/${user.id}/${crypto.randomUUID()}${extension}`;
  const { error: uploadError } = await adminSupabase.storage.from(STORAGE_BUCKET).upload(logoPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (uploadError) throw new ApiError(502, 'Could not upload brand logo', uploadError.message);
  const { data: logoPublic } = adminSupabase.storage.from(STORAGE_BUCKET).getPublicUrl(logoPath);

  let request;
  try {
    const { data, error } = await adminSupabase.from('advertiser_requests').insert({
      owner_id: user.id,
      brand_name: brandName,
      contact_name: contactName,
      contact_email: user.email,
      contact_phone: contactPhone,
      website_url: websiteUrl,
      notes: trimField(fields.notes, 'Notes', 2000),
      logo_url: logoPublic.publicUrl,
      logo_storage_path: logoPath,
      country, state, district, city, latitude, longitude, radius_km: radiusKm,
      status: 'submitted', currency: 'INR', estimated_breakdown: estimatedBreakdown,
    }).select('*').single();
    migrationError(error);
    if (error || !data) throw new ApiError(502, 'Could not save advertiser request', error?.message);
    request = data;
    const items = videoIds.map((videoId) => {
      const video = videoById.get(videoId);
      return { request_id: request.id, video_id: videoId, video_title: video.title,
        creator_name: video.creator_name || 'Legacy creator',
        video_priority_tier: PRIORITY_TIERS.has(video.advertiser_priority_tier) ? video.advertiser_priority_tier : 'standard',
        status: 'queued' };
    });
    const { error: itemError } = await adminSupabase.from('advertiser_request_videos').insert(items);
    migrationError(itemError);
    if (itemError) throw new ApiError(502, 'Could not save selected video list', itemError.message);
  } catch (error) {
    if (request?.id) await adminSupabase.from('advertiser_requests').delete().eq('id', request.id);
    await adminSupabase.storage.from(STORAGE_BUCKET).remove([logoPath]);
    throw error;
  }
  return getRequest(request.id, { ownerId: user.id });
}

async function requestRows({ ownerId = null } = {}) {
  let query = adminSupabase.from('advertiser_requests').select('*').order('created_at', { ascending: false }).limit(100);
  if (ownerId) query = query.eq('owner_id', ownerId);
  const { data, error } = await query;
  migrationError(error);
  if (error) throw new ApiError(502, 'Could not load advertiser requests', error.message);
  const rows = data || [];
  if (!rows.length) return [];
  const { data: items, error: itemError } = await adminSupabase.from('advertiser_request_videos')
    .select('id, request_id, video_id, video_title, creator_name, video_priority_tier, status, ad_result_id, error')
    .in('request_id', rows.map((row) => row.id)).order('created_at', { ascending: true });
  migrationError(itemError);
  if (itemError) throw new ApiError(502, 'Could not load requested video list', itemError.message);
  const grouped = new Map();
  for (const item of items || []) grouped.set(item.request_id, [...(grouped.get(item.request_id) || []), {
    id: item.id, videoId: item.video_id, title: item.video_title, creatorName: item.creator_name,
    priorityTier: item.video_priority_tier || 'standard',
    status: item.status, adResultId: item.ad_result_id, error: item.error,
  }]);
  return rows.map((row) => ({
    id: row.id, ownerId: row.owner_id, brandName: row.brand_name, contactName: row.contact_name,
    contactEmail: row.contact_email, contactPhone: row.contact_phone, websiteUrl: row.website_url,
    notes: row.notes, logoUrl: row.logo_url, country: row.country, state: row.state,
    district: row.district, city: row.city, latitude: row.latitude, longitude: row.longitude,
    radiusKm: Number(row.radius_km), status: row.status, currency: row.currency,
    estimatedBreakdown: row.estimated_breakdown, quotedBreakdown: row.quoted_breakdown,
    quotedTotal: row.quoted_total == null ? null : Number(row.quoted_total),
    paymentReference: row.payment_reference, advertiserPaymentReference: row.advertiser_payment_reference,
    paymentSubmittedAt: row.payment_submitted_at, adminQuoteNote: row.admin_quote_note,
    receiptNumber: row.receipt_number,
    paidAt: row.paid_at, adminNote: row.admin_note, createdAt: row.created_at, updatedAt: row.updated_at,
    videos: grouped.get(row.id) || [],
  }));
}

async function listOwnerRequests(ownerId) { return requestRows({ ownerId }); }
async function listAdminRequests() { return requestRows(); }

async function getRequest(id, { ownerId = null } = {}) {
  const rows = await requestRows({ ownerId });
  const request = rows.find((item) => item.id === id);
  if (!request) throw new ApiError(404, 'Advertiser request not found');
  return request;
}

async function issueQuote(id, values, reviewedBy) {
  const request = await getRequest(id);
  if (!['submitted', 'quoted'].includes(request.status)) throw new ApiError(409, 'Only submitted requests can be quoted');
  const rates = await getRateCard();
  const baseFeePerVideo = numberField(values.baseFeePerVideo ?? rates.baseFeePerVideo, 'Base fee per video');
  const locationFeePerVideo = numberField(values.locationFeePerVideo ?? rates.locationFeePerVideo, 'Location surcharge per video');
  const radiusFeePer10Km = numberField(values.radiusFeePer10Km ?? rates.radiusFeePer10Km, 'Radius fee per 10 km');
  const taxPercent = numberField(values.taxPercent ?? rates.taxPercent, 'Tax percent', { max: 100 });
  const breakdown = calculateBreakdown({
    items: request.videos.map((video) => ({ priorityTier: video.priorityTier })),
    radiusKm: request.radiusKm,
    location: { country: request.country, state: request.state, district: request.district, city: request.city },
    baseFeePerVideo, locationFeePerVideo, radiusFeePer10Km, taxPercent,
    priorityMultipliers: rates.priorityMultipliers, locationRates: rates.locationRates, forceLocationFee: true,
  });
  breakdown.issuerName = rates.issuerName;
  breakdown.issuerAddress = rates.issuerAddress;
  breakdown.issuerTaxId = rates.issuerTaxId;
  breakdown.paymentQrUrl = normalizePaymentQrUrl(values.paymentQrUrl || rates.paymentQrUrl);
  breakdown.paymentInstructions = rates.paymentInstructions;
  const quoteNote = trimField(values.quoteNote, 'Message to advertiser', 2000);
  const { error } = await adminSupabase.from('advertiser_requests').update({
    status: 'quoted', currency: 'INR', quoted_breakdown: breakdown, quoted_total: breakdown.total,
    admin_quote_note: quoteNote,
    advertiser_payment_reference: null, payment_submitted_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).in('status', ['submitted', 'quoted']).select('id').single();
  migrationError(error);
  if (error) throw new ApiError(502, 'Could not issue advertiser quote', error.message);
  logger.info({ message: 'Advertiser quote issued', requestId: id, reviewedBy, amount: breakdown.total });
  return getRequest(id);
}

function makeReceiptNumber() {
  const year = new Date().getFullYear();
  return `SW-${year}-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function confirmPayment(id, paymentReference, confirmedBy) {
  const existing = await getRequest(id);
  if (existing.status !== 'quoted' || existing.quotedTotal == null) throw new ApiError(409, 'Issue a quote before confirming payment');
  const reference = trimField(paymentReference || existing.advertiserPaymentReference, 'Payment reference', 120, true);
  const { data, error } = await adminSupabase.from('advertiser_requests').update({
    status: 'paid', payment_reference: reference, receipt_number: makeReceiptNumber(),
    paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'quoted').select('id').single();
  migrationError(error);
  if (error || !data) throw new ApiError(409, 'Payment could not be confirmed; refresh the request and check its status', error?.message);
  logger.info({ message: 'Advertiser payment confirmed and receipt issued', requestId: id, confirmedBy });
  return getRequest(id);
}

async function submitPaymentReference(id, ownerId, paymentReference) {
  const reference = trimField(paymentReference, 'UPI / bank transaction reference', 120, true);
  const request = await getRequest(id, { ownerId });
  if (request.status !== 'quoted') throw new ApiError(409, 'A payment reference can only be submitted for an active quote');
  const { data, error } = await adminSupabase.from('advertiser_requests').update({
    advertiser_payment_reference: reference,
    payment_submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('owner_id', ownerId).eq('status', 'quoted').select('id').single();
  migrationError(error);
  if (error || !data) throw new ApiError(409, 'Could not submit payment reference; refresh the quote and try again', error?.message);
  return getRequest(id, { ownerId });
}

async function rejectRequest(id, reason) {
  const note = trimField(reason, 'Rejection reason', 500, false);
  const { data, error } = await adminSupabase.from('advertiser_requests').update({ status: 'rejected', admin_note: note, updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['submitted', 'quoted']).select('id').single();
  migrationError(error);
  if (error || !data) throw new ApiError(409, 'This advertiser request can no longer be declined', error?.message);
  return getRequest(id);
}

async function retryRequest(id) {
  const request = await getRequest(id);
  if (!['partial', 'failed'].includes(request.status)) throw new ApiError(409, 'Only failed advertiser rendering requests can be retried');
  const { error: itemError } = await adminSupabase.from('advertiser_request_videos').update({ status: 'queued', error: null, updated_at: new Date().toISOString() })
    .eq('request_id', id).eq('status', 'failed');
  if (itemError) throw new ApiError(502, 'Could not reset failed video renders', itemError.message);
  const { error } = await adminSupabase.from('advertiser_requests').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new ApiError(502, 'Could not retry advertiser rendering', error.message);
  enqueue(id);
  return getRequest(id);
}

async function renderRequest(id) {
  const { data: request, error } = await adminSupabase.from('advertiser_requests').select('*').eq('id', id).single();
  if (error || !request || !['paid', 'processing'].includes(request.status)) return;
  await adminSupabase.from('advertiser_requests').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', id);
  const { data: items, error: itemError } = await adminSupabase.from('advertiser_request_videos').select('*')
    .eq('request_id', id).in('status', ['queued', 'rendering']).order('created_at', { ascending: true });
  if (itemError) throw new Error(`Could not load advertiser video queue: ${itemError.message}`);

  const extension = path.extname(request.logo_storage_path).toLowerCase();
  const { data: logoBlob, error: logoError } = await adminSupabase.storage.from(STORAGE_BUCKET).download(request.logo_storage_path);
  if (logoError || !logoBlob) throw new Error(`Could not load brand logo: ${logoError?.message || 'file missing'}`);
  const logoBuffer = Buffer.from(await logoBlob.arrayBuffer());
  if (!logoBuffer.length || logoBuffer.length > MAX_LOGO_BYTES) throw new Error('Brand logo file is empty or too large');
  const creative = { buffer: logoBuffer, originalname: `${request.brand_name}${extension}`, mimetype: logoBlob.type || 'image/png' };
  const targeting = {
    country: request.country, state: request.state, district: request.district, city: request.city,
    latitude: request.latitude, longitude: request.longitude, radiusKm: request.radius_km, priority: 0,
  };

  for (const item of items || []) {
    await adminSupabase.from('advertiser_request_videos').update({ status: 'rendering', error: null, updated_at: new Date().toISOString() }).eq('id', item.id);
    try {
      const { data: slots, error: slotError } = await adminSupabase.from('ad_slots')
        .select('id, slot_number, rank_order, ranking_score').eq('video_id', item.video_id)
        .order('rank_order', { ascending: true, nullsFirst: false }).order('ranking_score', { ascending: false }).limit(1);
      if (slotError) throw new Error(`Could not select a billboard slot: ${slotError.message}`);
      if (!slots?.length) throw new Error('No detected billboard slot is available for this video');
      const result = await insertAd({ videoId: item.video_id, slotId: slots[0].id, creative, targeting,
        createdBy: request.owner_id, brandNameOverride: request.brand_name, advertiserRequestId: id });
      const { error: updateError } = await adminSupabase.from('advertiser_request_videos').update({
        status: 'completed', ad_result_id: result.id, error: null, updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      if (updateError) throw new Error(`Ad rendered but request status could not be saved: ${updateError.message}`);
    } catch (renderError) {
      const message = String(renderError.message || 'Ad rendering failed').slice(0, 1000);
      await adminSupabase.from('advertiser_request_videos').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', item.id);
      logger.error({ message: 'Advertiser logo insertion failed', requestId: id, videoId: item.video_id, error: message });
    }
  }

  const { data: finalItems, error: finalError } = await adminSupabase.from('advertiser_request_videos')
    .select('status').eq('request_id', id);
  if (finalError) throw new Error(`Could not summarize advertiser request: ${finalError.message}`);
  const completed = (finalItems || []).filter((item) => item.status === 'completed').length;
  const failed = (finalItems || []).filter((item) => item.status === 'failed').length;
  const status = failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed';
  await adminSupabase.from('advertiser_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  logger.info({ message: 'Advertiser logo rendering finished', requestId: id, completed, failed, status });
}

function enqueue(id) {
  if (queued.has(id)) return;
  queued.add(id);
  queue.push(id);
  setImmediate(drain);
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    queued.delete(id);
    try { await renderRequest(id); } catch (error) {
      logger.error({ message: 'Advertiser render request could not be processed', requestId: id, error: error.message });
      await adminSupabase.from('advertiser_requests').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', id);
    }
  }
  running = false;
}

async function recoverPending() {
  const { data, error } = await adminSupabase.from('advertiser_requests').select('id,status').in('status', ['paid', 'processing']);
  if (error) {
    logger.error({ message: 'Could not resume advertiser renders. Apply advertiser_orders_migration.sql.', error: error.message });
    return;
  }
  for (const request of data || []) {
    const { data: items } = await adminSupabase.from('advertiser_request_videos').select('id').eq('request_id', request.id).in('status', ['queued', 'rendering']);
    if (items?.length || request.status === 'processing') enqueue(request.id);
  }
}

module.exports = {
  getRateCard, updateRateCard, listEligibleVideos, createRequest, listOwnerRequests,
  listAdminRequests, getRequest, issueQuote, confirmPayment, rejectRequest,
  retryRequest, submitPaymentReference, enqueue, recoverPending,
};
