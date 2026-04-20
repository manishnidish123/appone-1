require('dotenv').config();
const Sentry = require('@sentry/node');
Sentry.init({ dsn: process.env.SENTRY_DSN, debug: Boolean(process.env.DEBUG_API) });

const express = require('express');
const cors = require('cors');
const { connectMongoose } = require('../utils/mongoose');
const apiRouter = require('./api-routes');
const app = express();
const logger = require('../logger')(__filename);

const allowedDealerIdsEnv = process.env.APPONE_ALLOWED_DEALERIDS;
if (allowedDealerIdsEnv) {
  const allowedDealerIds = allowedDealerIdsEnv
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const currentDealerId = String(process.env.APPONE_DEALERID || '').trim();
  if (!currentDealerId) {
    logger.warn({
      message: 'APPONE_DEALERID is missing while APPONE_ALLOWED_DEALERIDS is set',
      allowedDealerIds,
    });
  } else if (!allowedDealerIds.includes(currentDealerId)) {
    logger.warn({
      message: 'APPONE_DEALERID is not in APPONE_ALLOWED_DEALERIDS',
      apponeDealerId: currentDealerId,
      allowedDealerIds,
    });
  }
}

const corsOriginEnv = process.env.CORS_ORIGIN;
const allowedOrigins = corsOriginEnv
  ? corsOriginEnv.split(',').map((item) => item.trim()).filter(Boolean)
  : [];
const allowAnyOrigin = !corsOriginEnv || corsOriginEnv === '*';

const corsOptions = {
  origin: (origin, callback) => {
    if (allowAnyOrigin) {
      return callback(null, true);
    }
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use('/api', apiRouter);

app.use((req, res, next) => {
  res.status(404).send('Page is not found on this server');
});

// app.use((err, req, res, next) => {
//   const { message } = err;

//   let displayMessage = message;

//   if (typeof message !== 'string') {
//       displayMessage = message.toString();
//   }
//   res.status(err.status || 500).send(`
//     <div>Error: ${displayMessage}</div>
//     <div>Code: ${err.name}</div>
//     <div>Params: ${err.params}</div>
//     <div>Stack: ${ process.env.DEBUG_API === true ? err.stack : undefined }</div>
//   `);
// });

app.listen(3008, async () => {
  await connectMongoose();
  logger.info({
    message: 'Api listening on port 3008',
  });
});
