const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, debug: Boolean(process.env.DEBUG_API) });

const queueService = require('../service/queue');
const logger = require('../logger')(__filename);
const mongoose = require('../utils/mongoose');
const queue = queueService.pullApponeQueue;

logger.info('Starting worker');

queue.on('active', async (job) => {
  logger.info({
    message: 'Started processing job',
    job: job.data,
  });
});

queue.on('completed', async (job, result) => {
  logger.info({
    message: 'Finished processing job',
    job: job.data,
    result,
  });
});

queue.on('failed', async (job, err) => {
  logger.error({
    message: 'Error processing job',
    err,
    job: job.data,
    maxAttempts: job.opts.attempts,
    currentAttempt: job.attemptsMade,
  });
});

async function start() {
  await mongoose.connectMongoose();
  queue.process(require('./pollApponeJob'));
}

start();
