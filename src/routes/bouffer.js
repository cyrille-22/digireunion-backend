const express = require('express');
const router = express.Router();
const {
  preparerBouffer,
  confirmerBouffer,
  getHistoriqueBeneficiaires
} = require('../controllers/boufferController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

// Préparer le bouffer
router.get(
  '/preparer/:seance_id/:tontine_id/:member_id',
  preparerBouffer
);

// Confirmer le bouffer
router.post(
  '/confirmer',
  requireRole('president', 'secretaire'),
  confirmerBouffer
);

// Historique bénéficiaires
router.get(
  '/historique/:tontine_id',
  getHistoriqueBeneficiaires
);

module.exports = router;