const crypto = require('crypto');

// Générer un code OTP à 6 chiffres
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Générer un hash SHA-256 pour le journal immuable
const generateHash = (data) => {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
};

// Formater un numéro de téléphone
const formatPhone = (phone) => {
  return phone.replace(/\s+/g, '').replace(/^00/, '+');
};

module.exports = { generateOTP, generateHash, formatPhone };