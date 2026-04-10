document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadUserInfo();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('date').value = today;
    setupCategorySelection();
    setupRecurringControls();
});

function setupRecurringControls() {
    const recurringCheckbox = document.getElementById('is-recurring');
    const recurringOptions = document.getElementById('recurring-options');

    if (!recurringCheckbox || !recurringOptions) return;

    recurringCheckbox.addEventListener('change', () => {
        recurringOptions.classList.toggle('hidden', !recurringCheckbox.checked);
    });
}
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
    const isRecurring = document.getElementById('is-recurring')?.checked;
    const recurringFrequency = document.getElementById('recurring-frequency')?.value;
    const recurringEndDate = document.getElementById('recurring-end-date')?.value;
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
            if (isRecurring) {
                const recurringResponse = await fetch(API.expenses.recurring, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        amount,
                        category,
                        description,
                        frequency: recurringFrequency || 'monthly',
                        startDate: date,
                        endDate: recurringEndDate || null
                    })
                });

                if (!recurringResponse.ok) {
                    const recurringData = await recurringResponse.json();
                    showMessage(`Expense added, but recurring setup failed: ${recurringData.message || 'Unknown error'}`, true);
                    return;
                }
            }

            showMessage('🎉 Expense added successfully!');
            document.getElementById('add-expense-form').reset();
            document.querySelectorAll('.category-card').forEach(c => c.classList.remove('selected'));
            document.getElementById('category').value = '';
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('date').value = today;
            const recurringOptions = document.getElementById('recurring-options');
            if (recurringOptions) recurringOptions.classList.add('hidden');
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