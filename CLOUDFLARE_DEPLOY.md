# Restiq – Cloudflare Pages Deployment-Dokumentation

Stand: Schritt 8 | Kostenlose Stufe (Free Plan)

---

## Übersicht: Interner Export und Cloudflare-Vorbereitung

```
publish/<slug>/            ← Interner statischer Export des Servers
cloudflare-export/<slug>/  ← Cloudflare Pages Vorbereitung (Schritt 8, neu)
```

Beide Verzeichnisse sind im `.gitignore` und werden durch den Server generiert. Restaurant-Owner können keine lokale öffentliche Veröffentlichung auslösen.

---

## URL-Strategie für kostenlose Seiten

Kostenlose Restaurants erhalten eine URL unter dem Restiq-Plattform-Branding:

```
<slug>-restiq.pages.dev
```

Beispiel Trattoria Mario:
```
trattoria-mario-restiq.pages.dev
```

> **Noch nicht live verbunden.** Die Infrastruktur und der Export sind vorbereitet.
> Das manuelle Deployment muss über Cloudflare Pages CLI oder Dashboard erfolgen.

**Bewusst nicht enthalten:**
- Keine kundeneigene Domain (`custom` plan)
- Keine Cloudflare API-Anbindung (kein API-Token, kein automatisches Deployment)
- Keine Consent-Banner-Logik
- Keine echte AdSense-Integration (nur Platzhalter im Free-Template)

---

## Ablauf: Cloudflare Pages vorbereiten

### Schritt 1: Cloudflare Export vorbereiten

```
POST /api/restaurant/cf-prepare
```

- Prüft: `current_plan = 'free'`
- Rendert serverseitig das ViewModel aus der Datenbank
- Erzeugt intern `publish/<slug>/`
- Kopiert den internen statischen Export nach `cloudflare-export/<slug>/`
- Fügt Cloudflare Pages Meta-Dateien hinzu:
  - `_redirects` – Basis-Redirect-Regeln
  - `_headers` – Security + Cache-Control Header
  - `deploy-info.json` – maschinenlesbare Metadaten
- Loggt in `publish_events` mit `target_hostname = '<slug>-restiq.pages.dev'`
- Gibt Export-Pfad und geplanten Hostname zurück

---

## Cloudflare Pages Export-Struktur

```
cloudflare-export/
└── trattoria-mario/
    ├── index.html          ← Entry Point (lädt data.json via fetch)
    ├── data.json           ← Normalisiertes ViewModel
    ├── _redirects          ← Cloudflare Pages Routing-Regeln
    ├── _headers            ← Security + Cache Headers
    ├── deploy-info.json    ← Deployment-Metadaten (restaurant_id, slug, hostname)
    ├── css/
    │   └── style.css
    ├── js/
    │   └── renderer.js
    └── templates/
        ├── free_default.js
        └── free_classic.js
```

---

## Lokale Testmöglichkeiten

### Option A: Restiq-Server (bestehend, Port 3000)

```bash
node server.js
```

Verfügbar unter:
- Dashboard: http://localhost:3000/dashboard.html
- Preview (Live): http://localhost:3000/preview
- CF-Prepare API: POST http://localhost:3000/api/restaurant/cf-prepare

### Option B: Cloudflare Export lokal testen (neu)

```bash
npm run cf:serve
```

Entspricht `npx serve cloudflare-export`. Startet einen statischen HTTP-Server
auf dem `cloudflare-export/`-Verzeichnis. Listet alle vorbereiteten Sites auf.

### Option C: Spezifische Restaurant-Site testen

```bash
npm run cf:serve:slug
```

Entspricht `npx serve cloudflare-export/trattoria-mario`. Stellt die Site
direkt auf einem eigenen Port bereit – analog zu wie Cloudflare Pages sie
ausliefern würde.

> **Wichtig:** `fetch('./data.json')` benötigt einen HTTP-Server.  
> Die direkte Öffnung von `index.html` über `file://` funktioniert **nicht** (CORS).

---

## Manuelles Deployment zu Cloudflare Pages

### Voraussetzung

Ein Cloudflare-Konto und ein Pages-Projekt `restiq` müssen manuell angelegt werden.

### Option A: Wrangler CLI

```bash
npx wrangler pages deploy cloudflare-export/trattoria-mario --project-name=trattoria-mario-restiq
```

### Option B: Cloudflare Pages Dashboard

1. cloudflare.com/pages aufrufen
2. Neues Projekt anlegen oder bestehendes öffnen
3. „Deploy" → „Direct Upload"
4. Verzeichnis `cloudflare-export/<slug>/` hochladen

---

## publish_events Logging

Der Cloudflare-Vorbereitungsschritt protokolliert in `publish_events`:

| Schritt                   | trigger_type    | target_hostname                   | status  |
|--------------------------|-----------------|----------------------------------|---------|
| Cloudflare Vorbereitung   | `manual_update` | `trattoria-mario-restiq.pages.dev` | success |

---

## Unterschied: interner Export vs. Cloudflare-Export

| Aspekt              | `publish/<slug>/`             | `cloudflare-export/<slug>/`            |
|--------------------|-------------------------------|----------------------------------------|
| Zweck              | Internes Arbeitsverzeichnis des Servers | Deployment zu Cloudflare Pages |
| Cloudflare-Dateien | ✗                             | `_redirects`, `_headers`, `deploy-info.json` |
| Render-Logik       | identisch (Shared Assets)     | identisch (Shared Assets)              |
| URL-Strategie      | keine öffentliche Owner-Route | `<slug>-restiq.pages.dev`              |

---

## Test-Zugangsdaten

| Rolle     | E-Mail                    | Passwort   |
|-----------|--------------------------|------------|
| Owner     | mario@trattoria-mario.de | owner123   |
| Admin     | admin@restiq.app         | admin123   |

---

## Was bewusst noch nicht enthalten ist

- ❌ Echte Cloudflare API-Anbindung (kein Auto-Deploy)
- ❌ Cloudflare API-Token im System
- ❌ Kundeneigene Domains (Custom Plan)
- ❌ Consent-Banner / Cookie-Logik
- ❌ Echte AdSense-Integration (nur strukturelle Platzhalter)
- ❌ Zahlungslogik
- ❌ n8n / OpenClaw Integration
- ❌ Paid-Plan spezifische Templates
