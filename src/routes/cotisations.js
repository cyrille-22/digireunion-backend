const express = require('express');
const router = express.Router();
const {
  saisirCotisations,
  getBilanSeance,
  getHistoriqueSeances
} = require('../controllers/cotisationController');
const {
  inscrireMembre,
  getMembresTontine
} = require('../controllers/tontineMembreController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

// Cotisations
router.post('/', requireRole('president','secretaire'), saisirCotisations);
router.get('/bilan/:seance_id', getBilanSeance);
router.get('/historique', getHistoriqueSeances);

// Membres tontine
router.post('/inscription', requireRole('president','secretaire'), inscrireMembre);
router.get('/tontine/:tontine_id/membres', getMembresTontine);

module.exports = router;