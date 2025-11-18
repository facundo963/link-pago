const express = require("express");
const router = express.Router();
const Payment = require("../models/payment");
const crypto = require("crypto");
const axios = require("axios");

// Configuración API Cucuru
const CUCURU_BASE_URL =
  process.env.CUCURU_BASE_URL || "https://api.cucuru.com/app/v1";
const CUCURU_API_KEY = process.env.CUCURU_API_KEY;
const CUCURU_COLLECTOR_ID = process.env.CUCURU_COLLECTOR_ID;

/* -----------------------------------------------------------
   1) CREAR LINK DE PAGO + CVU + ALIAS
------------------------------------------------------------*/
router.post("/", async (req, res) => {
  try {
    const { amount, description, customerEmail, expiresInHours } = req.body;
    const orderId = crypto.randomBytes(4).toString("hex");

    const expiresAt = new Date(
      Date.now() + (expiresInHours || 1) * 3600 * 1000
    );

    const aliasPersonalizado = `linkpago-${orderId}`;
    const customerId = `cliente-${orderId}`;

    // Crear CVU
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

    // Asignar alias
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

    // Guardar pago
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
        customerId,
      },
    });

    await newPayment.save();

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

/* -----------------------------------------------------------
   2) LISTAR TODOS LOS PAGOS + EXPIRACIÓN AUTOMÁTICA
------------------------------------------------------------*/
router.get("/all", async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 });
    const ahora = new Date();

    for (const p of payments) {
      if (p.status === "pendiente" && p.expiresAt && ahora >= p.expiresAt) {
        p.status = "expirado";

        try {
          await axios.put(
            `${CUCURU_BASE_URL}/collection/accounts/account`,
            {
              account_number: p.paymentInfo?.cvu,
              customer_id: p.paymentInfo?.customerId,
              read_only: "true",
              on_received: "reject",
            },
            {
              headers: {
                "X-Cucuru-Api-Key": CUCURU_API_KEY,
                "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
                "Content-Type": "application/json",
              },
            }
          );

          console.log(`⏰🔒 Link ${p.orderId} vencido (panel) y CVU cerrado.`);
        } catch (err) {
          console.error("❌ Error cerrando CVU vencido:", err.response?.data || err.message);
        }

        await p.save();
      }
    }

    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -----------------------------------------------------------
   3) OBTENER PAGO POR ID + EXPIRACIÓN EN TIEMPO REAL
------------------------------------------------------------*/
router.get("/:orderId", async (req, res) => {
  const payment = await Payment.findOne({ orderId: req.params.orderId });
  if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

  // Expiración automática
  if (payment.status === "pendiente" && payment.expiresAt) {
    const ahora = new Date();
    if (ahora >= payment.expiresAt) {
      payment.status = "expirado";

      try {
        await axios.put(
          `${CUCURU_BASE_URL}/collection/accounts/account`,
          {
            account_number: payment.paymentInfo?.cvu,
            customer_id: payment.paymentInfo?.customerId,
            read_only: "true",
            on_received: "reject",
          },
          {
            headers: {
              "X-Cucuru-Api-Key": CUCURU_API_KEY,
              "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
              "Content-Type": "application/json",
            },
          }
        );

        console.log(`⏰🔒 Link ${payment.orderId} vencido y CVU cerrado.`);
      } catch (err) {
        console.error("❌ Error cerrando CVU vencido:", err.response?.data || err.message);
      }

      await payment.save();
    }
  }

  res.json(payment);
});

