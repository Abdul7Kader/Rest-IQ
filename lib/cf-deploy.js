/**
 * Restiq – Cloudflare Pages Export Preparation
 *
 * Verantwortlichkeit: Kopiert einen bereits fertigen lokalen Publish-Export
 * (publish/<slug>/) in den dedizierten Cloudflare-Export-Ordner
 * (cloudflare-export/<slug>/) und ergänzt Cloudflare-Pages-spezifische
 * Meta-Dateien (_redirects, _headers).
 *
 * Was dieses Modul NICHT tut:
 * - Keine eigene Render-Logik (nutzt fertig exportiertes Verzeichnis)
 * - Keine echte Cloudflare API-Anbindung
 * - Keine Paid-Plan-spezifischen Pfade
 * - Keine Consent- oder AdSense-Integration
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLISH_DIR = path.join(ROOT_DIR, 'publish');
const CF_EXPORT_DIR = path.join(ROOT_DIR, 'cloudflare-export');

/**
 * Kopiert alle Dateien und Unterverzeichnisse rekursiv.
 * @param {string} src Quellverzeichnis
 * @param {string} dest Zielverzeichnis
 */
function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Erstellt die _redirects-Datei für Cloudflare Pages.
 * Kostenlose Seiten werden unter dem Root-Pfad der Pages-Site ausgeliefert.
 * Der Redirect stellt sicher, dass auch /index.html korrekt aufgelöst wird.
 *
 * URL-Strategie kostenlose Seiten (free plan):
 *   <slug>-restiq.pages.dev/   → index.html (statische Seite)
 *
 * @param {string} targetDir Zielverzeichnis
 */
function writeRedirects(targetDir) {
    // Cloudflare Pages: SPA-Fallback nicht nötig (rein statisch),
    // aber /index redirect als Sicherheit
    const content = [
        '# Restiq – Cloudflare Pages Redirects',
        '# Kostenlose Restaurant-Seiten: statische Auslieferung ohne SPA-Routing',
        '/index /index.html 301',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(targetDir, '_redirects'), content, 'utf8');
}

/**
 * Erstellt die _headers-Datei für Cloudflare Pages.
 * Setzt grundlegende Sicherheitsheader und Cache-Strategie für statische Assets.
 *
 * @param {string} targetDir Zielverzeichnis
 */
function writeHeaders(targetDir) {
    const content = [
        '# Restiq – Cloudflare Pages Security & Cache Headers',
        '',
        '/*',
        '  X-Frame-Options: DENY',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '',
        '/css/*',
        '  Cache-Control: public, max-age=86400',
        '',
        '/js/*',
        '  Cache-Control: public, max-age=86400',
        '',
        '/templates/*',
        '  Cache-Control: public, max-age=86400',
        '',
        '/data.json',
        '  Cache-Control: no-cache',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(targetDir, '_headers'), content, 'utf8');
}

/**
 * Bereitet den Cloudflare Pages Export für ein Restaurant vor.
 *
 * Ablauf:
 * 1. Prüft, ob ein lokaler Publish-Export vorhanden ist
 * 2. Kopiert diesen in cloudflare-export/<slug>/
 * 3. Fügt _redirects und _headers hinzu
 * 4. Schreibt eine deploy-info.json als maschinenlesbare Metadaten
 *
 * @param {string} slug Der public_slug_internal des Restaurants
 * @param {number} restaurantId Interne restaurant_id (für Logging)
 * @returns {{ cfExportPath: string, targetHostname: string }} Pfad und geplanter Hostname
 * @throws Error wenn kein lokaler Publish-Export vorhanden ist
 */
function prepareCfExport(slug, restaurantId) {
    const sourceDir = path.join(PUBLISH_DIR, slug);
    if (!fs.existsSync(sourceDir)) {
        throw new Error(
            `Kein lokaler Publish-Export für Slug "${slug}" vorhanden. ` +
            `Bitte zuerst lokal veröffentlichen (Publish-Button im Dashboard).`
        );
    }

    const cfSiteDir = path.join(CF_EXPORT_DIR, slug);

    // Zielverzeichnis leeren und neu befüllen (sauberer Stand)
    if (fs.existsSync(cfSiteDir)) {
        fs.rmSync(cfSiteDir, { recursive: true, force: true });
    }

    // Lokalen Export kopieren
    copyDirRecursive(sourceDir, cfSiteDir);

    // Cloudflare Pages Meta-Dateien hinzufügen
    writeRedirects(cfSiteDir);
    writeHeaders(cfSiteDir);

    // Geplanter Hostname für kostenlose Seiten:
    // Verbindliches Schema: <slug>-restiq.pages.dev
    // Beispiel: trattoria-mario-restiq.pages.dev
    // (noch nicht real verbunden – Vorbereitung der Infrastruktur)
    const targetHostname = `${slug}-restiq.pages.dev`;

    // deploy-info.json für Nachvollziehbarkeit
    const deployInfo = {
        restaurant_id: restaurantId,
        slug,
        target_hostname: targetHostname,
        plan: 'free',
        export_type: 'cloudflare_pages_static',
        prepared_at: new Date().toISOString(),
        note: 'Noch nicht live verbunden. Manueller Upload über Cloudflare Pages CLI oder Dashboard notwendig.',
        cloudflare_deploy_hint: [
            'Option A (CLI): npx wrangler pages deploy ./ --project-name=<slug>-restiq',
            'Option B (Dashboard): cloudflare-export/<slug>/ als Verzeichnis im Cloudflare Pages Dashboard hochladen',
        ],
    };
    fs.writeFileSync(
        path.join(cfSiteDir, 'deploy-info.json'),
        JSON.stringify(deployInfo, null, 2),
        'utf8'
    );

    return { cfExportPath: cfSiteDir, targetHostname };
}

module.exports = {
    prepareCfExport,
    CF_EXPORT_DIR,
};
