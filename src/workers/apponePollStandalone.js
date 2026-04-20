const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, debug: Boolean(process.env.DEBUG_API) });

const Promise = require('bluebird');
const moment = require('moment');
const logger = require('../logger')(__filename);
const mongoose = require('../utils/mongoose');
const appOneSdk = require('../utils/appOneSdk');
const CacheModel = require('../model/cache');
const SyncStatusModel = require('../model/sync-status');
const updateHubspotDealJob = require('../jobs/updateHubspotDealJob');

const DEFAULT_POLL_MINUTES = 15;

function getPollIntervalMinutes() {
  const explicit = Number(process.env.APPONE_POLL_INTERVAL_MINUTES);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const expr = process.env.CRON_EXPRESSION_APPONE_PULL || '';
  const match = expr.match(/^\s*\*\/(\d+)\s+\*\s+\*\s+\*\s+\*\s*$/);
  if (match) {
    const minutes = Number(match[1]);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }

  if (expr) {
    logger.warn({
      message: 'Unsupported CRON_EXPRESSION_APPONE_PULL format for standalone worker',
      cron: expr,
      fallbackMinutes: DEFAULT_POLL_MINUTES,
    });
  }

  return DEFAULT_POLL_MINUTES;
}

async function getAllChangedApplications() {
  logger.info({ message: 'Starting changed appone deals worker (standalone)' });
  const skipDealerFilter =
    String(process.env.APPONE_POLL_IGNORE_DEALERID || '').toLowerCase() ===
    'true';
  const pollDealerIds = (process.env.APPONE_POLL_DEALERIDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const dealerIds = skipDealerFilter
    ? [null]
    : pollDealerIds.length
    ? pollDealerIds
    : [process.env.APPONE_DEALERID].filter(Boolean);
  const syncJobData = await SyncStatusModel.findOneAndUpdate(
    { syncType: 'poll-appone-standalone' },
    { runAt: new Date() },
    { upsert: true, new: true },
  );

  if (!dealerIds.length) {
    logger.warn({ message: 'No dealer IDs configured for polling' });
    return Promise.resolve('No dealer IDs configured for polling');
  }

  const allDeals = [];
  const listIdsToSync = [];
  const dealerCounts = [];
  for (const dealerId of dealerIds) {
    try {
      const lookbackDays = Number(process.env.APPONE_POLL_LOOKBACK_DAYS || 1);
      const forceLookback =
        String(process.env.APPONE_POLL_FORCE_LOOKBACK || '').toLowerCase() ===
        'true';
      const fallbackDate = moment().subtract(
        Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 1,
        'day',
      );
      const baseDate = forceLookback
        ? fallbackDate
        : syncJobData.successfulRunStartAt || fallbackDate;
      const appOneDealData = await appOneSdk.getApplicationFile(
        null,
        baseDate,
        dealerId,
      );
      if (!appOneDealData || Object.keys(appOneDealData).length === 0) {
        logger.info({
          message: 'received appone files (count: 0)',
          dealerId,
          skipDealerFilter,
        });
        const listResults = await appOneSdk.getApplicationList({
          appOneDealerID: dealerId,
          fromDate: baseDate,
          toDate: new Date(),
        });
        const list = Array.isArray(listResults) ? listResults : [];
        logger.info({
          message: 'GetApplicationList fallback result',
          dealerId,
          fromDate: baseDate?.toISOString ? baseDate.toISOString() : baseDate,
          toDate: new Date().toISOString(),
          count: list.length,
        });
        if (list.length > 0) {
          logger.info({
            message: 'received application list fallback',
            dealerId,
            count: list.length,
          });
          list.forEach((item) => {
            const id = item?.ID ?? item?.Id ?? item?.apponeId;
            if (id) {
              listIdsToSync.push({ id, dealerId });
            }
          });
          dealerCounts.push({ dealerId, count: list.length, source: 'list' });
        } else {
          dealerCounts.push({ dealerId, count: 0 });
        }
        continue;
      }
      let data = appOneDealData.AppOneApplicationResponse;
      data = Array.isArray(data) ? data : [data];
      data = data.filter(Boolean);
      const validDeals = data.filter(
        (deal) => deal?.ID || deal?.Id || deal?.ApplicationID,
      );
      logger.info({
        message: 'received appone files',
        dealerId,
        skipDealerFilter,
        count: validDeals.length,
      });
      if (validDeals.length && Array.isArray(validDeals)) {
        logger.info({
          message: 'Multiple records received',
          dealerId,
          appOneDealData: validDeals.map(
            (deal) => deal.ID || deal.Id || deal.ApplicationID,
          ),
        });
      }
      if (!validDeals.length) {
        logger.warn({
          message: 'No valid application IDs in response',
          dealerId,
          responseKeys: Object.keys(appOneDealData || {}),
        });
        const listResults = await appOneSdk.getApplicationList({
          appOneDealerID: dealerId,
          fromDate: baseDate,
          toDate: new Date(),
        });
        const list = Array.isArray(listResults) ? listResults : [];
        if (list.length > 0) {
          logger.info({
            message: 'received application list fallback',
            dealerId,
            count: list.length,
          });
          list.forEach((item) => {
            const id = item?.ID ?? item?.Id ?? item?.apponeId;
            if (id) {
              listIdsToSync.push({ id, dealerId });
            }
          });
          dealerCounts.push({ dealerId, count: list.length, source: 'list' });
        } else {
          dealerCounts.push({ dealerId, count: 0 });
        }
        continue;
      }
      dealerCounts.push({ dealerId, count: validDeals.length });
      allDeals.push(...validDeals);
    } catch (error) {
      logger.error({
        message: 'Error getting application file for dealer',
        dealerId,
        errorMessage: error?.message,
        status: error?.response?.status,
        responseData: error?.response?.data,
      });
      dealerCounts.push({ dealerId, count: 0, error: true });
    }
  }
  if (!allDeals.length && !listIdsToSync.length) {
    return Promise.resolve('Appone Changed deals not found');
  }

  let data = allDeals;

  await Promise.mapSeries(data, async function (apponeDeal) {
    logger.info({
      message: 'processing appone deal',
      id: apponeDeal.ID,
      status: apponeDeal.Status,
      dealerId: apponeDeal.Dealer?.AppOneID || undefined,
    });
    await CacheModel.updateOne(
      { apponeId: apponeDeal.ID },
      { apponeId: apponeDeal.ID, dealData: apponeDeal },
      { upsert: true },
    );

    await updateHubspotDealJob({
      data: {
        dealId: null,
        customerId: null,
        apponeId: apponeDeal.ID,
        dealerId: apponeDeal?.Dealer?.AppOneID,
      },
    });

    await Promise.delay(100);
  });

  await Promise.mapSeries(listIdsToSync, async function (entry) {
    await updateHubspotDealJob({
      data: {
        dealId: null,
        customerId: null,
        apponeId: entry.id,
        dealerId: entry.dealerId,
      },
    });
    await Promise.delay(100);
  });
}

let running = false;

async function runOnce() {
  if (running) {
    logger.warn({ message: 'Previous poll still running; skipping this tick' });
    return;
  }
  running = true;
  try {
    const runStartDate = new Date();
    await getAllChangedApplications();
    await SyncStatusModel.findOneAndUpdate(
      { syncType: 'poll-appone-standalone' },
      { completedAt: new Date(), isSynced: true, successfulRunStartAt: runStartDate },
      { upsert: true },
    );
  } catch (error) {
    console.error(error);
    logger.error({ error, message: 'Error processing standalone poll' });
    Sentry.captureException(error);
  } finally {
    running = false;
  }
}

async function start() {
  await mongoose.connectMongoose();
  const minutes = getPollIntervalMinutes();
  logger.info({ message: 'Standalone AppOne poll worker started', minutes });
  await runOnce();
  setInterval(runOnce, minutes * 60 * 1000);
}

start();
