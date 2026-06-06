const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/stats', async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    // Caisse disponible (dernière séance clôturée)
    const caisse = await pool.query(
      `SELECT caisse_theorique FROM seances
       WHERE tenant_id = $1 AND statut = 'close'
       ORDER BY created_at DESC LIMIT 1`,
      [tenant_id]
    );

    // Nombre de séances clôturées
    const nbSeances = await pool.query(
      `SELECT COUNT(*) as nb FROM seances
       WHERE tenant_id = $1 AND statut = 'close'`,
      [tenant_id]
    );

    // Prêts en cours
    const prets = await pool.query(
      `SELECT p.*, m.nom_complet, r.nom as rubrique_nom,
              (p.montant_total_du - p.montant_rembourse) as reste_a_regler
       FROM prets p
       JOIN members m ON m.id = p.member_id
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       WHERE p.tenant_id = $1 AND p.statut = 'en_cours'
       ORDER BY p.created_at DESC`,
      [tenant_id]
    );

    // Total prêts en souffrance
    const totalPrets = prets.rows.reduce(
      (s, p) => s + parseFloat(p.reste_a_regler), 0
    );

    res.json({
      caisse_disponible:
        parseFloat(caisse.rows[0]?.caisse_theorique || 0),
      nb_seances_closes:
        parseInt(nbSeances.rows[0]?.nb || 0),
      prets_en_cours:    prets.rows,
      total_prets:       totalPrets
    });

  } catch (err) {
    console.error('Erreur dashboard stats :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;