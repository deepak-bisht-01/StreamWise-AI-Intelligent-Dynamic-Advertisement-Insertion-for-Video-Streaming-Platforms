import axios from 'axios';
import { API_BASE_URL } from '../config.js';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000,
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

export function getErrorMessage(error) {
  return error.response?.data?.message || error.message || 'Something went wrong';
}
