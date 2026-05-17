require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./lib/db');
const { hashPassword, verifyPassword, isAuthenticated, hasRole } = require('./lib/auth');
const SQLiteSessionStore = require('./lib/session-store');

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_NAME = 'restiq.sid';
const SESSION_SECRET = process.env.SESSION_SECRET || 'restiq-fallback-secret';
const IMAGE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CSRF_EXEMPT_PATHS = new Set(['/api/auth/login', '/api/auth/register']);
const PLATFORM_SETTING_KEYS = new Set([
    'support_email',
    'default_ad_label',
    'domain_affiliate_note',
    'quality_review_required'
]);

if (isProduction && SESSION_SECRET === 'restiq-fallback-secret') {
    throw new Error('SESSION_SECRET must be set in production.');
}

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}

app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https: data:",
            "connect-src 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'"
        ].join('; ')
    );
    next();
});
app.use(express.static('public'));

// Session setup
app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    store: new SQLiteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAcceptablePassword(password) {
    return (
        typeof password === 'string' &&
        password.length >= 8 &&
        password.length <= 128 &&
        /[A-Za-z]/.test(password) &&
        /\d/.test(password)
    );
}

function createRateLimiter({ windowMs, max }) {
    const attempts = new Map();

    return (req, res, next) => {
        const key = `${req.ip}:${normalizeEmail(req.body && req.body.email)}`;
        const now = Date.now();
        const current = attempts.get(key);
        const entry = current && current.resetAt > now
            ? current
            : { count: 0, resetAt: now + windowMs };

        entry.count += 1;
        attempts.set(key, entry);

        if (entry.count > max) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        }

        next();
    };
}

function establishSession(req, user) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);
            req.session.userId = user.id;
            req.session.role = user.role;
            req.session.email = user.email;
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            resolve();
        });
    });
}

const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });

function ensureCsrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

    const expected = req.session && req.session.csrfToken;
    const actual = req.get('x-csrf-token');
    if (!expected || !actual || actual !== expected) {
        return res.status(403).json({ error: 'Invalid CSRF token.' });
    }

    next();
}

app.use(csrfProtection);

function trimText(value, maxLength = 500) {
    return String(value || '').trim().slice(0, maxLength);
}

function normalizeNullableText(value, maxLength = 500) {
    const text = trimText(value, maxLength);
    return text || null;
}

function normalizeHttpUrl(value) {
    const url = trimText(value, 1000);
    if (!url) return null;

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('INVALID_URL_PROTOCOL');
        }
        return parsed.href;
    } catch (error) {
        throw new Error('INVALID_URL');
    }
}

function normalizeImageUrl(value) {
    const url = trimText(value, 1000);
    if (!url) return null;

    if (url.startsWith('/uploads/restaurants/')) {
        if (!/^\/uploads\/restaurants\/\d+\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(url)) {
            throw new Error('INVALID_IMAGE_URL');
        }
        return url;
    }

    return normalizeHttpUrl(url);
}

function normalizeCssColor(value) {
    const color = trimText(value, 20);
    if (!color) return null;
    if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) {
        throw new Error('INVALID_COLOR');
    }
    return color;
}

function normalizeTemplateKey(value) {
    const template = trimText(value, 50) || 'free_default';
    if (!['free_default', 'free_classic'].includes(template)) {
        throw new Error('INVALID_TEMPLATE');
    }
    return template;
}

function normalizeTime(value) {
    const time = trimText(value, 5);
    if (!time) return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        throw new Error('INVALID_TIME');
    }
    return time;
}

function normalizeDate(value) {
    const date = trimText(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('INVALID_DATE');
    }

    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('INVALID_DATE');
    }
    return date;
}

function normalizeInteger(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    if (!Number.isInteger(number)) throw new Error('INVALID_INTEGER');
    return number;
}

function normalizeIdList(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
        throw new Error('INVALID_ORDER');
    }
    const ids = value.map(item => normalizeInteger(item));
    if (ids.some(id => id <= 0) || new Set(ids).size !== ids.length) {
        throw new Error('INVALID_ORDER');
    }
    return ids;
}

function normalizePriceCents(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 999999) {
        throw new Error('INVALID_PRICE');
    }
    return number;
}

function normalizeDisplayMode(value) {
    const mode = trimText(value, 20) || 'vertical';
    if (!['vertical', 'horizontal'].includes(mode)) {
        throw new Error('INVALID_DISPLAY_MODE');
    }
    return mode;
}

function normalizeCategoryLayoutMode(value) {
    const layout = trimText(value, 30) || 'inherit';
    if (!['inherit', 'list', 'cards', 'compact'].includes(layout)) {
        throw new Error('INVALID_CATEGORY_LAYOUT');
    }
    return layout;
}

function normalizeFontFamily(value) {
    const font = trimText(value, 30) || 'system';
    if (!['system', 'serif', 'rounded'].includes(font)) {
        throw new Error('INVALID_FONT_FAMILY');
    }
    return font;
}

function normalizeHeadingStyle(value) {
    const style = trimText(value, 30) || 'clean';
    if (!['clean', 'editorial', 'uppercase'].includes(style)) {
        throw new Error('INVALID_HEADING_STYLE');
    }
    return style;
}

function normalizeMenuLayout(value) {
    const layout = trimText(value, 30) || 'list';
    if (!['list', 'cards', 'compact'].includes(layout)) {
        throw new Error('INVALID_MENU_LAYOUT');
    }
    return layout;
}

function normalizeDishImageStyle(value) {
    const style = trimText(value, 30) || 'rounded';
    if (!['rounded', 'circle', 'square'].includes(style)) {
        throw new Error('INVALID_DISH_IMAGE_STYLE');
    }
    return style;
}

function normalizeBooleanFlag(value) {
    return value === false || value === 0 || value === '0' || value === 'false' ? 0 : 1;
}

function normalizePlan(value) {
    const plan = trimText(value, 20) || 'free';
    if (!['free', 'paid'].includes(plan)) {
        throw new Error('INVALID_PLAN');
    }
    return plan;
}

function normalizeDomainChoice(value) {
    const choice = trimText(value, 40) || 'restiq_free';
    if (!['restiq_free', 'buy_external', 'own_domain'].includes(choice)) {
        throw new Error('INVALID_DOMAIN_CHOICE');
    }
    return choice;
}

function normalizeProviderType(value) {
    const type = trimText(value, 30) || 'registrar';
    if (!['registrar', 'free_hosting', 'both'].includes(type)) {
        throw new Error('INVALID_PROVIDER_TYPE');
    }
    return type;
}

function normalizeDomainStatus(value) {
    const status = trimText(value, 30);
    if (!['pending', 'active', 'failed', 'disabled'].includes(status)) {
        throw new Error('INVALID_DOMAIN_STATUS');
    }
    return status;
}

function normalizePublishStatus(value) {
    const status = trimText(value, 30);
    if (!['queued', 'running', 'success', 'error'].includes(status)) {
        throw new Error('INVALID_PUBLISH_STATUS');
    }
    return status;
}

function normalizeAdPlacement(value) {
    const placement = trimText(value, 30) || 'menu';
    if (!['hero', 'menu', 'sidebar', 'footer'].includes(placement)) {
        throw new Error('INVALID_AD_PLACEMENT');
    }
    return placement;
}

function normalizeSettingKey(value) {
    const key = trimText(value, 80);
    if (!PLATFORM_SETTING_KEYS.has(key)) {
        throw new Error('INVALID_SETTING_KEY');
    }
    return key;
}

function normalizeHostname(value) {
    let hostname = trimText(value, 253)
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');

    if (!hostname) return null;
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
        throw new Error('INVALID_HOSTNAME');
    }
    return hostname;
}

function detectImageMime(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
        buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ) return 'image/png';
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    return null;
}

function imageExtension(mime) {
    return {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    }[mime];
}

function getOwnerRestaurant(userId) {
    return db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(userId);
}

function getPlanCapabilities(plan) {
    const isPaid = plan === 'paid';
    return {
        plan,
        adsEnabled: !isPaid,
        donationHintEnabled: !isPaid,
        customDomainAllowed: true,
        paidFeatureAccess: isPaid,
        availableTemplates: isPaid
            ? ['free_default', 'free_classic']
            : ['free_default', 'free_classic'],
        summary: isPaid
            ? 'Werbefreier Auftritt ist fachlich aktiviert. Zahlung und automatische Domainprüfung folgen später.'
            : 'Kostenloser Auftritt mit RestIQ-Hinweis, Werbeplätzen und Spendenhinweis.'
    };
}

function getDomainStatusLabel(status) {
    return {
        not_prepared: 'Nicht vorbereitet',
        not_configured: 'Nicht eingerichtet',
        pending: 'Prüfung ausstehend',
        active: 'Aktiv',
        failed: 'Fehler',
        disabled: 'Deaktiviert'
    }[status] || 'Unklar';
}

function sendValidationError(res, error) {
    const messages = {
        INVALID_URL: 'Only valid http/https URLs are allowed.',
        INVALID_URL_PROTOCOL: 'Only http/https URLs are allowed.',
        INVALID_COLOR: 'Invalid color value.',
        INVALID_TEMPLATE: 'Invalid template selection.',
        INVALID_TIME: 'Invalid time format. Use HH:MM.',
        INVALID_DATE: 'Invalid date format. Use YYYY-MM-DD.',
        INVALID_DATE_RANGE: 'End date must be on or after start date.',
        INVALID_INTEGER: 'Invalid numeric value.',
        INVALID_ORDER: 'Invalid sort order.',
        INVALID_PRICE: 'Invalid price.',
        INVALID_DISPLAY_MODE: 'Invalid display mode.',
        INVALID_CATEGORY_LAYOUT: 'Invalid category layout.',
        INVALID_FONT_FAMILY: 'Invalid font selection.',
        INVALID_HEADING_STYLE: 'Invalid heading style.',
        INVALID_MENU_LAYOUT: 'Invalid menu layout.',
        INVALID_DISH_IMAGE_STYLE: 'Invalid image style.',
        INVALID_IMAGE_URL: 'Invalid image URL.',
        INVALID_IMAGE_TYPE: 'Only JPEG, PNG, WebP or GIF images are allowed.',
        IMAGE_TOO_LARGE: 'Image is too large. Maximum size is 4 MB.',
        REQUIRED_TITLE: 'Title is required.',
        REQUIRED_NAME: 'Name is required.',
        REQUIRED_PRICE: 'Price is required.',
        INVALID_PLAN: 'Invalid plan selection.',
        INVALID_DOMAIN_CHOICE: 'Invalid domain option.',
        INVALID_HOSTNAME: 'Invalid domain name.',
        INVALID_PROVIDER_TYPE: 'Invalid provider type.',
        INVALID_DOMAIN_STATUS: 'Invalid domain status.',
        INVALID_PUBLISH_STATUS: 'Invalid deploy status.',
        INVALID_AD_PLACEMENT: 'Invalid ad placement.',
        INVALID_SETTING_KEY: 'Invalid platform setting.'
    };
    return res.status(400).json({ error: messages[error.message] || 'Invalid input.' });
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'restaurant';
}

