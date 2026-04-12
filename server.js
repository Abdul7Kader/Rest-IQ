require('dotenv').config();
const express = require('express');
const session = require('express-session');
const db = require('./lib/db');
const { hashPassword, verifyPassword, isAuthenticated, hasRole } = require('./lib/auth');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Session setup (In-memory for Dev/V1)
app.use(session({
    secret: process.env.SESSION_SECRET || 'gastrofy-fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true for HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// --- Auth Routes ---

app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password || password.length < 8) {
        return res.status(400).json({ error: 'Invalid email or password (min 8 characters).' });
    }

    try {
        const hash = await hashPassword(password);
        const stmt = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)');
        stmt.run(email, hash, 'restaurant_owner');
        res.json({ success: true });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed: users.email')) {
            return res.status(400).json({ error: 'Email already registered.' });
        }
        res.status(500).json({ error: 'Registration failed.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
        }

        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.email = user.email;

        res.json({ success: true, user: { email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
    if (req.session.userId) {
        res.json({ userId: req.session.userId, email: req.session.email, role: req.session.role });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// --- Restaurant Routes (Expanded) ---

app.patch('/api/restaurant', isAuthenticated, (req, res) => {
    const fields = [
        'restaurant_name', 'short_description', 'contact_email', 'contact_phone', 
        'street', 'house_number', 'postal_code', 'city', 'country', 
        'whatsapp', 'instagram_url', 'facebook_url', 'tiktok_url'
    ];
    const configFields = [
        'hero_title', 'hero_subtitle', 'about_text', 'logo_image_url', 
        'hero_image_url', 'footer_note', 'accent_color', 'primary_language',
        'template_key'
    ];
    
    const updates = [];
    const values = [];

    for (const field of fields) {
        if (req.body[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(req.body[field]);
        }
    }

    const configUpdates = [];
    const configValues = [];
    for (const field of configFields) {
        if (req.body[field] !== undefined) {
            configUpdates.push(`${field} = ?`);
            configValues.push(req.body[field]);
        }
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
                const restaurant = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
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

app.get('/api/opening-hours', isAuthenticated, (req, res) => {
    const hours = db.prepare(`
        SELECT oh.* FROM opening_hours oh
        JOIN restaurants r ON oh.restaurant_id = r.id
        WHERE r.owner_user_id = ?
        ORDER BY oh.weekday ASC
    `).all(req.session.userId);
    res.json(hours);
});

app.post('/api/opening-hours', isAuthenticated, (req, res) => {
    const { hours } = req.body; // Array of 7 days
    if (!Array.isArray(hours)) return res.status(400).json({ error: 'Invalid hours format.' });

    const restaurant = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
    
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
                upsert.run(restaurant.id, h.weekday, h.is_closed ? 1 : 0, h.open_time_1, h.close_time_1, h.open_time_2, h.close_time_2, h.note);
            }
        });
        transaction(hours);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update hours.' });
    }
});

// --- Menus, Categories, Dishes ---

app.get('/api/menu', isAuthenticated, (req, res) => {
    const restaurant = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
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

app.post('/api/menu/categories', isAuthenticated, (req, res) => {
    const { menu_id, category_name, display_mode, sort_order } = req.body;
    
    // Auth Check
    const menu = db.prepare('SELECT m.id FROM menus m JOIN restaurants r ON m.restaurant_id = r.id WHERE m.id = ? AND r.owner_user_id = ?').get(menu_id, req.session.userId);
    if (!menu) return res.status(403).json({ error: 'Forbidden' });

    try {
        const info = db.prepare('INSERT INTO menu_categories (menu_id, category_name, display_mode, sort_order) VALUES (?, ?, ?, ?)').run(menu_id, category_name, display_mode || 'vertical', sort_order || 0);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add category.' });
    }
});

app.patch('/api/menu/categories/:id', isAuthenticated, (req, res) => {
    if (!checkCategoryOwnership(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Forbidden' });

    const { category_name, display_mode, sort_order, is_active } = req.body;
    const stmt = db.prepare('UPDATE menu_categories SET category_name = ?, display_mode = ?, sort_order = ?, is_active = ? WHERE id = ?');
    stmt.run(category_name, display_mode, sort_order, is_active ? 1 : 0, req.params.id);
    res.json({ success: true });
});

app.delete('/api/menu/categories/:id', isAuthenticated, (req, res) => {
    if (!checkCategoryOwnership(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM menu_categories WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.post('/api/dishes', isAuthenticated, (req, res) => {
    const { category_id, dish_name, price_cents, description_text, ingredients_text, allergens_text, sort_order, image_url, badge_text } = req.body;
    if (!checkCategoryOwnership(req.session.userId, category_id)) return res.status(403).json({ error: 'Forbidden' });

    try {
        const info = db.prepare(`
            INSERT INTO dishes (category_id, dish_name, price_cents, description_text, ingredients_text, allergens_text, sort_order, image_url, badge_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(category_id, dish_name, price_cents, description_text || '', ingredients_text || '', allergens_text || '', sort_order || 0, image_url, badge_text);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add dish.' });
    }
});

app.patch('/api/dishes/:id', isAuthenticated, (req, res) => {
    const dish = db.prepare(`
        SELECT d.id FROM dishes d
        JOIN menu_categories mc ON d.category_id = mc.id
        JOIN menus m ON mc.menu_id = m.id
        JOIN restaurants r ON m.restaurant_id = r.id
        WHERE d.id = ? AND r.owner_user_id = ?
    `).get(req.params.id, req.session.userId);
    if (!dish) return res.status(403).json({ error: 'Forbidden' });

    const fields = ['dish_name', 'price_cents', 'description_text', 'ingredients_text', 'allergens_text', 'sort_order', 'is_active', 'image_url', 'badge_text'];
    const sets = [];
    const values = [];
    for (const f of fields) {
        if (req.body[f] !== undefined) {
            sets.push(`${f} = ?`);
            values.push(f === 'is_active' ? (req.body[f] ? 1 : 0) : req.body[f]);
        }
    }
    values.push(req.params.id);
    db.prepare(`UPDATE dishes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    res.json({ success: true });
});

app.delete('/api/dishes/:id', isAuthenticated, (req, res) => {
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

function getPreviewData(restaurantId) {
    const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
    const c = db.prepare('SELECT * FROM site_configs WHERE restaurant_id = ?').get(restaurantId);
    const hours = db.prepare('SELECT * FROM opening_hours WHERE restaurant_id = ? ORDER BY weekday ASC').all(restaurantId);
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
            ].filter(s => s.open),
            note: h.note
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
            adsEnabled: c.ads_enabled === 1,
            donationHintEnabled: c.donation_hint_enabled === 1
        },
        meta: {
            previewMode: true,
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

// --- Publish API ---

app.post('/api/restaurant/publish', isAuthenticated, (req, res) => {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.session.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

    const config = db.prepare('SELECT current_plan FROM site_configs WHERE restaurant_id = ?').get(restaurant.id);
    if (config.current_plan !== 'free') {
        return res.status(400).json({ error: 'Local publish is only supported for the free plan.' });
    }

    try {
        const viewModel = getPreviewData(restaurant.id);
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

// --- Admin Routes ---

app.get('/api/admin/restaurants', isAuthenticated, hasRole('platform_admin'), (req, res) => {
    const query = `
        SELECT r.*, u.email as owner_email, s.current_plan 
        FROM restaurants r
        JOIN users u ON r.owner_user_id = u.id
        JOIN site_configs s ON r.id = s.restaurant_id
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

app.listen(port, () => {
    console.log(`Gastrofy Step 3 running at http://localhost:${port}`);
});
