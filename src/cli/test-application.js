require('dotenv').config();
const axios = require('axios');
const config = require('../config');
const logger = require('../logger')(__filename);

const APPONE_API_VERSION = '3.0';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function buildAppOneUrl(path) {
  const base = (config.APPONE_URL || '').replace(/\/$/, '');
  return `${base}${path}`;
}

function buildAppOneHeaders({ accept = 'application/json' } = {}) {
  return {
    Accept: accept,
    version: APPONE_API_VERSION,
    'User-Agent': process.env.APPONE_USER_AGENT || DEFAULT_USER_AGENT,
  };
}

function buildBasicAuth() {
  if (config.APPONE_BASIC_USERNAME) {
    return {
      username: config.APPONE_BASIC_USERNAME,
      password: config.APPONE_BASIC_PASSWORD || '',
    };
  }
  if (config.APPONE_USERNAME && config.APPONE_API_KEY) {
    return {
      username: config.APPONE_USERNAME,
      password: config.APPONE_API_KEY,
    };
  }
  const username = config.APPONE_USERNAME || '';
  const password = config.APPONE_PASSWORD || '';
  if (!username) return undefined;
  return { username, password };
}

async function run() {
  const appId = process.argv[2];
  const dealerId = process.argv[3] || config.APPONE_DEALERID;
  if (!appId) {
    throw new Error('Usage: node src/cli/test-application.js <applicationId> [dealerId]');
  }

  logger.info({
    message: 'Testing GetApplication',
    appId,
    dealerId,
  });

  const response = await axios.post(
    buildAppOneUrl('/Application/GetApplication'),
    null,
    {
      params: {
        applicationID: appId,
        appOneDealerID: dealerId,
      },
      headers: buildAppOneHeaders({ accept: 'application/json' }),
      auth: buildBasicAuth(),
      timeout: 60 * 1000,
    },
  );

  const { data, status, headers } = response;
  const sample =
    typeof data === 'string' ? data.slice(0, 2000) : JSON.stringify(data).slice(0, 2000);

  logger.info({
    message: 'GetApplication raw response',
    status,
    contentType: headers['content-type'],
    sample,
  });
}

run().catch((error) => {
  logger.error({
    message: 'GetApplication test failed',
    status: error?.response?.status,
    responseData: error?.response?.data,
    errorMessage: error?.message,
  });
  process.exit(1);
});
