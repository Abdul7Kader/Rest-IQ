-- Gastrofy Seed Data V1

-- 1. Users
INSERT INTO users (id, email, password_hash, role) VALUES 
(1, 'admin@gastrofy.app', '$2b$12$gCTVjcu.d6SCnu6PQ5SoHO/1P0aXifJKDNaY1tgqhmx.2hnXaCn.O', 'platform_admin'),
(2, 'mario@trattoria-mario.de', '$2b$12$mNPidYzU04C38MxQMYl5uudFRthHu/WhAiK6FmVn/RG5b9WVcstmy', 'restaurant_owner');

-- 2. Restaurants
INSERT INTO restaurants (id, owner_user_id, restaurant_name, public_slug_internal, short_description, contact_email, contact_phone, street, house_number, postal_code, city) VALUES 
(1, 2, 'Trattoria Mario', 'trattoria-mario', 'Original italienische Küche im Herzen der Stadt.', 'info@trattoria-mario.de', '+49 123 456789', 'Italienstraße', '42', '12345', 'München');

-- 3. Site Configs
INSERT INTO site_configs (restaurant_id, current_plan, template_key, ads_enabled, donation_hint_enabled, is_published, accent_color, hero_title, hero_subtitle) VALUES 
(1, 'free', 'default', 1, 1, 1, '#ff4500', 'Willkommen bei Mario', 'Echte Pizza, echte Leidenschaft.');

-- 4. Opening Hours
INSERT INTO opening_hours (restaurant_id, weekday, is_closed, open_time_1, close_time_1) VALUES 
(1, 0, 0, '11:00', '22:00'), -- Monday
(1, 1, 0, '11:00', '22:00'), -- Tuesday
(1, 2, 0, '11:00', '22:00'), -- Wednesday
(1, 3, 0, '11:00', '22:00'), -- Thursday
(1, 4, 0, '11:00', '23:00'), -- Friday
(1, 5, 0, '12:00', '23:00'), -- Saturday
(1, 6, 1, NULL, NULL);        -- Sunday

-- 5. Menus
INSERT INTO menus (id, restaurant_id, title) VALUES 
(1, 1, 'Hauptspeisekarte');

-- 6. Menu Categories
INSERT INTO menu_categories (id, menu_id, category_name, display_mode, sort_order) VALUES 
(1, 1, 'Pizza', 'vertical', 0),
(2, 1, 'Pasta', 'horizontal', 1);

-- 7. Dishes
INSERT INTO dishes (category_id, dish_name, price_cents, description_text, ingredients_text, allergens_text, sort_order) VALUES 
(1, 'Pizza Margherita', 850, 'Der Klassiker mit Tomaten, Mozzarella und Basilikum.', 'Weizenmehl, Tomatensauce, Mozzarella, Basilikum', 'Gluten, Milch', 0),
(1, 'Pizza Diavola', 1050, 'Scharfe Salami und Peperoni.', 'Weizenmehl, Tomatensauce, Mozzarella, scharfe Salami, Peperoni', 'Gluten, Milch', 1),
(2, 'Spaghetti Carbonara', 1100, 'Nach original italienischem Rezept.', 'Spaghetti, Guanciale, Ei, Pecorino Romano', 'Gluten, Ei, Milch', 0),
(2, 'Penne all''Arrabbiata', 950, 'Scharfe Tomatensauce mit Knoblauch.', 'Penne, Tomatensauce, Chili, Knoblauch', 'Gluten', 1);

-- 8. Site Domains
INSERT INTO site_domains (restaurant_id, hostname, domain_type, is_primary, status) VALUES 
(1, 'trattoria-mario-gastrofy.pages.dev', 'free_generated', 1, 'active');

-- 11. Help Articles
INSERT INTO help_articles (article_type, title, slug, content_markdown, sort_order) VALUES 
('tutorial', 'Erste Schritte', 'erste-schritte', '# Willkommen bei Gastrofy\nIn diesem Tutorial lernst du, wie du dein Restaurant einrichtest...', 0),
('help', 'Wie bearbeite ich mein Menü', 'menue-bearbeiten', '# Menüverwaltung\nGehe zum Bereich "Menü", um Kategorien und Gerichte hinzuzufügen...', 1);

-- 12. Domain Providers
INSERT INTO domain_providers (provider_name, provider_type, website_url, affiliate_base_url, supports_free_domains, supports_paid_domains) VALUES 
('Cloudflare', 'free_hosting', 'https://cloudflare.com', NULL, 1, 0),
('Namecheap', 'registrar', 'https://namecheap.com', 'https://namecheap.com?aff=gastrofy', 0, 1);