function createUniqueRestaurantSlug(name) {
    const base = slugify(name);
    let slug = base;
    let counter = 2;

    while (db.prepare('SELECT id FROM restaurants WHERE public_slug_internal = ?').get(slug)) {
        slug = `${base}-${counter}`;
        counter += 1;
    }

    return slug;
}

function createRestaurantForOwner(ownerUserId, payload) {
    const existing = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(ownerUserId);
    if (existing) {
        throw new Error('OWNER_ALREADY_HAS_RESTAURANT');
    }

    const restaurantName = String(payload.restaurant_name || '').trim();
    if (!restaurantName) {
        throw new Error('RESTAURANT_NAME_REQUIRED');
    }

    const contactEmail = String(payload.contact_email || payload.email || '').trim();
    const slug = createUniqueRestaurantSlug(restaurantName);
    const plan = normalizePlan(payload.plan_choice || payload.current_plan);
    const domainChoice = normalizeDomainChoice(payload.domain_choice);
    const customHostname = normalizeHostname(payload.custom_domain);
    if (domainChoice === 'own_domain' && !customHostname) {
        throw new Error('CUSTOM_DOMAIN_REQUIRED');
    }

    const info = db.prepare(`
        INSERT INTO restaurants (
            owner_user_id, restaurant_name, public_slug_internal, short_description,
            contact_email, contact_phone, street, house_number, postal_code, city
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        ownerUserId,
        restaurantName,
        slug,
        String(payload.short_description || '').trim(),
        contactEmail,
        String(payload.contact_phone || '').trim(),
        String(payload.street || '').trim(),
        String(payload.house_number || '').trim(),
        String(payload.postal_code || '').trim(),
        String(payload.city || '').trim()
    );

    const restaurantId = info.lastInsertRowid;
    db.prepare(`
        INSERT INTO site_configs (
            restaurant_id, current_plan, template_key, ads_enabled, donation_hint_enabled,
            hero_title, hero_subtitle
        )
        VALUES (?, ?, 'free_default', ?, ?, ?, ?)
    `).run(
        restaurantId,
        plan,
        plan === 'free' ? 1 : 0,
        plan === 'free' ? 1 : 0,
        restaurantName,
        String(payload.short_description || '').trim()
    );
    db.prepare('INSERT INTO menus (restaurant_id, title) VALUES (?, ?)').run(restaurantId, 'Speisekarte');
    db.prepare(`
        INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status)
        VALUES (?, ?, 'free_generated', ?, 'pending')
    `).run(restaurantId, `${slug}-restiq.pages.dev`, customHostname ? 0 : 1);

    if (customHostname) {
        db.prepare(`
            INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status)
            VALUES (?, ?, 'custom', 1, 'pending')
        `).run(restaurantId, customHostname);
    }

    return { id: restaurantId, slug, plan, domainChoice, customHostname };
}

const DEFAULT_HELP_ARTICLES = [
    {
        article_type: 'tutorial',
        title: 'Schnellstart: Von Grunddaten bis Veröffentlichung',
        slug: 'schnellstart-veroeffentlichung',
        sort_order: 0,
        content_markdown: [
            '# Schnellstart',
            'Dieser Ablauf bringt Ihre kostenlose Restaurantseite in eine testbare Veröffentlichung.',
            '',
            '1. Prüfen Sie im Bereich Grunddaten Name, Beschreibung, Kontakt und Adresse.',
            '2. Tragen Sie im Bereich Öffnungszeiten die regulären Zeiten ein.',
            '3. Legen Sie in der Speisekarte Kategorien und Gerichte an.',
            '4. Passen Sie unter Design & Hero die Überschrift, Farbe und Bilder an.',
            '5. Öffnen Sie die Vorschau und prüfen Sie die Seite.',
            '6. Bereiten Sie die Online-Veröffentlichung vor, sobald der Deploy-Flow freigeschaltet ist.',
            '',
            'Die echte Online-Veröffentlichung wird später über den Restiq-Deploy-Flow gesteuert.'
        ].join('\n')
    },
    {
        article_type: 'help',
        title: 'Was bedeutet Vorschau und Cloudflare?',
        slug: 'preview-cloudflare',
        sort_order: 1,
        content_markdown: [
            '# Vorschau und Cloudflare',
            'Die Vorschau zeigt die aktuelle interne Darstellung im Dashboard. Sie ist nur für angemeldete Nutzer gedacht.',
            '',
            'Cloudflare vorbereiten ist ein technischer Zwischenschritt für die spätere Online-Veröffentlichung. Dieser Schritt verbindet noch keine echte Domain automatisch.'
        ].join('\n')
    },
    {
        article_type: 'tutorial',
        title: 'Speisekarte sinnvoll strukturieren',
        slug: 'speisekarte-strukturieren',
        sort_order: 2,
        content_markdown: [
            '# Speisekarte strukturieren',
            'Arbeiten Sie zuerst mit wenigen klaren Kategorien, zum Beispiel Vorspeisen, Pizza, Pasta, Getränke.',
            '',
            'Für jedes Gericht sollten Name, Preis und Beschreibung gepflegt sein. Zutaten und Allergene sind eigene Felder, damit sie später besser dargestellt oder gefiltert werden können.',
            '',
            'Nutzen Sie Bilder nur, wenn sie wirklich zum Gericht passen. Restaurantbilder werden im Owner-Admin hochgeladen und in der Mediathek verwaltet.'
        ].join('\n')
    },
    {
        article_type: 'faq',
        title: 'Was ist in der kostenlosen Stufe enthalten?',
        slug: 'kostenlose-stufe',
        sort_order: 3,
        content_markdown: [
            '# Kostenlose Stufe',
            'Die kostenlose Stufe enthält eine selbst konfigurierte Restaurantseite mit Restiq-Branding, Werbeplatzhaltern und Spendenhinweis.',
            '',
            'Nicht enthalten sind eine eigene Kundendomain, werbefreie Darstellung, individuelle Designentwicklung, inhaltliche Pflege durch Restiq oder Domain-Support.'
        ].join('\n')
    }
];

function ensureDefaultHelpArticles() {
    const upsert = db.prepare(`
        INSERT INTO help_articles (article_type, title, slug, content_markdown, sort_order, is_published)
        VALUES (@article_type, @title, @slug, @content_markdown, @sort_order, 1)
        ON CONFLICT(slug) DO UPDATE SET
            article_type = excluded.article_type,
            title = excluded.title,
            content_markdown = excluded.content_markdown,
            sort_order = excluded.sort_order,
            is_published = 1,
            updated_at = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction(() => {
        db.prepare("DELETE FROM help_articles WHERE slug IN ('erste-schritte', 'menue-bearbeiten', 'preview-published-cloudflare')").run();
        for (const article of DEFAULT_HELP_ARTICLES) {
            upsert.run(article);
        }
    });
    transaction();
}

function ensureDefaultDomainProviders() {
    const upsert = db.prepare(`
        INSERT INTO domain_providers (
            provider_name, provider_type, website_url, affiliate_base_url,
            supports_free_domains, supports_paid_domains, is_active, sort_order
        )
        VALUES (@provider_name, @provider_type, @website_url, @affiliate_base_url,
            @supports_free_domains, @supports_paid_domains, 1, @sort_order)
        ON CONFLICT(provider_name) DO UPDATE SET
            provider_type = excluded.provider_type,
            website_url = excluded.website_url,
            affiliate_base_url = excluded.affiliate_base_url,
            supports_free_domains = excluded.supports_free_domains,
            supports_paid_domains = excluded.supports_paid_domains,
            is_active = 1,
            sort_order = excluded.sort_order,
            updated_at = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction(() => {
        upsert.run({
            provider_name: 'Cloudflare',
            provider_type: 'free_hosting',
            website_url: 'https://cloudflare.com',
            affiliate_base_url: null,
            supports_free_domains: 1,
            supports_paid_domains: 0,
            sort_order: 0
        });
        upsert.run({
            provider_name: 'Namecheap',
            provider_type: 'registrar',
            website_url: 'https://namecheap.com',
            affiliate_base_url: 'https://namecheap.com?aff=restiq',
            supports_free_domains: 0,
            supports_paid_domains: 1,
            sort_order: 10
        });
    });
    transaction();
}

function ensureDefaultPlatformSettings() {
    const upsert = db.prepare(`
        INSERT INTO platform_settings (setting_key, setting_value, updated_by_user_id)
        VALUES (?, ?, NULL)
        ON CONFLICT(setting_key) DO NOTHING
    `);

    const transaction = db.transaction(() => {
        upsert.run('support_email', 'support@restiq.app');
        upsert.run('default_ad_label', 'Werbeplatz');
        upsert.run('domain_affiliate_note', 'Domainkauf erfolgt extern über einen Partner-Link. Die DNS-Prüfung folgt später.');
        upsert.run('quality_review_required', '1');
    });
    transaction();
}

function ensureDefaultAdSlots() {
    const upsert = db.prepare(`
        INSERT INTO ad_slots (slot_key, label, placement, provider_name, placeholder_text, is_active)
        VALUES (@slot_key, @label, @placement, @provider_name, @placeholder_text, @is_active)
        ON CONFLICT(slot_key) DO NOTHING
    `);

    const transaction = db.transaction(() => {
        upsert.run({
            slot_key: 'free_menu_top',
            label: 'Free Menü oben',
            placement: 'menu',
            provider_name: 'manual',
            placeholder_text: 'Werbeplatz für lokale Angebote',
            is_active: 1
        });
        upsert.run({
            slot_key: 'free_footer',
            label: 'Free Footer',
            placement: 'footer',
            provider_name: 'manual',
            placeholder_text: 'RestIQ unterstützt lokale Restaurants',
            is_active: 1
        });
    });
    transaction();
}

function ensureApplicationTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS special_closures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            note TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_special_closures_restaurant_id ON special_closures(restaurant_id);
        CREATE INDEX IF NOT EXISTS idx_special_closures_dates ON special_closures(start_date, end_date);
        CREATE TABLE IF NOT EXISTS media_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER NOT NULL,
            url TEXT NOT NULL UNIQUE,
            original_name TEXT,
            context TEXT NOT NULL DEFAULT 'image',
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_media_assets_restaurant_id ON media_assets(restaurant_id);
        CREATE INDEX IF NOT EXISTS idx_media_assets_active ON media_assets(is_active, created_at);
        CREATE TABLE IF NOT EXISTS domain_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_name TEXT UNIQUE NOT NULL,
            provider_type TEXT NOT NULL CHECK(provider_type IN ('registrar', 'free_hosting', 'both')),
            website_url TEXT NOT NULL,
            affiliate_base_url TEXT,
            supports_free_domains INTEGER NOT NULL DEFAULT 0,
            supports_paid_domains INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS platform_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT,
            updated_by_user_id INTEGER,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS ad_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_key TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            placement TEXT NOT NULL CHECK(placement IN ('hero', 'menu', 'sidebar', 'footer')),
            provider_name TEXT,
            placeholder_text TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ad_slots_active ON ad_slots(is_active, placement);
    `);

    const addColumnIfMissing = (tableName, columnName, definition) => {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name);
        if (!columns.includes(columnName)) {
            db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
    };

    addColumnIfMissing('menu_categories', 'image_url', 'TEXT');
    addColumnIfMissing('menu_categories', 'layout_mode', "TEXT NOT NULL DEFAULT 'inherit'");
    addColumnIfMissing('site_configs', 'font_family', "TEXT NOT NULL DEFAULT 'system'");
    addColumnIfMissing('site_configs', 'heading_style', "TEXT NOT NULL DEFAULT 'clean'");
    addColumnIfMissing('site_configs', 'menu_layout', "TEXT NOT NULL DEFAULT 'list'");
    addColumnIfMissing('site_configs', 'dish_image_style', "TEXT NOT NULL DEFAULT 'rounded'");
}

