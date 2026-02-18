
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Try to find the database in the parent directory first (shared with Python app)
// otherwise fall back to the local web_app directory
const parentDbPath = path.join(process.cwd(), '..', 'sena_digital.db');
const localDbPath = path.join(process.cwd(), 'sena_digital.db');

const dbPath = fs.existsSync(parentDbPath) ? parentDbPath : localDbPath;

// Ensure database connection and tables
function getDb() {
  const db = new Database(dbPath, { verbose: console.log });

  // Initialize tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS brands (
      name TEXT PRIMARY KEY, 
      color TEXT NOT NULL, 
      order_index INTEGER
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY, 
      brand TEXT NOT NULL, 
      model TEXT NOT NULL, 
      specs TEXT, 
      price_float REAL NOT NULL, 
      price_str TEXT NOT NULL
    );
  `);

  // Check if order_index column exists in brands table, add if missing (migration)
  try {
    db.prepare('SELECT order_index FROM brands LIMIT 1').run();
  } catch (error) {
    db.prepare('ALTER TABLE brands ADD COLUMN order_index INTEGER').run();
  }

  // Set default brands if empty
  const brandCount = db.prepare('SELECT COUNT(*) as count FROM brands').get() as { count: number };
  if (brandCount.count === 0) {
    const defaultBrands = {
      "SAMSUNG": "#0057B7", "INFINIX": "#2E8B57", "ZTE": "#00BFFF",
      "ITEL": "#FF6347", "BLU": "#4169E1", "UMIDIGI": "#8A2BE2",
      "MOTOROLA": "#4682B4", "TABLETAS": "#FF8C00", "TELEVISORES": "#DC143C",
      "CUBOT": "#6A5ACD", "TECNO": "#20B2AA", "ROVER": "#DAA520",
      "VORTEX": "#556B2F", "M-HORSE": "#8B4513", "RELOJ": "#DB7093",
      "TCL": "#E60012", "AIRES ACON.": "#87CEEB", "OUKITEL": "#1E90FF",
      "GENERICO": "#778899", "OTROS": "#A9A9A9",
    };
    const stmt = db.prepare('INSERT INTO brands (name, color, order_index) VALUES (?, ?, ?)');
    let index = 0;
    for (const [name, color] of Object.entries(defaultBrands)) {
      stmt.run(name, color, index++);
    }
  }

  return db;
}

export const db = getDb();
