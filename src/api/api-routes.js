const express = require('express');
const { NotFoundError, isCustomError, ValidationError } = require('./exceptions');
const applicationValidation = require('./validations/applicationValidation');
const { joiValidateMiddleware } = require('./joiValidateMiddleware');
const logger = require('../logger')(__filename);
const ejs = require('ejs');
const path = require('path');
const apponeSdk = require('../utils/appOneSdk');
const hubspotSdk = require('../utils/hubspotSdk');
const MappingModel = require('../model/mappings');
const ErrorModel = require('../model/error');
const queueService = require('../service/queue');
const router = express.Router();

router.use(express.json());

function normalizeMonthsYears(target) {
  if (!target) return;
  const months = Number(target.months);
  if (!Number.isFinite(months) || months <= 11) return;
  const years = Number.isFinite(Number(target.years)) ? Number(target.years) : 0;
  const totalMonths = years * 12 + months;
  target.years = Math.floor(totalMonths / 12);
  target.months = totalMonths % 12;
}

function truncateString(value, max) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
}

function normalizeBorrowerStrings(borrower) {
  if (!borrower) return;
  borrower.firstName = truncateString(borrower.firstName, 20);
  borrower.middleName = truncateString(borrower.middleName, 20);
  borrower.lastName = truncateString(borrower.lastName, 20);
  borrower.driverLicenceNumber = truncateString(borrower.driverLicenceNumber, 30);
  borrower.email = truncateString(borrower.email, 100);

  if (borrower.currentResidence) {
    borrower.currentResidence.street = truncateString(
      borrower.currentResidence.street,
      20,
    );
    borrower.currentResidence.streetAddress = truncateString(
      borrower.currentResidence.streetAddress,
      100,
    );
    borrower.currentResidence.city = truncateString(
      borrower.currentResidence.city,
      50,
    );
    borrower.currentResidence.country = truncateString(
      borrower.currentResidence.country,
      50,
    );
    borrower.currentResidence.landlordName = truncateString(
      borrower.currentResidence.landlordName,
      50,
    );
    if (borrower.currentResidence.mailingAddress) {
      borrower.currentResidence.mailingAddress.address = truncateString(
        borrower.currentResidence.mailingAddress.address,
        100,
      );
      borrower.currentResidence.mailingAddress.city = truncateString(
        borrower.currentResidence.mailingAddress.city,
        50,
      );
      borrower.currentResidence.mailingAddress.country = truncateString(
        borrower.currentResidence.mailingAddress.country,
        50,
      );
    }
  }

  if (borrower.previousResidence) {
    borrower.previousResidence.address = truncateString(
      borrower.previousResidence.address,
      20,
    );
    borrower.previousResidence.address2 = truncateString(
      borrower.previousResidence.address2,
      100,
    );
    borrower.previousResidence.city = truncateString(
      borrower.previousResidence.city,
      50,
    );
    borrower.previousResidence.country = truncateString(
      borrower.previousResidence.country,
      50,
    );
  }

  if (borrower.currentEmployment) {
    borrower.currentEmployment.occupation = truncateString(
      borrower.currentEmployment.occupation,
      50,
    );
    borrower.currentEmployment.employerName = truncateString(
      borrower.currentEmployment.employerName,
      50,
    );
    borrower.currentEmployment.address = truncateString(
      borrower.currentEmployment.address,
      100,
    );
    borrower.currentEmployment.city = truncateString(
      borrower.currentEmployment.city,
      50,
    );
  }

  if (borrower.secondEmployment) {
    borrower.secondEmployment.occupation = truncateString(
      borrower.secondEmployment.occupation,
      50,
    );
    borrower.secondEmployment.employerName = truncateString(
      borrower.secondEmployment.employerName,
      50,
    );
    borrower.secondEmployment.address = truncateString(
      borrower.secondEmployment.address,
      100,
    );
    borrower.secondEmployment.city = truncateString(
      borrower.secondEmployment.city,
      50,
    );
  }

  if (borrower.previousEmployment) {
    borrower.previousEmployment.occupation = truncateString(
      borrower.previousEmployment.occupation,
      50,
    );
    borrower.previousEmployment.employerName = truncateString(
      borrower.previousEmployment.employerName,
      50,
    );
    borrower.previousEmployment.address = truncateString(
      borrower.previousEmployment.address,
      100,
    );
    borrower.previousEmployment.city = truncateString(
      borrower.previousEmployment.city,
      50,
    );
  }
}

