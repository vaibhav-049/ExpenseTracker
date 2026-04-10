const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../models');
const User = db.User;
const Expense = db.Expense;
const { Op } = db.Sequelize;

exports.register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name,
            email,
            password: hashedPassword
        });

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            },
            token
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                budget: user.budget
            },
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findByPk(req.userId, {
            attributes: ['id', 'name', 'email', 'budget', 'createdAt']
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ user });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getBudget = async (req, res) => {
    try {
        const user = await User.findByPk(req.userId, {
            attributes: ['id', 'budget']
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ budget: parseFloat(user.budget || 0) });

    } catch (error) {
        console.error('Get budget error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateBudget = async (req, res) => {
    try {
        const io = req.app.get('io');
        const { budget } = req.body;
        const parsedBudget = parseFloat(budget);

        if (Number.isNaN(parsedBudget) || parsedBudget < 0) {
            return res.status(400).json({ message: 'Budget must be a valid non-negative number' });
        }

        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.budget = parsedBudget;
        await user.save();

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const monthlyExpenses = await Expense.findAll({
            where: {
                userId: req.userId,
                date: {
                    [Op.gte]: startOfMonth,
                    [Op.lt]: startOfNextMonth
                }
            }
        });

        const monthlySpending = monthlyExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);

        if (io) {
            io.to(`user_${req.userId}`).emit('budget:changed', {
                budget: parsedBudget,
                monthlySpending
            });
        } else {
            console.warn('Socket.io instance not available while emitting budget:changed');
        }

        if (io && parsedBudget > 0 && monthlySpending >= parsedBudget * 0.8) {
            io.to(`user_${req.userId}`).emit('budget:alert', {
                monthlySpending,
                budget: parsedBudget,
                level: monthlySpending >= parsedBudget ? 'exceeded' : 'warning'
            });
        }

        res.json({
            message: 'Budget updated successfully',
            budget: parsedBudget
        });

    } catch (error) {
        console.error('Update budget error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