// --- Auth Routes ---

app.post('/api/auth/register', authRateLimit, async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const { password } = body;

    if (!isValidEmail(email) || !isAcceptablePassword(password)) {
        return res.status(400).json({ error: 'Invalid email or password. Password must be 8-128 characters and include letters and numbers.' });
    }

    try {
        const hash = await hashPassword(password);
        const result = db.transaction(() => {
            const stmt = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)');
            const userInfo = stmt.run(email, hash, 'restaurant_owner');
            const restaurant = createRestaurantForOwner(userInfo.lastInsertRowid, { ...body, email });
            return { userId: userInfo.lastInsertRowid, restaurant };
        })();

        await establishSession(req, { id: result.userId, role: 'restaurant_owner', email });

        res.json({
            success: true,
            user: { email, role: 'restaurant_owner' },
            restaurant: result.restaurant
        });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed: users.email')) {
            return res.status(400).json({ error: 'Email already registered.' });
        }
        if (error.message === 'RESTAURANT_NAME_REQUIRED') {
            return res.status(400).json({ error: 'Restaurant name is required.' });
        }
        if (error.message === 'CUSTOM_DOMAIN_REQUIRED') {
            return res.status(400).json({ error: 'Custom domain is required for this domain option.' });
        }
        if (['INVALID_PLAN', 'INVALID_DOMAIN_CHOICE', 'INVALID_HOSTNAME'].includes(error.message)) {
            return sendValidationError(res, error);
        }
        res.status(500).json({ error: 'Registration failed.' });
    }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const { password } = body;

    if (!isValidEmail(email) || !password || password.length > 128) {
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
        }

        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        await establishSession(req, { id: user.id, role: user.role, email: user.email });

        res.json({ success: true, user: { email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie(SESSION_COOKIE_NAME);
        res.json({ success: true });
    });
});

