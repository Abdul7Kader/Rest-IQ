require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./lib/db');
const { hashPassword, verifyPassword, isAuthenticated, hasRole } = require('./lib/auth');
const SQLiteSessionStore = require('./lib/session-store');

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_NAME = 'restiq.sid';
const SESSION_SECRET = process.env.SESSION_SECRET || 'restiq-fallback-secret';

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
            resolve();
        });
    });
}

const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });

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

function normalizeBooleanFlag(value) {
    return value === false || value === 0 || value === '0' || value === 'false' ? 0 : 1;
}

function getOwnerRestaurant(userId) {
    return db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(userId);
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
        INVALID_PRICE: 'Invalid price.',
        INVALID_DISPLAY_MODE: 'Invalid display mode.',
        REQUIRED_TITLE: 'Title is required.',
        REQUIRED_NAME: 'Name is required.',
        REQUIRED_PRICE: 'Price is required.'
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
        VALUES (?, 'free', 'free_default', 1, 1, ?, ?)
    `).run(
        restaurantId,
        restaurantName,
        String(payload.short_description || '').trim()
    );
    db.prepare('INSERT INTO menus (restaurant_id, title) VALUES (?, ?)').run(restaurantId, 'Speisekarte');

    return { id: restaurantId, slug };
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
            '6. Klicken Sie auf Lokal Veröffentlichen.',
            '',
            'Die lokale Veröffentlichung ist noch kein echtes externes Cloudflare-Deployment. Sie ist der technische Zwischenstand, den Sie prüfen können.'
        ].join('\n')
    },
    {
        article_type: 'help',
        title: 'Was bedeutet Vorschau, Published und Cloudflare?',
        slug: 'preview-published-cloudflare',
        sort_order: 1,
        content_markdown: [
            '# Vorschau, Published und Cloudflare',
            'Die Vorschau zeigt die aktuelle interne Darstellung im Dashboard. Sie ist nur für angemeldete Nutzer gedacht.',
            '',
            'Published ist die lokal erzeugte statische Seite. Sie ist ohne Login unter /published/<slug> erreichbar.',
            '',
            'Cloudflare vorbereiten erzeugt einen Export-Ordner für den späteren manuellen Upload. Dieser Schritt verbindet noch keine echte Domain automatisch.'
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
            'Nutzen Sie Bilder nur, wenn sie wirklich zum Gericht passen und zuverlässig über eine URL erreichbar sind.'
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
        db.prepare("DELETE FROM help_articles WHERE slug IN ('erste-schritte', 'menue-bearbeiten')").run();
        for (const article of DEFAULT_HELP_ARTICLES) {
            upsert.run(article);
        }
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
    `);
}

// --- Auth Routes ---

