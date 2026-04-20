const JoiBase = require('joi');
const states = require('./states.json');
const employmentStatus = require('./employmentSatus.json');
const otherIncome = require('./otherIncome.json');
const JoiDate = require('@joi/date');
const { collateralSchema } = require('./collateralValidation');
const Joi = JoiBase.extend(JoiDate); // extend Joi with Joi Date

const employmentSchema = {
  status: Joi.string()
    .valid(...employmentStatus)
    .required(),
  occupation: Joi.string().max(50).required(),
  employerName: Joi.string().max(50).required(),
  grossSalary: Joi.number().min(1).required(),
  grossSalaryType: Joi.string()
    .valid(...['MONTHLY', 'ANNUALLY'])
    .required(),
  workPhone: Joi.string()
    .pattern(/^\d{3}-\d{3}-\d{4}$/)
    .required(),
  years: Joi.number().integer().min(0).required(),
  months: Joi.number().integer().min(0).max(11).required(),
  address: Joi.string().allow('').max(100),
  zipcode: Joi.string().length(5).pattern(/^\d+$/),
  city: Joi.string().allow('').max(50),
  state: Joi.string().valid(...['', ...states]),
};

const borrowerSchema = Joi.object().keys({
  firstName: Joi.string().max(20).required(),
  middleName: Joi.string().allow('').max(20),
  lastName: Joi.string().max(20).required(),
  suffix: Joi.string()
    .valid(...['JR', 'SR', 'I', 'II', 'III', 'IV', 'V', ''])
    .required(),
  ssn: Joi.string()
    .regex(/^\d{3}-\d{2}-\d{4}$/)
    .required(),
  dateOfBirth: Joi.alternatives()
    .try(
      Joi.date().format('MM/DD/YYYY').raw(),
      Joi.date().format('YYYY-MM-DD').raw(),
    )
    .required(),
  email: Joi.string().email().required(),
  driverLicenceNumber: Joi.string().max(30).required(),
  state: Joi.string()
    .valid(...states)
    .required(),
  homePhone: Joi.string()
    .pattern(/^\d{3}-\d{3}-\d{4}$/)
    .required(),
  cellPhone: Joi.string().pattern(/^\d{3}-\d{3}-\d{4}$/),
  currentResidence: Joi.object()
    .keys({
      street: Joi.string().max(20).required(),
      streetAddress: Joi.string().max(100).required(),
      zipcode: Joi.string().length(5).pattern(/^\d+$/).required(),
      city: Joi.string().max(50).required(),
      country: Joi.string().max(50).required(),
      state: Joi.string()
        .valid(...states)
        .required(),
      years: Joi.number().integer().min(0).required(),
      months: Joi.number().integer().min(0).max(11).required(),
      status: Joi.string()
        .valid(
          ...[
            'OWN',
            'OWNOUTRIGHT',
            'MORTGAGE',
            'RENT',
            'WITH RELATIVES',
            'WITHRELATIVES',
            'WITH FRIEND',
            'WITH FRIENDS',
            'WITHFRIENDS',
            'OTHER',
            'UNKNOWN',
            '',
          ],
        )
        .required(),
      monthlyPayment: Joi.number().required(),
      landlordName: Joi.string().allow('').max(50),
      landlordPhone: Joi.string().pattern(/^\d{3}-\d{3}-\d{4}$/),
      isMailingAddressDifferent: Joi.boolean().required(),
      mailingAddress: Joi.when('isMailingAddressDifferent', {
        is: true,
        then: Joi.object()
          .keys({
            address: Joi.string().max(100).required(),
            zipcode: Joi.string().length(5).pattern(/^\d+$/).required(),
            city: Joi.string().max(50).required(),
            country: Joi.string().max(50).required(),
            state: Joi.string()
              .valid(...states)
              .required(),
          })
          .required(),
      }),
    })
    .required(),
  previousResidence: Joi.when('currentResidence.years', {
    is: Joi.number().integer().less(2),
    then: Joi.object()
      .keys({
        address: Joi.string().max(20).required(),
        address2: Joi.string().allow('').max(100),
        zipcode: Joi.string().length(5).pattern(/^\d+$/).required(),
        city: Joi.string().max(50).required(),
        country: Joi.string().max(50).required(),
        state: Joi.string()
          .valid(...states)
          .required(),
        years: Joi.number().integer().min(0).required(),
        months: Joi.number().integer().min(0).max(11).required(),
      })
      .required(),
  }),
  currentEmployment: Joi.object()
    .keys({
      ...employmentSchema,
      hasSecondJob: Joi.boolean().required(),
      hasOtherIncome: Joi.boolean().required(),
    })
    .required(),
  secondEmployment: Joi.when('currentEmployment.hasSecondJob', {
    is: true,
    then: Joi.object()
      .keys({
        occupation: Joi.string().max(50).required(),
        employerName: Joi.string().max(50).required(),
        grossSalary: Joi.number().min(1).required(),
        grossSalaryType: Joi.string()
          .valid(...['MONTHLY', 'ANNUALLY'])
          .required(),
        workPhone: Joi.string()
          .pattern(/^\d{3}-\d{3}-\d{4}$/)
          .required(),
        years: Joi.number().integer().min(0).required(),
        months: Joi.number().integer().min(0).max(11).required(),
        address: Joi.string().allow('').max(100),
        zipcode: Joi.string().length(5).pattern(/^\d+$/),
        city: Joi.string().allow('').max(50),
        state: Joi.string().valid(...['', ...states]),
      })
      .required(),
    otherwise: Joi.optional(),
  }),
  previousEmployment: Joi.object().keys(employmentSchema).required(),
  otherIncome: Joi.when('currentEmployment.hasOtherIncome', {
    is: true,
    then: Joi.object()
      .keys({
        grossSalary: Joi.number().min(1).required(),
        grossSalaryType: Joi.string()
          .valid(...['MONTHLY', 'ANNUALLY'])
          .required(),
        source: Joi.string()
          .valid(...otherIncome)
          .required(),
      })
      .required(),
    otherwise: Joi.optional(),
  }),
});

