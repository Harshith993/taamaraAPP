'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const {
  row, rows, run, insert, update, tx, getSettings, setSetting, hashPassword, verifyPassword,
} = require('./db');
const { PERMISSIONS, PERMISSION_KEYS, normalizePermissions } = require('./permissions');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 30;
const COOKIE = 'ed_session';

const EVENT_STATUSES = ['enquiry', 'confirmed', 'in_progress', 'completed', 'cancelled'];
const BOOKING_STATUSES = ['requested', 'confirmed', 'done', 'cancelled'];
const ATTENDANCE = ['pending', 'present', 'absent'];
const PAY_METHODS = ['cash', 'upi', 'bank', 'cheque', 'card', 'other'];
const CHANNELS = ['whatsapp', 'sms', 'call', 'copy'];

// Anything under these keys is removed from API responses for people without "finance.view".
const MONEY_KEYS = new Set([
  'package_amount', 'agreed_amount', 'wage', 'daily_wage', 'rate_notes', 'received', 'money', 'payments',
  'amount', 'paid', 'pending', 'earned', 'due',
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const forbidden = (msg) => new HttpError(403, msg || "You don't have permission to do that.");
const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function today() {
  const tz = getSettings().timezone || 'Asia/Kolkata';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normLogin(v) {
  const s = String(v || '').trim().toLowerCase();
  return s.includes('@') ? s.replace(/\s+/g, '') : s.replace(/[\s\-()]/g, '');
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!MONEY_KEYS.has(k)) out[k] = scrub(v);
    return out;
  }
  return value;
}

function send(req, res, data) {
  res.json(req.user && !req.user.can('finance.view') ? scrub(data) : data);
}

function log(user, action, entity, entityId, summary, sensitive = false) {
  insert('activity', {
    user_id: user ? user.id : null, action, entity, entity_id: entityId ?? null, summary, sensitive: sensitive ? 1 : 0,
  });
}

function fmtMoney(n) {
  const cur = getSettings().currency || '';
  return `${cur}${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// ---------- input validation ----------
function convert(raw, d, key) {
  const label = d.label || key.replace(/_/g, ' ');
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  switch (d.type) {
    case 'str':
    case 'text': {
      if (empty) return null;
      return String(raw).trim().slice(0, d.type === 'text' ? 5000 : 200);
    }
    case 'int': {
      if (empty) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw bad(`${label} must be a whole number.`);
      return n;
    }
    case 'id': {
      if (empty) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw bad(`Invalid ${label}.`);
      return n;
    }
    case 'money': {
      if (empty) return 0;
      const n = Number(String(raw).replace(/[,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) throw bad(`${label} must be a positive amount.`);
      return Math.round(n * 100) / 100;
    }
    case 'date': {
      if (empty) return null;
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${label} must be a valid date.`);
      return s;
    }
    case 'enum': {
      if (empty) return d.default ?? null;
      const s = String(raw);
      if (!d.values.includes(s)) throw bad(`Invalid ${label}.`);
      return s;
    }
    case 'bool':
      return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on' ? 1 : 0;
    default:
      throw new Error(`Unknown field type ${d.type}`);
  }
}

function readFields(body, spec, user, { partial = false } = {}) {
  const out = {};
  const canMoney = user.can('finance.view');
  for (const [key, def] of Object.entries(spec)) {
    const d = typeof def === 'string' ? { type: def } : def;
    if (d.money && !canMoney) continue;
    const present = body && Object.prototype.hasOwnProperty.call(body, key);
    if (!present) {
      if (partial) continue;
      if (d.required) throw bad(`${d.label || key} is required.`);
      if (d.default !== undefined) out[key] = d.default;
      continue;
    }
    const v = convert(body[key], d, key);
    if (d.required && (v === null || v === '')) throw bad(`${d.label || key} is required.`);
    out[key] = v;
  }
  return out;
}

const SPEC = {
  event: {
    title: { type: 'str', required: true, label: 'Event name' },
    type: { type: 'str', required: true, label: 'Event type' },
    status: { type: 'enum', values: EVENT_STATUSES, default: 'enquiry' },
    client_name: 'str',
    client_phone: 'str',
    client_email: 'str',
    start_date: { type: 'date', required: true, label: 'Event date' },
    end_date: { type: 'date', label: 'End date' },
    start_time: 'str',
    venue: 'str',
    guests: { type: 'int', label: 'Guests' },
    notes: 'text',
    lead_user_id: { type: 'id', label: 'event lead' },
    package_amount: { type: 'money', money: true, label: 'Package amount' },
  },
  vendor: {
    name: { type: 'str', required: true, label: 'Vendor name' },
    category: { type: 'str', required: true, label: 'Category' },
    contact_person: 'str',
    phone: 'str',
    whatsapp: 'str',
    city: 'str',
    rate_notes: { type: 'text', money: true },
    rating: { type: 'int', label: 'Rating' },
    notes: 'text',
    active: { type: 'bool', default: 1 },
  },
  worker: {
    name: { type: 'str', required: true, label: 'Name' },
    skill: { type: 'str', required: true, label: 'Skill' },
    phone: 'str',
    city: 'str',
    daily_wage: { type: 'money', money: true, label: 'Daily wage' },
    notes: 'text',
    active: { type: 'bool', default: 1 },
  },
  eventVendor: {
    vendor_id: { type: 'id', required: true, label: 'Vendor' },
    service: 'str',
    agreed_amount: { type: 'money', money: true, label: 'Agreed amount' },
    status: { type: 'enum', values: BOOKING_STATUSES, default: 'requested' },
    notes: 'text',
  },
  eventWorker: {
    work_date: { type: 'date', label: 'Work date' },
    duty: 'str',
    shift: 'str',
    wage: { type: 'money', money: true, label: 'Wage' },
    attendance: { type: 'enum', values: ATTENDANCE, default: 'pending' },
    notes: 'text',
  },
  task: {
    title: { type: 'str', required: true, label: 'Task' },
    event_id: { type: 'id', label: 'event' },
    due_date: { type: 'date', label: 'Due date' },
    assigned_to: { type: 'id', label: 'assignee' },
    notes: 'text',
  },
  payment: {
    event_id: { type: 'id', label: 'event' },
    direction: { type: 'enum', values: ['in', 'out'], required: true, label: 'Direction' },
    party_type: { type: 'enum', values: ['client', 'vendor', 'worker', 'other'], required: true, label: 'Paid to / from' },
    vendor_id: { type: 'id', label: 'vendor' },
    worker_id: { type: 'id', label: 'worker' },
    party_name: 'str',
    amount: { type: 'money', required: true, label: 'Amount' },
    method: { type: 'enum', values: PAY_METHODS, default: 'cash' },
    paid_on: { type: 'date', required: true, label: 'Payment date' },
    reference: 'str',
    note: 'text',
  },
};

// ---------------------------------------------------------------------------
// Sessions & auth
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ }
    }
  }
  return out;
}

