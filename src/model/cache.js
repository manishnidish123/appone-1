var mongoose = require('mongoose');
var Schema = mongoose.Schema;

const cacheSchema = new Schema(
  {
    apponeId: { type: String },
    dealData: Object,
  },
  {
    // Enables CreatedAt & UpdatedAt
    timestamps: true,
  },
);

const CacheModel = mongoose.model('Cache', cacheSchema);

module.exports = CacheModel;
