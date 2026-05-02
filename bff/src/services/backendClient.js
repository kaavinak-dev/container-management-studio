const axios = require('axios');
const FormData = require('form-data');

const http = axios.create({
  baseURL: process.env.CONTAINER_MANAGEMENT_URL || 'http://127.0.0.1:5235',
});

async function createProject(name, type = 'js') {
  const { data } = await http.post('/api/projects', { projectName: name, projectType: type });
  return data; // { projectId, projectName, projectType, status }
}

async function listProjects() {
  const { data } = await http.get('/api/projects');
  return data;
}

async function getProject(projectId) {
  const { data } = await http.get(`/api/projects/${projectId}`);
  return data;
}

async function deleteProject(projectId) {
  await http.delete(`/api/projects/${projectId}`);
}

// Accepts a FormData already containing the archiver stream — no ZIP ever materialises in RAM
async function deployProjectForm(projectId, form) {
  const { data } = await http.post(`/api/projects/${projectId}/deploy`, form, {
    headers: form.getHeaders(),
  });
  return data; // { executableProjectId }
}

async function getDeploymentSteps(executableProjectId) {
  const { data } = await http.get(`/api/deployments/${executableProjectId}/steps`);
  return data; // array of DeploymentStep objects
}

async function listResources(projectId) {
  const { data } = await http.get(`/api/projects/${projectId}/resources`);
  return data;
}

async function addResource(projectId, resourceType) {
  const { data } = await http.post(`/api/projects/${projectId}/resources`, { resourceType });
  return data;
}

async function removeResource(projectId, resourceId) {
  await http.delete(`/api/projects/${projectId}/resources/${resourceId}`);
}

async function getResourceCatalog() {
  const { data } = await http.get('/api/resource-catalog');
  return data;
}

module.exports = {
  createProject, listProjects, getProject, deleteProject, deployProjectForm, getDeploymentSteps,
  listResources, addResource, removeResource, getResourceCatalog,
};
