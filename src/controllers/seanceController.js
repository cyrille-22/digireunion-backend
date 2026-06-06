const pool = require('../config/database');
const { generateHash } = require('../utils/helpers');

// ── OUVRIR UNE SÉANCE ────────────────────────────────────────
const ouvrirSeance = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const created_by = req.user.id;
  const { president_seance_id, notes_ouverture } = req.body;

  try {
    const seanceOuverte = await pool.query(
      `SELECT id FROM seances WHERE tenant_id = $1 AND statut = 'ouverte'`,
      [tenant_id]
    );

    if (seanceOuverte.rows.length > 0) {
      return res.status(400).json({
        message: "Une séance est déjà ouverte. Clôturez-la avant d'en ouvrir une nouvelle."
      });
    }

    const lastSeance = await pool.query(
      `SELECT MAX(numero) as derniere FROM seances WHERE tenant_id = $1`,
      [tenant_id]
    );
    const numero = (lastSeance.rows[0].derniere || 0) + 1;

    const lastCaisse = await pool.query(
      `SELECT caisse_theorique FROM seances
       WHERE tenant_id = $1 AND statut = 'close'
       ORDER BY created_at DESC LIMIT 1`,
      [tenant_id]
    );
    const reliquat = lastCaisse.rows.length > 0
      ? parseFloat(lastCaisse.rows[0].caisse_theorique) : 0;

    const result = await pool.query(
      `INSERT INTO seances
        (tenant_id, numero, caisse_theorique, created_by,
         president_seance_id, notes_ouverture)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [tenant_id, numero, reliquat, created_by,
       president_seance_id || null, notes_ouverture || null]
    );

    res.status(201).json({
      message: `✅ Séance #${numero} ouverte avec succès`,
      seance: result.rows[0],
      reliquat_reporte: reliquat
    });

  } catch (err) {
    console.error('Erreur ouvrirSeance :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// ── POINTAGE DES PRÉSENCES ────────────────────────────────────
const pointerPresence = async (req, res) => {
  const { id } = req.params;
  const { pointages } = req.body;
  const tenant_id = req.user.tenant_id;

  // pointages = [{ member_id, statut: 'present'|'absent'|'excuse' }]
  if (!pointages || !Array.isArray(pointages)) {
    return res.status(400).json({ message: 'Liste de pointages requise' });
  }

  try {
    // Vérifier que la séance existe et est ouverte
    const seance = await pool.query(
      `SELECT id FROM seances
       WHERE id = $1 AND tenant_id = $2 AND statut = 'ouverte'`,
      [id, tenant_id]
    );

    if (seance.rows.length === 0) {
      return res.status(404).json({ message: 'Séance non trouvée ou déjà clôturée' });
    }

    // Enregistrer les pointages comme transactions
    let absents = 0;
    for (const p of pointages) {
      const hash = generateHash({
        seance_id: id, member_id: p.member_id,
        type: 'pointage', statut: p.statut,
        timestamp: Date.now()
      });

      await pool.query(
        `INSERT INTO transactions (
          tenant_id, seance_id, member_id,
          type_transaction, montant, sens,
          created_by, signature_hash, metadata_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tenant_id, id, p.member_id,
          'pointage', 0, 'credit',
          req.user.id, hash,
          JSON.stringify({ statut_presence: p.statut })
        ]
      );

      // Appliquer pénalité si absent
      if (p.statut === 'absent') {
        absents++;
        // Récupérer la pénalité configurée
        const tontine = await pool.query(
          `SELECT penalite_absence FROM tontines
           WHERE tenant_id = $1 AND statut = 'actif' LIMIT 1`,
          [tenant_id]
        );

        if (tontine.rows.length > 0 &&
            parseFloat(tontine.rows[0].penalite_absence) > 0) {
          const penalite = parseFloat(tontine.rows[0].penalite_absence);
          const hashPenalite = generateHash({
            seance_id: id, member_id: p.member_id,
            type: 'penalite', timestamp: Date.now()
          });

          await pool.query(
            `INSERT INTO transactions (
              tenant_id, seance_id, member_id,
              type_transaction, montant, sens,
              created_by, signature_hash, metadata_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              tenant_id, id, p.member_id,
              'penalite_absence', penalite, 'debit',
              req.user.id, hashPenalite,
              JSON.stringify({ motif: 'Absence non excusée' })
            ]
          );
        }
      }
    }

    const presents = pointages.filter(p => p.statut === 'present').length;
    const excuses = pointages.filter(p => p.statut === 'excuse').length;

    res.json({
      message: '✅ Pointage enregistré avec succès',
      resume: {
        total: pointages.length,
        presents,
        absents,
        excuses
      }
    });

  } catch (err) {
    console.error('Erreur pointerPresence :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── SAISIR UNE TRANSACTION ────────────────────────────────────
const saisirTransaction = async (req, res) => {
  const { id } = req.params;
  const {
    member_id, type_transaction,
    montant, sens, rubrique_id, metadata
  } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!member_id || !type_transaction || !montant || !sens) {
    return res.status(400).json({
      message: 'member_id, type_transaction, montant et sens requis'
    });
  }

  try {
    // Vérifier que la séance est ouverte
    const seance = await pool.query(
      `SELECT id, caisse_theorique FROM seances
       WHERE id = $1 AND tenant_id = $2 AND statut = 'ouverte'`,
      [id, tenant_id]
    );

    if (seance.rows.length === 0) {
      return res.status(404).json({ message: 'Séance non trouvée ou clôturée' });
    }

    // Générer le hash de la transaction
    const hash = generateHash({
      seance_id: id, member_id,
      type_transaction, montant,
      sens, timestamp: Date.now()
    });

    // Enregistrer la transaction
    const result = await pool.query(
      `INSERT INTO transactions (
        tenant_id, seance_id, member_id,
        type_transaction, montant, sens,
        rubrique_id, created_by,
        signature_hash, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        tenant_id, id, member_id,
        type_transaction, montant, sens,
        rubrique_id || null, req.user.id,
        hash, metadata ? JSON.stringify(metadata) : null
      ]
    );

    // Mettre à jour la caisse théorique
    const caisseCourante = parseFloat(seance.rows[0].caisse_theorique);
    const montantTx = parseFloat(montant);
    const nouvelleCaisse = sens === 'credit'
      ? caisseCourante + montantTx
      : caisseCourante - montantTx;

    await pool.query(
      'UPDATE seances SET caisse_theorique = $1 WHERE id = $2',
      [nouvelleCaisse, id]
    );

    // Mettre à jour le GAV si nécessaire
    if (type_transaction === 'gav_depot') {
      await pool.query(
        'UPDATE members SET gav_solde = gav_solde + $1 WHERE id = $2',
        [montant, member_id]
      );
    } else if (type_transaction === 'gav_retrait') {
      await pool.query(
        'UPDATE members SET gav_solde = gav_solde - $1 WHERE id = $2',
        [montant, member_id]
      );
    }

    res.status(201).json({
      message: '✅ Transaction enregistrée',
      transaction: result.rows[0],
      caisse_theorique: nouvelleCaisse
    });

  } catch (err) {
    console.error('Erreur saisirTransaction :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── CAISSE EN TEMPS RÉEL ──────────────────────────────────────
const getCaisse = async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const seance = await pool.query(
      `SELECT s.*, m.nom_complet as ouvert_par
       FROM seances s
       LEFT JOIN members m ON m.id = s.created_by
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [id, tenant_id]
    );

    if (seance.rows.length === 0) {
      return res.status(404).json({ message: 'Séance non trouvée' });
    }

    // Récupérer toutes les transactions de la séance
    const transactions = await pool.query(
      `SELECT t.*, m.nom_complet as membre_nom
       FROM transactions t
       LEFT JOIN members m ON m.id = t.member_id
       WHERE t.seance_id = $1
       AND t.type_transaction != 'pointage'
       ORDER BY t.created_at ASC`,
      [id]
    );

    // Calculer les totaux
    const totalCredits = transactions.rows
      .filter(t => t.sens === 'credit')
      .reduce((sum, t) => sum + parseFloat(t.montant), 0);

    const totalDebits = transactions.rows
      .filter(t => t.sens === 'debit')
      .reduce((sum, t) => sum + parseFloat(t.montant), 0);

    res.json({
      seance: seance.rows[0],
      caisse: {
        theorique: parseFloat(seance.rows[0].caisse_theorique),
        total_entrees: totalCredits,
        total_sorties: totalDebits,
      },
      transactions: transactions.rows,
      nb_transactions: transactions.rows.length
    });

  } catch (err) {
    console.error('Erreur getCaisse :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── CLÔTURER UNE SÉANCE ───────────────────────────────────────
const cloturerSeance = async (req, res) => {
  const { id } = req.params;
  const { caisse_physique, justification_ecart } = req.body;
  const tenant_id = req.user.tenant_id;

  if (caisse_physique === undefined) {
    return res.status(400).json({ message: 'Montant de la caisse physique requis' });
  }

  try {
    const seance = await pool.query(
      `SELECT * FROM seances
       WHERE id = $1 AND tenant_id = $2 AND statut = 'ouverte'`,
      [id, tenant_id]
    );

    if (seance.rows.length === 0) {
      return res.status(404).json({ message: 'Séance non trouvée ou déjà clôturée' });
    }

    const caisseTheorique = parseFloat(seance.rows[0].caisse_theorique);
    const caissePhysique = parseFloat(caisse_physique);
    const ecart = caissePhysique - caisseTheorique;

    // Si écart, justification obligatoire
    if (ecart !== 0 && !justification_ecart) {
      return res.status(400).json({
        message: 'Justification obligatoire en cas d\'écart de caisse',
        ecart,
        caisse_theorique: caisseTheorique,
        caisse_physique: caissePhysique
      });
    }

    // Clôturer la séance
    const result = await pool.query(
      `UPDATE seances SET
        statut = 'close',
        caisse_physique = $1,
        ecart = $2,
        justification_ecart = $3
       WHERE id = $4
       RETURNING *`,
      [caissePhysique, ecart, justification_ecart || null, id]
    );

    // Générer le résumé du PV
    const transactions = await pool.query(
      `SELECT type_transaction, COUNT(*) as nb,
              SUM(montant) as total
       FROM transactions
       WHERE seance_id = $1
       AND type_transaction != 'pointage'
       GROUP BY type_transaction`,
      [id]
    );

    const pointages = await pool.query(
      `SELECT
        COUNT(CASE WHEN metadata_json->>'statut_presence' = 'present' THEN 1 END) as presents,
        COUNT(CASE WHEN metadata_json->>'statut_presence' = 'absent' THEN 1 END) as absents,
        COUNT(CASE WHEN metadata_json->>'statut_presence' = 'excuse' THEN 1 END) as excuses
       FROM transactions
       WHERE seance_id = $1 AND type_transaction = 'pointage'`,
      [id]
    );

    res.json({
      message: `✅ Séance #${seance.rows[0].numero} clôturée avec succès`,
      seance: result.rows[0],
      pv: {
        numero: seance.rows[0].numero,
        date: seance.rows[0].created_at,
        presences: pointages.rows[0],
        transactions: transactions.rows,
        caisse_theorique: caisseTheorique,
        caisse_physique: caissePhysique,
        ecart,
        statut_caisse: ecart === 0 ? 'PARFAITE' : ecart > 0 ? 'EXCEDENT' : 'DEFICIT'
      }
    });

  } catch (err) {
    console.error('Erreur cloturerSeance :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  ouvrirSeance, pointerPresence,
  saisirTransaction, getCaisse, cloturerSeance
};