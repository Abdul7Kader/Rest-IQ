# Relationales Datenmodell - Restiq V1

Dieses Dokument beschreibt das technische und fachliche Design der Restiq-Plattform für Version 1.

## 1. Identität vs. Domain (Decoupled Identity)

Ein zentrales Design-Prinzip von Restiq ist die strikte Trennung zwischen der **Identität eines Restaurants** und seinem **Hostname**.

- **Die Identität** ist die `id` in der Tabelle `restaurants`. Alle Daten (Menüs, Öffnungszeiten, Konfigurationen) sind an diese ID gebunden.
- **Domains/Hostnames** sind in der Cloud-Infrastruktur lediglich "Wegweiser" zum Inhalt. In der Tabelle `site_domains` können einem Restaurant beliebig viele Hostnames zugeordnet werden (z. B. ein kostenloser generierter Name und später eine eigene Premium-Domain).
- Dies ermöglicht es einem Restaurant, von der kostenlosen Stufe (mit `pages.dev`-Adresse) nahtlos in die bezahlte Stufe zu wechseln, ohne dass die internen Datenmodelle oder Verlinkungen geändert werden müssen.

## 2. Fachliche Stufen & Source of Truth

Die Plattform unterscheidet zwischen der **kostenlosen Stufe (free)** und der **bezahlten Stufe (paid)**.

- **Source of Truth**: Das Feld `site_configs.current_plan` ist die alleinige fachliche Autorität über den Status eines Restaurants.
- **Zahlungslogik**: In Version 1 steuert dieser Plan den fachlichen Zustand. Die eigentliche Zahlungsabwicklung erfolgt außerhalb des Systems oder wird in einer späteren Version integriert.
- **Feature-Flags**: Die Felder `ads_enabled` und `donation_hint_enabled` sind fachliche Flags, die standardmäßig vom Plan abgeleitet werden:
  - `free`: `ads_enabled = 1`, `donation_hint_enabled = 1`
  - `paid`: `ads_enabled = 0`, `donation_hint_enabled = 0` (Werbefreie Darstellung)
- **Onboarding**: Bei Registrierung kann der Restaurantinhaber den gewünschten Tarif und die Domain-Variante wählen. Die Wahl wird in `site_configs.current_plan` und `site_domains` gespeichert; echte Zahlung und DNS-Verifikation sind spätere Integrationsschritte.

## 3. Fachliche Regeln & Constraints

Um die Datenintegrität sicherzustellen, wurden folgende Regeln direkt im DB-Schema (SQLite) oder als fachlicher Standard implementiert:

- **Einzigartigkeit (UNIQUE)**:
  - `users.email`: Jeder Benutzer darf nur einmal registriert sein.
  - `restaurants.public_slug_internal`: Der interne URL-Slug muss systemweit eindeutig sein.
  - `site_configs.restaurant_id`: Jedes Restaurant hat genau eine Konfiguration (1:1).
  - `opening_hours(restaurant_id, weekday)`: Pro Wochentag darf es nur einen Eintrag pro Restaurant geben.
  - `site_domains.hostname`: Ein Hostname darf systemweit nur einmal vergeben werden.
- **Sortierreihenfolge**:
  - `menu_categories(menu_id, sort_order)`: Innerhalb eines Menüs muss die Sortierung eindeutig sein.
  - `dishes(category_id, sort_order)`: Innerhalb einer Kategorie muss die Sortierung eindeutig sein.
- **Primärer Hostname**:
  - Ein Restaurant kann mehrere Domains haben, aber nur **maximal ein aktiver primärer Hostname** ist erlaubt. Dies wird technisch über einen partiellen Index (`idx_unique_primary_active_domain`) abgesichert.

## 4. Plattform-Module

### 4.1 Help Center (`help_articles`)
Dieses Modul dient der plattformweiten Unterstützung der Restaurant-Besitzer.
- Inhalte sind in Markdown verfasst (`content_markdown`).
- Typen: `tutorial`, `help`, `faq`.
- Slugs sind systemweit eindeutig für direktes Routing im Help-Center Frontend.

### 4.2 Domain Ecosystem (`domain_providers`)
Bereitet die Integration externer Partner vor.
- **Affiliate-Modell**: Die Plattform führt keine direkten Domain-Käufe durch. Kunden werden über eine `affiliate_base_url` zum Anbieter (Registrar) weitergeleitet. Der Kauf findet außerhalb der Plattform statt.
- **Anbietertypen**: `registrar` (für Kauf), `free_hosting` (für Cloudflare-Integration), `both`.
- **Domainstatus**: Eine kostenlose Restiq-Adresse wird als `free_generated` gespeichert. Eigene Domains werden als `custom` mit `pending` gespeichert, bis eine spätere DNS-/Cloudflare-Prüfung die Inhaberschaft bestätigt.


