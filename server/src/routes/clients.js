const express = require("express");
const router = express.Router();
const Client = require("../models/client");

// Crear cliente nuevo
router.post("/", async (req, res) => {
  const client = await Client.create(req.body);
  res.json(client);
});

// Listar clientes
router.get("/", async (req, res) => {
  const clients = await Client.find().sort({ createdAt: -1 });
  res.json(clients);
});

// Obtener un cliente
router.get("/:id", async (req, res) => {
  const client = await Client.findById(req.params.id);
  res.json(client);
});

// Actualizar cliente
router.put("/:id", async (req, res) => {
  const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(client);
});



module.exports = router;
