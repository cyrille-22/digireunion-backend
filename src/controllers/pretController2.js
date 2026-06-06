const pool = require('../config/database');
const { generateHash } = require('../utils/helpers');

const soumettrePret = async (req, res) => {
  const { rubrique_id, montant, nb_echeances, motif } = req.body;
  const tenant_id = req.user.tenant_id;
  // Le member_id peut venir du body (Secrétaire attribue)
// ou de req.user.id (membre soumet lui-même)
const member_id = req.body.member_id || req.user.id;
  

  if (!rubrique_id || !montant) {
    return res.status(400).json({ message: 'Rubrique et montant requis' });
  }

  try {
    const membre = await pool.query(
      'SELECT statut FROM members WHERE id = $1',
      [member_id]
    );

   if (membre.rows[0].statut === 'sorti') {
  return res.status(403).json({
    message: 'Ce membre a quitté l\'association'
  });
}

    const pretEnCours = await pool.query(
      `SELECT id FROM prets 
       WHERE member_id = $1 AND rubrique_id = $2 
       AND statut IN ('en_attente','approuve','en_cours')`,
      [member_id, rubrique_id]
    );

    if (pretEnCours.rows.length > 0) {
      return res.status(400).json({
        message: 'Vous avez déjà un prêt en cours sur cette rubrique'
      });
    }

    const rubrique = await pool.query(
      'SELECT * FROM pret_rubriques WHERE id = $1 AND tenant_id = $2',
      [rubrique_id, tenant_id]
    );

    if (rubrique.rows.length === 0) {
      return res.status(404).json({ message: 'Rubrique non trouvée' });
    }

    const rb = rubrique.rows[0];

    if (rb.plafond && parseFloat(montant) > parseFloat(rb.plafond)) {
      return res.status(400).json({
        message: `Montant dépasse le plafond : ${parseFloat(rb.plafond).toLocaleString('fr-FR')} F`
      });
    }

    const tauxInteret  = parseFloat(rb.taux_interet || 0);
    const nbEcheances  = nb_echeances || rb.nb_echeances || 1;
    let montantInteret = 0;

    if (rb.mode_calcul_interet === 'simple') {
      montantInteret = parseFloat(montant) * tauxInteret * nbEcheances;
    } else if (rb.mode_calcul_interet === 'forfait') {
      montantInteret = tauxInteret;
    } else if (rb.mode_calcul_interet === 'degressif') {
      montantInteret = parseFloat(montant) * tauxInteret;
    }

    const montantTotalDu = parseFloat(montant) + montantInteret;

    const result = await pool.query(
      `INSERT INTO prets (
        tenant_id, member_id, rubrique_id,
        montant, taux_interet, montant_interet,
        montant_total_du, nb_echeances,
        frequence_remboursement, statut,
        metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        tenant_id, member_id, rubrique_id,
        montant, tauxInteret, montantInteret,
        montantTotalDu, nbEcheances,
        rb.frequence_remboursement || 'seance',
        rb.validation_requise === 'automatique' ? 'approuve' : 'en_attente',
        JSON.stringify({ motif: motif || '' })
      ]
    );

    res.status(201).json({
      message: rb.validation_requise === 'automatique'
        ? '✅ Prêt approuvé automatiquement'
        : '✅ Demande soumise — En attente approbation',
      pret: result.rows[0],
      details: {
        montant_emprunte:     parseFloat(montant),
        montant_interet:      montantInteret,
        montant_total_du:     montantTotalDu,
        nb_echeances:         nbEcheances,
        echeance_par_periode: (montantTotalDu / nbEcheances).toFixed(2)
      }
    });

  } catch (err) {
      console.error('Erreur soumettrePret DÉTAIL :', err.message);
  console.error('Stack:', err.stack);
  res.status(500).json({ 
    message: 'Erreur serveur',
    detail: err.message 
  });
  }
};

const validerPret = async (req, res) => {
  const { id } = req.params;
  const { decision, seance_id } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!['approuve', 'rejete'].includes(decision)) {
    return res.status(400).json({ message: 'Décision invalide' });
  }

  try {
    const pret = await pool.query(
      `SELECT p.*, r.nom as rubrique_nom, m.nom_complet
       FROM prets p
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       JOIN members m ON m.id = p.member_id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, tenant_id]
    );

    if (pret.rows.length === 0) {
      return res.status(404).json({ message: 'Prêt non trouvé' });
    }

    const p = pret.rows[0];

    if (p.statut !== 'en_attente') {
      return res.status(400).json({ message: 'Ce prêt a déjà été traité' });
    }

    await pool.query(
      `UPDATE prets SET statut = $1, date_approbation = NOW(),
       approuve_par = $2, seance_id = $3 WHERE id = $4`,
      [decision, req.user.id, seance_id || null, id]
    );

    if (decision === 'approuve') {
      const hash = generateHash({
        pret_id: id, member_id: p.member_id,
        montant: p.montant, timestamp: Date.now()
      });

      await pool.query(
        `INSERT INTO transactions (
          tenant_id, seance_id, member_id,
          type_transaction, montant, sens,
          rubrique_id, created_by,
          signature_hash, metadata_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          tenant_id, seance_id || null, p.member_id,
          'pret', p.montant, 'debit',
          p.rubrique_id, req.user.id, hash,
          JSON.stringify({ pret_id: id, rubrique_nom: p.rubrique_nom })
        ]
      );

      if (seance_id) {
        await pool.query(
          'UPDATE seances SET caisse_theorique = caisse_theorique - $1 WHERE id = $2',
          [p.montant, seance_id]
        );
      }

      await pool.query(
        'UPDATE prets SET statut = $1 WHERE id = $2',
        ['en_cours', id]
      );
    }

    res.json({
      message: decision === 'approuve'
        ? `✅ Prêt de ${parseFloat(p.montant).toLocaleString('fr-FR')} F approuvé`
        : '❌ Prêt rejeté',
      pret_id: id,
      decision
    });

  } catch (err) {
    console.error('Erreur validerPret :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const rembourserPret = async (req, res) => {
  const { pret_id, montant, seance_id } = req.body;
  const tenant_id = req.user.tenant_id;

  try {
    const pret = await pool.query(
      `SELECT p.*, r.nom as rubrique_nom
       FROM prets p
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       WHERE p.id = $1 AND p.tenant_id = $2 AND p.statut = 'en_cours'`,
      [pret_id, tenant_id]
    );

    if (pret.rows.length === 0) {
      return res.status(404).json({ message: 'Prêt non trouvé ou déjà soldé' });
    }

    const p = pret.rows[0];
    const resteARegler = parseFloat(p.montant_total_du) -
      parseFloat(p.montant_rembourse);

    if (parseFloat(montant) > resteARegler) {
      return res.status(400).json({
        message: `Dépasse le reste à régler : ${resteARegler.toLocaleString('fr-FR')} F`
      });
    }

    // Vérifier que le montant ne dépasse pas le reste
      if (parseFloat(montant) > resteARegler + 1) {
        return res.status(400).json({
          message: `Montant trop élevé. Reste à régler : ` +
                  `${resteARegler.toLocaleString('fr-FR')} F`
        });
      }

      // Vérifier que le prêt n'est pas déjà soldé
      if (resteARegler <= 0) {
        return res.status(400).json({
          message: 'Ce prêt est déjà entièrement remboursé'
        });
      }


    const ratioInteret    = parseFloat(p.montant_interet) /
      parseFloat(p.montant_total_du);
    const montantInteret  = parseFloat(montant) * ratioInteret;
    const montantCapital  = parseFloat(montant) - montantInteret;

    await pool.query(
      `INSERT INTO remboursements (
        tenant_id, pret_id, member_id, seance_id,
        montant_capital, montant_interet, montant_total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenant_id, pret_id, p.member_id, seance_id || null,
       montantCapital, montantInteret, montant]
    );

    const nouveauMontantRembourse = parseFloat(p.montant_rembourse) +
      parseFloat(montant);
    const statutPret = nouveauMontantRembourse >= parseFloat(p.montant_total_du)
      ? 'solde' : 'en_cours';

    await pool.query(
      'UPDATE prets SET montant_rembourse = $1, statut = $2 WHERE id = $3',
      [nouveauMontantRembourse, statutPret, pret_id]
    );

    const hash = generateHash({
      pret_id, seance_id, montant, timestamp: Date.now()
    });

    await pool.query(
      `INSERT INTO transactions (
        tenant_id, seance_id, member_id,
        type_transaction, montant, sens,
        rubrique_id, created_by,
        signature_hash, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenant_id, seance_id || null, p.member_id,
        'remboursement', montant, 'credit',
        p.rubrique_id, req.user.id, hash,
        JSON.stringify({
          pret_id, rubrique_nom: p.rubrique_nom,
          capital: montantCapital, interet: montantInteret,
          statut_pret: statutPret
        })
      ]
    );

    if (seance_id) {
      await pool.query(
        'UPDATE seances SET caisse_theorique = caisse_theorique + $1 WHERE id = $2',
        [montant, seance_id]
      );
    }

    res.json({
      message: statutPret === 'solde'
        ? '✅ Prêt entièrement remboursé !'
        : '✅ Remboursement enregistré',
      reste_a_regler: resteARegler - parseFloat(montant),
      statut_pret: statutPret,
      details: {
        montant_capital:  montantCapital.toFixed(2),
        montant_interet:  montantInteret.toFixed(2)
      }
    });

  } catch (err) {
    console.error('Erreur rembourserPret :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const getPrets = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { statut }  = req.query;

  try {
    let query = `
      SELECT p.*, m.nom_complet, r.nom as rubrique_nom, r.type_rubrique,
             (p.montant_total_du - p.montant_rembourse) as reste_a_regler
       FROM prets p
       JOIN members m ON m.id = p.member_id
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       WHERE p.tenant_id = $1
    `;
    const params = [tenant_id];

    if (statut) {
      query += ' AND p.statut = $2';
      params.push(statut);
    }

    query += ' ORDER BY p.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ total: result.rows.length, prets: result.rows });

  } catch (err) {
    console.error('Erreur getPrets :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

const getPretsMembre = async (req, res) => {
  const { member_id } = req.params;
  const tenant_id     = req.user.tenant_id;

  try {
    const result = await pool.query(
      `SELECT p.*, r.nom as rubrique_nom, r.type_rubrique,
              (p.montant_total_du - p.montant_rembourse) as reste_a_regler
       FROM prets p
       JOIN pret_rubriques r ON r.id = p.rubrique_id
       WHERE p.member_id = $1 AND p.tenant_id = $2
       AND p.statut IN ('en_cours','en_attente')
       ORDER BY p.created_at DESC`,
      [member_id, tenant_id]
    );

    res.json({ prets: result.rows });

  } catch (err) {
    console.error('Erreur getPretsMembre :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  soumettrePret,
  validerPret,
  rembourserPret,
  getPrets,
  getPretsMembre
};