app.get('/api/auth/me', (req, res) => {
    if (req.session.userId) {
        res.json({ userId: req.session.userId, email: req.session.email, role: req.session.role });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

app.get('/api/auth/csrf', isAuthenticated, (req, res) => {
    res.json({ csrfToken: ensureCsrfToken(req) });
});

app.get('/api/public/domain-providers', (req, res) => {
    const providers = db.prepare(`
        SELECT provider_name, provider_type, website_url, affiliate_base_url,
               supports_free_domains, supports_paid_domains
        FROM domain_providers
        WHERE is_active = 1
        ORDER BY sort_order ASC, provider_name ASC
    `).all();

    res.json(providers);
});

// --- Restaurant Routes (Expanded) ---

app.get('/api/restaurant', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.*, s.current_plan, s.template_key, s.ads_enabled, s.donation_hint_enabled,
               s.is_published, s.primary_language, s.accent_color, s.hero_title,
               s.hero_subtitle, s.about_text, s.logo_image_url, s.hero_image_url,
               s.footer_note, s.seo_title, s.seo_description, s.font_family,
               s.heading_style, s.menu_layout, s.dish_image_style
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
        WHERE r.owner_user_id = ?
    `).get(req.session.userId);

    if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    restaurant.config = {
        current_plan: restaurant.current_plan,
        template_key: restaurant.template_key,
        ads_enabled: restaurant.ads_enabled,
        donation_hint_enabled: restaurant.donation_hint_enabled,
        is_published: restaurant.is_published,
        primary_language: restaurant.primary_language,
        accent_color: restaurant.accent_color,
        hero_title: restaurant.hero_title,
        hero_subtitle: restaurant.hero_subtitle,
        about_text: restaurant.about_text,
        logo_image_url: restaurant.logo_image_url,
        hero_image_url: restaurant.hero_image_url,
        footer_note: restaurant.footer_note,
        seo_title: restaurant.seo_title,
        seo_description: restaurant.seo_description,
        font_family: restaurant.font_family,
        heading_style: restaurant.heading_style,
        menu_layout: restaurant.menu_layout,
        dish_image_style: restaurant.dish_image_style
    };

    res.json(restaurant);
});

app.post('/api/restaurant/setup', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    try {
        const restaurant = db.transaction(() => createRestaurantForOwner(req.session.userId, {
            ...req.body,
            email: req.session.email
        }))();

        res.json({ success: true, restaurant });
    } catch (error) {
        if (error.message === 'OWNER_ALREADY_HAS_RESTAURANT') {
            return res.status(400).json({ error: 'This account already has a restaurant.' });
        }
        if (error.message === 'RESTAURANT_NAME_REQUIRED') {
            return res.status(400).json({ error: 'Restaurant name is required.' });
        }
        if (error.message === 'CUSTOM_DOMAIN_REQUIRED') {
            return res.status(400).json({ error: 'Custom domain is required for this domain option.' });
        }
        if (['INVALID_PLAN', 'INVALID_DOMAIN_CHOICE', 'INVALID_HOSTNAME'].includes(error.message)) {
            return sendValidationError(res, error);
        }
        res.status(500).json({ error: 'Restaurant setup failed.' });
    }
});

app.get('/api/restaurant/status', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.id, r.restaurant_name, r.public_slug_internal, s.current_plan,
               s.is_published, s.template_key, d.hostname as free_hostname,
               d.status as free_domain_status, pe.status as last_publish_status,
               pe.created_at as last_publish_at, pe.message as last_publish_message
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
        LEFT JOIN site_domains d ON d.id = (
            SELECT id FROM site_domains
            WHERE restaurant_id = r.id AND domain_type = 'free_generated'
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        )
        LEFT JOIN publish_events pe ON pe.id = (
            SELECT id FROM publish_events
            WHERE restaurant_id = r.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        )
        WHERE r.owner_user_id = ?
    `).get(req.session.userId);

    if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    const expectedFreeHostname = `${restaurant.public_slug_internal}-restiq.pages.dev`;
    const customDomain = db.prepare(`
        SELECT hostname, status, is_primary
        FROM site_domains
        WHERE restaurant_id = ? AND domain_type = 'custom'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
    `).get(restaurant.id);
    const registrar = db.prepare(`
        SELECT provider_name, website_url, affiliate_base_url
        FROM domain_providers
        WHERE is_active = 1 AND supports_paid_domains = 1
        ORDER BY sort_order ASC, id ASC
        LIMIT 1
    `).get();
    const domainAffiliateNote = db.prepare(`
        SELECT setting_value
        FROM platform_settings
        WHERE setting_key = 'domain_affiliate_note'
    `).get();
    let nextStep = 'Vorschau pruefen';
    if (restaurant.free_domain_status !== 'pending' && restaurant.free_domain_status !== 'active') {
        nextStep = 'Cloudflare-Export vorbereiten';
    } else if (restaurant.free_domain_status === 'pending') {
        nextStep = 'Manuellen Cloudflare-Upload pruefen';
    } else if (restaurant.free_domain_status === 'active') {
        nextStep = 'Live-Seite pruefen';
    }
    const pageStatusKey = restaurant.last_publish_status === 'error'
        ? 'error'
        : (restaurant.free_domain_status === 'active'
            ? 'online'
            : (restaurant.last_publish_status === 'success' || restaurant.free_domain_status === 'pending' ? 'export_prepared' : 'draft'));
    const pageStatusLabel = {
        draft: 'Entwurf',
        ready: 'Bereit zur Veröffentlichung',
        export_prepared: 'Export vorbereitet',
        online: 'Online',
        error: 'Fehler'
    }[pageStatusKey];

    res.json({
        restaurantId: restaurant.id,
        restaurantName: restaurant.restaurant_name,
        slug: restaurant.public_slug_internal,
        plan: restaurant.current_plan,
        planCapabilities: getPlanCapabilities(restaurant.current_plan),
        template: restaurant.template_key,
        pageStatus: pageStatusKey,
        pageStatusLabel,
        expectedFreeHostname,
        freeHostname: restaurant.free_hostname || expectedFreeHostname,
        freeDomainStatus: restaurant.free_domain_status || 'not_prepared',
        freeDomainStatusLabel: getDomainStatusLabel(restaurant.free_domain_status || 'not_prepared'),
        customDomain: customDomain ? customDomain.hostname : null,
        customDomainStatus: customDomain ? customDomain.status : 'not_configured',
        customDomainStatusLabel: getDomainStatusLabel(customDomain ? customDomain.status : 'not_configured'),
        domainVerification: customDomain ? {
            method: 'dns_txt',
            status: customDomain.status,
            statusLabel: getDomainStatusLabel(customDomain.status),
            instruction: 'DNS-Verifikation wird später über Cloudflare automatisiert. Bis dahin bleibt die eigene Domain im Status Prüfung ausstehend.'
        } : null,
        domainProvider: registrar || null,
        domainAffiliateNote: domainAffiliateNote ? domainAffiliateNote.setting_value : null,
        lastPublishStatus: restaurant.last_publish_status,
        lastPublishAt: restaurant.last_publish_at,
        lastPublishMessage: restaurant.last_publish_message,
        nextStep
    });
});

app.get('/api/restaurant/onboarding', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.id, r.restaurant_name, r.short_description, r.contact_email,
               r.contact_phone, r.street, r.city, s.is_published, s.hero_title,
               s.hero_subtitle, s.about_text, s.logo_image_url, s.hero_image_url,
               d.status as free_domain_status
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
        LEFT JOIN site_domains d ON d.id = (
            SELECT id FROM site_domains
            WHERE restaurant_id = r.id AND domain_type = 'free_generated'
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        )
        WHERE r.owner_user_id = ?
    `).get(req.session.userId);

    if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    const openingHoursCount = db.prepare('SELECT COUNT(*) as count FROM opening_hours WHERE restaurant_id = ?').get(restaurant.id).count;
    const closuresCount = db.prepare('SELECT COUNT(*) as count FROM special_closures WHERE restaurant_id = ? AND is_active = 1').get(restaurant.id).count;
    const menuStats = db.prepare(`
        SELECT COUNT(DISTINCT mc.id) as categories, COUNT(d.id) as dishes
        FROM menus m
        LEFT JOIN menu_categories mc ON mc.menu_id = m.id
        LEFT JOIN dishes d ON d.category_id = mc.id
        WHERE m.restaurant_id = ? AND m.is_active = 1
    `).get(restaurant.id);

    const missingBasics = [
        ['short_description', 'Kurzbeschreibung'],
        ['contact_email', 'Kontakt-E-Mail'],
        ['contact_phone', 'Telefon'],
        ['street', 'Straße'],
        ['city', 'Stadt']
    ].filter(([key]) => !restaurant[key]).map(([, label]) => label);
    const hasBasics = Boolean(restaurant.restaurant_name && missingBasics.length === 0);
    const hasDesign = Boolean(restaurant.hero_title || restaurant.hero_subtitle || restaurant.about_text || restaurant.logo_image_url || restaurant.hero_image_url);
    const hasMenu = menuStats.categories > 0 && menuStats.dishes > 0;
    const hasHours = openingHoursCount >= 7;
    const hasClosures = closuresCount > 0;
    const readyForPreview = hasBasics && hasHours && hasMenu && hasDesign;
    const cfPrepared = restaurant.free_domain_status === 'pending' || restaurant.free_domain_status === 'active';

    const steps = [
        {
            key: 'basics',
            label: 'Restaurantdaten vervollständigen',
            detail: hasBasics ? 'Name, Beschreibung, Kontakt und Adresse sind gepflegt.' : `Fehlt noch: ${missingBasics.join(', ')}.`,
            done: hasBasics,
            required: true,
            targetTab: 'base'
        },
        {
            key: 'hours',
            label: 'Öffnungszeiten prüfen',
            detail: hasHours ? 'Für alle sieben Wochentage liegen Öffnungszeiten oder Geschlossen-Markierungen vor.' : `${openingHoursCount}/7 Wochentage sind gespeichert.`,
            done: hasHours,
            required: true,
            targetTab: 'hours'
        },
        {
            key: 'menu',
            label: 'Speisekarte aufbauen',
            detail: `${menuStats.categories || 0} Kategorien, ${menuStats.dishes || 0} Gerichte.`,
            done: hasMenu,
            required: true,
            targetTab: 'menu'
        },
        {
            key: 'design',
            label: 'Design und Hero pflegen',
            detail: hasDesign ? 'Hero, Beschreibung oder Bilder sind gesetzt.' : 'Hero-Titel, About-Text oder Bilder fehlen noch.',
            done: hasDesign,
            required: true,
            targetTab: 'design'
        },
        {
            key: 'closures',
            label: 'Urlaub & Schließzeiten ergänzen',
            detail: hasClosures ? `${closuresCount} aktive Sonderschließungen eingetragen.` : 'Optional: nur nötig, wenn Urlaub, Feiertage oder Sonderzeiten anstehen.',
            done: hasClosures,
            required: false,
            targetTab: 'closures'
        },
        {
            key: 'preview',
            label: 'Vorschau prüfen',
            detail: readyForPreview ? 'Die wichtigsten Inhalte sind bereit für eine Sichtprüfung.' : 'Erst die Pflichtschritte abschließen, dann Vorschau prüfen.',
            done: readyForPreview,
            required: true,
            url: '/preview'
        },
        {
            key: 'cloudflare',
            label: 'Online-Veröffentlichung vorbereiten',
            detail: cfPrepared ? 'Der Cloudflare-Export wurde vorbereitet oder ist bereits aktiv.' : 'Erzeugt den technischen Export für den späteren Pages-Deploy.',
            done: cfPrepared,
            required: true,
            action: 'cf-prepare'
        }
    ];

    const requiredSteps = steps.filter(step => step.required);
    const completed = requiredSteps.filter(step => step.done).length;
    const optionalCompleted = steps.filter(step => !step.required && step.done).length;
    const next = requiredSteps.find(step => !step.done) || {
        key: 'complete',
        label: 'Alle Schritte geprüft',
        detail: 'Die Restaurantseite ist vollständig vorbereitet.',
        done: true
    };

    res.json({
        completed,
        total: requiredSteps.length,
        optionalCompleted,
        optionalTotal: steps.length - requiredSteps.length,
        progressPercent: Math.round((completed / requiredSteps.length) * 100),
        next,
        steps
    });
});

app.patch('/api/restaurant', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const restaurantNormalizers = {
        restaurant_name: value => {
            const name = trimText(value, 160);
            if (!name) throw new Error('REQUIRED_NAME');
            return name;
        },
        short_description: value => trimText(value, 500),
        contact_email: value => {
            const email = normalizeEmail(value);
            if (email && !isValidEmail(email)) throw new Error('INVALID_EMAIL');
            return email;
        },
        contact_phone: value => trimText(value, 80),
        street: value => trimText(value, 160),
        house_number: value => trimText(value, 40),
        postal_code: value => trimText(value, 20),
        city: value => trimText(value, 120),
        country: value => trimText(value, 80) || 'Deutschland',
        whatsapp: value => trimText(value, 80),
        instagram_url: normalizeHttpUrl,
        facebook_url: normalizeHttpUrl,
        tiktok_url: normalizeHttpUrl
    };
    const configNormalizers = {
        hero_title: value => trimText(value, 180),
        hero_subtitle: value => trimText(value, 280),
        about_text: value => trimText(value, 2500),
        logo_image_url: normalizeImageUrl,
        hero_image_url: normalizeImageUrl,
        footer_note: value => trimText(value, 300),
        seo_title: value => normalizeNullableText(value, 70),
        seo_description: value => normalizeNullableText(value, 180),
        accent_color: normalizeCssColor,
        primary_language: value => trimText(value, 10) || 'de',
        template_key: normalizeTemplateKey,
        font_family: normalizeFontFamily,
        heading_style: normalizeHeadingStyle,
        menu_layout: normalizeMenuLayout,
        dish_image_style: normalizeDishImageStyle
    };

    const updates = [];
    const values = [];
    const configUpdates = [];
    const configValues = [];

    try {
        for (const [field, normalizer] of Object.entries(restaurantNormalizers)) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(normalizer(req.body[field]));
            }
        }

        for (const [field, normalizer] of Object.entries(configNormalizers)) {
            if (req.body[field] !== undefined) {
                configUpdates.push(`${field} = ?`);
                configValues.push(normalizer(req.body[field]));
            }
        }
    } catch (error) {
        if (error.message === 'INVALID_EMAIL') {
            return res.status(400).json({ error: 'Invalid email address.' });
        }
        return sendValidationError(res, error);
    }

    if (updates.length === 0 && configUpdates.length === 0) {
        return res.status(400).json({ error: 'No fields to update.' });
    }

    try {
        const transaction = db.transaction(() => {
            if (updates.length > 0) {
                values.push(req.session.userId);
                db.prepare(`UPDATE restaurants SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE owner_user_id = ?`).run(...values);
            }
            if (configUpdates.length > 0) {
                configValues.push(restaurant.id);
                db.prepare(`UPDATE site_configs SET ${configUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE restaurant_id = ?`).run(...configValues);
            }
        });
        transaction();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Update failed.' });
    }
});

app.post(
    '/api/uploads/image',
    isAuthenticated,
    hasRole('restaurant_owner'),
    express.raw({ type: IMAGE_UPLOAD_TYPES, limit: IMAGE_UPLOAD_MAX_BYTES }),
    (req, res) => {
        const restaurant = getOwnerRestaurant(req.session.userId);
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
            return res.status(400).json({ error: 'No image received.' });
        }
        if (body.length > IMAGE_UPLOAD_MAX_BYTES) {
            return sendValidationError(res, new Error('IMAGE_TOO_LARGE'));
        }

        const detectedMime = detectImageMime(body);
        if (!detectedMime || !IMAGE_UPLOAD_TYPES.includes(detectedMime)) {
            return sendValidationError(res, new Error('INVALID_IMAGE_TYPE'));
        }

        const extension = imageExtension(detectedMime);
        const uploadDir = path.join(__dirname, 'public', 'uploads', 'restaurants', String(restaurant.id));
        fs.mkdirSync(uploadDir, { recursive: true });

        const safeContext = slugify(req.get('X-Upload-Context') || 'image').slice(0, 32) || 'image';
        const fileName = `${Date.now()}-${safeContext}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
        const targetPath = path.join(uploadDir, fileName);
        fs.writeFileSync(targetPath, body, { flag: 'wx' });
        const url = `/uploads/restaurants/${restaurant.id}/${fileName}`;
        const originalName = trimText(req.get('X-Upload-Name') || '', 180) || null;
        const mediaInfo = db.prepare(`
            INSERT INTO media_assets (restaurant_id, url, original_name, context, mime_type, size_bytes)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(restaurant.id, url, originalName, safeContext, detectedMime, body.length);

        res.json({
            success: true,
            id: mediaInfo.lastInsertRowid,
            url,
            mime: detectedMime,
            size: body.length
        });
    }
);

app.get('/api/media-assets', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const assets = db.prepare(`
        SELECT id, url, original_name, context, mime_type, size_bytes, created_at
        FROM media_assets
        WHERE restaurant_id = ? AND is_active = 1
        ORDER BY created_at DESC, id DESC
        LIMIT 200
    `).all(restaurant.id);
    res.json(assets);
});

app.delete('/api/media-assets/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const asset = db.prepare(`
        SELECT id, url
        FROM media_assets
        WHERE id = ? AND restaurant_id = ? AND is_active = 1
    `).get(req.params.id, restaurant.id);
    if (!asset) return res.status(404).json({ error: 'Image not found.' });

    const isUsed = Boolean(
        db.prepare('SELECT 1 FROM site_configs WHERE restaurant_id = ? AND (logo_image_url = ? OR hero_image_url = ?)').get(restaurant.id, asset.url, asset.url) ||
        db.prepare(`
            SELECT 1
            FROM menu_categories mc
            JOIN menus m ON mc.menu_id = m.id
            WHERE m.restaurant_id = ? AND mc.image_url = ?
        `).get(restaurant.id, asset.url) ||
        db.prepare(`
            SELECT 1
            FROM dishes d
            JOIN menu_categories mc ON d.category_id = mc.id
            JOIN menus m ON mc.menu_id = m.id
            WHERE m.restaurant_id = ? AND d.image_url = ?
        `).get(restaurant.id, asset.url)
    );
    if (isUsed) {
        return res.status(409).json({ error: 'Image is still used by this restaurant.' });
    }

    db.prepare('UPDATE media_assets SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND restaurant_id = ?').run(asset.id, restaurant.id);

    const relativePath = asset.url.replace(/^\/+/, '');
    if (relativePath.startsWith(`uploads/restaurants/${restaurant.id}/`) && !relativePath.includes('..')) {
        const filePath = path.join(__dirname, 'public', relativePath);
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
    }

    res.json({ success: true });
});

// --- Opening Hours ---

app.get('/api/opening-hours', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const hours = db.prepare(`
        SELECT oh.* FROM opening_hours oh
        JOIN restaurants r ON oh.restaurant_id = r.id
        WHERE r.owner_user_id = ?
        ORDER BY oh.weekday ASC
    `).all(req.session.userId);
    res.json(hours);
});

app.post('/api/opening-hours', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const { hours } = req.body; // Array of 7 days
    if (!Array.isArray(hours) || hours.length !== 7) return res.status(400).json({ error: 'Invalid hours format.' });

    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    let normalizedHours;
    try {
        const seen = new Set();
        normalizedHours = hours.map((h) => {
            const weekday = normalizeInteger(h.weekday);
            if (weekday < 0 || weekday > 6 || seen.has(weekday)) throw new Error('INVALID_INTEGER');
            seen.add(weekday);

            const isClosed = h.is_closed || h.isClosed;
            const open1 = normalizeTime(h.open_time_1);
            const close1 = normalizeTime(h.close_time_1);
            const open2 = normalizeTime(h.open_time_2);
            const close2 = normalizeTime(h.close_time_2);

            if (!isClosed && ((open1 && !close1) || (!open1 && close1) || (open2 && !close2) || (!open2 && close2))) {
                throw new Error('INVALID_TIME');
            }

            return {
                weekday,
                is_closed: isClosed ? 1 : 0,
                open_time_1: isClosed ? null : open1,
                close_time_1: isClosed ? null : close1,
                open_time_2: isClosed ? null : open2,
                close_time_2: isClosed ? null : close2,
                note: normalizeNullableText(h.note, 200)
            };
        });
    } catch (error) {
        return sendValidationError(res, error);
    }
    
    const upsert = db.prepare(`
        INSERT INTO opening_hours (restaurant_id, weekday, is_closed, open_time_1, close_time_1, open_time_2, close_time_2, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(restaurant_id, weekday) DO UPDATE SET
            is_closed = excluded.is_closed,
            open_time_1 = excluded.open_time_1,
            close_time_1 = excluded.close_time_1,
            open_time_2 = excluded.open_time_2,
            close_time_2 = excluded.close_time_2,
            note = excluded.note
    `);

    try {
        const transaction = db.transaction((data) => {
            for (const h of data) {
                upsert.run(restaurant.id, h.weekday, h.is_closed, h.open_time_1, h.close_time_1, h.open_time_2, h.close_time_2, h.note);
            }
        });
        transaction(normalizedHours);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update hours.' });
    }
});

// --- Special Closures ---

function normalizeClosurePayload(body, { partial = false } = {}) {
    const payload = {};

    if (!partial || body.title !== undefined) {
        payload.title = trimText(body.title, 160);
        if (!payload.title) throw new Error('REQUIRED_TITLE');
    }
    if (!partial || body.start_date !== undefined) payload.start_date = normalizeDate(body.start_date);
    if (!partial || body.end_date !== undefined) payload.end_date = normalizeDate(body.end_date);
    if (body.note !== undefined || !partial) payload.note = normalizeNullableText(body.note, 600);
    if (body.is_active !== undefined || !partial) payload.is_active = normalizeBooleanFlag(body.is_active);

    const start = payload.start_date || body.current_start_date;
    const end = payload.end_date || body.current_end_date;
    if (start && end && end < start) throw new Error('INVALID_DATE_RANGE');

    return payload;
}

function getOwnerClosure(userId, closureId) {
    return db.prepare(`
        SELECT sc.* FROM special_closures sc
        JOIN restaurants r ON sc.restaurant_id = r.id
        WHERE sc.id = ? AND r.owner_user_id = ?
    `).get(closureId, userId);
}

app.get('/api/special-closures', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const closures = db.prepare(`
        SELECT * FROM special_closures
        WHERE restaurant_id = ?
        ORDER BY start_date ASC, id ASC
    `).all(restaurant.id);
    res.json(closures);
});

app.post('/api/special-closures', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    let payload;
    try {
        payload = normalizeClosurePayload(req.body || {});
    } catch (error) {
        return sendValidationError(res, error);
    }

    const info = db.prepare(`
        INSERT INTO special_closures (restaurant_id, title, start_date, end_date, note, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(restaurant.id, payload.title, payload.start_date, payload.end_date, payload.note, payload.is_active);

    res.json({ success: true, id: info.lastInsertRowid });
});

app.patch('/api/special-closures/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const existing = getOwnerClosure(req.session.userId, req.params.id);
    if (!existing) return res.status(403).json({ error: 'Forbidden' });

    let payload;
    try {
        payload = normalizeClosurePayload({
            ...req.body,
            current_start_date: existing.start_date,
            current_end_date: existing.end_date
        }, { partial: true });
    } catch (error) {
        return sendValidationError(res, error);
    }

    const fields = [];
    const values = [];
    for (const field of ['title', 'start_date', 'end_date', 'note', 'is_active']) {
        if (payload[field] !== undefined) {
            fields.push(`${field} = ?`);
            values.push(payload[field]);
        }
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update.' });

    values.push(req.params.id);
    db.prepare(`UPDATE special_closures SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
    res.json({ success: true });
});

app.delete('/api/special-closures/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    if (!getOwnerClosure(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM special_closures WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// --- Menus, Categories, Dishes ---

app.get('/api/menu', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    let menu = db.prepare('SELECT * FROM menus WHERE restaurant_id = ? AND is_active = 1').get(restaurant.id);
    if (!menu) {
        // Create a default menu if none exists
        const info = db.prepare('INSERT INTO menus (restaurant_id, title) VALUES (?, ?)').run(restaurant.id, 'Standardkarte');
        menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(info.lastInsertRowid);
    }

    const categories = db.prepare('SELECT * FROM menu_categories WHERE menu_id = ? ORDER BY sort_order ASC').all(menu.id);
    for (const cat of categories) {
        cat.dishes = db.prepare('SELECT * FROM dishes WHERE category_id = ? ORDER BY sort_order ASC').all(cat.id);
    }
    menu.categories = categories;

    res.json(menu);
});

// Category Ownersip Middleware Helper
function checkCategoryOwnership(userId, categoryId) {
    return db.prepare(`
        SELECT mc.id FROM menu_categories mc
        JOIN menus m ON mc.menu_id = m.id
        JOIN restaurants r ON m.restaurant_id = r.id
        WHERE mc.id = ? AND r.owner_user_id = ?
    `).get(categoryId, userId);
}

function getNextCategorySort(menuId) {
    const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as nextSort FROM menu_categories WHERE menu_id = ?').get(menuId);
    return row.nextSort;
}

function getNextDishSort(categoryId) {
    const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as nextSort FROM dishes WHERE category_id = ?').get(categoryId);
    return row.nextSort;
}

function sameIdSet(left, right) {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(id => rightSet.has(id));
}

app.post('/api/menu/categories', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const { menu_id } = req.body;
    
    // Auth Check
    const menu = db.prepare('SELECT m.id FROM menus m JOIN restaurants r ON m.restaurant_id = r.id WHERE m.id = ? AND r.owner_user_id = ?').get(menu_id, req.session.userId);
    if (!menu) return res.status(403).json({ error: 'Forbidden' });

    let categoryName;
    let displayMode;
    let layoutMode;
    let sortOrder;
    let imageUrl;
    try {
        categoryName = trimText(req.body.category_name, 120);
        if (!categoryName) throw new Error('REQUIRED_NAME');
        displayMode = normalizeDisplayMode(req.body.display_mode);
        layoutMode = normalizeCategoryLayoutMode(req.body.layout_mode);
        imageUrl = normalizeImageUrl(req.body.image_url);
        sortOrder = req.body.sort_order === undefined || req.body.sort_order === ''
            ? getNextCategorySort(menu_id)
            : normalizeInteger(req.body.sort_order);
    } catch (error) {
        return sendValidationError(res, error);
    }

    try {
        const info = db.prepare('INSERT INTO menu_categories (menu_id, category_name, display_mode, layout_mode, sort_order, image_url) VALUES (?, ?, ?, ?, ?, ?)').run(menu_id, categoryName, displayMode, layoutMode, sortOrder, imageUrl);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add category.' });
    }
});

app.post('/api/menu/categories/reorder', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    let menuId;
    let orderedIds;
    try {
        menuId = normalizeInteger(req.body.menu_id);
        orderedIds = normalizeIdList(req.body.ordered_ids);
    } catch (error) {
        return sendValidationError(res, error);
    }

    const menu = db.prepare(`
        SELECT m.id
        FROM menus m
        JOIN restaurants r ON m.restaurant_id = r.id
        WHERE m.id = ? AND r.owner_user_id = ?
    `).get(menuId, req.session.userId);
    if (!menu) return res.status(403).json({ error: 'Forbidden' });

    const existingIds = db.prepare('SELECT id FROM menu_categories WHERE menu_id = ? ORDER BY sort_order ASC, id ASC').all(menuId).map(row => row.id);
    if (!sameIdSet(orderedIds, existingIds)) {
        return res.status(400).json({ error: 'Sort order does not match this menu.' });
    }

    const update = db.prepare('UPDATE menu_categories SET sort_order = ? WHERE id = ? AND menu_id = ?');
    db.transaction(() => {
        orderedIds.forEach((id, index) => update.run(index + 10000, id, menuId));
        orderedIds.forEach((id, index) => update.run(index, id, menuId));
    })();

    res.json({ success: true });
});

app.patch('/api/menu/categories/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    if (!checkCategoryOwnership(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Forbidden' });

    const fields = [];
    const values = [];
    try {
        if (req.body.category_name !== undefined) {
            const name = trimText(req.body.category_name, 120);
            if (!name) throw new Error('REQUIRED_NAME');
            fields.push('category_name = ?');
            values.push(name);
        }
        if (req.body.display_mode !== undefined) {
            fields.push('display_mode = ?');
            values.push(normalizeDisplayMode(req.body.display_mode));
        }
        if (req.body.layout_mode !== undefined) {
            fields.push('layout_mode = ?');
            values.push(normalizeCategoryLayoutMode(req.body.layout_mode));
        }
        if (req.body.image_url !== undefined) {
            fields.push('image_url = ?');
            values.push(normalizeImageUrl(req.body.image_url));
        }
        if (req.body.sort_order !== undefined) {
            fields.push('sort_order = ?');
            values.push(normalizeInteger(req.body.sort_order));
        }
        if (req.body.is_active !== undefined) {
            fields.push('is_active = ?');
            values.push(normalizeBooleanFlag(req.body.is_active));
        }
    } catch (error) {
        return sendValidationError(res, error);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update.' });
    values.push(req.params.id);
    db.prepare(`UPDATE menu_categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ success: true });
});

app.delete('/api/menu/categories/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    if (!checkCategoryOwnership(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM menu_categories WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.post('/api/dishes', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const { category_id } = req.body;
    if (!checkCategoryOwnership(req.session.userId, category_id)) return res.status(403).json({ error: 'Forbidden' });

    let payload;
    try {
        const dishName = trimText(req.body.dish_name, 160);
        if (!dishName) throw new Error('REQUIRED_NAME');
        if (req.body.price_cents === undefined) throw new Error('REQUIRED_PRICE');
        payload = {
            dish_name: dishName,
            price_cents: normalizePriceCents(req.body.price_cents),
            description_text: trimText(req.body.description_text, 1200),
            ingredients_text: trimText(req.body.ingredients_text, 1200),
            allergens_text: trimText(req.body.allergens_text, 1200),
            sort_order: req.body.sort_order === undefined || req.body.sort_order === ''
                ? getNextDishSort(category_id)
                : normalizeInteger(req.body.sort_order),
            image_url: normalizeImageUrl(req.body.image_url),
            badge_text: normalizeNullableText(req.body.badge_text, 80)
        };
    } catch (error) {
        return sendValidationError(res, error);
    }

    try {
        const info = db.prepare(`
            INSERT INTO dishes (category_id, dish_name, price_cents, description_text, ingredients_text, allergens_text, sort_order, image_url, badge_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(category_id, payload.dish_name, payload.price_cents, payload.description_text, payload.ingredients_text, payload.allergens_text, payload.sort_order, payload.image_url, payload.badge_text);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add dish.' });
    }
});

app.patch('/api/dishes/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const dish = db.prepare(`
        SELECT d.id FROM dishes d
        JOIN menu_categories mc ON d.category_id = mc.id
        JOIN menus m ON mc.menu_id = m.id
        JOIN restaurants r ON m.restaurant_id = r.id
        WHERE d.id = ? AND r.owner_user_id = ?
    `).get(req.params.id, req.session.userId);
    if (!dish) return res.status(403).json({ error: 'Forbidden' });

    const sets = [];
    const values = [];
    try {
        const fieldNormalizers = {
            dish_name: value => {
                const name = trimText(value, 160);
                if (!name) throw new Error('REQUIRED_NAME');
                return name;
            },
            price_cents: normalizePriceCents,
            description_text: value => trimText(value, 1200),
            ingredients_text: value => trimText(value, 1200),
            allergens_text: value => trimText(value, 1200),
            sort_order: normalizeInteger,
            is_active: normalizeBooleanFlag,
            image_url: normalizeImageUrl,
            badge_text: value => normalizeNullableText(value, 80)
        };

        for (const [field, normalizer] of Object.entries(fieldNormalizers)) {
            if (req.body[field] !== undefined) {
                sets.push(`${field} = ?`);
                values.push(normalizer(req.body[field]));
            }
        }
    } catch (error) {
        return sendValidationError(res, error);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update.' });
    values.push(req.params.id);
    db.prepare(`UPDATE dishes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    res.json({ success: true });
});

app.post('/api/dishes/reorder', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    let categoryId;
    let orderedIds;
    try {
        categoryId = normalizeInteger(req.body.category_id);
        orderedIds = normalizeIdList(req.body.ordered_ids);
    } catch (error) {
        return sendValidationError(res, error);
    }

    if (!checkCategoryOwnership(req.session.userId, categoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const existingIds = db.prepare('SELECT id FROM dishes WHERE category_id = ? ORDER BY sort_order ASC, id ASC').all(categoryId).map(row => row.id);
    if (!sameIdSet(orderedIds, existingIds)) {
        return res.status(400).json({ error: 'Sort order does not match this category.' });
    }

    const update = db.prepare('UPDATE dishes SET sort_order = ? WHERE id = ? AND category_id = ?');
    db.transaction(() => {
        orderedIds.forEach((id, index) => update.run(index + 10000, id, categoryId));
        orderedIds.forEach((id, index) => update.run(index, id, categoryId));
    })();

    res.json({ success: true });
});

app.delete('/api/dishes/:id', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const dish = db.prepare(`
        SELECT d.id FROM dishes d
        JOIN menu_categories mc ON d.category_id = mc.id
        JOIN menus m ON mc.menu_id = m.id
        JOIN restaurants r ON m.restaurant_id = r.id
        WHERE d.id = ? AND r.owner_user_id = ?
    `).get(req.params.id, req.session.userId);
    if (!dish) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM dishes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// --- Preview API ---

function getPreviewData(restaurantId, { previewMode = true } = {}) {
    const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
    const c = db.prepare('SELECT * FROM site_configs WHERE restaurant_id = ?').get(restaurantId);
    const hours = db.prepare('SELECT * FROM opening_hours WHERE restaurant_id = ? ORDER BY weekday ASC').all(restaurantId);
    const today = new Date().toISOString().slice(0, 10);
    const specialClosures = db.prepare(`
        SELECT title, start_date, end_date, note
        FROM special_closures
        WHERE restaurant_id = ? AND is_active = 1 AND end_date >= ?
        ORDER BY start_date ASC, id ASC
    `).all(restaurantId, today);
    const menu = db.prepare('SELECT * FROM menus WHERE restaurant_id = ? AND is_active = 1').get(restaurantId);
    
    let categories = [];
    if (menu) {
        categories = db.prepare('SELECT * FROM menu_categories WHERE menu_id = ? AND is_active = 1 ORDER BY sort_order ASC').all(menu.id);
        for (const cat of categories) {
            cat.dishes = db.prepare('SELECT * FROM dishes WHERE category_id = ? AND is_active = 1 ORDER BY sort_order ASC').all(cat.id);
        }
    }

    // Normalization / ViewModel
    const viewModel = {
        restaurant: {
            name: r.restaurant_name,
            description: r.short_description,
            contact: {
                email: r.contact_email,
                phone: r.contact_phone,
                whatsapp: r.whatsapp,
                social: {
                    instagram: r.instagram_url,
                    facebook: r.facebook_url,
                    tiktok: r.tiktok_url
                }
            },
            address: {
                street: r.street,
                number: r.house_number,
                zip: r.postal_code,
                city: r.city,
                country: r.country
            }
        },
        siteConfig: {
            template: c.template_key === 'default' ? 'free_default' : (c.template_key || 'free_default'),
            hero: {
                title: c.hero_title || r.restaurant_name,
                subtitle: c.hero_subtitle || r.short_description,
                imageUrl: c.hero_image_url
            },
            aboutText: c.about_text,
            logoUrl: c.logo_image_url,
            footerNote: c.footer_note,
            seo: {
                title: c.seo_title || c.hero_title || r.restaurant_name,
                description: c.seo_description || r.short_description
            },
            accentColor: c.accent_color || '#2563eb',
            language: c.primary_language || 'de',
            plan: c.current_plan,
            fontFamily: c.font_family || 'system',
            headingStyle: c.heading_style || 'clean',
            menuLayout: c.menu_layout || 'list',
            dishImageStyle: c.dish_image_style || 'rounded'
        },
        hours: hours.map(h => ({
            day: h.weekday,
            isClosed: h.is_closed === 1,
            slots: [
                { open: h.open_time_1, close: h.close_time_1 },
                { open: h.open_time_2, close: h.close_time_2 }
            ].filter(s => s.open && s.close),
            note: h.note
        })),
        specialClosures: specialClosures.map(item => ({
            title: item.title,
            startDate: item.start_date,
            endDate: item.end_date,
            note: item.note
        })),
        menu: {
            title: menu ? menu.title : 'Speisekarte',
            categories: categories.map(cat => ({
                name: cat.category_name,
                mode: cat.layout_mode && cat.layout_mode !== 'inherit' ? cat.layout_mode : cat.display_mode,
                image: cat.image_url,
                dishes: cat.dishes.map(d => ({
                    name: d.dish_name,
                    price: (d.price_cents / 100).toFixed(2),
                    description: d.description_text,
                    ingredients: d.ingredients_text,
                    allergens: d.allergens_text,
                    image: d.image_url,
                    badge: d.badge_text
                }))
            }))
        },
        flags: {
            isFree: c.current_plan === 'free',
            adsEnabled: c.current_plan === 'free', // Derived correctly from plan
            donationHintEnabled: c.current_plan === 'free' // Derived correctly from plan
        },
        meta: {
            previewMode, // true für Dashboard-Preview, false für Publish/CF-Export
            seoTitle: c.seo_title || c.hero_title || r.restaurant_name,
            seoDescription: c.seo_description || r.short_description,
            renderedAt: new Date().toISOString()
        }
    };

    return viewModel;
}

app.get('/api/preview', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });
    res.json(getPreviewData(restaurant.id));
});

app.get('/api/admin/preview/:restaurantId', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    res.json(getPreviewData(req.params.restaurantId));
});

// Dynamic Preview Page Logic
app.get('/preview', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'preview.html'));
});

