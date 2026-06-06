const pool = require('../config/database');
const { generateHash } = require('../utils/helpers');

// ── SAISIR LES COTISATIONS D'UNE SÉANCE ──────────────────────
const saisirCotisations = async (req, res) => {
  const { seance_id, tontine_id, cotisations } = req.body;
  const tenant_id = req.user.tenant_id;

  // cotisations = [{ member_id, nb_parts, a_cotise: true/false }]
  if (!seance_id || !tontine_id || !cotisations) {
    return res.status(400).json({ message: 'Données incomplètes' });
  }

  try {
    // Récupérer le montant de la tontine
    const tontine = await pool.query(
      'SELECT * FROM tontines WHERE id = $1 AND tenant_id = $2',
      [tontine_id, tenant_id]
    );

    if (tontine.rows.length === 0) {
      return res.status(404).json({ message: 'Tontine non trouvée' });
    }

    const montantPart = parseFloat(tontine.rows[0].montant_part);
    let totalCotise = 0;
    let nbCotises = 0;
    let nbNonCotises = 0;
    const nonCotises = [];

    for (const c of cotisations) {
      const montant = c.nb_parts * montantPart;

      // Enregistrer la cotisation
      await pool.query(
        `INSERT INTO cotisations 
          (tenant_id, seance_id, member_id, tontine_id, 
           nb_parts_cotisees, montant_total, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [
          tenant_id, seance_id, c.member_id, tontine_id,
          c.a_cotise ? c.nb_parts : 0,
          c.a_cotise ? montant : 0,
          c.a_cotise ? 'cotise' : 'non_cotise'
        ]
      );

      if (c.a_cotise) {
        totalCotise += montant;
        nbCotises++;

        // Enregistrer dans le journal des transactions
        const hash = generateHash({
          seance_id, member_id: c.member_id,
          tontine_id, montant, timestamp: Date.now()
        });

        await pool.query(
          `INSERT INTO transactions (
            tenant_id, seance_id, member_id,
            type_transaction, montant, sens,
            rubrique_id, created_by,
            signature_hash, metadata_json
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tenant_id, seance_id, c.member_id,
            'cotisation', montant, 'credit',
            tontine_id, req.user.id,
            hash,
            JSON.stringify({
              tontine_id,
              tontine_nom: tontine.rows[0].nom,
              nb_parts: c.nb_parts
            })
          ]
        );

        // Mettre à jour la caisse théorique
        await pool.query(
          'UPDATE seances SET caisse_theorique = caisse_theorique + $1 WHERE id = $2',
          [montant, seance_id]
        );

      } else {
        nbNonCotises++;
        // Récupérer le nom du membre
        const membre = await pool.query(
          'SELECT nom_complet FROM members WHERE id = $1',
          [c.member_id]
        );
        if (membre.rows.length > 0) {
          nonCotises.push(membre.rows[0].nom_complet);
        }
      }
    }

    res.json({
      message: '✅ Cotisations enregistrées',
      resume: {
        tontine: tontine.rows[0].nom,
        nb_cotises: nbCotises,
        nb_non_cotises: nbNonCotises,
        total_cotise: totalCotise,
        non_cotises: nonCotises
      }
    });

  } catch (err) {
    console.error('Erreur saisirCotisations :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── BILAN D'UNE SÉANCE ────────────────────────────────────────
const getBilanSeance = async (req, res) => {
  const { seance_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    // Infos séance
    const seance = await pool.query(
      `SELECT s.*, 
              p.nom_complet as president_seance_nom
       FROM seances s
       LEFT JOIN members p ON p.id = s.president_seance_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [seance_id, tenant_id]
    );

    if (seance.rows.length === 0) {
      return res.status(404).json({ message: 'Séance non trouvée' });
    }

    // Présences
    const presences = await pool.query(
      `SELECT 
        COUNT(CASE WHEN metadata_json->>'statut_presence' = 'present' THEN 1 END) as presents,
        COUNT(CASE WHEN metadata_json->>'statut_presence' = 'absent'  THEN 1 END) as absents,
        COUNT(CASE WHEN metadata_json->>'statut_presence' = 'excuse'  THEN 1 END) as excuses
       FROM transactions
       WHERE seance_id = $1 AND type_transaction = 'pointage'`,
      [seance_id]
    );

    // Cotisations par tontine
    const cotisations = await pool.query(
      `SELECT t.nom as tontine_nom,
              COUNT(CASE WHEN c.statut = 'cotise' THEN 1 END) as nb_cotises,
              COUNT(CASE WHEN c.statut = 'non_cotise' THEN 1 END) as nb_non_cotises,
              SUM(CASE WHEN c.statut = 'cotise' THEN c.montant_total ELSE 0 END) as total_cotise
       FROM cotisations c
       JOIN tontines t ON t.id = c.tontine_id
       WHERE c.seance_id = $1
       GROUP BY t.nom`,
      [seance_id]
    );

    // Membres non cotisés
    const nonCotises = await pool.query(
      `SELECT m.nom_complet, t.nom as tontine_nom
       FROM cotisations c
       JOIN members m ON m.id = c.member_id
       JOIN tontines t ON t.id = c.tontine_id
       WHERE c.seance_id = $1 AND c.statut = 'non_cotise'`,
      [seance_id]
    );

    // Entrées et sorties
    const mouvements = await pool.query(
      `SELECT 
        SUM(CASE WHEN sens = 'credit' AND type_transaction != 'pointage' 
            THEN montant ELSE 0 END) as total_entrees,
        SUM(CASE WHEN sens = 'debit' AND type_transaction != 'pointage'
            THEN montant ELSE 0 END) as total_sorties,
        COUNT(CASE WHEN type_transaction = 'benefice' THEN 1 END) as nb_benefices,
        COUNT(CASE WHEN type_transaction = 'pret' THEN 1 END) as nb_prets
       FROM transactions
       WHERE seance_id = $1`,
      [seance_id]
    );

    res.json({
      seance: seance.rows[0],
      presences: presences.rows[0],
      cotisations: cotisations.rows,
      non_cotises: nonCotises.rows,
      mouvements: mouvements.rows[0]
    });

  } catch (err) {
    console.error('Erreur getBilanSeance :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── HISTORIQUE DES SÉANCES ────────────────────────────────────
const getHistoriqueSeances = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const total = await pool.query(
      `SELECT COUNT(*) FROM seances WHERE tenant_id = $1`,
      [tenant_id]
    );

    const seances = await pool.query(
      `SELECT s.*,
              p.nom_complet as president_seance_nom,
              (SELECT COUNT(*) FROM transactions t
               WHERE t.seance_id = s.id
               AND t.type_transaction = 'pointage'
               AND t.metadata_json->>'statut_presence' = 'present'
              ) as nb_presents,
              (SELECT COALESCE(SUM(montant), 0) FROM transactions t
               WHERE t.seance_id = s.id AND t.sens = 'credit'
               AND t.type_transaction != 'pointage'
              ) as total_entrees
       FROM seances s
       LEFT JOIN members p ON p.id = s.president_seance_id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenant_id, limit, offset]
    );

    res.json({
      total: parseInt(total.rows[0].count),
      page,
      pages: Math.ceil(total.rows[0].count / limit),
      seances: seances.rows
    });

  } catch (err) {
    console.error('Erreur getHistoriqueSeances :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  saisirCotisations,
  getBilanSeance,
  getHistoriqueSeances
};