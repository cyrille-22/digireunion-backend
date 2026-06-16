const express = require('express');
const router = express.Router();
const {
  createRubrique, getRubriques, updateRubrique
} = require('../controllers/pretController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/', getRubriques);
router.post('/', requireRole('president'), createRubrique);
router.put('/:id', requireRole('president'), updateRubrique);
router.delete('/rubriques/:id', requireRole('president'), supprimerRubrique);
module.exports = router;