function cookieAttrs(req) {
  const secure = req.secure || process.env.COOKIE_SECURE === '1';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 24 * 3600;
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  insert('sessions', { token_hash: sha256(token), user_id: userId, expires_at: Date.now() + maxAge * 1000 });
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${maxAge}; ${cookieAttrs(req)}`);
}

function buildUser(r) {
  const perms = r.is_owner ? PERMISSION_KEYS : normalizePermissions(JSON.parse(r.permissions || '[]'));
  const set = new Set(perms);
  return {
    id: r.id,
    name: r.name,
    login: r.login,
    phone: r.phone,
    role_id: r.role_id,
    role_name: r.role_name,
    is_owner: Boolean(r.is_owner),
    must_change_password: Boolean(r.must_change_password),
    permissions: perms,
    can: (p) => set.has(p),
  };
}

function loadUser(req, _res, next) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const r = row(`
      SELECT u.*, r.name AS role_name, r.permissions, r.is_owner
      FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, sha256(token), Date.now());
    if (r) {
      req.user = buildUser(r);
      req.sessionHash = sha256(token);
    }
  }
  next();
}

const PASSWORD_CHANGE_ALLOWED = new Set(['/api/me', '/api/me/password', '/api/logout']);

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in.'));
  if (req.user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(req.originalUrl.split('?')[0])) {
    return next(new HttpError(403, 'Please set a new password first.'));
  }
  next();
}

function need(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in.'));
    if (perms.every((p) => req.user.can(p))) return next();
    next(forbidden());
  };
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters.');
  if (pw.length > 200) throw bad('Password is too long.');
}

// Very small in-memory brute-force guard for the login form.
const loginFails = new Map();
function loginGuard(key) {
  const f = loginFails.get(key);
  if (f && f.count >= 8 && Date.now() - f.first < 15 * 60 * 1000) {
    throw new HttpError(429, 'Too many wrong attempts. Please wait 15 minutes and try again.');
  }
}
function loginFailed(key) {
  const f = loginFails.get(key);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) loginFails.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

// Wraps a handler so thrown errors become JSON responses.
const h = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Only accept JSON for state-changing API calls (blocks cross-site form posts).
app.use('/api', (req, _res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return next(new HttpError(415, 'Expected JSON.'));
  next();
});
app.use('/api', loadUser);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- setup & login ----------
const countUsers = () => row('SELECT COUNT(*) AS n FROM users').n;

app.get('/api/setup-status', (_req, res) => {
  res.json({ needsSetup: countUsers() === 0, businessName: getSettings().business_name });
});

app.post('/api/setup', h((req, res) => {
  const name = convert(req.body.name, { type: 'str' }, 'name');
  const login = normLogin(req.body.login);
  const businessName = convert(req.body.business_name, { type: 'str' }, 'business name');
  if (!name) throw bad('Your name is required.');
  if (!login) throw bad('Email or phone number is required.');
  checkPassword(req.body.password);
  const id = tx(() => {
    if (countUsers() > 0) throw new HttpError(409, 'This app is already set up. Please log in.');
    const owner = row('SELECT id FROM roles WHERE is_owner = 1 ORDER BY id LIMIT 1');
    if (businessName) setSetting('business_name', businessName);
    const uid = insert('users', {
      name, login, phone: login.includes('@') ? null : login, password_hash: hashPassword(req.body.password), role_id: owner.id,
    });
    log({ id: uid }, 'setup', 'user', uid, `${name} set up the app as Founder`);
    return uid;
  });
  startSession(req, res, id);
  res.json({ ok: true });
}));

