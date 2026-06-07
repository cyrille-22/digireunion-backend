const express = require('express');
const router = express.Router();

const { requestOTP, verifyOTP, register } = require('../controllers/authController');

router.post('/request-otp', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/register', register);

module.exports = router;