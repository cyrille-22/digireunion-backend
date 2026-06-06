const express = require('express');
const router = express.Router();
const {
  cotiserEpargne, getSoldeEpargne, getAllEpargnes
} = require('../controllers/epargneController');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

router.post('/', requireRole('president','secretaire'), cotiserEpargne);
router.get('/all', requireRole('president','secretaire','cac'), getAllEpargnes);
router.get('/membre/:member_id', getSoldeEpargne);

module.exports = router;