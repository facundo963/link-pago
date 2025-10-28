require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const paymentRoutes = require('./routes/payments');

const app = express();

// CORS
app.use(cors({
  origin: ['http://localhost:4000', 'http://127.0.0.1:5500', 'http://localhost:5500']
}));

app.use(express.json());

//  Rutas API
app.use('/api/payments', paymentRoutes);

//Servir frontend (client está 2 niveles arriba del archivo actual)
const clientPath = path.join(__dirname, '../../client');
app.use(express.static(clientPath));


// Solo devolver index.html si la ruta NO es un archivo real
app.get(/^\/(?!.*\.html).*$/, (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});


//  Conexión y servidor
const PORT = process.env.PORT || 4000;
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🌐 Frontend: http://localhost:${PORT}/index.html`);
      console.log(`🌐 Payment:  http://localhost:${PORT}/payment.html`);
    });
  })
  .catch(err => console.error(' Error conectando a MongoDB:', err));
