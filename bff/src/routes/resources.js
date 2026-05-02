const { Router } = require('express');
const axios = require('axios');

const BACKEND_URL = process.env.CONTAINER_MANAGEMENT_URL || 'http://127.0.0.1:5235';

const router = Router();

// GET /resource-catalog
router.get('/catalog/all', async (_req, res) => {
  try {
    const { data } = await axios.get(`${BACKEND_URL}/api/resource-catalog`);
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    const detail = err.response?.data || { error: err.message };
    return res.status(status).json(detail);
  }
});

// POST /resources  { projectId, resourceType }
router.post('/', async (req, res) => {
  const { projectId, resourceType } = req.body;
  if (!projectId || !resourceType) {
    return res.status(400).json({ error: 'projectId and resourceType are required' });
  }

  try {
    const { data } = await axios.post(
      `${BACKEND_URL}/api/projects/${projectId}/resources`,
      { resourceType }
    );
    return res.status(201).json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    const detail = err.response?.data || { error: err.message };
    return res.status(status).json(detail);
  }
});

// GET /resources/:projectId
router.get('/:projectId', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${BACKEND_URL}/api/projects/${req.params.projectId}/resources`
    );
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    const detail = err.response?.data || { error: err.message };
    return res.status(status).json(detail);
  }
});

// GET /resources/:projectId/:resourceId
router.get('/:projectId/:resourceId', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${BACKEND_URL}/api/projects/${req.params.projectId}/resources/${req.params.resourceId}`
    );
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    const detail = err.response?.data || { error: err.message };
    return res.status(status).json(detail);
  }
});

// DELETE /resources/:projectId/:resourceId
router.delete('/:projectId/:resourceId', async (req, res) => {
  try {
    await axios.delete(
      `${BACKEND_URL}/api/projects/${req.params.projectId}/resources/${req.params.resourceId}`
    );
    return res.sendStatus(204);
  } catch (err) {
    const status = err.response?.status || 502;
    const detail = err.response?.data || { error: err.message };
    return res.status(status).json(detail);
  }
});

module.exports = { router };
