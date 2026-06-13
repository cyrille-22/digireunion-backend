const express = require('express');
const router = express.Router();
const {
  saisirCotisations,
  getBilanSeance,
  getEtatCotisations,
  getRetardsCotisation,
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
router.get('/etat/:seance_id/:tontine_id', getEtatCotisations);
router.get('/retards/:tontine_id/:seance_id', getRetardsCotisation);

module.exports = router;