const express = require('express');
const router  = express.Router();
const {
  ajouterNouvelle, getNouvellesSeance, supprimerNouvelle,
  ajouterPoint, getOrdreJour, updatePoint, supprimerPoint,
  ajouterDivers, getDivers
} = require('../controllers/nouvellesController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

// Nouvelles familiales
router.post('/nouvelles', requireRole('president','secretaire'), ajouterNouvelle);
router.get('/nouvelles/:seance_id', getNouvellesSeance);
router.delete('/nouvelles/:id', requireRole('president','secretaire'), supprimerNouvelle);

// Ordre du jour
router.post('/ordre-du-jour', requireRole('president','secretaire'), ajouterPoint);
router.get('/ordre-du-jour/:seance_id', getOrdreJour);
router.put('/ordre-du-jour/:id', requireRole('president','secretaire'), updatePoint);
router.delete('/ordre-du-jour/:id', requireRole('president','secretaire'), supprimerPoint);

// Divers
router.post('/divers', requireRole('president','secretaire'), ajouterDivers);
router.get('/divers/:seance_id', getDivers);

module.exports = router;