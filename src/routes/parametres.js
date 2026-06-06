const express = require('express');
const router  = express.Router();
const {
  getParametres, updateParametres, getStats
} = require('../controllers/parametresController');
const {
  authMiddleware, requireRole
} = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/', getParametres);
router.put('/', requireRole('president'), updateParametres);
router.get('/stats', getStats);

module.exports = router;