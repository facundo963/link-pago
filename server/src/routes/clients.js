const express = require("express");
const router = express.Router();
const Client = require("../models/client");
const axios = require("axios");

//Registrar webhook Cucuru

async function registrarWebhook(client) {
  try {
    // IMPORTANTE: Reemplaza esta URL por la de tu servidor real (de Render, Vercel, etc.)
    // No le pongas la parte de "/webhooks/..." al final, Cucuru la agrega sola.
    const miUrlBase = "https://link-pago.onrender.com/api/payments"; 

    await axios.post(
      "https://api.cucuru.com/app/v1/Collection/webhooks/endpoint",
      { url: miUrlBase },
      {
        headers: {
          "X-Cucuru-Api-Key": client.cucuruApiKey,
          "X-Cucuru-Collector-Id": client.cucuruCollectorId,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Webhook registrado para el cliente: ${client.name}`);
  } catch (err) {
    console.error("❌ Error registrando webhook:", err.response?.data || err.message);
  }
}

// Crear cliente nuevo y avisar a Cucuru
router.post("/", async (req, res) => {
  const client = await Client.create(req.body);
  await registrarWebhook(client); // <--- Registro automático
  res.json(client);
});

// Actualizar cliente y re-registrar (por si cambió la API Key)
router.put("/:id", async (req, res) => {
  const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (client) await registrarWebhook(client);
  res.json(client);
});

// Listar y Obtener (se mantienen igual)
router.get("/", async (req, res) => {
  const clients = await Client.find().sort({ createdAt: -1 });
  res.json(clients);
});

router.get("/:id", async (req, res) => {
  const client = await Client.findById(req.params.id);
  res.json(client);
});

module.exports = router;
