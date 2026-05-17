let restaurants = [];
let summary = null;
let platformSettings = {};
let domainProviders = [];
let adSlots = [];
let csrfToken = null;

async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const res = await fetch('/api/auth/csrf');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'CSRF token unavailable.');
    csrfToken = data.csrfToken;
    return csrfToken;
}

async function api(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (['POST', 'PATCH', 'DELETE'].includes(method)) {
        headers['X-CSRF-Token'] = await getCsrfToken();
    }
    const res = await fetch(path, {
        ...options,
        headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
}

async function refreshAdmin() {
    try {
        [summary, restaurants, platformSettings, domainProviders, adSlots] = await Promise.all([
            api('/api/admin/summary'),
            api('/api/admin/restaurants'),
            api('/api/admin/platform-settings'),
            api('/api/admin/domain-providers'),
            api('/api/admin/ad-slots')
        ]);
        renderSummary();
        renderSettings();
        renderProviders();
        renderAdSlots();
        renderRestaurants();
    } catch (error) {
        if (error.message === 'Forbidden' || error.message === 'Request failed.') {
            window.location.href = 'index.html';
            return;
        }
        showAlert(error.message);
    }
}

function renderSummary() {
    const items = [
        ['Restaurants', summary.restaurants],
        ['Aktive Restaurants', summary.activeRestaurants],
        ['Free / Paid', `${summary.freePlan} / ${summary.paidPlan}`],
        ['Pending Domains', summary.pendingDomains],
        ['Custom Domains', summary.customDomains],
        ['Gerichte', summary.activeDishes],
        ['Medien', summary.mediaAssets],
        ['Deploy Events', summary.publishEvents]
    ];

    document.getElementById('summaryGrid').innerHTML = items.map(([label, value]) => `
        <div class="metric">
            <div class="metric-label">${escapeHtml(label)}</div>
            <div class="metric-value">${escapeHtml(value)}</div>
        </div>
    `).join('');
}

function renderSettings() {
    const form = document.getElementById('settingsForm');
    form.support_email.value = platformSettings.support_email || '';
    form.default_ad_label.value = platformSettings.default_ad_label || '';
    form.domain_affiliate_note.value = platformSettings.domain_affiliate_note || '';
    form.quality_review_required.checked = platformSettings.quality_review_required === '1';
}

function renderProviders() {
    document.getElementById('providerList').innerHTML = domainProviders.map(provider => `
        <div class="compact-item">
            <strong>${escapeHtml(provider.provider_name)}</strong>
            <span class="status-pill ${provider.is_active ? 'status-ok' : 'status-muted'}">${provider.is_active ? 'aktiv' : 'inaktiv'}</span><br>
            <small class="muted">${escapeHtml(provider.provider_type)} · ${escapeHtml(provider.website_url)}</small><br>
            ${provider.affiliate_base_url ? `<small class="muted">Affiliate: ${escapeHtml(provider.affiliate_base_url)}</small><br>` : ''}
            <div class="admin-actions" style="margin-top: 0.5rem;">
                <button type="button" data-action="edit-provider" data-id="${provider.id}">Bearbeiten</button>
                <button type="button" class="btn-danger" data-action="delete-provider" data-id="${provider.id}">Löschen</button>
            </div>
        </div>
    `).join('');
}

function renderAdSlots() {
    document.getElementById('adSlotList').innerHTML = adSlots.map(slot => `
        <div class="compact-item">
            <strong>${escapeHtml(slot.label)}</strong>
            <span class="status-pill ${slot.is_active ? 'status-ok' : 'status-muted'}">${slot.is_active ? 'aktiv' : 'inaktiv'}</span><br>
            <small class="muted">${escapeHtml(slot.slot_key)} · ${escapeHtml(slot.placement)} · ${escapeHtml(slot.provider_name || 'manual')}</small><br>
            ${slot.placeholder_text ? `<small class="muted">${escapeHtml(slot.placeholder_text)}</small><br>` : ''}
            <div class="admin-actions" style="margin-top: 0.5rem;">
                <button type="button" data-action="edit-ad-slot" data-id="${slot.id}">Bearbeiten</button>
                <button type="button" class="btn-danger" data-action="delete-ad-slot" data-id="${slot.id}">Löschen</button>
            </div>
        </div>
    `).join('');
}

function filteredRestaurants() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    const plan = document.getElementById('planFilter').value;
    const domain = document.getElementById('domainFilter').value;

    return restaurants.filter(r => {
        const haystack = `${r.restaurant_name} ${r.public_slug_internal} ${r.owner_email}`.toLowerCase();
        const domainStatus = r.free_domain_status || 'not_prepared';
        return (!q || haystack.includes(q)) &&
            (!plan || r.current_plan === plan) &&
            (!domain || domainStatus === domain);
    });
}

function renderRestaurants() {
    const table = document.getElementById('restaurantTable');
    const rows = filteredRestaurants();

    if (rows.length === 0) {
        table.innerHTML = `
            <tr>
                <td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">
                    Keine passenden Restaurants gefunden.
                </td>
            </tr>
        `;
        return;
    }

    table.innerHTML = rows.map(r => {
        const freeDomainStatus = r.free_domain_status || 'not_prepared';
        const domainClass = freeDomainStatus === 'active' ? 'status-ok' : (freeDomainStatus === 'pending' ? 'status-warn' : 'status-muted');
        const deployClass = r.last_publish_status === 'success' ? 'status-ok' : 'status-muted';
        return `
            <tr>
                <td>
                    <strong>${escapeHtml(r.restaurant_name)}</strong><br>
                    <small class="muted">${escapeHtml(r.public_slug_internal)}</small><br>
                    <small class="muted">Template: ${escapeHtml(r.template_key || 'free_default')}</small>
                </td>
                <td>
                    ${escapeHtml(r.owner_email)}<br>
                    <small style="color: ${r.is_active ? 'var(--success)' : 'var(--error)'}">${r.is_active ? 'Restaurant aktiv' : 'Restaurant inaktiv'}</small>
                </td>
                <td><span class="badge badge-${escapeHtml(r.current_plan)}">${escapeHtml(String(r.current_plan).toUpperCase())}</span></td>
                <td>
                    <small>Kategorien: ${escapeHtml(r.category_count || 0)}</small><br>
                    <small>Gerichte: ${escapeHtml(r.dish_count || 0)}</small><br>
                    <small>Medien: ${escapeHtml(r.media_count || 0)}</small><br>
                    <small>Schließzeiten: ${escapeHtml(r.closure_count || 0)}</small>
                </td>
                <td>
                    <span class="status-pill ${deployClass}">${r.last_publish_status ? escapeHtml(r.last_publish_status) : 'nicht vorbereitet'}</span><br>
                    <small class="muted">${r.last_publish_at ? escapeHtml(r.last_publish_at) : 'kein Event'}</small>
                </td>
                <td>
                    <span class="status-pill ${domainClass}">${escapeHtml(freeDomainStatus)}</span><br>
                    <small class="muted">${escapeHtml(r.free_hostname || `${r.public_slug_internal}-restiq.pages.dev`)}</small>
                    ${r.custom_hostname ? `<br><small class="muted">Custom: ${escapeHtml(r.custom_hostname)} (${escapeHtml(r.custom_domain_status)})</small>` : ''}
                </td>
                <td>
                    <div class="admin-actions">
                        <a href="/preview/${r.id}" target="_blank">Preview</a>
                        <button type="button" data-action="show-restaurant-detail" data-id="${r.id}">Details</button>
                        <button type="button" data-action="prepare-cf" data-id="${r.id}">CF vorbereiten</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function showRestaurantDetail(restaurantId) {
    try {
        const detail = await api(`/api/admin/restaurants/${restaurantId}`);
        const r = detail.restaurant;
        document.getElementById('detailPanel').innerHTML = `
            <div class="card">
                <div class="section-header">
                    <div>
                        <h2>${escapeHtml(r.restaurant_name)}</h2>
                        <p class="muted">${escapeHtml(r.owner_email)} · ${escapeHtml(r.public_slug_internal)}</p>
                    </div>
                    <button type="button" class="secondary" data-action="clear-detail-panel">Schließen</button>
                </div>
                <div class="detail-grid">
                    <div>
                        <h3>Status</h3>
                        <p><span class="status-pill status-muted">${escapeHtml(r.current_plan)}</span></p>
                        <p class="muted">Restaurant: ${r.is_active ? 'aktiv' : 'inaktiv'}<br>Owner: ${r.owner_is_active ? 'aktiv' : 'inaktiv'}</p>
                        <div class="admin-actions">
                            <button type="button" data-action="update-restaurant-status" data-id="${r.id}" data-active="${r.is_active ? 'false' : 'true'}">${r.is_active ? 'Deaktivieren' : 'Aktivieren'}</button>
                            <button type="button" data-action="update-restaurant-plan" data-id="${r.id}" data-plan="${r.current_plan === 'free' ? 'paid' : 'free'}">Auf ${r.current_plan === 'free' ? 'Paid' : 'Free'} setzen</button>
                        </div>
                    </div>
                    <div>
                        <h3>Inhalte</h3>
                        <p class="muted">
                            Menüs: ${escapeHtml(detail.counts.menus)}<br>
                            Kategorien: ${escapeHtml(detail.counts.categories)}<br>
                            Gerichte: ${escapeHtml(detail.counts.dishes)}<br>
                            Medien: ${escapeHtml(detail.counts.media_assets)}<br>
                            Öffnungszeiten: ${escapeHtml(detail.counts.opening_hours)}
                        </p>
                    </div>
                    <div>
                        <h3>Design / SEO</h3>
                        <p class="muted">
                            Template: ${escapeHtml(r.template_key)}<br>
                            Menü: ${escapeHtml(r.menu_layout)}<br>
                            SEO Titel: ${escapeHtml(r.seo_title || 'nicht gesetzt')}
                        </p>
                    </div>
                    <div>
                        <h3>Domains</h3>
                        ${detail.domains.length ? `<div class="compact-list">${detail.domains.map(domain => `
                            <div class="compact-item">
                                <strong>${escapeHtml(domain.hostname)}</strong><br>
                                <small class="muted">${escapeHtml(domain.domain_type)} · ${escapeHtml(domain.status)} · ${domain.is_primary ? 'primär' : 'nicht primär'}</small>
                                <div class="admin-actions" style="margin-top: 0.5rem;">
                                    <button type="button" data-action="update-domain-status" data-id="${domain.id}" data-status="active" data-primary="true" data-restaurant-id="${r.id}">Aktiv primär</button>
                                    <button type="button" data-action="update-domain-status" data-id="${domain.id}" data-status="pending" data-primary="false" data-restaurant-id="${r.id}">Pending</button>
                                    <button type="button" data-action="update-domain-status" data-id="${domain.id}" data-status="failed" data-primary="false" data-restaurant-id="${r.id}">Fehler</button>
                                    <button type="button" data-action="update-domain-status" data-id="${domain.id}" data-status="disabled" data-primary="false" data-restaurant-id="${r.id}">Deaktivieren</button>
                                </div>
                            </div>
                        `).join('')}</div>` : '<p class="muted">Keine Domains.</p>'}
                    </div>
                </div>
                <h3 style="margin-top: 1.5rem;">Letzte Deploy-Events</h3>
                ${detail.publishEvents.length ? `<ul class="detail-list">${detail.publishEvents.map(event => `<li>${escapeHtml(event.created_at)} · ${escapeHtml(event.status)} · ${escapeHtml(event.target_hostname)}${event.message ? ` · ${escapeHtml(event.message)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">Keine Deploy-Events.</p>'}
            </div>
        `;
    } catch (error) {
        showAlert(error.message);
    }
}

async function prepareCf(restaurantId, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Bereite vor...';
    hideAlert();

    try {
        const data = await api(`/api/admin/cf-prepare/${restaurantId}`, { method: 'POST' });
        showAlert(`Cloudflare-Export vorbereitet: ${data.targetHostname}`, 'success');
        await refreshAdmin();
    } catch (error) {
        showAlert(error.message || 'Cloudflare-Vorbereitung fehlgeschlagen.');
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

async function saveSettings(event) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form).entries());
    data.quality_review_required = form.quality_review_required.checked ? '1' : '0';
    try {
        await api('/api/admin/platform-settings', { method: 'PATCH', body: JSON.stringify(data) });
        showAlert('Plattform-Einstellungen gespeichert.', 'success');
        await refreshAdmin();
    } catch (error) {
        showAlert(error.message);
    }
}

function resetProviderForm() {
    const form = document.getElementById('providerForm');
    form.reset();
    form.id.value = '';
    form.provider_type.value = 'registrar';
    form.supports_paid_domains.checked = true;
    form.is_active.checked = true;
    form.sort_order.value = 0;
}

function editProvider(id) {
    const provider = domainProviders.find(item => item.id === id);
    if (!provider) return;
    const form = document.getElementById('providerForm');
    form.id.value = provider.id;
    form.provider_name.value = provider.provider_name || '';
    form.provider_type.value = provider.provider_type || 'registrar';
    form.website_url.value = provider.website_url || '';
    form.affiliate_base_url.value = provider.affiliate_base_url || '';
    form.supports_free_domains.checked = Boolean(provider.supports_free_domains);
    form.supports_paid_domains.checked = Boolean(provider.supports_paid_domains);
    form.is_active.checked = Boolean(provider.is_active);
    form.sort_order.value = provider.sort_order || 0;
}

async function saveProvider(event) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form).entries());
    data.supports_free_domains = form.supports_free_domains.checked;
    data.supports_paid_domains = form.supports_paid_domains.checked;
    data.is_active = form.is_active.checked;
    const id = data.id;
    delete data.id;
    try {
        await api(id ? `/api/admin/domain-providers/${id}` : '/api/admin/domain-providers', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify(data)
        });
        resetProviderForm();
        showAlert('Domain-Partner gespeichert.', 'success');
        await refreshAdmin();
    } catch (error) {
        showAlert(error.message);
    }
}

