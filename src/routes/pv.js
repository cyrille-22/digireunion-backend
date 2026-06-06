const express = require('express');
const router  = express.Router();
const { genererPV } = require('../controllers/pvController');
const { authMiddleware } = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/:seance_id', genererPV);

module.exports = router;