## 5. Menü-Struktur

Die Speisekarte ist hierarchisch aufgebaut:
- `menus` -> `menu_categories` -> `dishes`.
- **Preise**: Werden als `INTEGER` in **Cents** gespeichert (`price_cents`), um Rundungsfehler durch Floating-Point-Arithmetik oder fehlerhafte Dezimal-Implemenierungen zu vermeiden.
- **Zutaten & Allergene**: Diese Informationen werden in getrennten Textfeldern gespeichert (`ingredients_text`, `allergens_text`), um spätere Filterfunktionen oder spezialisierte Darstellungen (Icons) zu ermöglichen.
- **Kategorie-Bilder**: `menu_categories.image_url` speichert eine validierte interne Upload-URL oder eine erlaubte externe `http/https`-URL.
- **Gericht-Bilder**: `dishes.image_url` bleibt das zentrale Bildfeld für Gerichte. Bilder werden über den Owner-Upload als Datei gespeichert; in der Datenbank wird nur die resultierende URL abgelegt.
- **Display Modes**: Kategorien unterstützen die Ausrichtung `vertical` und `horizontal`.
- **Layout Modes**: `menu_categories.layout_mode` kann pro Kategorie `inherit`, `list`, `cards` oder `compact` setzen. `inherit` übernimmt die globale Menü-Darstellung aus `site_configs.menu_layout`.
- **Drag-and-Drop-Sortierung**: Kategorien und Gerichte werden weiter über `sort_order` persistiert. Die Owner-Oberfläche speichert neue Reihenfolgen über dedizierte Reorder-APIs, die Restaurant-Eigentum und vollständige ID-Sets prüfen.

## 5.1 Design & Uploads

- **Upload-Sicherheit**: Restaurantbilder werden über `/api/uploads/image` angenommen. Erlaubt sind JPEG, PNG, WebP und GIF bis 4 MB. Der Server prüft Dateisignaturen und verlässt sich nicht nur auf den Browser-MIME-Type.
- **Speicherort**: Uploads liegen unter `public/uploads/restaurants/<restaurant_id>/...` und verwenden zufällige Dateinamen. Owner erhalten nur Zugriff auf den eigenen Upload-Endpunkt.
- **Designsteuerung**: `site_configs` enthält zusätzliche Owner-Optionen für `font_family`, `heading_style`, `menu_layout` und `dish_image_style`.
- **Export**: Interne Upload-Bilder werden beim Cloudflare-Export in den statischen Exportordner kopiert, damit Preview und späterer Pages-Export dieselben Bilddaten nutzen.

## 5.2 Öffnungszeiten & Sonderschließungen

- **Reguläre Öffnungszeiten**: `opening_hours` speichert pro Wochentag bis zu zwei Zeitfenster plus Notiz.
- **Sonderschließungen**: `special_closures` speichert Urlaubszeiten, Feiertage oder temporäre Schließungen mit Startdatum, Enddatum, Titel, Hinweis und Aktivstatus.
- **Darstellung**: Aktive aktuelle oder kommende Sonderschließungen werden in Preview und späteren Deploy-Exports aus dem zentralen ViewModel angezeigt.

## 6. Audit & History

- `publish_events`: Hält fest, wann welche Änderung auf welcher Domain veröffentlicht wurde.
- `plan_change_log`: Dokumentiert jeden Wechsel der Tarifstufe für spätere Support- oder Abrechnungsfälle.

## 7. Authentifizierung & Sessions

- **Passwort-Hashing**: Wird über `bcryptjs` mit einem Salt-Faktor von 12 realisiert.
- **Session-Management**: Nutzt `express-session` mit einem persistenten SQLite-Store in der Tabelle `sessions`.
- **Session-Schutz**: Session-IDs werden nicht im Klartext in der UI angezeigt, Cookies sind `httpOnly`, `sameSite=lax` und in Produktion `secure`. Beim Login und bei der Registrierung wird die Session neu erzeugt, um Session-Fixation zu vermeiden.
- **Ablauf & Wartung**: Sessions speichern einen Ablaufzeitpunkt (`expires`) und abgelaufene Einträge werden regelmäßig bereinigt. Für sehr hohe Last kann der Store später zentral im `server.js` gegen Redis oder einen anderen produktiven Session-Store getauscht werden.

## 8. Performance & Wartung

- **Indizes**: Alle Tabellen verfügen über Indizes auf zentralen Fremdschlüsseln (`restaurant_id`, `owner_user_id` etc.), um Abfragen in wachsenden Datenmengen performant zu halten.
- **Zeitstempel**: Die Felder `updated_at` müssen aktuell durch die Anwendungslogik gepflegt werden, da keine automatischen DB-Trigger für das Update der Zeitstempel existieren.