async function deleteProvider(id) {
    if (!confirm('Domain-Partner löschen?')) return;
    try {
        await api(`/api/admin/domain-providers/${id}`, { method: 'DELETE' });
        showAlert('Domain-Partner gelöscht.', 'success');
        await refreshAdmin();
    } catch (error) {
        showAlert(error.message);
    }
}

function resetAdSlotForm() {
    const form = document.getElementById('adSlotForm');
    form.reset();
    form.id.value = '';
    form.placement.value = 'menu';
    form.is_active.checked = true;
}

function editAdSlot(id) {
    const slot = adSlots.find(item => item.id === id);
    if (!slot) return;
    const form = document.getElementById('adSlotForm');
    form.id.value = slot.id;
    form.slot_key.value = slot.slot_key || '';
    form.label.value = slot.label || '';
    form.placement.value = slot.placement || 'menu';
    form.provider_name.value = slot.provider_name || '';
    form.placeholder_text.value = slot.placeholder_text || '';
    form.is_active.checked = Boolean(slot.is_active);
}

async function saveAdSlot(event) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form).entries());
    data.is_active = form.is_active.checked;
    const id = data.id;
    delete data.id;
    try {
        await api(id ? `/api/admin/ad-slots/${id}` : '/api/admin/ad-slots', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify(data)
        });
        resetAdSlotForm();
        showAlert('Werbeplatz gespeichert.', 'success');
        await refreshAdmin();
    } catch (error) {
        showAlert(error.message);
    }
}

