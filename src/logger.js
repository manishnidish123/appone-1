const winston = require('winston');
const { transports, format } = winston;

const createLogger = (fileName) => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    ),
    defaultMeta: { service: process.env.APPLICATION_NAME, filename: fileName },
    transports: [],
  });

  //
  // If we're not in production then log to the `console` with the format:
  // `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
  //
  if (process.env.NODE_ENV !== 'production') {
    logger.add(
      new winston.transports.Console({
        format: winston.format.json(),
      }),
    );
  } else {
    logger.transports.push(
      //
      // - Write all logs with level `error` and below to `error.log`
      // - Write all logs with level `info` and below to `combined.log`
      //
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'combined.log' }),
    );
  }
  return logger;
};

module.exports = createLogger;
