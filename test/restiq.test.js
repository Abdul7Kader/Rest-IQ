const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/db');
const storage = require('../lib/storage');

const PORT = 3555;
const BASE = `http://localhost:${PORT}`;
const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
);
let serverProcess;

function request(method, path, { cookie, body, headers, rawBody } = {}) {
    return new Promise((resolve, reject) => {
        const payload = rawBody !== undefined
            ? rawBody
            : (body === undefined ? null : JSON.stringify(body));
        const req = http.request(`${BASE}${path}`, {
            method,
            headers: {
                ...(payload && rawBody === undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...(cookie ? { Cookie: cookie } : {}),
                ...(headers || {})
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = {};
                try {
                    parsed = data ? JSON.parse(data) : {};
                } catch (error) {
                    parsed = { raw: data };
                }
                resolve({
                    status: res.statusCode,
                    body: parsed,
                    headers: res.headers,
                    cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] || cookie || null
                });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitForServer() {
    const started = Date.now();
    while (Date.now() - started < 8000) {
        try {
            const res = await request('GET', '/index.html');
            if (res.status === 200) return;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }
    throw new Error('Test server did not start.');
}

async function login(email, password) {
    const res = await request('POST', '/api/auth/login', { body: { email, password } });
    assert.equal(res.status, 200);
    assert.ok(res.cookie);
    return res.cookie;
}

async function csrf(cookie) {
    const res = await request('GET', '/api/auth/csrf', { cookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.csrfToken);
    return res.body.csrfToken;
}

test.before(async () => {
    serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: `${__dirname}/..`,
        env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-session-secret', TRUST_PROXY: '1', RESTIQ_STORAGE_DRIVER: 'local' },
        stdio: 'ignore',
        windowsHide: true
    });
    await waitForServer();
});

test.after(() => {
    if (serverProcess) serverProcess.kill();
    const rows = db.prepare("SELECT id FROM users WHERE email LIKE 'test-%@restiq.local'").all();
    const cleanup = db.transaction(() => {
        for (const row of rows) db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
        db.prepare("DELETE FROM sessions WHERE sess LIKE '%test-%@restiq.local%'").run();
        db.prepare("UPDATE platform_settings SET setting_value = 'Werbeplatz', updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'default_ad_label'").run();
    });
    cleanup();
});

test('auth stores only hashes and rejects weak registration passwords', async () => {
    const weak = await request('POST', '/api/auth/register', {
        body: { email: 'test-weak@restiq.local', password: 'password', restaurant_name: 'Weak Test' }
    });
    assert.equal(weak.status, 400);

    const strong = await request('POST', '/api/auth/register', {
        body: {
            email: 'test-strong@restiq.local',
            password: 'StrongPass123',
            restaurant_name: 'Strong Test Restaurant',
            plan_choice: 'free',
            domain_choice: 'restiq_free'
        }
    });
    assert.equal(strong.status, 200);

    const user = db.prepare("SELECT password_hash FROM users WHERE email = 'test-strong@restiq.local'").get();
    assert.ok(user.password_hash.startsWith('$2'));
    assert.notEqual(user.password_hash, 'StrongPass123');
});

test('central auth JSON validation rejects unknown fields and invalid types', async () => {
    const loginWithUnknownField = await request('POST', '/api/auth/login', {
        headers: { 'X-Forwarded-For': '203.0.113.88' },
        body: {
            email: 'missing-validation@restiq.local',
            password: 'WrongPass123',
            role: 'platform_admin'
        }
    });
    assert.equal(loginWithUnknownField.status, 400);
    assert.equal(loginWithUnknownField.body.error, 'Invalid request body.');

    const registerWithInvalidType = await request('POST', '/api/auth/register', {
        headers: { 'X-Forwarded-For': '203.0.113.89' },
        body: {
            email: 'test-invalid-type@restiq.local',
            password: 'StrongPass123',
            restaurant_name: ['Invalid Restaurant']
        }
    });
    assert.equal(registerWithInvalidType.status, 400);
    assert.equal(registerWithInvalidType.body.error, 'Invalid request body.');
});

test('owner cannot access admin APIs', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const res = await request('GET', '/api/admin/summary', { cookie: ownerCookie });
    assert.equal(res.status, 403);
});

test('admin APIs require CSRF for mutations and accept valid CSRF', async () => {
    const adminCookie = await login('admin@restiq.app', 'admin123');

    const noToken = await request('PATCH', '/api/admin/platform-settings', {
        cookie: adminCookie,
        body: { default_ad_label: 'Test Label' }
    });
    assert.equal(noToken.status, 403);

    const token = await csrf(adminCookie);
    const withToken = await request('PATCH', '/api/admin/platform-settings', {
        cookie: adminCookie,
        headers: { 'X-CSRF-Token': token },
        body: { default_ad_label: 'Werbeplatz' }
    });
    assert.equal(withToken.status, 200);
});

test('security headers and session cookie flags are present', async () => {
    const page = await request('GET', '/index.html');
    assert.equal(page.status, 200);
    assert.equal(page.headers['x-powered-by'], undefined);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['x-dns-prefetch-control'], 'off');
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['x-permitted-cross-domain-policies'], 'none');
    assert.equal(page.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(page.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);

    const loginRes = await request('POST', '/api/auth/login', {
        body: { email: 'mario@trattoria-mario.de', password: 'owner123' }
    });
    const setCookie = loginRes.headers['set-cookie'][0];
    assert.match(setCookie, /^restiq\.sid=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Priority=High/);
    assert.doesNotMatch(setCookie, /Secure/);
});

test('admin can read platform controls', async () => {
    const adminCookie = await login('admin@restiq.app', 'admin123');
    const providers = await request('GET', '/api/admin/domain-providers', { cookie: adminCookie });
    const adSlots = await request('GET', '/api/admin/ad-slots', { cookie: adminCookie });
    const settings = await request('GET', '/api/admin/platform-settings', { cookie: adminCookie });

    assert.equal(providers.status, 200);
    assert.ok(providers.body.some(provider => provider.provider_name === 'Namecheap'));
    assert.equal(adSlots.status, 200);
    assert.ok(adSlots.body.length >= 1);
    assert.equal(settings.status, 200);
    assert.equal(settings.body.default_ad_label, 'Werbeplatz');
});

test('owner onboarding exposes required progress and optional closure step', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const guide = await request('GET', '/api/restaurant/onboarding', { cookie: ownerCookie });

    assert.equal(guide.status, 200);
    assert.equal(typeof guide.body.progressPercent, 'number');
    assert.ok(guide.body.progressPercent >= 0);
    assert.ok(guide.body.progressPercent <= 100);
    assert.ok(guide.body.total >= 1);
    assert.ok(guide.body.steps.some(step => step.key === 'closures' && step.required === false));
    assert.ok(guide.body.steps.some(step => step.key === 'preview' && step.required === true));
    assert.ok(guide.body.next.label);
});

test('owner status exposes plan capabilities and domain labels', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const status = await request('GET', '/api/restaurant/status', { cookie: ownerCookie });

    assert.equal(status.status, 200);
    assert.equal(status.body.planCapabilities.plan, status.body.plan);
    assert.equal(typeof status.body.planCapabilities.adsEnabled, 'boolean');
    assert.ok(status.body.freeDomainStatusLabel);
    assert.ok(status.body.customDomainStatusLabel);
    assert.ok(status.body.domainAffiliateNote);
});

test('restaurant patch JSON validation allows valid updates and rejects unknown fields', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const token = await csrf(ownerCookie);
    const current = db.prepare(`
        SELECT s.footer_note
        FROM site_configs s
        JOIN restaurants r ON s.restaurant_id = r.id
        JOIN users u ON r.owner_user_id = u.id
        WHERE u.email = ?
    `).get('mario@trattoria-mario.de');
    const currentFooterNote = current?.footer_note || '';

    const validUpdate = await request('PATCH', '/api/restaurant', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token },
        body: { footer_note: currentFooterNote }
    });
    assert.equal(validUpdate.status, 200);

    const invalidUpdate = await request('PATCH', '/api/restaurant', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token },
        body: {
            footer_note: currentFooterNote,
            unsafe_extra_field: '<script>alert(1)</script>'
        }
    });
    assert.equal(invalidUpdate.status, 400);
    assert.equal(invalidUpdate.body.error, 'Invalid request body.');
});

