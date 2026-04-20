const Sentry = require('@sentry/node');

const appOneSdk = require('../utils/appOneSdk');
const Promise = require('bluebird');
const queueService = require('../service/queue');
const logger = require('../logger')(__filename);
const SyncStatusModel = require('../model/sync-status');
const { setTimeout } = require('timers/promises');
const CacheModel = require('../model/cache');
const moment = require('moment');

async function getAllChangedApplications() {
  logger.info({
    message: 'Starting changed appone deals worker',
  });
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
    {
      syncType: 'poll-appone',
    },
    {
      runAt: new Date(),
    },
    {
      upsert: true,
      new: true,
    },
  );
  if (!dealerIds.length) {
    logger.warn({ message: 'No dealer IDs configured for polling' });
    return Promise.resolve('No dealer IDs configured for polling');
  }

  const allDeals = [];
  const listIdsToSync = [];
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
        }
        continue;
      }
      allDeals.push(...validDeals);
    } catch (error) {
      logger.error({
        message: 'Error getting application file for dealer',
        dealerId,
        errorMessage: error?.message,
        status: error?.response?.status,
        responseData: error?.response?.data,
      });
    }
  }
  if (!allDeals.length && !listIdsToSync.length) {
    return Promise.resolve('Appone Changed deals not found');
  }
  var data = allDeals;
  const hubspotSyncStatus = await SyncStatusModel.find({
    syncType: 'poll-hubspot',
  });
  const isHubspotSyncComplete =
    hubspotSyncStatus && hubspotSyncStatus.isSynced ? true : false;
  if (!isHubspotSyncComplete) {
    logger.warn({
      message:
        'Hubspot sync havent yet completed will only sync the existing mapped deals',
      isHubspotSyncComplete,
    });
  }
  await Promise.mapSeries(data, async function (apponeDeal) {
    logger.info({
      message: 'adding to queue',
      id: apponeDeal.ID,
    });
    await CacheModel.updateOne(
      {
        apponeId: apponeDeal.ID,
      },
      {
        apponeId: apponeDeal.ID,
        dealData: apponeDeal,
      },
      {
        upsert: true,
      },
    );
    await queueService.addHubspotUpdateJob(
      null,
      null,
      apponeDeal.ID,
      true,
      apponeDeal?.Dealer?.AppOneID,
    );
    await Promise.delay(100);
  });

  await Promise.mapSeries(listIdsToSync, async function (entry) {
    await queueService.addHubspotUpdateJob(
      null,
      null,
      entry.id,
      true,
      entry.dealerId,
    );
    await Promise.delay(100);
  });
}

async function waitForHubspotSyncToComplete() {
  while (true) {
    const jobsCount = await queueService.updateHubspotQueue.getWaitingCount();
    const activeJobsCount =
      await queueService.updateHubspotQueue.getActiveCount();
    logger.info({
      message: 'queue coumts',
      jobsCount,
      activeJobsCount,
    });
    if (jobsCount + activeJobsCount > 1) {
      logger.info({
        message: 'waiting for hubspot sync to finish',
      });
      await setTimeout(5 * 60 * 1000);
    } else {
      break;
    }
  }
}

module.exports = async function (job) {
  try {
    await waitForHubspotSyncToComplete();
    const runStartDate = new Date();
    await getAllChangedApplications();
    await SyncStatusModel.findOneAndUpdate(
      {
        syncType: 'poll-appone',
      },
      {
        completedAt: new Date(),
        isSynced: true,
        successfulRunStartAt: runStartDate,
      },
      {
        upsert: true,
      },
    );
  } catch (error) {
    console.error(error);
    logger.error({
      error,
      message: 'Error processing job',
    });
    Sentry.captureException(error);
  }
  return Promise.resolve();
};
