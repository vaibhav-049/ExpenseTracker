const db = require('../models');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');
const Expense = db.Expense;
const RecurringExpense = db.RecurringExpense;
const BankAccount = db.BankAccount;
const ImportFile = db.ImportFile;
const { decryptAccountNumber } = require('../lib/account-vault');
const { Op } = db.Sequelize;
const MAX_BULK_EXPENSES = Number.parseInt(process.env.MAX_BULK_EXPENSES || '500', 10);
const MAX_RECURRING_CATCHUP = Number.parseInt(process.env.MAX_RECURRING_CATCHUP || '24', 10);
const MAX_IMPORT_PASSWORD_ATTEMPTS = Number.parseInt(process.env.MAX_IMPORT_PASSWORD_ATTEMPTS || '50', 10);

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
        const originalDay = date.getDate();
        const targetMonthIndex = date.getMonth() + 1;
        const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
        const normalizedTargetMonth = targetMonthIndex % 12;
        const lastDayOfTargetMonth = new Date(targetYear, normalizedTargetMonth + 1, 0).getDate();
        date.setFullYear(targetYear, normalizedTargetMonth, Math.min(originalDay, lastDayOfTargetMonth));
    }

    return date.toISOString().split('T')[0];
}

function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    fields.push(current.trim());

    return fields.map((value) => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
}

function parseCsvText(csvText) {
    const lines = String(csvText || '').split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
        return [];
    }

    const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const headers = parseCsvLine(lines[0]).map((h) => normalizeHeader(h));
    const findIndex = (aliases) => headers.findIndex((header) => aliases.includes(header));

    const dateIndex = findIndex(['date', 'transactiondate', 'txndate', 'valuedate', 'postingdate']);
    const debitIndex = findIndex(['debit', 'dr', 'debitamount', 'dramount', 'withdrawal', 'withdrawalamount']);
    const creditIndex = findIndex(['credit', 'cr', 'creditamount', 'cramount', 'deposit', 'depositamount']);

    if (dateIndex === -1 || (debitIndex === -1 && creditIndex === -1)) {
        throw new Error('CSV must contain date and debit/dr or credit/cr columns');
    }

    return lines.slice(1)
        .map((line) => {
            const cols = parseCsvLine(line);

            const readColumn = (index) => {
                if (index === -1 || index >= cols.length) return null;
                const value = cols[index];
                return value === '' ? null : value;
            };

            if (
                cols.length <= dateIndex
                || !cols[dateIndex]
            ) {
                return null;
            }

            return {
                date: cols[dateIndex],
                debitAmount: readColumn(debitIndex),
                creditAmount: readColumn(creditIndex)
            };
        })
        .filter((expense) => expense !== null);
}

function parseAmountValue(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const isParenthesizedNegative = /^\(.*\)$/.test(raw);
    const numericText = raw.replace(/[(),\s₹$]/g, '');
    const parsed = parseFloat(numericText);

    if (Number.isNaN(parsed)) return null;
    return isParenthesizedNegative ? -parsed : parsed;
}

