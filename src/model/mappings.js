var mongoose = require('mongoose');
var Schema = mongoose.Schema;

const mappingSchema = new Schema(
  {
    apponeId: { type: String, unique: true },
    hubspotDealId: { type: String, index: true },
    contactId: String,
    runAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  {
    // Enables CreatedAt & UpdatedAt
    timestamps: true,
  },
);

const MappingModel = mongoose.model('Mapping', mappingSchema);

module.exports = MappingModel;
