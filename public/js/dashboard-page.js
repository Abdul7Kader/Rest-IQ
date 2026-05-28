let restaurantData = null;
let currentStatus = null;
let currentMenu = null;
let currentClosures = [];
let mediaAssets = [];
let csrfToken = null;
const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

async function init() {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) {
        window.location.href = 'index.html';
        return;
    }
    const me = await meRes.json();
    if (me.role === 'platform_admin') {
        window.location.href = 'admin.html';
        return;
    }

    const res = await fetch('/api/restaurant');
    if (res.status === 404) {
        showSetupState();
        return;
    }
    if (!res.ok) {
        window.location.href = 'index.html';
        return;
    }

    restaurantData = await res.json();
    fillForms();
    setupUploadZones(document);
    await Promise.all([loadStatus(), loadOnboarding(), loadHours(), loadClosures(), loadMenu(), loadMediaAssets(), loadHelp()]);
}

function showSetupState() {
    document.getElementById('setupState').classList.remove('hidden');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav a').forEach(a => {
        if (a.id !== 'logoutBtn') {
            a.style.pointerEvents = 'none';
            a.style.opacity = '0.45';
        }
    });
}

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.getElementById('nav-' + tabId).classList.add('active');
}

function fillForms() {
    document.querySelectorAll('form').forEach(form => {
        form.querySelectorAll('input, textarea, select').forEach(input => {
            const name = input.name;
            if (!name) return;
            if (restaurantData[name] !== undefined && restaurantData[name] !== null) input.value = restaurantData[name];
            else if (restaurantData.config && restaurantData.config[name] !== undefined && restaurantData.config[name] !== null) input.value = restaurantData.config[name];
        });
    });
    refreshUploadPreviews();
}

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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function safeImageUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (error) {
        return '';
    }
}

function uploadBox(inputName, value, label, context) {
    return `
        <input type="hidden" name="${escapeAttr(inputName)}" value="${escapeAttr(value || '')}">
        <div class="upload-zone" data-input="${escapeAttr(inputName)}" data-context="${escapeAttr(context)}" tabindex="0">
            <img class="upload-preview" alt="">
            <div class="upload-copy"><strong>${escapeHtml(label)}</strong><span class="muted">Bild hier ablegen oder klicken</span></div>
        </div>
        <div class="toolbar" style="margin-top: 0.5rem;">
            <button type="button" class="btn-sm secondary" data-action="open-media-picker" data-input="${escapeAttr(inputName)}">Aus Mediathek wählen</button>
            <button type="button" class="btn-sm secondary" data-action="clear-image-input" data-input="${escapeAttr(inputName)}">Bild entfernen</button>
        </div>
    `;
}

function findImageInput(inputName, trigger) {
    const form = trigger?.closest('form') || document;
    return form.querySelector(`[name="${inputName}"]`);
}

function clearImageInput(inputName, trigger) {
    const input = findImageInput(inputName, trigger);
    if (input) {
        input.value = '';
        refreshUploadPreviews(input.closest('form') || document);
    }
}

function refreshUploadPreviews(root = document) {
    root.querySelectorAll('.upload-zone').forEach(zone => {
        const input = zone.closest('form')?.querySelector(`[name="${zone.dataset.input}"]`);
        const preview = zone.querySelector('.upload-preview');
        const src = safeImageUrl(input?.value);
        if (preview) {
            preview.src = src || '';
            preview.style.visibility = src ? 'visible' : 'hidden';
        }
    });
    root.querySelectorAll('[data-image-preview]').forEach(preview => {
        const input = preview.closest('form')?.querySelector(`[name="${preview.dataset.imagePreview}"]`);
        const src = safeImageUrl(input?.value);
        preview.src = src || '';
        preview.style.visibility = src ? 'visible' : 'hidden';
    });
}

