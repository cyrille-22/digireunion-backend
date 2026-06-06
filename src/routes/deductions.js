const express = require('express');
const router = express.Router();
const {
  createDeduction, getDeductions,
  updateDeduction, deleteDeduction
} = require('../controllers/deductionController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/', getDeductions);
router.post('/', requireRole('president'), createDeduction);
router.put('/:id', requireRole('president'), updateDeduction);
router.delete('/:id', requireRole('president'), deleteDeduction);

module.exports = router;