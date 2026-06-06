const pool = require('../config/database');

// ── NOUVELLES FAMILIALES ──────────────────────────────────────

const ajouterNouvelle = async (req, res) => {
  const { seance_id, membre_nom, type_nouvelle, description, member_id } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!seance_id || !membre_nom || !description) {
    return res.status(400).json({ message: 'Données incomplètes' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO nouvelles_familiales
        (tenant_id, seance_id, member_id, membre_nom, type_nouvelle, description)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenant_id, seance_id, member_id || null,
       membre_nom, type_nouvelle || 'autre', description]
    );

    res.status(201).json({
      message: '✅ Nouvelle ajoutée',
      nouvelle: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur ajouterNouvelle :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const getNouvellesSeance = async (req, res) => {
  const { seance_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT * FROM nouvelles_familiales
       WHERE seance_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [seance_id, tenant_id]
    );
    res.json({ nouvelles: result.rows });
  } catch (err) {
    console.error('Erreur getNouvellesSeance :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const supprimerNouvelle = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    await pool.query(
      'DELETE FROM nouvelles_familiales WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    );
    res.json({ message: '✅ Nouvelle supprimée' });
  } catch (err) {
    console.error('Erreur supprimerNouvelle :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── ORDRE DU JOUR ─────────────────────────────────────────────

const ajouterPoint = async (req, res) => {
  const { seance_id, point, ordre } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!seance_id || !point) {
    return res.status(400).json({ message: 'Données incomplètes' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ordre_du_jour
        (tenant_id, seance_id, point, ordre)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [tenant_id, seance_id, point, ordre || 1]
    );

    res.status(201).json({
      message: '✅ Point ajouté',
      point: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur ajouterPoint :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const getOrdreJour = async (req, res) => {
  const { seance_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT * FROM ordre_du_jour
       WHERE seance_id = $1 AND tenant_id = $2
       ORDER BY ordre ASC`,
      [seance_id, tenant_id]
    );
    res.json({ points: result.rows });
  } catch (err) {
    console.error('Erreur getOrdreJour :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const updatePoint = async (req, res) => {
  const { id } = req.params;
  const { statut, notes } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `UPDATE ordre_du_jour SET
        statut = COALESCE($1, statut),
        notes  = COALESCE($2, notes)
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [statut, notes, id, tenant_id]
    );
    res.json({ point: result.rows[0] });
  } catch (err) {
    console.error('Erreur updatePoint :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const supprimerPoint = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    await pool.query(
      'DELETE FROM ordre_du_jour WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id]
    );
    res.json({ message: '✅ Point supprimé' });
  } catch (err) {
    console.error('Erreur supprimerPoint :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── DIVERS ────────────────────────────────────────────────────

const ajouterDivers = async (req, res) => {
  const { seance_id, contenu, auteur_id } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!seance_id || !contenu) {
    return res.status(400).json({ message: 'Données incomplètes' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO divers_seance
        (tenant_id, seance_id, contenu, auteur_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [tenant_id, seance_id, contenu, auteur_id || null]
    );

    res.status(201).json({
      message: '✅ Point divers ajouté',
      divers: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur ajouterDivers :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const getDivers = async (req, res) => {
  const { seance_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT d.*, m.nom_complet as auteur_nom
       FROM divers_seance d
       LEFT JOIN members m ON m.id = d.auteur_id
       WHERE d.seance_id = $1 AND d.tenant_id = $2
       ORDER BY d.created_at ASC`,
      [seance_id, tenant_id]
    );
    res.json({ divers: result.rows });
  } catch (err) {
    console.error('Erreur getDivers :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  ajouterNouvelle, getNouvellesSeance, supprimerNouvelle,
  ajouterPoint, getOrdreJour, updatePoint, supprimerPoint,
  ajouterDivers, getDivers
};