app.get('/preview/:id', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'preview.html'));
});

// --- Cloudflare Pages Preparation API ---
// Bereitet den Cloudflare Pages Export vor (Free Plan only).
// Erstellt cloudflare-export/<slug>/ mit _redirects, _headers, deploy-info.json.

app.post('/api/restaurant/cf-prepare', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const config = db.prepare('SELECT current_plan FROM site_configs WHERE restaurant_id = ?').get(restaurant.id);
    if (config.current_plan !== 'free') {
        return res.status(400).json({ error: 'Cloudflare Pages preparation is only available for the free plan.' });
    }

    try {
        const viewModel = getPreviewData(restaurant.id, { previewMode: false });
        const { exportStaticSite } = require('./lib/publisher');
        exportStaticSite(restaurant.public_slug_internal, viewModel);
        const { prepareCfExport } = require('./lib/cf-deploy');
        const { cfExportPath, targetHostname } = prepareCfExport(restaurant.public_slug_internal, restaurant.id);

        // site_domains + publish_events als Transaktion
        const syncTransaction = db.transaction(() => {
            // --- site_domains synchronisieren ---
            // Regel: Genau ein free_generated-Eintrag pro Restaurant.
            // Status 'pending' = Export vorbereitet, aber noch kein echtes Deployment.
            // Status 'active' wird hier bewusst NICHT gesetzt, da keine echte Live-Schaltung stattfindet.

            const existing = db.prepare(
                "SELECT id, hostname, status FROM site_domains WHERE restaurant_id = ? AND domain_type = 'free_generated' LIMIT 1"
            ).get(restaurant.id);

            if (existing) {
                if (existing.hostname === targetHostname) {
                    // Richtiger Hostname vorhanden → Status auf 'pending' setzen + Zeitstempel
                    // (korrigiert ggf. einen falschen 'active'-Status aus dem Seed)
                    db.prepare(
                        "UPDATE site_domains SET status = 'pending', is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).run(existing.id);
                } else {
                    // Abweichender Hostname (altes Schema) → alten Eintrag deaktivieren, neuen anlegen
                    db.prepare(
                        "UPDATE site_domains SET status = 'disabled', is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).run(existing.id);
                    db.prepare(
                        "INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status) VALUES (?, ?, 'free_generated', 0, 'pending')"
                    ).run(restaurant.id, targetHostname);
                }
            } else {
                // Noch kein free_generated-Eintrag → neu anlegen
                db.prepare(
                    "INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status) VALUES (?, ?, 'free_generated', 0, 'pending')"
                ).run(restaurant.id, targetHostname);
            }

            // --- publish_events protokollieren ---
            db.prepare(
                'INSERT INTO publish_events (restaurant_id, trigger_type, target_hostname, status, message, finished_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
            ).run(
                restaurant.id,
                'manual_update',
                targetHostname,
                'success',
                'Cloudflare Pages Export vorbereitet (noch nicht live verbunden). site_domains aktualisiert.'
            );
        });

        syncTransaction();

        res.json({
            success: true,
            cfExportPath,
            targetHostname,
            freeHostname: {
                hostname: targetHostname,
                status: 'pending',
                note: 'Vorbereitet. Kein echtes Deployment durchgeführt. status=pending bis zur manuellen Live-Schaltung.'
            },
            note: 'Export bereit. Manuelles Deployment über Cloudflare CLI oder Dashboard notwendig.',
            deployHint: [
                `Option A (Wrangler CLI): npx wrangler pages deploy cloudflare-export/${restaurant.public_slug_internal} --project-name=${restaurant.public_slug_internal}-restiq`,
                'Option B: Ordner im Cloudflare Pages Dashboard hochladen'
            ]
        });
    } catch (e) {
        console.error('CF prepare error:', e);
        try {
            const restaurant2 = db.prepare('SELECT id, public_slug_internal FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
            db.prepare(
                'INSERT INTO publish_events (restaurant_id, trigger_type, target_hostname, status, message, finished_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
            ).run(
                restaurant2.id,
                'manual_update',
                `${restaurant2.public_slug_internal}-restiq.pages.dev`,
                'error',
                e.message
            );
        } catch (logErr) { console.error('Failed to log CF prepare error', logErr); }
        res.status(500).json({ error: 'CF-Prepare fehlgeschlagen.', details: e.message });
    }
});

app.post('/api/restaurant/domain', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const restaurant = getOwnerRestaurant(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    let domainChoice;
    let hostname;
    try {
        domainChoice = normalizeDomainChoice(req.body && req.body.domain_choice);
        hostname = normalizeHostname(req.body && req.body.custom_domain);
        if (domainChoice === 'own_domain' && !hostname) {
            throw new Error('INVALID_HOSTNAME');
        }
    } catch (error) {
        return sendValidationError(res, error);
    }

    const expectedFreeHostname = `${restaurant.public_slug_internal}-restiq.pages.dev`;
    const transaction = db.transaction(() => {
        db.prepare(`
            INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status)
            VALUES (?, ?, 'free_generated', ?, 'pending')
            ON CONFLICT(hostname) DO UPDATE SET
                is_primary = excluded.is_primary,
                updated_at = CURRENT_TIMESTAMP
        `).run(restaurant.id, expectedFreeHostname, domainChoice === 'restiq_free' ? 1 : 0);

        if (hostname) {
            db.prepare(`
                UPDATE site_domains
                SET is_primary = 0, updated_at = CURRENT_TIMESTAMP
                WHERE restaurant_id = ? AND domain_type = 'custom'
            `).run(restaurant.id);
            db.prepare(`
                INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status)
                VALUES (?, ?, 'custom', 1, 'pending')
                ON CONFLICT(hostname) DO UPDATE SET
                    is_primary = 1,
                    status = 'pending',
                    updated_at = CURRENT_TIMESTAMP
            `).run(restaurant.id, hostname);
        }
    });

    try {
        transaction();
        const customStatus = hostname ? 'pending' : 'not_configured';
        res.json({
            success: true,
            domainChoice,
            customDomain: hostname,
            customDomainStatus: customStatus,
            customDomainStatusLabel: getDomainStatusLabel(customStatus),
            note: hostname
                ? 'Eigene Domain gespeichert. DNS-Eigentumsprüfung folgt später über die Cloudflare-Automation.'
                : 'Kostenlose RestIQ-Adresse ausgewählt.'
        });
    } catch (error) {
        res.status(500).json({ error: 'Domain update failed.' });
    }
});

// Admin: Cloudflare Prepare für beliebiges Restaurant (Admin only)
app.post('/api/admin/cf-prepare/:restaurantId', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.restaurantId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const config = db.prepare('SELECT current_plan, is_published FROM site_configs WHERE restaurant_id = ?').get(restaurant.id);
    if (config.current_plan !== 'free') {
        return res.status(400).json({ error: 'Only free plan supported.' });
    }

    try {
        const viewModel = getPreviewData(restaurant.id, { previewMode: false });
        const { exportStaticSite } = require('./lib/publisher');
        exportStaticSite(restaurant.public_slug_internal, viewModel);
        const { prepareCfExport } = require('./lib/cf-deploy');
        const { cfExportPath, targetHostname } = prepareCfExport(restaurant.public_slug_internal, restaurant.id);

        const syncTransaction = db.transaction(() => {
            const existing = db.prepare(
                "SELECT id, hostname, status FROM site_domains WHERE restaurant_id = ? AND domain_type = 'free_generated' LIMIT 1"
            ).get(restaurant.id);

            if (existing) {
                if (existing.hostname === targetHostname) {
                    db.prepare(
                        "UPDATE site_domains SET status = 'pending', is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).run(existing.id);
                } else {
                    db.prepare(
                        "UPDATE site_domains SET status = 'disabled', is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).run(existing.id);
                    db.prepare(
                        "INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status) VALUES (?, ?, 'free_generated', 0, 'pending')"
                    ).run(restaurant.id, targetHostname);
                }
            } else {
                db.prepare(
                    "INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status) VALUES (?, ?, 'free_generated', 0, 'pending')"
                ).run(restaurant.id, targetHostname);
            }

            db.prepare(
                'INSERT INTO publish_events (restaurant_id, trigger_type, target_hostname, status, message, finished_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
            ).run(
                restaurant.id,
                'manual_update',
                targetHostname,
                'success',
                'Cloudflare Pages Export (admin-triggered) vorbereitet. site_domains aktualisiert.'
            );
        });

        syncTransaction();

        res.json({ success: true, cfExportPath, targetHostname });
    } catch (e) {
        res.status(500).json({ error: 'CF-Prepare fehlgeschlagen.', details: e.message });
    }
});

// --- Admin Routes ---

app.get('/api/admin/summary', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const totals = db.prepare(`
        SELECT
            COUNT(*) as restaurants,
            SUM(CASE WHEN r.is_active = 1 THEN 1 ELSE 0 END) as active_restaurants,
            SUM(CASE WHEN s.current_plan = 'free' THEN 1 ELSE 0 END) as free_plan,
            SUM(CASE WHEN s.current_plan = 'paid' THEN 1 ELSE 0 END) as paid_plan
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
    `).get();

    const domains = db.prepare(`
        SELECT
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_domains,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_domains,
            SUM(CASE WHEN domain_type = 'custom' THEN 1 ELSE 0 END) as custom_domains
        FROM site_domains
    `).get();

    const content = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM dishes WHERE is_active = 1) as active_dishes,
            (SELECT COUNT(*) FROM menu_categories WHERE is_active = 1) as active_categories,
            (SELECT COUNT(*) FROM media_assets WHERE is_active = 1) as media_assets,
            (SELECT COUNT(*) FROM special_closures WHERE is_active = 1) as active_closures
    `).get();

    const deploys = db.prepare(`
        SELECT
            COUNT(*) as publish_events,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_events,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed_events
        FROM publish_events
    `).get();

    res.json({
        restaurants: totals.restaurants || 0,
        activeRestaurants: totals.active_restaurants || 0,
        freePlan: totals.free_plan || 0,
        paidPlan: totals.paid_plan || 0,
        pendingDomains: domains.pending_domains || 0,
        activeDomains: domains.active_domains || 0,
        customDomains: domains.custom_domains || 0,
        activeDishes: content.active_dishes || 0,
        activeCategories: content.active_categories || 0,
        mediaAssets: content.media_assets || 0,
        activeClosures: content.active_closures || 0,
        publishEvents: deploys.publish_events || 0,
        successfulEvents: deploys.successful_events || 0,
        failedEvents: deploys.failed_events || 0
    });
});

app.get('/api/admin/platform-settings', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const rows = db.prepare(`
        SELECT setting_key, setting_value, updated_at
        FROM platform_settings
        ORDER BY setting_key ASC
    `).all();
    res.json(rows.reduce((settings, row) => {
        settings[row.setting_key] = row.setting_value;
        return settings;
    }, {}));
});

app.patch('/api/admin/platform-settings', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const body = req.body || {};
    const entries = Object.entries(body);
    if (entries.length === 0) return res.status(400).json({ error: 'No settings provided.' });

    try {
        const update = db.prepare(`
            INSERT INTO platform_settings (setting_key, setting_value, updated_by_user_id)
            VALUES (?, ?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_by_user_id = excluded.updated_by_user_id,
                updated_at = CURRENT_TIMESTAMP
        `);
        const transaction = db.transaction(() => {
            for (const [key, value] of entries) {
                update.run(normalizeSettingKey(key), trimText(value, 1000), req.session.userId);
            }
        });
        transaction();
        res.json({ success: true });
    } catch (error) {
        if (error.message === 'INVALID_SETTING_KEY') return sendValidationError(res, error);
        res.status(500).json({ error: 'Settings update failed.' });
    }
});

app.get('/api/admin/domain-providers', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const providers = db.prepare(`
        SELECT id, provider_name, provider_type, website_url, affiliate_base_url,
               supports_free_domains, supports_paid_domains, is_active, sort_order,
               created_at, updated_at
        FROM domain_providers
        ORDER BY sort_order ASC, provider_name ASC
    `).all();
    res.json(providers);
});

app.post('/api/admin/domain-providers', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    try {
        const body = req.body || {};
        const providerName = trimText(body.provider_name, 120);
        if (!providerName) return res.status(400).json({ error: 'Provider name is required.' });

        const info = db.prepare(`
            INSERT INTO domain_providers (
                provider_name, provider_type, website_url, affiliate_base_url,
                supports_free_domains, supports_paid_domains, is_active, sort_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            providerName,
            normalizeProviderType(body.provider_type),
            normalizeHttpUrl(body.website_url),
            normalizeHttpUrl(body.affiliate_base_url),
            normalizeBooleanFlag(body.supports_free_domains),
            normalizeBooleanFlag(body.supports_paid_domains),
            normalizeBooleanFlag(body.is_active),
            normalizeInteger(body.sort_order, 0)
        );

        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        if (['INVALID_PROVIDER_TYPE', 'INVALID_URL', 'INVALID_URL_PROTOCOL', 'INVALID_INTEGER'].includes(error.message)) {
            return sendValidationError(res, error);
        }
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Provider already exists.' });
        }
        res.status(500).json({ error: 'Provider creation failed.' });
    }
});

