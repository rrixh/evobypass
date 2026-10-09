
'use strict';

const axios = require('axios');
const net = require('node:net');

const PROVIDERS = ['https://api.bypass.vip/bypass'];

const SUPPORTED_HOSTS = {
  Linkvertise: ['linkvertise.com', 'linkvertise.net'],
  Lootlabs: ['lootlabs.gg', 'loot-labs.com'],
  'Work.ink': ['work.ink'],
  Rekonise: ['rekonise.com'],
  Platoboost: ['platoboost.com']
};

function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function parsePublicUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) {
    return null;
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    net.isIP(host) ||
    !host.includes('.')
  ) {
    return null;
  }

  return url;
}

function serviceFor(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  for (const [name, hosts] of Object.entries(SUPPORTED_HOSTS)) {
    if (hosts.some(domain => hostMatches(host, domain))) {
      return name;
    }
  }

  return null;
}

function extractProviderDestination(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  for (const key of ['destination', 'result']) {
    if (typeof data[key] === 'string') {
      return data[key];
    }
  }

  return null;
}

class BypassService {
  static isValidUrl(value) {
    return Boolean(parsePublicUrl(value));
  }

  static detectService(value) {
    const parsed = parsePublicUrl(value);

    return parsed
      ? (serviceFor(parsed) || 'Unsupported')
      : 'Unknown';
  }

  static async bypass(value) {
    const started = Date.now();
    const parsed = parsePublicUrl(value);

    if (!parsed) {
      return {
        success: false,
        service: 'Unknown',
        error: 'Invalid public HTTP/HTTPS URL',
        processingTime: Date.now() - started
      };
    }

    const service = serviceFor(parsed);

    if (!service) {
      return {
        success: false,
        service: 'Unsupported',
        error: 'This link service is not supported by the verified resolver',
        processingTime: Date.now() - started
      };
    }

    console.log('[RESOLVER] Starting:', service);

    for (const provider of PROVIDERS) {
      try {
        console.log('[RESOLVER] Contacting:', provider);

        const response = await axios.post(
          provider,
          { url: parsed.href },
          {
            timeout: 10000,
            maxRedirects: 0,
            maxContentLength: 100000,
            headers: {
              'Content-Type': 'application/json'
            },
            validateStatus: status =>
              status >= 200 && status < 300
          }
        );

        console.log('[RESOLVER] HTTP status:', response.status);

        const raw = extractProviderDestination(response.data);
        const destination = parsePublicUrl(raw);

        if (!destination || destination.href === parsed.href) {
          console.warn('[RESOLVER] Invalid destination:', {
            provider,
            responseKeys:
              response.data &&
              typeof response.data === 'object'
                ? Object.keys(response.data).slice(0, 20)
                : [],
            reason: !raw
              ? 'Missing destination or result field'
              : 'Invalid or unchanged destination'
          });

          continue;
        }

        console.log('[RESOLVER] Valid destination format received');

        return {
          success: true,
          service,
          destination: destination.href,
          verification: 'provider-reported',
          processingTime: Date.now() - started
        };

      } catch (error) {
        console.error('[RESOLVER ERROR]', {
          provider,
          status: error.response?.status ?? null,
          message: error.message,
          response: JSON.stringify(
            error.response?.data ?? {}
          ).slice(0, 500)
        });
      }
    }

    console.error('[RESOLVER] All providers failed:', service);

    return {
      success: false,
      service,
      error: 'No valid destination returned by the resolver',
      processingTime: Date.now() - started
    };
  }
}

module.exports = BypassService;
