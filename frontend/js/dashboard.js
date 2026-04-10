document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadUserInfo();
    initRealtimeDashboard();
    initializeBudgetControls();
    loadDashboard();
    loadBudget();
});

let categoryChart = null;
let dashboardSocket = null;
let currentBudget = 0;

function initRealtimeDashboard() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user || !user.id || typeof io === 'undefined') return;

    dashboardSocket = io(API_BASE_URL.replace('/api', ''));
    dashboardSocket.on('connect', () => {
        dashboardSocket.emit('join', user.id);
    });

    dashboardSocket.on('expense:changed', () => {
        loadDashboard();
    });

    dashboardSocket.on('budget:changed', (payload) => {
        if (payload && typeof payload.budget === 'number') {
            currentBudget = payload.budget;
            updateBudgetDisplay();
            updateBudgetStatus(payload.monthlySpending || 0);
        }
    });

    dashboardSocket.on('budget:alert', (payload) => {
        if (payload) {
            showBudgetAlert(payload.level, payload.monthlySpending, payload.budget);
        }
    });
}

function initializeBudgetControls() {
    const saveBudgetBtn = document.getElementById('save-budget-btn');
    if (saveBudgetBtn) {
        saveBudgetBtn.addEventListener('click', saveBudget);
    }
}

async function loadBudget() {
    try {
        const response = await fetch(API.auth.budget, {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok) {
            currentBudget = parseFloat(data.budget || 0);
            updateBudgetDisplay();
        }
    } catch (error) {
        console.error('Load budget error:', error);
    }
}

async function saveBudget() {
    const budgetInput = document.getElementById('monthly-budget-input');
    const budgetValue = parseFloat(budgetInput.value);

    if (Number.isNaN(budgetValue) || budgetValue < 0) {
        alert('Please enter a valid non-negative budget amount.');
        return;
    }

    try {
        const response = await fetch(API.auth.budget, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ budget: budgetValue })
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.message || 'Failed to save budget');
            return;
        }

        currentBudget = parseFloat(data.budget || 0);
        updateBudgetDisplay();
        loadDashboard();
    } catch (error) {
        console.error('Save budget error:', error);
        alert('An error occurred while saving budget.');
    }
}

function updateBudgetDisplay() {
    const display = document.getElementById('current-budget-display');
    const input = document.getElementById('monthly-budget-input');

    if (display) {
        display.textContent = `Current budget: Rs. ${currentBudget.toFixed(2)}`;
    }
    if (input) {
        input.value = currentBudget > 0 ? currentBudget : '';
    }
}

async function loadDashboard() {
    try {
        const statsResponse = await fetch(API.expenses.stats, {
            headers: getAuthHeaders()
        });
        const statsData = await statsResponse.json();

        const expensesResponse = await fetch(API.expenses.base, {
            headers: getAuthHeaders()
        });
        const expensesData = await expensesResponse.json();

        if (statsResponse.ok) {
            let overallSpending = 0;
            if (expensesData.expenses && expensesData.expenses.length > 0) {
                overallSpending = expensesData.expenses.reduce((sum, expense) => sum + parseFloat(expense.amount || 0), 0);
            }
            updateStats(statsData, overallSpending);
            renderCategoryChart(statsData.categoryBreakdown);
            renderCategoryList(statsData.categoryBreakdown);
        }

        if (expensesResponse.ok) {
            renderRecentExpenses(expensesData.expenses.slice(0, 5));
        }

    } catch (error) {
        console.error('Dashboard error:', error);
    }
}
function updateStats(stats, overallSpending) {
    document.getElementById('overall-spending').textContent = 'Rs. ' + overallSpending.toFixed(2);
    document.getElementById('total-spending').textContent = 'Rs. ' + stats.totalSpending.toFixed(2);
    document.getElementById('expense-count').textContent = stats.expenseCount;
    document.getElementById('current-month').textContent = stats.month;
    updateBudgetStatus(stats.totalSpending);
}

