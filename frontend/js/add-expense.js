document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadUserInfo();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('date').value = today;
    setupCategorySelection();
});
function setupCategorySelection() {
    const categoryCards = document.querySelectorAll('.category-card');
    const categoryInput = document.getElementById('category');
    
    categoryCards.forEach(card => {
        card.addEventListener('click', () => {
            categoryCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            categoryInput.value = card.dataset.category;
        });
    });
}
function showMessage(message, isError = false) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = message;
    messageDiv.className = `mb-6 p-4 rounded-xl fade-in ${isError ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-green-100 text-green-700 border border-green-200'}`;
    messageDiv.classList.remove('hidden');
    setTimeout(() => {
        messageDiv.classList.add('hidden');
    }, 5000);
}
document.getElementById('add-expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const amount = document.getElementById('amount').value;
    const category = document.getElementById('category').value;
    const description = document.getElementById('description').value;
    const date = document.getElementById('date').value;
    if (!category) {
        showMessage('Please select a category', true);
        return;
    }

    try {
        const response = await fetch(API.expenses.base, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount, category, description, date })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('🎉 Expense added successfully!');
            document.getElementById('add-expense-form').reset();
            document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
            document.getElementById('category').value = '';
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('date').value = today;
            setTimeout(() => {
                window.location.href = 'expenses.html';
            }, 1500);

        } else {
            showMessage(data.message || 'Failed to add expense', true);
        }

    } catch (error) {
        console.error('Add expense error:', error);
        showMessage('An error occurred. Please try again.', true);
    }
});