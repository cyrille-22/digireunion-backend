const express = require('express');
const router = express.Router();
const {
  addMember, getMembers, getMemberById,
  updateMember, deleteMember
} = require('../controllers/memberController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

// Toutes les routes nécessitent un token
router.use(authMiddleware);

// Lister les membres — tous les rôles du bureau
router.get('/', getMembers);

// Profil d'un membre
router.get('/:id', getMemberById);

// Ajouter un membre — Président et Secrétaire seulement
router.post('/', requireRole('president', 'secretaire'), addMember);

// Modifier un membre
router.put('/:id', requireRole('president', 'secretaire'), updateMember);

// Sortie d'un membre
router.delete('/:id', requireRole('president'), deleteMember);
// Mon profil
router.get('/me', authMiddleware, async (req, res) => {
  const pool = require('../config/database');
  try {
    const result = await pool.query(
      `SELECT * FROM members WHERE id = $1`,
      [req.user.id]
    );
    res.json({ membre: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Mes cotisations par tontine
router.get('/me/cotisations', authMiddleware, async (req, res) => {
  const pool = require('../config/database');
  try {
    const result = await pool.query(
      `SELECT
        t.nom as tontine_nom,
        t.nb_seances_cycle,
        t.seance_courante,
        mt.nb_parts,
        mt.statut as statut_membre,
        COUNT(CASE WHEN c.statut = 'cotise' THEN 1 END)
          as nb_seances_cotisees,
        COUNT(CASE WHEN c.statut = 'non_cotise' THEN 1 END)
          as nb_seances_manquees,
        COALESCE(SUM(CASE WHEN c.statut = 'cotise'
          THEN c.montant_total ELSE 0 END), 0) as total_cotise
       FROM membre_tontine mt
       JOIN tontines t ON t.id = mt.tontine_id
       LEFT JOIN cotisations c ON c.tontine_id = t.id
         AND c.member_id = mt.member_id
       WHERE mt.member_id = $1 AND mt.statut = 'actif'
       GROUP BY t.nom, t.nb_seances_cycle, t.seance_courante,
                mt.nb_parts, mt.statut`,
      [req.user.id]
    );

    res.json({ tontines: result.rows });
  } catch (err) {
    console.error('Erreur cotisations membre :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});
router.patch('/:id/statut', requireRole('president'), toggleStatutMembre);
router.delete('/:id', requireRole('president'), supprimerMembre);
// Mes finances
router.get('/me/finances', authMiddleware, async (req, res) => {
  const pool = require('../config/database');
  try {
    const membre = await pool.query(
      `SELECT gav_solde, score_fiabilite FROM members WHERE id = $1`,
      [req.user.id]
    );

    const epargnes = await pool.query(
      `SELECT e.solde, r.nom as rubrique_nom,
              r.montant_minimum, r.est_obligatoire
       FROM epargne_membres e
       JOIN pret_rubriques r ON r.id = e.rubrique_id
       WHERE e.member_id = $1`,
      [req.user.id]
    );

    const prets = await pool.query(
      `SELECT p.*, r.nom as rubrique_nom,
              (p.montant_total_du - p.montant_rembourse) as reste_a_regler
       FROM prets p
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       WHERE p.member_id = $1 AND p.statut = 'en_cours'`,
      [req.user.id]
    );

    res.json({
      gav_solde:          membre.rows[0]?.gav_solde || 0,
      score_fiabilite:    membre.rows[0]?.score_fiabilite || 100,
      nb_prets_en_cours:  prets.rows.length,
      epargnes:           epargnes.rows,
      prets:              prets.rows
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;