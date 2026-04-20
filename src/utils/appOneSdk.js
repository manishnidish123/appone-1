const axios = require('axios');
const axiosTime = require('axios-time');
const logger = require('../logger')(__filename);
const { XMLParser } = require('fast-xml-parser');
const config = require('../config');
const Sentry = require('@sentry/node');
const moment = require('moment');
const ErrorModel = require('../model/error');

axiosTime(axios);

const APPONE_API_VERSION = '3.0';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function buildAppOneUrl(path) {
  const base = (config.APPONE_URL || '').replace(/\/$/, '');
  return `${base}${path}`;
}

function buildAppOneHeaders({ accept = 'text/plain', contentType } = {}) {
  const headers = {
    Accept: accept,
    version: APPONE_API_VERSION,
    'User-Agent': process.env.APPONE_USER_AGENT || DEFAULT_USER_AGENT,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

function parseXmlResponse(data) {
  if (!data || typeof data !== 'string') return null;
  const parser = new XMLParser();
  try {
    return parser.parse(data);
  } catch (error) {
    logger.error({
      message: 'Error parsing AppOne XML response',
      errorMessage: error?.message,
    });
    return null;
  }
}

function normalizeApplicationResponse(parsed) {
  if (!parsed) return null;
  if (!parsed.AppOneApplicationResponse) {
    return parsed;
  }
  const root = parsed.AppOneApplicationResponse;
  if (!root.ApplicationList) {
    return { AppOneApplicationResponse: root };
  }
  const list =
    root.ApplicationList.AppOneApplicationResponse || root.ApplicationList;
  const applications = Array.isArray(list) ? list : [list];
  return { AppOneApplicationResponse: applications };
}

function normalizeApplicationListResponse(parsed) {
  if (!parsed) return [];
  let list =
    parsed.ApplicationList ||
    parsed.AppOneApplicationResponse?.ApplicationList ||
    parsed.AppOneApplicationResponse ||
    parsed;
  if (list?.AppOneApplicationResponse) {
    list = list.AppOneApplicationResponse;
  }
  if (list?.Application) {
    list = list.Application;
  }
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}

function formatListDate(value) {
  if (!value) return undefined;
  const m = moment(value);
  if (!m.isValid()) return undefined;
  return m.utc().format('YYYY-MM-DD');
}

async function handleAppOneErrors(parsed, timings) {
  const root =
    parsed?.AppOneApplicationResponse || parsed?.AppOneResponse || parsed;
  const errorList = root?.ErrorList;
  if (!errorList) return;
  const errs = Array.isArray(errorList.Error)
    ? errorList.Error
    : errorList.Error
    ? [errorList.Error]
    : Array.isArray(errorList)
    ? errorList
    : [];
  if (!errs.length) return;

  logger.error({
    message: 'appone errors',
    errors: errs,
  });
  const eventIds = errs
    .map((err) => {
      const msg = err?.ErrorMessage || err?.Message || '';
      const match = String(msg).match(/Event ID\s+(\d+)/i);
      return match ? match[1] : null;
    })
    .filter(Boolean);
  if (eventIds.length) {
    logger.error({
      message: 'appone event ids',
      eventIds,
      errors: errs.map((e) => ({
        ErrorCategory: e?.ErrorCategory || e?.Category,
        ErrorCode: e?.ErrorCode || e?.Code,
        ErrorMessage: e?.ErrorMessage || e?.Message,
      })),
    });
  }
  await Promise.all(
    errs.map(async (err) => {
      const errorCode = err.ErrorCode || err.Code;
      const errorMessage = err.ErrorMessage || err.Message || '';
      if (errorCode === 1005 && errorMessage) {
        const messages = errorMessage.split('\n');
        const message = messages.length > 0 ? messages[0] : errorMessage;
        let appOneId = message.match(/\d+/);
        if (appOneId && appOneId.length > 0) {
          appOneId = appOneId[0];
        }
        if (appOneId && !Array.isArray(appOneId)) {
          await ErrorModel.updateOne(
            {
              apponeId: appOneId,
            },
            {
              error: messages,
            },
            {
              upsert: true,
            },
          );
        } else {
          Sentry.captureMessage(message, {
            level: Sentry.Severity.Info,
            extra: {
              ...err,
              ErrorMessage: messages,
              timings,
            },
            tags: {
              appOneId,
              reportError: true,
            },
            fingerprint: [appOneId],
          });
        }
      } else if (errorMessage) {
        Sentry.captureMessage(errorMessage, {
          tags: { appOneDown: true },
          extra: err,
          level: Sentry.Severity.Error,
        });
      }
    }),
  );
}

async function getApplicationFile(applicationId, date, dealerIdOverride) {
  const isSingle = Boolean(applicationId);
  const endpoint = isSingle
    ? '/Application/GetApplication'
    : '/Application/GetApplications';
  const dealerId =
    dealerIdOverride === undefined ? config.APPONE_DEALERID : dealerIdOverride;
  const baseParams = isSingle
    ? { applicationID: applicationId }
    : { timestamp: moment(date).subtract(1, 'day').utc().format() };
  const params =
    dealerId === null || dealerId === ''
      ? baseParams
      : { ...baseParams, appOneDealerID: dealerId };
  let data, status, headers;
  try {
    const response = await axios.post(buildAppOneUrl(endpoint), null, {
      params,
      headers: buildAppOneHeaders({ accept: 'text/plain' }),
      auth: buildBasicAuth(),
      timeout: 1 * 60 * 60 * 1000,
    });
    ({ data, status, headers } = response);
    const { timings } = response;
    logger.silly({
      message: 'Get application response',
      applicationId,
      data,
      status,
      headers,
    });
    logger.info({
      message: 'Response Time',
      timings,
    });
    let parsed = null;
    if (typeof data === 'object' && data) {
      const xmlPayload =
        data.Application ||
        data.AppOneApplicationResponse ||
        data.ApplicationXml ||
        data.application;
      if (typeof xmlPayload === 'string') {
        parsed = parseXmlResponse(xmlPayload);
      } else {
        parsed = data;
      }
    } else {
      parsed = parseXmlResponse(data);
    }
    if (isSingle && !parsed && data) {
      logger.warn({
        message: 'GetApplication returned unparsed response',
        applicationId,
        dataType: typeof data,
        sample: String(data).slice(0, 500),
      });
    }
    if (parsed) {
      logger.silly({
        message: 'parsed application response',
        applicationId,
        data: parsed,
      });
      await handleAppOneErrors(parsed, timings);
    }
    return normalizeApplicationResponse(parsed);
  } catch (error) {
    logger.error({
      message: 'Error getting application file',
      applicationId,
      data,
      status,
      headers,
      responseData: error?.response?.data,
    });
    throw error;
  }
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

function getAuthMode() {
  if (config.APPONE_BASIC_USERNAME) return 'basic_env';
  if (config.APPONE_USERNAME && config.APPONE_API_KEY) return 'username_api_key';
  if (config.APPONE_USERNAME && config.APPONE_PASSWORD) return 'username_password';
  return 'none';
}

async function addApplication(applicationDataXml) {
  try {
    const response = await axios.post(
      buildAppOneUrl('/Application/ImportApplication'),
      applicationDataXml,
      {
        headers: buildAppOneHeaders({
          accept: 'text/plain',
          contentType: 'application/xml; charset=utf-8',
        }),
        auth: buildBasicAuth(),
        timeout: 1 * 60 * 60 * 1000,
        responseType: 'text',
        validateStatus: () => true,
        maxBodyLength: Infinity,
      },
    );
    const { data, status, headers, timings } = response;
    logger.info({
      message: 'imported application',
      authMode: getAuthMode(),
      url: buildAppOneUrl('/Application/ImportApplication'),
      data,
      status,
      headers,
      timings,
    });
    if (status >= 400) {
      logger.error({
        message: 'AppOne import returned error status',
        status,
        data,
      });
    }
    if (data && typeof data === 'object') {
      // JSON response
      return data;
    }
    const parsed = parseXmlResponse(data);
    if (parsed) {
      await handleAppOneErrors(parsed, timings);
    }
    return parsed;
  } catch (error) {
    logger.error({
      message: 'Error imporing application',
      errorMessage: error?.message,
      errorCode: error?.code,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      responseHeaders: error?.response?.headers,
      responseData: error?.response?.data,
    });
  }
}

async function updateApplication(applicationId, applicationDataXml) {
  try {
    const response = await axios.post(
      buildAppOneUrl('/Application/UpdateApplication'),
      applicationDataXml,
      {
        params: {
          applicationID: applicationId,
        },
        headers: buildAppOneHeaders({
          accept: 'text/plain',
          contentType: 'application/xml; charset=utf-8',
        }),
        auth: buildBasicAuth(),
        timeout: 1 * 60 * 60 * 1000,
        responseType: 'text',
        validateStatus: () => true,
        maxBodyLength: Infinity,
      },
    );
    const { data, status, headers, timings } = response;
    logger.info({
      message: 'updated application',
      applicationId,
      data,
      status,
      headers,
      timings,
    });
    if (status >= 400) {
      logger.error({
        message: 'AppOne update returned error status',
        applicationId,
        status,
        data,
      });
    }
    const parsed = parseXmlResponse(data);
    if (parsed) {
      await handleAppOneErrors(parsed, timings);
    }
    return parsed;
  } catch (error) {
    logger.error({
      message: 'Error updating application',
      applicationId,
      errorMessage: error?.message,
      errorCode: error?.code,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      responseHeaders: error?.response?.headers,
      responseData: error?.response?.data,
    });
  }
}

async function getApplicationList({
  appOneDealerID = config.APPONE_DEALERID,
  fromDate,
  toDate,
  accept = 'application/json',
} = {}) {
  try {
    const response = await axios.get(
      buildAppOneUrl('/Application/GetApplicationList'),
      {
        params: {
          AppOneDealerID: appOneDealerID,
          FromDate: formatListDate(fromDate),
          ToDate: formatListDate(toDate),
        },
        headers: buildAppOneHeaders({ accept }),
        auth: buildBasicAuth(),
        timeout: 1 * 60 * 60 * 1000,
      },
    );
    const { data, status, headers, timings } = response;
    logger.info({
      message: 'application list response',
      status,
      headers,
      timings,
    });
    const parsed = typeof data === 'string' ? parseXmlResponse(data) : data;
    if (parsed) {
      await handleAppOneErrors(parsed, timings);
    }
    return normalizeApplicationListResponse(parsed);
  } catch (error) {
    logger.error({
      message: 'Error getting application list',
      errorMessage: error?.message,
      errorCode: error?.code,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      responseHeaders: error?.response?.headers,
      responseData: error?.response?.data,
    });
  }
}

async function getDefaultProductsFeesTaxes(
  appOneDealerID = config.APPONE_DEALERID,
) {
  try {
    const response = await axios.get(
      buildAppOneUrl('/Dealer/GetDefaultProductsFeesAndTaxes'),
      {
        params: { appOneDealerID },
        headers: buildAppOneHeaders({ accept: 'text/plain' }),
        auth: buildBasicAuth(),
        timeout: 1 * 60 * 60 * 1000,
      },
    );
    const { data, status, headers, timings } = response;
    logger.info({
      message: 'default products/fees/taxes response',
      status,
      headers,
      timings,
    });
    return data;
  } catch (error) {
    logger.error({
      message: 'Error getting default products/fees/taxes',
      errorMessage: error?.message,
      errorCode: error?.code,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      responseHeaders: error?.response?.headers,
      responseData: error?.response?.data,
    });
  }
}

async function getApplicationEFile(fileId, applicationId) {
  try {
    const response = await axios.get(
      buildAppOneUrl('/Application/GetApplicationEFile'),
      {
        params: {
          fileID: fileId,
          applicationID: applicationId,
        },
        headers: buildAppOneHeaders({ accept: 'text/plain' }),
        auth: buildBasicAuth(),
        timeout: 1 * 60 * 60 * 1000,
      },
    );
    const { data, status, headers, timings } = response;
    logger.info({
      message: 'application efile response',
      applicationId,
      fileId,
      status,
      headers,
      timings,
    });
    return data;
  } catch (error) {
    logger.error({
      message: 'Error getting application efile',
      applicationId,
      fileId,
      errorMessage: error?.message,
      errorCode: error?.code,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      responseHeaders: error?.response?.headers,
      responseData: error?.response?.data,
    });
  }
}

module.exports = {
  getApplicationFile,
  addApplication,
  updateApplication,
  getApplicationList,
  getDefaultProductsFeesTaxes,
  getApplicationEFile,
};