function updateBudgetStatus(monthlySpending) {
    const status = document.getElementById('budget-status-message');
    if (!status) return;

    if (currentBudget <= 0) {
        status.className = 'text-sm mt-2 text-gray-500';
        status.textContent = 'Set your monthly budget to receive alerts.';
        return;
    }

    const usagePercent = (monthlySpending / currentBudget) * 100;

    if (usagePercent >= 100) {
        status.className = 'text-sm mt-2 text-red-600 font-semibold';
        status.textContent = `Budget exceeded: ${usagePercent.toFixed(1)}% used (Rs. ${monthlySpending.toFixed(2)} / Rs. ${currentBudget.toFixed(2)}).`;
        return;
    }

    if (usagePercent >= 80) {
        status.className = 'text-sm mt-2 text-amber-600 font-semibold';
        status.textContent = `Warning: ${usagePercent.toFixed(1)}% of budget used (Rs. ${monthlySpending.toFixed(2)} / Rs. ${currentBudget.toFixed(2)}).`;
        return;
    }

    status.className = 'text-sm mt-2 text-green-600';
    status.textContent = `Healthy: ${usagePercent.toFixed(1)}% of budget used (Rs. ${monthlySpending.toFixed(2)} / Rs. ${currentBudget.toFixed(2)}).`;
}

function showBudgetAlert(level, spending, budget) {
    const toast = document.createElement('div');
    const isExceeded = level === 'exceeded';
    toast.className = `fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-white ${isExceeded ? 'bg-red-600' : 'bg-amber-500'}`;
    toast.textContent = isExceeded
        ? `Budget exceeded! Rs. ${spending.toFixed(2)} spent out of Rs. ${budget.toFixed(2)}.`
        : `Budget warning: Rs. ${spending.toFixed(2)} spent out of Rs. ${budget.toFixed(2)}.`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}
function renderCategoryChart(categoryBreakdown) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    
    const categories = Object.keys(categoryBreakdown);
    const amounts = Object.values(categoryBreakdown);
    
    const colors = [
        '#3B82F6', 
        '#10B981', 
        '#F59E0B', 
        '#EF4444', 
        '#8B5CF6', 
        '#EC4899', 
        '#06B6D4', 
        '#6B7280'  
    ];

    if (categoryChart) {
        categoryChart.destroy();
    }

    if (categories.length === 0) {
        ctx.font = '16px Arial';
        ctx.fillStyle = '#6B7280';
        ctx.textAlign = 'center';
        ctx.fillText('No expenses yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: amounts,
                backgroundColor: colors.slice(0, categories.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}
function renderCategoryList(categoryBreakdown) {
    const container = document.getElementById('category-list');
    const categories = Object.entries(categoryBreakdown);
    
    if (categories.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4">No expenses yet</p>';
        return;
    }

    const total = categories.reduce((sum, [, amount]) => sum + amount, 0);
    
    const colors = {
        'Food': 'bg-blue-500',
        'Transport': 'bg-green-500',
        'Shopping': 'bg-yellow-500',
        'Bills': 'bg-red-500',
        'Entertainment': 'bg-purple-500',
        'Health': 'bg-pink-500',
        'Education': 'bg-cyan-500',
        'Other': 'bg-gray-500'
    };

    container.innerHTML = categories.map(([category, amount]) => {
        const percentage = ((amount / total) * 100).toFixed(1);
        const colorClass = colors[category] || 'bg-gray-500';
        
        return `
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <div class="w-3 h-3 ${colorClass} rounded-full mr-3"></div>
                    <span class="text-gray-700">${category}</span>
                </div>
                <div class="text-right">
                    <span class="font-medium text-gray-800">Rs. ${amount.toFixed(2)}</span>
                    <span class="text-gray-500 text-sm ml-2">(${percentage}%)</span>
                </div>
            </div>
        `;
    }).join('');
}
function renderRecentExpenses(expenses) {
    const tbody = document.getElementById('recent-expenses');
    
    if (expenses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="py-8 text-center text-gray-500">
                    No expenses yet. Start by adding your first expense!
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = expenses.map(expense => `
        <tr class="border-b hover:bg-gray-50">
            <td class="py-4">${formatDate(expense.date)}</td>
            <td class="py-4">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${getCategoryClass(expense.category)}">
                    ${expense.category}
                </span>
            </td>
            <td class="py-4 text-gray-600">${expense.description || '-'}</td>
            <td class="py-4 text-right font-medium">Rs. ${parseFloat(expense.amount).toFixed(2)}</td>
        </tr>
    `).join('');
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