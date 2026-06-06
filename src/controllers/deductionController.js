const pool = require('../config/database');

// ── CRÉER UNE RUBRIQUE DE DÉDUCTION ──────────────────────────
const createDeduction = async (req, res) => {
  const {
    nom, type_montant, montant,
    pourcentage, applicable_a, ordre
  } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!nom) {
    return res.status(400).json({ message: 'Nom requis' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO rubriques_deduction (
        tenant_id, nom, type_montant,
        montant, pourcentage, applicable_a, ordre
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        tenant_id, nom,
        type_montant || 'fixe',
        montant || 0,
        pourcentage || 0,
        applicable_a || 'toutes',
        ordre || 1
      ]
    );

    res.status(201).json({
      message: '✅ Rubrique de déduction créée',
      deduction: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur createDeduction :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── LISTER LES DÉDUCTIONS ─────────────────────────────────────
const getDeductions = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT * FROM rubriques_deduction
       WHERE tenant_id = $1 AND actif = TRUE
       ORDER BY ordre ASC`,
      [tenant_id]
    );

    res.json({
      total: result.rows.length,
      deductions: result.rows
    });

  } catch (err) {
    console.error('Erreur getDeductions :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── MODIFIER UNE DÉDUCTION ────────────────────────────────────
const updateDeduction = async (req, res) => {
  const { id } = req.params;
  const {
    nom, type_montant, montant,
    pourcentage, applicable_a, ordre, actif
  } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `UPDATE rubriques_deduction SET
        nom = COALESCE($1, nom),
        type_montant = COALESCE($2, type_montant),
        montant = COALESCE($3, montant),
        pourcentage = COALESCE($4, pourcentage),
        applicable_a = COALESCE($5, applicable_a),
        ordre = COALESCE($6, ordre),
        actif = COALESCE($7, actif)
       WHERE id = $8 AND tenant_id = $9
       RETURNING *`,
      [
        nom, type_montant, montant,
        pourcentage, applicable_a, ordre,
        actif, id, tenant_id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Déduction non trouvée' });
    }

    res.json({
      message: '✅ Déduction mise à jour',
      deduction: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur updateDeduction :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── SUPPRIMER UNE DÉDUCTION ───────────────────────────────────
const deleteDeduction = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    await pool.query(
      `UPDATE rubriques_deduction SET actif = FALSE
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );

    res.json({ message: '✅ Déduction supprimée' });

  } catch (err) {
    console.error('Erreur deleteDeduction :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  createDeduction, getDeductions,
  updateDeduction, deleteDeduction
};