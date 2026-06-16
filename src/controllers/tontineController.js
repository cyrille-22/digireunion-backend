const pool = require('../config/database');

// ── CRÉER UNE TONTINE ─────────────────────────────────────────
const createTontine = async (req, res) => {
  const {
    nom, montant_part, periodicite,
    nb_beneficiaires_seance, mode_attribution,
    parts_multiples, penalite_absence, regle_reliquat
  } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!nom || !montant_part) {
    return res.status(400).json({ message: 'Nom et montant requis' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tontines (
        tenant_id, nom, montant_part, periodicite,
        nb_beneficiaires_seance, mode_attribution,
        parts_multiples, penalite_absence, regle_reliquat
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        tenant_id, nom, montant_part,
        periodicite || 'hebdo',
        nb_beneficiaires_seance || 1,
        mode_attribution || 'tour_role',
        parts_multiples !== undefined ? parts_multiples : true,
        penalite_absence || 0,
        regle_reliquat || 'reporter'
      ]
    );

    res.status(201).json({
      message: '✅ Tontine créée avec succès',
      tontine: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur createTontine :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── LISTER LES TONTINES ───────────────────────────────────────
const getTontines = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT * FROM tontines
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenant_id]
    );

    res.json({
      total: result.rows.length,
      tontines: result.rows
    });

  } catch (err) {
    console.error('Erreur getTontines :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── DÉTAIL D'UNE TONTINE ──────────────────────────────────────
const getTontineById = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      'SELECT * FROM tontines WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tontine non trouvée' });
    }

    res.json({ tontine: result.rows[0] });

  } catch (err) {
    console.error('Erreur getTontineById :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── MODIFIER UNE TONTINE ──────────────────────────────────────
const updateTontine = async (req, res) => {
  const { id } = req.params;
  const {
    nom, montant_part, periodicite,
    nb_beneficiaires_seance, mode_attribution,
    parts_multiples, penalite_absence,
    regle_reliquat, statut
  } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `UPDATE tontines SET
        nom = COALESCE($1, nom),
        montant_part = COALESCE($2, montant_part),
        periodicite = COALESCE($3, periodicite),
        nb_beneficiaires_seance = COALESCE($4, nb_beneficiaires_seance),
        mode_attribution = COALESCE($5, mode_attribution),
        parts_multiples = COALESCE($6, parts_multiples),
        penalite_absence = COALESCE($7, penalite_absence),
        regle_reliquat = COALESCE($8, regle_reliquat),
        statut = COALESCE($9, statut)
       WHERE id = $10 AND tenant_id = $11
       RETURNING *`,
      [
        nom, montant_part, periodicite,
        nb_beneficiaires_seance, mode_attribution,
        parts_multiples, penalite_absence,
        regle_reliquat, statut, id, tenant_id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tontine non trouvée' });
    }

    res.json({
      message: '✅ Tontine mise à jour',
      tontine: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur updateTontine :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// ── SUPPRIMER UNE TONTINE ─────────────────────────────────────
const supprimerTontine = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const cotisations = await pool.query(
      'SELECT COUNT(*) FROM cotisations WHERE tontine_id = $1',
      [id]
    );

    if (parseInt(cotisations.rows[0].count) > 0) {
      return res.status(400).json({
        message: 'Cette tontine a déjà des cotisations enregistrées. ' +
          'Désactivez-la plutôt que de la supprimer.'
      });
    }

    await pool.query(
      'DELETE FROM membre_tontine WHERE tontine_id = $1', [id]
    );
    await pool.query(
      'DELETE FROM tontines WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    );

    res.json({ message: '✅ Tontine supprimée' });
  } catch (err) {
    console.error('Erreur supprimerTontine :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports.supprimerTontine = supprimerTontine;
module.exports = {
  createTontine, getTontines,
  getTontineById, updateTontine, supprimerTontine
};