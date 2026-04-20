const hubspot = require('@hubspot/api-client');
const logger = require('../logger')(__filename);
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();
const hubspotClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_KEY });

async function getDeals(after = undefined) {
  const properties = ['appone_id', 'dealstage'];
  const associations = ['contacts'];
  const apiResponse = await hubspotClient.crm.deals.basicApi.getPage(
    100,
    after,
    properties,
    [],
    associations,
    false,
  );
  console.log(JSON.stringify(Object.keys(apiResponse)), 'getDeals');
  return {
    next: apiResponse.paging ? apiResponse.paging.next.after : null,
    data: apiResponse.results,
  };
}

async function getDeal(dealId) {
  const properties = ['appone_id'];
  const associations = ['contacts'];

  const apiResponse = await hubspotClient.crm.deals.basicApi.getById(
    dealId,
    properties,
    associations,
    false,
  );
  console.log(JSON.stringify(apiResponse), 'getDeal');

  return {
    next: apiResponse.body.paging ? apiResponse.body.paging.next : null,
    data: apiResponse.body.results,
  };
}

async function updateContact(contactId, properties) {
  const cleaned = Object.fromEntries(
    Object.entries(properties || {}).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
  const SimplePublicObjectInput = { properties: cleaned };

  try {
    const apiResponse = await hubspotClient.crm.contacts.basicApi.update(
      contactId,
      SimplePublicObjectInput,
    );
    console.log(JSON.stringify(apiResponse), 'updateContact');
    return apiResponse;
  } catch (e) {
    logger.error({
      message: 'Error updating contact',
      error: e,
      contactId,
      properties,
    });
    if ((e.response && e.response.statusCode === 404) || e.code === 404) {
      return { status: 404 };
    }
    throw e;
  }
}

async function upsertContact(properties) {
  const mappedProperties = Object.entries(properties || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([property, value]) => ({
      property,
      value,
    }));
  try {
    const apiResponse = await axios.post(
      `https://api.hubapi.com/contacts/v1/contact/createOrUpdate/email/${properties.email}/`,
      {
        properties: mappedProperties,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUBSPOT_KEY}`,
        },
      },
    );
    console.log(JSON.stringify(apiResponse.data), 'upsertContact', apiResponse.data.vid);
    return apiResponse.data.vid;
  } catch (e) {
    console.error({
      message: 'Error upserting contact',
      error: e,
      properties,
      mappedProperties,
    });
    throw e;
  }
}

async function updateDeal(dealId, properties) {
  const cleaned = Object.fromEntries(
    Object.entries(properties || {}).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
  const SimplePublicObjectInput = { properties: cleaned };

  try {
    const apiResponse = await hubspotClient.crm.deals.basicApi.update(
      dealId,
      SimplePublicObjectInput,
    );
    console.log(JSON.stringify(apiResponse), 'updateDate');
    return apiResponse;
  } catch (e) {
    logger.error({
      message: 'Error updating deal',
      error: e,
      dealId,
      SimplePublicObjectInput,
    });
    if ((e.response && e.response.statusCode === 404) || e.code === 404) {
      return { status: 404 };
    }
    throw e;
  }
}

async function findContact(email) {
  logger.info({
    message: 'Searching for contact with email ' + email,
  });
  const PublicObjectSearchRequest = {
    filterGroups: [
      {
        filters: [
          {
            value: email,
            propertyName: 'email',
            operator: 'EQ',
          },
        ],
      },
    ],
    sorts: ['id'],
    properties: ['email'],
    limit: 1,
    after: 0,
  };

  const apiResponse = await hubspotClient.crm.contacts.searchApi.doSearch(
    PublicObjectSearchRequest,
  );
  console.log(JSON.stringify(apiResponse), 'findContact')
  if (apiResponse.total > 0) {
    logger.info({
      message: 'found contact with email ' + email,
    });
    return apiResponse.results[0].id;
  }
  logger.info({
    message: 'no match found contact with email ' + email,
  });
  return null;
}

async function createDeal(properties) {
  const SimplePublicObjectInput = { properties };

  try {
    const apiResponse = await hubspotClient.crm.deals.basicApi.create(
      SimplePublicObjectInput,
    );
    return apiResponse;
  } catch (e) {
    logger.error({
      message: 'Error creating deal',
      error: e,
      SimplePublicObjectInput,
    });
    throw e;
  }
}

async function associateDealAndContact(dealId, contactId) {
  try {
    const apiResponse = await hubspotClient.crm.deals.associationsApi.create(
      dealId,
      'contacts',
      contactId,
      'deal_to_contact',
    );
    console.log(JSON.stringify(apiResponse), 'associateDealAndContact')
    return apiResponse;
  } catch (e) {
    logger.error({
      message: 'Error associating contact to deal',
      dealId,
      contactId,
      error: e,
    });
    throw e;
  }
}

module.exports = {
  getDeals,
  updateDeal,
  updateContact,
  upsertContact,
  associateDealAndContact,
  getDeal,
  createDeal,
  findContact,
};
