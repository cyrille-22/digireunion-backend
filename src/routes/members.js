const express = require('express');
const router = express.Router();
const {
  addMember, getMembers, getMemberById,
  updateMember, deleteMember
} = require('../controllers/memberController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

// Toutes les routes nécessitent un token
router.use(authMiddleware);

// Lister les membres — tous les rôles du bureau
router.get('/', getMembers);

// Profil d'un membre
router.get('/:id', getMemberById);

// Ajouter un membre — Président et Secrétaire seulement
router.post('/', requireRole('president', 'secretaire'), addMember);

// Modifier un membre
router.put('/:id', requireRole('president', 'secretaire'), updateMember);

// Sortie d'un membre
router.delete('/:id', requireRole('president'), deleteMember);

module.exports = router;