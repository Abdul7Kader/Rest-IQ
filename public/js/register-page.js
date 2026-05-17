let domainProvider = null;

async function loadDomainProvider() {
    try {
        const res = await fetch('/api/public/domain-providers');
        const providers = await res.json();
        domainProvider = providers.find(provider => provider.provider_type === 'registrar' || provider.provider_type === 'both');
        if (domainProvider) {
            const link = document.getElementById('domainProviderLink');
            link.href = domainProvider.affiliate_base_url || domainProvider.website_url;
            link.textContent = `${domainProvider.provider_name} öffnen`;
        }
    } catch (error) {
        document.getElementById('domainBuyHint').textContent = 'Domainkauf erfolgt extern. Der Partner-Link ist aktuell nicht verfügbar.';
    }
}

document.querySelectorAll('[name="domain_choice"]').forEach(input => {
    input.addEventListener('change', () => {
        const value = document.querySelector('[name="domain_choice"]:checked').value;
        document.getElementById('customDomainGroup').classList.toggle('hidden', value !== 'own_domain');
        document.getElementById('domainBuyHint').classList.toggle('hidden', value !== 'buy_external');
    });
});

document.getElementById('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const alert = document.getElementById('alert');
    const success = document.getElementById('success');
    alert.classList.add('hidden');
    success.classList.add('hidden');

    const formData = new FormData(event.target);
    const payload = Object.fromEntries(formData.entries());
    if (payload.password !== payload.password_confirm) {
        alert.textContent = 'Die Passwörter stimmen nicht überein.';
        alert.classList.remove('hidden');
        return;
    }
    delete payload.password_confirm;
    if (!payload.contact_email) payload.contact_email = payload.email;

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            window.location.href = 'dashboard.html';
            return;
        }

        alert.textContent = data.error || 'Registrierung fehlgeschlagen.';
        alert.classList.remove('hidden');
    } catch (error) {
        alert.textContent = 'Serverfehler.';
        alert.classList.remove('hidden');
    }
});

loadDomainProvider();
