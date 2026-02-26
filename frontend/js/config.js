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
        profile: `${API_BASE_URL}/auth/profile`
    },
    expenses: {
        base: `${API_BASE_URL}/expenses`,
        stats: `${API_BASE_URL}/expenses/stats`
    }
};