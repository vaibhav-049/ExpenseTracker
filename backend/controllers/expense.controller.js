const db = require('../models');
const Expense = db.Expense;
const { Op } = db.Sequelize;
exports.create = async (req, res) => {
    try {
        const { amount, category, description, date } = req.body;
        const userId = req.userId;
        if (!amount || !category) {
            return res.status(400).json({ message: 'Amount and category are required' });
        }
        const expense = await Expense.create({
            userId,
            amount,
            category,
            description: description || '',
            date: date || new Date()
        });

        res.status(201).json({
            message: 'Expense added successfully',
            expense
        });

    } catch (error) {
        console.error('Create expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.getAll = async (req, res) => {
    try {
        const userId = req.userId;
        const { category, startDate, endDate } = req.query;
        let whereClause = { userId };

        if (category) {
            whereClause.category = category;
        }

        if (startDate && endDate) {
            whereClause.date = {
                [Op.between]: [startDate, endDate]
            };
        }

        const expenses = await Expense.findAll({
            where: whereClause,
            order: [['date', 'DESC'], ['createdAt', 'DESC']]
        });

        res.json({ expenses });

    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.getOne = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const expense = await Expense.findOne({
            where: { id, userId }
        });

        if (!expense) {
            return res.status(404).json({ message: 'Expense not found' });
        }

        res.json({ expense });

    } catch (error) {
        console.error('Get expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const { amount, category, description, date } = req.body;

        const expense = await Expense.findOne({
            where: { id, userId }
        });

        if (!expense) {
            return res.status(404).json({ message: 'Expense not found' });
        }
        await expense.update({
            amount: amount || expense.amount,
            category: category || expense.category,
            description: description !== undefined ? description : expense.description,
            date: date || expense.date
        });

        res.json({
            message: 'Expense updated successfully',
            expense
        });

    } catch (error) {
        console.error('Update expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const expense = await Expense.findOne({
            where: { id, userId }
        });

        if (!expense) {
            return res.status(404).json({ message: 'Expense not found' });
        }

        await expense.destroy();

        res.json({ message: 'Expense deleted successfully' });

    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.getStats = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const expenses = await Expense.findAll({
            where: {
                userId,
                date: {
                    [Op.between]: [startOfMonth, endOfMonth]
                }
            }
        });
        const totalSpending = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
        const categoryBreakdown = {};
        expenses.forEach(exp => {
            if (!categoryBreakdown[exp.category]) {
                categoryBreakdown[exp.category] = 0;
            }
            categoryBreakdown[exp.category] += parseFloat(exp.amount);
        });

        res.json({
            totalSpending,
            categoryBreakdown,
            expenseCount: expenses.length,
            month: now.toLocaleString('default', { month: 'long', year: 'numeric' })
        });

    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};