app.post('/api/login', h((req, res) => {
  const login = normLogin(req.body.login);
  const password = String(req.body.password || '');
  const key = `${req.ip}|${login}`;
  loginGuard(key);
  const u = row('SELECT * FROM users WHERE login = ?', login);
  const ok = verifyPassword(password, u ? u.password_hash : null);
  if (!u || !ok || !u.active) {
    loginFailed(key);
    throw new HttpError(401, u && ok && !u.active ? 'This account has been deactivated.' : 'Wrong login or password.');
  }
  loginFails.delete(key);
  startSession(req, res, u.id);
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  if (req.sessionHash) run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieAttrs(req)}`);
  res.json({ ok: true });
});

// Everything below needs a logged-in user.
app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id, name: u.name, login: u.login, phone: u.phone, role_name: u.role_name,
      is_owner: u.is_owner, permissions: u.permissions, must_change_password: u.must_change_password,
    },
    settings: getSettings(),
    team: rows('SELECT id, name FROM users WHERE active = 1 ORDER BY name'),
    today: today(),
  });
});

app.post('/api/me/password', h((req, res) => {
  const u = row('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body.current || ''), u.password_hash)) throw bad('Your current password is wrong.');
  checkPassword(req.body.next);
  if (req.body.next === req.body.current) throw bad('Pick a password different from the old one.');
  tx(() => {
    run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(req.body.next), u.id);
    run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', u.id, req.sessionHash);
    log(req.user, 'update', 'user', u.id, `${u.name} changed their password`);
  });
  res.json({ ok: true });
}));

// ---------- dashboard ----------
app.get('/api/dashboard', h((req, res) => {
  const t = today();
  const u = req.user;
  const out = { today: t };

  if (u.can('events.view')) {
    out.upcoming = rows(`
      SELECT e.id, e.title, e.type, e.status, e.start_date, e.end_date, e.start_time, e.venue, e.client_name,
        (SELECT COUNT(*) FROM event_vendors ev WHERE ev.event_id = e.id AND ev.status != 'cancelled') AS vendor_count,
        (SELECT COUNT(DISTINCT worker_id) FROM event_workers ew WHERE ew.event_id = e.id) AS worker_count
      FROM events e
      WHERE COALESCE(e.end_date, e.start_date) >= ? AND e.status != 'cancelled'
      ORDER BY e.start_date, e.start_time LIMIT 6`, t);
    out.counts = row(`
      SELECT
        SUM(CASE WHEN start_date BETWEEN ? AND ? AND status != 'cancelled' THEN 1 ELSE 0 END) AS next30,
        SUM(CASE WHEN start_date = ? AND status != 'cancelled' THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN status = 'enquiry' AND start_date >= ? THEN 1 ELSE 0 END) AS enquiries
      FROM events`, t, addDays(t, 30), t, t);
  }

  out.myTasks = rows(`
    SELECT t.id, t.title, t.due_date, t.done, t.event_id, e.title AS event_title
    FROM tasks t LEFT JOIN events e ON e.id = t.event_id
    WHERE t.assigned_to = ? AND t.done = 0
    ORDER BY t.due_date IS NULL, t.due_date LIMIT 8`, u.id);

  if (u.can('finance.view')) out.money = dues().totals;

  if (u.can('activity.view')) {
    out.activity = rows(`
      SELECT a.id, a.summary, a.created_at, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
      ${u.can('finance.view') ? '' : 'WHERE a.sensitive = 0'}
      ORDER BY a.id DESC LIMIT 8`);
  }
  send(req, res, out);
}));

// Outstanding money: what clients owe us, and what we owe vendors and labor.
function dues() {
  const receivables = rows(`
    SELECT e.id AS event_id, e.title, e.start_date, e.client_name, e.client_phone, e.package_amount,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.event_id = e.id AND p.direction = 'in'), 0) AS received
    FROM events e WHERE e.status != 'cancelled' AND e.package_amount > 0`)
    .map((r) => ({ ...r, due: r.package_amount - r.received }))
    .filter((r) => r.due > 0.009)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const vendorPayables = rows(`
    SELECT ev.event_id, ev.vendor_id, e.title AS event_title, e.start_date, v.name AS vendor_name, v.category,
      SUM(ev.agreed_amount) AS agreed_amount,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.event_id = ev.event_id AND p.vendor_id = ev.vendor_id
        AND p.direction = 'out'), 0) AS paid
    FROM event_vendors ev JOIN events e ON e.id = ev.event_id JOIN vendors v ON v.id = ev.vendor_id
    WHERE ev.status != 'cancelled' AND e.status != 'cancelled'
    GROUP BY ev.event_id, ev.vendor_id`)
    .map((r) => ({ ...r, pending: r.agreed_amount - r.paid }))
    .filter((r) => r.pending > 0.009)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const laborPayables = rows(`
    SELECT w.id AS worker_id, w.name, w.skill, w.phone,
      COALESCE((SELECT SUM(wage) FROM event_workers ew WHERE ew.worker_id = w.id AND ew.attendance = 'present'), 0) AS earned,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.worker_id = w.id AND p.direction = 'out'), 0) AS paid
    FROM workers w`)
    .map((r) => ({ ...r, pending: r.earned - r.paid }))
    .filter((r) => r.pending > 0.009)
    .sort((a, b) => b.pending - a.pending);

  const sum = (list, k) => list.reduce((s, r) => s + r[k], 0);
  return {
    receivables, vendorPayables, laborPayables,
    totals: {
      receivable: sum(receivables, 'due'),
      vendor_payable: sum(vendorPayables, 'pending'),
      labor_payable: sum(laborPayables, 'pending'),
    },
  };
}

// ---------- events ----------
const EVENT_LIST_SQL = `
  SELECT e.*, u.name AS lead_name,
    (SELECT COUNT(*) FROM event_vendors ev WHERE ev.event_id = e.id AND ev.status != 'cancelled') AS vendor_count,
    (SELECT COUNT(DISTINCT worker_id) FROM event_workers ew WHERE ew.event_id = e.id) AS worker_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.event_id = e.id AND t.done = 0) AS open_tasks,
    COALESCE((SELECT SUM(amount) FROM payments p WHERE p.event_id = e.id AND p.direction = 'in'), 0) AS received
  FROM events e LEFT JOIN users u ON u.id = e.lead_user_id`;

app.get('/api/events', need('events.view'), h((req, res) => {
  const t = today();
  const where = [];
  const params = [];
  const range = req.query.range || 'upcoming';
  if (range === 'upcoming') { where.push('COALESCE(e.end_date, e.start_date) >= ?'); params.push(t); }
  if (range === 'past') { where.push('COALESCE(e.end_date, e.start_date) < ?'); params.push(t); }
  if (req.query.status && EVENT_STATUSES.includes(req.query.status)) { where.push('e.status = ?'); params.push(req.query.status); }
  if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) { where.push("substr(e.start_date, 1, 7) = ?"); params.push(req.query.month); }
  if (req.query.q) {
    where.push('(e.title LIKE ? OR e.client_name LIKE ? OR e.venue LIKE ? OR e.client_phone LIKE ?)');
    const q = `%${String(req.query.q).slice(0, 100)}%`;
    params.push(q, q, q, q);
  }
  const order = range === 'past' ? 'e.start_date DESC' : 'e.start_date ASC, e.start_time ASC';
  const list = rows(`${EVENT_LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT 500`, ...params);
  send(req, res, { events: list });
}));

function getEvent(id) {
  const e = row(`${EVENT_LIST_SQL} WHERE e.id = ?`, id);
  if (!e) throw notFound('Event');
  return e;
}

function busyWarnings({ eventId, date, vendorId, workerId }) {
  if (vendorId) {
    return rows(`
      SELECT e.title FROM event_vendors ev JOIN events e ON e.id = ev.event_id
      WHERE ev.vendor_id = ? AND ev.event_id != ? AND ev.status != 'cancelled' AND e.status != 'cancelled'
        AND ? BETWEEN e.start_date AND COALESCE(e.end_date, e.start_date)`, vendorId, eventId, date)
      .map((r) => r.title);
  }
  return rows(`
    SELECT e.title FROM event_workers ew JOIN events e ON e.id = ew.event_id
    WHERE ew.worker_id = ? AND ew.event_id != ? AND ew.work_date = ? AND e.status != 'cancelled'`, workerId, eventId, date)
    .map((r) => r.title);
}

app.get('/api/events/:id', need('events.view'), h((req, res) => {
  const id = Number(req.params.id);
  const e = getEvent(id);
  const u = req.user;

  const vendors = rows(`
    SELECT ev.*, v.name AS vendor_name, v.category, v.contact_person, v.phone, v.whatsapp
    FROM event_vendors ev JOIN vendors v ON v.id = ev.vendor_id
    WHERE ev.event_id = ? ORDER BY v.category, v.name`, id);
  const workers = rows(`
    SELECT ew.*, w.name AS worker_name, w.skill, w.phone
    FROM event_workers ew JOIN workers w ON w.id = ew.worker_id
    WHERE ew.event_id = ? ORDER BY ew.work_date, w.skill, w.name`, id);
  const tasks = rows(`
    SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.event_id = ? ORDER BY t.done, t.due_date IS NULL, t.due_date, t.id`, id);
  const notes = rows(`
    SELECT n.id, n.body, n.created_at, n.user_id, u.name AS user_name FROM event_notes n LEFT JOIN users u ON u.id = n.user_id
    WHERE n.event_id = ? ORDER BY n.id DESC LIMIT 200`, id);
  const contacts = rows(`
    SELECT c.id, c.party_type, c.party_name, c.channel, c.message, c.sensitive, c.created_at, u.name AS user_name
    FROM contact_log c LEFT JOIN users u ON u.id = c.user_id WHERE c.event_id = ? ORDER BY c.id DESC LIMIT 200`, id)
    .map((c) => (c.sensitive && !u.can('finance.view') ? { ...c, message: null, hidden: true } : c));

  const out = { event: e, vendors, workers, tasks, notes, contacts };

  if (u.can('finance.view')) {
    const payments = rows(`
      SELECT p.*, v.name AS vendor_name, w.name AS worker_name, u.name AS created_by_name
      FROM payments p LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN workers w ON w.id = p.worker_id
      LEFT JOIN users u ON u.id = p.created_by WHERE p.event_id = ? ORDER BY p.paid_on DESC, p.id DESC`, id);
    const sumOut = (type) => payments.filter((p) => p.direction === 'out' && p.party_type === type).reduce((s, p) => s + p.amount, 0);
    const vendorPaid = {};
    const workerPaid = {};
    for (const p of payments) {
      if (p.direction !== 'out') continue;
      if (p.vendor_id) vendorPaid[p.vendor_id] = (vendorPaid[p.vendor_id] || 0) + p.amount;
      if (p.worker_id) workerPaid[p.worker_id] = (workerPaid[p.worker_id] || 0) + p.amount;
    }
    const vendorCost = vendors.filter((v) => v.status !== 'cancelled').reduce((s, v) => s + v.agreed_amount, 0);
    const laborCost = workers.filter((w) => w.attendance !== 'absent').reduce((s, w) => s + w.wage, 0);
    const otherCost = sumOut('other');
    out.payments = payments;
    out.money = {
      package_amount: e.package_amount,
      received: e.received,
      due: e.package_amount - e.received,
      vendor_cost: vendorCost,
      vendor_paid: sumOut('vendor'),
      labor_cost: laborCost,
      labor_paid: sumOut('worker'),
      other_cost: otherCost,
      expected_profit: e.package_amount - vendorCost - laborCost - otherCost,
      vendor_paid_by_id: vendorPaid,
      worker_paid_by_id: workerPaid,
    };
  }
  send(req, res, out);
}));

app.post('/api/events', need('events.edit'), h((req, res) => {
  const data = readFields(req.body, SPEC.event, req.user);
  if (data.end_date && data.end_date < data.start_date) throw bad('End date cannot be before the start date.');
  data.created_by = req.user.id;
  const id = tx(() => {
    const newId = insert('events', data);
    log(req.user, 'create', 'event', newId, `Created event "${data.title}" (${data.type}, ${data.start_date})`);
    return newId;
  });
  res.json({ id });
}));

app.put('/api/events/:id', need('events.edit'), h((req, res) => {
  const id = Number(req.params.id);
  const before = getEvent(id);
  const data = readFields(req.body, SPEC.event, req.user, { partial: true });
  const start = data.start_date || before.start_date;
  const end = 'end_date' in data ? data.end_date : before.end_date;
  if (end && end < start) throw bad('End date cannot be before the start date.');
  data.updated_at = new Date().toISOString();
  tx(() => {
    update('events', id, data);
    const changed = Object.keys(data).filter((k) => k !== 'updated_at' && data[k] !== before[k]);
    if (changed.length) {
      const what = changed.map((k) => (k === 'status' ? `status → ${data.status}` : k.replace(/_/g, ' '))).join(', ');
      log(req.user, 'update', 'event', id, `Updated "${data.title || before.title}": ${what}`, changed.includes('package_amount'));
    }
  });
  res.json({ ok: true });
}));

app.delete('/api/events/:id', need('records.delete'), h((req, res) => {
  const e = getEvent(Number(req.params.id));
  tx(() => {
    run('DELETE FROM events WHERE id = ?', e.id);
    log(req.user, 'delete', 'event', e.id, `Deleted event "${e.title}" (${e.start_date})`);
  });
  res.json({ ok: true });
}));

// Vendors booked for an event
app.post('/api/events/:id/vendors', need('events.edit'), h((req, res) => {
  const e = getEvent(Number(req.params.id));
  const data = readFields(req.body, SPEC.eventVendor, req.user);
  const v = row('SELECT * FROM vendors WHERE id = ?', data.vendor_id);
  if (!v) throw notFound('Vendor');
  const warnings = busyWarnings({ eventId: e.id, date: e.start_date, vendorId: v.id });
  const id = tx(() => {
    const newId = insert('event_vendors', { ...data, event_id: e.id });
    log(req.user, 'create', 'event', e.id, `Booked ${v.name} (${data.service || v.category}) for "${e.title}"`);
    return newId;
  });
  res.json({ id, warnings });
}));

app.put('/api/event-vendors/:id', need('events.edit'), h((req, res) => {
  const ev = row(`SELECT ev.*, v.name AS vendor_name, e.title FROM event_vendors ev JOIN vendors v ON v.id = ev.vendor_id
    JOIN events e ON e.id = ev.event_id WHERE ev.id = ?`, Number(req.params.id));
  if (!ev) throw notFound('Booking');
  const data = readFields(req.body, SPEC.eventVendor, req.user, { partial: true });
  delete data.vendor_id;
  tx(() => {
    update('event_vendors', ev.id, data);
    const changes = [];
    if (data.status && data.status !== ev.status) changes.push(`status → ${data.status}`);
    if ('agreed_amount' in data && data.agreed_amount !== ev.agreed_amount) changes.push('amount');
    if (changes.length) log(req.user, 'update', 'event', ev.event_id, `${ev.vendor_name} for "${ev.title}": ${changes.join(', ')}`, changes.includes('amount'));
  });
  res.json({ ok: true });
}));

app.delete('/api/event-vendors/:id', need('events.edit'), h((req, res) => {
  const ev = row(`SELECT ev.*, v.name AS vendor_name, e.title FROM event_vendors ev JOIN vendors v ON v.id = ev.vendor_id
    JOIN events e ON e.id = ev.event_id WHERE ev.id = ?`, Number(req.params.id));
  if (!ev) throw notFound('Booking');
  tx(() => {
    run('DELETE FROM event_vendors WHERE id = ?', ev.id);
    log(req.user, 'delete', 'event', ev.event_id, `Removed ${ev.vendor_name} from "${ev.title}"`);
  });
  res.json({ ok: true });
}));

// Labor booked for an event (can add several workers at once)
app.post('/api/events/:id/workers', need('events.edit'), h((req, res) => {
  const e = getEvent(Number(req.params.id));
  const ids = [...new Set((Array.isArray(req.body.worker_ids) ? req.body.worker_ids : [req.body.worker_id]).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw bad('Pick at least one worker.');
  const data = readFields(req.body, SPEC.eventWorker, req.user);
  data.work_date = data.work_date || e.start_date;
  const wageGiven = req.user.can('finance.view') && req.body.wage !== undefined && String(req.body.wage).trim() !== '';
  const warnings = [];
  const names = [];
  tx(() => {
    for (const wid of ids) {
      const w = row('SELECT * FROM workers WHERE id = ?', wid);
      if (!w) throw notFound('Worker');
      const already = row('SELECT id FROM event_workers WHERE event_id = ? AND worker_id = ? AND work_date = ?', e.id, wid, data.work_date);
      if (already) continue;
      for (const t of busyWarnings({ eventId: e.id, date: data.work_date, workerId: wid })) warnings.push(`${w.name} is also booked for "${t}" that day`);
      insert('event_workers', { ...data, wage: wageGiven ? data.wage : w.daily_wage, event_id: e.id, worker_id: wid });
      names.push(w.name);
    }
    if (names.length) log(req.user, 'create', 'event', e.id, `Booked ${names.length} worker(s) for "${e.title}" on ${data.work_date}: ${names.join(', ')}`);
  });
  res.json({ added: names.length, warnings });
}));

app.put('/api/event-workers/:id', need('events.edit'), h((req, res) => {
  const ew = row(`SELECT ew.*, w.name AS worker_name, e.title FROM event_workers ew JOIN workers w ON w.id = ew.worker_id
    JOIN events e ON e.id = ew.event_id WHERE ew.id = ?`, Number(req.params.id));
  if (!ew) throw notFound('Booking');
  const data = readFields(req.body, SPEC.eventWorker, req.user, { partial: true });
  if ('work_date' in data && !data.work_date) delete data.work_date;
  tx(() => {
    update('event_workers', ew.id, data);
    if (data.attendance && data.attendance !== ew.attendance) {
      log(req.user, 'update', 'event', ew.event_id, `Marked ${ew.worker_name} ${data.attendance} for "${ew.title}" (${ew.work_date})`);
    }
  });
  res.json({ ok: true });
}));

app.delete('/api/event-workers/:id', need('events.edit'), h((req, res) => {
  const ew = row(`SELECT ew.*, w.name AS worker_name, e.title FROM event_workers ew JOIN workers w ON w.id = ew.worker_id
    JOIN events e ON e.id = ew.event_id WHERE ew.id = ?`, Number(req.params.id));
  if (!ew) throw notFound('Booking');
  tx(() => {
    run('DELETE FROM event_workers WHERE id = ?', ew.id);
    log(req.user, 'delete', 'event', ew.event_id, `Removed ${ew.worker_name} from "${ew.title}" (${ew.work_date})`);
  });
  res.json({ ok: true });
}));

// Internal team notes on an event
app.post('/api/events/:id/notes', need('events.view'), h((req, res) => {
  const e = getEvent(Number(req.params.id));
  const body = convert(req.body.body, { type: 'text' }, 'note');
  if (!body) throw bad('Write something first.');
  const id = insert('event_notes', { event_id: e.id, user_id: req.user.id, body });
  res.json({ id });
}));

app.delete('/api/notes/:id', need('events.view'), h((req, res) => {
  const n = row('SELECT * FROM event_notes WHERE id = ?', Number(req.params.id));
  if (!n) throw notFound('Note');
  if (n.user_id !== req.user.id && !req.user.can('records.delete')) throw forbidden('You can only delete your own notes.');
  run('DELETE FROM event_notes WHERE id = ?', n.id);
  res.json({ ok: true });
}));

// Record that someone messaged / called a vendor, worker or client from the app.
app.post('/api/contact-log', h((req, res) => {
  const u = req.user;
  const partyType = convert(req.body.party_type, { type: 'enum', values: ['vendor', 'worker', 'client'] }, 'party');
  const channel = convert(req.body.channel, { type: 'enum', values: CHANNELS }, 'channel');
  if (!partyType || !channel) throw bad('Missing contact details.');
  const eventId = convert(req.body.event_id, { type: 'id' }, 'event');
  const partyId = convert(req.body.party_id, { type: 'id' }, 'party');
  const message = convert(req.body.message, { type: 'text' }, 'message');
  let partyName = null;
  if (partyType === 'vendor') {
    if (!u.can('vendors.view') && !u.can('events.view')) throw forbidden();
    partyName = partyId && row('SELECT name FROM vendors WHERE id = ?', partyId)?.name;
  } else if (partyType === 'worker') {
    if (!u.can('labor.view') && !u.can('events.view')) throw forbidden();
    partyName = partyId && row('SELECT name FROM workers WHERE id = ?', partyId)?.name;
  } else {
    if (!u.can('events.view') || !eventId) throw forbidden();
    partyName = row('SELECT client_name FROM events WHERE id = ?', eventId)?.client_name || 'Client';
  }
  if (eventId && !row('SELECT id FROM events WHERE id = ?', eventId)) throw notFound('Event');
  const cur = getSettings().currency || '₹';
  const sensitive = message ? message.includes(cur) || /\b(rs\.?|inr)\s*\d/i.test(message) : false;
  insert('contact_log', {
    event_id: eventId,
    party_type: partyType,
    vendor_id: partyType === 'vendor' ? partyId : null,
    worker_id: partyType === 'worker' ? partyId : null,
    party_name: partyName,
    channel,
    message,
    sensitive: sensitive ? 1 : 0,
    user_id: u.id,
  });
  res.json({ ok: true });
}));

// ---------- vendors ----------
app.get('/api/vendors', need('vendors.view'), h((req, res) => {
  const where = [];
  const params = [];
  if (req.query.category) { where.push('v.category = ?'); params.push(String(req.query.category)); }
  if (req.query.active !== 'all') where.push('v.active = 1');
  if (req.query.q) {
    const q = `%${String(req.query.q).slice(0, 100)}%`;
    where.push('(v.name LIKE ? OR v.contact_person LIKE ? OR v.phone LIKE ? OR v.city LIKE ?)');
    params.push(q, q, q, q);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  const list = rows(`
    SELECT v.*,
      (SELECT COUNT(*) FROM event_vendors ev WHERE ev.vendor_id = v.id AND ev.status != 'cancelled') AS booking_count
    FROM vendors v ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY v.category, v.name LIMIT 1000`, ...params);
  if (date) {
    const busy = rows(`
      SELECT ev.vendor_id, e.title FROM event_vendors ev JOIN events e ON e.id = ev.event_id
      WHERE ev.status != 'cancelled' AND e.status != 'cancelled' AND ? BETWEEN e.start_date AND COALESCE(e.end_date, e.start_date)`, date);
    for (const v of list) v.busy = busy.filter((b) => b.vendor_id === v.id).map((b) => b.title);
  }
  send(req, res, { vendors: list });
}));

app.get('/api/vendors/:id', need('vendors.view'), h((req, res) => {
  const v = row('SELECT * FROM vendors WHERE id = ?', Number(req.params.id));
  if (!v) throw notFound('Vendor');
  const bookings = req.user.can('events.view') ? rows(`
    SELECT ev.*, e.title, e.start_date, e.end_date, e.venue, e.status AS event_status,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.event_id = ev.event_id AND p.vendor_id = ev.vendor_id AND p.direction = 'out'), 0) AS paid
    FROM event_vendors ev JOIN events e ON e.id = ev.event_id WHERE ev.vendor_id = ? ORDER BY e.start_date DESC`, v.id) : [];
  const out = { vendor: v, bookings };
  if (req.user.can('finance.view')) {
    out.payments = rows(`SELECT p.*, e.title AS event_title FROM payments p LEFT JOIN events e ON e.id = p.event_id
      WHERE p.vendor_id = ? ORDER BY p.paid_on DESC, p.id DESC`, v.id);
    const agreed = rows(`SELECT COALESCE(SUM(ev.agreed_amount), 0) AS s FROM event_vendors ev JOIN events e ON e.id = ev.event_id
      WHERE ev.vendor_id = ? AND ev.status != 'cancelled' AND e.status != 'cancelled'`, v.id)[0].s;
    const paid = out.payments.reduce((s, p) => s + p.amount, 0);
    out.money = { agreed, paid, pending: agreed - paid };
  }
  send(req, res, out);
}));

app.post('/api/vendors', need('vendors.edit'), h((req, res) => {
  const data = readFields(req.body, SPEC.vendor, req.user);
  const id = tx(() => {
    const newId = insert('vendors', data);
    log(req.user, 'create', 'vendor', newId, `Added vendor ${data.name} (${data.category})`);
    return newId;
  });
  res.json({ id });
}));

app.put('/api/vendors/:id', need('vendors.edit'), h((req, res) => {
  const v = row('SELECT * FROM vendors WHERE id = ?', Number(req.params.id));
  if (!v) throw notFound('Vendor');
  const data = readFields(req.body, SPEC.vendor, req.user, { partial: true });
  tx(() => {
    update('vendors', v.id, data);
    log(req.user, 'update', 'vendor', v.id, `Updated vendor ${data.name || v.name}`);
  });
  res.json({ ok: true });
}));

app.delete('/api/vendors/:id', need('records.delete'), h((req, res) => {
  const v = row('SELECT * FROM vendors WHERE id = ?', Number(req.params.id));
  if (!v) throw notFound('Vendor');
  const linked = row('SELECT (SELECT COUNT(*) FROM event_vendors WHERE vendor_id = ?) + (SELECT COUNT(*) FROM payments WHERE vendor_id = ?) AS n', v.id, v.id).n;
  if (linked) throw new HttpError(409, 'This vendor has bookings or payments, so it cannot be deleted. Mark it inactive instead.');
  tx(() => {
    run('DELETE FROM vendors WHERE id = ?', v.id);
    log(req.user, 'delete', 'vendor', v.id, `Deleted vendor ${v.name}`);
  });
  res.json({ ok: true });
}));

// ---------- labor ----------
app.get('/api/workers', need('labor.view'), h((req, res) => {
  const where = [];
  const params = [];
  if (req.query.skill) { where.push('w.skill = ?'); params.push(String(req.query.skill)); }
  if (req.query.active !== 'all') where.push('w.active = 1');
  if (req.query.q) {
    const q = `%${String(req.query.q).slice(0, 100)}%`;
    where.push('(w.name LIKE ? OR w.phone LIKE ? OR w.city LIKE ?)');
    params.push(q, q, q);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  const list = rows(`
    SELECT w.*,
      (SELECT COUNT(*) FROM event_workers ew WHERE ew.worker_id = w.id) AS shift_count,
      (SELECT MAX(work_date) FROM event_workers ew WHERE ew.worker_id = w.id AND ew.attendance = 'present') AS last_worked
    FROM workers w ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY w.skill, w.name LIMIT 2000`, ...params);
  if (date) {
    const busy = rows(`SELECT ew.worker_id, e.title FROM event_workers ew JOIN events e ON e.id = ew.event_id
      WHERE ew.work_date = ? AND e.status != 'cancelled'`, date);
    for (const w of list) w.busy = busy.filter((b) => b.worker_id === w.id).map((b) => b.title);
  }
  send(req, res, { workers: list });
}));

app.get('/api/workers/:id', need('labor.view'), h((req, res) => {
  const w = row('SELECT * FROM workers WHERE id = ?', Number(req.params.id));
  if (!w) throw notFound('Worker');
  const shifts = req.user.can('events.view') ? rows(`
    SELECT ew.*, e.title, e.venue, e.status AS event_status FROM event_workers ew JOIN events e ON e.id = ew.event_id
    WHERE ew.worker_id = ? ORDER BY ew.work_date DESC`, w.id) : [];
  const out = { worker: w, shifts };
  if (req.user.can('finance.view')) {
    out.payments = rows(`SELECT p.*, e.title AS event_title FROM payments p LEFT JOIN events e ON e.id = p.event_id
      WHERE p.worker_id = ? ORDER BY p.paid_on DESC, p.id DESC`, w.id);
    const earned = rows(`SELECT COALESCE(SUM(wage), 0) AS s FROM event_workers WHERE worker_id = ? AND attendance = 'present'`, w.id)[0].s;
    const paid = out.payments.reduce((s, p) => s + p.amount, 0);
    out.money = { earned, paid, pending: earned - paid };
  }
  send(req, res, out);
}));

app.post('/api/workers', need('labor.edit'), h((req, res) => {
  const data = readFields(req.body, SPEC.worker, req.user);
  const id = tx(() => {
    const newId = insert('workers', data);
    log(req.user, 'create', 'worker', newId, `Added worker ${data.name} (${data.skill})`);
    return newId;
  });
  res.json({ id });
}));

app.put('/api/workers/:id', need('labor.edit'), h((req, res) => {
  const w = row('SELECT * FROM workers WHERE id = ?', Number(req.params.id));
  if (!w) throw notFound('Worker');
  const data = readFields(req.body, SPEC.worker, req.user, { partial: true });
  tx(() => {
    update('workers', w.id, data);
    log(req.user, 'update', 'worker', w.id, `Updated worker ${data.name || w.name}`, 'daily_wage' in data && data.daily_wage !== w.daily_wage);
  });
  res.json({ ok: true });
}));

app.delete('/api/workers/:id', need('records.delete'), h((req, res) => {
  const w = row('SELECT * FROM workers WHERE id = ?', Number(req.params.id));
  if (!w) throw notFound('Worker');
  const linked = row('SELECT (SELECT COUNT(*) FROM event_workers WHERE worker_id = ?) + (SELECT COUNT(*) FROM payments WHERE worker_id = ?) AS n', w.id, w.id).n;
  if (linked) throw new HttpError(409, 'This worker has shifts or payments, so they cannot be deleted. Mark them inactive instead.');
  tx(() => {
    run('DELETE FROM workers WHERE id = ?', w.id);
    log(req.user, 'delete', 'worker', w.id, `Deleted worker ${w.name}`);
  });
  res.json({ ok: true });
}));

// ---------- tasks ----------
const TASK_SQL = `
  SELECT t.*, u.name AS assignee_name, e.title AS event_title, e.start_date AS event_date, c.name AS created_by_name
  FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN events e ON e.id = t.event_id
  LEFT JOIN users c ON c.id = t.created_by`;

app.get('/api/tasks', h((req, res) => {
  const u = req.user;
  const where = [];
  const params = [];
  const seeAll = u.can('tasks.manage') || u.can('events.view');
  if (req.query.scope !== 'all' || !seeAll) { where.push('t.assigned_to = ?'); params.push(u.id); }
  if (req.query.status === 'done') where.push('t.done = 1');
  else if (req.query.status !== 'all') where.push('t.done = 0');
  const list = rows(`${TASK_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.done, t.due_date IS NULL, t.due_date, t.id DESC LIMIT 500`, ...params);
  res.json({ tasks: list, canSeeAll: seeAll });
}));

app.post('/api/tasks', h((req, res) => {
  const u = req.user;
  const data = readFields(req.body, SPEC.task, u);
  if (!u.can('tasks.manage')) data.assigned_to = u.id;
  if (data.event_id && !row('SELECT id FROM events WHERE id = ?', data.event_id)) throw notFound('Event');
  if (data.assigned_to && !row('SELECT id FROM users WHERE id = ? AND active = 1', data.assigned_to)) throw notFound('Team member');
  data.created_by = u.id;
  const id = tx(() => {
    const newId = insert('tasks', data);
    const who = data.assigned_to ? row('SELECT name FROM users WHERE id = ?', data.assigned_to).name : 'nobody';
    log(u, 'create', 'task', newId, `Added task "${data.title}" for ${who}`);
    return newId;
  });
  res.json({ id });
}));

app.put('/api/tasks/:id', h((req, res) => {
  const u = req.user;
  const t = row('SELECT * FROM tasks WHERE id = ?', Number(req.params.id));
  if (!t) throw notFound('Task');
  const manager = u.can('tasks.manage');
  if (!manager && t.assigned_to !== u.id) throw forbidden('You can only update tasks assigned to you.');
  const data = manager ? readFields(req.body, SPEC.task, u, { partial: true }) : {};
  if ('done' in req.body) {
    data.done = convert(req.body.done, { type: 'bool' });
    data.done_at = data.done ? new Date().toISOString() : null;
  }
  tx(() => {
    update('tasks', t.id, data);
    if ('done' in data && data.done !== t.done) log(u, 'update', 'task', t.id, `${data.done ? 'Completed' : 'Reopened'} task "${t.title}"`);
  });
  res.json({ ok: true });
}));

app.delete('/api/tasks/:id', need('tasks.manage'), h((req, res) => {
  const t = row('SELECT * FROM tasks WHERE id = ?', Number(req.params.id));
  if (!t) throw notFound('Task');
  tx(() => {
    run('DELETE FROM tasks WHERE id = ?', t.id);
    log(req.user, 'delete', 'task', t.id, `Deleted task "${t.title}"`);
  });
  res.json({ ok: true });
}));

// ---------- payments ----------
app.get('/api/payments', need('finance.view'), h((req, res) => {
  const where = [];
  const params = [];
  if (req.query.direction === 'in' || req.query.direction === 'out') { where.push('p.direction = ?'); params.push(req.query.direction); }
  if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) { where.push('substr(p.paid_on, 1, 7) = ?'); params.push(req.query.month); }
  const list = rows(`
    SELECT p.*, e.title AS event_title, v.name AS vendor_name, w.name AS worker_name, u.name AS created_by_name
    FROM payments p LEFT JOIN events e ON e.id = p.event_id LEFT JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN workers w ON w.id = p.worker_id LEFT JOIN users u ON u.id = p.created_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`, ...params);
  res.json({ payments: list });
}));

app.get('/api/dues', need('finance.view'), h((_req, res) => res.json(dues())));

app.post('/api/payments', need('finance.edit'), h((req, res) => {
  const data = readFields(req.body, SPEC.payment, req.user);
  if (!(data.amount > 0)) throw bad('Amount must be more than zero.');
  if (data.direction === 'in' && !['client', 'other'].includes(data.party_type)) throw bad('Money received must be from a client or "other".');
  if (data.direction === 'out' && data.party_type === 'client') data.party_type = 'other';
  if (data.party_type !== 'vendor') data.vendor_id = null;
  if (data.party_type !== 'worker') data.worker_id = null;
  let who = data.party_name || '';
  if (data.party_type === 'vendor') {
    const v = data.vendor_id && row('SELECT name FROM vendors WHERE id = ?', data.vendor_id);
    if (!v) throw bad('Pick the vendor who was paid.');
    who = v.name;
  }
  if (data.party_type === 'worker') {
    const w = data.worker_id && row('SELECT name FROM workers WHERE id = ?', data.worker_id);
    if (!w) throw bad('Pick the worker who was paid.');
    who = w.name;
  }
  let ev = null;
  if (data.event_id) {
    ev = row('SELECT id, title, client_name FROM events WHERE id = ?', data.event_id);
    if (!ev) throw notFound('Event');
  }
  if (data.party_type === 'client') {
    if (!ev) throw bad('Pick the event this client payment is for.');
    who = ev.client_name || 'client';
  }
  data.created_by = req.user.id;
  const id = tx(() => {
    const newId = insert('payments', data);
    const summary = data.direction === 'in'
      ? `Received ${fmtMoney(data.amount)} from ${who}${ev ? ` for "${ev.title}"` : ''} (${data.method})`
      : `Paid ${fmtMoney(data.amount)} to ${who || 'other'}${ev ? ` for "${ev.title}"` : ''} (${data.method})`;
    log(req.user, 'create', 'payment', newId, summary, true);
    return newId;
  });
  res.json({ id });
}));

app.delete('/api/payments/:id', need('finance.edit', 'records.delete'), h((req, res) => {
  const p = row('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
  if (!p) throw notFound('Payment');
  tx(() => {
    run('DELETE FROM payments WHERE id = ?', p.id);
    log(req.user, 'delete', 'payment', p.id, `Deleted a ${p.direction === 'in' ? 'received' : 'paid'} payment of ${fmtMoney(p.amount)} dated ${p.paid_on}`, true);
  });
  res.json({ ok: true });
}));

// ---------- team & permissions ----------
function loadRole(id) {
  const r = row('SELECT * FROM roles WHERE id = ?', id);
  if (!r) throw notFound('Role');
  return { ...r, permissions: r.is_owner ? PERMISSION_KEYS : normalizePermissions(JSON.parse(r.permissions || '[]')) };
}

// A non-founder with team access can't hand out more power than they have.
function assertCanGrant(user, role) {
  if (user.is_owner) return;
  if (role.is_owner) throw forbidden('Only a Founder can give someone Founder access.');
  const extra = role.permissions.filter((p) => !user.can(p));
  if (extra.length) throw forbidden("You can't give permissions you don't have yourself.");
}

const activeOwners = () => row(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_owner = 1 AND u.active = 1`).n;

