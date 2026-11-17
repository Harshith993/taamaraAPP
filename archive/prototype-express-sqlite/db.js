'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_ROLES } = require('./permissions');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'eventdesk.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_owner INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enquiry',
  client_name TEXT,
  client_phone TEXT,
  client_email TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  venue TEXT,
  guests INTEGER,
  package_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(start_date);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  whatsapp TEXT,
  city TEXT,
  rate_notes TEXT,
  rating INTEGER,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  skill TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  daily_wage REAL NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_vendors (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  service TEXT,
  agreed_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ev_event ON event_vendors(event_id);
CREATE INDEX IF NOT EXISTS idx_ev_vendor ON event_vendors(vendor_id);

CREATE TABLE IF NOT EXISTS event_workers (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  work_date TEXT NOT NULL,
  duty TEXT,
  shift TEXT,
  wage REAL NOT NULL DEFAULT 0,
  attendance TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ew_event ON event_workers(event_id);
CREATE INDEX IF NOT EXISTS idx_ew_worker ON event_workers(worker_id, work_date);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  party_type TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id),
  worker_id INTEGER REFERENCES workers(id),
  party_name TEXT,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  paid_on TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_event ON payments(event_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  due_date TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_notes (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_log (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
  party_name TEXT,
  channel TEXT NOT NULL,
  message TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  sensitive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(id DESC);
`);

const DEFAULT_SETTINGS = {
  business_name: 'My Events Co.',
  currency: '₹',
  country_code: '91',
  timezone: 'Asia/Kolkata',
  event_types: [
    'Wedding', 'Pre-wedding', 'Engagement', 'Haldi', 'Mehendi', 'Sangeet', 'Reception',
    'Birthday', 'Anniversary', 'Baby Shower', 'Corporate', 'Other',
  ],
  vendor_categories: [
    'Catering', 'Decoration', 'Photography', 'Videography', 'DJ & Sound', 'Lighting',
    'Tent & Furniture', 'Florist', 'Makeup', 'Mehendi Artist', 'Venue', 'Transport',
    'Band & Dhol', 'Pandit / Priest', 'Invitations & Printing', 'Other',
  ],
  labor_skills: [
    'Helper', 'Decorator', 'Electrician', 'Waiter', 'Driver', 'Supervisor', 'Cleaner',
    'Security', 'Carpenter', 'Other',
  ],
};

// ---------- small query helpers ----------
const row = (sql, ...params) => db.prepare(sql).get(...params);
const rows = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

// Column names always come from server-side field specs, never from user input.
function insert(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(run(sql, ...keys.map((k) => data[k])).lastInsertRowid);
}

function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
}

let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows('SELECT key, value FROM settings')) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore bad rows */ }
  }
  return out;
}

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}

// ---------- passwords ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored || DUMMY_HASH).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected) && Boolean(stored);
}

// ---------- first-run seed ----------
if (row('SELECT COUNT(*) AS n FROM roles').n === 0) {
  tx(() => {
    for (const r of DEFAULT_ROLES) {
      insert('roles', {
        name: r.name, description: r.description, is_owner: r.is_owner, permissions: JSON.stringify(r.permissions),
      });
    }
  });
}

module.exports = {
  db, row, rows, run, insert, update, tx, getSettings, setSetting, hashPassword, verifyPassword, DB_FILE,
};
