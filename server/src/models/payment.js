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
    enum: ["pendiente", "completado", "expirado","rechazado", "sobrante", "faltante", "cancelado"],
  },
  motivoRechazo: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: Date,
  paymentInfo: Object, //alias, cuit, cvu, titular.
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true
  }

  
});
module.exports = mongoose.model("Payment", paymentSchema);
