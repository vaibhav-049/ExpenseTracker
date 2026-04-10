const db = require('../models');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const StreamZip = require('node-stream-zip');
const XLSX = require('xlsx');
const execFileAsync = promisify(execFile);
const User = db.User;
const Expense = db.Expense;
const RecurringExpense = db.RecurringExpense;
const BankAccount = db.BankAccount;
const ImportFile = db.ImportFile;
const { decryptAccountNumber } = require('../lib/account-vault');
const { Op } = db.Sequelize;
const MAX_BULK_EXPENSES = Number.parseInt(process.env.MAX_BULK_EXPENSES || '500', 10);
const MAX_RECURRING_CATCHUP = Number.parseInt(process.env.MAX_RECURRING_CATCHUP || '24', 10);
const MAX_IMPORT_PASSWORD_ATTEMPTS = Number.parseInt(process.env.MAX_IMPORT_PASSWORD_ATTEMPTS || '50', 10);
const IMPORT_DATE_ALIASES = [
    'date', 'transactiondate', 'txndate', 'valuedate', 'postingdate', 'trandate', 'transactiondt', 'entrydate'
];
const IMPORT_DEBIT_ALIASES = [
    'debit', 'dr', 'debitamount', 'dramount', 'withdrawal', 'withdrawalamount', 'debitamt', 'withdrawlamt', 'paidout'
];
const IMPORT_CREDIT_ALIASES = [
    'credit', 'cr', 'creditamount', 'cramount', 'deposit', 'depositamount', 'creditamt', 'depositamt', 'paidin'
];
const IMPORT_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Education', 'Other'];

function toDateOnlyString(dateInput) {
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

function normalizeImportHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findImportColumnIndex(headers, aliases) {
    return headers.findIndex((header) => aliases.includes(header));
}

function resolveImportColumnsFromHeader(headers) {
    const dateIndex = findImportColumnIndex(headers, IMPORT_DATE_ALIASES);
    const debitIndex = findImportColumnIndex(headers, IMPORT_DEBIT_ALIASES);
    const creditIndex = findImportColumnIndex(headers, IMPORT_CREDIT_ALIASES);

    if (dateIndex === -1 || (debitIndex === -1 && creditIndex === -1)) {
        return null;
    }

    return {
        dateIndex,
        debitIndex,
        creditIndex
    };
}

function findHeaderRowIndexFromRows(rows) {
    const maxScan = Math.min(rows.length, 25);
    for (let i = 0; i < maxScan; i += 1) {
        const normalizedHeaders = rows[i].map((value) => normalizeImportHeader(value));
        const resolved = resolveImportColumnsFromHeader(normalizedHeaders);
        if (resolved) {
            return {
                headerRowIndex: i,
                ...resolved
            };
        }
    }

    return null;
}

function parseCsvText(csvText) {
    const lines = String(csvText || '').split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
        return [];
    }

    const parsedRows = lines.map((line) => parseCsvLine(line));
    const resolvedColumns = findHeaderRowIndexFromRows(parsedRows);

    if (!resolvedColumns) {
        throw new Error('CSV must contain date and debit/dr or credit/cr columns');
    }

    const {
        headerRowIndex,
        dateIndex,
        debitIndex,
        creditIndex
    } = resolvedColumns;

    return parsedRows.slice(headerRowIndex + 1)
        .map((cols) => {

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

function toDateFromSpreadsheetCell(cellValue) {
    if (cellValue === null || cellValue === undefined || cellValue === '') return null;

    if (typeof cellValue === 'number') {
        const dateCode = XLSX.SSF.parse_date_code(cellValue);
        if (!dateCode) return null;
        const date = parseImportDate(new Date(Date.UTC(dateCode.y, dateCode.m - 1, dateCode.d)));
        return date ? toDateOnlyString(date) : null;
    }

    const parsed = parseImportDate(cellValue);
    return parsed ? toDateOnlyString(parsed) : null;
}

function parseSpreadsheetRows(rows) {
    if (!Array.isArray(rows) || rows.length < 1) return null;

    const resolvedColumns = findHeaderRowIndexFromRows(rows);
    if (!resolvedColumns) {
        return null;
    }

    const {
        headerRowIndex,
        dateIndex,
        debitIndex,
        creditIndex
    } = resolvedColumns;

    return rows.slice(headerRowIndex + 1)
        .map((row) => {
            const readColumn = (index) => {
                if (index === -1 || index >= row.length) return null;
                const value = row[index];
                return value === '' ? null : value;
            };

            const parsedDate = toDateFromSpreadsheetCell(readColumn(dateIndex));
            if (!parsedDate) return null;

            return {
                date: parsedDate,
                debitAmount: readColumn(debitIndex),
                creditAmount: readColumn(creditIndex)
            };
        })
        .filter((expense) => expense !== null);
}

function parseSpreadsheetBuffer(fileBuffer, password) {
    const workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        ...(password ? { password } : {})
    });

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
        return [];
    }

    let matchedColumns = false;

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const parsed = parseSpreadsheetRows(rows);

        if (parsed === null) {
            continue;
        }

        matchedColumns = true;
        if (parsed.length > 0) {
            return parsed;
        }
    }

    if (matchedColumns) {
        return [];
    }

    throw new Error('Spreadsheet must contain date and debit/dr or credit/cr columns');
}

