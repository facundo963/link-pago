const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cucuruApiKey: { type: String, required: true },
  cucuruCollectorId: { type: String, required: true },
  aliasPrefix: { type: String, required: true },
  defaultExpiresInHours: { type: Number, default: 1 },
  contactEmail: String,
  notes: String
}, { timestamps: true });

module.exports = mongoose.model("Client", clientSchema);
