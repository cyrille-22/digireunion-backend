const express = require('express');
const router = express.Router();
const {
  soumettrePret, validerPret,
  rembourserPret, getPrets, getPretsMembre
} = require('../controllers/pretController2.js');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/', getPrets);
router.get('/membre/:member_id', getPretsMembre);
router.post('/', soumettrePret);
router.put('/:id/valider', requireRole('president','secretaire'), validerPret);
router.post('/rembourser', requireRole('president','secretaire'), rembourserPret);

module.exports = router;