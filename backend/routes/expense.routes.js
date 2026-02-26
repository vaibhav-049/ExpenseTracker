const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense.controller');
const authMiddleware = require('../middleware/auth.middleware');
router.use(authMiddleware);
router.post('/', expenseController.create);
router.get('/', expenseController.getAll);
router.get('/stats', expenseController.getStats);
router.get('/:id', expenseController.getOne);
router.put('/:id', expenseController.update);
router.delete('/:id', expenseController.delete);

module.exports = router;