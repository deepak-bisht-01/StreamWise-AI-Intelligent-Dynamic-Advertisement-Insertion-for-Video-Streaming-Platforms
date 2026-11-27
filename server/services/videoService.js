const { adminSupabase } = require('../config/supabase');
const { ApiError } = require('../utils/ApiError');
const { createSignedMediaUrl } = require('./signedMediaService');
const {
  extractUploadInfo,
  getVideoMetadata,
  deleteVideoAssets,
  deleteRenderedAdAssets,
} = require('./cloudinaryService');
const logger = require('../utils/logger');

const VIDEOS_TABLE = 'videos';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const ADVERTISER_PRIORITY_TIERS = new Set(['standard', 'featured', 'premium']);

// Supabase error code mapping
const ERROR_CODES = {
  'PGRST116': { status: 404, message: 'Video not found' },
  'PGRST301': { status: 400, message: 'Invalid request' },
  'PGRST302': { status: 401, message: 'Unauthorized' },
  'PGRST303': { status: 403, message: 'Forbidden' },
  '23505': { status: 409, message: 'Duplicate entry' },
  '23503': { status: 400, message: 'Foreign key violation' },
  '23502': { status: 400, message: 'Not null violation' },
  '22001': { status: 400, message: 'String too long' },
  '22003': { status: 400, message: 'Numeric overflow' },
};

function throwIfError(error, fallbackMessage) {
  if (!error) {
    return;
  }

  const mappedError = ERROR_CODES[error.code];
  if (mappedError) {
    throw new ApiError(mappedError.status, mappedError.message);
  }

  if (error.code === 'PGRST116') {
    throw new ApiError(404, 'Video not found');
  }

  // Log unknown error codes for monitoring
  if (error.code) {
    logger.warn({ 
      message: 'Unknown Supabase error code', 
      code: error.code, 
      message: error.message 
    });
  }

  throw new ApiError(502, error.message || fallbackMessage);
}

