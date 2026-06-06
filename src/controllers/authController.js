const pool = require('../config/database');
const jwt = require('jsonwebtoken');
const { generateOTP, formatPhone } = require('../utils/helpers');
const { jwtSecret } = require('../config/env');

// ── DEMANDE D'OTP ─────────────────────────────────────────────
const requestOTP = async (req, res) => {
  const { telephone } = req.body;

  if (!telephone) {
    return res.status(400).json({ message: 'Numéro de téléphone requis' });
  }

  const phone = formatPhone(telephone);

  try {
    // Vérifier que le membre existe
    const memberResult = await pool.query(
      'SELECT id, nom_complet, role, tenant_id FROM members WHERE telephone = $1 AND statut = $2',
      [phone, 'actif']
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ message: 'Numéro non reconnu. Contactez votre secrétaire.' });
    }

    // Générer et sauvegarder l'OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Invalider les anciens OTP du même numéro
    await pool.query(
      'UPDATE otp_codes SET used = TRUE WHERE telephone = $1 AND used = FALSE',
      [phone]
    );

    // Sauvegarder le nouvel OTP
    await pool.query(
      'INSERT INTO otp_codes (telephone, code, expires_at) VALUES ($1, $2, $3)',
      [phone, otp, expiresAt]
    );

    // En production : envoyer par SMS/WhatsApp
    // Pour le développement : on retourne l'OTP directement
    console.log(`📱 OTP pour ${phone} : ${otp}`);

    res.json({
      message: 'Code OTP envoyé avec succès',
      // En développement seulement — retirer en production !
      otp_dev: otp,
      expires_in: '5 minutes'
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

module.exports = { requestOTP, verifyOTP };