test('admin plan updates are logged for restaurants', async () => {
    const email = `test-plan-${Date.now()}@restiq.local`;
    const ownerRegister = await request('POST', '/api/auth/register', {
        body: {
            email,
            password: 'StrongPass123',
            restaurant_name: 'Plan Test Restaurant',
            plan_choice: 'free',
            domain_choice: 'restiq_free'
        }
    });
    assert.equal(ownerRegister.status, 200);

    const adminCookie = await login('admin@restiq.app', 'admin123');
    const token = await csrf(adminCookie);
    const restaurantId = ownerRegister.body.restaurant.id;

    const update = await request('PATCH', `/api/admin/restaurants/${restaurantId}/plan`, {
        cookie: adminCookie,
        headers: { 'X-CSRF-Token': token },
        body: { current_plan: 'paid' }
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.current_plan, 'paid');

    const log = db.prepare(`
        SELECT old_plan, new_plan
        FROM plan_change_log
        WHERE restaurant_id = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(restaurantId);
    assert.deepEqual(log, { old_plan: 'free', new_plan: 'paid' });
});

test('preview routes return consistent role and missing-data responses', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const adminCookie = await login('admin@restiq.app', 'admin123');

    const ownerPreviewShell = await request('GET', '/preview', { cookie: ownerCookie });
    assert.equal(ownerPreviewShell.status, 200);

    const adminPreviewShell = await request('GET', '/preview', { cookie: adminCookie });
    assert.equal(adminPreviewShell.status, 403);

    const missingAdminPreview = await request('GET', '/api/admin/preview/999999', { cookie: adminCookie });
    assert.equal(missingAdminPreview.status, 404);
});

test('auth rate limit also blocks rotating email attempts from one IP', async () => {
    let last;
    for (let i = 0; i < 25; i += 1) {
        last = await request('POST', '/api/auth/login', {
            headers: { 'X-Forwarded-For': '203.0.113.77' },
            body: { email: `missing-${i}@restiq.local`, password: 'WrongPass123' }
        });
    }

    assert.equal(last.status, 429);
    assert.equal(last.body.error, 'Too many attempts. Please try again later.');
});

test('public, owner and admin pages use stricter script CSP', async () => {
    const index = await request('GET', '/index.html');
    const register = await request('GET', '/register.html');
    const admin = await request('GET', '/admin.html');
    const dashboard = await request('GET', '/dashboard.html');

    assert.equal(index.status, 200);
    assert.equal(register.status, 200);
    assert.equal(admin.status, 200);
    assert.match(index.headers['content-security-policy'], /script-src 'self'(;|$)/);
    assert.doesNotMatch(index.headers['content-security-policy'], /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(register.headers['content-security-policy'], /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(admin.headers['content-security-policy'], /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(dashboard.headers['content-security-policy'], /script-src[^;]*'unsafe-inline'/);
});

test('storage can select R2 driver and issue signed save/delete requests with mocked fetch', async () => {
    const calls = [];
    const r2Storage = storage.createStorage({
        env: {
            RESTIQ_STORAGE_DRIVER: 'r2',
            R2_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com',
            R2_BUCKET: 'restiq-assets',
            R2_ACCESS_KEY_ID: 'test-key',
            R2_SECRET_ACCESS_KEY: 'test-secret',
            R2_PUBLIC_BASE_URL: 'https://assets.example.test'
        },
        now: () => new Date('2026-01-02T03:04:05.000Z'),
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, status: 200, text: async () => '' };
        }
    });

    const saved = await r2Storage.saveRestaurantImage({
        restaurantId: 7,
        fileName: 'menu.png',
        buffer: Buffer.from('image-bytes'),
        contentType: 'image/png'
    });
    assert.equal(saved.url, 'https://assets.example.test/uploads/restaurants/7/menu.png');
    assert.equal(saved.storageKey, 'uploads/restaurants/7/menu.png');
    assert.equal(
        r2Storage.resolveAssetUrl('/uploads/restaurants/7/menu.png'),
        'https://assets.example.test/uploads/restaurants/7/menu.png'
    );

    const deleted = await r2Storage.deleteRestaurantAsset({ restaurantId: 7, url: saved.url });
    assert.equal(deleted, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, 'PUT');
    assert.equal(calls[0].options.headers['content-type'], 'image/png');
    assert.equal(calls[0].options.headers['x-amz-date'], '20260102T030405Z');
    assert.match(calls[0].options.headers.authorization, /Credential=test-key\/20260102\/auto\/s3\/aws4_request/);
    assert.match(calls[0].url, /^https:\/\/example-account\.r2\.cloudflarestorage\.com\/restiq-assets\/uploads\/restaurants\/7\/menu\.png$/);
    assert.equal(calls[1].options.method, 'DELETE');
});

test('image uploads require real allowed image signatures and matching MIME type', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const token = await csrf(ownerCookie);
    const restaurant = await request('GET', '/api/restaurant', { cookie: ownerCookie });
    assert.equal(restaurant.status, 200);
    const originalHeroImage = restaurant.body.config.hero_image_url || '';
    const slug = restaurant.body.public_slug_internal;

    const upload = await request('POST', '/api/uploads/image', {
        cookie: ownerCookie,
        headers: {
            'Content-Type': 'image/png',
            'X-CSRF-Token': token,
            'X-Forwarded-For': '203.0.113.91',
            'X-Upload-Context': 'security-test',
            'X-Upload-Name': 'security-test.png'
        },
        rawBody: ONE_PIXEL_PNG
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.body.mime, 'image/png');
    assert.match(upload.body.url, /^\/uploads\/restaurants\/\d+\/\d+-security-test-[a-f0-9]{16}\.png$/);
    assert.notEqual(upload.body.size, ONE_PIXEL_PNG.length);

    const storedImagePath = path.join(__dirname, '..', 'public', upload.body.url.replace(/^\/+/, ''));
    const storedImage = fs.readFileSync(storedImagePath);
    assert.equal(storedImage.length, upload.body.size);
    assert.notDeepEqual(storedImage, ONE_PIXEL_PNG);

    const activeMetadata = db.prepare(`
        SELECT asset_kind, owner_type, owner_id, storage_key, url, mime_type, size_bytes, is_active
        FROM media_assets
        WHERE id = ?
    `).get(upload.body.id);
    assert.equal(activeMetadata.asset_kind, 'restaurant_image');
    assert.equal(activeMetadata.owner_type, 'restaurant');
    assert.equal(activeMetadata.owner_id, restaurant.body.id);
    assert.equal(activeMetadata.storage_key, upload.body.url.replace(/^\/+/, ''));
    assert.equal(activeMetadata.url, upload.body.url);
    assert.equal(activeMetadata.mime_type, 'image/png');
    assert.equal(activeMetadata.size_bytes, storedImage.length);
    assert.equal(activeMetadata.is_active, 1);

    const menu = await request('GET', '/api/menu', { cookie: ownerCookie });
    assert.equal(menu.status, 200);
    const category = await request('POST', '/api/menu/categories', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token },
        body: {
            menu_id: menu.body.id,
            category_name: `Asset Test ${Date.now()}`,
            image_url: upload.body.url
        }
    });
    assert.equal(category.status, 200);

    const categoryMetadata = db.prepare('SELECT owner_type, owner_id FROM media_assets WHERE id = ?').get(upload.body.id);
    assert.equal(categoryMetadata.owner_type, 'category');
    assert.equal(categoryMetadata.owner_id, category.body.id);

    const dish = await request('POST', '/api/dishes', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token },
        body: {
            category_id: category.body.id,
            dish_name: `Asset Dish ${Date.now()}`,
            price_cents: 1299,
            image_url: upload.body.url
        }
    });
    assert.equal(dish.status, 200);

    const dishMetadata = db.prepare('SELECT owner_type, owner_id FROM media_assets WHERE id = ?').get(upload.body.id);
    assert.equal(dishMetadata.owner_type, 'dish');
    assert.equal(dishMetadata.owner_id, dish.body.id);

    const removeDish = await request('DELETE', `/api/dishes/${dish.body.id}`, {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token }
    });
    assert.equal(removeDish.status, 200);

    const removeCategory = await request('DELETE', `/api/menu/categories/${category.body.id}`, {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token }
    });
    assert.equal(removeCategory.status, 200);

    const setHeroImage = await request('PATCH', '/api/restaurant', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token },
        body: { hero_image_url: upload.body.url }
    });
    assert.equal(setHeroImage.status, 200);
    const restaurantMetadata = db.prepare('SELECT owner_type, owner_id FROM media_assets WHERE id = ?').get(upload.body.id);
    assert.equal(restaurantMetadata.owner_type, 'restaurant');
    assert.equal(restaurantMetadata.owner_id, restaurant.body.id);

    const preview = await request('GET', '/api/preview', { cookie: ownerCookie });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.siteConfig.hero.imageUrl, upload.body.url);

    const prepare = await request('POST', '/api/restaurant/cf-prepare', {
        cookie: ownerCookie,
        headers: {
            'X-CSRF-Token': token,
            'X-Forwarded-For': '203.0.113.91'
        }
    });
    assert.equal(prepare.status, 200);

    const exportedDataPath = path.join(__dirname, '..', 'publish', slug, 'data.json');
    const exportedData = JSON.parse(fs.readFileSync(exportedDataPath, 'utf8'));
    assert.equal(exportedData.siteConfig.hero.imageUrl, upload.body.url);

    const cfExportedDataPath = path.join(__dirname, '..', 'cloudflare-export', slug, 'data.json');
    const cfExportedData = JSON.parse(fs.readFileSync(cfExportedDataPath, 'utf8'));
    assert.equal(cfExportedData.siteConfig.hero.imageUrl, upload.body.url);

    const restoreHeroImage = await request('PATCH', '/api/restaurant', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token },
        body: { hero_image_url: originalHeroImage }
    });
    assert.equal(restoreHeroImage.status, 200);

    const removeUpload = await request('DELETE', `/api/media-assets/${upload.body.id}`, {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token }
    });
    assert.equal(removeUpload.status, 200);
    const inactiveMetadata = db.prepare('SELECT storage_key, is_active FROM media_assets WHERE id = ?').get(upload.body.id);
    assert.equal(inactiveMetadata.storage_key, activeMetadata.storage_key);
    assert.equal(inactiveMetadata.is_active, 0);

    const fakeExe = await request('POST', '/api/uploads/image', {
        cookie: ownerCookie,
        headers: {
            'Content-Type': 'image/png',
            'X-CSRF-Token': token,
            'X-Forwarded-For': '203.0.113.91',
            'X-Upload-Context': 'security-test',
            'X-Upload-Name': 'fake-menu.png'
        },
        rawBody: Buffer.from('4d5a90000300000004000000ffff0000', 'hex')
    });
    assert.equal(fakeExe.status, 400);
    assert.equal(fakeExe.body.error, 'Only JPEG, PNG, WebP or GIF images are allowed.');

    const mismatchedMime = await request('POST', '/api/uploads/image', {
        cookie: ownerCookie,
        headers: {
            'Content-Type': 'image/jpeg',
            'X-CSRF-Token': token,
            'X-Forwarded-For': '203.0.113.91',
            'X-Upload-Context': 'security-test',
            'X-Upload-Name': 'mismatch.jpg'
        },
        rawBody: ONE_PIXEL_PNG
    });
    assert.equal(mismatchedMime.status, 400);
    assert.equal(mismatchedMime.body.error, 'Only JPEG, PNG, WebP or GIF images are allowed.');
});

test('expensive owner actions allow normal use and rate limit repeated requests', async () => {
    const ownerCookie = await login('mario@trattoria-mario.de', 'owner123');
    const token = await csrf(ownerCookie);

    const upload = await request('POST', '/api/uploads/image', {
        cookie: ownerCookie,
        headers: {
            'Content-Type': 'image/png',
            'X-CSRF-Token': token,
            'X-Upload-Context': 'rate-test',
            'X-Upload-Name': 'rate-test.png'
        },
        rawBody: ONE_PIXEL_PNG
    });
    assert.equal(upload.status, 200);
    assert.ok(upload.body.id);

    const removeUpload = await request('DELETE', `/api/media-assets/${upload.body.id}`, {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token }
    });
    assert.equal(removeUpload.status, 200);

    const firstPrepare = await request('POST', '/api/restaurant/cf-prepare', {
        cookie: ownerCookie,
        headers: { 'X-CSRF-Token': token }
    });
    assert.equal(firstPrepare.status, 200);

    let lastPrepare;
    for (let i = 0; i < 5; i += 1) {
        lastPrepare = await request('POST', '/api/restaurant/cf-prepare', {
            cookie: ownerCookie,
            headers: { 'X-CSRF-Token': token }
        });
    }

    assert.equal(lastPrepare.status, 429);
    assert.equal(lastPrepare.body.error, 'Too many attempts. Please try again later.');
});
