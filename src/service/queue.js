const Queue = require('bull');
const config = require('../config');
const isQueueEnabled =
  Boolean(config.REDIS_URI) &&
  String(process.env.REDIS_DISABLED || '').toLowerCase() !== 'true';
const options = {
  defaultJobOptions: {
    attempts: 1,
    backoff: 5000,
    removeOnComplete: true,
    removeOnFailure: true,
  },
  redis: {
    // Avoid failing requests after the default retry cap (20) when Redis is slow/unreachable.
    // This keeps queue operations retrying instead of throwing MaxRetriesPerRequestError.
    maxRetriesPerRequest: null,
  },
};

function makeDisabledQueue(name) {
  return {
    name,
    disabled: true,
    client: { status: 'disabled' },
    on() {},
    process() {},
    isReady: async () => false,
    isPaused: async () => false,
    getWaitingCount: async () => 0,
    getActiveCount: async () => 0,
    getDelayedCount: async () => 0,
    getFailedCount: async () => 0,
    getCompletedCount: async () => 0,
    add: async () => {},
  };
}

const pullApponeQueue = isQueueEnabled
  ? new Queue('appone_pull', config.REDIS_URI, options)
  : makeDisabledQueue('appone_pull');
const pullHubspotQueue = isQueueEnabled
  ? new Queue('hubspot_pull', config.REDIS_URI, options)
  : makeDisabledQueue('hubspot_pull');
const updateHubspotQueue = isQueueEnabled
  ? new Queue('hubspot_update', config.REDIS_URI, options)
  : makeDisabledQueue('hubspot_update');

function attachQueueLogging(queue, name) {
  if (!isQueueEnabled || queue.disabled) return;
  queue.on('error', (error) => {
    // Avoid noisy stack traces while still surfacing the root cause.
    console.error(`[queue:${name}] redis error`, {
      message: error?.message,
      name: error?.name,
      code: error?.code,
    });
  });
  queue.on('stalled', (jobId) => {
    console.warn(`[queue:${name}] job stalled`, { jobId });
  });
}

attachQueueLogging(pullApponeQueue, 'appone_pull');
attachQueueLogging(pullHubspotQueue, 'hubspot_pull');
attachQueueLogging(updateHubspotQueue, 'hubspot_update');

async function addHubspotPullCronJob() {
  if (!isQueueEnabled) {
    console.warn('[queue] Redis disabled; skipping hubspot pull cron job');
    return null;
  }
  await pullHubspotQueue.add({});
  return pullHubspotQueue.add(
    {},
    { repeat: { cron: config.CRON_EXPRESSION_HUBSPOT_PULL } },
  );
}

async function addAppOnePullCronJob() {
  if (!isQueueEnabled) {
    console.warn('[queue] Redis disabled; skipping appone pull cron job');
    return null;
  }
  await pullApponeQueue.add({});
  return pullApponeQueue.add(
    {},
    { repeat: { cron: config.CRON_EXPRESSION_APPONE_PULL } },
  );
}

async function addHubspotUpdateJob(
  dealId,
  customerId,
  apponeId,
  isAppOneJob,
  dealerId,
) {
  if (!isQueueEnabled) {
    try {
      const updateHubspotDealJob = require('../jobs/updateHubspotDealJob');
      await updateHubspotDealJob({
        data: { dealId, customerId, apponeId, isAppOneJob, dealerId },
      });
    } catch (error) {
      console.error('[queue] Redis disabled; direct hubspot update failed', {
        message: error?.message,
        name: error?.name,
      });
      throw error;
    }
    return;
  }
  await updateHubspotQueue.add(
    {
      dealId,
      customerId,
      apponeId,
      isAppOneJob,
      dealerId,
    },
    { priority: isAppOneJob ? 2 : 1 },
  );
}

module.exports = {
  isQueueEnabled,
  addHubspotPullCronJob,
  pullHubspotQueue,
  addHubspotUpdateJob,
  updateHubspotQueue,
  addAppOnePullCronJob,
  pullApponeQueue,
};
