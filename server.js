const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const ical = require('node-ical');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const APP_VERSION = '3.0.1';

function formatLocalDate(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'family.db');
const db = new sqlite3.Database(DB_PATH);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/photos', express.static(PHOTOS_DIR));

// Hash password helper
function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + 'FamilyHubSalt2026').digest('hex');
}

// WebSocket broadcast
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Database helper promises
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => e ? rej(e) : res(r)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));

// --- DATABASE TABLES ---
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');

  // Usuarios / Admin
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Miembros de la familia (4 miembros)
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL, -- 'parent' or 'child'
    color TEXT NOT NULL,
    avatar TEXT NOT NULL,
    photo_url TEXT,
    birthdate TEXT, -- YYYY-MM-DD
    points INTEGER DEFAULT 0,
    ical_url TEXT,
    streak_days INTEGER DEFAULT 0
  )`);

  // Migración segura si la tabla ya existía
  db.run(`ALTER TABLE members ADD COLUMN photo_url TEXT`, () => {});
  db.run(`ALTER TABLE members ADD COLUMN birthdate TEXT`, () => {});

  // Tareas para cada miembro
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    points INTEGER DEFAULT 10,
    member_id INTEGER,
    frequency TEXT DEFAULT 'daily', -- 'daily', 'weekly', 'once'
    status TEXT DEFAULT 'pending', -- 'pending', 'completed'
    completed_at TEXT,
    icon TEXT DEFAULT '⭐',
    FOREIGN KEY(member_id) REFERENCES members(id)
  )`);

  // Tienda de recompensas
  db.run(`CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cost INTEGER NOT NULL,
    icon TEXT DEFAULT '🎁',
    description TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reward_id INTEGER,
    member_id INTEGER,
    cost INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'approved',
    FOREIGN KEY(reward_id) REFERENCES rewards(id),
    FOREIGN KEY(member_id) REFERENCES members(id)
  )`);

  // Calendario Local (4 calendarios)
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    member_id INTEGER, -- 1: Papá, 2: Mamá, 3: Hijo 1, 4: Hijo 2, null: Familia
    date TEXT NOT NULL, -- YYYY-MM-DD
    time TEXT, -- HH:MM
    all_day INTEGER DEFAULT 0,
    notes TEXT,
    source TEXT DEFAULT 'local', -- 'local', 'ical', 'community'
    FOREIGN KEY(member_id) REFERENCES members(id)
  )`);

  // Menú Semanal (Lunes a Domingo: comida y cena)
  db.run(`CREATE TABLE IF NOT EXISTS weekly_menu (
    day_of_week INTEGER PRIMARY KEY, -- 1: Lunes ... 7: Domingo
    lunch TEXT,
    dinner TEXT
  )`);

  // Lista de la compra interactiva
  db.run(`CREATE TABLE IF NOT EXISTS shopping_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    checked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tablón de anuncios / Notas
  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    author TEXT DEFAULT 'Familia',
    color TEXT DEFAULT '#fef08a', -- post-it yellow
    pinned INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Cámaras Tapo
  db.run(`CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    rtsp_url TEXT,
    snapshot_url TEXT,
    location TEXT
  )`);

  // Fotos para el marco digital / salvapantallas
  db.run(`CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    caption TEXT,
    uploaded_by TEXT DEFAULT 'Familia',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Configuración general
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Eventos ocultos (iCal / Externos / Cumpleaños descartados)
  db.run(`CREATE TABLE IF NOT EXISTS hidden_events (
    id TEXT PRIMARY KEY
  )`);

  // --- SEED DEFAULTS ---
  db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
    if (!err && row.count === 0) {
      console.log('Creando usuario administrador...');
      const adminPass = process.env.ADMIN_PASSWORD || 'Admin1234.';
      const adminPassHash = hashPassword(adminPass);
      db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['admin', adminPassHash, 'admin']);
    }
  });

  db.get(`SELECT COUNT(*) as count FROM members`, (err, row) => {
    if (!err && row.count === 0) {
      console.log('Sembrando miembros y configuración familiar...');
      db.run(`INSERT INTO members (id, name, role, color, avatar, points, birthdate) VALUES
        (1, 'Papá', 'parent', '#3b82f6', '👨', 0, '1985-05-15'),
        (2, 'Mamá', 'parent', '#ec4899', '👩', 0, '1987-09-20'),
        (3, 'Hijo 1', 'child', '#10b981', '👦', 60, '2016-04-12'),
        (4, 'Hija 1', 'child', '#f59e0b', '👧', 40, '2018-08-25')
      `);

      db.run(`INSERT INTO tasks (title, points, member_id, frequency, icon) VALUES
        ('Hacer la cama', 10, 3, 'daily', '🛏️'),
        ('Deberes del cole', 20, 3, 'daily', '📚'),
        ('Lavarse los dientes (noche)', 10, 3, 'daily', '😁'),
        ('Poner o quitar la mesa', 15, 3, 'daily', '🍽️'),
        ('Hacer la cama', 10, 4, 'daily', '🛏️'),
        ('Recoger juguetes', 15, 4, 'daily', '🎲'),
        ('Lavarse los dientes (noche)', 10, 4, 'daily', '😁'),
        ('Leer 15 minutos', 20, 4, 'daily', '📖'),
        ('Poner lavadora', 0, 1, 'daily', '👕'),
        ('Revisar compra semanal', 0, 2, 'daily', '🍎')
      `);

      db.run(`INSERT INTO rewards (title, cost, icon, description) VALUES
        ('Elegir película del viernes', 30, '🎬', 'Tú decides qué vemos en familia'),
        ('1 hora de videojuegos / tablet', 50, '🎮', 'Tiempo extra de juego'),
        ('Elegir la cena del sábado', 80, '🍕', 'Pizza, hamburguesa o lo que prefieras'),
        ('Excursión o parque especial', 100, '🌳', 'Planazo familiar de finde'),
        ('Regalo especial / Juguete / Libro', 200, '🎁', 'Gran recompensa acumulada')
      `);

      for (let day = 1; day <= 7; day++) {
        const lunches = ['', 'Lentejas caseras', 'Pasta a la boloñesa', 'Arroz con pollo', 'Crema de verduras y filete', 'Guiso de patatas con carne', 'Paella familiar', 'Comida especial domingo'];
        const dinners = ['', 'Tortilla de patatas con ensalada', 'Pescado a la plancha con verduras', 'Sándwiches y fruta', 'Sopa de fideos y croquetas', 'Hamburguesas caseras', 'Noche de pizza 🍕', 'Cena ligera y fruta'];
        db.run(`INSERT INTO weekly_menu (day_of_week, lunch, dinner) VALUES (?, ?, ?)`, [day, lunches[day], dinners[day]]);
      }

      db.run(`INSERT INTO shopping_list (item, category) VALUES
        ('Leche entera', 'Lácteos'),
        ('Huevos camperos', 'Frescos'),
        ('Pan de pueblo', 'Panadería'),
        ('Fruta variada (plátanos y manzanas)', 'Frutas')
      `);

      db.run(`INSERT INTO notes (text, author, color) VALUES
        ('¡Bienvenidos a vuestro panel familiar OpenFamily! ❤️', 'Papá y Mamá', '#fef08a'),
        ('Recordar llevar las zapatillas de deporte el jueves al cole 👟', 'Mamá', '#fed7aa')
      `);

      db.run(`INSERT INTO cameras (name, ip, rtsp_url, location) VALUES
        ('Cámara Salón', '192.168.1.100', 'rtsp://usuario:password@192.168.1.100:554/stream2', 'Salón'),
        ('Cámara Entrada / Jardín', '192.168.1.101', 'rtsp://usuario:password@192.168.1.101:554/stream2', 'Exterior')
      `);

      const defaultSettings = [
        ['location_name', process.env.CITY_NAME || 'Mi Hogar'],
        ['latitude', process.env.LATITUDE || '40.4168'],
        ['longitude', process.env.LONGITUDE || '-3.7038'],
        ['parent_pin', process.env.PARENT_PIN || '1234'],
        ['soto_feed_url', process.env.ICAL_URL || ''],
        ['screensaver_timeout_minutes', '5'],
        ['app_version', APP_VERSION]
      ];
      for (const [k, v] of defaultSettings) {
        db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, String(v)]);
      }
    }
  });

  // Asegurar compatibilidad de emojis con Android 6.0.1 (reemplazar emojis Unicode 9+ que salen como cuadro vacío)
  db.run(`UPDATE tasks SET icon = '😁' WHERE icon IN ('🪥', '🦷')`);
  db.run(`UPDATE tasks SET icon = '🎲' WHERE icon IN ('🧸', '🧩')`);
  db.run(`UPDATE tasks SET icon = '👕' WHERE icon = '🧺'`);
  db.run(`UPDATE tasks SET icon = '🍎' WHERE icon = '🛒'`);
  db.run(`UPDATE tasks SET icon = '✨' WHERE icon = '🧹'`);
  db.run(`UPDATE tasks SET icon = '🌱' WHERE icon = '🪴'`);
});

// --- CLIMA (Open-Meteo con 7 días de previsión) ---
let weatherCache = { data: null, lastFetch: 0 };
async function getWeather(lat = 40.4168, lon = -3.7038, locName = 'Mi Hogar') {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.lastFetch < 15 * 60 * 1000) {
    return weatherCache.data;
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
    const response = await fetch(url);
    const data = await response.json();
    data.location_name = locName;
    weatherCache = { data, lastFetch: now };
    return data;
  } catch (err) {
    console.error('Error al obtener clima:', err);
    return weatherCache.data || null;
  }
}

// --- SINCRONIZACIÓN GOOGLE CALENDAR / CALENDARIOS EXTERNOS (iCal) ---
let icalEventsCache = [];
let lastIcalSync = 0;
async function syncExternalCalendars() {
  const now = Date.now();
  if (now - lastIcalSync < 30 * 60 * 1000 && icalEventsCache.length > 0) {
    return icalEventsCache;
  }
  const events = [];
  try {
    const members = await dbAll('SELECT id, name, color, ical_url FROM members WHERE ical_url IS NOT NULL AND ical_url != ""');
    for (const m of members) {
      try {
        const webEvents = await ical.async.fromURL(m.ical_url);
        for (const k in webEvents) {
          const ev = webEvents[k];
          if (ev.type === 'VEVENT' && ev.start) {
            const dateStr = formatLocalDate(ev.start);
            const timeStr = ev.start.toTimeString().substring(0, 5);
            events.push({
              id: 'ical_' + k,
              title: ev.summary || 'Sin título',
              member_id: m.id,
              member_name: m.name,
              color: m.color,
              date: dateStr,
              time: timeStr,
              all_day: ev.datetype === 'date' ? 1 : 0,
              source: 'ical'
            });
          }
        }
      } catch (e) {
        console.error(`Error sincronizando calendario de ${m.name}:`, e.message);
      }
    }

    // Agenda Comunitaria / Local iCal opcional
    const communitySetting = await dbGet("SELECT value FROM settings WHERE key = 'community_feed_url' OR key = 'soto_feed_url'");
    if (communitySetting && communitySetting.value) {
      try {
        const extEvents = await ical.async.fromURL(communitySetting.value);
        for (const k in extEvents) {
          const ev = extEvents[k];
          if (ev.type === 'VEVENT' && ev.start) {
            events.push({
              id: 'community_' + k,
              title: '🏛️ ' + (ev.summary || 'Evento Comunitario'),
              member_id: null,
              member_name: 'Agenda Local',
              color: '#0284c7',
              date: formatLocalDate(ev.start),
              time: ev.start.toTimeString().substring(0, 5),
              all_day: ev.datetype === 'date' ? 1 : 0,
              source: 'community'
            });
          }
        }
      } catch (e) {
        // Feed institucional o externo puede fallar temporalmente
      }
    }

    icalEventsCache = events;
    lastIcalSync = now;
  } catch (err) {
    console.error('Error general sincronizando calendarios externos:', err);
  }
  return icalEventsCache;
}

// --- SISTEMA DE AUTENTICACIÓN Y SEGURIDAD PADRES / MARCO ---
const AUTH_SECRET = process.env.AUTH_SECRET || 'OpenFamilySecretKey_ChangeMeInProd_2026';
const KIOSK_TOKEN = process.env.KIOSK_TOKEN || 'kiosk_openfamily_token_secure';

function generateToken(payload, remember = true) {
  const expiresIn = remember ? 180 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const data = JSON.stringify({ ...payload, exp: Date.now() + expiresIn });
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + hmac;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, hmac] = parts;
  try {
    const raw = Buffer.from(b64, 'base64').toString('utf-8');
    const expectedHmac = crypto.createHmac('sha256', AUTH_SECRET).update(raw).digest('hex');
    if (hmac !== expectedHmac) return null;
    const payload = JSON.parse(raw);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const c of cookies) {
    if (c.startsWith(name + '=')) {
      return decodeURIComponent(c.substring(name.length + 1));
    }
  }
  return null;
}

// Control de intentos erróneos por IP (protección fuerza bruta)
const loginAttempts = new Map();

// Endpoint de login por PIN (Padres y Familia)
app.post('/api/auth/login-pin', async (req, res) => {
  try {
    const clientIp = req.ip || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };

    if (attempt.lockedUntil > now) {
      const secondsLeft = Math.ceil((attempt.lockedUntil - now) / 1000);
      return res.status(429).json({ error: `Demasiados intentos. Espera ${secondsLeft}s.` });
    }

    const { pin, remember, asKiosk } = req.body;
    const row = await dbGet('SELECT value FROM settings WHERE key = "parent_pin"');
    const correctPin = (row && row.value) ? String(row.value).trim() : '1234';

    if (String(pin).trim() === correctPin) {
      loginAttempts.delete(clientIp);
      const role = asKiosk ? 'kiosk' : 'parent';
      const token = generateToken({ role, authenticated: true }, remember !== false);
      return res.json({ success: true, token, role });
    } else {
      attempt.count += 1;
      if (attempt.count >= 5) {
        attempt.lockedUntil = now + 45 * 1000;
        attempt.count = 0;
      }
      loginAttempts.set(clientIp, attempt);
      return res.status(401).json({ error: 'PIN incorrecto. Revisa el código de padres.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comprobar si la sesión actual es válida
app.get('/api/auth/check', (req, res) => {
  const kioskHeader = req.headers['x-kiosk-token'];
  const kioskCookie = getCookie(req, 'family_kiosk_token');
  const userAgent = req.headers['user-agent'] || '';

  if (kioskHeader === KIOSK_TOKEN || kioskCookie === KIOSK_TOKEN || userAgent.includes('FamilyHubKiosk')) {
    return res.json({ authenticated: true, role: 'kiosk' });
  }

  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = getCookie(req, 'family_session_token');
  }

  const payload = verifyToken(token);
  if (payload) {
    return res.json({ authenticated: true, role: payload.role });
  }
  return res.json({ authenticated: false });
});

// Handshake de activación directa del marco
app.post('/api/auth/kiosk-handshake', (req, res) => {
  const token = generateToken({ role: 'kiosk', authenticated: true }, true);
  res.json({ success: true, token });
});

// Middleware que protege el acceso a los datos de la familia (/api/*)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) {
    return next();
  }

  // 1. Acceso Kiosk (App Android de la tablet)
  const kioskHeader = req.headers['x-kiosk-token'];
  const kioskCookie = getCookie(req, 'family_kiosk_token');
  const userAgent = req.headers['user-agent'] || '';

  if (kioskHeader === KIOSK_TOKEN || kioskCookie === KIOSK_TOKEN || userAgent.includes('FamilyHubKiosk')) {
    req.user = { role: 'kiosk', isKiosk: true };
    return next();
  }

  // 2. Acceso local desde la red doméstica (LAN / Wi-Fi de casa)
  const isFromInternet = !!(req.headers['cf-ray'] || req.headers['cf-connecting-ip']);
  if (!isFromInternet) {
    req.user = { role: 'family_local', isLocal: true };
    return next();
  }

  // 3. Acceso desde Internet (Cloudflare): requiere sesión autenticada con PIN de padres
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = getCookie(req, 'family_session_token');
  }

  const payload = verifyToken(token);
  if (payload) {
    req.user = payload;
    return next();
  }

  return res.status(401).json({ error: 'Acceso restringido a padres. Introduce el PIN.', authenticated: false });
});

// --- API ENDPOINTS ---

// Autenticación Admin
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const hash = hashPassword(password);
    if (hash !== user.password_hash) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    res.json({ success: true, user: { username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estado Completo (Marco + Móviles)
app.get('/api/state', async (req, res) => {
  try {
    const members = await dbAll('SELECT * FROM members ORDER BY id');
    const tasks = await dbAll('SELECT t.*, m.name as member_name, m.color as member_color FROM tasks t JOIN members m ON t.member_id = m.id ORDER BY t.id');
    const rewards = await dbAll('SELECT * FROM rewards ORDER BY cost');
    const redemptions = await dbAll('SELECT r.*, m.name as member_name, rw.title as reward_title, rw.icon as reward_icon FROM redemptions r JOIN members m ON r.member_id = m.id JOIN rewards rw ON r.reward_id = rw.id ORDER BY r.id DESC LIMIT 10');
    const localEvents = await dbAll('SELECT e.*, m.color, m.name as member_name FROM events e LEFT JOIN members m ON e.member_id = m.id ORDER BY e.date, e.time');
    const externalEvents = await syncExternalCalendars();

    // Eventos automáticos de cumpleaños calculando edad exacta
    const birthdayEvents = [];
    const currentYear = new Date().getFullYear();
    for (const m of members) {
      if (m.birthdate) {
        const parts = m.birthdate.split('-');
        if (parts.length === 3) {
          const bMonth = parts[1];
          const bDay = parts[2];
          const bYear = parseInt(parts[0]);
          [currentYear - 1, currentYear, currentYear + 1].forEach(yr => {
            const age = yr - bYear;
            birthdayEvents.push({
              id: `bday_${m.id}_${yr}`,
              title: `🎂 ¡Cumpleaños de ${m.name}! (${age} años)`,
              member_id: m.id,
              member_name: m.name,
              color: m.color,
              date: `${yr}-${bMonth}-${bDay}`,
              time: null,
              all_day: 1,
              source: 'birthday'
            });
          });
        }
      }
    }

    const hiddenRows = await dbAll('SELECT id FROM hidden_events');
    const hiddenSet = new Set(hiddenRows.map(r => String(r.id)));
    const events = [...localEvents, ...birthdayEvents, ...externalEvents].filter(ev => !hiddenSet.has(String(ev.id)));
    const weeklyMenu = await dbAll('SELECT * FROM weekly_menu ORDER BY day_of_week');
    const shoppingList = await dbAll('SELECT * FROM shopping_list ORDER BY checked ASC, id DESC');
    const notes = await dbAll('SELECT * FROM notes ORDER BY pinned DESC, id DESC LIMIT 10');
    const cameras = await dbAll('SELECT * FROM cameras ORDER BY id');
    const photos = await dbAll('SELECT * FROM photos ORDER BY id DESC');
    const settingsRows = await dbAll('SELECT * FROM settings');
    const settings = settingsRows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    const weather = await getWeather(parseFloat(settings.latitude || 40.4168), parseFloat(settings.longitude || -3.7038), settings.location_name || 'Mi Hogar');

    res.json({
      version: APP_VERSION,
      members,
      tasks,
      rewards,
      redemptions,
      events,
      weeklyMenu,
      shoppingList,
      notes,
      cameras,
      photos,
      settings,
      weather
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tareas
app.post('/api/tasks/:id/toggle', async (req, res) => {
  try {
    const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

    let newStatus = task.status === 'completed' ? 'pending' : 'completed';
    let completedAt = newStatus === 'completed' ? new Date().toISOString() : null;

    await dbRun('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?', [newStatus, completedAt, task.id]);

    if (newStatus === 'completed') {
      await dbRun('UPDATE members SET points = points + ? WHERE id = ?', [task.points, task.member_id]);
    } else {
      await dbRun('UPDATE members SET points = MAX(0, points - ?) WHERE id = ?', [task.points, task.member_id]);
    }

    broadcast({ type: 'TASK_TOGGLE', taskId: task.id, status: newStatus, points: task.points, memberId: task.member_id });
    res.json({ success: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { title, points, member_id, frequency, icon } = req.body;
    await dbRun('INSERT INTO tasks (title, points, member_id, frequency, icon) VALUES (?, ?, ?, ?, ?)',
      [title, points || 10, member_id, frequency || 'daily', icon || '⭐']);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { title, points, member_id, frequency, icon } = req.body;
    await dbRun('UPDATE tasks SET title = ?, points = ?, member_id = ?, frequency = ?, icon = ? WHERE id = ?',
      [title, points || 10, member_id, frequency || 'daily', icon || '⭐', req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Canjear Premios
app.post('/api/rewards/:id/redeem', async (req, res) => {
  try {
    const { member_id } = req.body;
    const reward = await dbGet('SELECT * FROM rewards WHERE id = ?', [req.params.id]);
    const member = await dbGet('SELECT * FROM members WHERE id = ?', [member_id]);

    if (!reward || !member) return res.status(404).json({ error: 'Datos no válidos' });
    if (member.points < reward.cost) return res.status(400).json({ error: 'Puntos insuficientes' });

    await dbRun('UPDATE members SET points = points - ? WHERE id = ?', [reward.cost, member.id]);
    await dbRun('INSERT INTO redemptions (reward_id, member_id, cost) VALUES (?, ?, ?)', [reward.id, member.id, reward.cost]);

    broadcast({ type: 'REWARD_REDEEMED', memberName: member.name, rewardTitle: reward.title });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recompensas CRUD
app.post('/api/rewards', async (req, res) => {
  try {
    const { title, cost, icon, description } = req.body;
    await dbRun('INSERT INTO rewards (title, cost, icon, description) VALUES (?, ?, ?, ?)', [title, cost, icon || '🎁', description || '']);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rewards/:id', async (req, res) => {
  try {
    const { title, cost, icon, description } = req.body;
    await dbRun('UPDATE rewards SET title = ?, cost = ?, icon = ?, description = ? WHERE id = ?',
      [title, cost, icon || '🎁', description || '', req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rewards/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM rewards WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calendario Local (Eventos)
app.post('/api/events', async (req, res) => {
  try {
    const { title, member_id, date, time, all_day, notes } = req.body;
    await dbRun('INSERT INTO events (title, member_id, date, time, all_day, notes, source) VALUES (?, ?, ?, ?, ?, ?, "local")',
      [title, member_id || null, date, time || null, all_day ? 1 : 0, notes || null]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    const { title, member_id, date, time, all_day, notes } = req.body;
    await dbRun('UPDATE events SET title = ?, member_id = ?, date = ?, time = ?, all_day = ?, notes = ? WHERE id = ?',
      [title, member_id || null, date, time || null, all_day ? 1 : 0, notes || null, req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM events WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events/hide', async (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      await dbRun('INSERT OR IGNORE INTO hidden_events (id) VALUES (?)', [String(id)]);
      broadcast({ type: 'REFRESH' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events/unhide-all', async (req, res) => {
  try {
    await dbRun('DELETE FROM hidden_events');
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista de la Compra
app.post('/api/shopping', async (req, res) => {
  try {
    const { item, category } = req.body;
    await dbRun('INSERT INTO shopping_list (item, category) VALUES (?, ?)', [item, category || 'General']);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shopping/:id/toggle', async (req, res) => {
  try {
    await dbRun('UPDATE shopping_list SET checked = 1 - checked WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shopping/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM shopping_list WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shopping/clear-checked', async (req, res) => {
  try {
    await dbRun('DELETE FROM shopping_list WHERE checked = 1');
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Menú Semanal
app.post('/api/menu/:day', async (req, res) => {
  try {
    const { lunch, dinner } = req.body;
    await dbRun('INSERT OR REPLACE INTO weekly_menu (day_of_week, lunch, dinner) VALUES (?, ?, ?)', [req.params.day, lunch, dinner]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Notas / Corcho
app.post('/api/notes', async (req, res) => {
  try {
    const { text, author, color } = req.body;
    await dbRun('INSERT INTO notes (text, author, color) VALUES (?, ?, ?)', [text, author || 'Familia', color || '#fef08a']);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM notes WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Miembros (Puntos / Nombres / URLs Google Calendar)
app.post('/api/members/:id/points', async (req, res) => {
  try {
    const { delta } = req.body;
    await dbRun('UPDATE members SET points = MAX(0, points + ?) WHERE id = ?', [parseInt(delta) || 0, req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar datos de miembro (Nombre, avatar, color, birthdate, ical_url, photo_url, points)
app.post('/api/members/:id', async (req, res) => {
  try {
    const { name, avatar, color, birthdate, ical_url, photo_url, points } = req.body;
    const parsedPoints = (points !== undefined && points !== null && points !== '') ? Math.max(0, parseInt(points, 10) || 0) : null;
    await dbRun(`UPDATE members SET 
      name = COALESCE(?, name), 
      avatar = COALESCE(?, avatar), 
      color = COALESCE(?, color), 
      birthdate = COALESCE(?, birthdate), 
      ical_url = COALESCE(?, ical_url),
      photo_url = COALESCE(?, photo_url),
      points = COALESCE(?, points)
      WHERE id = ?`,
      [name, avatar, color, birthdate, ical_url, photo_url, parsedPoints, req.params.id]);
    lastIcalSync = 0; // forzar refresco
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subir foto de perfil para un miembro
app.post('/api/members/:id/photo', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No se envió ninguna imagen' });

    let buffer;
    let ext = 'jpg';
    const matches = imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      ext = matches[1].replace('jpeg', 'jpg');
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageBase64, 'base64');
    }

    const filename = `member_${req.params.id}_${Date.now()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${filename}`;
    await dbRun('UPDATE members SET photo_url = ? WHERE id = ?', [publicUrl, req.params.id]);

    broadcast({ type: 'REFRESH' });
    res.json({ success: true, photo_url: publicUrl });
  } catch (err) {
    console.error('Error al subir foto:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cámaras Tapo CRUD
app.post('/api/cameras', async (req, res) => {
  try {
    const { name, ip, rtsp_url, snapshot_url, location } = req.body;
    await dbRun('INSERT INTO cameras (name, ip, rtsp_url, snapshot_url, location) VALUES (?, ?, ?, ?, ?)',
      [name, ip, rtsp_url, snapshot_url, location]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cameras/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM cameras WHERE id = ?', [req.params.id]);
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FOTOS / MODO MARCO (SCREENSAVER) ---
app.get('/api/photos', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM photos ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/photos', async (req, res) => {
  try {
    const { image, images, caption, author } = req.body;
    const toProcess = images && Array.isArray(images) ? images : (image ? [{ image, caption }] : []);
    if (toProcess.length === 0) {
      return res.status(400).json({ error: 'No se envió ninguna imagen' });
    }

    const inserted = [];
    for (const item of toProcess) {
      const imgData = typeof item === 'string' ? item : item.image;
      const cap = (typeof item === 'object' && item.caption) ? item.caption : (caption || '');

      const matches = imgData.match(/^data:image\/([a-zA-Z0-9.+]+);base64,(.+)$/);
      if (!matches) continue;

      const rawExt = matches[1].toLowerCase();
      const ext = rawExt === 'jpeg' ? 'jpg' : (rawExt.includes('png') ? 'png' : 'jpg');
      const buffer = Buffer.from(matches[2], 'base64');
      const filename = `photo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const filePath = path.join(PHOTOS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const result = await dbRun('INSERT INTO photos (filename, caption, uploaded_by) VALUES (?, ?, ?)',
        [filename, cap, author || 'Familia']);
      inserted.push({ id: result.lastID, filename, caption: cap });
    }

    broadcast({ type: 'PHOTOS_UPDATED' });
    res.json({ success: true, count: inserted.length, photos: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    const photo = await dbGet('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (photo) {
      const filePath = path.join(PHOTOS_DIR, photo.filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      await dbRun('DELETE FROM photos WHERE id = ?', [req.params.id]);
      broadcast({ type: 'PHOTOS_UPDATED' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CONTROL REMOTO OTA Y ACCIONES PARA EL MARCO ---
app.post('/api/remote/call-dinner', (req, res) => {
  const { title = '¡A CENAR!', message = '¡Todos a la mesa en familia!' } = req.body;
  broadcast({ type: 'ALARM', title, message, sound: 'chime' });
  res.json({ success: true });
});

app.post('/api/remote/reload', (req, res) => {
  broadcast({ type: 'FORCE_RELOAD' });
  res.json({ success: true, message: 'Orden de recarga OTA enviada a todas las pantallas' });
});

app.post('/api/remote/message', (req, res) => {
  const { text } = req.body;
  broadcast({ type: 'POPUP_MESSAGE', text });
  res.json({ success: true });
});

app.post('/api/remote/night-mode', (req, res) => {
  const { active } = req.body;
  broadcast({ type: 'NIGHT_MODE', active: !!active });
  res.json({ success: true });
});

// --- ALEXA / WEBHOOK INTEGRATION ---
app.post('/api/alexa/add-item', async (req, res) => {
  try {
    const { item } = req.body;
    if (item) {
      await dbRun('INSERT INTO shopping_list (item, category) VALUES (?, "Alexa")', [item]);
      broadcast({ type: 'REFRESH' });
      return res.json({ success: true, message: `Añadido ${item} a la compra` });
    }
    res.status(400).json({ error: 'Falta el producto' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alexa/call-dinner', (req, res) => {
  broadcast({ type: 'ALARM', title: '¡A CENAR!', message: '¡Llamada desde Alexa!', sound: 'chime' });
  res.json({ success: true });
});

// Ajustes Generales
app.post('/api/settings', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
    weatherCache.lastFetch = 0;
    lastIcalSync = 0;
    broadcast({ type: 'REFRESH' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset de tareas diarias a medianoche
function scheduleDailyReset() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(async () => {
    try {
      console.log('Reiniciando tareas diarias automáticas para el nuevo día...');
      await dbRun("UPDATE tasks SET status = 'pending', completed_at = NULL WHERE frequency = 'daily'");
      broadcast({ type: 'REFRESH' });
    } catch (e) {
      console.error('Error en reset diario:', e);
    }
    scheduleDailyReset();
  }, next.getTime() - now.getTime());
}
scheduleDailyReset();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`FamilyHub v${APP_VERSION} activo en puerto ${PORT}`);
  console.log(`Usuario Admin: admin`);
  console.log(`===============================================`);
});
