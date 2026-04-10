document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadUserInfo();
    initRealtimeExpenses();
    initializeCsvControls();
    initializeRecurringControls();
    setupRecurringEditForm();
    loadExpenses();
    loadRecurringExpenses();
});

let expensesSocket = null;
let recurringRulesCache = [];

function initRealtimeExpenses() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user || !user.id || typeof io === 'undefined') return;

    expensesSocket = io(API_BASE_URL.replace('/api', ''));
    expensesSocket.on('connect', () => {
        expensesSocket.emit('join', user.id);
    });

    expensesSocket.on('expense:changed', () => {
        loadExpenses();
        loadRecurringExpenses();
    });
}

function initializeCsvControls() {
    const exportBtn = document.getElementById('export-csv-btn');
    const importInput = document.getElementById('import-csv-input');

    if (exportBtn) {
        exportBtn.addEventListener('click', exportExpensesCsv);
    }

    if (importInput) {
        importInput.addEventListener('change', handleCsvImport);
    }
}

function initializeRecurringControls() {
    const refreshBtn = document.getElementById('refresh-recurring-btn');
    const processBtn = document.getElementById('process-recurring-btn');
    const closeRecurringModalBtn = document.getElementById('close-recurring-modal-btn');
    const cancelRecurringModalBtn = document.getElementById('cancel-recurring-modal-btn');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadRecurringExpenses);
    }

    if (processBtn) {
        processBtn.addEventListener('click', processRecurringNow);
    }

    if (closeRecurringModalBtn) {
        closeRecurringModalBtn.addEventListener('click', closeRecurringEditModal);
    }

    if (cancelRecurringModalBtn) {
        cancelRecurringModalBtn.addEventListener('click', closeRecurringEditModal);
    }
}

