const queueService = require('./service/queue');
const { setTimeout } = require('timers/promises');

(async () => {
  await queueService.addHubspotPullCronJob();
  // await setTimeout(15 * 60 * 1000);
  await queueService.addAppOnePullCronJob();
  process.exit(0);
})();
