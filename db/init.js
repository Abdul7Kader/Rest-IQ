/**
 * Restiq DB Init Script
 * Liest schema.sql und seed.sql und spielt sie in die SQLite-Datenbank ein.
 * Nur ausführen, wenn die DB noch leer ist oder neu initialisiert werden soll.
 *
 * Verwendung:
 *   node db/init.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'restiq.db');
const schemaPath = path.join(__dirname, 'schema.sql');
const seedPath = path.join(__dirname, 'seed.sql');

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Check if DB already has tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
if (tables.length > 0) {
    console.log('⚠️  Datenbank enthält bereits Tabellen. Init wird übersprungen.');
    console.log('   Tabellen:', tables.map(t => t.name).join(', '));
    console.log('   Wenn du neu initialisieren möchtest, lösche restiq.db zuerst.');
    process.exit(0);
}

console.log('🗄️  Initialisiere Datenbank...');

// Apply schema
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);
console.log('✅ Schema eingespielt.');

// Apply seed
const seed = fs.readFileSync(seedPath, 'utf8');
db.exec(seed);
console.log('✅ Seed-Daten eingespielt.');

// Verify
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
const restaurantCount = db.prepare('SELECT COUNT(*) as count FROM restaurants').get();
console.log(`\n📊 Initialisierung abgeschlossen:`);
console.log(`   Benutzer: ${userCount.count}`);
console.log(`   Restaurants: ${restaurantCount.count}`);
console.log(`\n🔑 Test-Zugangsdaten:`);
console.log(`   Owner:  mario@trattoria-mario.de / owner123`);
console.log(`   Admin:  admin@restiq.app / admin123`);
console.log(`\n🚀 Starte den Server mit: node server.js`);

db.close();