/* -----------------------------------------------------------
   4) WEBHOOK: COBRO RECIBIDO DESDE CUCURU
------------------------------------------------------------*/
router.post("/webhooks/collection_received", async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;
    console.log("💰 Cobro recibido:", data);

    const payment = await Payment.findOne({
      $or: [
        { "paymentInfo.cvu": data.collection_account },
        { orderId: data.customer_id?.replace("cliente-", "") },
      ],
    });

    if (!payment) {
      console.warn("⚠️ No se encontró pago asociado al CVU:", data.collection_account);
      return;
    }

    const montoEsperado = Number(payment.amount);
    const montoRecibido = Number(data.amount);

    /* ----------------- MONTO INCORRECTO → RECHAZO -----------------*/
    if (Math.abs(montoEsperado - montoRecibido) > 0.0001) {
      payment.status = "rechazado";
      payment.motivoRechazo = `Monto incorrecto: esperado ${montoEsperado}, recibido ${montoRecibido}`;
      await payment.save();

      try {
        await axios.post(
          `${CUCURU_BASE_URL}/Collection/reject`,
          {
            collection_id: data.collection_id,
            customer_account: data.customer_account,
            collection_account: data.collection_account,
          },
          {
            headers: {
              "X-Cucuru-Api-Key": CUCURU_API_KEY,
              "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
              "Content-Type": "application/json",
            },
          }
        );
      } catch {}

      // Reactivar automáticamente
      setTimeout(async () => {
        const p = await Payment.findOne({ orderId: payment.orderId });
        if (p && p.status === "rechazado") {
          p.status = "pendiente";
          await p.save();
        }
      }, 10000);

      return;
    }

    /* ---------------- MONTO CORRECTO → COMPLETADO -----------------*/
    payment.status = "completado";
    payment.paymentInfo.origen = {
      titular: data.customer_name,
      cvu: data.customer_account,
      cuit: data.customer_tax_id,
      banco: data.customer_bank_name || "Desconocido",
    };
    await payment.save();

    console.log(`✅ Pago ${payment.orderId} confirmado`);

    /* --------- 🔒 CERRAR CVU DESPUÉS DE PAGO CORRECTO ----------*/
    try {
      await axios.put(
        `${CUCURU_BASE_URL}/collection/accounts/account`,
        {
          account_number: cvu,
          customer_id: customerId,
          /*account_number: payment.paymentInfo.cvu,
          customer_id: payment.paymentInfo.customerId,*/
          read_only: "true",
          on_received: "reject",
        },
        {
          headers: {
            "X-Cucuru-Api-Key": CUCURU_API_KEY,
            "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`🔒 CVU del pago ${payment.orderId} cerrado post-pago`);
    } catch (err) {
      console.error("❌ Error cerrando CVU tras pago completado:", err.response?.data || err.message);
    }
  } catch (err) {
    console.error("❌ Error procesando webhook:", err.message);
  }
});

/* -----------------------------------------------------------
   5) CANCELAR LINK (read_only + reject)
------------------------------------------------------------*/
router.post("/:orderId/cancel", async (req, res) => {
  try {
    const payment = await Payment.findOne({ orderId: req.params.orderId });
    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

    if (payment.status === "completado") {
      return res.status(400).json({ error: "No se puede cancelar un pago ya completado." });
    }

    const { cvu, alias, customerId } = payment.paymentInfo;

    try {
      await axios.post(
        `${CUCURU_BASE_URL}/collection/accounts/account`,
        {
          account_number: cvu,
          customer_id: customerId,
          read_only: "true",
          on_received: "reject",
        },
        {
          headers: {
            "X-Cucuru-Api-Key": CUCURU_API_KEY,
            "X-Cucuru-Collector-Id": CUCURU_COLLECTOR_ID,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`❌🔒 Alias ${alias} cerrado manualmente`);
    } catch (err) {
      console.error("❌ Error cerrando alias manualmente:", err.response?.data || err.message);
    }

    payment.status = "cancelado";
    payment.paymentInfo.bloqueado = true;
    payment.paymentInfo.cerradoEn = new Date();

    await payment.save();

    res.json({
      success: true,
      message: "Link cancelado y CVU bloqueado correctamente.",
      payment,
    });
  } catch (err) {
    res.status(500).json({ error: "Error cancelando link de pago" });
  }
});

module.exports = router;