async function retryOperation(operation, context = 'operation') {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.statusCode && error.statusCode < 500) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === MAX_RETRIES) {
        break;
      }
      
      // Retry on transient errors (5xx, network issues)
      const delay = RETRY_DELAY * attempt;
      logger.warn({ 
        message: `Retrying ${context}`, 
        attempt, 
        maxAttempts: MAX_RETRIES,
        delay: `${delay}ms`,
        error: error.message 
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

function serializeVideo(video, userId = null, sessionId = null) {
  if (!video) {
    throw new ApiError(404, 'Video not found');
  }

  return {
    id: video.id,
    title: video.title,
    description: video.description,
    videoUrl: video.video_url,
    thumbnailUrl: video.thumbnail_url,
    creatorName: video.creator_name || 'Legacy creator',
    duration: video.duration,
    fileSize: video.file_size,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
    analysisStatus: video.analysis_status || null,
    adReviewEnabled: video.ad_review_enabled === true,
    advertiserPriorityTier: ADVERTISER_PRIORITY_TIERS.has(video.advertiser_priority_tier) ? video.advertiser_priority_tier : 'standard',
    adResults: (Array.isArray(video.analysis_meta?.adResults) ? video.analysis_meta.adResults : []).map((ad) => ({
      ...ad,
      outputUrl: userId && sessionId ? createSignedMediaUrl('ad', video.id, ad.id, userId, sessionId) : null,
    })),
  };
}

function normalizeRegion(value) {
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

function approvedAdScore(ad, profile) {
  if (ad.approved !== true || normalizeRegion(ad.country) !== normalizeRegion(profile.country)) return null;
  const cityMatches = Boolean(ad.city) && normalizeRegion(ad.city) === normalizeRegion(profile.city);
  const districtMatches = Boolean(ad.district) && normalizeRegion(ad.district) === normalizeRegion(profile.district);
  const stateMatches = Boolean(ad.state) && normalizeRegion(ad.state) === normalizeRegion(profile.state);
  const regionMatches = (!ad.city || cityMatches) && (!ad.district || districtMatches) && (!ad.state || stateMatches);
  const hasCoordinates = ad.latitude !== null && ad.latitude !== undefined
    && ad.longitude !== null && ad.longitude !== undefined
    && Number.isFinite(Number(ad.latitude)) && Number.isFinite(Number(ad.longitude));
  let geoMatches = false;
  let geoDistance = null;

  if (hasCoordinates) {
    const viewerHasCoordinates = profile.latitude !== null && profile.latitude !== undefined
      && profile.longitude !== null && profile.longitude !== undefined
      && Number.isFinite(Number(profile.latitude)) && Number.isFinite(Number(profile.longitude));
    if (viewerHasCoordinates) {
      geoDistance = distanceKm(Number(profile.latitude), Number(profile.longitude), Number(ad.latitude), Number(ad.longitude));
      geoMatches = geoDistance <= (Number(ad.radiusKm) || 50);
    } else if (!regionMatches) {
      return null;
    }
    if (!geoMatches && (!(ad.city || ad.district || ad.state) || !regionMatches)) return null;
  } else if (!regionMatches) {
    return null;
  }

  let score = cityMatches ? 10000 : districtMatches ? 7500 : stateMatches ? 5000 : 100;
  if (geoMatches) score += 1000 + (1 - geoDistance / (Number(ad.radiusKm) || 50)) * 500;
  score += Number(ad.priority) || 0;
  return score;
}

function selectApprovedAd(video, profile) {
  const candidates = (Array.isArray(video.analysis_meta?.adResults) ? video.analysis_meta.adResults : [])
    .map((ad) => ({ ad, score: approvedAdScore(ad, profile) }))
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => right.score - left.score
      || new Date(right.ad.approvedAt || right.ad.createdAt || 0).getTime()
        - new Date(left.ad.approvedAt || left.ad.createdAt || 0).getTime());
  return candidates[0]?.ad || null;
}

function isApprovedAdForLocation(ad, profile) {
  return approvedAdScore(ad, profile) !== null;
}

function serializeViewerVideo(video, ad, profile, sessionId) {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    videoUrl: createSignedMediaUrl('ad', video.id, ad.id, profile.id, sessionId),
    thumbnailUrl: video.thumbnail_url,
    creatorName: video.creator_name || 'Legacy creator',
    duration: video.duration,
    fileSize: video.file_size,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
    approvedAd: {
      id: ad.id,
      slotNumber: ad.slotNumber,
      creativeName: ad.creativeName,
      country: ad.country,
      state: ad.state,
      district: ad.district,
      city: ad.city,
      approvedAt: ad.approvedAt,
    },
  };
}

async function listApprovedVideos(page = 1, limit = 12, profile, sessionId) {
  const validatedPage = Math.max(1, Math.min(page, 1000));
  const validatedLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await adminSupabase.from(VIDEOS_TABLE)
    .select('*').order('created_at', { ascending: false });
  throwIfError(error, 'Failed to fetch approved videos');
  const approved = (data || []).flatMap((video) => {
    const ad = selectApprovedAd(video, profile);
    return ad ? [{ video: serializeViewerVideo(video, ad, profile, sessionId), createdAt: video.created_at }] : [];
  });
  const offset = (validatedPage - 1) * validatedLimit;
  const videos = approved.slice(offset, offset + validatedLimit).map((item) => item.video);
  return {
    videos,
    pagination: {
      page: validatedPage,
      limit: validatedLimit,
      total: approved.length,
      totalPages: Math.ceil(approved.length / validatedLimit),
    },
  };
}

async function getApprovedVideoById(id, profile, sessionId) {
  if (!id || typeof id !== 'string') throw new ApiError(400, 'Invalid video ID');
  const { data: video, error } = await adminSupabase.from(VIDEOS_TABLE).select('*').eq('id', id).single();
  throwIfError(error, 'Failed to fetch video');
  const ad = selectApprovedAd(video, profile);
  if (!ad) throw new ApiError(404, 'This video has no admin-approved ad for your saved location yet');
  return serializeViewerVideo(video, ad, profile, sessionId);
}

async function getRelatedApprovedVideos(id, profile, sessionId, limit = 6) {
  const { data, error } = await adminSupabase.from(VIDEOS_TABLE)
    .select('*').neq('id', id).order('created_at', { ascending: false });
  throwIfError(error, 'Failed to fetch recommended videos');
  return (data || []).flatMap((video) => {
    const ad = selectApprovedAd(video, profile);
    return ad ? [serializeViewerVideo(video, ad, profile, sessionId)] : [];
  }).slice(0, Math.max(1, Math.min(limit, 20)));
}

async function createVideoRecord({ title, description, videoFile, thumbnailFile, uploadedBy, creatorName }) {
  const videoInfo = extractUploadInfo(videoFile, 'videos');
  const thumbnailInfo = extractUploadInfo(thumbnailFile, 'thumbnails');

  let duration = videoInfo.duration;
  let fileSize = videoInfo.bytes;

  if (!duration || !fileSize) {
    try {
      const metadata = await getVideoMetadata(videoInfo.publicId);
      duration = duration || metadata.duration;
      fileSize = fileSize || metadata.fileSize;
    } catch (metadataError) {
      logger.error({ message: 'Failed to fetch video metadata', error: metadataError.message });
      throw new ApiError(502, 'Failed to process video metadata');
    }
  }

  const now = new Date().toISOString();

  try {
    const insertOperation = async () => {
      const { data, error } = await adminSupabase
        .from(VIDEOS_TABLE)
        .insert({
          title,
          description,
          uploaded_by: uploadedBy,
          creator_name: creatorName || 'StreamWise creator',
          ad_review_enabled: false,
          video_url: videoInfo.url,
          thumbnail_url: thumbnailInfo.url,
          cloudinary_video_id: videoInfo.publicId,
          cloudinary_thumbnail_id: thumbnailInfo.publicId,
          duration,
          file_size: fileSize,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (error) {
        throwIfError(error, 'Failed to save video metadata');
      }

      return data;
    };

    const data = await retryOperation(insertOperation, 'video insert');
    return serializeVideo(data);
  } catch (insertError) {
    await deleteVideoAssets(videoInfo.publicId, thumbnailInfo.publicId);
    throw insertError;
  }
}

async function listMyVideos(userId) {
  const { data, error } = await adminSupabase.from(VIDEOS_TABLE)
    .select('id, title, description, creator_name, duration, file_size, created_at, analysis_status, ad_review_enabled, analysis_meta')
    .eq('uploaded_by', userId)
    .order('created_at', { ascending: false });
  throwIfError(error, 'Failed to fetch your video submissions');
  return {
    videos: (data || []).map((video) => ({
      id: video.id,
      title: video.title,
      description: video.description,
      creatorName: video.creator_name || 'Legacy creator',
      duration: video.duration,
      fileSize: video.file_size,
      createdAt: video.created_at,
      analysisStatus: video.analysis_status || 'pending',
      adReviewEnabled: video.ad_review_enabled === true,
      renderedVersions: Array.isArray(video.analysis_meta?.adResults) ? video.analysis_meta.adResults.length : 0,
    })),
  };
}

async function enableAdReview(id) {
  if (!id || typeof id !== 'string') throw new ApiError(400, 'Invalid video ID');
  const { data, error } = await adminSupabase.from(VIDEOS_TABLE)
    .update({ ad_review_enabled: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, ad_review_enabled, analysis_status')
    .single();
  throwIfError(error, 'Could not select video for ad review. Apply the creator review database migration.');
  return data;
}

async function setAdvertiserPriorityTier(id, priorityTier) {
  if (!ADVERTISER_PRIORITY_TIERS.has(priorityTier)) throw new ApiError(400, 'Priority tier must be standard, featured, or premium');
  const { data, error } = await adminSupabase.from(VIDEOS_TABLE)
    .update({ advertiser_priority_tier: priorityTier, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, advertiser_priority_tier')
    .single();
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    throw new ApiError(503, 'Apply server/database/advertiser_priority_payment_migration.sql before setting video pricing tiers');
  }
  throwIfError(error, 'Could not update advertiser video priority');
  return { id: data.id, advertiserPriorityTier: data.advertiser_priority_tier };
}

async function listVideos(page = 1, limit = 12, userId = null, sessionId = null) {
  // Validate pagination parameters
  const validatedPage = Math.max(1, Math.min(page, 1000)); // Prevent excessive page numbers
  const validatedLimit = Math.max(1, Math.min(limit, 100)); // Limit max items per page
  
  const offset = (validatedPage - 1) * validatedLimit;
  
  const listOperation = async () => {
    const { data, error, count } = await adminSupabase
      .from(VIDEOS_TABLE)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + validatedLimit - 1);

    throwIfError(error, 'Failed to fetch videos');
    
    return { data, count };
  };

  const { data, count } = await retryOperation(listOperation, 'video list');
  
  return {
    videos: (data || []).map((video) => serializeVideo(video, userId, sessionId)),
    pagination: {
      page: validatedPage,
      limit: validatedLimit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / validatedLimit),
    }
  };
}

async function getVideoById(id, userId = null, sessionId = null) {
  if (!id || typeof id !== 'string') {
    throw new ApiError(400, 'Invalid video ID');
  }

  const getOperation = async () => {
    const { data, error } = await adminSupabase
      .from(VIDEOS_TABLE)
      .select('*')
      .eq('id', id)
      .single();

    throwIfError(error, 'Failed to fetch video');
    return data;
  };

  const data = await retryOperation(getOperation, 'video fetch');
  return serializeVideo(data, userId, sessionId);
}

async function getRelatedVideos(id, userId = null, sessionId = null, limit = 6) {
  if (!id || typeof id !== 'string') {
    throw new ApiError(400, 'Invalid video ID');
  }

  const validatedLimit = Math.max(1, Math.min(limit, 20)); // Prevent excessive limits

  const relatedOperation = async () => {
    const { data, error } = await adminSupabase
      .from(VIDEOS_TABLE)
      .select('*')
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(validatedLimit);

    throwIfError(error, 'Failed to fetch related videos');
    return data;
  };

  const data = await retryOperation(relatedOperation, 'related videos fetch');
  return (data || []).map((video) => serializeVideo(video, userId, sessionId));
}

async function deleteVideo(id) {
  if (!id || typeof id !== 'string') {
    throw new ApiError(400, 'Invalid video ID');
  }

  const video = await getVideoById(id);
  
  try {
    await deleteVideoAssets(video.cloudinaryVideoId, video.cloudinaryThumbnailId);
    await deleteRenderedAdAssets(video.adResults);
  } catch (cloudinaryError) {
    logger.error({ message: 'Failed to delete Cloudinary assets', error: cloudinaryError.message });
    throw new ApiError(502, 'Failed to delete video assets from Cloudinary');
  }

  const deleteOperation = async () => {
    const { error } = await adminSupabase.from(VIDEOS_TABLE).delete().eq('id', id);
    throwIfError(error, 'Failed to delete video metadata');
  };

  await retryOperation(deleteOperation, 'video delete');
  return video;
}

async function getLibraryStats() {
  // Use SQL aggregates for better performance with RPC function
  const statsOperation = async () => {
    // Try to use RPC function if available, otherwise fall back to client-side aggregation
    try {
      const { data, error } = await adminSupabase.rpc('get_library_stats');
      
      if (!error && data) {
        return data;
      }
    } catch (rpcError) {
      logger.debug({ message: 'RPC function not available, using fallback', error: rpcError.message });
    }

    // Fallback to client-side aggregation
    const { data, error } = await adminSupabase
      .from(VIDEOS_TABLE)
      .select('duration, file_size', { count: 'exact', head: false });

    throwIfError(error, 'Failed to fetch library stats');

    const rows = data || [];
    const totalDuration = rows.reduce((sum, row) => sum + Number(row.duration || 0), 0);
    const totalStorage = rows.reduce((sum, row) => sum + Number(row.file_size || 0), 0);

    return {
      totalVideos: rows.length,
      totalDuration,
      totalStorage,
    };
  };

  return await retryOperation(statsOperation, 'library stats');
}

module.exports = {
  createVideoRecord,
  listMyVideos,
  enableAdReview,
  setAdvertiserPriorityTier,
  listVideos,
  listApprovedVideos,
  getVideoById,
  getApprovedVideoById,
  isApprovedAdForLocation,
  getRelatedVideos,
  getRelatedApprovedVideos,
  deleteVideo,
  getLibraryStats,
};
