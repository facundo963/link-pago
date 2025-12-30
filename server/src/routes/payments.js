const express = require("express");
const router = express.Router();
const Payment = require("../models/payment");
const Client = require("../models/client");
const crypto = require("crypto");
const axios = require("axios");

// URL base por si no está en .env
const CUCURU_BASE_URL = process.env.CUCURU_BASE_URL || "https://api.cucuru.com/app/v1";

/* -----------------------------------------------------------
   1) CREAR LINK DE PAGO + CVU + ALIAS
------------------------------------------------------------*/
router.post("/", async (req, res) => {
  try {
    const { amount, description, customerEmail, expiresInHours, merchantId } =
      req.body;

    if (!merchantId) {
      return res.status(400).json({ error: "merchantId es obligatorio" });
    }

    const client = await Client.findById(merchantId);
    if (!client) {
      return res.status(400).json({ error: "Comercio no encontrado" });
    }

    const orderId = crypto.randomBytes(4).toString("hex");

    const expiresAt = new Date(
      Date.now() + (expiresInHours || 1) * 3600 * 1000
    );

    const aliasPersonalizado = `${client.aliasPrefix}.${orderId}`;
    const customerId = `cliente-${orderId}`;

    // Crear CVU
    let accountNumber = null;
    try {
      const cvuRes = await axios.put(
        `${CUCURU_BASE_URL}/collection/accounts/account`,
        { customer_id: customerId, read_only: "false" },
        {
          headers: {
            "X-Cucuru-Api-Key": client.cucuruApiKey,
            "X-Cucuru-Collector-Id": client.cucuruCollectorId,
            "Content-Type": "application/json",
          },
        }
      );
      accountNumber = cvuRes.data?.account_number;
      console.log("✅ CVU creado:", accountNumber);
    } catch (error) {
      console.error(
        "❌ Error creando CVU:",
        error.response?.data || error.message
      );
      return res.status(500).json({ error: "No se pudo crear el CVU" });
    }

    // Asignar alias
    try {
      await axios.post(
        `${CUCURU_BASE_URL}/collection/accounts/account/alias`,
        { account_number: accountNumber, alias: aliasPersonalizado },
        {
          headers: {
            "X-Cucuru-Api-Key": client.cucuruApiKey,
            "X-Cucuru-Collector-Id": client.cucuruCollectorId,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("✅ Alias asignado:", aliasPersonalizado);
    } catch (error) {
      console.error(
        "⚠️ Error asignando alias:",
        error.response?.data || error.message
      );
    }

    // Guardar pago
    await new Payment({
      orderId,
      amount,
      description,
      customerEmail,
      expiresAt,
      status: "pendiente",
      merchantId: client._id,
      paymentInfo: {
        alias: aliasPersonalizado,
        titular: client.name || "Cuenta Comercio LinkPago",
        cvu: accountNumber,
        customerId,
      },
    }).save();

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
   2) LISTAR PAGOS por comercio + EXPIRACIÓN AUTOMÁTICA
------------------------------------------------------------*/
router.get("/all", async (req, res) => {
  try {
    const { merchantId } = req.query;

    if (!merchantId) {
      return res.status(400).json({ error: "merchantId es obligatorio" });
    }

    const payments = await Payment.find({ merchantId }).sort({
      createdAt: -1,
    });

    const ahora = new Date();

    for (const p of payments) {
      if (p.status !== "pendiente") continue;
      if (!p.expiresAt || ahora < p.expiresAt) continue;

      p.status = "expirado";

      const client = await Client.findById(p.merchantId);
      if (!client) continue;

      try {
        await axios.post(
          `${CUCURU_BASE_URL}/collection/accounts/account`,
          {
            account_number: p.paymentInfo.cvu,
            customer_id: p.paymentInfo.customerId,
            read_only: "true",
            on_received: "reject",
          },
          {
            headers: {
              "X-Cucuru-Api-Key": client.cucuruApiKey,
              "X-Cucuru-Collector-Id": client.cucuruCollectorId,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`⏰🔒 CVU ${p.orderId} cerrado por vencimiento`);
      } catch (error) {
        console.error(
          "❌ Error cerrando CVU:",
          error.response?.data || error.message
        );
      }

      await p.save();
    }

    res.json(payments);
  } catch (error) {
    console.error("❌ Error listando pagos:", error);
    res.status(500).json({ error: error.message });
  }
});

/* -----------------------------------------------------------
   3) OBTENER PAGO POR ID (para payment.html)
------------------------------------------------------------*/
router.get("/:orderId", async (req, res) => {
  try {
    const payment = await Payment.findOne({
      orderId: req.params.orderId,
    });
    if (!payment) {
      return res.status(404).json({ error: "Pago no encontrado" });
    }

    const ahora = new Date();

    const client = await Client.findById(payment.merchantId);
    if (!client) {
      return res.status(500).json({ error: "Comercio no encontrado" });
    }

    if (
      payment.status === "pendiente" &&
      payment.expiresAt &&
      ahora >= payment.expiresAt
    ) {
      payment.status = "expirado";

      try {
        await axios.put(
          `${CUCURU_BASE_URL}/collection/accounts/account`,
          {
            account_number: payment.paymentInfo.cvu,
            customer_id: payment.paymentInfo.customerId,
            read_only: "true",
            on_received: "reject",
          },
          {
            headers: {
              "X-Cucuru-Api-Key": client.cucuruApiKey,
              "X-Cucuru-Collector-Id": client.cucuruCollectorId,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        console.error(
          "❌ Error cerrando CVU:",
          err.response?.data || err.message
        );
      }

      await payment.save();
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo pago" });
  }
});

/* -----------------------------------------------------------
   4) WEBHOOK COBRO RECIBIDO
------------------------------------------------------------*/
router.post("/collection_received", async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;
    console.log("📬 Webhook recibido:", data);

    if (data.amount === 0) {
      console.log(" validacion exitosa.");
      return;
    }

    const payment = await Payment.findOne({
      $or: [
        { "paymentInfo.cvu": data.collection_account },
        { orderId: data.customer_id?.replace("cliente-", "") },
      ],
    });
    if (!payment) return;

    const client = await Client.findById(payment.merchantId);
    if (!client) {
      console.error("No se encontró el comercio del pago");
      return;
    }

    const montoEsperado = Number(payment.amount);
    const montoRecibido = Number(data.amount);

    //  MONTO INCORRECTO
    if (Math.abs(montoEsperado - montoRecibido) > 0.0001) {
      payment.status = "rechazado";
      payment.motivoRechazo = `Monto incorrecto: esperado ${montoEsperado}, recibido ${montoRecibido}`;
      await payment.save();
      console.log(`Iniciando devolución automática para cobro ID: ${data.collection_id}`);

      //devolver fondos
      try {
        await axios.post(
          `${CUCURU_BASE_URL}/collection/reject`,
          {
            collection_id: data.collection_id,
            customer_account: data.customer_account,
            collection_account: data.collection_account,
          },
          {
            headers: {
              "X-Cucuru-Api-Key": client.cucuruApiKey,
              "X-Cucuru-Collector-Id": client.cucuruCollectorId,
              "Content-Type": "application/json",
            },
          }
        );
        console.log("✅ Devolución automática realizada con éxito.");
      } catch {error} {
        console.error(
          " Cucuru rechazo el pedido de devolución automática:",
          error.response?.data || error.message
        );
      }
    

      // Reactivar en 10s
      setTimeout(async () => {
        const p = await Payment.findOne({ orderId: payment.orderId });
        if (p && p.status === "rechazado") {
          p.status = "pendiente";
          await p.save();
        }
      }, 10000);

      return;
    }

    // MONTO CORRECTO → COMPLETADO
    payment.status = "completado";
    payment.paymentInfo.origen = {
      titular: data.customer_name,
      cvu: data.customer_account,
      cuit: data.customer_tax_id,
      banco: data.customer_bank_name || "Desconocido",
    };
    await payment.save();

    // CERRAR CVU
    try {
      await axios.post(
        `${CUCURU_BASE_URL}/collection/accounts/account`,
        {
          account_number: payment.paymentInfo.cvu,
          customer_id: payment.paymentInfo.customerId,
          read_only: "true",
          on_received: "reject",
        },
        {
          headers: {
            "X-Cucuru-Api-Key": client.cucuruApiKey,
            "X-Cucuru-Collector-Id": client.cucuruCollectorId,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.error("No se pudo bloquear el cvu post-pago");
    }
  } catch (error) {
    console.error("❌ Error procesando webhook:", err.message);
  }
});

/* -----------------------------------------------------------
   5) CANCELAR LINK MANUAL
------------------------------------------------------------*/
router.post("/:orderId/cancel", async (req, res) => {
  try {
    const payment = await Payment.findOne({
      orderId: req.params.orderId,
    });
    if (!payment) {
      return res.status(404).json({ error: "Pago no encontrado" });
    }

    if (payment.status === "completado") {
      return res
        .status(400)
        .json({ error: "No se puede cancelar un pago ya completado." });
    }

    const client = await Client.findById(payment.merchantId);
    if (!client) {
      return res.status(500).json({ error: "Comercio no encontrado" });
    }

    const { cvu, customerId, alias } = payment.paymentInfo;

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
            "X-Cucuru-Api-Key": client.cucuruApiKey,
            "X-Cucuru-Collector-Id": client.cucuruCollectorId,
            "Content-Type": "application/json",
          },
        }
      );
    } catch(error) {
      console.error(
        "❌ Error cerrando CVU:",
        error.response?.data || error.message
      );
    }
      
  
    payment.status = "cancelado";
    payment.paymentInfo.bloqueado = true;
    payment.paymentInfo.cerradoEn = new Date();
    await payment.save();

    res.json({
      success: true,
      message: "Link cancelado y CVU bloqueado.",
      payment,
    });
  } catch (error) {
    res.status(500).json({ error: "Error cancelando link" });
  }
});

module.exports = router;