function setHeroUploadStatus(message, type = 'info') {
    const status = document.getElementById('heroImageUploadStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = type === 'error' ? '#dc2626' : 'var(--text-muted)';
}

function setDishUploadStatus(message, type = 'info') {
    const status = document.getElementById('dishImageUploadStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = type === 'error' ? '#dc2626' : 'var(--text-muted)';
}

function validateSelectedImage(file) {
    if (!file) return 'Bitte zuerst ein Bild auswählen.';
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        return 'Bitte nur PNG, JPG, WebP oder GIF hochladen.';
    }
    if (file.size > 4 * 1024 * 1024) {
        return 'Das Bild ist zu groß. Maximal 4 MB.';
    }
    return '';
}

async function uploadHeroImage() {
    const fileInput = document.getElementById('heroImageFile');
    const file = fileInput?.files?.[0];
    const validationError = validateSelectedImage(file);
    if (validationError) {
        setHeroUploadStatus(validationError, 'error');
        return;
    }

    const button = document.querySelector('[data-action="upload-hero-image"]');
    const oldText = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = 'Lade hoch...';
    }
    setHeroUploadStatus('Hero-Bild wird hochgeladen...');

    try {
        const res = await fetch('/api/uploads/image', {
            method: 'POST',
            headers: {
                'Content-Type': file.type,
                'X-Upload-Context': 'hero',
                'X-Upload-Name': file.name || '',
                'X-CSRF-Token': await getCsrfToken()
            },
            body: file
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen.');

        const input = document.querySelector('#designForm [name="hero_image_url"]');
        if (input) input.value = data.url;
        refreshUploadPreviews(document.getElementById('designForm'));
        await loadMediaAssets();
        setHeroUploadStatus('Hero-Bild hochgeladen. Speichere danach das Design.');
    } catch (error) {
        setHeroUploadStatus(error.message, 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = oldText;
        }
    }
}

async function uploadDishImage() {
    const form = document.getElementById('dishForm');
    const fileInput = document.getElementById('dishImageFile');
    const file = fileInput?.files?.[0];
    const validationError = validateSelectedImage(file);
    if (validationError) {
        setDishUploadStatus(validationError, 'error');
        return;
    }

    const button = document.querySelector('[data-action="upload-dish-image"]');
    const oldText = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = 'Lade hoch...';
    }
    setDishUploadStatus('Gerichtbild wird hochgeladen...');

    try {
        const res = await fetch('/api/uploads/image', {
            method: 'POST',
            headers: {
                'Content-Type': file.type,
                'X-Upload-Context': 'dish',
                'X-Upload-Name': file.name || '',
                'X-CSRF-Token': await getCsrfToken()
            },
            body: file
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen.');

        const input = form?.querySelector('[name="image_url"]');
        if (input) input.value = data.url;
        refreshUploadPreviews(form);
        setDishUploadStatus('Gerichtbild hochgeladen. Speichere danach das Gericht.');
    } catch (error) {
        setDishUploadStatus(error.message, 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = oldText;
        }
    }
}

function setupUploadZones(root = document) {
    root.querySelectorAll('.upload-zone').forEach(zone => {
        if (zone.dataset.bound === '1') return;
        zone.dataset.bound = '1';
        const input = zone.closest('form')?.querySelector(`[name="${zone.dataset.input}"]`);
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
        fileInput.hidden = true;
        zone.appendChild(fileInput);

        const handleFile = async (file) => {
            if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
                showAlert('Bitte nur PNG, JPG, WebP oder GIF hochladen.');
                return;
            }
            if (file.size > 4 * 1024 * 1024) {
                showAlert('Das Bild ist zu groß. Maximal 4 MB.');
                return;
            }
            zone.classList.add('drag-over');
            try {
                const res = await fetch('/api/uploads/image', {
                    method: 'POST',
                    headers: {
                        'Content-Type': file.type,
                        'X-Upload-Context': zone.dataset.context || 'image',
                        'X-Upload-Name': file.name || '',
                        'X-CSRF-Token': await getCsrfToken()
                    },
                    body: file
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen.');
                if (input) input.value = data.url;
                refreshUploadPreviews(zone.closest('form') || document);
                await loadMediaAssets();
            } catch (error) {
                showAlert(error.message);
            } finally {
                zone.classList.remove('drag-over');
            }
        };

        zone.addEventListener('click', () => fileInput.click());
        zone.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInput.click();
            }
        });
        fileInput.addEventListener('change', event => handleFile(event.target.files[0]));
        zone.addEventListener('dragover', event => {
            event.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', event => {
            event.preventDefault();
            zone.classList.remove('drag-over');
            handleFile(event.dataTransfer.files[0]);
        });
    });
    refreshUploadPreviews(root);
}

function showAlert(message, type = 'error') {
    const alert = document.getElementById('alert');
    alert.textContent = message;
    alert.className = `alert alert-${type === 'success' ? 'success' : 'error'}`;
    alert.classList.remove('hidden');
    setTimeout(() => alert.classList.add('hidden'), type === 'success' ? 5000 : 9000);
}

function showSuccess() {
    const s = document.getElementById('success');
    s.classList.remove('hidden');
    setTimeout(() => s.classList.add('hidden'), 3000);
}

async function saveRestaurantForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    try {
        await api('/api/restaurant', { method: 'PATCH', body: JSON.stringify(data) });
        const refreshed = await fetch('/api/restaurant');
        restaurantData = await refreshed.json();
        fillForms();
        showSuccess();
        await Promise.all([loadStatus(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function loadStatus() {
    const status = await api('/api/restaurant/status');
    currentStatus = status;
    const domainClass = status.freeDomainStatus === 'active' ? 'status-ok' : (status.freeDomainStatus === 'pending' ? 'status-warn' : 'status-muted');

    document.getElementById('statusPanel').innerHTML = `
        <div class="status-box"><div class="status-label">Restaurant</div><div class="status-value">${escapeHtml(status.restaurantName)}</div><small>${escapeHtml(status.slug)}</small></div>
        <div class="status-box"><div class="status-label">Seitenstatus</div><div class="status-value"><span class="status-pill ${status.pageStatus === 'online' ? 'status-ok' : (status.pageStatus === 'error' ? 'status-warn' : 'status-muted')}">${escapeHtml(status.pageStatusLabel || 'Entwurf')}</span></div><small>${status.lastPublishMessage ? escapeHtml(status.lastPublishMessage) : 'Online-Veröffentlichung folgt über den Deploy-Flow.'}</small></div>
        <div class="status-box"><div class="status-label">Kostenlose Adresse</div><div class="status-value">${escapeHtml(status.freeHostname)}</div><small><span class="status-pill ${domainClass}">${escapeHtml(status.freeDomainStatus)}</span></small></div>
        <div class="status-box"><div class="status-label">Template / Tarif</div><div class="status-value">${escapeHtml(status.template || 'free_default')} / ${escapeHtml(status.plan)}</div><small>${status.lastPublishStatus ? `letztes Event: ${escapeHtml(status.lastPublishStatus)}` : 'kein Publish-Event'}</small></div>
        <div class="status-box"><div class="status-label">Nächster Schritt</div><div class="status-value">${escapeHtml(status.nextStep)}</div></div>
    `;
    renderPlanPanel();
}

async function loadOnboarding() {
    const guide = await api('/api/restaurant/onboarding');
    const nextLabel = guide.next ? guide.next.label : 'Alle Schritte geprüft';
    const progress = Math.max(0, Math.min(100, Number(guide.progressPercent || 0)));
    document.getElementById('onboardingPanel').innerHTML = `
        <div class="section-header" style="margin-bottom: 1rem;">
            <div><h2>Geführter Start</h2><p class="muted">Nächster Schritt: ${escapeHtml(nextLabel)}</p></div>
            <span class="status-pill ${guide.completed === guide.total ? 'status-ok' : 'status-warn'}">${escapeHtml(progress)}%</span>
        </div>
        <div class="progress-track" aria-label="Onboarding-Fortschritt"><div class="progress-fill" style="width: ${escapeAttr(progress)}%;"></div></div>
        <p class="muted">${escapeHtml(guide.completed)}/${escapeHtml(guide.total)} Pflichtschritte erledigt${guide.optionalTotal ? ` · ${escapeHtml(guide.optionalCompleted)}/${escapeHtml(guide.optionalTotal)} optionale Schritte` : ''}</p>
        <div style="display: grid; gap: 0.75rem;">
            ${guide.steps.map(step => `
                <div class="onboarding-step">
                    <div>
                        <div class="onboarding-title">
                            <span class="status-pill ${step.done ? 'status-ok' : 'status-muted'}">${step.done ? 'erledigt' : 'offen'}</span>
                            <span class="status-pill ${step.required ? 'status-warn' : 'status-muted'}">${step.required ? 'Pflicht' : 'Optional'}</span>
                            <span>${escapeHtml(step.label)}</span>
                        </div>
                        <p class="meta-line">${escapeHtml(step.detail || '')}</p>
                    </div>
                    ${renderOnboardingAction(step)}
                </div>
            `).join('')}
        </div>
    `;
}

function renderOnboardingAction(step) {
    if (step.targetTab) return `<button class="btn-sm secondary" type="button" data-action="show-tab" data-tab="${escapeAttr(step.targetTab)}">Öffnen</button>`;
    if (step.url) return `<a class="btn-sm secondary" href="${escapeAttr(step.url)}" target="_blank">Öffnen</a>`;
    if (step.action === 'cf-prepare') return '<button class="btn-sm secondary" type="button" data-action="cf-prepare">Starten</button>';
    return '';
}

async function loadHours() {
    const hours = await api('/api/opening-hours');
    const grid = document.getElementById('hoursList');
    grid.innerHTML = '';
    weekdays.forEach((day, i) => {
        const h = hours.find(x => x.weekday === i) || { weekday: i, is_closed: 0, open_time_1: '09:00', close_time_1: '22:00' };
        grid.innerHTML += `
            <strong>${escapeHtml(day)}</strong>
            <div class="hours-row">
                <label><input type="checkbox" name="closed-${i}" ${h.is_closed ? 'checked' : ''}> Geschlossen</label>
                <input type="time" name="open1-${i}" value="${escapeAttr(h.open_time_1 || '')}">
                <input type="time" name="close1-${i}" value="${escapeAttr(h.close_time_1 || '')}">
                <input type="time" name="open2-${i}" value="${escapeAttr(h.open_time_2 || '')}">
                <input type="time" name="close2-${i}" value="${escapeAttr(h.close_time_2 || '')}">
                <input type="text" name="note-${i}" placeholder="Notiz" value="${escapeAttr(h.note || '')}">
            </div>
        `;
    });
}

async function saveHours(event) {
    event.preventDefault();
    const form = event.target;
    const hours = weekdays.map((_, i) => ({
        weekday: i,
        is_closed: form.querySelector(`[name="closed-${i}"]`).checked,
        open_time_1: form.querySelector(`[name="open1-${i}"]`).value,
        close_time_1: form.querySelector(`[name="close1-${i}"]`).value,
        open_time_2: form.querySelector(`[name="open2-${i}"]`).value,
        close_time_2: form.querySelector(`[name="close2-${i}"]`).value,
        note: form.querySelector(`[name="note-${i}"]`).value
    }));

    try {
        await api('/api/opening-hours', { method: 'POST', body: JSON.stringify({ hours }) });
        showSuccess();
        await Promise.all([loadOnboarding(), loadHours()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function loadClosures() {
    currentClosures = await api('/api/special-closures');
    const container = document.getElementById('closuresList');
    if (!currentClosures.length) {
        container.innerHTML = '<div class="card"><p class="muted">Keine Sonderschließungen eingetragen.</p></div>';
        return;
    }
    container.innerHTML = currentClosures.map(item => `
        <div class="card" style="margin-bottom: 1rem;">
            <div class="section-header" style="margin-bottom: 0.75rem;">
                <div>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p class="muted">${escapeHtml(item.start_date)} bis ${escapeHtml(item.end_date)} · ${item.is_active ? 'aktiv' : 'inaktiv'}</p>
                </div>
                <div class="toolbar">
                    <button class="btn-sm secondary" type="button" data-action="open-closure-modal" data-id="${item.id}">Bearbeiten</button>
                    <button class="btn-sm secondary" type="button" data-action="toggle-closure" data-id="${item.id}" data-active="${item.is_active ? 0 : 1}">${item.is_active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button class="btn-sm btn-danger" type="button" data-action="delete-closure" data-id="${item.id}">Löschen</button>
                </div>
            </div>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
        </div>
    `).join('');
}

function openClosureModal(id = null) {
    const item = id ? currentClosures.find(x => x.id === id) : {};
    openModal(`
        <h2>${id ? 'Schließzeit bearbeiten' : 'Neue Schließzeit'}</h2>
        <form id="closureForm">
            <div class="form-group"><label>Titel</label><input type="text" name="title" required value="${escapeAttr(item.title || '')}"></div>
            <div class="grid">
                <div class="form-group"><label>Startdatum</label><input type="date" name="start_date" required value="${escapeAttr(item.start_date || '')}"></div>
                <div class="form-group"><label>Enddatum</label><input type="date" name="end_date" required value="${escapeAttr(item.end_date || '')}"></div>
            </div>
            <div class="form-group"><label>Hinweis</label><textarea name="note" rows="3">${escapeHtml(item.note || '')}</textarea></div>
            <label><input type="checkbox" name="is_active" ${!id || item.is_active ? 'checked' : ''}> Aktiv</label>
            <div class="toolbar" style="margin-top: 1.5rem;">
                <button type="submit">Speichern</button>
                <button type="button" class="secondary" data-action="close-modal">Abbrechen</button>
            </div>
        </form>
    `);
    document.getElementById('closureForm').addEventListener('submit', event => saveClosure(event, id));
}

async function saveClosure(event, id) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    data.is_active = event.target.querySelector('[name="is_active"]').checked;
    try {
        await api(id ? `/api/special-closures/${id}` : '/api/special-closures', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify(data)
        });
        closeModal();
        showSuccess();
        await Promise.all([loadClosures(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function toggleClosure(id, active) {
    try {
        await api(`/api/special-closures/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) });
        await loadClosures();
    } catch (error) {
        showAlert(error.message);
    }
}

async function deleteClosure(id) {
    if (!confirm('Schließzeit löschen?')) return;
    try {
        await api(`/api/special-closures/${id}`, { method: 'DELETE' });
        await Promise.all([loadClosures(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function loadMenu() {
    currentMenu = await api('/api/menu');
    const container = document.getElementById('menuStructure');
    if (!currentMenu.categories.length) {
        container.innerHTML = '<div class="card"><p class="muted">Keine Kategorien angelegt.</p></div>';
        return;
    }

    container.innerHTML = currentMenu.categories.map(cat => {
        const categoryImage = safeImageUrl(cat.image_url);
        return `
        <div class="menu-cat" data-category-id="${cat.id}" draggable="true">
            <div class="category-head">
                <span class="drag-handle" title="Kategorie ziehen" aria-label="Kategorie ziehen">≡</span>
                ${categoryImage ? `<img class="category-thumb" src="${escapeAttr(categoryImage)}" alt="">` : '<div class="category-thumb"></div>'}
                <div>
                    <h3>${escapeHtml(cat.category_name)}</h3>
                    <p class="muted">${escapeHtml(cat.display_mode)} · ${escapeHtml(cat.layout_mode || 'inherit')} · Sortierung ${escapeHtml(cat.sort_order)} · ${cat.is_active ? 'aktiv' : 'inaktiv'}</p>
                </div>
                <div class="toolbar">
                    <button class="btn-sm secondary" type="button" data-action="open-category-modal" data-id="${cat.id}">Bearbeiten</button>
                    <button class="btn-sm" type="button" data-action="open-dish-modal" data-category-id="${cat.id}">Gericht</button>
                    <button class="btn-sm secondary" type="button" data-action="toggle-category" data-id="${cat.id}" data-active="${cat.is_active ? 0 : 1}">${cat.is_active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button class="btn-sm btn-danger" type="button" data-action="delete-category" data-id="${cat.id}">Löschen</button>
                </div>
            </div>
            <div class="dish-list" data-category-id="${cat.id}">
                ${cat.dishes.length ? cat.dishes.map(dish => renderDish(dish, cat.id)).join('') : '<p class="muted">Keine Gerichte in dieser Kategorie.</p>'}
            </div>
        </div>
    `}).join('');
    setupMenuDragAndDrop();
}

async function loadMediaAssets() {
    mediaAssets = await api('/api/media-assets');
    const container = document.getElementById('mediaLibrary');
    if (!container) return;
    if (!mediaAssets.length) {
        container.innerHTML = '<div class="card"><p class="muted">Noch keine Bilder hochgeladen.</p></div>';
        return;
    }

    container.innerHTML = mediaAssets.map(asset => `
        <div class="media-tile">
            <img src="${escapeAttr(safeImageUrl(asset.url))}" alt="">
            <div class="media-tile-body">
                <strong>${escapeHtml(asset.context || 'Bild')}</strong>
                <small class="muted">${escapeHtml(asset.original_name || asset.url.split('/').pop())}</small>
                <small class="muted">${Math.round((asset.size_bytes || 0) / 1024)} KB</small>
                <button type="button" class="btn-sm btn-danger" data-action="delete-media-asset" data-id="${asset.id}">Löschen</button>
            </div>
        </div>
    `).join('');
}

function openMediaPicker(inputName, trigger) {
    const input = findImageInput(inputName, trigger);
    const pickerItems = mediaAssets.map(asset => `
        <button type="button" class="media-picker-button" data-action="select-media-asset" data-input="${escapeAttr(inputName)}" data-url="${escapeAttr(asset.url)}">
            <img src="${escapeAttr(safeImageUrl(asset.url))}" alt="">
            <span style="display:block; padding:0.5rem; font-size:0.8rem;">${escapeHtml(asset.context || 'Bild')}</span>
        </button>
    `).join('');

    document.getElementById('mediaPickerContent').innerHTML = `
        <h2>Bild auswählen</h2>
        ${mediaAssets.length ? `<div class="media-picker-grid">${pickerItems}</div>` : '<p class="muted">Noch keine Bilder in der Mediathek.</p>'}
        <div class="toolbar" style="margin-top: 1.5rem;">
            <button type="button" class="secondary" data-action="close-media-picker">Abbrechen</button>
        </div>
    `;
    window.pendingMediaInput = input;
    document.getElementById('mediaPicker').classList.remove('hidden');
}

function selectMediaAsset(inputName, url) {
    const input = window.pendingMediaInput || document.querySelector(`[name="${inputName}"]`);
    if (input) {
        input.value = url;
        refreshUploadPreviews(input.closest('form') || document);
    }
    window.pendingMediaInput = null;
    closeMediaPicker();
}

function closeMediaPicker() {
    document.getElementById('mediaPicker').classList.add('hidden');
    document.getElementById('mediaPickerContent').innerHTML = '';
    window.pendingMediaInput = null;
}

async function deleteMediaAsset(id) {
    if (!confirm('Bild aus der Mediathek löschen? Verwendete Bilder können nicht gelöscht werden.')) return;
    try {
        await api(`/api/media-assets/${id}`, { method: 'DELETE' });
        showSuccess();
        await loadMediaAssets();
    } catch (error) {
        showAlert(error.message);
    }
}

function renderDish(dish, categoryId) {
    const image = safeImageUrl(dish.image_url);
    return `
        <div class="menu-item" data-dish-id="${dish.id}" data-category-id="${categoryId}" draggable="true">
            <span class="drag-handle" title="Gericht ziehen" aria-label="Gericht ziehen">≡</span>
            ${image ? `<img class="thumb" src="${escapeAttr(image)}" alt="">` : '<div class="thumb"></div>'}
            <div>
                <strong>${escapeHtml(dish.dish_name)} · ${(dish.price_cents / 100).toFixed(2)}€</strong>
                ${dish.badge_text ? `<span class="status-pill status-muted" style="margin-left: 0.5rem;">${escapeHtml(dish.badge_text)}</span>` : ''}
                <p class="meta-line">${escapeHtml(dish.description_text || '')}</p>
                ${dish.ingredients_text ? `<div class="meta-line">Zutaten: ${escapeHtml(dish.ingredients_text)}</div>` : ''}
                ${dish.allergens_text ? `<div class="meta-line">Allergene: ${escapeHtml(dish.allergens_text)}</div>` : ''}
                <div class="meta-line">Sortierung ${escapeHtml(dish.sort_order)} · ${dish.is_active ? 'aktiv' : 'inaktiv'}</div>
            </div>
            <div class="toolbar">
                <button class="btn-sm secondary" type="button" data-action="open-dish-modal" data-id="${dish.id}">Bearbeiten</button>
                <button class="btn-sm secondary" type="button" data-action="toggle-dish" data-id="${dish.id}" data-active="${dish.is_active ? 0 : 1}">${dish.is_active ? 'Deaktivieren' : 'Aktivieren'}</button>
                <button class="btn-sm btn-danger" type="button" data-action="delete-dish" data-id="${dish.id}">Löschen</button>
            </div>
        </div>
    `;
}

let menuDragState = null;

function insertByPointer(container, dragged, target, y) {
    if (!target || target === dragged || target.parentElement !== container) return;
    const rect = target.getBoundingClientRect();
    const before = y < rect.top + rect.height / 2;
    container.insertBefore(dragged, before ? target : target.nextSibling);
}

async function saveCategoryOrder() {
    const orderedIds = Array.from(document.querySelectorAll('#menuStructure > .menu-cat'))
        .map(item => Number(item.dataset.categoryId));
    await api('/api/menu/categories/reorder', {
        method: 'POST',
        body: JSON.stringify({ menu_id: currentMenu.id, ordered_ids: orderedIds })
    });
}

async function saveDishOrder(categoryId) {
    const list = document.querySelector(`.dish-list[data-category-id="${categoryId}"]`);
    const orderedIds = Array.from(list.querySelectorAll('.menu-item'))
        .map(item => Number(item.dataset.dishId));
    await api('/api/dishes/reorder', {
        method: 'POST',
        body: JSON.stringify({ category_id: Number(categoryId), ordered_ids: orderedIds })
    });
}

function setupMenuDragAndDrop() {
    const menuContainer = document.getElementById('menuStructure');

    menuContainer.querySelectorAll('.menu-cat').forEach(categoryEl => {
        categoryEl.addEventListener('dragstart', event => {
            if (event.target.closest('.menu-item')) return;
            menuDragState = { type: 'category', id: categoryEl.dataset.categoryId };
            categoryEl.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
        });

        categoryEl.addEventListener('dragover', event => {
            if (!menuDragState || menuDragState.type !== 'category') return;
            event.preventDefault();
            const dragged = menuContainer.querySelector(`.menu-cat[data-category-id="${menuDragState.id}"]`);
            insertByPointer(menuContainer, dragged, categoryEl, event.clientY);
        });

        categoryEl.addEventListener('drop', async event => {
            if (!menuDragState || menuDragState.type !== 'category') return;
            event.preventDefault();
            try {
                await saveCategoryOrder();
                showSuccess();
                await loadMenu();
            } catch (error) {
                showAlert(error.message);
                await loadMenu();
            }
        });

        categoryEl.addEventListener('dragend', () => {
            categoryEl.classList.remove('dragging');
            menuDragState = null;
        });
    });

    menuContainer.querySelectorAll('.menu-item').forEach(dishEl => {
        dishEl.addEventListener('dragstart', event => {
            event.stopPropagation();
            menuDragState = {
                type: 'dish',
                id: dishEl.dataset.dishId,
                categoryId: dishEl.dataset.categoryId
            };
            dishEl.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
        });

        dishEl.addEventListener('dragend', event => {
            event.stopPropagation();
            dishEl.classList.remove('dragging');
            menuDragState = null;
        });
    });

    menuContainer.querySelectorAll('.dish-list').forEach(list => {
        list.addEventListener('dragover', event => {
            if (!menuDragState || menuDragState.type !== 'dish' || menuDragState.categoryId !== list.dataset.categoryId) return;
            event.preventDefault();
            event.stopPropagation();
            const dragged = list.querySelector(`.menu-item[data-dish-id="${menuDragState.id}"]`);
            const target = event.target.closest('.menu-item');
            if (target) insertByPointer(list, dragged, target, event.clientY);
        });

        list.addEventListener('drop', async event => {
            if (!menuDragState || menuDragState.type !== 'dish' || menuDragState.categoryId !== list.dataset.categoryId) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                await saveDishOrder(list.dataset.categoryId);
                showSuccess();
                await loadMenu();
            } catch (error) {
                showAlert(error.message);
                await loadMenu();
            }
        });
    });
}

function openCategoryModal(id = null) {
    const item = id ? currentMenu.categories.find(x => x.id === id) : {};
    openModal(`
        <h2>${id ? 'Kategorie bearbeiten' : 'Neue Kategorie'}</h2>
        <form id="categoryForm">
            <div class="form-group"><label>Name</label><input type="text" name="category_name" required value="${escapeAttr(item.category_name || '')}"></div>
            <div class="grid">
                <div class="form-group"><label>Ausrichtung</label><select name="display_mode"><option value="vertical" ${item.display_mode === 'vertical' || !item.display_mode ? 'selected' : ''}>Vertikal</option><option value="horizontal" ${item.display_mode === 'horizontal' ? 'selected' : ''}>Horizontal</option></select></div>
                <div class="form-group"><label>Sortierung</label><input type="number" name="sort_order" value="${escapeAttr(item.sort_order ?? '')}"></div>
            </div>
            <div class="form-group">
                <label>Menü-Stil für diese Kategorie</label>
                <select name="layout_mode">
                    <option value="inherit" ${!item.layout_mode || item.layout_mode === 'inherit' ? 'selected' : ''}>Globales Design übernehmen</option>
                    <option value="list" ${item.layout_mode === 'list' ? 'selected' : ''}>Liste</option>
                    <option value="cards" ${item.layout_mode === 'cards' ? 'selected' : ''}>Karten</option>
                    <option value="compact" ${item.layout_mode === 'compact' ? 'selected' : ''}>Kompakt</option>
                </select>
            </div>
            <div class="form-group">
                <label>Kategoriebild</label>
                ${uploadBox('image_url', item.image_url || '', 'Kategoriebild ablegen', 'category')}
            </div>
            <label><input type="checkbox" name="is_active" ${!id || item.is_active ? 'checked' : ''}> Aktiv</label>
            <div class="toolbar" style="margin-top: 1.5rem;">
                <button type="submit">Speichern</button>
                <button type="button" class="secondary" data-action="close-modal">Abbrechen</button>
            </div>
        </form>
    `);
    setupUploadZones(document.getElementById('modalContent'));
    document.getElementById('categoryForm').addEventListener('submit', event => saveCategory(event, id));
}

async function saveCategory(event, id) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    data.is_active = event.target.querySelector('[name="is_active"]').checked;
    if (!id) data.menu_id = currentMenu.id;
    try {
        await api(id ? `/api/menu/categories/${id}` : '/api/menu/categories', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify(data)
        });
        closeModal();
        showSuccess();
        await Promise.all([loadMenu(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

function findDish(id) {
    for (const cat of currentMenu.categories) {
        const dish = cat.dishes.find(item => item.id === id);
        if (dish) return { dish, categoryId: cat.id };
    }
    return { dish: {}, categoryId: null };
}

function openDishModal(id = null, categoryId = null) {
    const found = id ? findDish(id) : { dish: {}, categoryId };
    const dish = found.dish || {};
    const catId = found.categoryId || categoryId;
    openModal(`
        <h2>${id ? 'Gericht bearbeiten' : 'Neues Gericht'}</h2>
        <form id="dishForm">
            <div class="grid">
                <div class="form-group"><label>Name</label><input type="text" name="dish_name" required value="${escapeAttr(dish.dish_name || '')}"></div>
                <div class="form-group"><label>Preis (€)</label><input type="number" step="0.01" min="0" name="price" required value="${dish.price_cents !== undefined ? escapeAttr((dish.price_cents / 100).toFixed(2)) : ''}"></div>
            </div>
            <div class="form-group"><label>Beschreibung</label><textarea name="description_text" rows="3">${escapeHtml(dish.description_text || '')}</textarea></div>
            <div class="grid">
                <div class="form-group"><label>Zutaten</label><textarea name="ingredients_text" rows="3">${escapeHtml(dish.ingredients_text || '')}</textarea></div>
                <div class="form-group"><label>Allergene</label><textarea name="allergens_text" rows="3">${escapeHtml(dish.allergens_text || '')}</textarea></div>
            </div>
            <div class="grid">
                <div class="form-group"><label>Badge</label><input type="text" name="badge_text" value="${escapeAttr(dish.badge_text || '')}"></div>
                <div class="form-group"><label>Sortierung</label><input type="number" name="sort_order" value="${escapeAttr(dish.sort_order ?? '')}"></div>
            </div>
            <div class="form-group">
                <label>Gerichtbild</label>
                <input type="hidden" name="image_url" value="${escapeAttr(dish.image_url || '')}">
                <div class="dish-upload-panel">
                    <img class="dish-upload-preview" data-image-preview="image_url" alt="">
                    <input type="file" id="dishImageFile" accept="image/png,image/jpeg,image/webp,image/gif">
                    <button type="button" class="btn-sm secondary" data-action="upload-dish-image">Gerichtbild hochladen</button>
                    <p class="meta-line" id="dishImageUploadStatus">PNG, JPG, WebP oder GIF bis 4 MB.</p>
                </div>
            </div>
            <label><input type="checkbox" name="is_active" ${!id || dish.is_active ? 'checked' : ''}> Aktiv</label>
            <div class="toolbar" style="margin-top: 1.5rem;">
                <button type="submit">Speichern</button>
                <button type="button" class="secondary" data-action="close-modal">Abbrechen</button>
            </div>
        </form>
    `);
    refreshUploadPreviews(document.getElementById('modalContent'));
    document.getElementById('dishForm').addEventListener('submit', event => saveDish(event, id, catId));
}

async function saveDish(event, id, categoryId) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    data.price_cents = Math.round(Number(data.price) * 100);
    delete data.price;
    data.is_active = event.target.querySelector('[name="is_active"]').checked;
    if (!id) data.category_id = categoryId;
    try {
        await api(id ? `/api/dishes/${id}` : '/api/dishes', {
            method: id ? 'PATCH' : 'POST',
            body: JSON.stringify(data)
        });
        closeModal();
        showSuccess();
        await Promise.all([loadMenu(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function toggleCategory(id, active) {
    try {
        await api(`/api/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) });
        await Promise.all([loadMenu(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function deleteCategory(id) {
    if (!confirm('Kategorie löschen?')) return;
    try {
        await api(`/api/menu/categories/${id}`, { method: 'DELETE' });
        await Promise.all([loadMenu(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function toggleDish(id, active) {
    try {
        await api(`/api/dishes/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) });
        await Promise.all([loadMenu(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

async function deleteDish(id) {
    if (!confirm('Gericht löschen?')) return;
    try {
        await api(`/api/dishes/${id}`, { method: 'DELETE' });
        await Promise.all([loadMenu(), loadOnboarding()]);
    } catch (error) {
        showAlert(error.message);
    }
}

function renderPlanPanel() {
    if (!currentStatus) return;
    const paidEnabled = currentStatus.plan === 'paid';
    const capabilities = currentStatus.planCapabilities || {};
    document.getElementById('planPanel').innerHTML = `
        <div class="card">
            <h3>Aktueller Tarif</h3>
            <p><span class="status-pill ${paidEnabled ? 'status-ok' : 'status-muted'}">${escapeHtml(currentStatus.plan.toUpperCase())}</span></p>
            <p class="muted">${escapeHtml(capabilities.summary || (paidEnabled ? 'Werbefreier Auftritt vorbereitet.' : 'Free-Seiten enthalten Restiq-Branding, Werbeplätze und Spendenhinweis.'))}</p>
            <div class="compact-list">
                <div class="compact-item"><strong>Werbung</strong><br><span class="muted">${capabilities.adsEnabled ? 'Aktiv in der kostenlosen Stufe' : 'Deaktiviert im Paid-Tarif'}</span></div>
                <div class="compact-item"><strong>Spendenhinweis</strong><br><span class="muted">${capabilities.donationHintEnabled ? 'Aktiv in der kostenlosen Stufe' : 'Deaktiviert im Paid-Tarif'}</span></div>
                <div class="compact-item"><strong>Eigene Domain</strong><br><span class="muted">${capabilities.customDomainAllowed ? 'Vorbereitet, DNS-Prüfung folgt später' : 'Nicht verfügbar'}</span></div>
            </div>
            <button type="button" class="secondary" disabled>Upgrade vorbereiten</button>
        </div>
        <div class="card">
            <h3>Kostenlose Domain</h3>
            <p>${escapeHtml(currentStatus.freeHostname)}</p>
            <p><span class="status-pill ${currentStatus.freeDomainStatus === 'active' ? 'status-ok' : (currentStatus.freeDomainStatus === 'pending' ? 'status-warn' : 'status-muted')}">${escapeHtml(currentStatus.freeDomainStatusLabel || currentStatus.freeDomainStatus)}</span></p>
            <p class="muted">Diese Adresse wird von RestIQ vorbereitet und später über den Deploy-Prozess online geschaltet.</p>
        </div>
        <div class="card">
            <h3>Eigene Domain</h3>
            <p class="muted">Status: <span class="status-pill ${currentStatus.customDomainStatus === 'active' ? 'status-ok' : (currentStatus.customDomain ? 'status-warn' : 'status-muted')}">${escapeHtml(currentStatus.customDomainStatusLabel || currentStatus.customDomainStatus)}</span></p>
            <form id="domainForm">
                <div class="form-group">
                    <label>Domain-Auswahl</label>
                    <select name="domain_choice">
                        <option value="restiq_free">Kostenlose RestIQ-Adresse nutzen</option>
                        <option value="buy_external">Domain extern kaufen / später eintragen</option>
                        <option value="own_domain" ${currentStatus.customDomain ? 'selected' : ''}>Eigene Domain eintragen</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Eigene Domain</label>
                    <input type="text" name="custom_domain" placeholder="www.restaurant.de" value="${escapeAttr(currentStatus.customDomain || '')}">
                </div>
                <button type="submit" class="secondary">Domainwunsch speichern</button>
            </form>
            ${currentStatus.domainProvider ? `<p class="muted" style="margin-top: 1rem;">Domain extern kaufen: <a href="${escapeAttr(currentStatus.domainProvider.affiliate_base_url || currentStatus.domainProvider.website_url)}" target="_blank" rel="noopener">${escapeHtml(currentStatus.domainProvider.provider_name)}</a></p>` : ''}
            ${currentStatus.domainAffiliateNote ? `<p class="muted">${escapeHtml(currentStatus.domainAffiliateNote)}</p>` : ''}
            ${currentStatus.domainVerification ? `<div class="compact-item" style="margin-top: 1rem;"><strong>Verifikation vorbereitet</strong><br><span class="muted">${escapeHtml(currentStatus.domainVerification.instruction)}</span></div>` : ''}
            <p class="muted" style="margin-top: 1rem;">Ein Domain-Passwort reicht technisch nicht aus. Die spätere Prüfung erfolgt über DNS/Cloudflare.</p>
        </div>
    `;
    document.getElementById('domainForm').addEventListener('submit', saveDomainChoice);
}

async function saveDomainChoice(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    try {
        await api('/api/restaurant/domain', { method: 'POST', body: JSON.stringify(data) });
        showSuccess();
        await loadStatus();
    } catch (error) {
        showAlert(error.message);
    }
}

async function loadHelp() {
    const articles = await api('/api/help/articles');
    document.getElementById('helpArticles').innerHTML = articles.map(a => `
        <div class="card">
            <div class="badge badge-free" style="margin-bottom: 1rem;">${escapeHtml(a.article_type.toUpperCase())}</div>
            <h3>${escapeHtml(a.title)}</h3>
            <a href="/help.html?article=${encodeURIComponent(a.id)}">Lesen</a>
        </div>
    `).join('');
}

function openModal(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modalContent').innerHTML = '';
}

function handleDashboardAction(event) {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    const action = trigger.dataset.action;
    if (!action) return;
    event.preventDefault();

    const id = trigger.dataset.id ? Number(trigger.dataset.id) : null;
    const categoryId = trigger.dataset.categoryId ? Number(trigger.dataset.categoryId) : null;
    const active = trigger.dataset.active !== undefined ? Number(trigger.dataset.active) : null;

    if (action === 'show-tab') return showTab(trigger.dataset.tab);
    if (action === 'open-closure-modal') return openClosureModal(id);
    if (action === 'open-category-modal') return openCategoryModal(id);
    if (action === 'open-dish-modal') return openDishModal(id, categoryId);
    if (action === 'open-media-picker') return openMediaPicker(trigger.dataset.input, trigger);
    if (action === 'clear-image-input') return clearImageInput(trigger.dataset.input, trigger);
    if (action === 'upload-hero-image') return uploadHeroImage();
    if (action === 'upload-dish-image') return uploadDishImage();
    if (action === 'load-media-assets') return loadMediaAssets();
    if (action === 'toggle-closure') return toggleClosure(id, active);
    if (action === 'delete-closure') return deleteClosure(id);
    if (action === 'toggle-category') return toggleCategory(id, active);
    if (action === 'delete-category') return deleteCategory(id);
    if (action === 'delete-media-asset') return deleteMediaAsset(id);
    if (action === 'select-media-asset') return selectMediaAsset(trigger.dataset.input, trigger.dataset.url);
    if (action === 'close-media-picker') return closeMediaPicker();
    if (action === 'toggle-dish') return toggleDish(id, active);
    if (action === 'delete-dish') return deleteDish(id);
    if (action === 'close-modal') return closeModal();
    if (action === 'cf-prepare') return document.getElementById('cfPrepareBtn').click();
}

document.addEventListener('click', handleDashboardAction);
document.getElementById('baseForm').addEventListener('submit', event => {
    event.preventDefault();
    saveRestaurantForm(event.target);
});

document.getElementById('designForm').addEventListener('submit', event => {
    event.preventDefault();
    saveRestaurantForm(event.target);
});

document.getElementById('hoursForm').addEventListener('submit', saveHours);

document.getElementById('setupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    try {
        await api('/api/restaurant/setup', { method: 'POST', body: JSON.stringify(data) });
        window.location.reload();
    } catch (error) {
        showAlert(error.message);
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    api('/api/auth/logout', { method: 'POST' }).then(() => window.location.href = 'index.html');
});

document.getElementById('cfPrepareBtn').addEventListener('click', async () => {
    const btn = document.getElementById('cfPrepareBtn');
    const oldText = btn.textContent;
    btn.textContent = 'Bereite vor...';
    try {
        const data = await api('/api/restaurant/cf-prepare', { method: 'POST' });
        await Promise.all([loadStatus(), loadOnboarding()]);
        showAlert(`Cloudflare Export bereit: ${data.targetHostname}`, 'success');
    } catch (error) {
        showAlert(error.message);
    } finally {
        btn.textContent = oldText;
    }
});

document.getElementById('modal').addEventListener('click', event => {
    if (event.target.id === 'modal') closeModal();
});
document.getElementById('mediaPicker').addEventListener('click', event => {
    if (event.target.id === 'mediaPicker') closeMediaPicker();
});

init().catch(error => showAlert(error.message));