app.patch('/api/admin/domain-providers/:id', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const provider = db.prepare('SELECT id FROM domain_providers WHERE id = ?').get(req.params.id);
    if (!provider) return res.status(404).json({ error: 'Provider not found.' });

    try {
        const body = req.body || {};
        const providerName = trimText(body.provider_name, 120);
        if (!providerName) return res.status(400).json({ error: 'Provider name is required.' });

        db.prepare(`
            UPDATE domain_providers
            SET provider_name = ?, provider_type = ?, website_url = ?, affiliate_base_url = ?,
                supports_free_domains = ?, supports_paid_domains = ?, is_active = ?,
                sort_order = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            providerName,
            normalizeProviderType(body.provider_type),
            normalizeHttpUrl(body.website_url),
            normalizeHttpUrl(body.affiliate_base_url),
            normalizeBooleanFlag(body.supports_free_domains),
            normalizeBooleanFlag(body.supports_paid_domains),
            normalizeBooleanFlag(body.is_active),
            normalizeInteger(body.sort_order, 0),
            provider.id
        );

        res.json({ success: true });
    } catch (error) {
        if (['INVALID_PROVIDER_TYPE', 'INVALID_URL', 'INVALID_URL_PROTOCOL', 'INVALID_INTEGER'].includes(error.message)) {
            return sendValidationError(res, error);
        }
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Provider already exists.' });
        }
        res.status(500).json({ error: 'Provider update failed.' });
    }
});

app.delete('/api/admin/domain-providers/:id', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const info = db.prepare('DELETE FROM domain_providers WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Provider not found.' });
    res.json({ success: true });
});

app.get('/api/admin/ad-slots', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const slots = db.prepare(`
        SELECT id, slot_key, label, placement, provider_name, placeholder_text,
               is_active, created_at, updated_at
        FROM ad_slots
        ORDER BY placement ASC, slot_key ASC
    `).all();
    res.json(slots);
});

app.post('/api/admin/ad-slots', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    try {
        const body = req.body || {};
        const slotKey = slugify(body.slot_key || body.label).replace(/-/g, '_');
        const label = trimText(body.label, 120);
        if (!slotKey || !label) return res.status(400).json({ error: 'Slot key and label are required.' });

        const info = db.prepare(`
            INSERT INTO ad_slots (slot_key, label, placement, provider_name, placeholder_text, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            slotKey,
            label,
            normalizeAdPlacement(body.placement),
            normalizeNullableText(body.provider_name, 120),
            normalizeNullableText(body.placeholder_text, 500),
            normalizeBooleanFlag(body.is_active)
        );

        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        if (['INVALID_AD_PLACEMENT'].includes(error.message)) return sendValidationError(res, error);
        if (error.message.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'Ad slot already exists.' });
        res.status(500).json({ error: 'Ad slot creation failed.' });
    }
});

