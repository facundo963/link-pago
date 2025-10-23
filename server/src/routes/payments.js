const express = require('express');
const router = express.Router();
const Payment = require('../models/payment');
const crypto = require('crypto');

// crear link de pago
router.post('/', async (req, res) => {
  try {
    const { amount, description, customerEmail, expiresInHours } = req.body;

    // ✅ Generar y guardar el ID en una variable
    const orderId = crypto.randomBytes(4).toString('hex');

    const expiresAt = new Date(Date.now() + ((expiresInHours || 1) * 3600 * 1000));


    const newPayment = new Payment({
      orderId,
      amount,
      description,
      customerEmail,
      expiresAt
    });

    await newPayment.save();

    console.log(' Nuevo pago creado:', orderId);

    res
      .status(201)
      .json({
        orderId,
        message: 'Link de pago creado',
        paymentLink: `/pay/${orderId}`
      });
  } catch (error) {
    console.error('❌ Error al crear link:', error);
    res.status(500).json({ error: 'Error al crear el link de pago' });
  }
});

// listar todos los pagos
router.get('/all', async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// obtener pago por orderId
router.get('/:orderId', async (req, res) => {
  const payment = await Payment.findOne({ orderId: req.params.orderId });
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
  res.json(payment);
});

// actualizar estado del pago
router.put('/:orderId/status', async (req, res) => {
  const { status, paymentInfo } = req.body;
  const payment = await Payment.findOneAndUpdate(
    { orderId: req.params.orderId },
    { status, paymentInfo },
    { new: true }
  );
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
  res.json({ message: 'Estado del pago actualizado', payment });
});

module.exports = router;
