const axios = require('axios');
const FormData = require('form-data');

const http = axios.create({
  baseURL: process.env.CONTAINER_MANAGEMENT_URL || 'http://192.168.99.101:5000',
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

module.exports = { createProject, listProjects, getProject, deleteProject, deployProjectForm };
