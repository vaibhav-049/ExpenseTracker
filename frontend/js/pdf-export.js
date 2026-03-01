function openMonthModal() {
    const modal = document.getElementById('month-modal');
    const monthsList = document.getElementById('months-list');
    
    fetch(API.expenses.base, {
        headers: getAuthHeaders()
    })
    .then(response => response.json())
    .then(data => {
        const monthsData = {};
        
        if (data.expenses) {
            data.expenses.forEach(expense => {
                const date = new Date(expense.date);
                const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
                const monthLabel = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                
                if (!monthsData[monthKey]) {
                    monthsData[monthKey] = { label: monthLabel, total: 0 };
                }
                monthsData[monthKey].total += parseFloat(expense.amount || 0);
            });
        }
        
        const sortedMonths = Object.entries(monthsData).sort().reverse();
        
        if (sortedMonths.length === 0) {
            monthsList.innerHTML = '<p class="text-center text-gray-500 py-4">No expenses yet</p>';
        } else {
            monthsList.innerHTML = sortedMonths.map(([monthKey, monthData]) => `
                <button onclick="exportMonthPDF('${monthKey}')" class="w-full flex justify-between items-center p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-xl hover:from-purple-100 hover:to-indigo-100 hover:border-purple-400 transition">
                    <span class="font-semibold text-gray-800">${monthData.label}</span>
                    <span class="text-lg font-bold text-purple-600">Rs. ${monthData.total.toFixed(2)}</span>
                </button>
            `).join('');
        }
        
        modal.classList.remove('hidden');
    })
    .catch(error => {
        console.error('Error fetching months:', error);
        alert('Error loading months');
    });
}

function closeMonthModal() {
    document.getElementById('month-modal').classList.add('hidden');
}

function exportMonthPDF(monthKey) {
    closeMonthModal();
    exportToPDF(monthKey);
}

async function exportToPDF(selectedMonth) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const user = JSON.parse(localStorage.getItem('user'));
    const userName = user ? user.name : 'User';
    
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, 210, 45, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text('Expense Report', 105, 22, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Generated for: ' + userName, 105, 36, { align: 'center' });
    
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(10);
    const today = new Date().toLocaleDateString('en-IN', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    doc.text('Report Date: ' + today, 14, 55);
    
    try {
        const expensesResponse = await fetch(API.expenses.base, {
            headers: getAuthHeaders()
        });
        const expensesData = await expensesResponse.json();

        let filteredExpenses = expensesData.expenses || [];
        let monthLabel = selectedMonth;
        let totalSpending = 0;
        let categoryBreakdown = {};

        if (selectedMonth) {
            const [year, month] = selectedMonth.split('-');
            filteredExpenses = filteredExpenses.filter(expense => {
                const expenseDate = new Date(expense.date);
                return expenseDate.getFullYear() === parseInt(year) && 
                       (expenseDate.getMonth() + 1) === parseInt(month);
            });
            
            const monthName = new Date(year, month - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            monthLabel = monthName;
        }

        filteredExpenses.forEach(expense => {
            totalSpending += parseFloat(expense.amount || 0);
            const cat = expense.category || 'Other';
            categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + parseFloat(expense.amount || 0);
        });
        
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(14, 60, 182, 35, 3, 3, 'F');
        
        doc.setTextColor(102, 126, 234);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Monthly Summary', 20, 73);
        
        doc.setTextColor(50, 50, 50);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        
        doc.setFont('helvetica', 'bold');
        doc.text('Total Spending:', 20, 85);
        doc.setFont('helvetica', 'normal');
        doc.text('Rs. ' + totalSpending.toFixed(2), 55, 85);
        
        doc.setFont('helvetica', 'bold');
        doc.text('Transactions:', 90, 85);
        doc.setFont('helvetica', 'normal');
        doc.text(String(filteredExpenses.length), 125, 85);
        
        doc.setFont('helvetica', 'bold');
        doc.text('Period:', 145, 85);
        doc.setFont('helvetica', 'normal');
        doc.text(String(monthLabel), 165, 85);
        
        doc.setTextColor(102, 126, 234);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Category Breakdown', 14, 110);
        
        let yPos = 122;
        const categories = Object.entries(categoryBreakdown);
        const categoryColors = {
            'Food': [59, 130, 246],
            'Transport': [16, 185, 129],
            'Shopping': [245, 158, 11],
            'Bills': [239, 68, 68],
            'Entertainment': [139, 92, 246],
            'Health': [236, 72, 153],
            'Education': [6, 182, 212],
            'Other': [107, 114, 128]
        };
        
        categories.forEach(([category, amount], index) => {
            const color = categoryColors[category] || [107, 114, 128];
            const percentage = totalSpending > 0 ? ((amount / totalSpending) * 100).toFixed(1) : 0;
            
            doc.setFillColor(...color);
            doc.circle(20, yPos - 2, 4, 'F');
            
            doc.setTextColor(50, 50, 50);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            doc.text(category, 28, yPos);
            
            doc.setFont('helvetica', 'bold');
            doc.text('Rs. ' + amount.toFixed(2), 70, yPos);
            doc.setFont('helvetica', 'normal');
            doc.text('(' + percentage + '%)', 105, yPos);
            
            const barWidth = totalSpending > 0 ? Math.max((amount / totalSpending) * 70, 5) : 5;
            doc.setFillColor(...color);
            doc.roundedRect(125, yPos - 5, barWidth, 7, 2, 2, 'F');
            
            yPos += 14;
        });
        
        yPos += 15;
        doc.setTextColor(102, 126, 234);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Expenses Details', 14, yPos);
        
        yPos += 12;
        
        doc.setFillColor(102, 126, 234);
        doc.rect(14, yPos, 182, 10, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Date', 20, yPos + 7);
        doc.text('Category', 60, yPos + 7);
        doc.text('Description', 105, yPos + 7);
        doc.text('Amount', 170, yPos + 7);
        
        yPos += 10;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        
        const displayExpenses = filteredExpenses.slice(0, 15);
        displayExpenses.forEach((expense, index) => {
            if (yPos > 270) {
                doc.addPage();
                yPos = 20;
            }
            
            if (index % 2 === 0) {
                doc.setFillColor(248, 250, 252);
                doc.rect(14, yPos, 182, 10, 'F');
            }
            
            const date = new Date(expense.date).toLocaleDateString('en-IN', { 
                day: '2-digit', month: 'short', year: 'numeric' 
            });
            doc.setFontSize(10);
            doc.text(date, 20, yPos + 7);
            doc.text(expense.category, 60, yPos + 7);
            doc.text((expense.description || '-').substring(0, 25), 105, yPos + 7);
            doc.setFont('helvetica', 'bold');
            doc.text('Rs. ' + parseFloat(expense.amount).toFixed(2), 165, yPos + 7);
            doc.setFont('helvetica', 'normal');
            
            yPos += 10;
        });
        
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text('Page ' + i + ' of ' + pageCount, 105, 290, { align: 'center' });
            doc.text('Generated by ExpenseTracker', 14, 290);
        }
        
        const fileName = 'Expense_Report_' + (selectedMonth || new Date().toISOString().split('T')[0]) + '.pdf';
        doc.save(fileName);
        
        showExportSuccess('PDF exported successfully!');
        
    } catch (error) {
        console.error('PDF export error:', error);
        alert('Failed to export PDF. Please try again.');
    }
}

function showExportSuccess(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-xl shadow-lg flex items-center space-x-2 z-50 animate-bounce';
    toast.innerHTML = '<i class="fas fa-check-circle"></i><span>' + message + '</span>';
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
}