async function deleteAdSlot(id) {
    if (!confirm('Werbeplatz löschen?')) return;
    try {
        await api(`/api/admin/ad-slots/${id}`, { method: 'DELETE' });
        showAlert('Werbeplatz gelöscht.', 'success');
        await refreshAdmin();
    } catch (error) {
        showAlert(error.message);
    }
}

async function updateRestaurantStatus(restaurantId, isActive) {
    try {
        await api(`/api/admin/restaurants/${restaurantId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: isActive })
        });
        showAlert('Restaurantstatus aktualisiert.', 'success');
        await refreshAdmin();
        await showRestaurantDetail(restaurantId);
    } catch (error) {
        showAlert(error.message);
    }
}

async function updateRestaurantPlan(restaurantId, plan) {
    try {
        await api(`/api/admin/restaurants/${restaurantId}/plan`, {
            method: 'PATCH',
            body: JSON.stringify({ current_plan: plan })
        });
        showAlert('Tarif aktualisiert.', 'success');
        await refreshAdmin();
        await showRestaurantDetail(restaurantId);
    } catch (error) {
        showAlert(error.message);
    }
}

async function updateDomainStatus(domainId, status, isPrimary, restaurantId) {
    try {
        await api(`/api/admin/domains/${domainId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
                status,
                is_primary: isPrimary,
                publish_status: status === 'active' ? 'success' : 'queued',
                message: 'Domainstatus im Admin aktualisiert.'
            })
        });
        showAlert('Domainstatus aktualisiert.', 'success');
        await refreshAdmin();
        await showRestaurantDetail(restaurantId);
    } catch (error) {
        showAlert(error.message);
    }
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('planFilter').value = '';
    document.getElementById('domainFilter').value = '';
    renderRestaurants();
}

