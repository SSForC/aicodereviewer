import { apiRequest } from './client.js';

export const listProjects = () => apiRequest('GET', '/projects/');
export const createProject = (name) => apiRequest('POST', '/projects/', { name });
export const getProject = (id) => apiRequest('GET', `/projects/${id}`);
export const deleteProject = (id) => apiRequest('DELETE', `/projects/${id}`);
export const startProject = (id) => apiRequest('POST', `/projects/${id}/start`);
export const stopProject = (id) => apiRequest('POST', `/projects/${id}/stop`);

export const listFiles = (projectId, path = '/') =>
  apiRequest('GET', `/projects/${projectId}/files?path=${encodeURIComponent(path)}`);

export const readFile = (projectId, path) =>
  apiRequest('GET', `/projects/${projectId}/files/read?path=${encodeURIComponent(path)}`);

export const writeFile = (projectId, path, content) =>
  apiRequest('POST', `/projects/${projectId}/files/write`, { path, content });

export const createDirectory = (projectId, path) =>
  apiRequest('POST', `/projects/${projectId}/directories/create`, { path });

export const execCommand = (projectId, command, timeout = 30) =>
  apiRequest('POST', `/projects/${projectId}/exec`, { command, timeout });
