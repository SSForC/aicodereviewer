import { apiRequest } from './client.js';

export const cloneGithubRepo = (projectId, repoUrl) =>
  apiRequest('POST', '/github/clone', { project_id: projectId, repo_url: repoUrl });

