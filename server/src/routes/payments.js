const express = require("express");
const router = express.Router();
const Payment = require("../models/payment");
const crypto = require("crypto");
const axios = require("axios");

// 🔐 Configuración API Cucuru
const CUCURU_BASE_URL = process.env.CUCURU_BASE_URL || "https://api.cucuru.com/app/v1";
const CUCURU_API_KEY = process.env.CUCURU_API_KEY;
const CUCURU_COLLECTOR_ID = process.env.CUCURU_COLLECTOR_ID;

// 🧩 Crear link de pago (CVU y alias personalizados)
router.post("/", async (req, res) => {
  try {
    const { amount, description, customerEmail, expiresInHours } = req.body;
    const orderId = crypto.randomBytes(4).toString("hex");
    const expiresAt = new Date(Date.now() + (expiresInHours || 1) * 3600 * 1000);

    // Generar alias y customer_id únicos
    const aliasPersonalizado = `linkpago-${orderId}`;
    const customerId = `cliente-${orderId}`;

    // 1️⃣ Crear CVU único
    let accountNumber = null;
    try {
      const cvuRes = await axios.put(
        `${CUCURU_BASE_URL}/collection/accounts/account`,
        { customer_id: customerId, read_only: "false" },
        {
          headers: {
            "X-Cucuru-Api-Key": CUCURU_API_KEY,
            "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
            "Content-Type": "application/json",
          },
        }
      );
      accountNumber = cvuRes.data?.account_number;
      console.log("✅ CVU creado:", accountNumber);
    } catch (err) {
      console.error("❌ Error creando CVU:", err.response?.data || err.message);
      return res.status(500).json({ error: "No se pudo crear el CVU" });
    }

    // 2️⃣ Asignar alias
    try {
      await axios.post(
        `${CUCURU_BASE_URL}/collection/accounts/account/alias`,
        {
          account_number: accountNumber,
          alias: aliasPersonalizado,
        },
        {
          headers: {
            "X-Cucuru-Api-Key": CUCURU_API_KEY,
            "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("✅ Alias asignado:", aliasPersonalizado);
    } catch (err) {
      console.error("⚠️ Error asignando alias:", err.response?.data || err.message);
    }

    // 3️⃣ Guardar en MongoDB
    const newPayment = new Payment({
      orderId,
      amount,
      description,
      customerEmail,
      expiresAt,
      status: "pendiente",
      paymentInfo: {
        alias: aliasPersonalizado,
        titular: "Cuenta Comercio LinkPago",
        cvu: accountNumber,
      },
    });
    await newPayment.save();

    // 4️⃣ Responder al frontend
    res.status(201).json({
      orderId,
      message: "✅ Link de pago creado correctamente",
      alias: aliasPersonalizado,
      cvu: accountNumber,
    });
  } catch (error) {
    console.error("❌ Error al crear link:", error);
    res.status(500).json({ error: "Error al crear el link de pago" });
  }
});

// 📋 Listar todos los pagos
router.get("/all", async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔍 Obtener un pago por ID
router.get("/:orderId", async (req, res) => {
  const payment = await Payment.findOne({ orderId: req.params.orderId });
  if (!payment) return res.status(404).json({ error: "Pago no encontrado" });
  res.json(payment);
});

// 🔄 Actualizar estado manualmente
router.put("/:orderId/status", async (req, res) => {
  const { status, paymentInfo } = req.body;
  const payment = await Payment.findOneAndUpdate(
    { orderId: req.params.orderId },
    { status, paymentInfo },
    { new: true }
  );
  if (!payment) return res.status(404).json({ error: "Pago no encontrado" });
  res.json({ message: "Estado actualizado", payment });
});

// 🔔 Webhook oficial Cucuru → notificación de cobro
router.post("/webhooks/collection_received", async (req, res) => {
  // Responder rápido a Cucuru (HTTP 200)
  res.sendStatus(200);

  try {
    const data = req.body;
    console.log("💰 Cobro recibido desde Cucuru:", data);

    // Buscar el pago por CVU o customer_id
    const payment = await Payment.findOne({
      $or: [
        { "paymentInfo.cvu": data.collection_account },
        { orderId: data.customer_id?.replace("cliente-", "") },
      ],
    });

    if (!payment) {
      console.warn("⚠️ No se encontró pago con CVU:", data.collection_account);
      return;
    }

    // Actualizar estado a completado
    payment.status = "completado";
    payment.paymentInfo.origen = {
      titular: data.customer_name,
      cvu: data.customer_account,
      cuit: data.customer_tax_id,
      banco: data.customer_bank_name || "Desconocido",
    };
    await payment.save();

    console.log(`✅ Pago ${payment.orderId} marcado como completado`);
  } catch (err) {
    console.error("❌ Error procesando webhook:", err.message);
  }
});

// 🧷 Registrar webhook (solo una vez)
router.post("/webhooks/register", async (req, res) => {
  try {
    const webhookUrl =
      process.env.WEBHOOK_URL ||
      "https://link-pago.onrender.com/api/payments/webhooks";

    const { data } = await axios.post(
      `${CUCURU_BASE_URL}/collection/webhooks/endpoint`,
      {
        url: webhookUrl,
        header: { name: "X-Auth-Token", value: "token-secreto" },
      },
      {
        headers: {
          "X-Cucuru-Api-Key": CUCURU_API_KEY,
          "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Webhook registrado:", webhookUrl);
    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Error registrando webhook:", err.response?.data || err.message);
    res.status(500).json({ error: "Error registrando webhook" });
  }
});

module.exports = router;
