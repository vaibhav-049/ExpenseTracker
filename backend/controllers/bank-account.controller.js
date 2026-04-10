const db = require('../models');
const { encryptAccountNumber } = require('../lib/account-vault');

const BankAccount = db.BankAccount;

function normalizeAccountNumber(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

exports.list = async (req, res) => {
    try {
        const accounts = await BankAccount.findAll({
            where: { userId: req.userId },
            attributes: ['id', 'accountType', 'label', 'accountNumberLast4', 'isActive', 'createdAt'],
            order: [['createdAt', 'DESC']]
        });

        res.json({ accounts });
    } catch (error) {
        console.error('List bank accounts error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const { accountNumber, accountType, label } = req.body;
        const normalized = normalizeAccountNumber(accountNumber);

        if (!normalized || normalized.length < 4) {
            return res.status(400).json({ message: 'Account number must be at least 4 characters' });
        }

        const encrypted = encryptAccountNumber(normalized);
        const account = await BankAccount.create({
            userId: req.userId,
            accountType: accountType || 'bank',
            label: label || null,
            accountNumberEncrypted: encrypted,
            accountNumberLast4: normalized.slice(-4),
            isActive: true
        });

        res.status(201).json({
            message: 'Account added successfully',
            account: {
                id: account.id,
                accountType: account.accountType,
                label: account.label,
                accountNumberLast4: account.accountNumberLast4,
                isActive: account.isActive,
                createdAt: account.createdAt
            }
        });
    } catch (error) {
        console.error('Create bank account error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { accountNumber, accountType, label, isActive } = req.body;

        const account = await BankAccount.findOne({
            where: { id, userId: req.userId }
        });

        if (!account) {
            return res.status(404).json({ message: 'Account not found' });
        }

        const updates = {
            accountType: accountType || account.accountType,
            label: label !== undefined ? (label || null) : account.label,
            isActive: isActive !== undefined ? Boolean(isActive) : account.isActive
        };

        if (accountNumber !== undefined) {
            const normalized = normalizeAccountNumber(accountNumber);
            if (!normalized || normalized.length < 4) {
                return res.status(400).json({ message: 'Account number must be at least 4 characters' });
            }
            updates.accountNumberEncrypted = encryptAccountNumber(normalized);
            updates.accountNumberLast4 = normalized.slice(-4);
        }

        await account.update(updates);

        res.json({
            message: 'Account updated successfully',
            account: {
                id: account.id,
                accountType: account.accountType,
                label: account.label,
                accountNumberLast4: account.accountNumberLast4,
                isActive: account.isActive,
                createdAt: account.createdAt
            }
        });
    } catch (error) {
        console.error('Update bank account error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await BankAccount.destroy({
            where: { id, userId: req.userId }
        });

        if (!deleted) {
            return res.status(404).json({ message: 'Account not found' });
        }

        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete bank account error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
