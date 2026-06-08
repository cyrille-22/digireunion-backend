const pool = require('../config/database');
const jwt = require('jsonwebtoken');
const { generateOTP, formatPhone } = require('../utils/helpers');
const { jwtSecret } = require('../config/env');

// ── DEMANDE D'OTP ─────────────────────────────────────────────
const requestOTP = async (req, res) => {
  const { telephone } = req.body;

  if (!telephone) {
    return res.status(400).json({ message: 'Téléphone requis' });
  }

  try {
    // Vérifier que le membre existe
    const membre = await pool.query(
      `SELECT m.*, t.nom as association_nom
       FROM members m
       JOIN tenants t ON t.id = m.tenant_id
       WHERE m.telephone = $1 AND m.statut != 'sorti'
       LIMIT 1`,
      [telephone]
    );

    if (membre.rows.length === 0) {
      return res.status(404).json({
        message: 'Numéro non trouvé dans notre système'
      });
    }

    // Générer le code OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Invalider les anciens OTP
    await pool.query(
      `UPDATE otp_codes SET used = TRUE
       WHERE telephone = $1 AND used = FALSE`,
      [telephone]
    );

    // Sauvegarder le nouveau OTP
    await pool.query(
      `INSERT INTO otp_codes (telephone, code, expires_at)
       VALUES ($1, $2, $3)`,
      [telephone, code, expiresAt]
    );

    console.log('=============================');
    console.log(`📱 OTP POUR ${telephone} : ${code}`);
    console.log('=============================');

    res.json({
      message: 'Code OTP généré',
      code_otp: code // ← temporaire jusqu'à intégration SMS
    });

  } catch (err) {
    console.error('Erreur requestOTP :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── VÉRIFICATION OTP ──────────────────────────────────────────
const verifyOTP = async (req, res) => {
  const { telephone, code } = req.body;

  if (!telephone || !code) {
    return res.status(400).json({ message: 'Téléphone et code requis' });
  }

  const phone = formatPhone(telephone);

  try {
    // Vérifier l'OTP
    const otpResult = await pool.query(
      `SELECT * FROM otp_codes 
       WHERE telephone = $1 AND code = $2 
       AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code]
    );

    if (otpResult.rows.length === 0) {
      return res.status(401).json({ message: 'Code incorrect ou expiré' });
    }

    // Marquer l'OTP comme utilisé
    await pool.query(
      'UPDATE otp_codes SET used = TRUE WHERE id = $1',
      [otpResult.rows[0].id]
    );

    // Récupérer les infos du membre
    const memberResult = await pool.query(
      `SELECT m.id, m.nom_complet, m.role, m.tenant_id, m.gav_solde,
              m.score_fiabilite, t.nom as association_nom, t.code_unique
       FROM members m
       JOIN tenants t ON t.id = m.tenant_id
       WHERE m.telephone = $1 AND m.statut = 'actif'`,
      [phone]
    );

    const member = memberResult.rows[0];

    // Générer le JWT
    const token = jwt.sign(
      {
        id: member.id,
        telephone: phone,
        role: member.role,
        tenant_id: member.tenant_id
      },
      jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Connexion réussie 🎉',
      token,
      membre: {
        id: member.id,
        nom: member.nom_complet,
        role: member.role,
        association: member.association_nom,
        gav_solde: member.gav_solde,
        score_fiabilite: member.score_fiabilite
      }
    });

  } catch (err) {
    console.error('Erreur verifyOTP :', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
// ── INSCRIPTION D'UNE NOUVELLE ASSOCIATION ────────────────────
const register = async (req, res) => {
  const { nom, telephone, nom_complet } = req.body;

  if (!nom || !telephone || !nom_complet) {
    return res.status(400).json({
      message: 'Nom association, téléphone et nom complet requis'
    });
  }

  try {
    // Générer un code unique pour l'association
    const code_unique = nom
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) + Math.floor(Math.random() * 1000);

    // Créer le tenant
    const tenant = await pool.query(
      `INSERT INTO tenants (nom, code_unique)
       VALUES ($1, $2) RETURNING *`,
      [nom, code_unique]
    );

    const tenant_id = tenant.rows[0].id;

    // Créer le premier membre (Président)
    const membre = await pool.query(
      `INSERT INTO members
        (tenant_id, nom_complet, telephone, role, statut)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenant_id, nom_complet, telephone, 'president', 'actif']
    );

    res.status(201).json({
      message: `✅ Association "${nom}" créée avec succès !`,
      association: tenant.rows[0],
      president: membre.rows[0],
      instructions: [
        `Votre code unique : ${code_unique}`,
        `Connectez-vous avec : ${telephone}`,
        'Demandez un OTP pour accéder à votre espace'
      ]
    });

  } catch (err) {
    console.error('Erreur register :', err.message);
    if (err.message.includes('unique')) {
      return res.status(400).json({
        message: 'Ce numéro de téléphone est déjà utilisé'
      });
    }
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
module.exports = {
  requestOTP,
  verifyOTP,
  register
};