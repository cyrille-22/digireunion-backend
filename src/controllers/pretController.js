const pool = require('../config/database');

// ── CRÉER UNE RUBRIQUE DE PRÊT ────────────────────────────────
const createRubrique = async (req, res) => {
  const {
    nom, plafond, taux_interet,
    periodicite_interet, mode_calcul_interet,
    duree_max_seances, penalite_retard,
    validation_requise
  } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!nom) {
    return res.status(400).json({ message: 'Nom de la rubrique requis' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO pret_rubriques (
        tenant_id, nom, plafond, taux_interet,
        periodicite_interet, mode_calcul_interet,
        duree_max_seances, penalite_retard,
        validation_requise
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        tenant_id, nom,
        plafond || null,
        taux_interet || 0,
        periodicite_interet || 'mensuel',
        mode_calcul_interet || 'simple',
        duree_max_seances || 4,
        penalite_retard || 0,
        validation_requise || 'president'
      ]
    );

    res.status(201).json({
      message: '✅ Rubrique de prêt créée avec succès',
      rubrique: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur createRubrique :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── LISTER LES RUBRIQUES ──────────────────────────────────────
const getRubriques = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT * FROM pret_rubriques
       WHERE tenant_id = $1 AND actif = TRUE
       ORDER BY created_at ASC`,
      [tenant_id]
    );

    res.json({
      total: result.rows.length,
      rubriques: result.rows
    });

  } catch (err) {
    console.error('Erreur getRubriques :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── MODIFIER UNE RUBRIQUE ─────────────────────────────────────
const updateRubrique = async (req, res) => {
  const { id } = req.params;
  const {
    nom, plafond, taux_interet,
    periodicite_interet, mode_calcul_interet,
    duree_max_seances, penalite_retard,
    validation_requise, actif
  } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `UPDATE pret_rubriques SET
        nom = COALESCE($1, nom),
        plafond = COALESCE($2, plafond),
        taux_interet = COALESCE($3, taux_interet),
        periodicite_interet = COALESCE($4, periodicite_interet),
        mode_calcul_interet = COALESCE($5, mode_calcul_interet),
        duree_max_seances = COALESCE($6, duree_max_seances),
        penalite_retard = COALESCE($7, penalite_retard),
        validation_requise = COALESCE($8, validation_requise),
        actif = COALESCE($9, actif)
       WHERE id = $10 AND tenant_id = $11
       RETURNING *`,
      [
        nom, plafond, taux_interet,
        periodicite_interet, mode_calcul_interet,
        duree_max_seances, penalite_retard,
        validation_requise, actif, id, tenant_id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Rubrique non trouvée' });
    }

    res.json({
      message: '✅ Rubrique mise à jour',
      rubrique: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur updateRubrique :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// ── SUPPRIMER UNE RUBRIQUE DE PRÊT/ÉPARGNE ───────────────────
const supprimerRubrique = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const usage = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM prets WHERE rubrique_id = $1) as nb_prets,
        (SELECT COUNT(*) FROM epargne_membres WHERE rubrique_id = $1
          AND solde > 0) as nb_epargnes`,
      [id]
    );

    if (parseInt(usage.rows[0].nb_prets) > 0 ||
        parseInt(usage.rows[0].nb_epargnes) > 0) {
      return res.status(400).json({
        message: 'Cette rubrique a des prêts ou épargnes actifs. ' +
          'Désactivez-la plutôt que de la supprimer.'
      });
    }

    await pool.query(
      'DELETE FROM epargne_membres WHERE rubrique_id = $1', [id]
    );
    await pool.query(
      'DELETE FROM pret_rubriques WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    );

    res.json({ message: '✅ Rubrique supprimée' });
  } catch (err) {
    console.error('Erreur supprimerRubrique :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports.supprimerRubrique = supprimerRubrique;
module.exports = { createRubrique, getRubriques, updateRubrique, supprimerRubrique };