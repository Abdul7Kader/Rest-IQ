const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const db = require('../lib/db');

const PORT = 3555;
const BASE = `http://localhost:${PORT}`;
let serverProcess;

function request(method, path, { cookie, body, headers } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = http.request(`${BASE}${path}`, {
            method,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
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
        env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-session-secret' },
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