app.post('/api/auth/register', authRateLimit, async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const { password } = body;

    if (!isValidEmail(email) || !password || password.length < 8) {
        return res.status(400).json({ error: 'Invalid email or password (min 8 characters).' });
    }
    if (password.length > 128) {
        return res.status(400).json({ error: 'Password is too long.' });
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

// --- Restaurant Routes (Expanded) ---

app.get('/api/restaurant', isAuthenticated, (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.*, s.current_plan, s.template_key, s.ads_enabled, s.donation_hint_enabled,
               s.is_published, s.primary_language, s.accent_color, s.hero_title,
               s.hero_subtitle, s.about_text, s.logo_image_url, s.hero_image_url,
               s.footer_note, s.seo_title, s.seo_description
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
        seo_description: restaurant.seo_description
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
    let nextStep = 'Seite lokal veroeffentlichen';
    if (restaurant.is_published === 1 && restaurant.free_domain_status !== 'pending' && restaurant.free_domain_status !== 'active') {
        nextStep = 'Cloudflare-Export vorbereiten';
    } else if (restaurant.free_domain_status === 'pending') {
        nextStep = 'Manuellen Cloudflare-Upload pruefen';
    } else if (restaurant.free_domain_status === 'active') {
        nextStep = 'Live-Seite pruefen';
    }

    res.json({
        restaurantId: restaurant.id,
        restaurantName: restaurant.restaurant_name,
        slug: restaurant.public_slug_internal,
        plan: restaurant.current_plan,
        template: restaurant.template_key,
        isPublished: restaurant.is_published === 1,
        localPublishedUrl: restaurant.is_published === 1 ? `/published/${restaurant.public_slug_internal}` : null,
        expectedFreeHostname,
        freeHostname: restaurant.free_hostname || expectedFreeHostname,
        freeDomainStatus: restaurant.free_domain_status || 'not_prepared',
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

    const hasBasics = Boolean(
        restaurant.restaurant_name &&
        restaurant.short_description &&
        restaurant.contact_email &&
        restaurant.contact_phone &&
        restaurant.street &&
        restaurant.city
    );
    const hasDesign = Boolean(restaurant.hero_title || restaurant.hero_subtitle || restaurant.about_text || restaurant.logo_image_url || restaurant.hero_image_url);
    const hasMenu = menuStats.categories > 0 && menuStats.dishes > 0;
    const hasHours = openingHoursCount >= 7;
    const hasClosures = closuresCount > 0;
    const isPublished = restaurant.is_published === 1;
    const cfPrepared = restaurant.free_domain_status === 'pending' || restaurant.free_domain_status === 'active';

    const steps = [
        { key: 'basics', label: 'Grunddaten vervollständigen', done: hasBasics, targetTab: 'base' },
        { key: 'hours', label: 'Öffnungszeiten prüfen', done: hasHours, targetTab: 'hours' },
        { key: 'closures', label: 'Urlaub und Schließzeiten prüfen', done: hasClosures, targetTab: 'closures' },
        { key: 'menu', label: 'Speisekarte mit Kategorien und Gerichten pflegen', done: hasMenu, targetTab: 'menu' },
        { key: 'design', label: 'Design, Hero und Beschreibung prüfen', done: hasDesign, targetTab: 'design' },
        { key: 'preview', label: 'Vorschau öffnen und Seite kontrollieren', done: isPublished, url: '/preview' },
        { key: 'publish', label: 'Lokal veröffentlichen', done: isPublished, action: 'publish' },
        { key: 'cloudflare', label: 'Cloudflare-Export vorbereiten', done: cfPrepared, action: 'cf-prepare' }
    ];

    const completed = steps.filter(step => step.done).length;
    const next = steps.find(step => !step.done) || {
        key: 'complete',
        label: 'Alle Schritte geprüft',
        done: true
    };

    res.json({
        completed,
        total: steps.length,
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
        logo_image_url: normalizeHttpUrl,
        hero_image_url: normalizeHttpUrl,
        footer_note: value => trimText(value, 300),
        accent_color: normalizeCssColor,
        primary_language: value => trimText(value, 10) || 'de',
        template_key: normalizeTemplateKey
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

app.post('/api/menu/categories', isAuthenticated, hasRole('restaurant_owner'), (req, res) => {
    const { menu_id } = req.body;
    
    // Auth Check
    const menu = db.prepare('SELECT m.id FROM menus m JOIN restaurants r ON m.restaurant_id = r.id WHERE m.id = ? AND r.owner_user_id = ?').get(menu_id, req.session.userId);
    if (!menu) return res.status(403).json({ error: 'Forbidden' });

    let categoryName;
    let displayMode;
    let sortOrder;
    try {
        categoryName = trimText(req.body.category_name, 120);
        if (!categoryName) throw new Error('REQUIRED_NAME');
        displayMode = normalizeDisplayMode(req.body.display_mode);
        sortOrder = req.body.sort_order === undefined || req.body.sort_order === ''
            ? getNextCategorySort(menu_id)
            : normalizeInteger(req.body.sort_order);
    } catch (error) {
        return sendValidationError(res, error);
    }

    try {
        const info = db.prepare('INSERT INTO menu_categories (menu_id, category_name, display_mode, sort_order) VALUES (?, ?, ?, ?)').run(menu_id, categoryName, displayMode, sortOrder);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add category.' });
    }
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
            image_url: normalizeHttpUrl(req.body.image_url),
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
            image_url: normalizeHttpUrl,
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
            accentColor: c.accent_color || '#2563eb',
            language: c.primary_language || 'de',
            plan: c.current_plan
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
                mode: cat.display_mode,
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
            renderedAt: new Date().toISOString()
        }
    };

    return viewModel;
}

app.get('/api/preview', isAuthenticated, (req, res) => {
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

app.get('/published/:slug', (req, res) => {
    const restaurant = db.prepare(`
        SELECT r.public_slug_internal, s.is_published
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
        WHERE r.public_slug_internal = ? AND r.is_active = 1
    `).get(req.params.slug);

    if (!restaurant || restaurant.is_published !== 1) {
        return res.status(404).send('Diese Restiq-Seite wurde noch nicht veroeffentlicht.');
    }

    res.sendFile(path.join(__dirname, 'publish', restaurant.public_slug_internal, 'index.html'));
});

app.use('/published/:slug', (req, res, next) => {
    const restaurant = db.prepare(`
        SELECT r.public_slug_internal, s.is_published
        FROM restaurants r
        JOIN site_configs s ON r.id = s.restaurant_id
        WHERE r.public_slug_internal = ? AND r.is_active = 1
    `).get(req.params.slug);

    if (!restaurant || restaurant.is_published !== 1) {
        return res.status(404).send('Diese Restiq-Seite wurde noch nicht veroeffentlicht.');
    }

    express.static(path.join(__dirname, 'publish', restaurant.public_slug_internal))(req, res, next);
});

// --- Publish API ---

app.post('/api/restaurant/publish', isAuthenticated, (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const config = db.prepare('SELECT current_plan FROM site_configs WHERE restaurant_id = ?').get(restaurant.id);
    if (config.current_plan !== 'free') {
        return res.status(400).json({ error: 'Local publish is only supported for the free plan.' });
    }

    try {
        const viewModel = getPreviewData(restaurant.id, { previewMode: false });
        const { exportStaticSite } = require('./lib/publisher');
        const exportPath = exportStaticSite(restaurant.public_slug_internal, viewModel);

        const transaction = db.transaction(() => {
            db.prepare('UPDATE site_configs SET is_published = 1, updated_at = CURRENT_TIMESTAMP WHERE restaurant_id = ?').run(restaurant.id);
            db.prepare('INSERT INTO publish_events (restaurant_id, trigger_type, target_hostname, status, finished_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
              .run(restaurant.id, 'manual_update', 'local_filesystem', 'success');
        });
        transaction();

        res.json({ success: true, exportPath });
    } catch (e) {
        console.error('Publish error:', e);
        try {
            db.prepare('INSERT INTO publish_events (restaurant_id, trigger_type, target_hostname, status, message, finished_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
              .run(restaurant.id, 'manual_update', 'local_filesystem', 'error', e.message);
        } catch(logErr) { console.error('Failed to log error to publish_events', logErr); }
        res.status(500).json({ error: 'Publish failed.', details: e.message });
    }
});

// --- Cloudflare Pages Preparation API ---
// Bereitet den Cloudflare Pages Export vor (Free Plan only).
// Setzt voraus, dass zuvor ein lokaler Publish-Export existiert.
// Erstellt cloudflare-export/<slug>/ mit _redirects, _headers, deploy-info.json.

app.post('/api/restaurant/cf-prepare', isAuthenticated, (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const config = db.prepare('SELECT current_plan, is_published FROM site_configs WHERE restaurant_id = ?').get(restaurant.id);
    if (config.current_plan !== 'free') {
        return res.status(400).json({ error: 'Cloudflare Pages preparation is only available for the free plan.' });
    }
    if (!config.is_published) {
        return res.status(400).json({ error: 'Bitte zuerst lokal veröffentlichen (Publish), bevor der Cloudflare-Export vorbereitet wird.' });
    }

    try {
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

// Admin: Cloudflare Prepare für beliebiges Restaurant (Admin only)
app.post('/api/admin/cf-prepare/:restaurantId', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.restaurantId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const config = db.prepare('SELECT current_plan, is_published FROM site_configs WHERE restaurant_id = ?').get(restaurant.id);
    if (config.current_plan !== 'free') {
        return res.status(400).json({ error: 'Only free plan supported.' });
    }

    try {
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

app.get('/api/admin/restaurants', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const query = `
        SELECT r.*, u.email as owner_email, s.current_plan, s.is_published,
               s.template_key, d.hostname as free_hostname, d.status as free_domain_status,
               pe.status as last_publish_status, pe.created_at as last_publish_at,
               pe.message as last_publish_message
        FROM restaurants r
        JOIN users u ON r.owner_user_id = u.id
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
        ORDER BY r.created_at DESC
    `;
    const restaurants = db.prepare(query).all();
    res.json(restaurants);
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

app.listen(port, () => {
    console.log(`Restiq running at http://localhost:${port}`);
    console.log(`Lokaler Publish-Export: publish/<slug>/`);
    console.log(`Cloudflare Pages Export: cloudflare-export/<slug>/`);
});