function sha256Hex(payload) {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function expenseSignature(expense) {
    const normalizedDate = toDateOnlyString(expense.date);
    const normalizedAmount = Number(expense.amount).toFixed(2);
    return `${normalizedDate}|${normalizedAmount}|${expense.category}|${expense.description || ''}`;
}

async function extractCsvFromZipWithPassword(zipBuffer, password) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-import-'));
    const zipPath = path.join(tempDir, 'import.zip');
    let zip = null;

    try {
        await fs.writeFile(zipPath, zipBuffer);
        zip = new StreamZip.async({ file: zipPath, password });
        const entries = await zip.entries();
        const csvEntry = Object.values(entries).find((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith('.csv'));

        if (!csvEntry) {
            throw new Error('No CSV file found in zip archive');
        }

        const csvBuffer = await zip.entryData(csvEntry.name);
        return csvBuffer.toString('utf8');
    } finally {
        if (zip) {
            await zip.close().catch(() => {});
        }

        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function getDecryptedAccountNumbers(userId) {
    const accounts = await BankAccount.findAll({
        where: { userId, isActive: true },
        attributes: ['accountNumberEncrypted'],
        order: [['createdAt', 'DESC']],
        limit: MAX_IMPORT_PASSWORD_ATTEMPTS
    });

    const accountNumbers = [];
    for (const account of accounts) {
        try {
            const decrypted = decryptAccountNumber(account.accountNumberEncrypted);
            if (decrypted) {
                accountNumbers.push(decrypted);
            }
        } catch (error) {
            console.warn('Failed to decrypt one stored account number:', error.message);
        }
    }

    return accountNumbers;
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
        const transaction = await db.sequelize.transaction();
        let currentRunDate = recurring.nextRunDate;
        let iterations = 0;

        try {
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
                }, { transaction });

                generatedCount += 1;
                iterations += 1;
                currentRunDate = addFrequency(currentRunDate, recurring.frequency);
            }

            recurring.nextRunDate = currentRunDate || recurring.nextRunDate;
            await recurring.save({ transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
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

        const toCsvDate = (value) => {
            if (!value) return '';
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return value;
            }

            const parsedDate = new Date(value);
            if (Number.isNaN(parsedDate.getTime())) return '';
            return parsedDate.toISOString().split('T')[0];
        };

        const rows = [
            'id,date,category,description,amount'
        ];

        expenses.forEach((expense) => {
            rows.push([
                expense.id,
                escapeCsvField(toCsvDate(expense.date)),
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
        let expenses = null;
        let importMode = 'json';
        let importHash = null;

        if (Array.isArray(req.body?.expenses)) {
            expenses = req.body.expenses;
            importHash = sha256Hex(Buffer.from(JSON.stringify(expenses), 'utf8'));
        } else if (req.file) {
            const fileName = String(req.file.originalname || '').toLowerCase();
            const isZip = fileName.endsWith('.zip') || req.file.mimetype === 'application/zip' || req.file.mimetype === 'application/x-zip-compressed';

            if (isZip) {
                const accountNumbers = await getDecryptedAccountNumbers(userId);
                if (accountNumbers.length === 0) {
                    return res.status(400).json({ message: 'No active account numbers found. Add an account number first.' });
                }

                let decryptedCsvText = null;
                for (const accountNumber of accountNumbers) {
                    try {
                        decryptedCsvText = await extractCsvFromZipWithPassword(req.file.buffer, accountNumber);
                        if (decryptedCsvText) {
                            importMode = 'zip-password';
                            break;
                        }
                    } catch {
                        // Try next stored account number.
                    }
                }

                if (!decryptedCsvText) {
                    return res.status(400).json({
                        message: 'Unable to unlock protected CSV with saved account numbers. Please verify account numbers.'
                    });
                }

                expenses = parseCsvText(decryptedCsvText);
                importHash = sha256Hex(Buffer.from(decryptedCsvText, 'utf8'));
            } else {
                importMode = 'file';
                const csvText = req.file.buffer.toString('utf8');
                expenses = parseCsvText(csvText);
                importHash = sha256Hex(Buffer.from(csvText, 'utf8'));
            }
        }

        if (!Array.isArray(expenses) || expenses.length === 0) {
            return res.status(400).json({ message: 'No valid expenses found in import payload' });
        }

        if (expenses.length > MAX_BULK_EXPENSES) {
            return res.status(413).json({
                message: `Too many expenses in one import. Maximum allowed is ${MAX_BULK_EXPENSES}.`,
                maxAllowed: MAX_BULK_EXPENSES,
                received: expenses.length
            });
        }

        if (importHash) {
            const existingImport = await ImportFile.findOne({
                where: { userId, fileHash: importHash },
                attributes: ['id', 'createdAt']
            });

            if (existingImport) {
                return res.status(200).json({
                    message: 'This file has already been imported.',
                    importedCount: 0,
                    skippedDuplicateCount: expenses.length,
                    duplicateFile: true,
                    importMode
                });
            }
        }

        const normalizedExpenses = expenses
            .flatMap((expense) => {
                if (expense.date == null) {
                    return [];
                }

                const parsedDate = new Date(expense.date);

                if (Number.isNaN(parsedDate.getTime())) {
                    return [];
                }

                const debitAmount = parseAmountValue(expense.debitAmount ?? expense.debit ?? expense.dr ?? expense.amount);
                const creditAmount = parseAmountValue(expense.creditAmount ?? expense.credit ?? expense.cr);
                const rows = [];

                if (debitAmount !== null && debitAmount > 0) {
                    rows.push({
                        userId,
                        amount: debitAmount,
                        category: 'Bank Debit',
                        description: 'Imported bank debit',
                        date: parsedDate
                    });
                }

                if (creditAmount !== null && creditAmount > 0) {
                    rows.push({
                        userId,
                        amount: -creditAmount,
                        category: 'Bank Credit',
                        description: 'Imported bank credit',
                        date: parsedDate
                    });
                }

                return rows;
            })
            .filter((expense) => expense && !Number.isNaN(expense.amount) && expense.amount !== 0 && expense.category);

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

        const uniqueDates = [...new Set(normalizedExpenses
            .map((expense) => toDateOnlyString(expense.date))
            .filter((value) => value))];

        const uniqueAmounts = [...new Set(normalizedExpenses.map((expense) => Number(expense.amount).toFixed(2)))];

        let existingSignatures = new Set();
        if (uniqueDates.length > 0 && uniqueAmounts.length > 0) {
            const existingExpenses = await Expense.findAll({
                where: {
                    userId,
                    date: { [Op.in]: uniqueDates },
                    category: { [Op.in]: ['Bank Debit', 'Bank Credit'] },
                    description: { [Op.in]: ['Imported bank debit', 'Imported bank credit'] },
                    amount: { [Op.in]: uniqueAmounts }
                },
                attributes: ['date', 'amount', 'category', 'description']
            });

            existingSignatures = new Set(existingExpenses.map((expense) => expenseSignature(expense)));
        }

        const dedupedExpenses = normalizedExpenses.filter((expense) => !existingSignatures.has(expenseSignature(expense)));
        const skippedDuplicateCount = normalizedExpenses.length - dedupedExpenses.length;

        if (dedupedExpenses.length === 0) {
            if (importHash) {
                await ImportFile.create({
                    userId,
                    fileHash: importHash,
                    importMode,
                    importedCount: 0
                });
            }

            return res.status(200).json({
                message: 'No new transactions found. All rows were duplicates.',
                importedCount: 0,
                skippedDuplicateCount,
                importMode
            });
        }

        await Expense.bulkCreate(dedupedExpenses);

        if (importHash) {
            await ImportFile.create({
                userId,
                fileHash: importHash,
                importMode,
                importedCount: dedupedExpenses.length
            });
        }

        if (io) {
            io.to(`user_${userId}`).emit('expense:changed', {
                action: 'imported',
                count: dedupedExpenses.length
            });
        }

        res.status(201).json({
            message: 'Expenses imported successfully',
            importedCount: dedupedExpenses.length,
            skippedDuplicateCount,
            importMode
        });
    } catch (error) {
        if (error && error.name === 'SequelizeUniqueConstraintError') {
            return res.status(200).json({
                message: 'This file has already been imported.',
                importedCount: 0,
                duplicateFile: true
            });
        }

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
        const parsedAmount = parseFloat(amount);

        if (!normalizedStartDate || !nextRunDate) {
            return res.status(400).json({ message: 'Invalid start date' });
        }

        if (Number.isNaN(parsedAmount)) {
            return res.status(400).json({ message: 'Amount must be a valid number' });
        }

        if (normalizedEndDate && normalizedEndDate < normalizedStartDate) {
            return res.status(400).json({ message: 'End date must be after start date' });
        }

        const recurringExpense = await RecurringExpense.create({
            userId,
            amount: parsedAmount,
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

        const nextFrequency = frequency || recurringExpense.frequency;
        const parsedAmount = amount !== undefined ? parseFloat(amount) : recurringExpense.amount;

        if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ message: 'Amount must be a positive number' });
        }

        let nextRunDate = recurringExpense.nextRunDate;
        if (frequency && frequency !== recurringExpense.frequency) {
            const scheduleBaseDate = toDateOnlyString(new Date());
            nextRunDate = addFrequency(scheduleBaseDate, nextFrequency);

            if (!nextRunDate) {
                return res.status(400).json({ message: 'Invalid frequency update' });
            }
        }

        await recurringExpense.update({
            amount: parsedAmount,
            category: category || recurringExpense.category,
            description: description !== undefined ? description : recurringExpense.description,
            frequency: nextFrequency,
            nextRunDate,
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

exports.getAnomalies = async (req, res) => {
    try {
        const userId = req.userId;
        const lookbackDays = 90;
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - lookbackDays);

        const expenses = await Expense.findAll({
            where: {
                userId,
                date: {
                    [Op.gte]: fromDate
                }
            },
            order: [['amount', 'DESC']]
        });

        if (expenses.length < 5) {
            return res.json({
                anomalies: [],
                message: 'Not enough data to detect anomalies yet.'
            });
        }

        const amounts = expenses.map((exp) => parseFloat(exp.amount || 0));
        const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
        const variance = amounts.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / amounts.length;
        const stdDev = Math.sqrt(variance);
        const threshold = mean + (1.5 * stdDev);

        const anomalies = expenses
            .filter((exp) => parseFloat(exp.amount || 0) > threshold)
            .slice(0, 5)
            .map((exp) => ({
                id: exp.id,
                date: exp.date,
                category: exp.category,
                description: exp.description || '',
                amount: parseFloat(exp.amount || 0)
            }));

        res.json({
            anomalies,
            stats: {
                threshold: Number(threshold.toFixed(2)),
                average: Number(mean.toFixed(2)),
                stdDev: Number(stdDev.toFixed(2))
            }
        });
    } catch (error) {
        console.error('Get anomalies error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};