const tradeInSchema = Joi.object()
  .keys({
    year: Joi.date().format('YYYY').raw(),
    make: Joi.string().allow('').default(''),
    model: Joi.string().allow('').default(''),
    serial: Joi.string().allow('').default(''),
    mileage: Joi.number().integer().required(),
    lienHolder: Joi.string().allow('').default(''),
    tradeInAllowance: Joi.number().required(),
  })
  .required();

const applicationValidation = Joi.object()
  .keys({
    recordId: Joi.string().allow('').max(20),
    originatingSystem: Joi.string().allow('').max(50),
    dealerType: Joi.string().allow(''),
    fiPersonName: Joi.string().allow('').max(50),
    isJointApplication: Joi.boolean().required(),
    borrowers: Joi.when('isJointApplication', {
      is: true,
      then: Joi.array().items(borrowerSchema).length(2).required(),
      otherwise: Joi.array().items(borrowerSchema).length(1).required(),
    }),
    hasCollateralInformation: Joi.boolean().required(),
    collateral: Joi.when('hasCollateralInformation', {
      is: true,
      then: collateralSchema,
    }),
    hasTradeIn: Joi.boolean().required(),
    tradein: Joi.when('hasTradeIn', {
      is: true,
      then: tradeInSchema,
    }),
    paymentInformation: Joi.object().keys({
      downPayment: Joi.number().default(0),
      maxMonthly: Joi.number().default(0),
    }),
    structure: Joi.object().keys({
      totalTaxes: Joi.number().default(0),
      totalFees: Joi.number().default(0),
      totalProducts: Joi.number().default(0),
      totalAmountFinanced: Joi.number().default(0),
      term: Joi.number().integer().default(0),
      rate: Joi.number().default(0),
      daysToFirstPayment: Joi.number().integer().default(0),
    }),
    salesPersonName: Joi.string().allow('').max(50),
    signingFullName: Joi.string().required(),
  })
  .required();

module.exports = applicationValidation;