function setupRecurringEditForm() {
    const recurringEditForm = document.getElementById('recurring-edit-form');
    if (!recurringEditForm) return;

    recurringEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = document.getElementById('recurring-edit-id').value;
        const amount = document.getElementById('recurring-edit-amount').value;
        const category = document.getElementById('recurring-edit-category').value;
        const description = document.getElementById('recurring-edit-description').value;
        const frequency = document.getElementById('recurring-edit-frequency').value;
        const endDate = document.getElementById('recurring-edit-end-date').value;
        const isActive = document.getElementById('recurring-edit-active').checked;

        try {
            const response = await fetch(`${API.expenses.recurring}/${id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    amount,
                    category,
                    description,
                    frequency,
                    endDate: endDate || null,
                    isActive
                })
            });

            const data = await response.json();
            if (!response.ok) {
                alert(data.message || 'Failed to update recurring rule');
                return;
            }

            closeRecurringEditModal();
            loadRecurringExpenses();
        } catch (error) {
            console.error('Recurring edit update error:', error);
            alert('An error occurred while updating recurring rule.');
        }
    });
}

async function loadRecurringExpenses() {
    const container = document.getElementById('recurring-list');
    if (!container) return;

    try {
        const response = await fetch(API.expenses.recurring, {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (!response.ok) {
            container.innerHTML = `<p class="text-sm text-red-500">${escapeHtml(data.message || 'Failed to load recurring rules')}</p>`;
            return;
        }

        renderRecurringExpenses(data.recurringExpenses || []);
    } catch (error) {
        console.error('Load recurring expenses error:', error);
        container.innerHTML = '<p class="text-sm text-red-500">An error occurred while loading recurring rules.</p>';
    }
}

function renderRecurringExpenses(recurringExpenses) {
    const container = document.getElementById('recurring-list');
    if (!container) return;

    recurringRulesCache = recurringExpenses;

    if (recurringExpenses.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">No recurring rules yet. Create one from Add Expense page.</p>';
        return;
    }

    container.innerHTML = recurringExpenses.map((item) => {
        const safeCategory = escapeHtml(item.category || 'Other');
        const safeDescription = escapeHtml(item.description || '-');
        const safeFrequency = escapeHtml(item.frequency || 'monthly');
        const safeNextRunDate = escapeHtml(formatDate(item.nextRunDate));
        const statusBadge = item.isActive
            ? '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>'
            : '<span class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Paused</span>';

        return `
            <div class="border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <p class="font-semibold text-gray-800">${safeCategory} · ₹${parseFloat(item.amount).toFixed(2)}</p>
                    <p class="text-sm text-gray-600">${safeDescription}</p>
                    <p class="text-xs text-gray-500 mt-1">${safeFrequency} · Next run: ${safeNextRunDate}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${statusBadge}
                    <button onclick="openRecurringEditModal(${item.id})" class="px-3 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition">
                        Edit
                    </button>
                    <button onclick="toggleRecurringStatus(${item.id}, ${item.isActive ? 'false' : 'true'})" class="px-3 py-2 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition">
                        ${item.isActive ? 'Pause' : 'Activate'}
                    </button>
                    <button onclick="deleteRecurringRule(${item.id})" class="px-3 py-2 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openRecurringEditModal(id) {
    const recurringItem = recurringRulesCache.find((item) => Number(item.id) === Number(id));
    if (!recurringItem) {
        alert('Recurring rule not found. Please refresh.');
        return;
    }

    document.getElementById('recurring-edit-id').value = recurringItem.id;
    document.getElementById('recurring-edit-amount').value = recurringItem.amount;
    document.getElementById('recurring-edit-category').value = recurringItem.category;
    document.getElementById('recurring-edit-description').value = recurringItem.description || '';
    document.getElementById('recurring-edit-frequency').value = recurringItem.frequency;
    document.getElementById('recurring-edit-end-date').value = toDateInputValue(recurringItem.endDate);
    document.getElementById('recurring-edit-active').checked = Boolean(recurringItem.isActive);

    document.getElementById('recurring-edit-modal').classList.remove('hidden');
}

function closeRecurringEditModal() {
    const modal = document.getElementById('recurring-edit-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function toggleRecurringStatus(id, isActive) {
    try {
        const response = await fetch(`${API.expenses.recurring}/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ isActive })
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.message || 'Failed to update recurring rule');
            return;
        }

        loadRecurringExpenses();
    } catch (error) {
        console.error('Toggle recurring status error:', error);
        alert('An error occurred while updating recurring rule.');
    }
}

async function deleteRecurringRule(id) {
    if (!confirm('Delete this recurring rule?')) return;

    try {
        const response = await fetch(`${API.expenses.recurring}/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.message || 'Failed to delete recurring rule');
            return;
        }

        loadRecurringExpenses();
    } catch (error) {
        console.error('Delete recurring rule error:', error);
        alert('An error occurred while deleting recurring rule.');
    }
}

async function processRecurringNow() {
    try {
        const response = await fetch(API.expenses.recurringProcess, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.message || 'Failed to process recurring expenses');
            return;
        }

        alert('Recurring expenses processed successfully.');
        loadExpenses();
        loadRecurringExpenses();
    } catch (error) {
        console.error('Process recurring now error:', error);
        alert('An error occurred while processing recurring expenses.');
    }
}

function getActiveFilters() {
    return {
        category: document.getElementById('filter-category').value,
        startDate: document.getElementById('filter-start-date').value,
        endDate: document.getElementById('filter-end-date').value
    };
}

async function exportExpensesCsv() {
    try {
        const filters = getActiveFilters();
        const params = new URLSearchParams();

        if (filters.category) params.append('category', filters.category);
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);

        const url = `${API.expenses.base}/export${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            let errorMessage = 'Failed to export CSV';
            try {
                const error = await response.json();
                errorMessage = error.message || errorMessage;
            } catch {
                // Response wasn't JSON, use default message
            }
            alert(errorMessage);
            return;
        }

        const csvText = await response.text();
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);

        link.href = objectUrl;
        link.setAttribute('download', `expenses_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
    } catch (error) {
        console.error('Export CSV error:', error);
        alert('An error occurred while exporting CSV.');
    }
}

function parseCsvText(csvText) {
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const dateIndex = headers.indexOf('date');
    const categoryIndex = headers.indexOf('category');
    const descriptionIndex = headers.indexOf('description');
    const amountIndex = headers.indexOf('amount');

    if ([dateIndex, categoryIndex, amountIndex].includes(-1)) {
        throw new Error('CSV must contain date, category, and amount columns');
    }

    return lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        return {
            date: cols[dateIndex],
            category: cols[categoryIndex],
            description: descriptionIndex >= 0 ? cols[descriptionIndex] : '',
            amount: cols[amountIndex]
        };
    }).filter((exp) => exp.category && exp.amount !== '');
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

async function handleCsvImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsedExpenses = parseCsvText(text);

        if (parsedExpenses.length === 0) {
            alert('No valid expenses found in CSV.');
            event.target.value = '';
            return;
        }

        const response = await fetch(`${API.expenses.base}/import`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ expenses: parsedExpenses })
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.message || 'Failed to import CSV');
            event.target.value = '';
            return;
        }

        alert(`CSV imported successfully. ${data.importedCount} expenses added.`);
        loadExpenses();
    } catch (error) {
        console.error('Import CSV error:', error);
        alert(error.message || 'An error occurred while importing CSV.');
    } finally {
        event.target.value = '';
    }
}

