-- Restiq Relational Data Model V1
-- Target: SQLite

PRAGMA foreign_keys = ON;

-- 1. Users
-- Account identity and roles
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('platform_admin', 'restaurant_owner')),
    is_active INTEGER NOT NULL DEFAULT 1, -- 0 = inactive, 1 = active
    last_login_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Restaurants
-- The core business entity
CREATE TABLE restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    restaurant_name TEXT NOT NULL,
    public_slug_internal TEXT UNIQUE NOT NULL, -- Internal slug, not necessarily the domain
    short_description TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    street TEXT NOT NULL,
    house_number TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    city TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Deutschland',
    legal_name TEXT,
    tax_or_vat_note TEXT,
    whatsapp TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    tiktok_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Site Configs
-- Website-specific configuration. 1:1 with restaurant.
CREATE TABLE site_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER UNIQUE NOT NULL,
    current_plan TEXT NOT NULL CHECK(current_plan IN ('free', 'paid')),
    template_key TEXT NOT NULL DEFAULT 'default',
    ads_enabled INTEGER NOT NULL DEFAULT 1, -- Feature flag for ads
    donation_hint_enabled INTEGER NOT NULL DEFAULT 1, -- Feature flag for donations
    is_published INTEGER NOT NULL DEFAULT 0,
    primary_language TEXT NOT NULL DEFAULT 'de',
    accent_color TEXT,
    hero_title TEXT,
    hero_subtitle TEXT,
    about_text TEXT,
    logo_image_url TEXT,
    hero_image_url TEXT,
    footer_note TEXT,
    seo_title TEXT,
    seo_description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- 4. Opening Hours
-- Weekly schedule
CREATE TABLE opening_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), -- 0 = Monday, 6 = Sunday
    is_closed INTEGER NOT NULL DEFAULT 0,
    open_time_1 TEXT, -- Format HH:MM
    close_time_1 TEXT,
    open_time_2 TEXT, -- For split shifts
    close_time_2 TEXT,
    note TEXT,
    UNIQUE(restaurant_id, weekday),
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- 5. Menus
-- High level menu container
CREATE TABLE menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- 6. Menu Categories
-- Categories within a menu (e.g. Pizza, Drinks)
CREATE TABLE menu_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    category_name TEXT NOT NULL,
    display_mode TEXT NOT NULL DEFAULT 'vertical' CHECK(display_mode IN ('vertical', 'horizontal')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(menu_id, sort_order),
    FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
);

-- 7. Dishes
-- Specific items in a category
CREATE TABLE dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    dish_name TEXT NOT NULL,
    price_cents INTEGER NOT NULL, -- Stored in cents to avoid rounding issues
    currency_code TEXT NOT NULL DEFAULT 'EUR',
    description_text TEXT NOT NULL,
    ingredients_text TEXT NOT NULL, -- Separated as requested
    allergens_text TEXT NOT NULL, -- Separated as requested
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    image_url TEXT,
    badge_text TEXT, -- e.g. "Vegan", "Chef's Recommendation"
    internal_note TEXT,
    UNIQUE(category_id, sort_order),
    FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE CASCADE
);

-- 8. Site Domains
-- Mapping of hostnames to restaurants
CREATE TABLE site_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    hostname TEXT UNIQUE NOT NULL,
    domain_type TEXT NOT NULL CHECK(domain_type IN ('free_generated', 'custom')),
    is_primary INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'failed', 'disabled')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- Trigger/Constraint logic (Partial Index for Single Primary Active Domain)
CREATE UNIQUE INDEX idx_unique_primary_active_domain 
ON site_domains (restaurant_id) 
WHERE is_primary = 1 AND status = 'active';

-- 9. Publish Events
-- Audit log of publishing actions
CREATE TABLE publish_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('initial_publish', 'manual_update', 'plan_change', 'domain_change')),
    target_hostname TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'success', 'error')),
    message TEXT,
    finished_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- 10. Plan Change Log
-- History of tier changes
CREATE TABLE plan_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    old_plan TEXT NOT NULL CHECK(old_plan IN ('free', 'paid')),
    new_plan TEXT NOT NULL CHECK(new_plan IN ('free', 'paid')),
    changed_by_user_id INTEGER NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 11. Help Articles
-- Global platform education content
CREATE TABLE help_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_type TEXT NOT NULL CHECK(article_type IN ('tutorial', 'help', 'faq')),
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content_markdown TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. Domain Providers
-- External partners for domain registration/hosting
CREATE TABLE domain_providers (
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

-- 13. Sessions
-- Persistent express-session store
CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. Indexes for Performance
CREATE INDEX idx_restaurants_owner_user_id ON restaurants(owner_user_id);
CREATE INDEX idx_menus_restaurant_id ON menus(restaurant_id);
CREATE INDEX idx_menu_categories_menu_id ON menu_categories(menu_id);
CREATE INDEX idx_dishes_category_id ON dishes(category_id);
CREATE INDEX idx_opening_hours_restaurant_id ON opening_hours(restaurant_id);
CREATE INDEX idx_site_domains_restaurant_id ON site_domains(restaurant_id);
CREATE INDEX idx_publish_events_restaurant_id ON publish_events(restaurant_id);
CREATE INDEX idx_plan_change_log_restaurant_id ON plan_change_log(restaurant_id);
CREATE INDEX idx_sessions_expires ON sessions(expires);
