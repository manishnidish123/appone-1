var mongoose = require('mongoose');
var Schema = mongoose.Schema;

const syncStatusSchema = new Schema(
  {
    syncType: { type: String, unique: true },
    successfulRunStartAt: Date,
    runAt: Date,
    completedAt: Date,
    isSynced: Boolean,
  },
  {
    // Enables CreatedAt & UpdatedAt
    timestamps: true,
  },
);

const SyncStatusModel = mongoose.model('SyncStatus', syncStatusSchema);

module.exports = SyncStatusModel;
