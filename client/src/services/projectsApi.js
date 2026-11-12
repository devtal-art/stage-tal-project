import axios from 'axios';

// Same-origin /api in production (Vercel routes /api/* to the server service);
// local Vite dev talks to the Express server on :5000.
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');
const API_URL = `${API_BASE}/projects`;

// Parses the file and returns a preview (valid + invalid rows, duplicate
// flags) without persisting anything.
export const previewProjectsExcel = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post(`${API_URL}/preview`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const uploadProjectsExcel = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post(`${API_URL}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const getProjects = async () => {
  const response = await axios.get(API_URL);
  return response.data;
};