function isPasswordProtectedSpreadsheetError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('password') && message.includes('protect');
}

async function parseProtectedSpreadsheetWithAccounts(fileBuffer, accountNumbers) {
    let lastError = null;

    for (const accountNumber of accountNumbers) {
        try {
            const parsed = parseSpreadsheetBuffer(fileBuffer, accountNumber);
            return {
                expenses: parsed,
                formatError: null,
                unlockError: null
            };
        } catch (error) {
            lastError = error;

            if (String(error?.message || '').includes('Spreadsheet must contain')) {
                return {
                    expenses: null,
                    formatError: error,
                    unlockError: null
                };
            }

            // Try the next saved account number.
        }
    }

    return {
        expenses: null,
        formatError: null,
        unlockError: lastError
    };
}

async function decryptSpreadsheetWithPython(fileBuffer, password) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-xls-decrypt-'));
    const encryptedPath = path.join(tempDir, 'encrypted.xlsx');
    const decryptedPath = path.join(tempDir, 'decrypted.xlsx');
    const scriptPath = path.join(__dirname, '..', 'lib', 'decrypt_excel.py');

    try {
        await fs.writeFile(encryptedPath, fileBuffer);

        await execFileAsync('python', [scriptPath, encryptedPath, decryptedPath], {
            windowsHide: true,
            env: {
                ...process.env,
                IMPORT_XLS_PASSWORD: String(password)
            }
        });

        return await fs.readFile(decryptedPath);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function parseProtectedSpreadsheetWithPythonAccounts(fileBuffer, accountNumbers) {
    let lastError = null;

    for (const accountNumber of accountNumbers) {
        try {
            const decryptedBuffer = await decryptSpreadsheetWithPython(fileBuffer, accountNumber);
            const parsed = parseSpreadsheetBuffer(decryptedBuffer);
            return {
                expenses: parsed,
                formatError: null,
                unlockError: null,
                usedPythonFallback: true
            };
        } catch (error) {
            lastError = error;

            if (String(error?.message || '').includes('Spreadsheet must contain')) {
                return {
                    expenses: null,
                    formatError: error,
                    unlockError: null,
                    usedPythonFallback: true
                };
            }
        }
    }

    return {
        expenses: null,
        formatError: null,
        unlockError: lastError,
        usedPythonFallback: true
    };
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

function parseImportDate(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const normalizeFutureYear = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return null;
        }

        const now = new Date();
        const maxFuture = new Date(now);
        maxFuture.setDate(maxFuture.getDate() + 30);

        const normalized = new Date(date);
        let guard = 0;
        while (normalized > maxFuture && guard < 6) {
            normalized.setFullYear(normalized.getFullYear() - 1);
            guard += 1;
        }

        return normalized;
    };

    if (value instanceof Date) {
        return normalizeFutureYear(value);
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const now = new Date();

    const inferYearForMonthDay = (month, day) => {
        let year = now.getFullYear();
        let candidate = new Date(year, month - 1, day);
        if (
            Number.isNaN(candidate.getTime())
            || candidate.getMonth() !== (month - 1)
            || candidate.getDate() !== day
        ) {
            return null;
        }

        // If month/day appears too far in the future, treat it as previous year statement row.
        const maxFuture = new Date(now);
        maxFuture.setDate(maxFuture.getDate() + 30);
        if (candidate > maxFuture) {
            year -= 1;
            candidate = new Date(year, month - 1, day);
            if (
                Number.isNaN(candidate.getTime())
                || candidate.getMonth() !== (month - 1)
                || candidate.getDate() !== day
            ) {
                return null;
            }
        }

        return candidate;
    };

    const monthMap = {
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        sept: 9,
        oct: 10,
        nov: 11,
        dec: 12
    };

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const isoDate = new Date(`${raw}T00:00:00`);
        return normalizeFutureYear(isoDate);
    }

    const dmyOrMdyMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (dmyOrMdyMatch) {
        let first = Number.parseInt(dmyOrMdyMatch[1], 10);
        let second = Number.parseInt(dmyOrMdyMatch[2], 10);
        let year = Number.parseInt(dmyOrMdyMatch[3], 10);

        if (year < 100) {
            year += year >= 70 ? 1900 : 2000;
        }

        let day = first;
        let month = second;

        if (first <= 12 && second > 12) {
            month = first;
            day = second;
        }

        const parsed = new Date(year, month - 1, day);
        if (
            Number.isNaN(parsed.getTime())
            || parsed.getFullYear() !== year
            || parsed.getMonth() !== (month - 1)
            || parsed.getDate() !== day
        ) {
            return null;
        }

        return normalizeFutureYear(parsed);
    }

    const dayMonthOnlyMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})$/);
    if (dayMonthOnlyMatch) {
        const first = Number.parseInt(dayMonthOnlyMatch[1], 10);
        const second = Number.parseInt(dayMonthOnlyMatch[2], 10);

        let day = first;
        let month = second;
        if (first <= 12 && second > 12) {
            month = first;
            day = second;
        }

        return inferYearForMonthDay(month, day);
    }

    const dayMonthNameYearMatch = raw.match(/^(\d{1,2})\s+([a-zA-Z]{3,9})\s+(\d{2,4})$/);
    if (dayMonthNameYearMatch) {
        const day = Number.parseInt(dayMonthNameYearMatch[1], 10);
        const monthToken = dayMonthNameYearMatch[2].toLowerCase();
        const month = monthMap[monthToken.slice(0, 4)] || monthMap[monthToken.slice(0, 3)];
        if (!month) return null;

        let year = Number.parseInt(dayMonthNameYearMatch[3], 10);
        if (year < 100) {
            year += 2000;
        }

        const parsed = new Date(year, month - 1, day);
        if (
            Number.isNaN(parsed.getTime())
            || parsed.getFullYear() !== year
            || parsed.getMonth() !== (month - 1)
            || parsed.getDate() !== day
        ) {
            return null;
        }

        return normalizeFutureYear(parsed);
    }

    const dayMonthNameOnlyMatch = raw.match(/^(\d{1,2})\s+([a-zA-Z]{3,9})$/);
    if (dayMonthNameOnlyMatch) {
        const day = Number.parseInt(dayMonthNameOnlyMatch[1], 10);
        const monthToken = dayMonthNameOnlyMatch[2].toLowerCase();
        const month = monthMap[monthToken.slice(0, 4)] || monthMap[monthToken.slice(0, 3)];
        if (!month) return null;

        return inferYearForMonthDay(month, day);
    }

    return null;
}