function clearDetailPanel() {
    document.getElementById('detailPanel').innerHTML = '';
}

function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('alert');
    alertBox.textContent = message;
    alertBox.className = `alert alert-${type === 'success' ? 'success' : 'error'}`;
    alertBox.classList.remove('hidden');
}

function hideAlert() {
    const alertBox = document.getElementById('alert');
    alertBox.className = 'alert hidden';
    alertBox.textContent = '';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function handleAdminAction(event) {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    const action = trigger.dataset.action;
    if (!action) return;
    event.preventDefault();

    const id = Number(trigger.dataset.id);
    const restaurantId = Number(trigger.dataset.restaurantId);

    if (action === 'refresh-admin') return refreshAdmin();
    if (action === 'reset-provider-form') return resetProviderForm();
    if (action === 'reset-ad-slot-form') return resetAdSlotForm();
    if (action === 'reset-filters') return resetFilters();
    if (action === 'clear-detail-panel') return clearDetailPanel();
    if (action === 'edit-provider') return editProvider(id);
    if (action === 'delete-provider') return deleteProvider(id);
    if (action === 'edit-ad-slot') return editAdSlot(id);
    if (action === 'delete-ad-slot') return deleteAdSlot(id);
    if (action === 'show-restaurant-detail') return showRestaurantDetail(id);
    if (action === 'prepare-cf') return prepareCf(id, trigger);
    if (action === 'update-restaurant-status') {
        return updateRestaurantStatus(id, trigger.dataset.active === 'true');
    }
    if (action === 'update-restaurant-plan') {
        return updateRestaurantPlan(id, trigger.dataset.plan);
    }
    if (action === 'update-domain-status') {
        return updateDomainStatus(
            id,
            trigger.dataset.status,
            trigger.dataset.primary === 'true',
            restaurantId
        );
    }
}

document.addEventListener('click', handleAdminAction);
document.getElementById('searchInput').addEventListener('input', renderRestaurants);
document.getElementById('planFilter').addEventListener('change', renderRestaurants);
document.getElementById('domainFilter').addEventListener('change', renderRestaurants);
document.getElementById('settingsForm').addEventListener('submit', saveSettings);
document.getElementById('providerForm').addEventListener('submit', saveProvider);
document.getElementById('adSlotForm').addEventListener('submit', saveAdSlot);

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = 'index.html';
});

refreshAdmin();
