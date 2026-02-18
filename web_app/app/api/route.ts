
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'sena_digital.db');
const db = new Database(dbPath);

// Ensure tables exist
db.prepare('CREATE TABLE IF NOT EXISTS brands (name TEXT PRIMARY KEY, color TEXT NOT NULL, order_index INTEGER)').run();
db.prepare('CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL, specs TEXT, price_float REAL NOT NULL, price_str TEXT NOT NULL)').run();

// Check if order_index column exists in brands table, add if missing
try {
    db.prepare('SELECT order_index FROM brands LIMIT 1').run();
} catch (error) {
    // Column doesn't exist, add it
    db.prepare('ALTER TABLE brands ADD COLUMN order_index INTEGER').run();
}

export { db };