function clampScore(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function startOfDay(dateValue) {
    const date = new Date(dateValue);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getBudgetAdherenceScore(monthlySpending, monthlyBudget) {
    if (!(monthlyBudget > 0)) {
        return {
            score: 65,
            usageRatio: null
        };
    }

    const usageRatio = monthlySpending / monthlyBudget;
    if (usageRatio <= 0.6) return { score: 100, usageRatio };
    if (usageRatio <= 0.8) return { score: 90, usageRatio };
    if (usageRatio <= 1) return { score: 75, usageRatio };
    if (usageRatio <= 1.2) return { score: 55, usageRatio };
    return { score: 35, usageRatio };
}

function getWeeklyConsistencyScore(expenses) {
    const weekTotals = [];
    const today = startOfDay(new Date());

    for (let week = 0; week < 8; week += 1) {
        const weekEnd = new Date(today);
        weekEnd.setDate(weekEnd.getDate() - (7 * week));
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 6);

        const total = expenses.reduce((sum, expense) => {
            const expenseDate = startOfDay(expense.date);
            if (expenseDate >= weekStart && expenseDate <= weekEnd) {
                return sum + toNumber(expense.amount);
            }
            return sum;
        }, 0);

        weekTotals.push(total);
    }

    const mean = weekTotals.reduce((sum, value) => sum + value, 0) / weekTotals.length;
    if (mean === 0) {
        return {
            score: 70,
            weekTotals
        };
    }

    const variance = weekTotals.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / weekTotals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / mean;
    const score = clampScore(Math.round(100 - (coefficientOfVariation * 120)), 35, 100);

    return {
        score,
        weekTotals
    };
}

function getEssentialSpendScore(expenses) {
    const essentialCategories = new Set(['Food', 'Bills', 'Health', 'Education']);
    const totals = expenses.reduce((acc, expense) => {
        const amount = toNumber(expense.amount);
        acc.total += amount;
        if (essentialCategories.has(expense.category)) {
            acc.essential += amount;
        }
        return acc;
    }, { essential: 0, total: 0 });

    const ratio = totals.total > 0 ? (totals.essential / totals.total) : 0;
    if (totals.total === 0) {
        return {
            score: 70,
            ratio
        };
    }

    if (ratio >= 0.45 && ratio <= 0.75) return { score: 92, ratio };
    if (ratio >= 0.35 && ratio < 0.45) return { score: 80, ratio };
    if (ratio > 0.75 && ratio <= 0.88) return { score: 76, ratio };
    if (ratio >= 0.25 && ratio < 0.35) return { score: 64, ratio };
    return { score: 52, ratio };
}

function getMonthOverMonthScore(expenses) {
    const today = startOfDay(new Date());
    const currentStart = new Date(today);
    currentStart.setDate(currentStart.getDate() - 29);
    const previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - 29);

    let current = 0;
    let previous = 0;

    expenses.forEach((expense) => {
        const date = startOfDay(expense.date);
        const amount = toNumber(expense.amount);
        if (date >= currentStart && date <= today) {
            current += amount;
            return;
        }

        if (date >= previousStart && date <= previousEnd) {
            previous += amount;
        }
    });

    if (previous === 0) {
        return {
            score: 70,
            changeRatio: 0,
            current,
            previous
        };
    }

    const changeRatio = (current - previous) / previous;
    if (changeRatio <= -0.15) return { score: 100, changeRatio, current, previous };
    if (changeRatio <= -0.05) return { score: 85, changeRatio, current, previous };
    if (changeRatio <= 0.05) return { score: 70, changeRatio, current, previous };
    if (changeRatio <= 0.15) return { score: 55, changeRatio, current, previous };
    return { score: 40, changeRatio, current, previous };
}

