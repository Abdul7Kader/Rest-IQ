document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const alert = document.getElementById('alert');
    alert.classList.add('hidden');

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        if (data.success) {
            window.location.href = data.user.role === 'platform_admin'
                ? 'admin.html'
                : 'dashboard.html';
            return;
        }

        alert.textContent = data.error || 'Login fehlgeschlagen.';
        alert.classList.remove('hidden');
    } catch (error) {
        alert.textContent = 'Serverfehler.';
        alert.classList.remove('hidden');
    }
});
