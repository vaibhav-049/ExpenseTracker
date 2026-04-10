const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const bankAccountController = require('../controllers/bank-account.controller');
const authMiddleware = require('../middleware/auth.middleware');
router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/profile', authMiddleware, authController.getProfile);
router.get('/budget', authMiddleware, authController.getBudget);
router.put('/budget', authMiddleware, authController.updateBudget);
router.get('/bank-accounts', authMiddleware, bankAccountController.list);
router.post('/bank-accounts', authMiddleware, bankAccountController.create);
router.put('/bank-accounts/:id', authMiddleware, bankAccountController.update);
router.delete('/bank-accounts/:id', authMiddleware, bankAccountController.remove);

module.exports = router;