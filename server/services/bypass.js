'use strict';
const axios = require('axios');
const net = require('node:net');
const { detectService: detectCatalogService } = require('./catalog');

const PROVIDERS = ['https://api.bypass.vip/bypass'];
const SUPPORTED_HOSTS = {
  Linkvertise: ['linkvertise.com', 'linkvertise.net'],
  Lootlabs: ['lootlabs.gg', 'loot-labs.com'],
  'Work.ink': ['work.ink'],
  Rekonise: ['rekonise.com'],
  Platoboost: ['platoboost.com']
};
function hostMatches(host, domain) { return host === domain || host.endsWith('.' + domain); }
function parsePublicUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host) || !host.includes('.')) return null;
  // Requests only go to fixed provider hosts; destination URLs are returned, never fetched.
  return url;
}
function serviceFor(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  for (const [name, hosts] of Object.entries(SUPPORTED_HOSTS)) {
    if (hosts.some(domain => hostMatches(host, domain))) return name;
  }
  return null;
}
function extractProviderDestination(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  // Only accept explicit, top-level provider result fields. Never scrape page HTML.
  for (const key of ['destination', 'result']) {
    if (typeof data[key] === 'string') return data[key];
  }
  return null;
}
class BypassService {
  static isValidUrl(value) { return Boolean(parsePublicUrl(value)); }
  static detectService(value) {
    const parsed = parsePublicUrl(value);
    return parsed ? (serviceFor(parsed) || 'Unsupported') : 'Unknown';
  }
  static async bypass(value) {
    const started = Date.now();
    const parsed = parsePublicUrl(value);
    if (!parsed) return { success: false, service: 'Unknown', error: 'Invalid public HTTP/HTTPS URL', processingTime: Date.now() - started };
    const service = serviceFor(parsed);
    if (!service) return { success: false, service: 'Unsupported', error: 'This link service is not supported by the verified resolver', processingTime: Date.now() - started };
    for (const provider of PROVIDERS) {
      try {
        const response = await axios.post(provider, { url: parsed.href }, {
          timeout: 10000, maxRedirects: 0, maxContentLength: 100000,
          headers: { 'Content-Type': 'application/json' },
          validateStatus: status => status >= 200 && status < 300
        });
        const raw = extractProviderDestination(response.data);
        const destination = parsePublicUrl(raw);
        if (!destination || destination.href === parsed.href) continue;
        // A provider result is not proof of correctness; do not fetch destination URLs.
        return { success: true, service, destination: destination.href, verification: 'provider-reported', processingTime: Date.now() - started };
      } catch { /* provider unavailable; report failure below */ }
    }
    return { success: false, service, error: 'No valid destination returned by the resolver', processingTime: Date.now() - started };
  }
}
module.exports = BypassService;
