const Sentry = require('@sentry/node');
const apponeSdk = require('../utils/appOneSdk');
const Promise = require('bluebird');
const logger = require('../logger')(__filename);
const hubspotSdk = require('../utils/hubspotSdk');
const _get = require('lodash.get');
const MappingModel = require('../model/mappings');
const CacheModel = require('../model/cache');
const ErrorModel = require('../model/error');

function getType(type) {
  switch (type) {
    case 'MARINE':
      return 'Marine';
    case 'AIRCRAFT':
      return 'Aircraft';
    default:
      return type;
  }
}

async function getMotorText(data) {
  let motors = _get(data, 'Collateral.Motors.Motor', []);
  motors = Array.isArray(motors) ? motors : [motors];
  let text = '';
  await Promise.mapSeries(motors, async function (motor, index) {
    text += `
Motor #${index + 1}
Age: ${_get(motor, 'Age', '')}
CostPrice: ${_get(motor, 'CostPrice', '')}
FuelType: ${_get(motor, 'FuelType', '')}
HorsePower: ${_get(motor, 'HorsePower', '')}
MSRP: ${_get(motor, 'MSRP', '')}
Make: ${_get(motor, 'Make', '')}
Model: ${_get(motor, 'Model', '')}
NumOrder: ${_get(motor, 'NumOrder', '')}
SellingPrice: ${_get(motor, 'SellingPrice', '')}
Serial: ${_get(motor, 'Serial', '')}
Type: ${_get(motor, 'Type', '')}
Year: ${_get(motor, 'Year', '')}
---
`;
  });
  return text;
}

async function getLenderText(data) {
  let lenders = _get(data, 'Lenders.Lender', []);
  lenders = Array.isArray(lenders) ? lenders : [lenders];
  let text = '';
  await Promise.mapSeries(lenders, async function (lender, index) {
    text += `
${_get(lender, 'LenderName', '')} / ${_get(lender, 'Decision', '')}
---
`;
  });
  return text;
}

async function getTrailerText(data) {
  const text = `
Age: ${_get(data, 'Collateral.Trailer.Age')}
Axles: ${_get(data, 'Collateral.Trailer.Axles')}
CostPrice: ${_get(data, 'Collateral.Trailer.CostPrice')}
MSRP: ${_get(data, 'Collateral.Trailer.MSRP')}
Make: ${_get(data, 'Collateral.Trailer.Make')}
Model: ${_get(data, 'Collateral.Trailer.Model')}
SellingPrice: ${_get(data, 'Collateral.Trailer.SellingPrice')}
Serial: ${_get(data, 'Collateral.Trailer.Serial')}
Year: ${_get(data, 'Collateral.Trailer.Year')}
  `;
  return text;
}

