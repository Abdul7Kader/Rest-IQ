const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'gastrofy.db');
const db = new Database(dbPath, { verbose: console.log });
db.pragma('foreign_keys = ON');

module.exports = db;
