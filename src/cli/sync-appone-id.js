const queueService = require('../service/queue');
const argv = process.argv;

(async () => {
  if (argv.length < 3) {
    console.error('Please pass apponeId');
  }
  console.log('Adding' + argv[2] + 'to queue');
  await queueService.addHubspotUpdateJob(null, null, argv[2], true);
  process.exit(0);
})();
