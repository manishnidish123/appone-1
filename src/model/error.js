var mongoose = require('mongoose');
var Schema = mongoose.Schema;

const errorSchema = new Schema(
  {
    apponeId: { type: String },
    error: Schema.Types.Mixed,
  },
  {
    // Enables CreatedAt & UpdatedAt
    timestamps: true,
  },
);

const ErrorModel = mongoose.model('Error', errorSchema);

module.exports = ErrorModel;
