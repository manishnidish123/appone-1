const Sentry = require('@sentry/node');
const hubspotSdk = require('../utils/hubspotSdk');
const Promise = require('bluebird');
const queueService = require('../service/queue');
const logger = require('../logger')(__filename);
const SyncStatusModel = require('../model/sync-status');
const stagesToNotSync = ['624238','56217660','11231092']
async function getDealsAndAddJob(after) {
  logger.info({
    message: 'Will fetch deals',
    after,
  });
  const { data, next } = await hubspotSdk.getDeals(after);
  logger.info({
    message: 'fetched deals',
    after,
    data: data.length,
    next,
  });
  await Promise.map(data, async function (deal) {
    logger.info({
      message: 'working on deal',
      next,
      deal,
      dealId: deal.id,
    });
    if(deal.properties && stagesToNotSync.includes('' + deal.properties.dealstage)) {
      logger.info({
        message: 'skipping from hubspot sync',
        properties: deal.properties,
        apponeId: deal.properties.appone_id,
        stage: deal.properties.dealstage
      })
      return;
    }
    if (deal.properties && deal.properties.appone_id) {
      let customerId;
      try {
        customerId =
          deal.associations.contacts.results.length > 0
            ? deal.associations.contacts.results[0].id
            : null;
      } catch (e) {
        logger.warn({
          message: 'customer missing',
          dealId: deal.id,
        });
      }
      logger.info({
        message: 'Adding to queue',
        dealId: deal.id,
      });
      await queueService.addHubspotUpdateJob(
        deal.id,
        customerId,
        deal.properties.appone_id,
      );
    } else {
      logger.info({
        message: 'Skipping deal',
        next,
        dealId: deal.id,
      });
    }
  });
  await Promise.delay(1000);
  if (next) {
    return (await getDealsAndAddJob(next)) + data.length;
  }
  return data.length;
}

module.exports = async function (job) {
  try {
    await SyncStatusModel.findOneAndUpdate(
      {
        syncType: 'poll-hubspot',
      },
      {
        runAt: new Date(),
      },
      {
        upsert: true,
      },
    );
    //7085417786
    await getDealsAndAddJob(0);
    await SyncStatusModel.findOneAndUpdate(
      {
        syncType: 'poll-hubspot',
      },
      {
        completedAt: new Date(),
        isSynced: true,
      },
      {
        upsert: true,
      },
    );
  } catch (error) {
    console.error(error);
    logger.error({
      message: 'hubspot poll error',
      error,
    });
    Sentry.captureException(error);
  }
};