module.exports = async function (job) {
  var dealId, apponeId;
  try {
    var { dealId, customerId, apponeId, dealerId } = job.data;
    if (!dealId) {
      const mapping = await MappingModel.findOne({
        apponeId: '' + apponeId,
      });
      logger.info({
        message: "mapping found",
        job: job.data,
        apponeId,
        mapping,
      })
      if (mapping) {
        dealId = mapping.hubspotDealId;
        customerId = mapping.contactId;
        logger.info({
          message: "using mapping",
          job: job.data,
          dealId,
          customerId,
        })
      }
      if (mapping && mapping.isDeleted) {
        throw new Error('Deal deleted in hubspot skipping: ' + apponeId);
      }
    }
    let data;
    const cachedResponse = await CacheModel.findOne({
      apponeId: apponeId,
    });
    if (cachedResponse && cachedResponse.dealData) {
      data = cachedResponse.dealData;
      logger.info({
        message: 'received appone application file from cache',
        dealId,
        apponeId,
        id: cachedResponse._id,
      });
    } else {
      const pollDealerIds = (process.env.APPONE_POLL_DEALERIDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      const dealerCandidates = [
        dealerId,
        process.env.APPONE_DEALERID,
        ...pollDealerIds,
        null,
        0,
      ].filter((id) => id !== undefined);
      const seen = new Set();
      const uniqueDealers = dealerCandidates.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      let appOneDealData;
      let lastError;
      for (const candidate of uniqueDealers.length ? uniqueDealers : [undefined]) {
        try {
          appOneDealData = await apponeSdk.getApplicationFile(
            apponeId,
            undefined,
            candidate,
          );
          if (candidate) {
            logger.info({
              message: 'Fetched appone application with dealer override',
              apponeId,
              dealerId: candidate,
            });
          }
          break;
        } catch (error) {
          lastError = error;
          if (error?.response?.status !== 400) {
            throw error;
          }
          logger.warn({
            message: 'Appone fetch failed for dealer, trying next',
            apponeId,
            dealerId: candidate,
            status: error?.response?.status,
            responseData: error?.response?.data,
          });
        }
      }
      if (!appOneDealData) {
        if (lastError) {
          logger.error({
            message: 'Appone fetch failed for all dealer candidates',
            apponeId,
            status: lastError?.response?.status,
            responseData: lastError?.response?.data,
          });
        }
        throw lastError || new Error('Appone File Not Found');
      }
      logger.info({
        message: 'received appone application file',
        dealId,
        apponeId,
      });
      if (!appOneDealData || Object.keys(appOneDealData).length === 0) {
        logger.error({
          message: 'Appone File Not Found',
          apponeId,
          dealerId,
          appOneDealData,
        });
        throw new Error('Appone File Not Found');
      }
      data = appOneDealData.AppOneApplicationResponse;
      if (Array.isArray(data)) {
        logger.warn({
          message: 'Multiple not supported yet',
          dealId,
          apponeId,
        });
        throw new Error('Multiple not supported');
      }
    }
    logger.debug({
      message: 'appone data',
      apponeId,
      status: data.Status
    })
    let borrowers = _get(data, 'Borrowers.Borrower');
    borrowers = Array.isArray(borrowers) ? borrowers : [borrowers];

    let structureProductData = _get(data, 'Structure.Products.Product', [])
    structureProductData = Array.isArray(structureProductData) ? structureProductData : [structureProductData]
    
    // vsc  Vehicle Service Contract/Warranty  
    const vscProductData = structureProductData.find((d) => d.Code === 'vsc')
    const vscAmount = vscProductData?.SellingPriceAmount || 0
    const vscCost = vscProductData?.CostPriceAmount || 0

    // GAP
    const gapProductData = structureProductData.find((d) => d.Code === 'gap')
    const gapAmount = gapProductData?.SellingPriceAmount || 0
    const gapCost = gapProductData?.CostPriceAmount || 0

    // approved lender
    let lenders = _get(data, 'Lenders.Lender', []);
    lenders = Array.isArray(lenders) ? lenders : [lenders];
    const approvedLender = lenders.find(data => data.Selected === true)

    const sellingPrice = _get(data, 'Structure.SellingPrice', 0);
    const tax = _get(data, 'Structure.TotalTaxes', 0);

    let fundingDate;
    if (approvedLender?.FundedDateTime) {
      const parts = approvedLender.FundedDateTime.split('T')[0]
        .split('-')
        .map((v) => Number(v));
      if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
        fundingDate = Date.UTC(parts[0], parts[1] - 1, parts[2]);
      }
    }

    const dealPropertiesToUpdate = {
      source_appone: 'Marathon Xpress',
      appone_dealer_id: _get(data, 'Dealer.AppOneID') || _get(data, 'Dealer.AppOneId'),
      warranty_retail_amount: vscAmount,
      warranty_cost_amount: vscCost,
      gap_retail_amount: gapAmount,
      gap_cost_amount: gapCost,
      selling_price: sellingPrice,
      sales_tax: tax,
      lender_2_0: approvedLender?.LenderName || '',
      dealname: borrowers
          .map(
            (borrowerItem) =>
              _get(borrowerItem, 'FirstName') +
              ' ' +
              _get(borrowerItem, 'LastName'),
          )
          .join(' / '),
      appone_id: apponeId,
      // Collateral Info
      deal_type_n_u: _get(data, 'Collateral.Age') === 'NEW' ? 'New' : 'Used',
      type: getType(_get(data, 'Collateral.Type')),
      year: _get(data, 'Collateral.Year'),
      motor_make_and_s_n:
        _get(data, 'Collateral.Make') + ' ' + _get(data, 'Collateral.Serial'),
      manufacture: _get(data, 'Collateral.Make'),
      hin_: _get(data, 'Collateral.Serial'),
      model: _get(data, 'Collateral.Model'),
      amount: _get(data, 'Structure.TotalAmountFinanced'),
      milage: _get(data, "Collateral.Mileage"),
      selling_price: _get(data, 'Structure.SellingPrice'),
      lender_information: await getLenderText(data),
      ...(getType(_get(data, 'Collateral.Type')) === 'Marine'
        ? {
            trailer_properties: await getTrailerText(data),
            trailer_vin__: _get(data, 'Collateral.Trailer.Serial', ''),
            motor_details: await getMotorText(data),
          }
        : {}),
      appone_link: 'https://gateway.appone.net/dealer/LoanApp/RedirectionPage.aspx?seltab=4&applicationid=' + apponeId,
      sync_deal: 'http://ec2-50-112-210-243.us-west-2.compute.amazonaws.com/api/appone/sync-deal?apponeId=' + apponeId,
      // Check hubspot
      trade_in_allowance: _get(data, 'Structure.TradeInAllowance', ''),
      trade_in_payoff: _get(data, 'Structure.TradeInPayoff', ''),
      title_fee: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Code === 'title')?.amount ?? '',
      license_fee: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Code === 'license')?.amount ?? '',
      //registration_fee: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Code === 'registration')?.amount ?? '',
      documentation_fee: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Code === 'doc')?.amount ?? '',
      notary_fee: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Code === 'notary')?.amount ?? '',
      ucc_filling_fee: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Code === 'ucc')?.amount ?? '',
      documentation_uscg_under_40_: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Name === "Documentation USCG Under 40'")?.amount ?? '',
      documentation_uscg_over_40_: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Name === "Documentation USCG Over 40'")?.amount ?? '',
      rate: _get(data, 'Structure.Rate', ''),
      funding_date: fundingDate ?? undefined,

      // cashdown: _get(data, 'Structure.CashDown', ''),
      abstract_lien_serach_ucc: _get(data, 'Structure.Fees.Fee', []).find(fee => fee.Name === "Abstract/Lien Search/UCC")?.amount ?? '',
    };

    const borrower = Array.isArray(borrowers) ? borrowers[0] : borrowers;
    let address = _get(borrower, 'Addresses.Address');
    address = Array.isArray(address) ? address[0] : address;

    let response;
    if (dealId) {
      response = await hubspotSdk.updateDeal(dealId, dealPropertiesToUpdate);
      if (response.status === 404) {
        await MappingModel.findOneAndUpdate(
          {
            hubspotDealId: dealId,
          },
          {
            isDeleted: true,
          },
        );
        throw new Error('deal is deleted in hubspot: ' + apponeId + ' dealId: ' + dealId);
      } else {
        logger.info({
          message: 'Updated deal data in hubspot',
          response: response.id,
          dealId,
          apponeId,
        });
      }
    } else {
      const creationProperties = {
        ...dealPropertiesToUpdate,
        dealstage: 'appointmentscheduled',
        pipeline: 'default',
        // broker_: _get(data, "Dealer.Name", "Integration"),
        // hubspot_owner_id: 101647717,
      };
      response = await hubspotSdk.createDeal(creationProperties);
      logger.info({
        message: 'Created deal data in hubspot',
        response: response.id,
        creationProperties,
        dealId,
        apponeId,
      });
    }
    dealId = response.id;
    await MappingModel.findOneAndUpdate(
      {
        apponeId,
      },
      {
        apponeId,
        hubspotDealId: dealId,
        runAt: new Date(),
      },
      {
        upsert: true,
      },
    );
    let date = _get(borrower, 'DOB');
    if (date) {
      const parts = String(date).split('-').map((v) => Number(v));
      if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
        date = Date.UTC(parts[0], parts[1] - 1, parts[2]);
      } else {
        date = undefined;
      }
    }
    const customerData = {
      // company: "Biglytics",
      email: _get(borrower, 'Email'),
      birth_date: date,
      firstname:
        _get(borrower, 'FirstName') + ' ' + _get(borrower, 'MiddleName'),
      lastname: _get(borrower, 'LastName'),
      phone: _get(borrower, 'HomePhone'),
      mobilephone: _get(borrower, 'MobilePhone'),
      // website: "biglytics.net",
      drivers_license_number: _get(borrower, 'DLNo'),
      drivers_lic_state: _get(borrower, 'DLState'),
      address: _get(address, 'AptNo') + ' ' + _get(address, 'StreetNo') + ' ' + _get(address, 'StreetName'),
      zip_code: _get(address, 'ZipCode'),
      city: _get(address, 'City'),
      country: _get(address, 'Country'),
      state: _get(address, 'State'),
      appone_dealer_id: _get(data, 'Dealer.AppOneID') || _get(data, 'Dealer.AppOneId'),
      source_appone: 'Marathon Xpress',
    };
    let contactId = undefined;
    let needToAssociateContact = false;
    try {
      // search for existing contact with email in hubspot before creating & updating
      if (!customerId && customerData.email) {
        customerId = await hubspotSdk.findContact(customerData.email);
        logger.info({
          message: 'found customer id from search',
          contactId,
          dealId,
          apponeId,
        });
        needToAssociateContact = true;
        contactId = customerId
      }
      if (customerId) {
        const customer = await hubspotSdk.updateContact(
          customerId,
          customerData,
        );
        if (customer.status === 404) {
          logger.info({
            message: 'customer details deleted will create again',
            customer: customerData,
            dealId,
            apponeId,
          });
        } else {
          logger.info({
            message: 'updated customer',
            customer: customer.id,
            dealId,
            apponeId,
          });
          contactId = customer.id;
        }
      }
      if (!contactId) {
        const createdContactId = await hubspotSdk.upsertContact(customerData);
        logger.info({
          message: 'created customer',
          customer: createdContactId,
          dealId,
          apponeId,
        });
        needToAssociateContact = true;
        contactId = createdContactId;
      }
      if (needToAssociateContact) {
        const association = await hubspotSdk.associateDealAndContact(
          dealId,
          contactId,
        );
        logger.info({
          message: 'created association',
          association: association?.id,
          contact: contactId,
          deal: dealId,
          dealId,
          apponeId,
        });
      }
    } catch (error) {
      logger.error({
        message: 'error creating/updating contact',
        error,
        dealId,
        apponeId,
      });
      await ErrorModel.updateOne({
        apponeId: apponeId
      }, {
        error: error.message
      }, {
        upsert: true
      })
      console.error(error);
    }
    await MappingModel.findOneAndUpdate(
      {
        apponeId,
      },
      {
        apponeId,
        hubspotDealId: dealId,
        contactId,
        runAt: new Date(),
      },
      {
        upsert: true,
      },
    );
    await Promise.delay(500);
  } catch (e) {
    console.error(e);
    logger.error({
      error: e,
      message: 'Something went wrong',
      dealId,
      apponeId,
    });
    await ErrorModel.updateOne({
      apponeId: apponeId
    }, {
      error: e.message
    }, {
      upsert: true
    })
    Sentry.captureException(e);
    return Promise.resolve();
  } finally {
    if (apponeId) {
      await CacheModel.deleteOne({
        apponeId: apponeId,
      });
    }
  }
  return Promise.resolve();
};
