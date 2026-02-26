const darkModeStyles = `
    .dark body { background-color: #0f172a !important; }
    .dark .bg-gray-50 { background-color: #0f172a !important; }
    .dark .bg-white { background-color: #1e293b !important; }
    .dark .text-gray-800, .dark .text-gray-900 { color: #f1f5f9 !important; }
    .dark .text-gray-700 { color: #e2e8f0 !important; }
    .dark .text-gray-600 { color: #cbd5e1 !important; }
    .dark .text-gray-500 { color: #94a3b8 !important; }
    .dark .text-gray-400 { color: #64748b !important; }
    .dark .border-gray-200 { border-color: #334155 !important; }
    .dark .border-gray-100 { border-color: #1e293b !important; }
    .dark .bg-gray-100 { background-color: #1e293b !important; }
    .dark .bg-gray-200 { background-color: #334155 !important; }
    .dark .shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.4) !important; }
    .dark input, .dark select, .dark textarea { 
        background-color: #1e293b !important; 
        color: #f1f5f9 !important; 
        border-color: #475569 !important;
    }
    .dark input::placeholder { color: #64748b !important; }
    .dark .hover\\:bg-gray-50:hover { background-color: #1e293b !important; }
    .dark table thead { background-color: #1e293b !important; }
    .dark table thead tr { color: #cbd5e1 !important; }
    .dark table thead th { color: #cbd5e1 !important; }
    .dark table tbody tr { border-color: #334155 !important; color: #e2e8f0 !important; }
    .dark table tbody td { color: #e2e8f0 !important; }
    .dark .table-row:hover { background-color: #334155 !important; }
    .dark h1, .dark h2, .dark h3, .dark h4, .dark h5, .dark h6 { color: #f1f5f9 !important; }
    .dark p { color: #cbd5e1 !important; }
    .dark span { color: inherit; }
    .dark label { color: #e2e8f0 !important; }
    .dark .rounded-2xl.shadow-sm { background-color: #1e293b !important; }
    .dark .rounded-2xl.shadow-sm h3 { color: #f1f5f9 !important; }
    .dark .rounded-2xl.shadow-sm span { color: #94a3b8 !important; }
    .dark .font-bold { color: #f1f5f9 !important; }
    .dark .font-medium { color: #e2e8f0 !important; }
    .dark .bg-blue-100 { background-color: #1e3a5f !important; }
    .dark .bg-green-100 { background-color: #14532d !important; }
    .dark .bg-yellow-100 { background-color: #422006 !important; }
    .dark .bg-red-100 { background-color: #450a0a !important; }
    .dark .bg-purple-100 { background-color: #3b0764 !important; }
    .dark .bg-pink-100 { background-color: #500724 !important; }
    .dark .bg-cyan-100 { background-color: #083344 !important; }
    .dark .bg-gray-100.text-gray-800 { color: #e2e8f0 !important; }
    .dark .text-blue-800 { color: #93c5fd !important; }
    .dark .text-green-800 { color: #86efac !important; }
    .dark .text-yellow-800 { color: #fde047 !important; }
    .dark .text-red-800 { color: #fca5a5 !important; }
    .dark .text-purple-800 { color: #d8b4fe !important; }
    .dark .text-pink-800 { color: #f9a8d4 !important; }
    .dark .text-cyan-800 { color: #67e8f9 !important; }
    .dark #category-list > div { color: #e2e8f0 !important; }
    .dark #category-list .text-gray-700 { color: #e2e8f0 !important; }
    .dark #category-list .text-gray-800 { color: #f1f5f9 !important; }
    .dark .modal-backdrop { background: rgba(0, 0, 0, 0.7) !important; }
    .dark .modal-backdrop > div { background-color: #1e293b !important; }
    .dark #theme-toggle { background-color: #1e293b !important; }
`;

function initTheme() {
    const styleEl = document.createElement('style');
    styleEl.id = 'dark-mode-styles';
    styleEl.textContent = darkModeStyles;
    document.head.appendChild(styleEl);
    
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    }
}

function toggleTheme() {
    const html = document.documentElement;
    html.classList.toggle('dark');
    
    const isDark = html.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.className = isDark ? 'fas fa-sun text-yellow-400 text-xl' : 'fas fa-moon text-purple-600 text-xl';
    }
}

function createThemeToggle() {
    const toggle = document.createElement('button');
    toggle.id = 'theme-toggle';
    toggle.className = 'fixed top-4 right-4 z-50 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:scale-110 transition-transform border-2 border-gray-200';
    const isDark = localStorage.getItem('theme') === 'dark';
    toggle.innerHTML = `<i id="theme-icon" class="fas ${isDark ? 'fa-sun text-yellow-400' : 'fa-moon text-purple-600'} text-xl"></i>`;
    toggle.onclick = toggleTheme;
    toggle.title = 'Toggle Dark Mode';
    document.body.appendChild(toggle);
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    createThemeToggle();
    updateThemeIcon(document.documentElement.classList.contains('dark'));
});