async function loadExpenses(filters = {}) {
    try {
        let url = API.expenses.base;
        const params = new URLSearchParams();

        if (filters.category) params.append('category', filters.category);
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);

        if (params.toString()) {
            url += '?' + params.toString();
        }

        const response = await fetch(url, {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok) {
            renderExpenses(data.expenses);
        }
    } catch (error) {
        console.error('Load expenses error:', error);
    }
}

const categoryEmoji = {
    'Food': '🍔',
    'Transport': '🚗',
    'Shopping': '🛍️',
    'Bills': '📄',
    'Entertainment': '🎬',
    'Health': '🏥',
    'Education': '📚',
    'Other': '📦'
};

function escapeHtml(value) {
    const stringValue = String(value ?? '');
    return stringValue
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderExpenses(expenses) {
    const tbody = document.getElementById('expenses-list');
    const noExpenses = document.getElementById('no-expenses');

    if (expenses.length === 0) {
        tbody.innerHTML = '';
        noExpenses.classList.remove('hidden');
        return;
    }

    noExpenses.classList.add('hidden');

    tbody.innerHTML = expenses.map((expense) => {
        const category = expense.category || 'Other';
        const safeCategory = escapeHtml(category);
        const safeDescription = escapeHtml(expense.description || '-');
        const safeCategoryEmoji = escapeHtml(categoryEmoji[category] || '📦');

        return `
        <tr class="table-row border-b border-gray-100">
            <td class="px-6 py-4">
                <span class="text-gray-800 font-medium">${formatDate(expense.date)}</span>
            </td>
            <td class="px-6 py-4">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getCategoryClass(category)}">
                    <span class="mr-2">${safeCategoryEmoji}</span>
                    ${safeCategory}
                </span>
            </td>
            <td class="px-6 py-4 text-gray-600">${safeDescription}</td>
            <td class="px-6 py-4 text-right">
                <span class="text-gray-800 font-bold">₹${parseFloat(expense.amount).toFixed(2)}</span>
            </td>
            <td class="px-6 py-4 text-center">
                <button onclick="openEditModal(${expense.id})" class="text-purple-600 hover:text-purple-800 mr-4 transition">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteExpense(${expense.id})" class="text-red-500 hover:text-red-700 transition">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `;
    }).join('');
}

function applyFilters() {
    const category = document.getElementById('filter-category').value;
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    loadExpenses({ category, startDate, endDate });
}

function clearFilters() {
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-start-date').value = '';
    document.getElementById('filter-end-date').value = '';
    loadExpenses();
}

async function openEditModal(id) {
    try {
        const response = await fetch(`${API.expenses.base}/${id}`, {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok) {
            const expense = data.expense;
            document.getElementById('edit-id').value = expense.id;
            document.getElementById('edit-amount').value = expense.amount;
            document.getElementById('edit-category').value = expense.category;
            document.getElementById('edit-description').value = expense.description || '';
            document.getElementById('edit-date').value = toDateInputValue(expense.date);

            document.getElementById('edit-modal').classList.remove('hidden');
        }
    } catch (error) {
        console.error('Open edit modal error:', error);
    }
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('edit-id').value;
    const amount = document.getElementById('edit-amount').value;
    const category = document.getElementById('edit-category').value;
    const description = document.getElementById('edit-description').value;
    const date = document.getElementById('edit-date').value;

    try {
        const response = await fetch(`${API.expenses.base}/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount, category, description, date })
        });

        if (response.ok) {
            closeEditModal();
            loadExpenses();
        } else {
            const data = await response.json();
            alert(data.message || 'Failed to update expense');
        }
    } catch (error) {
        console.error('Update expense error:', error);
        alert('An error occurred. Please try again.');
    }
});

async function deleteExpense(id) {
    if (!confirm('Are you sure you want to delete this expense?')) {
        return;
    }

    try {
        const response = await fetch(`${API.expenses.base}/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            loadExpenses();
        } else {
            const data = await response.json();
            alert(data.message || 'Failed to delete expense');
        }
    } catch (error) {
        console.error('Delete expense error:', error);
        alert('An error occurred. Please try again.');
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function toDateInputValue(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
}

function getCategoryClass(category) {
    const classes = {
        'Food': 'bg-blue-100 text-blue-800',
        'Transport': 'bg-green-100 text-green-800',
        'Shopping': 'bg-yellow-100 text-yellow-800',
        'Bills': 'bg-red-100 text-red-800',
        'Entertainment': 'bg-purple-100 text-purple-800',
        'Health': 'bg-pink-100 text-pink-800',
        'Education': 'bg-cyan-100 text-cyan-800',
        'Other': 'bg-gray-100 text-gray-800'
    };
    return classes[category] || 'bg-gray-100 text-gray-800';
}
