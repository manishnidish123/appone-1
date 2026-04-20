const JoiBase = require('joi');
const states = require('./states.json');
const employmentStatus = require('./employmentSatus.json');
const otherIncome = require('./otherIncome.json');
const collateralTypes = require('./collateralTypes.json');
const JoiDate = require('@joi/date');
const Joi = JoiBase.extend(JoiDate); // extend Joi with Joi Date
const classType = require('./classType.json');

const autoSchema = {
  inventoryStockNumber: Joi.string().allow('').default(''),
  type: Joi.string().valid(...['USED', 'NEW', '']),
  year: Joi.date().format('YYYY').raw(),
  make: Joi.string().default(''),
  model: Joi.string().default(''),
  bodyStyle: Joi.string().default(''),
  mileage: Joi.number().integer().default(0),
  color: Joi.string().default(''),
  serialNumber: Joi.string().default(''),
  sellingPrice: Joi.number(),
};

const rvSchema = {
  inventoryStockNumber: Joi.string().default(''),
  type: Joi.string().valid(...['USED', 'NEW', '']),
  year: Joi.date().format('YYYY').raw(),
  make: Joi.string().default(''),
  model: Joi.string().default(''),
  classType: Joi.string().valid(...classType),
  length: Joi.number().integer(),
  mileage: Joi.number().integer().default(0),
  color: Joi.string().default(''),
  serialNumber: Joi.string().default(''),
};

const conversionPackage = {
  hasConversionPackage: Joi.boolean(),
  conversionDetails: Joi.when('hasConversionPackage', {
    then: Joi.object()
      .keys({
        serial: Joi.string().default(''),
        year: Joi.date().format('YYYY').raw().required(),
        make: Joi.string().required(),
        model: Joi.string().required(),
      })
      .required(),
  }),
};

const trikePackage = {
  hasTrike: Joi.boolean(),
  trikeDetails: Joi.when('hasTrike', {
    then: Joi.object()
      .keys({
        serial: Joi.string().default(''),
        year: Joi.date().format('YYYY').raw().required(),
        make: Joi.string().required(),
        model: Joi.string().required(),
      })
      .required(),
  }),
};

const powerSportsSchema = {
  inventoryStockNumber: Joi.string().default(''),
  type: Joi.string().valid(...['USED', 'NEW', '']),
  year: Joi.date().format('YYYY').raw(),
  make: Joi.string().default(''),
  model: Joi.string().default(''),
  mileage: Joi.number().integer().default(0),
  serialNumber: Joi.string().default(''),
};

const { mileage: _, ...pianoSchema } = powerSportsSchema;

const tractorSchema = Joi.object()
  .keys({
    inventoryStockNumber: Joi.string().default(''),
    type: Joi.string().valid(...['USED', 'NEW', '']),
    year: Joi.date().format('YYYY').raw(),
    make: Joi.string().default(''),
    model: Joi.string().default(''),
    horsepower: Joi.number().default(0),
    fuelType: Joi.string().valid('', 'GAS', 'DIESEL'),
    drive: Joi.string().valid('', '2WD', '4WD'),
    hours: Joi.number().default(0),
    serialNumber: Joi.string().default(''),
    implementations: Joi.array()
      .items(
        Joi.object().keys({
          serial: Joi.string().default(''),
          type: Joi.string().valid('NEW', 'USED').required(),
          year: Joi.date().format('YYYY').raw(),
          make: Joi.string().required(),
          model: Joi.string().required(),
        }),
      )
      .required(),
  })
  .required();

const marineSchema = Joi.object()
  .keys({
    inventoryStockNumber: Joi.string().default(''),
    boatInfo: Joi.object().keys({
      serial: Joi.string().default(''),
      type: Joi.string().valid('NEW', 'USED').required(),
      year: Joi.date().format('YYYY').raw().required(),
      make: Joi.string().required(),
      model: Joi.string().required(),
      length: Joi.number().integer(),
    }),
    motors: Joi.array()
      .items(
        Joi.object().keys({
          serial: Joi.string().default(''),
          type: Joi.string().valid('NEW', 'USED').required(),
          year: Joi.date().format('YYYY').raw(),
          make: Joi.string().required(),
          model: Joi.string().required(),
          hp: Joi.string().default(''),
          fuelType: Joi.string().default(''),
          motorType: Joi.string().default(''),
        }),
      )
      .required(),
    trailers: Joi.array()
      .items(
        Joi.object().keys({
          serial: Joi.string().default(''),
          type: Joi.string().valid('NEW', 'USED').required(),
          year: Joi.date().format('YYYY').raw().required(),
          make: Joi.string().required(),
          model: Joi.string().required(),
          axles: Joi.number().default(0),
        }),
      )
      .required(),
  })
  .required();

const collateralSchema = Joi.object()
  .keys({
    type: Joi.string()
      .valid(...collateralTypes)
      .required(),
    data: Joi.when('type', {
      switch: [
        { is: 'AUTO', then: autoSchema },
        {
          is: 'AUTO - CLASSIC CARS',
          then: { ...autoSchema, serialNumber: Joi.string() },
        },
        {
          is: 'AUTO - CONVERSION',
          then: { ...autoSchema, ...conversionPackage },
        },
        {
          is: 'TRUCKS - COMMERCIAL',
          then: {
            ...autoSchema,
            ...conversionPackage,
            serialNumber: Joi.string().default(''),
          },
        },
        { is: 'MARINE', then: marineSchema },
        { is: 'RV', then: rvSchema },
        {
          is: 'POWERSPORTS - MOTORCYCLE',
          then: { ...powerSportsSchema, ...trikePackage },
        },
        { is: 'POWERSPORTS - ATV', then: powerSportsSchema },
        { is: 'POWERSPORTS - UTV/SIDE-BY-SIDE', then: powerSportsSchema },
        { is: 'POWERSPORTS - PERSONAL WATERCRAFT', then: powerSportsSchema },
        { is: 'POWERSPORTS - SNOWMOBILES', then: powerSportsSchema },
        { is: 'POWERSPORTS - SIDE CARS', then: powerSportsSchema },
        { is: 'POWERSPORTS - TRAILERS', then: powerSportsSchema },
        {
          is: 'TRAILERS',
          then: { ...pianoSchema, length: Joi.number().integer() },
        },
        { is: 'TRACTORS', then: tractorSchema },
        { is: 'PIANO', then: pianoSchema },
      ],
    }).required(),
  })
  .required();

module.exports = {
  collateralSchema,
};
