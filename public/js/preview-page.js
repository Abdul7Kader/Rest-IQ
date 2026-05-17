function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function initPreview() {
    const urlParts = window.location.pathname.split('/');
    const isAdminView = urlParts.includes('preview') && urlParts.length > 2;
    const restaurantId = isAdminView ? urlParts[urlParts.length - 1] : null;
    const apiUrl = isAdminView ? `/api/admin/preview/${restaurantId}` : '/api/preview';

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error('Vorschau-Daten konnten nicht geladen werden.');
        const data = await res.json();
        document.title = `Vorschau - ${(data.meta && data.meta.seoTitle) || data.restaurant.name}`;
        window.RestiqRenderer.render(data, document.getElementById('renderTarget'));
    } catch (error) {
        document.getElementById('renderTarget').innerHTML = `
            <div class="container" style="padding-top: 5rem;">
                <div class="alert alert-error">
                    <h1>Fehler</h1>
                    <p>${escapeHtml(error.message)}</p>
                    <a href="/index.html">Zum Login</a>
                </div>
            </div>
        `;
    }
}

initPreview();
