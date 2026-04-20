const dotenv = require('dotenv');
const mongoose = require('mongoose');
dotenv.config();

async function connectMongoose() {
  // Prepare for Mongoose 7 default behavior.
  mongoose.set('strictQuery', false);
  const connection = await mongoose.connect(process.env.DB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  return connection;
}

async function disconnectMongoose() {
  await mongoose.connection.close();
}

module.exports = {
  connectMongoose,
  disconnectMongoose,
};
