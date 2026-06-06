const pool = require('../config/database');

// ── AJOUTER UN MEMBRE ─────────────────────────────────────────
const addMember = async (req, res) => {
  const { nom_complet, telephone, role } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!nom_complet || !telephone) {
    return res.status(400).json({ message: 'Nom et téléphone requis' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO members (tenant_id, nom_complet, telephone, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nom_complet, telephone, role, statut, created_at`,
      [tenant_id, nom_complet, telephone, role || 'membre']
    );

    res.status(201).json({
      message: '✅ Membre ajouté avec succès',
      membre: result.rows[0]
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Ce numéro existe déjà dans votre association' });
    }
    console.error('Erreur addMember :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── LISTER LES MEMBRES ────────────────────────────────────────
const getMembers = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT id, nom_complet, telephone, role, statut,
              date_adhesion, score_fiabilite, gav_solde
       FROM members
       WHERE tenant_id = $1
       ORDER BY nom_complet ASC`,
      [tenant_id]
    );

    res.json({
      total: result.rows.length,
      membres: result.rows
    });

  } catch (err) {
    console.error('Erreur getMembers :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── PROFIL D'UN MEMBRE ────────────────────────────────────────
const getMemberById = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT id, nom_complet, telephone, role, statut,
              date_adhesion, score_fiabilite, gav_solde
       FROM members
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Membre non trouvé' });
    }

    res.json({ membre: result.rows[0] });

  } catch (err) {
    console.error('Erreur getMemberById :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── MODIFIER UN MEMBRE ────────────────────────────────────────
const updateMember = async (req, res) => {
  const { id } = req.params;
  const { nom_complet, role, statut } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `UPDATE members
       SET nom_complet = COALESCE($1, nom_complet),
           role = COALESCE($2, role),
           statut = COALESCE($3, statut)
       WHERE id = $4 AND tenant_id = $5
       RETURNING id, nom_complet, telephone, role, statut`,
      [nom_complet, role, statut, id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Membre non trouvé' });
    }

    res.json({
      message: '✅ Membre mis à jour',
      membre: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur updateMember :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── SUPPRIMER UN MEMBRE ───────────────────────────────────────
const deleteMember = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    // Soft delete — on change juste le statut
    const result = await pool.query(
      `UPDATE members SET statut = 'sorti'
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, nom_complet`,
      [id, tenant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Membre non trouvé' });
    }

    res.json({
      message: `✅ ${result.rows[0].nom_complet} marqué comme sorti`,
    });

  } catch (err) {
    console.error('Erreur deleteMember :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { addMember, getMembers, getMemberById, updateMember, deleteMember };