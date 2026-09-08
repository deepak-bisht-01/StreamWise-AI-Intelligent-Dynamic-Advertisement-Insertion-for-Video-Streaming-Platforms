const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/ApiError');
const {
  extractUploadInfo,
  getVideoMetadata,
  deleteVideoAssets,
} = require('./cloudinaryService');
const logger = require('../utils/logger');

const VIDEOS_TABLE = 'videos';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

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

function serializeVideo(video) {
  if (!video) {
    throw new ApiError(404, 'Video not found');
  }

  return {
    id: video.id,
    title: video.title,
    description: video.description,
    videoUrl: video.video_url,
    thumbnailUrl: video.thumbnail_url,
    duration: video.duration,
    fileSize: video.file_size,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
  };
}

async function createVideoRecord({ title, description, videoFile, thumbnailFile }) {
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
      const { data, error } = await supabase
        .from(VIDEOS_TABLE)
        .insert({
          title,
          description,
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

async function listVideos(page = 1, limit = 12) {
  // Validate pagination parameters
  const validatedPage = Math.max(1, Math.min(page, 1000)); // Prevent excessive page numbers
  const validatedLimit = Math.max(1, Math.min(limit, 100)); // Limit max items per page
  
  const offset = (validatedPage - 1) * validatedLimit;
  
  const listOperation = async () => {
    const { data, error, count } = await supabase
      .from(VIDEOS_TABLE)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + validatedLimit - 1);

    throwIfError(error, 'Failed to fetch videos');
    
    return { data, count };
  };

  const { data, count } = await retryOperation(listOperation, 'video list');
  
  return {
    videos: (data || []).map(serializeVideo),
    pagination: {
      page: validatedPage,
      limit: validatedLimit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / validatedLimit),
    }
  };
}

async function getVideoById(id) {
  if (!id || typeof id !== 'string') {
    throw new ApiError(400, 'Invalid video ID');
  }

  const getOperation = async () => {
    const { data, error } = await supabase
      .from(VIDEOS_TABLE)
      .select('*')
      .eq('id', id)
      .single();

    throwIfError(error, 'Failed to fetch video');
    return data;
  };

  const data = await retryOperation(getOperation, 'video fetch');
  return serializeVideo(data);
}

async function getRelatedVideos(id, limit = 6) {
  if (!id || typeof id !== 'string') {
    throw new ApiError(400, 'Invalid video ID');
  }

  const validatedLimit = Math.max(1, Math.min(limit, 20)); // Prevent excessive limits

  const relatedOperation = async () => {
    const { data, error } = await supabase
      .from(VIDEOS_TABLE)
      .select('*')
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(validatedLimit);

    throwIfError(error, 'Failed to fetch related videos');
    return data;
  };

  const data = await retryOperation(relatedOperation, 'related videos fetch');
  return (data || []).map(serializeVideo);
}

async function deleteVideo(id) {
  if (!id || typeof id !== 'string') {
    throw new ApiError(400, 'Invalid video ID');
  }

  const video = await getVideoById(id);
  
  try {
    await deleteVideoAssets(video.cloudinaryVideoId, video.cloudinaryThumbnailId);
  } catch (cloudinaryError) {
    logger.error({ message: 'Failed to delete Cloudinary assets', error: cloudinaryError.message });
    throw new ApiError(502, 'Failed to delete video assets from Cloudinary');
  }

  const deleteOperation = async () => {
    const { error } = await supabase.from(VIDEOS_TABLE).delete().eq('id', id);
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
      const { data, error } = await supabase.rpc('get_library_stats');
      
      if (!error && data) {
        return data;
      }
    } catch (rpcError) {
      logger.debug({ message: 'RPC function not available, using fallback', error: rpcError.message });
    }

    // Fallback to client-side aggregation
    const { data, error } = await supabase
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
  listVideos,
  getVideoById,
  getRelatedVideos,
  deleteVideo,
  getLibraryStats,
};