app.patch('/api/admin/ad-slots/:id', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const slot = db.prepare('SELECT id FROM ad_slots WHERE id = ?').get(req.params.id);
    if (!slot) return res.status(404).json({ error: 'Ad slot not found.' });

    try {
        const body = req.body || {};
        const slotKey = slugify(body.slot_key || body.label).replace(/-/g, '_');
        const label = trimText(body.label, 120);
        if (!slotKey || !label) return res.status(400).json({ error: 'Slot key and label are required.' });

        db.prepare(`
            UPDATE ad_slots
            SET slot_key = ?, label = ?, placement = ?, provider_name = ?,
                placeholder_text = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            slotKey,
            label,
            normalizeAdPlacement(body.placement),
            normalizeNullableText(body.provider_name, 120),
            normalizeNullableText(body.placeholder_text, 500),
            normalizeBooleanFlag(body.is_active),
            slot.id
        );

        res.json({ success: true });
    } catch (error) {
        if (['INVALID_AD_PLACEMENT'].includes(error.message)) return sendValidationError(res, error);
        if (error.message.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'Ad slot already exists.' });
        res.status(500).json({ error: 'Ad slot update failed.' });
    }
});

app.delete('/api/admin/ad-slots/:id', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const info = db.prepare('DELETE FROM ad_slots WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Ad slot not found.' });
    res.json({ success: true });
});

app.get('/api/admin/restaurants', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const query = `
        SELECT r.*, u.email as owner_email, s.current_plan, s.is_published,
               s.template_key, d.hostname as free_hostname, d.status as free_domain_status,
               cd.hostname as custom_hostname, cd.status as custom_domain_status,
               pe.status as last_publish_status, pe.created_at as last_publish_at,
               pe.message as last_publish_message,
               (SELECT COUNT(*) FROM menu_categories mc JOIN menus m ON mc.menu_id = m.id WHERE m.restaurant_id = r.id) as category_count,
               (SELECT COUNT(*) FROM dishes di JOIN menu_categories mc ON di.category_id = mc.id JOIN menus m ON mc.menu_id = m.id WHERE m.restaurant_id = r.id) as dish_count,
               (SELECT COUNT(*) FROM media_assets ma WHERE ma.restaurant_id = r.id AND ma.is_active = 1) as media_count,
               (SELECT COUNT(*) FROM special_closures sc WHERE sc.restaurant_id = r.id AND sc.is_active = 1) as closure_count
        FROM restaurants r
        JOIN users u ON r.owner_user_id = u.id
        JOIN site_configs s ON r.id = s.restaurant_id
        LEFT JOIN site_domains d ON d.id = (
            SELECT id FROM site_domains
            WHERE restaurant_id = r.id AND domain_type = 'free_generated'
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        )
        LEFT JOIN site_domains cd ON cd.id = (
            SELECT id FROM site_domains
            WHERE restaurant_id = r.id AND domain_type = 'custom'
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        )
        LEFT JOIN publish_events pe ON pe.id = (
            SELECT id FROM publish_events
            WHERE restaurant_id = r.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        )
        ORDER BY r.created_at DESC
    `;
    const restaurants = db.prepare(query).all();
    res.json(restaurants);
});

app.get('/api/admin/restaurants/:id', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.*, u.email as owner_email, u.is_active as owner_is_active,
               s.current_plan, s.template_key, s.accent_color, s.hero_title,
               s.hero_subtitle, s.seo_title, s.seo_description, s.font_family,
               s.heading_style, s.menu_layout, s.dish_image_style
        FROM restaurants r
        JOIN users u ON r.owner_user_id = u.id
        JOIN site_configs s ON r.id = s.restaurant_id
        WHERE r.id = ?
    `).get(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const domains = db.prepare(`
        SELECT id, hostname, domain_type, is_primary, status, created_at, updated_at
        FROM site_domains
        WHERE restaurant_id = ?
        ORDER BY is_primary DESC, updated_at DESC, id DESC
    `).all(restaurant.id);

    const publishEvents = db.prepare(`
        SELECT id, trigger_type, target_hostname, status, message, created_at, finished_at
        FROM publish_events
        WHERE restaurant_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 10
    `).all(restaurant.id);

    const counts = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM menus WHERE restaurant_id = ?) as menus,
            (SELECT COUNT(*) FROM menu_categories mc JOIN menus m ON mc.menu_id = m.id WHERE m.restaurant_id = ?) as categories,
            (SELECT COUNT(*) FROM dishes di JOIN menu_categories mc ON di.category_id = mc.id JOIN menus m ON mc.menu_id = m.id WHERE m.restaurant_id = ?) as dishes,
            (SELECT COUNT(*) FROM opening_hours WHERE restaurant_id = ?) as opening_hours,
            (SELECT COUNT(*) FROM special_closures WHERE restaurant_id = ? AND is_active = 1) as active_closures,
            (SELECT COUNT(*) FROM media_assets WHERE restaurant_id = ? AND is_active = 1) as media_assets
    `).get(restaurant.id, restaurant.id, restaurant.id, restaurant.id, restaurant.id, restaurant.id);

    res.json({ restaurant, domains, publishEvents, counts });
});

app.patch('/api/admin/restaurants/:id/status', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const restaurant = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const isActive = normalizeBooleanFlag(req.body && req.body.is_active);
    db.prepare('UPDATE restaurants SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isActive, restaurant.id);
    res.json({ success: true, is_active: isActive });
});

app.patch('/api/admin/restaurants/:id/plan', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.id, s.current_plan
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
        WHERE r.id = ?
    `).get(req.params.id);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    try {
        const newPlan = normalizePlan(req.body && req.body.current_plan);
        const transaction = db.transaction(() => {
            if (restaurant.current_plan !== newPlan) {
                db.prepare(`
                    INSERT INTO plan_change_log (restaurant_id, old_plan, new_plan, changed_by_user_id)
                    VALUES (?, ?, ?, ?)
                `).run(restaurant.id, restaurant.current_plan, newPlan, req.session.userId);
            }
            db.prepare(`
                UPDATE site_configs
                SET current_plan = ?,
                    ads_enabled = ?,
                    donation_hint_enabled = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE restaurant_id = ?
            `).run(newPlan, newPlan === 'free' ? 1 : 0, newPlan === 'free' ? 1 : 0, restaurant.id);
        });
        transaction();
        res.json({ success: true, current_plan: newPlan });
    } catch (error) {
        if (error.message === 'INVALID_PLAN') return sendValidationError(res, error);
        res.status(500).json({ error: 'Plan update failed.' });
    }
});

