-- Restiq Seed Data V1

-- 1. Users
INSERT INTO users (id, email, password_hash, role) VALUES 
(1, 'admin@restiq.app', '$2b$12$gCTVjcu.d6SCnu6PQ5SoHO/1P0aXifJKDNaY1tgqhmx.2hnXaCn.O', 'platform_admin'),
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
(1, 'trattoria-mario-restiq.pages.dev', 'free_generated', 1, 'active');

-- 11. Help Articles
INSERT INTO help_articles (article_type, title, slug, content_markdown, sort_order) VALUES 
('tutorial', 'Schnellstart: Von Grunddaten bis Veröffentlichung', 'schnellstart-veroeffentlichung', '# Schnellstart\nDieser Ablauf bringt Ihre kostenlose Restaurantseite in eine testbare Veröffentlichung.\n\n1. Prüfen Sie im Bereich Grunddaten Name, Beschreibung, Kontakt und Adresse.\n2. Tragen Sie im Bereich Öffnungszeiten die regulären Zeiten ein.\n3. Legen Sie in der Speisekarte Kategorien und Gerichte an.\n4. Passen Sie unter Design & Hero die Überschrift, Farbe und Bilder an.\n5. Öffnen Sie die Vorschau und prüfen Sie die Seite.\n6. Klicken Sie auf Lokal Veröffentlichen.\n\nDie lokale Veröffentlichung ist noch kein echtes externes Cloudflare-Deployment. Sie ist der technische Zwischenstand, den Sie prüfen können.', 0),
('help', 'Was bedeutet Vorschau, Published und Cloudflare?', 'preview-published-cloudflare', '# Vorschau, Published und Cloudflare\nDie Vorschau zeigt die aktuelle interne Darstellung im Dashboard. Sie ist nur für angemeldete Nutzer gedacht.\n\nPublished ist die lokal erzeugte statische Seite. Sie ist ohne Login unter /published/<slug> erreichbar.\n\nCloudflare vorbereiten erzeugt einen Export-Ordner für den späteren manuellen Upload. Dieser Schritt verbindet noch keine echte Domain automatisch.', 1),
('tutorial', 'Speisekarte sinnvoll strukturieren', 'speisekarte-strukturieren', '# Speisekarte strukturieren\nArbeiten Sie zuerst mit wenigen klaren Kategorien, zum Beispiel Vorspeisen, Pizza, Pasta, Getränke.\n\nFür jedes Gericht sollten Name, Preis und Beschreibung gepflegt sein. Zutaten und Allergene sind eigene Felder, damit sie später besser dargestellt oder gefiltert werden können.\n\nNutzen Sie Bilder nur, wenn sie wirklich zum Gericht passen und zuverlässig über eine URL erreichbar sind.', 2),
('faq', 'Was ist in der kostenlosen Stufe enthalten?', 'kostenlose-stufe', '# Kostenlose Stufe\nDie kostenlose Stufe enthält eine selbst konfigurierte Restaurantseite mit Restiq-Branding, Werbeplatzhaltern und Spendenhinweis.\n\nNicht enthalten sind eine eigene Kundendomain, werbefreie Darstellung, individuelle Designentwicklung, inhaltliche Pflege durch Restiq oder Domain-Support.', 3);

-- 12. Domain Providers
INSERT INTO domain_providers (provider_name, provider_type, website_url, affiliate_base_url, supports_free_domains, supports_paid_domains) VALUES 
('Cloudflare', 'free_hosting', 'https://cloudflare.com', NULL, 1, 0),
('Namecheap', 'registrar', 'https://namecheap.com', 'https://namecheap.com?aff=restiq', 0, 1);
