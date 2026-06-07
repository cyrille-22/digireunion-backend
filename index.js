const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./src/config/database');
const { port } = require('./src/config/env');

const authRoutes       = require('./src/routes/auth');
const memberRoutes     = require('./src/routes/members');
const tontineRoutes    = require('./src/routes/tontines');
const pretRoutes       = require('./src/routes/prets');
const seanceRoutes     = require('./src/routes/seances');
const cotisationRoutes = require('./src/routes/cotisations');
const epargneRoutes    = require('./src/routes/epargne');
const prets2Routes     = require('./src/routes/prets2');
const deductionRoutes  = require('./src/routes/deductions');
const boufferRoutes    = require('./src/routes/bouffer');
const dashboardRoutes = require('./src/routes/dashboard');
const pvRoutes = require('./src/routes/pv');
const nouvellesRoutes = require('./src/routes/nouvelles');
const parametresRoutes = require('./src/routes/parametres');


const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    'https://digireunion-web-admin-production.up.railway.app',
    'http://localhost:5173',
    '*'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(helmet());
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/auth',          authRoutes);
app.use('/api/v1/members',       memberRoutes);
app.use('/api/v1/tontines',      tontineRoutes);
app.use('/api/v1/pret-rubriques',pretRoutes);
app.use('/api/v1/seances',       seanceRoutes);
app.use('/api/v1/cotisations',   cotisationRoutes);
app.use('/api/v1/epargne',       epargneRoutes);
app.use('/api/v1/prets',         prets2Routes);
app.use('/api/v1/deductions',    deductionRoutes);
app.use('/api/v1/bouffer',       boufferRoutes);
app.use('/api/v1/pv', pvRoutes);
app.use('/api/v1/seances', nouvellesRoutes);
app.use('/api/v1/parametres', parametresRoutes);
app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'OK',
      message: 'Digi-Reunion API v1.0 fonctionne',
      database: 'PostgreSQL connecte',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.listen(port, () => {
  console.log('Serveur demarre sur http://localhost:' + port);
});