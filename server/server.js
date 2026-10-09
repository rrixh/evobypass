'use strict';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const BypassService = require('./services/bypass');
const { services } = require('./services/catalog');
const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render's reverse proxy
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigin = process.env.CORS_ORIGIN || 'https://rrixh.pages.dev';
app.use(cors({ origin: allowedOrigin, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '16kb' }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, error: 'Too many requests. Try again later.' } });
app.use('/api/', limiter);
const started = Date.now();
const stats = { successCount: 0, failureCount: 0, serviceStats: {} };
function record(result) {
  if (result.success) { stats.successCount++; stats.serviceStats[result.service] = (stats.serviceStats[result.service] || 0) + 1; }
  else stats.failureCount++;
}
app.get('/api/health', (_req, res) => res.json({ status: 'operational', uptime: Math.floor((Date.now() - started) / 1000), timestamp: new Date().toISOString(), version: '2.0.1' }));
app.get('/api/stats', (_req, res) => {
  const total = stats.successCount + stats.failureCount;
  res.json({ success: true, stats: { total, success: stats.successCount, failure: stats.failureCount, successRate: total ? (100 * stats.successCount / total).toFixed(2) + '%' : '0%', services: stats.serviceStats, uptime: Math.floor((Date.now() - started) / 1000) } });
});
app.post('/api/bypass', async (req, res) => {
  if (typeof req.body?.url !== 'string') return res.status(400).json({ success: false, error: 'URL is required' });
  const result = await BypassService.bypass(req.body.url);
  record(result);
  res.status(result.success ? 200 : 422).json(result);
});
app.post('/api/bypass/bulk', async (req, res) => {
  const key = process.env.API_KEY;
  if (!key || req.body?.apiKey !== key) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  const urls = req.body?.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 20 || !urls.every(u => typeof u === 'string')) return res.status(400).json({ success: false, error: 'Provide 1–20 URL strings' });
  const results = [];
  for (const url of urls) { const result = await BypassService.bypass(url); record(result); results.push(result); }
  const successful = results.filter(r => r.success).length;
  res.json({ success: true, results, total: results.length, successful, failed: results.length - successful, successRate: (100 * successful / results.length).toFixed(2) + '%' });
});
app.get('/api/supported', (_req, res) => res.json({ success: true, services, total: services.length, categories: [...new Set(services.map(s => s.category))], note: 'Catalog listing does not guarantee working resolution' }));
app.get('/api/test', (_req, res) => res.json({ success: true, message: 'API is working!', timestamp: new Date().toISOString() }));
app.use((_req, res) => res.status(404).json({ success: false, error: 'Endpoint not found' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(err.status || 500).json({ success: false, error: err.status === 413 ? 'Request too large' : 'Request failed' }); });
if (require.main === module) app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
module.exports = app;
