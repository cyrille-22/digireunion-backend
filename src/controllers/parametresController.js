const pool = require('../config/database');

// ── GET PARAMÈTRES ────────────────────────────────────────────
const getParametres = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM members m
               WHERE m.tenant_id = t.id
               AND m.statut = 'actif') as nb_membres,
              (SELECT COUNT(*) FROM tontines to2
               WHERE to2.tenant_id = t.id
               AND to2.statut = 'actif') as nb_tontines,
              (SELECT COUNT(*) FROM seances s
               WHERE s.tenant_id = t.id
               AND s.statut = 'close') as nb_seances
       FROM tenants t
       WHERE t.id = $1`,
      [tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Association non trouvée'
      });
    }

    res.json({ parametres: result.rows[0] });

  } catch (err) {
    console.error('Erreur getParametres :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── UPDATE PARAMÈTRES ─────────────────────────────────────────
const updateParametres = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const {
    nom, description, lieu_reunion,
    periodicite_seance, telephone,
    email, date_creation_asso,
    roles_actifs
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tenants SET
        nom = COALESCE($1, nom),
        description = COALESCE($2, description),
        lieu_reunion = COALESCE($3, lieu_reunion),
        periodicite_seance = COALESCE($4, periodicite_seance),
        telephone = COALESCE($5, telephone),
        email = COALESCE($6, email),
        date_creation_asso = COALESCE($7, date_creation_asso),
        roles_actifs = COALESCE($8, roles_actifs),
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        nom, description, lieu_reunion,
        periodicite_seance, telephone,
        email, date_creation_asso,
        roles_actifs ? JSON.stringify(roles_actifs) : null,
        tenant_id
      ]
    );

    res.json({
      message: '✅ Paramètres mis à jour',
      parametres: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur updateParametres :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── STATS COMPLÈTES ───────────────────────────────────────────
const getStats = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    // Membres par rôle
    const membresParRole = await pool.query(
      `SELECT role, COUNT(*) as nb
       FROM members
       WHERE tenant_id = $1 AND statut = 'actif'
       GROUP BY role ORDER BY nb DESC`,
      [tenant_id]
    );

    // Évolution des séances
    const seances = await pool.query(
      `SELECT numero, date_seance,
              caisse_theorique, caisse_physique, ecart,
              (SELECT COALESCE(SUM(montant_total), 0)
               FROM cotisations c
               WHERE c.seance_id = s.id
               AND c.statut = 'cotise') as total_cotise
       FROM seances s
       WHERE tenant_id = $1 AND statut = 'close'
       ORDER BY numero DESC LIMIT 10`,
      [tenant_id]
    );

    // Total épargnes par rubrique
    const epargnes = await pool.query(
      `SELECT r.nom, COALESCE(SUM(e.solde), 0) as total_epargne,
              COUNT(e.member_id) as nb_membres
       FROM pret_rubriques r
       LEFT JOIN epargne_membres e ON e.rubrique_id = r.id
       WHERE r.tenant_id = $1
       AND r.type_rubrique IN ('epargne','fond')
       GROUP BY r.nom`,
      [tenant_id]
    );

    // Prêts en cours
    const pretsStats = await pool.query(
      `SELECT
        COUNT(CASE WHEN statut = 'en_cours' THEN 1 END) as en_cours,
        COUNT(CASE WHEN statut = 'solde' THEN 1 END) as soldes,
        COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as en_attente,
        COALESCE(SUM(CASE WHEN statut = 'en_cours'
          THEN montant_total_du - montant_rembourse END), 0) as total_restant
       FROM prets
       WHERE tenant_id = $1`,
      [tenant_id]
    );

    res.json({
      membres_par_role: membresParRole.rows,
      dernieres_seances: seances.rows,
      epargnes_par_rubrique: epargnes.rows,
      prets_stats: pretsStats.rows[0]
    });

  } catch (err) {
    console.error('Erreur getStats :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// ── RÉINITIALISER L'ASSOCIATION (DANGER) ─────────────────────
const reinitialiserAssociation = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { confirmation } = req.body;

  if (confirmation !== 'REINITIALISER') {
    return res.status(400).json({
      message: 'Confirmation invalide. Tapez exactement REINITIALISER'
    });
  }

  try {
    await pool.query('BEGIN');

    // Supprimer toutes les données liées sauf le tenant et le président
    await pool.query(
      `DELETE FROM transactions WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM remboursements WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM prets WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM epargne_membres WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM cotisations WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM beneficiaires_tontine WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM nouvelles_familiales WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM ordre_du_jour WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM divers_seance WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM seances WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM membre_tontine WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM rubriques_deduction WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM pret_rubriques WHERE tenant_id = $1`, [tenant_id]);
    await pool.query(
      `DELETE FROM tontines WHERE tenant_id = $1`, [tenant_id]);

    // Supprimer tous les membres sauf le président
    await pool.query(
      `DELETE FROM members WHERE tenant_id = $1 AND role != 'president'`,
      [tenant_id]
    );

    // Réinitialiser le GAV et score du président
    await pool.query(
      `UPDATE members SET gav_solde = 0, score_fiabilite = 100
       WHERE tenant_id = $1`,
      [tenant_id]
    );

    await pool.query('COMMIT');

    res.json({
      message: '✅ Association réinitialisée. ' +
        'Vous pouvez reconfigurer depuis zéro.'
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Erreur reinitialiserAssociation :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports.reinitialiserAssociation = reinitialiserAssociation;

module.exports = { getParametres, updateParametres, getStats };