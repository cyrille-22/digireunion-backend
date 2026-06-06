const express = require('express');
const router = express.Router();
const {
  createTontine, getTontines,
  getTontineById, updateTontine
} = require('../controllers/tontineController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/', getTontines);
router.get('/:id', getTontineById);
router.post('/', requireRole('president'), createTontine);
router.put('/:id', requireRole('president'), updateTontine);

module.exports = router;