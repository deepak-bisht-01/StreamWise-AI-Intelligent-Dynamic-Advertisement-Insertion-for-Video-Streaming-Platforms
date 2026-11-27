import axios from 'axios';
import { API_BASE_URL } from '../config.js';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000,
});

export const SESSION_STORAGE_KEY = 'streamwise-auth-session';

export function readStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const session = readStoredSession();
  if (session?.access_token) config.headers.Authorization = `Bearer ${session.access_token}`;
  return config;
});

function unwrap(response) {
  return response.data.data;
}

export async function fetchVideos(page = 1, limit = 12) {
  const response = await api.get('/videos', { params: { page, limit } });
  const data = unwrap(response);
  // Handle both old array format and new pagination format
  if (Array.isArray(data)) {
    return { videos: data, pagination: null };
  }
  return data;
}

export async function fetchStats() {
  const response = await api.get('/videos/stats');
  return unwrap(response);
}

export async function fetchVideo(id) {
  const response = await api.get(`/videos/${id}`);
  return unwrap(response);
}

export async function deleteVideo(id) {
  const response = await api.delete(`/videos/${id}`);
  return unwrap(response);
}

export async function uploadVideo({ title, description, video, thumbnail, onProgress }) {
  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', description);
  formData.append('video', video);
  formData.append('thumbnail', thumbnail);

  const response = await api.post('/videos/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) {
        return;
      }
      const percent = Math.round((event.loaded * 100) / event.total);
      onProgress(percent);
    },
  });

  return unwrap(response);
}

export async function processVideoWithAI(payload) {
  const response = await api.post('/ai/process', payload);
  return unwrap(response);
}

export async function fetchPersonalizedAd(videoId) {
  const response = await api.get(`/videos/${videoId}/personalized-ad`, { timeout: 60 * 60 * 1000 });
  return unwrap(response);
}

export function getErrorMessage(error) {
  const message = error.response?.data?.message || error.message || 'Something went wrong';
  const details = error.response?.data?.data;
  if (details?.code && details?.message) return `${message} (${details.code}: ${details.message})`;
  const diagnostic = typeof details === 'string'
    ? details
    : details?.stderr || details?.stdoutTail || details?.parseError || details?.message;
  if (diagnostic) return `${message}: ${String(diagnostic).trim().slice(-1200)}`;
  return message;
}

export default api;
