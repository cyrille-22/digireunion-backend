const express = require('express');
const router = express.Router();
const {
  ouvrirSeance, pointerPresence,
  saisirTransaction, getCaisse, cloturerSeance
} = require('../controllers/seanceController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

// Récupérer la séance ouverte
router.get('/ouverte', async (req, res) => {
  const pool = require('../config/database');
  try {
    const result = await pool.query(
      `SELECT s.*, m.nom_complet as ouvert_par,
              p.nom_complet as president_seance_nom
       FROM seances s
       LEFT JOIN members m ON m.id = s.created_by
       LEFT JOIN members p ON p.id = s.president_seance_id
       WHERE s.tenant_id = $1 AND s.statut = 'ouverte'
       LIMIT 1`,
      [req.user.tenant_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Aucune séance ouverte' });
    }
    res.json({ seance: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.post('/', requireRole('president', 'secretaire'), ouvrirSeance);
router.post('/:id/pointage', requireRole('president', 'secretaire'), pointerPresence);
router.post('/:id/transactions', requireRole('president', 'secretaire'), saisirTransaction);
router.get('/:id/caisse', getCaisse);
router.post('/:id/cloture', requireRole('president', 'secretaire', 'tresorier'), cloturerSeance);

module.exports = router;