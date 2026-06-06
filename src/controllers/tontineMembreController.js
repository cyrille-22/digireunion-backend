const pool = require('../config/database');

// ── INSCRIRE UN MEMBRE À UNE TONTINE ─────────────────────────
const inscrireMembre = async (req, res) => {
  const { tontine_id, member_id, nb_parts } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!tontine_id || !member_id) {
    return res.status(400).json({ message: 'tontine_id et member_id requis' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO membre_tontine (tenant_id, member_id, tontine_id, nb_parts)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (member_id, tontine_id)
       DO UPDATE SET nb_parts = $4
       RETURNING *`,
      [tenant_id, member_id, tontine_id, nb_parts || 1]
    );

    res.status(201).json({
      message: '✅ Membre inscrit à la tontine',
      inscription: result.rows[0]
    });

  } catch (err) {
    console.error('Erreur inscrireMembre :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── MEMBRES D'UNE TONTINE ─────────────────────────────────────
const getMembresTontine = async (req, res) => {
  const { tontine_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT mt.*, m.nom_complet, m.telephone, m.statut as statut_membre,
              t.montant_part, t.nom as tontine_nom,
              (mt.nb_parts * t.montant_part) as montant_du
       FROM membre_tontine mt
       JOIN members m ON m.id = mt.member_id
       JOIN tontines t ON t.id = mt.tontine_id
       WHERE mt.tontine_id = $1 AND mt.tenant_id = $2
       AND mt.statut = 'actif'
       ORDER BY m.nom_complet ASC`,
      [tontine_id, tenant_id]
    );

    const tontine = result.rows[0];
    const totalAttendu = result.rows.reduce(
      (sum, r) => sum + parseFloat(r.montant_du), 0
    );

    res.json({
      tontine_nom: tontine?.tontine_nom,
      montant_part: tontine?.montant_part,
      total_attendu: totalAttendu,
      nb_membres: result.rows.length,
      membres: result.rows
    });

  } catch (err) {
    console.error('Erreur getMembresTontine :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { inscrireMembre, getMembresTontine };