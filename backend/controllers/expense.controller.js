const db = require('../models');
const Expense = db.Expense;
const RecurringExpense = db.RecurringExpense;
const { Op } = db.Sequelize;
const MAX_BULK_EXPENSES = Number.parseInt(process.env.MAX_BULK_EXPENSES || '500', 10);
const MAX_RECURRING_CATCHUP = Number.parseInt(process.env.MAX_RECURRING_CATCHUP || '24', 10);

function toDateOnlyString(dateInput) {
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

function addFrequency(dateString, frequency) {
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;

    if (frequency === 'daily') {
        date.setDate(date.getDate() + 1);
    } else if (frequency === 'weekly') {
        date.setDate(date.getDate() + 7);
    } else {
        date.setMonth(date.getMonth() + 1);
    }

    return date.toISOString().split('T')[0];
}

async function processDueRecurringExpensesForUser(userId, io) {
    const today = new Date().toISOString().split('T')[0];
    const recurringItems = await RecurringExpense.findAll({
        where: {
            userId,
            isActive: true,
            nextRunDate: {
                [Op.lte]: today
            },
            [Op.or]: [
                { endDate: null },
                { endDate: { [Op.gte]: today } }
            ]
        },
        order: [['nextRunDate', 'ASC']]
    });

    let generatedCount = 0;

    for (const recurring of recurringItems) {
        let currentRunDate = recurring.nextRunDate;
        let iterations = 0;

        while (currentRunDate && currentRunDate <= today && iterations < MAX_RECURRING_CATCHUP) {
            if (recurring.endDate && currentRunDate > recurring.endDate) {
                break;
            }

            await Expense.create({
                userId,
                amount: recurring.amount,
                category: recurring.category,
                description: recurring.description || '',
                date: currentRunDate
            });

            generatedCount += 1;
            iterations += 1;
            currentRunDate = addFrequency(currentRunDate, recurring.frequency);
        }

        recurring.nextRunDate = currentRunDate || recurring.nextRunDate;
        await recurring.save();
    }

    if (io && generatedCount > 0) {
        io.to(`user_${userId}`).emit('expense:changed', {
            action: 'recurring-generated',
            count: generatedCount
        });
    }
}
exports.create = async (req, res) => {
    try {
        const { amount, category, description, date } = req.body;
        const userId = req.userId;
        const io = req.app.get('io');
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

        io.to(`user_${userId}`).emit('expense:changed', {
            action: 'created',
            expenseId: expense.id
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
        const io = req.app.get('io');
        await processDueRecurringExpensesForUser(userId, io);
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
        const io = req.app.get('io');

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

        io.to(`user_${userId}`).emit('expense:changed', {
            action: 'updated',
            expenseId: expense.id
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
        const io = req.app.get('io');

        const expense = await Expense.findOne({
            where: { id, userId }
        });

        if (!expense) {
            return res.status(404).json({ message: 'Expense not found' });
        }

        await expense.destroy();

        res.json({ message: 'Expense deleted successfully' });

        io.to(`user_${userId}`).emit('expense:changed', {
            action: 'deleted',
            expenseId: Number(id)
        });

    } catch (error) {
        console.error('Delete expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.getStats = async (req, res) => {
    try {
        const userId = req.userId;
        const io = req.app.get('io');
        await processDueRecurringExpensesForUser(userId, io);
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

exports.exportCsv = async (req, res) => {
    try {
        const userId = req.userId;
        const { category, startDate, endDate } = req.query;
        const whereClause = { userId };

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

        const escapeCsvField = (value) => {
            const stringValue = String(value ?? '');
            return `"${stringValue.replace(/"/g, '""')}"`;
        };

        const rows = [
            'id,date,category,description,amount'
        ];

        expenses.forEach((expense) => {
            rows.push([
                expense.id,
                escapeCsvField(expense.date),
                escapeCsvField(expense.category),
                escapeCsvField(expense.description || ''),
                Number(expense.amount).toFixed(2)
            ].join(','));
        });

        const csvContent = rows.join('\n');
        const fileDate = new Date().toISOString().split('T')[0];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=expenses_${fileDate}.csv`);
        res.status(200).send(csvContent);
    } catch (error) {
        console.error('Export CSV error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.importCsv = async (req, res) => {
    try {
        const io = req.app.get('io');
        const userId = req.userId;
        const { expenses } = req.body;

        if (!Array.isArray(expenses) || expenses.length === 0) {
            return res.status(400).json({ message: 'Expenses array is required' });
        }

        if (expenses.length > MAX_BULK_EXPENSES) {
            return res.status(413).json({
                message: `Too many expenses in one import. Maximum allowed is ${MAX_BULK_EXPENSES}.`,
                maxAllowed: MAX_BULK_EXPENSES,
                received: expenses.length
            });
        }

        const normalizedExpenses = expenses.map((expense) => ({
            userId,
            amount: parseFloat(expense.amount),
            category: expense.category,
            description: expense.description || '',
            date: expense.date || new Date()
        })).filter((expense) => !Number.isNaN(expense.amount) && expense.amount > 0 && expense.category);

        if (normalizedExpenses.length > MAX_BULK_EXPENSES) {
            return res.status(413).json({
                message: `Too many valid expenses after parsing. Maximum allowed is ${MAX_BULK_EXPENSES}.`,
                maxAllowed: MAX_BULK_EXPENSES,
                validCount: normalizedExpenses.length
            });
        }

        if (normalizedExpenses.length === 0) {
            return res.status(400).json({ message: 'No valid expenses found in payload' });
        }

        await Expense.bulkCreate(normalizedExpenses);

        io.to(`user_${userId}`).emit('expense:changed', {
            action: 'imported',
            count: normalizedExpenses.length
        });

        res.status(201).json({
            message: 'Expenses imported successfully',
            importedCount: normalizedExpenses.length
        });
    } catch (error) {
        console.error('Import CSV error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getRecurring = async (req, res) => {
    try {
        const recurringExpenses = await RecurringExpense.findAll({
            where: { userId: req.userId },
            order: [['createdAt', 'DESC']]
        });

        res.json({ recurringExpenses });
    } catch (error) {
        console.error('Get recurring expenses error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.createRecurring = async (req, res) => {
    try {
        const { amount, category, description, frequency, startDate, endDate } = req.body;
        const userId = req.userId;

        if (!amount || !category || !frequency) {
            return res.status(400).json({ message: 'Amount, category and frequency are required' });
        }

        if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
            return res.status(400).json({ message: 'Frequency must be daily, weekly, or monthly' });
        }

        const normalizedStartDate = toDateOnlyString(startDate || new Date());
        const normalizedEndDate = endDate ? toDateOnlyString(endDate) : null;
        const nextRunDate = addFrequency(normalizedStartDate, frequency);

        if (!normalizedStartDate || !nextRunDate) {
            return res.status(400).json({ message: 'Invalid start date' });
        }

        if (normalizedEndDate && normalizedEndDate < normalizedStartDate) {
            return res.status(400).json({ message: 'End date must be after start date' });
        }

        const recurringExpense = await RecurringExpense.create({
            userId,
            amount: parseFloat(amount),
            category,
            description: description || '',
            frequency,
            startDate: normalizedStartDate,
            nextRunDate,
            endDate: normalizedEndDate,
            isActive: true
        });

        res.status(201).json({
            message: 'Recurring expense created successfully',
            recurringExpense
        });
    } catch (error) {
        console.error('Create recurring expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateRecurring = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, category, description, frequency, endDate, isActive } = req.body;

        const recurringExpense = await RecurringExpense.findOne({
            where: { id, userId: req.userId }
        });

        if (!recurringExpense) {
            return res.status(404).json({ message: 'Recurring expense not found' });
        }

        if (frequency && !['daily', 'weekly', 'monthly'].includes(frequency)) {
            return res.status(400).json({ message: 'Frequency must be daily, weekly, or monthly' });
        }

        await recurringExpense.update({
            amount: amount !== undefined ? parseFloat(amount) : recurringExpense.amount,
            category: category || recurringExpense.category,
            description: description !== undefined ? description : recurringExpense.description,
            frequency: frequency || recurringExpense.frequency,
            endDate: endDate !== undefined ? (endDate ? toDateOnlyString(endDate) : null) : recurringExpense.endDate,
            isActive: isActive !== undefined ? Boolean(isActive) : recurringExpense.isActive
        });

        res.json({
            message: 'Recurring expense updated successfully',
            recurringExpense
        });
    } catch (error) {
        console.error('Update recurring expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.deleteRecurring = async (req, res) => {
    try {
        const { id } = req.params;

        const recurringExpense = await RecurringExpense.findOne({
            where: { id, userId: req.userId }
        });

        if (!recurringExpense) {
            return res.status(404).json({ message: 'Recurring expense not found' });
        }

        await recurringExpense.destroy();
        res.json({ message: 'Recurring expense deleted successfully' });
    } catch (error) {
        console.error('Delete recurring expense error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.processRecurringNow = async (req, res) => {
    try {
        const io = req.app.get('io');
        await processDueRecurringExpensesForUser(req.userId, io);
        res.json({ message: 'Recurring expenses processed successfully' });
    } catch (error) {
        console.error('Process recurring expenses error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};