app.get('/api/team', need('team.manage'), h((_req, res) => {
  const users = rows(`SELECT u.id, u.name, u.login, u.phone, u.role_id, u.active, u.must_change_password, u.last_login_at, u.created_at,
    r.name AS role_name, r.is_owner FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.active DESC, r.is_owner DESC, u.name`);
  const roles = rows(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.is_owner DESC, r.id`)
    .map((r) => ({ ...r, permissions: r.is_owner ? PERMISSION_KEYS : normalizePermissions(JSON.parse(r.permissions || '[]')) }));
  res.json({ users, roles, catalog: PERMISSIONS });
}));

app.post('/api/team/users', need('team.manage'), h((req, res) => {
  const name = convert(req.body.name, { type: 'str' }, 'name');
  const login = normLogin(req.body.login);
  if (!name) throw bad('Name is required.');
  if (!login) throw bad('Email or phone number is required.');
  checkPassword(req.body.password);
  const role = loadRole(convert(req.body.role_id, { type: 'id' }, 'role'));
  assertCanGrant(req.user, role);
  if (row('SELECT id FROM users WHERE login = ?', login)) throw bad('Someone already uses that email / phone to log in.');
  const id = tx(() => {
    const newId = insert('users', {
      name, login, phone: convert(req.body.phone, { type: 'str' }, 'phone') || (login.includes('@') ? null : login),
      password_hash: hashPassword(req.body.password), role_id: role.id, must_change_password: 1,
    });
    log(req.user, 'create', 'user', newId, `Added team member ${name} as ${role.name}`);
    return newId;
  });
  res.json({ id });
}));

app.put('/api/team/users/:id', need('team.manage'), h((req, res) => {
  const target = row('SELECT u.*, r.is_owner FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', Number(req.params.id));
  if (!target) throw notFound('Team member');
  if (target.is_owner && !req.user.is_owner) throw forbidden('Only a Founder can change a Founder account.');
  const data = {};
  if ('name' in req.body) {
    data.name = convert(req.body.name, { type: 'str' }, 'name');
    if (!data.name) throw bad('Name is required.');
  }
  if ('phone' in req.body) data.phone = convert(req.body.phone, { type: 'str' }, 'phone');
  if ('login' in req.body) {
    data.login = normLogin(req.body.login);
    if (!data.login) throw bad('Email or phone number is required.');
    const clash = row('SELECT id FROM users WHERE login = ? AND id != ?', data.login, target.id);
    if (clash) throw bad('Someone already uses that email / phone to log in.');
  }
  let newRole = null;
  if ('role_id' in req.body) {
    newRole = loadRole(convert(req.body.role_id, { type: 'id' }, 'role'));
    assertCanGrant(req.user, newRole);
    data.role_id = newRole.id;
  }
  if ('active' in req.body) data.active = convert(req.body.active, { type: 'bool' });
  if (target.id === req.user.id && (data.active === 0 || (newRole && !newRole.is_owner && target.is_owner))) {
    throw bad("You can't deactivate yourself or remove your own Founder access.");
  }
  tx(() => {
    update('users', target.id, data);
    if (target.is_owner && activeOwners() === 0) throw bad('There must always be at least one active Founder.');
    if (data.active === 0) run('DELETE FROM sessions WHERE user_id = ?', target.id);
    const parts = [];
    if (newRole && newRole.id !== target.role_id) parts.push(`role → ${newRole.name}`);
    if ('active' in data && data.active !== target.active) parts.push(data.active ? 'reactivated' : 'deactivated');
    if (data.name && data.name !== target.name) parts.push('name');
    if (data.login && data.login !== target.login) parts.push('login');
    if (parts.length) log(req.user, 'update', 'user', target.id, `Team member ${data.name || target.name}: ${parts.join(', ')}`);
  });
  res.json({ ok: true });
}));

app.post('/api/team/users/:id/password', need('team.manage'), h((req, res) => {
  const target = row('SELECT u.*, r.is_owner FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', Number(req.params.id));
  if (!target) throw notFound('Team member');
  if (target.is_owner && !req.user.is_owner) throw forbidden('Only a Founder can reset a Founder password.');
  checkPassword(req.body.password);
  tx(() => {
    run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hashPassword(req.body.password), target.id);
    run('DELETE FROM sessions WHERE user_id = ?', target.id);
    log(req.user, 'update', 'user', target.id, `Reset the password for ${target.name}`);
  });
  res.json({ ok: true });
}));

app.post('/api/team/roles', need('team.manage'), h((req, res) => {
  const name = convert(req.body.name, { type: 'str' }, 'name');
  if (!name) throw bad('Role name is required.');
  if (row('SELECT id FROM roles WHERE name = ?', name)) throw bad('A role with that name already exists.');
  const permissions = normalizePermissions(req.body.permissions);
  assertCanGrant(req.user, { is_owner: 0, permissions });
  const id = tx(() => {
    const newId = insert('roles', {
      name, description: convert(req.body.description, { type: 'str' }, 'description'), permissions: JSON.stringify(permissions),
    });
    log(req.user, 'create', 'role', newId, `Created role "${name}"`);
    return newId;
  });
  res.json({ id });
}));

app.put('/api/team/roles/:id', need('team.manage'), h((req, res) => {
  const role = loadRole(Number(req.params.id));
  if (role.is_owner) throw bad('The Founder role always has full access and cannot be changed.');
  const data = {};
  if ('name' in req.body) {
    data.name = convert(req.body.name, { type: 'str' }, 'name');
    if (!data.name) throw bad('Role name is required.');
    if (row('SELECT id FROM roles WHERE name = ? AND id != ?', data.name, role.id)) throw bad('A role with that name already exists.');
  }
  if ('description' in req.body) data.description = convert(req.body.description, { type: 'str' }, 'description');
  let added = [];
  let removed = [];
  if ('permissions' in req.body) {
    const next = normalizePermissions(req.body.permissions);
    added = next.filter((p) => !role.permissions.includes(p));
    removed = role.permissions.filter((p) => !next.includes(p));
    if (!req.user.is_owner && [...added, ...removed].some((p) => !req.user.can(p))) {
      throw forbidden("You can't change permissions you don't have yourself.");
    }
    if (!req.user.is_owner && role.id === req.user.role_id) throw forbidden("You can't change your own role's permissions.");
    data.permissions = JSON.stringify(next);
  }
  tx(() => {
    update('roles', role.id, data);
    const label = (k) => PERMISSIONS.find((p) => p.key === k)?.label || k;
    const parts = [];
    if (added.length) parts.push(`allowed: ${added.map(label).join('; ')}`);
    if (removed.length) parts.push(`removed: ${removed.map(label).join('; ')}`);
    if (data.name && data.name !== role.name) parts.push(`renamed to "${data.name}"`);
    if (parts.length) log(req.user, 'update', 'role', role.id, `Changed role "${role.name}" — ${parts.join(' | ')}`);
  });
  res.json({ ok: true });
}));

app.delete('/api/team/roles/:id', need('team.manage'), h((req, res) => {
  const role = loadRole(Number(req.params.id));
  if (role.is_owner) throw bad('The Founder role cannot be deleted.');
  if (row('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', role.id).n) throw bad('Move everyone off this role before deleting it.');
  assertCanGrant(req.user, role);
  tx(() => {
    run('DELETE FROM roles WHERE id = ?', role.id);
    log(req.user, 'delete', 'role', role.id, `Deleted role "${role.name}"`);
  });
  res.json({ ok: true });
}));

// ---------- activity & settings ----------
app.get('/api/activity', need('activity.view'), h((req, res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const list = rows(`
    SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.id < ? ${req.user.can('finance.view') ? '' : 'AND a.sensitive = 0'}
    ORDER BY a.id DESC LIMIT 100`, before);
  res.json({ activity: list });
}));

app.put('/api/settings', need('settings.manage'), h((req, res) => {
  const b = req.body || {};
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 100);
  tx(() => {
    if ('business_name' in b) setSetting('business_name', convert(b.business_name, { type: 'str' }, 'name') || 'My Events Co.');
    if ('currency' in b) setSetting('currency', String(b.currency || '').trim().slice(0, 5));
    if ('country_code' in b) {
      const cc = String(b.country_code || '').replace(/\D/g, '').slice(0, 4);
      if (!cc) throw bad('Country code is required (e.g. 91 for India).');
      setSetting('country_code', cc);
    }
    if ('timezone' in b) {
      const tz = String(b.timezone || '').trim();
      try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw bad('Unknown time zone.'); }
      setSetting('timezone', tz);
    }
    for (const k of ['event_types', 'vendor_categories', 'labor_skills']) {
      if (k in b) {
        const v = list(b[k]);
        if (!v.length) throw bad('Lists cannot be empty.');
        setSetting(k, v);
      }
    }
    log(req.user, 'update', 'settings', null, 'Updated business settings');
  });
  res.json({ settings: getSettings() });
}));

// ---------- errors ----------
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') err = bad('Invalid request.');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`EventDesk running on http://localhost:${PORT}`));
}

module.exports = app;
