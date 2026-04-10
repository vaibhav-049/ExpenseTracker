const API_BASE_URL = 'http://localhost:3000/api';

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

const API = {
    auth: {
        login: `${API_BASE_URL}/auth/login`,
        register: `${API_BASE_URL}/auth/register`,
        profile: `${API_BASE_URL}/auth/profile`,
        budget: `${API_BASE_URL}/auth/budget`,
        bankAccounts: `${API_BASE_URL}/auth/bank-accounts`
    },
    expenses: {
        base: `${API_BASE_URL}/expenses`,
        stats: `${API_BASE_URL}/expenses/stats`,
        anomalies: `${API_BASE_URL}/expenses/anomalies`,
        import: `${API_BASE_URL}/expenses/import`,
        recurring: `${API_BASE_URL}/expenses/recurring`,
        recurringProcess: `${API_BASE_URL}/expenses/recurring/process`
    }
};