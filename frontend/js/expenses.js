document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadUserInfo();
    loadExpenses();
});
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
function renderExpenses(expenses) {
    const tbody = document.getElementById('expenses-list');
    const noExpenses = document.getElementById('no-expenses');

    if (expenses.length === 0) {
        tbody.innerHTML = '';
        noExpenses.classList.remove('hidden');
        return;
    }

    noExpenses.classList.add('hidden');

    tbody.innerHTML = expenses.map(expense => `
        <tr class="table-row border-b border-gray-100">
            <td class="px-6 py-4">
                <span class="text-gray-800 font-medium">${formatDate(expense.date)}</span>
            </td>
            <td class="px-6 py-4">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getCategoryClass(expense.category)}">
                    <span class="mr-2">${categoryEmoji[expense.category] || '📦'}</span>
                    ${expense.category}
                </span>
            </td>
            <td class="px-6 py-4 text-gray-600">${expense.description || '-'}</td>
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
    `).join('');
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
            document.getElementById('edit-date').value = expense.date;
            
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
    return date.toLocaleDateString('en-IN', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
    });
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