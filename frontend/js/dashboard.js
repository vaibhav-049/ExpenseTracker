document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadUserInfo();
    loadDashboard();
});

let categoryChart = null;
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