function getHealthGrade(score) {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    return 'D';
}

function buildCoachTips(context) {
    const tips = [];

    if (!(context.monthlyBudget > 0)) {
        tips.push('Set a monthly budget to unlock stronger coaching and better score stability.');
    } else if (context.budgetUsageRatio > 1) {
        tips.push(`You are at ${(context.budgetUsageRatio * 100).toFixed(0)}% of budget. Trim flexible categories this week.`);
    } else if (context.budgetUsageRatio >= 0.8) {
        tips.push('Budget usage is above 80%. Keep non-essential spending minimal for the rest of the month.');
    }

    if (context.momChangeRatio > 0.1) {
        tips.push(`Spending is ${(context.momChangeRatio * 100).toFixed(1)}% higher than last month. Review high-growth categories.`);
    } else if (context.momChangeRatio < -0.08) {
        tips.push('Great improvement versus last month. Keep this trend consistent for two more weeks.');
    }

    if (context.essentialRatio < 0.35) {
        tips.push('Essential spending ratio is low. Watch impulse purchases in discretionary categories.');
    } else if (context.essentialRatio > 0.82) {
        tips.push('Most spending is essential. Explore bill optimization to improve score further.');
    }

    if (context.weeklyChangeRatio > 0.15) {
        tips.push('This week spend is sharply above last week. Set a small weekly cap to avoid drift.');
    }

    if (tips.length === 0) {
        tips.push('Healthy pattern detected. Continue tracking regularly and keep weekly variance low.');
    }

    return tips.slice(0, 3);
}