app.patch('/api/admin/domains/:id/status', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const domain = db.prepare('SELECT id, restaurant_id, hostname FROM site_domains WHERE id = ?').get(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found.' });

    try {
        const status = normalizeDomainStatus(req.body && req.body.status);
        const isPrimary = normalizeBooleanFlag(req.body && req.body.is_primary);
        const eventStatus = req.body && req.body.publish_status ? normalizePublishStatus(req.body.publish_status) : null;
        const message = normalizeNullableText(req.body && req.body.message, 500);

        const transaction = db.transaction(() => {
            if (isPrimary && status === 'active') {
                db.prepare('UPDATE site_domains SET is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE restaurant_id = ?').run(domain.restaurant_id);
            }
            db.prepare(`
                UPDATE site_domains
                SET status = ?, is_primary = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(status, status === 'active' ? isPrimary : 0, domain.id);

            if (eventStatus) {
                db.prepare(`
                    INSERT INTO publish_events (restaurant_id, trigger_type, target_hostname, status, message, finished_at)
                    VALUES (?, 'domain_change', ?, ?, ?, CURRENT_TIMESTAMP)
                `).run(domain.restaurant_id, domain.hostname, eventStatus, message || 'Domainstatus im Plattform-Admin aktualisiert.');
            }
        });
        transaction();
        res.json({ success: true, status, is_primary: status === 'active' ? isPrimary : 0 });
    } catch (error) {
        if (['INVALID_DOMAIN_STATUS', 'INVALID_PUBLISH_STATUS'].includes(error.message)) return sendValidationError(res, error);
        res.status(500).json({ error: 'Domain status update failed.' });
    }
});

// --- Help Routes ---

app.get('/api/help/articles', (req, res) => {
    const articles = db.prepare('SELECT id, title, slug, article_type, sort_order FROM help_articles WHERE is_published = 1 ORDER BY sort_order ASC').all();
    res.json(articles);
});

app.get('/api/help/articles/:id', (req, res) => {
    const article = db.prepare('SELECT * FROM help_articles WHERE id = ? AND is_published = 1').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    res.json(article);
});

ensureApplicationTables();
ensureDefaultHelpArticles();
ensureDefaultDomainProviders();
ensureDefaultPlatformSettings();
ensureDefaultAdSlots();

app.listen(port, () => {
    console.log(`Restiq running at http://localhost:${port}`);
    console.log(`Interner statischer Export: publish/<slug>/`);
    console.log(`Cloudflare Pages Export: cloudflare-export/<slug>/`);
});
