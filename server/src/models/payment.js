const mongoose = require("mongoose");

//Esquema que cubre estados y datos
const paymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  description: String,
  customerEmail: String,
  status: {
    type: String,
    default: "pendiente",
    enum: ["pendiente", "completado", "expirado", "sobrante", "faltante"],
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: Date,
  paymentInfo: Object, //alias, cuit, cvu, titular.
  
});
module.exports = mongoose.model("Payment", paymentSchema);