function sha256Hex(payload) {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function expenseSignature(expense) {
    const normalizedDate = toDateOnlyString(expense.date);
    const normalizedAmount = Number(expense.amount).toFixed(2);
    return `${normalizedDate}|${normalizedAmount}|${expense.category}|${expense.description || ''}`;
}

function pickImportedMetadata(userId, date, amount, type) {
    const signature = `${userId}|${toDateOnlyString(date)}|${Number(amount).toFixed(2)}|${type}`;
    const hash = crypto.createHash('md5').update(signature).digest('hex');
    const hashInt = Number.parseInt(hash.slice(0, 8), 16);

    const category = IMPORT_CATEGORIES[hashInt % IMPORT_CATEGORIES.length];
    return { category };
}

async function extractImportFileFromZipWithPassword(zipBuffer, password) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-import-'));
    const zipPath = path.join(tempDir, 'import.zip');
    let zip = null;

    try {
        await fs.writeFile(zipPath, zipBuffer);
        zip = new StreamZip.async({ file: zipPath, password });
        const entries = await zip.entries();
        const importEntry = Object.values(entries).find((entry) => {
            if (entry.isDirectory) return false;
            const lower = entry.name.toLowerCase();
            return lower.endsWith('.csv') || lower.endsWith('.xls') || lower.endsWith('.xlsx');
        });

        if (!importEntry) {
            throw new Error('No supported import file (.csv/.xls/.xlsx) found in zip archive');
        }

        const fileBuffer = await zip.entryData(importEntry.name);
        const lowerName = importEntry.name.toLowerCase();

        if (lowerName.endsWith('.csv')) {
            return {
                kind: 'csv',
                content: fileBuffer.toString('utf8')
            };
        }

        return {
            kind: 'excel',
            content: fileBuffer
        };
    } finally {
        if (zip) {
            await zip.close().catch(() => {});
        }

        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function getDecryptedAccountNumbers(userId, selectedAccountId) {
    const accounts = await BankAccount.findAll({
        where: { userId, isActive: true },
        attributes: ['id', 'accountNumberEncrypted'],
        order: [['createdAt', 'DESC']],
        limit: MAX_IMPORT_PASSWORD_ATTEMPTS
    });

    if (selectedAccountId) {
        const selected = accounts.find((account) => Number(account.id) === Number(selectedAccountId));
        if (!selected) {
            throw new Error('Selected account not found or inactive');
        }

        const remaining = accounts.filter((account) => Number(account.id) !== Number(selectedAccountId));
        accounts.splice(0, accounts.length, selected, ...remaining);
    }

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
        let whereClause = {
            userId,
            amount: { [Op.gt]: 0 }
        };

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
            amount: typeof amount !== 'undefined' ? amount : expense.amount,
            category: typeof category !== 'undefined' ? category : expense.category,
            description: description !== undefined ? description : expense.description,
            date: typeof date !== 'undefined' ? date : expense.date
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

exports.deleteBulk = async (req, res) => {
    try {
        const userId = req.userId;
        const io = req.app.get('io');
        const { ids, clearImportHistory } = req.body || {};

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array is required' });
        }

        const normalizedIds = [...new Set(ids
            .map((id) => Number.parseInt(id, 10))
            .filter((id) => Number.isInteger(id) && id > 0))];

        if (normalizedIds.length === 0) {
            return res.status(400).json({ message: 'No valid expense ids provided' });
        }

        const deletedCount = await Expense.destroy({
            where: {
                userId,
                id: { [Op.in]: normalizedIds }
            }
        });

        if (clearImportHistory) {
            await ImportFile.destroy({
                where: { userId }
            });
        }

        if (io) {
            io.to(`user_${userId}`).emit('expense:changed', {
                action: 'bulk-deleted',
                count: deletedCount
            });
        }

        res.json({
            message: 'Expenses deleted successfully',
            deletedCount,
            requestedCount: normalizedIds.length,
            importHistoryCleared: Boolean(clearImportHistory)
        });
    } catch (error) {
        console.error('Bulk delete expenses error:', error);
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
        const debitExpenses = expenses.filter((exp) => Number(exp.amount) > 0);
        const totalSpending = debitExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
        const categoryBreakdown = {};
        debitExpenses.forEach(exp => {
            if (!categoryBreakdown[exp.category]) {
                categoryBreakdown[exp.category] = 0;
            }
            categoryBreakdown[exp.category] += parseFloat(exp.amount);
        });

        res.json({
            totalSpending,
            categoryBreakdown,
            expenseCount: debitExpenses.length,
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
        const whereClause = {
            userId,
            amount: { [Op.gt]: 0 }
        };

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
        const selectedAccountId = req.body?.selectedAccountId || null;
        let expenses = null;
        let importMode = 'json';
        let importHash = null;

        if (Array.isArray(req.body?.expenses)) {
            expenses = req.body.expenses;
            importHash = sha256Hex(Buffer.from(JSON.stringify(expenses), 'utf8'));
        } else if (req.file) {
            const fileName = String(req.file.originalname || '').toLowerCase();
            const isZip = fileName.endsWith('.zip') || req.file.mimetype === 'application/zip' || req.file.mimetype === 'application/x-zip-compressed';
            const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx');
            const isCsv = fileName.endsWith('.csv');

            if (isZip) {
                const accountNumbers = await getDecryptedAccountNumbers(userId, selectedAccountId);
                if (accountNumbers.length === 0) {
                    return res.status(400).json({ message: 'No active account numbers found. Add an account number first.' });
                }

                let extractedImport = null;
                let lastZipError = null;
                for (const accountNumber of accountNumbers) {
                    try {
                        extractedImport = await extractImportFileFromZipWithPassword(req.file.buffer, accountNumber);
                        if (extractedImport) {
                            importMode = extractedImport.kind === 'excel' ? 'zip-password-excel' : 'zip-password';
                            break;
                        }
                    } catch (error) {
                        lastZipError = error;
                        // Try next stored account number.
                    }
                }

                if (!extractedImport) {
                    const zipErrorMessage = String(lastZipError?.message || '').toLowerCase();

                    if (zipErrorMessage.includes('no supported import file')) {
                        return res.status(400).json({
                            message: 'ZIP is unlocked but does not contain .csv/.xls/.xlsx file. Please upload a supported statement file inside ZIP.'
                        });
                    }

                    return res.status(400).json({
                        message: 'Unable to unlock protected CSV with saved account numbers. Please verify account numbers.'
                    });
                }

                if (extractedImport.kind === 'csv') {
                    expenses = parseCsvText(extractedImport.content);
                    importHash = sha256Hex(Buffer.from(extractedImport.content, 'utf8'));
                } else {
                    try {
                        expenses = parseSpreadsheetBuffer(extractedImport.content);
                    } catch (error) {
                        if (isPasswordProtectedSpreadsheetError(error)) {
                            let result = await parseProtectedSpreadsheetWithAccounts(extractedImport.content, accountNumbers);

                            if (!result.expenses && !result.formatError) {
                                result = await parseProtectedSpreadsheetWithPythonAccounts(extractedImport.content, accountNumbers);
                            }

                            if (result.formatError) {
                                return res.status(400).json({
                                    message: 'Spreadsheet unlocked, but required columns were not found. Keep only date and debit/dr or credit/cr columns in sheet.'
                                });
                            }

                            if (!result.expenses) {
                                return res.status(400).json({
                                    message: 'Unable to unlock protected spreadsheet with saved account numbers. Please verify account numbers.'
                                });
                            }

                            expenses = result.expenses;
                            importMode = 'zip-password-excel';
                        } else {
                            return res.status(400).json({
                                message: 'Invalid spreadsheet format. Ensure first sheet has date and debit/dr or credit/cr columns.'
                            });
                        }
                    }

                    importHash = sha256Hex(extractedImport.content);
                }
            } else if (isExcel) {
                importMode = 'excel';
                try {
                    expenses = parseSpreadsheetBuffer(req.file.buffer);
                } catch (error) {
                    if (isPasswordProtectedSpreadsheetError(error)) {
                        const accountNumbers = await getDecryptedAccountNumbers(userId, selectedAccountId);
                        if (accountNumbers.length === 0) {
                            return res.status(400).json({
                                message: 'Spreadsheet is password-protected. Add an account number first for auto-unlock.'
                            });
                        }

                        let result = await parseProtectedSpreadsheetWithAccounts(req.file.buffer, accountNumbers);

                        if (!result.expenses && !result.formatError) {
                            result = await parseProtectedSpreadsheetWithPythonAccounts(req.file.buffer, accountNumbers);
                        }

                        if (result.formatError) {
                            return res.status(400).json({
                                message: 'Spreadsheet unlocked, but required columns were not found. Keep only date and debit/dr or credit/cr columns in sheet.'
                            });
                        }

                        if (!result.expenses) {
                            const unlockMessage = String(result.unlockError?.message || '').toLowerCase();
                            if (unlockMessage.includes('no module named') || unlockMessage.includes('msoffcrypto')) {
                                return res.status(500).json({
                                    message: 'Server missing Excel decrypt dependency. Please contact admin.'
                                });
                            }

                            if (unlockMessage.includes('unsupported') || unlockMessage.includes('encrypt') || unlockMessage.includes('password')) {
                                return res.status(400).json({
                                    message: 'This protected Excel format is not supported for auto-unlock. Please upload password-protected ZIP with CSV or a decrypted CSV/XLSX export.'
                                });
                            }

                            return res.status(400).json({
                                message: 'Unable to unlock protected spreadsheet with saved account numbers. Please verify account numbers.'
                            });
                        }

                        expenses = result.expenses;
                        importMode = 'excel-password';
                    } else {
                        return res.status(400).json({
                            message: 'Invalid spreadsheet format. Ensure first sheet has date and debit/dr or credit/cr columns.'
                        });
                    }
                }
                importHash = sha256Hex(req.file.buffer);
            } else if (!isCsv) {
                return res.status(400).json({
                    message: 'Unsupported file type. Please upload .csv, .zip, .xls, or .xlsx file.'
                });
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

                const parsedDate = parseImportDate(expense.date);

                if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
                    return [];
                }

                const normalizedDate = toDateOnlyString(parsedDate);
                if (!normalizedDate) {
                    return [];
                }

                const debitAmount = parseAmountValue(expense.debitAmount ?? expense.debit ?? expense.dr ?? expense.amount);
                const creditAmount = parseAmountValue(expense.creditAmount ?? expense.credit ?? expense.cr);
                const rows = [];

                if (debitAmount !== null && debitAmount > 0) {
                    const metadata = pickImportedMetadata(userId, parsedDate, debitAmount, 'debit');
                    rows.push({
                        userId,
                        amount: debitAmount,
                        category: metadata.category,
                        description: null,
                        date: normalizedDate
                    });
                }

                // Credit rows are intentionally ignored as per current business rule.

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
                    category: { [Op.in]: IMPORT_CATEGORIES },
                    [Op.or]: [
                        { description: null },
                        { description: '' }
                    ],
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
        const safeImportErrors = [
            'CSV must contain date and debit/dr or credit/cr columns',
            'Spreadsheet must contain date and debit/dr or credit/cr columns',
            'No supported import file (.csv/.xls/.xlsx) found in zip archive'
        ];

        if (safeImportErrors.includes(error?.message)) {
            return res.status(400).json({ message: error.message });
        }

        if (error?.message === 'Selected account not found or inactive') {
            return res.status(400).json({ message: 'Selected import account is invalid or inactive. Please choose an active account.' });
        }

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

exports.getFinancialHealth = async (req, res) => {
    try {
        const userId = req.userId;
        const io = req.app.get('io');
        await processDueRecurringExpensesForUser(userId, io);

        const user = await User.findByPk(userId, { attributes: ['budget'] });
        const monthlyBudget = toNumber(user?.budget);

        const lookbackStart = startOfDay(new Date());
        lookbackStart.setDate(lookbackStart.getDate() - 119);

        const expenses = await Expense.findAll({
            where: {
                userId,
                amount: { [Op.gt]: 0 },
                date: { [Op.gte]: toDateOnlyString(lookbackStart) }
            },
            attributes: ['date', 'amount', 'category']
        });

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthSpend = expenses.reduce((sum, expense) => {
            const expenseDate = startOfDay(expense.date);
            if (expenseDate >= startOfMonth) {
                return sum + toNumber(expense.amount);
            }
            return sum;
        }, 0);

        const budgetResult = getBudgetAdherenceScore(monthSpend, monthlyBudget);
        const consistencyResult = getWeeklyConsistencyScore(expenses);
        const essentialResult = getEssentialSpendScore(expenses);
        const improvementResult = getMonthOverMonthScore(expenses);

        const weightedScore = (
            (budgetResult.score * 0.35)
            + (consistencyResult.score * 0.25)
            + (essentialResult.score * 0.2)
            + (improvementResult.score * 0.2)
        );

        const score = Math.round(clampScore(weightedScore));
        const grade = getHealthGrade(score);

        const weekTotals = consistencyResult.weekTotals;
        const thisWeek = weekTotals[0] || 0;
        const lastWeek = weekTotals[1] || 0;
        const weeklyChangeRatio = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) : 0;

        const coachTips = buildCoachTips({
            monthlyBudget,
            budgetUsageRatio: budgetResult.usageRatio || 0,
            momChangeRatio: improvementResult.changeRatio,
            essentialRatio: essentialResult.ratio,
            weeklyChangeRatio
        });

        const summary = score >= 85
            ? 'Excellent financial rhythm with strong control and consistency.'
            : score >= 70
                ? 'Good overall stability. Small weekly optimizations can boost your score quickly.'
                : score >= 55
                    ? 'Average health right now. Focus on budget discipline and category control.'
                    : 'Spending pattern is volatile. Tighten weekly limits and track essentials closely.';

        res.json({
            score,
            grade,
            summary,
            factors: {
                budgetAdherence: budgetResult.score,
                consistency: consistencyResult.score,
                essentialBalance: essentialResult.score,
                monthOverMonth: improvementResult.score
            },
            coachTips,
            weekly: {
                thisWeek: Number(thisWeek.toFixed(2)),
                lastWeek: Number(lastWeek.toFixed(2)),
                changePercent: Number((weeklyChangeRatio * 100).toFixed(1))
            }
        });
    } catch (error) {
        console.error('Get financial health error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};