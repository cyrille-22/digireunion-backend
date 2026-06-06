const pool = require('../config/database');
const { generateHash } = require('../utils/helpers');

// ── COTISER À UNE RUBRIQUE D'ÉPARGNE ─────────────────────────
const cotiserEpargne = async (req, res) => {
  const { member_id, rubrique_id, montant, seance_id } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!member_id || !rubrique_id || !montant) {
    return res.status(400).json({ message: 'Données incomplètes' });
  }

  try {
    // Vérifier la rubrique
    const rubrique = await pool.query(
      `SELECT * FROM pret_rubriques 
       WHERE id = $1 AND tenant_id = $2 AND actif = TRUE`,
      [rubrique_id, tenant_id]
    );

    if (rubrique.rows.length === 0) {
      return res.status(404).json({ message: 'Rubrique non trouvée' });
    }

    const rb = rubrique.rows[0];

    // Mettre à jour ou créer l'épargne du membre
    await pool.query(
      `INSERT INTO epargne_membres 
        (tenant_id, member_id, rubrique_id, solde, total_cotise)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (member_id, rubrique_id)
       DO UPDATE SET 
         solde = epargne_membres.solde + $4,
         total_cotise = epargne_membres.total_cotise + $4,
         updated_at = NOW()`,
      [tenant_id, member_id, rubrique_id, montant]
    );

    // Vérifier si le membre atteint le montant minimum du fond
    if (rb.est_obligatoire && rb.montant_minimum > 0) {
      const epargne = await pool.query(
        `SELECT solde FROM epargne_membres 
         WHERE member_id = $1 AND rubrique_id = $2`,
        [member_id, rubrique_id]
      );

      if (parseFloat(epargne.rows[0].solde) >= parseFloat(rb.montant_minimum)) {
        // Activer le membre
        await pool.query(
          `UPDATE members SET statut = 'actif' WHERE id = $1`,
          [member_id]
        );
      }
    }

    // Enregistrer dans le journal
    const hash = generateHash({
      seance_id, member_id, rubrique_id,
      montant, timestamp: Date.now()
    });

    await pool.query(
      `INSERT INTO transactions (
        tenant_id, seance_id, member_id,
        type_transaction, montant, sens,
        rubrique_id, created_by,
        signature_hash, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenant_id, seance_id, member_id,
        'epargne', montant, 'credit',
        rubrique_id, req.user.id,
        hash,
        JSON.stringify({ rubrique_nom: rb.nom, type: rb.type_rubrique })
      ]
    );

    // Mettre à jour la caisse
    if (seance_id) {
      await pool.query(
        `UPDATE seances SET caisse_theorique = caisse_theorique + $1 
         WHERE id = $2`,
        [montant, seance_id]
      );
    }

    res.json({
      message: `✅ Cotisation ${rb.nom} enregistrée`,
      montant,
      rubrique: rb.nom
    });

  } catch (err) {
    console.error('Erreur cotiserEpargne :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── SOLDE ÉPARGNE D'UN MEMBRE ─────────────────────────────────
const getSoldeEpargne = async (req, res) => {
  const { member_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT e.*, r.nom as rubrique_nom, r.type_rubrique,
              r.montant_minimum, r.interet_epargne,
              r.est_obligatoire,
              CASE WHEN e.solde >= r.montant_minimum 
                THEN TRUE ELSE FALSE END as objectif_atteint
       FROM epargne_membres e
       JOIN pret_rubriques r ON r.id = e.rubrique_id
       WHERE e.member_id = $1 AND e.tenant_id = $2`,
      [member_id, tenant_id]
    );

    res.json({
      member_id,
      epargnes: result.rows,
      total_epargne: result.rows.reduce(
        (s, e) => s + parseFloat(e.solde), 0
      )
    });

  } catch (err) {
    console.error('Erreur getSoldeEpargne :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── TOUTES LES ÉPARGNES DE L'ASSOCIATION ─────────────────────
const getAllEpargnes = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT m.nom_complet, m.statut as statut_membre,
              r.nom as rubrique_nom, r.type_rubrique,
              r.montant_minimum, r.est_obligatoire,
              COALESCE(e.solde, 0) as solde,
              COALESCE(e.total_cotise, 0) as total_cotise,
              CASE WHEN COALESCE(e.solde, 0) >= r.montant_minimum 
                THEN TRUE ELSE FALSE END as objectif_atteint
       FROM members m
       CROSS JOIN pret_rubriques r
       LEFT JOIN epargne_membres e ON e.member_id = m.id 
         AND e.rubrique_id = r.id
       WHERE m.tenant_id = $1 AND r.tenant_id = $1
         AND r.actif = TRUE
         AND r.type_rubrique IN ('epargne', 'fond')
         AND m.statut != 'sorti'
       ORDER BY r.nom, m.nom_complet`,
      [tenant_id]
    );

    res.json({ epargnes: result.rows });

  } catch (err) {
    console.error('Erreur getAllEpargnes :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { cotiserEpargne, getSoldeEpargne, getAllEpargnes };