function normalizeApplicationPayload(req, res, next) {
  try {
    const payload = req.body;
    const borrowers = Array.isArray(payload?.borrowers) ? payload.borrowers : [];
    borrowers.forEach((borrower) => {
      normalizeBorrowerStrings(borrower);
      normalizeMonthsYears(borrower?.currentResidence);
      normalizeMonthsYears(borrower?.previousResidence);
      normalizeMonthsYears(borrower?.currentEmployment);
      normalizeMonthsYears(borrower?.secondEmployment);
      normalizeMonthsYears(borrower?.previousEmployment);
    });
    if (payload?.hasTradeIn && payload.tradein) {
      const allowance = Number(payload.tradein.tradeInAllowance);
      if (!Number.isFinite(allowance) || allowance <= 0) {
        payload.hasTradeIn = false;
        delete payload.tradein;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

function enforceAllowedDealerId(req, res, next) {
  try {
    const allowed = process.env.APPONE_ALLOWED_DEALERIDS;
    if (!allowed) return next();
    const allowedIds = allowed
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!allowedIds.length) return next();
    const currentId = String(process.env.APPONE_DEALERID || '').trim();
    if (!currentId || !allowedIds.includes(currentId)) {
      throw new ValidationError({
        apponeDealerId: `APPONE_DEALERID ${currentId || '(missing)'} is not in APPONE_ALLOWED_DEALERIDS`,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}

function extractAppOneApplicationId(apponeResponse) {
  const rawId =
    apponeResponse?.AppOneResponse?.AppOneApplicationID ??
    apponeResponse?.AppOneResponse?.AppOneApplicationId ??
    apponeResponse?.AppOneApplicationResponse?.AppOneApplicationID ??
    apponeResponse?.AppOneApplicationID ??
    apponeResponse?.AppOneApplicationId ??
    apponeResponse?.data?.AppOneApplicationID ??
    apponeResponse?.data?.AppOneApplicationId;
  const apponeId = Number(rawId);
  if (!Number.isFinite(apponeId) || apponeId <= 0) return null;
  return apponeId;
}

async function processApplication(payload) {
  const template = await ejs.renderFile(
    path.join(__dirname, '..', 'templates', 'import-application.ejs'),
    { data: payload, env: process.env },
    { async: true },
  );
  logger.info({
    message: 'template rendered',
    template,
  });
  const apponeResponse = await apponeSdk.addApplication(template);
  logger.info({
    message: 'appone import response',
    apponeResponse,
  });
  if (!apponeResponse) {
    throw new Error('AppOne import failed: empty response');
  }
  const apponeId = extractAppOneApplicationId(apponeResponse);
  if (!apponeId) {
    logger.error({
      message: 'AppOne import missing application ID',
      apponeResponse,
    });
    return;
  }
  try {
    const borrowers = Array.isArray(payload.borrowers)
      ? payload.borrowers
      : [];
    const borrower = borrowers[0];
    if (borrower && borrower.email) {
      const contactId = await hubspotSdk.upsertContact({
        email: borrower.email,
        firstname: borrower.firstName,
        lastname: borrower.lastName,
        phone: borrower.cellPhone || borrower.homePhone || '',
        mobilephone: borrower.cellPhone || borrower.homePhone || '',
        appone_dealer_id: process.env.APPONE_DEALERID,
        source_appone: 'Marathon Xpress',
      });
      const existingMapping = await MappingModel.findOne({
        apponeId: '' + apponeId,
      });
      let dealId = existingMapping?.hubspotDealId;
      if (!dealId) {
        const dealObj = {
          dealname: borrower.firstName + ' ' + borrower.lastName,
          appone_id: apponeId,
          appone_dealer_id: process.env.APPONE_DEALERID,
          source_appone: 'Marathon Xpress',
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
          sync_deal:
            'http://ec2-50-112-210-243.us-west-2.compute.amazonaws.com/api/appone/sync-deal?apponeId=' +
            apponeId,
        };
        const response = await hubspotSdk.createDeal(dealObj);
        dealId = response.id;
      }
      if (dealId && contactId) {
        await hubspotSdk.associateDealAndContact(dealId, contactId);
      }
      await MappingModel.findOneAndUpdate(
        {
          apponeId: '' + apponeId,
        },
        {
          apponeId: '' + apponeId,
          hubspotDealId: dealId,
          contactId,
          runAt: new Date(),
        },
        {
          upsert: true,
          new: true,
        },
      );
      await queueService.addHubspotUpdateJob(dealId, contactId, apponeId, true);
    } else {
      await queueService.addHubspotUpdateJob(null, null, apponeId, true);
    }
  } catch (error) {
    logger.error({
      message: 'Error creating hubspot deal after appone import',
      errorMessage: error?.message,
      errorName: error?.name,
      errorCode: error?.code,
      errorStack: error?.stack,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      responseData: error?.response?.data,
      responseHeaders: error?.response?.headers,
      apponeId,
    });
  }
}

router.get('/ping-test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Server is working 🚀',
  });
});

router.post(
  '/application',
  enforceAllowedDealerId,
  normalizeApplicationPayload,
  joiValidateMiddleware(applicationValidation, {
    abortEarly: false,
    // allowUnknown: true,
    // stripUnknown: true,
  }),
  async (req, res, next) => {
    try {
      const payload = req.body;
      const recordId = payload?.recordId || '';
      res.status(202).send({
        status: 'received',
        recordId,
      });
      setImmediate(() => {
        processApplication(payload).catch((error) => {
          logger.error({
            message: 'Error processing application in background',
            errorMessage: error?.message,
            errorName: error?.name,
            errorCode: error?.code,
            errorStack: error?.stack,
          });
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/appone/sync-deal',
  async (req, res, next) => {
    try {
    if(!req.query.apponeId) {
      res.send('Invalid apponeid please pass apponeId')
    }
    const dealerId = req.query.dealerId ? String(req.query.dealerId) : undefined;
    await queueService.addHubspotUpdateJob(
      null,
      null,
      parseInt(req.query.apponeId),
      true,
      dealerId,
    );
    const errorModel = await ErrorModel.findOne({
      apponeId: req.query.apponeId
    })
    res.send(`Job to update Appone ID ${req.query.apponeId} is received
      ${errorModel?.error ? '<br/><b>Last encountered error:</b> ' + (Array.isArray(errorModel?.error) ? errorModel?.error.join(',<br/>'): errorModel?.error) : ''}
      ${errorModel?.error ? '<br/><br/><b>Error encountered at:</b>  <p style="display: inline;" id="date"></p>': ''} 
      <script>
        const dateElem = document.getElementById('date')
        if(dateElem) {
          dateElem.innerHTML = new Date("${errorModel?.updatedAt}")
        }
      </script>
    `);
  } catch(error) {
    next(error)
  }
  },
);


router.get(
  '/appone/submit-sync',
  async (req, res, next) => {
    try {
        res.send(`
        <form action="/api/appone/sync-deal">
          <label for="fname">AppOne ID:</label><br>
          <input type="text" id="apponeId" name="apponeId"><br>
          <input type="submit" value="Submit">
        </form> 
        `)
  } catch(error) {
    next(error)
  }
  },
);


router.post('/appone/deal/sync', async (req, res, next) => {
  try {
    let { appOneId, email, firstName, lastName, phone, emailBody } = req.body;
    const authorization = req.header('authorization');
    if (authorization !== 'A20DA43E-6C2F-4690-8B57-D0709B7C2224') {
      res.status(401).json({ message: 'Not Authorised' });
    }
    const id = Number(appOneId);
    let dealId, customerId;
    const mapping = await MappingModel.findOne({
      apponeId: '' + id,
    });
    logger.info({
      message: 'found mapping',
      mapping,
    })
    if (mapping) {
      dealId = mapping.hubspotDealId;
    }
    email = email.split(',')[0];
    customerId = await hubspotSdk.upsertContact({
      email,
      firstname: firstName.split(',')[0],
      lastname: lastName.split(',')[0],
      phone: phone,
      mobilephone: phone,
      appone_dealer_id: process.env.APPONE_DEALERID,
      source_appone: 'Marathon Xpress',
    });
    let brokerDealer = '',
      notes = '';
    emailBody.split('\n').forEach((emailLine) => {
      if (emailLine.includes('Dealership:')) {
        brokerDealer = emailLine.replace('Dealership:', '');
      } else if (emailLine.includes('Customer Notes: ')) {
        notes = emailLine.replace('Customer Notes:', '');
      }
    });
    const dealObj = {
      dealname: firstName + ' ' + lastName,
      appone_id: id,
      appone_dealer_id: process.env.APPONE_DEALERID,
      source_appone: 'Marathon Xpress',
      dealstage: 'appointmentscheduled',
      pipeline: 'default',
      broker_: brokerDealer.trim(),
      notes: notes,
      sync_deal: 'http://ec2-50-112-210-243.us-west-2.compute.amazonaws.com/api/appone/sync-deal?apponeId=' + id
    };
    logger.info({ message: 'deal obj', dealObj, appOneId });
    if (!dealId) {
      const response = await hubspotSdk.createDeal(dealObj);
      dealId = response.id;
      const mappingCreated = await MappingModel.findOneAndUpdate(
        {
          apponeId: '' + id,
        },
        {
          apponeId: '' + id,
          hubspotDealId: dealId,
          contactId: customerId,
          runAt: new Date(),
        },
        {
          upsert: true,
          new: true,
        },
      );
      await hubspotSdk.associateDealAndContact(dealId, customerId);
      const recentlyCreated = await MappingModel.findOne({
        apponeId: '' + id,
      })
      logger.info({
        message: 'upserted mapping',
        mappingCreated,
        dealId,
        appOneId,
        recentlyCreated,
      })
    }
    res.json({ appOneId });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

router.get('/health/queues', async (req, res, next) => {
  try {
    const queues = [
      { name: 'appone_pull', queue: queueService.pullApponeQueue },
      { name: 'hubspot_pull', queue: queueService.pullHubspotQueue },
      { name: 'hubspot_update', queue: queueService.updateHubspotQueue },
    ];

  const results = await Promise.all(
      queues.map(async ({ name, queue }) => {
        try {
          if (!queue || queue.disabled) {
            return {
              name,
              ok: false,
              disabled: true,
            };
          }
          await queue.isReady();
          const [
            waiting,
            active,
            delayed,
            failed,
            completed,
            paused,
          ] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getDelayedCount(),
            queue.getFailedCount(),
            queue.getCompletedCount(),
            queue.isPaused(),
          ]);
          const clientStatus = queue.client?.status || 'unknown';
          return {
            name,
            ok: true,
            clientStatus,
            counts: { waiting, active, delayed, failed, completed },
            paused,
          };
        } catch (error) {
          return {
            name,
            ok: false,
            error: error?.message || String(error),
          };
        }
      }),
    );

    res.json({
      ok: results.every((r) => r.ok),
      queues: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.use((req, res, next) => {
  const error = new NotFoundError(
    'Requested path was not found on this server',
  );
  error.params = {
    method: req.method,
    path: req.originalUrl,
  };
  next(error);
});

router.use((err, req, res, next) => {
  console.error(err)
  logger.error({
    message: 'error occured',
    error: err,
  });
  const { message } = err;

  let displayMessage = isCustomError(err) ? message : '';

  if (typeof message !== 'string') {
    displayMessage = message.toString();
  }

  res.status(err.status || 500).send({
    errorCode: err.name || 'InternalError',
    errorDescription:
      displayMessage ||
      'An internal error occured while serving the request. The error has been logged, please try your request again later',
    params: err.params,
    stack: Boolean(process.env.DEBUG_API) === true ? err.stack : undefined,
  });
});

module.exports = router;
