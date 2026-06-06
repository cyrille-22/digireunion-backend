const pool = require('../config/database');
const { generateHash } = require('../utils/helpers');

// ── PRÉPARER LE BOUFFER D'UN MEMBRE ──────────────────────────
const preparerBouffer = async (req, res) => {
  const { member_id, tontine_id, seance_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    // Infos du membre
    const membre = await pool.query(
      `SELECT * FROM members WHERE id = $1 AND tenant_id = $2`,
      [member_id, tenant_id]
    );

    if (membre.rows.length === 0) {
      return res.status(404).json({ message: 'Membre non trouvé' });
    }

    // Infos de la tontine
    const tontine = await pool.query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM beneficiaires_tontine bt
         WHERE bt.tontine_id = t.id
         AND bt.tenant_id = $2) as nb_beneficiaires_passes,
        (SELECT COUNT(*) FROM cotisations c
         WHERE c.tontine_id = t.id
         AND c.seance_id = $3
         AND c.statut = 'cotise') as nb_cotisants_seance,
        (SELECT COALESCE(SUM(montant_total), 0)
         FROM cotisations c
         WHERE c.tontine_id = t.id
         AND c.seance_id = $3
         AND c.statut = 'cotise') as montant_brut_seance
       FROM tontines t
       WHERE t.id = $1 AND t.tenant_id = $2`,
      [tontine_id, tenant_id, seance_id]
    );

    if (tontine.rows.length === 0) {
      return res.status(404).json({ message: 'Tontine non trouvée' });
    }

    const t = tontine.rows[0];

    // Numéro d'évolution
    const numeroSeanceTontine =
      parseInt(t.nb_beneficiaires_passes) + 1;
    const nbSeancesCycle = t.nb_seances_cycle || 52;

    // Montant brut
    const montantBrut = parseFloat(t.montant_brut_seance || 0);

    // Parts du membre pour cette tontine
    const inscription = await pool.query(
      `SELECT nb_parts FROM membre_tontine
       WHERE member_id = $1 AND tontine_id = $2`,
      [member_id, tontine_id]
    );
    const nbParts = inscription.rows[0]?.nb_parts || 1;

    // Déductions configurées pour cette tontine
    // Récupérer le nom de la tontine pour filtrer
      const nomTontine = tontine.rows[0].nom.toLowerCase();

      // Récupérer TOUTES les déductions actives
      // sans filtre complexe — le filtre par tontine
      // se fait côté application
      const deductions = await pool.query(
        `SELECT * FROM rubriques_deduction
        WHERE tenant_id = $1 AND actif = TRUE
        ORDER BY ordre ASC`,
        [tenant_id]
      ); 

    // Calculer le montant de chaque déduction
    const deductionsCalculees = deductions.rows.map(d => {
      let montantDeduction = 0;
      if (d.type_montant === 'fixe') {
        montantDeduction = parseFloat(d.montant) * nbParts;
      } else if (d.type_montant === 'pourcentage') {
        montantDeduction = montantBrut *
          parseFloat(d.pourcentage) * nbParts;
      }
      return {
        id: d.id,
        nom: d.nom,
        type_montant: d.type_montant,
        montant: montantDeduction,
        obligatoire: d.obligatoire || false,
        selectionne: d.obligatoire || false
      };
    });

    // Prêts en cours du membre
    const prets = await pool.query(
      `SELECT p.*, r.nom as rubrique_nom,
              (p.montant_total_du - p.montant_rembourse) as reste_a_regler
       FROM prets p
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       WHERE p.member_id = $1 AND p.tenant_id = $2
       AND p.statut = 'en_cours'
       ORDER BY p.created_at ASC`,
      [member_id, tenant_id]
    );

    // Reliquat de la tontine
    const reliquat = await pool.query(
      `SELECT COALESCE(SUM(
        CASE WHEN type_transaction = 'cotisation' 
             AND rubrique_id = $1 THEN montant
             WHEN type_transaction = 'benefice'
             AND rubrique_id = $1 THEN -montant
        ELSE 0 END
       ), 0) as reliquat
       FROM transactions
       WHERE tenant_id = $2
       AND rubrique_id = $1`,
      [tontine_id, tenant_id]
    );

    res.json({
      membre: membre.rows[0],
      tontine: {
        ...t,
        numero_seance_tontine: numeroSeanceTontine,
        nb_seances_cycle: nbSeancesCycle,
        evolution: `${numeroSeanceTontine}e séance sur ${nbSeancesCycle}`
      },
      montant_brut: montantBrut,
      nb_parts: nbParts,
      deductions: deductionsCalculees,
      prets_en_cours: prets.rows,
      reliquat: parseFloat(reliquat.rows[0]?.reliquat || 0)
    });

  } catch (err) {
    console.error('Erreur preparerBouffer :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── CONFIRMER LE BOUFFER ──────────────────────────────────────
const confirmerBouffer = async (req, res) => {
  const {
    member_id, tontine_id, seance_id,
    montant_brut, deductions_selectionnees,
    prets_a_deduire
  } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    // Calculer le total des déductions
    const totalDeductions = deductions_selectionnees
      .reduce((sum, d) => sum + parseFloat(d.montant), 0);

    // Calculer le total des prêts déduits
    const totalPrets = prets_a_deduire
      .reduce((sum, p) => sum + parseFloat(p.montant_deduit), 0);

    // Montant net à percevoir
    const montantNet = parseFloat(montant_brut) -
      totalDeductions - totalPrets;

    if (montantNet < 0) {
      return res.status(400).json({
        message: 'Le montant net ne peut pas être négatif'
      });
    }

    // Récupérer le rang du bénéficiaire
    const rangResult = await pool.query(
      `SELECT COUNT(*) + 1 as rang
       FROM beneficiaires_tontine
       WHERE tontine_id = $1 AND tenant_id = $2`,
      [tontine_id, tenant_id]
    );
    const rang = parseInt(rangResult.rows[0].rang);


    // Vérifier que le membre n'a pas déjà bouffé plus que ses parts
      const dejaBouffé = await pool.query(
        `SELECT COUNT(*) as nb FROM beneficiaires_tontine
        WHERE member_id = $1 AND tontine_id = $2
        AND tenant_id = $3`,
        [member_id, tontine_id, tenant_id]
      );

      // Récupérer le nombre de parts du membre
      const inscription = await pool.query(
        `SELECT nb_parts FROM membre_tontine
        WHERE member_id = $1 AND tontine_id = $2`,
        [member_id, tontine_id]
      );

      const nbParts     = inscription.rows[0]?.nb_parts || 1;
      const nbBouffes   = parseInt(dejaBouffé.rows[0].nb);

      if (nbBouffes >= nbParts) {
        return res.status(400).json({
          message: `Ce membre a déjà bouffé ${nbBouffes} fois` +
                  ` sur ${nbParts} part(s) autorisée(s) pour ce cycle`
        });
      }


    // Enregistrer le bénéficiaire
    await pool.query(
      `INSERT INTO beneficiaires_tontine (
        tenant_id, tontine_id, seance_id,
        member_id, rang_beneficiaire,
        montant_brut, montant_deductions,
        montant_net, deductions_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenant_id, tontine_id, seance_id,
        member_id, rang,
        montant_brut, totalDeductions + totalPrets,
        montantNet,
        JSON.stringify({
          deductions: deductions_selectionnees,
          prets: prets_a_deduire
        })
      ]
    );

    // Enregistrer les déductions dans les transactions
    for (const d of deductions_selectionnees) {
      const hash = generateHash({
        seance_id, member_id,
        deduction: d.nom, timestamp: Date.now()
      });

      await pool.query(
        `INSERT INTO transactions (
          tenant_id, seance_id, member_id,
          type_transaction, montant, sens,
          created_by, signature_hash, metadata_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tenant_id, seance_id, member_id,
          'deduction', d.montant, 'credit',
          req.user.id, hash,
          JSON.stringify({ nom: d.nom, tontine_id })
        ]
      );
    }

    // Rembourser les prêts déduits
    for (const p of prets_a_deduire) {
      const hash = generateHash({
        seance_id, pret_id: p.pret_id,
        montant: p.montant_deduit,
        timestamp: Date.now()
      });

      // Mettre à jour le prêt
      const pret = await pool.query(
        `SELECT * FROM prets WHERE id = $1`,
        [p.pret_id]
      );

      if (pret.rows.length > 0) {
        const pr = pret.rows[0];
        const nouveauMontant = parseFloat(pr.montant_rembourse) +
          parseFloat(p.montant_deduit);
        const nouveauStatut = nouveauMontant >=
          parseFloat(pr.montant_total_du) ? 'solde' : 'en_cours';

        await pool.query(
          `UPDATE prets SET
            montant_rembourse = $1, statut = $2
           WHERE id = $3`,
          [nouveauMontant, nouveauStatut, p.pret_id]
        );

        // Enregistrer dans les remboursements
        await pool.query(
          `INSERT INTO remboursements (
            tenant_id, pret_id, member_id, seance_id,
            montant_capital, montant_interet, montant_total
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            tenant_id, p.pret_id, member_id, seance_id,
            p.montant_deduit, 0, p.montant_deduit
          ]
        );

        await pool.query(
          `INSERT INTO transactions (
            tenant_id, seance_id, member_id,
            type_transaction, montant, sens,
            rubrique_id, created_by,
            signature_hash, metadata_json
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tenant_id, seance_id, member_id,
            'remboursement', p.montant_deduit, 'credit',
            pr.rubrique_id, req.user.id, hash,
            JSON.stringify({
              pret_id: p.pret_id,
              via_bouffer: true
            })
          ]
        );
      }
    }

    // Enregistrer le bénéfice net
    const hashBenefice = generateHash({
      seance_id, member_id, tontine_id,
      montant_net: montantNet,
      timestamp: Date.now()
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
        'benefice', montantNet, 'debit',
        tontine_id, req.user.id, hashBenefice,
        JSON.stringify({
          montant_brut,
          total_deductions: totalDeductions,
          total_prets: totalPrets,
          rang_beneficiaire: rang
        })
      ]
    );

    // Mettre à jour la caisse
    await pool.query(
      `UPDATE seances SET
        caisse_theorique = caisse_theorique - $1
       WHERE id = $2`,
      [montantNet, seance_id]
    );

    // Incrémenter le compteur de séances de la tontine
    await pool.query(
      `UPDATE tontines SET
        seance_courante = seance_courante + 1
       WHERE id = $1`,
      [tontine_id]
    );

    res.json({
      message: `✅ Bénéfice confirmé pour ${member_id}`,
      resume: {
        rang_beneficiaire: rang,
        montant_brut: parseFloat(montant_brut),
        total_deductions: totalDeductions,
        total_prets_deduits: totalPrets,
        montant_net: montantNet
      }
    });

  } catch (err) {
    console.error('Erreur confirmerBouffer :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── HISTORIQUE DES BÉNÉFICIAIRES D'UNE TONTINE ───────────────
const getHistoriqueBeneficiaires = async (req, res) => {
  const { tontine_id } = req.params;
  const tenant_id = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT bt.*, m.nom_complet, s.numero as seance_numero,
              s.date_seance, t.nom as tontine_nom,
              t.nb_seances_cycle, t.seance_courante
       FROM beneficiaires_tontine bt
       JOIN members m ON m.id = bt.member_id
       JOIN seances s ON s.id = bt.seance_id
       JOIN tontines t ON t.id = bt.tontine_id
       WHERE bt.tontine_id = $1 AND bt.tenant_id = $2
       ORDER BY bt.rang_beneficiaire ASC`,
      [tontine_id, tenant_id]
    );

    res.json({
      total: result.rows.length,
      beneficiaires: result.rows
    });

  } catch (err) {
    console.error('Erreur getHistoriqueBeneficiaires :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  preparerBouffer,
  confirmerBouffer,
  getHistoriqueBeneficiaires
};