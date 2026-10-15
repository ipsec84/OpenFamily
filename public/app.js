/**
 * OpenFamily: Smart Family Dashboard & Digital Photo Frame
 * Panel Familiar para Pantalla Kiosk 1280x800 & Móviles de Padres
 */

// Polyfills para Chromium 106
if (!Array.prototype.toSorted) {
  Array.prototype.toSorted = function(compareFn) {
    return [...this].sort(compareFn);
  };
}

// Estado Global
let state = {
  members: [],
  tasks: [],
  rewards: [],
  events: [],
  weeklyMenu: [],
  shoppingList: [],
  notes: [],
  cameras: [],
  photos: [],
  settings: {},
  weather: null
};

let activeMemberId = null;
let calendarFilter = 'all';
let currentRightTab = 'rewards';
let ws = null;
let audioCtx = null;
let isNightMode = false;
let isAdminLoggedIn = false;
let pendingPhotoBase64 = null;

// --- SISTEMA DE AUTENTICACIÓN Y SEGURIDAD PADRES ---
let enteredPin = '';
let currentMobileView = 'calendar';

// Interceptor global de fetch para añadir cabecera de autenticación
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  options = options || {};
  options.headers = options.headers || {};
  const token = localStorage.getItem('family_token');
  if (token) {
    if (options.headers instanceof Headers) {
      if (!options.headers.has('Authorization')) options.headers.set('Authorization', `Bearer ${token}`);
    } else {
      if (!options.headers['Authorization']) options.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  // Inyectar token de Kiosk si estamos en la app Android del marco
  if (window.Android) {
    if (options.headers instanceof Headers) {
      options.headers.set('x-kiosk-token', 'kiosk_openfamily_token_secure');
    } else {
      options.headers['x-kiosk-token'] = 'kiosk_openfamily_token_secure';
    }
  }
  const res = await originalFetch(url, options);
  if (res.status === 401 && String(url).startsWith('/api/') && !String(url).includes('/auth/login')) {
    showPinAuthOverlay();
  }
  return res;
};

// Funciones del teclado PIN
function pressPinKey(digit) {
  if (enteredPin.length < 4) {
    enteredPin += digit;
    renderPinDots();
    if (enteredPin.length === 4) {
      setTimeout(submitPin, 150);
    }
  }
}

function clearPinKey() {
  enteredPin = enteredPin.slice(0, -1);
  renderPinDots();
  const err = document.getElementById('pin-error-msg');
  if (err) err.classList.add('hidden');
}

function renderPinDots() {
  const dots = document.querySelectorAll('#pin-display .pin-dot');
  dots.forEach((dot, idx) => {
    if (idx < enteredPin.length) dot.classList.add('filled');
    else dot.classList.remove('filled');
  });
}

async function submitPin() {
  if (enteredPin.length !== 4) return;
  const remember = document.getElementById('remember-pin-device')?.checked !== false;
  const errEl = document.getElementById('pin-error-msg');

  try {
    const res = await originalFetch('/api/auth/login-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: enteredPin, remember })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (remember) {
        localStorage.setItem('family_token', data.token);
        document.cookie = `family_session_token=${encodeURIComponent(data.token)}; Path=/; Max-Age=15552000; SameSite=Lax`;
      }
      hidePinAuthOverlay();
      fetchState();
    } else {
      if (errEl) {
        errEl.textContent = data.error || 'PIN incorrecto';
        errEl.classList.remove('hidden');
      }
      enteredPin = '';
      renderPinDots();
    }
  } catch (e) {
    if (errEl) {
      errEl.textContent = 'Error de conexión con el marco';
      errEl.classList.remove('hidden');
    }
    enteredPin = '';
    renderPinDots();
  }
}

function showPinAuthOverlay() {
  const overlay = document.getElementById('parent-auth-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    enteredPin = '';
    renderPinDots();
  }
}

function hidePinAuthOverlay() {
  const overlay = document.getElementById('parent-auth-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function activateKioskMode() {
  document.cookie = 'family_kiosk_token=kiosk_openfamily_token_secure; Path=/; Max-Age=315360000; SameSite=Lax';
  hidePinAuthOverlay();
  fetchState();
}

// Control de vistas en navegación móvil (PWA)
function switchMobileView(view) {
  currentMobileView = view;
  const grid = document.getElementById('main-grid');
  if (grid) grid.setAttribute('data-mobile-view', view);

  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`mob-nav-${view}`);
  if (btn) btn.classList.add('active');

  if (view === 'shopping') switchRightTab('shopping');
  else if (view === 'menu') switchRightTab('menu');
  else if (view === 'photos') switchRightTab('photos');
  else if (view === 'more') switchRightTab('notes');
}

// Inicialización de AudioContext con interacción del usuario
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Sintetizador de Sonidos Web Audio
function playChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
    osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.3); // D6
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  } catch (e) {
    console.warn('Audio error:', e);
  }
}

function playDinnerBell() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    for (let i = 0; i < 4; i++) {
      const now = ctx.currentTime + i * 0.45;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800 + (i % 2 === 0 ? 0 : 250), now);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (e) {
    console.warn('Bell audio error:', e);
  }
}

// --- CONEXIÓN WEBSOCKET EN TIEMPO REAL ---
function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('FamilyHub WebSocket Conectado');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Mensaje WS:', data.type);

      switch (data.type) {
        case 'REFRESH':
        case 'PHOTOS_UPDATED':
          fetchState();
          break;
        case 'TASK_TOGGLE':
          if (data.status === 'completed') {
            playChime();
            triggerConfetti();
          }
          fetchState();
          break;
        case 'REWARD_REDEEMED':
          playChime();
          triggerConfetti();
          alert(`🎉 ¡${data.memberName} ha canjeado "${data.rewardTitle}"!`);
          fetchState();
          break;
        case 'ALARM':
          playDinnerBell();
          showAlarm(data.title, data.message);
          break;
        case 'FORCE_RELOAD':
          console.log('Orden OTA de recarga recibida.');
          window.location.reload(true);
          break;
        case 'POPUP_MESSAGE':
          alert(`📢 Mensaje de los Padres:\n\n${data.text}`);
          break;
        case 'NIGHT_MODE':
          toggleNightMode(data.active);
          break;
      }
    } catch (err) {
      console.error('Error procesando WS:', err);
    }
  };

  ws.onclose = () => {
    console.warn('WebSocket desconectado. Reconectando en 3s...');
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// --- CARGA DE ESTADO GENERAL ---
async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) {
      if (res.status === 401) {
        showPinAuthOverlay();
        return;
      }
      throw new Error('Error al obtener estado');
    }
    hidePinAuthOverlay();
    state = await res.json();

    if (!activeMemberId && state.members.length > 0) {
      // Por defecto seleccionar el primer niño o el primer miembro
      const firstChild = state.members.find(m => m.role === 'child');
      activeMemberId = firstChild ? firstChild.id : state.members[0].id;
    }

    renderAll();
    if (window.PhotoLocalCache && state.photos && state.photos.length > 0) {
      PhotoLocalCache.syncServerPhotos(state.photos);
    }
  } catch (err) {
    console.error('Error cargando estado:', err);
  }
}

// --- RENDERIZADO GLOBAL ---
function renderAll() {
  renderHeaderWeather();
  renderCalendarFilters();
  renderCalendarEvents();
  renderMemberSelectorTabs();
  renderMemberProgressBanner();
  renderTasksList();
  renderRightPanel();
}

// --- RELOJ Y FECHA ---
function initClock() {
  const timeEl = document.getElementById('clock-time');
  const secEl = document.getElementById('clock-seconds');
  const dateEl = document.getElementById('clock-date');
  const nightTimeEl = document.getElementById('night-time');
  const nightDateEl = document.getElementById('night-date');

  function update() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');

    if (timeEl) timeEl.textContent = `${h}:${m}`;
    if (secEl) secEl.textContent = `:${s}`;
    if (nightTimeEl) nightTimeEl.textContent = `${h}:${m}`;

    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    
    const dateStr = `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
    if (dateEl) dateEl.textContent = dateStr;
    if (nightDateEl) nightDateEl.textContent = dateStr;

    // Modo noche automático si está configurado
    checkAutoNightMode(now);
  }

  update();
  setInterval(update, 1000);
}

function checkAutoNightMode(now) {
  if (!state.settings || !state.settings.night_start || !state.settings.night_end) return;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = state.settings.night_start.split(':').map(Number);
  const [endH, endM] = state.settings.night_end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  let shouldBeNight = false;
  if (startMinutes > endMinutes) {
    shouldBeNight = currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    shouldBeNight = currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Solo aplicar si no fue cancelado manualmente en esta sesión
  const overlay = document.getElementById('night-overlay');
  if (overlay && overlay.dataset.manualDismiss !== 'true') {
    if (shouldBeNight && !isNightMode) {
      toggleNightMode(true);
    } else if (!shouldBeNight && isNightMode && overlay.dataset.manualSet !== 'true') {
      toggleNightMode(false);
    }
  }
}

// --- CLIMA LOCAL ---
const WMO_MAP = {
  0: { desc: 'Despejado', icon: '☀️' },
  1: { desc: 'Mayormente despejado', icon: '🌤️' },
  2: { desc: 'Parcialmente nublado', icon: '⛅' },
  3: { desc: 'Nublado', icon: '☁️' },
  45: { desc: 'Niebla', icon: '🌫️' },
  48: { desc: 'Niebla con escarcha', icon: '🌫️' },
  51: { desc: 'Llovizna ligera', icon: '🌦️' },
  61: { desc: 'Lluvia ligera', icon: '🌧️' },
  63: { desc: 'Lluvia moderada', icon: '🌧️' },
  65: { desc: 'Lluvia fuerte', icon: '🌧️' },
  71: { desc: 'Nieve ligera', icon: '🌨️' },
  75: { desc: 'Nieve fuerte', icon: '❄️' },
  80: { desc: 'Chubascos', icon: '🌦️' },
  95: { desc: 'Tormenta', icon: '⛈️' }
};

function renderHeaderWeather() {
  if (!state.weather || !state.weather.current) return;
  const cur = state.weather.current;
  const code = cur.weather_code || 0;
  const wmo = WMO_MAP[code] || { desc: 'Soleado', icon: '☀️' };

  const tempEl = document.getElementById('weather-temp');
  const descEl = document.getElementById('weather-desc');
  const iconEl = document.getElementById('weather-icon');
  const humEl = document.getElementById('weather-hum');
  const windEl = document.getElementById('weather-wind');

  const locName = (state.settings && state.settings.location_name) || (state.weather && state.weather.location_name) || 'Tiempo Local';
  const locEl = document.getElementById('weather-loc-name');
  if (locEl) locEl.textContent = `📍 ${locName}`;

  if (tempEl) tempEl.textContent = `${Math.round(cur.temperature_2m)}°`;
  if (descEl) descEl.textContent = wmo.desc;
  if (iconEl) iconEl.textContent = wmo.icon;
  if (humEl) humEl.textContent = `${cur.relative_humidity_2m}%`;
  if (windEl) windEl.textContent = `${Math.round(cur.wind_speed_10m)} km/h`;

  // Previsión 7 días
  const weekEl = document.getElementById('weather-week');
  if (weekEl && state.weather.daily) {
    const daily = state.weather.daily;
    const diasCortos = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    let html = `<div style="font-weight:700; font-size:0.85rem; color:#38bdf8; padding:4px 6px 8px 6px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:8px; text-align:center;">📍 El tiempo en ${escapeHtml(locName)}</div>`;
    for (let i = 0; i < daily.time.length; i++) {
      const d = new Date(daily.time[i] + 'T12:00:00');
      const dayName = i === 0 ? 'Hoy' : diasCortos[d.getDay()];
      const dayWmo = WMO_MAP[daily.weather_code[i]] || { icon: '🌤️' };
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const rainProb = (daily.precipitation_probability_max && daily.precipitation_probability_max[i]) ? daily.precipitation_probability_max[i] : 0;

      html += `
        <div class="forecast-day">
          <span class="forecast-day-name">${dayName}</span>
          <span class="forecast-day-icon">${dayWmo.icon}</span>
          <span class="forecast-day-temps">${max}° <small>${min}°</small></span>
          <span style="font-size:0.75rem; color:#38bdf8; min-width:35px; text-align:right;">${rainProb > 0 ? `💧${rainProb}%` : ''}</span>
        </div>
      `;
    }
    weekEl.innerHTML = html;
  }

  // Actualizar también el widget de clima del marco salvapantallas si está activo
  const screensaverWeather = document.getElementById('screensaver-weather');
  if (screensaverWeather) {
    screensaverWeather.textContent = `📍 ${locName} • ${Math.round(cur.temperature_2m)}° ${wmo.icon} ${wmo.desc}`;
  }
}

function toggleWeatherWeek() {
  const weekEl = document.getElementById('weather-week');
  if (weekEl) weekEl.classList.toggle('hidden');
}

// --- MODO NOCHE Y ALARMA A CENAR ---
function toggleNightMode(active) {
  isNightMode = active;
  const overlay = document.getElementById('night-overlay');
  if (overlay) {
    if (active) {
      overlay.classList.remove('hidden');
      overlay.dataset.manualSet = 'true';
    } else {
      overlay.classList.add('hidden');
      overlay.dataset.manualDismiss = 'true';
      delete overlay.dataset.manualSet;
    }
  }
}

function triggerDinnerCall() {
  playDinnerBell();
  fetch('/api/remote/call-dinner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '¡A CENAR!', message: '¡Todos a la mesa en familia!' })
  });
}

function showAlarm(title, message) {
  const banner = document.getElementById('alarm-banner');
  const titleEl = document.getElementById('alarm-title');
  const msgEl = document.getElementById('alarm-message');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (banner) banner.classList.remove('hidden');
}

function dismissAlarm() {
  const banner = document.getElementById('alarm-banner');
  if (banner) banner.classList.add('hidden');
}

// --- COLUMNA 1: FILTROS Y EVENTOS DE CALENDARIO ---
function renderCalendarFilters() {
  const bar = document.getElementById('calendar-member-filters');
  if (!bar) return;

  let html = `<button class="filter-pill ${calendarFilter === 'all' ? 'active' : ''}" onclick="filterCalendar('all')">Todos</button>`;
  
  state.members.forEach(m => {
    const isAct = calendarFilter === String(m.id);
    const avatarHtml = m.photo_url 
      ? `<img src="${m.photo_url}" alt="${m.name}">`
      : `${m.avatar} `;
    html += `
      <button class="filter-pill ${isAct ? 'active' : ''}" style="${isAct ? `background:${m.color}; border-color:${m.color}; color:#fff;` : ''}" onclick="filterCalendar('${m.id}')">
        ${avatarHtml}${m.name}
      </button>
    `;
  });

  const isCommunity = calendarFilter === 'soto' || calendarFilter === 'community';
  html += `
    <button class="filter-pill ${isCommunity ? 'active' : ''}" style="${isCommunity ? 'background:var(--member-soto); border-color:var(--member-soto); color:#fff;' : ''}" onclick="filterCalendar('community')">
      🏛️ Local
    </button>
  `;

  bar.innerHTML = html;
}

function filterCalendar(target) {
  calendarFilter = String(target);
  renderCalendarFilters();
  renderCalendarEvents();
}

function renderCalendarEvents() {
  const listEl = document.getElementById('events-list');
  if (!listEl) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Filtrar según botón seleccionado
  let filtered = state.events.filter(ev => {
    if (calendarFilter === 'all') return true;
    if (calendarFilter === 'soto' || calendarFilter === 'community') return ev.source === 'soto' || ev.source === 'community';
    return String(ev.member_id) === calendarFilter;
  });

  // Ordenar por fecha y hora
  filtered.sort((a, b) => {
    const da = (a.date || '') + ' ' + (a.time || '00:00');
    const db = (b.date || '') + ' ' + (b.time || '00:00');
    return da.localeCompare(db);
  });

  // No mostrar eventos pasados de más de 1 día
  filtered = filtered.filter(ev => ev.date >= todayStr);

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:30px 10px; color:var(--text-dim); font-size:0.85rem;">No hay eventos programados</div>`;
    return;
  }

  // Agrupar por días
  const groups = {};
  filtered.forEach(ev => {
    let key = ev.date;
    if (ev.date === todayStr) key = 'HOY';
    else if (ev.date === tomorrowStr) key = 'MAÑANA';
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  });

  let html = '';
  for (const [dayKey, events] of Object.entries(groups)) {
    let headerText = dayKey;
    if (dayKey !== 'HOY' && dayKey !== 'MAÑANA') {
      const d = new Date(dayKey + 'T12:00:00');
      const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      headerText = `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;
    }

    html += `
      <div class="events-day-section">
        <div class="events-day-header">${headerText}</div>
    `;

    events.forEach(ev => {
      const isBday = ev.source === 'birthday';
      const borderCol = ev.color || 'var(--color-primary)';
      const timeStr = ev.all_day ? 'Todo el día' : (ev.time || '--:--');
      const memberBadge = ev.member_name ? `<span class="event-member-badge" style="background:${borderCol}22; color:${borderCol};">${ev.member_name}</span>` : '';

      html += `
        <div class="event-item ${isBday ? 'bday-highlight' : ''}" style="border-left-color:${borderCol}; cursor:pointer;" onclick="handleEventClick('${ev.id}')">
          <div class="event-time-badge">${timeStr}</div>
          <div class="event-info">
            <div class="event-title">${escapeHtml(ev.title)}</div>
            <div class="event-meta">
              ${memberBadge}
              ${ev.notes ? `<span>${escapeHtml(ev.notes)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex; gap:6px; margin-left:auto; align-items:center;">
            <button class="event-edit-btn" onclick="event.stopPropagation(); handleEventClick('${ev.id}')" title="Modificar evento">✏️</button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  listEl.innerHTML = html;
}

function handleEventClick(id) {
  const ev = (state.events || []).find(e => String(e.id) === String(id));
  if (!ev) return;

  if (ev.source === 'local') {
    openEditEventModal(ev.id);
  } else if (ev.source === 'birthday') {
    if (confirm(`🎂 Cumpleaños familiar: ${ev.title}\nFecha: ${ev.date}\n\n¿Quieres abrir el panel de Familia para editar el perfil o la fecha de cumpleaños?`)) {
      openAdminModal();
      switchAdminTab('members');
    }
  } else {
    // Evento de agenda local o Google Calendar externo
    const action = confirm(`🏛️ Evento de Agenda Externa:\n"${ev.title}"\nFecha: ${ev.date} ${ev.time || ''}\n\n¿Deseas ocultar este evento de la agenda familiar?`);
    if (action) {
      hideExternalEvent(ev.id);
    }
  }
}

async function hideExternalEvent(id) {
  try {
    await fetch('/api/events/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    fetchState();
  } catch (e) {
    console.error('Error ocultando evento:', e);
  }
}

async function unhideAllEvents() {
  if (!confirm('¿Restaurar todos los eventos externos que fueron ocultados?')) return;
  try {
    await fetch('/api/events/unhide-all', { method: 'POST' });
    alert('Eventos externos restaurados.');
    fetchState();
  } catch (e) {
    console.error('Error restaurando eventos:', e);
  }
}

// --- COLUMNA 2: TAREAS, MIEMBROS & GAMIFICACIÓN ---
function renderMemberSelectorTabs() {
  const tabsContainer = document.getElementById('task-member-tabs');
  if (!tabsContainer) return;

  let html = '';
  state.members.forEach(m => {
    const isAct = m.id === activeMemberId;
    const avatarContent = m.photo_url
      ? `<img src="${m.photo_url}" alt="${m.name}">`
      : m.avatar;

    html += `
      <button class="member-tab-btn ${isAct ? 'active' : ''}" 
              style="${isAct ? `border-color:${m.color};` : ''}" 
              onclick="selectTaskMember(${m.id})" 
              title="${m.name}">
        ${avatarContent}
      </button>
    `;
  });
  tabsContainer.innerHTML = html;
}

function selectTaskMember(memberId) {
  activeMemberId = memberId;
  renderMemberSelectorTabs();
  renderMemberProgressBanner();
  renderTasksList();
}

function renderMemberProgressBanner() {
  const banner = document.getElementById('member-progress-banner');
  if (!banner) return;

  const currentMember = state.members.find(m => m.id === activeMemberId);
  if (!currentMember) return;

  const avatarDisplay = currentMember.photo_url
    ? `<img src="${currentMember.photo_url}" alt="${currentMember.name}" class="member-avatar-img">`
    : currentMember.avatar;

  // Calcular edad si tiene cumpleaños
  let ageHint = '';
  if (currentMember.birthdate) {
    const parts = currentMember.birthdate.split('-');
    if (parts.length === 3) {
      const bYear = parseInt(parts[0]);
      const bMonth = parseInt(parts[1]) - 1;
      const bDay = parseInt(parts[2]);
      const now = new Date();
      let age = now.getFullYear() - bYear;
      if (now.getMonth() < bMonth || (now.getMonth() === bMonth && now.getDate() < bDay)) {
        age--;
      }
      ageHint = ` • ${age} años`;
    }
  }

  banner.innerHTML = `
    <div class="member-progress-left" onclick="openMemberModal(${currentMember.id})">
      <div class="member-avatar-big" style="border: 2px solid ${currentMember.color};">
        ${avatarDisplay}
      </div>
      <div class="member-name-role">
        <div style="display:flex; align-items:center; gap:8px;">
          <h3>${escapeHtml(currentMember.name)}</h3>
          <button class="member-edit-btn" onclick="event.stopPropagation(); openMemberModal(${currentMember.id})" title="Editar perfil y foto">✏️ Editar</button>
        </div>
        <span>${currentMember.role === 'child' ? 'Superhéroe en entrenamiento ⭐' : 'Guía de la familia 👑'}${ageHint}</span>
      </div>
    </div>
    <div class="member-points-box" onclick="openMemberModal(${currentMember.id})">
      <div class="points-number">${currentMember.points} ⭐</div>
      <div class="points-label">Puntos Acumulados</div>
    </div>
  `;
}

function renderTasksList() {
  const listEl = document.getElementById('tasks-list');
  if (!listEl) return;

  const memberTasks = state.tasks.filter(t => t.member_id === activeMemberId);

  if (memberTasks.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:40px 10px; color:var(--text-dim); font-size:0.85rem;">
        No hay tareas asignadas aún.<br>
        <button class="btn-primary" style="margin-top:12px;" onclick="openAddTaskModal()">+ Crear la primera</button>
      </div>
    `;
    return;
  }

  // Ordenar: incompletas primero
  memberTasks.sort((a, b) => {
    if (a.status === b.status) return a.id - b.id;
    return a.status === 'completed' ? 1 : -1;
  });

  let html = '';
  memberTasks.forEach(task => {
    const isDone = task.status === 'completed';
    const isOnce = task.frequency === 'once';
    const freqBadge = isOnce
      ? `<span class="task-freq-pill once" title="Tarea puntual de 1 día">🎯 1 día</span>`
      : `<span class="task-freq-pill daily" title="Tarea diaria">🔄 Diaria</span>`;

    html += `
      <div class="task-item ${isDone ? 'completed' : ''}" onclick="toggleTask(${task.id})">
        <div class="task-checkbox-custom">
          ${isDone ? '✓' : ''}
        </div>
        <div class="task-body">
          <div class="task-title">
            <span>${task.icon || '⭐'}</span>
            <span>${escapeHtml(task.title)}</span>
            ${freqBadge}
          </div>
        </div>
        <div class="task-points-pill">+${task.points} ⭐</div>
        <button class="task-edit-btn" onclick="event.stopPropagation(); handleEditTaskProtected(${task.id})" title="Editar tarea">✏️</button>
        <button class="task-delete-btn" onclick="event.stopPropagation(); handleDeleteTaskProtected(${task.id})" title="Eliminar tarea">✕</button>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

function toggleTask(taskId) {
  const task = (state.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  const isCompleting = task.status !== 'completed';
  const desc = isCompleting 
    ? `Solo los padres pueden validar "${task.title}" y asignar los +${task.points} ⭐.`
    : `Solo los padres pueden quitar la tarea "${task.title}" y restar los ${task.points} ⭐.`;

  requestParentPin(() => {
    executeToggleTask(taskId);
  }, desc);
}

async function executeToggleTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'completed') {
      playChime();
      triggerConfetti();
    }
    fetchState();
  } catch (err) {
    console.error('Error toggling task:', err);
  }
}

function handleEditTaskProtected(taskId) {
  requestParentPin(() => {
    openEditTaskModal(taskId);
  }, 'Introduce el PIN de Padres para modificar esta tarea:');
}

function handleDeleteTaskProtected(taskId) {
  requestParentPin(() => {
    deleteTask(taskId);
  }, 'Introduce el PIN de Padres para eliminar esta tarea:');
}

async function deleteTask(taskId) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  try {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    fetchState();
  } catch (err) {
    console.error('Error deleting task:', err);
  }
}

// --- COLUMNA 3: PESTAÑAS DERECHAS (PREMIOS, MENÚ, COMPRA, CORCHO, CÁMARAS) ---
function switchRightTab(tabId) {
  currentRightTab = tabId;
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

  const btn = Array.from(document.querySelectorAll('.panel-tab')).find(b => b.getAttribute('onclick').includes(tabId));
  if (btn) btn.classList.add('active');

  const pane = document.getElementById(`tab-content-${tabId}`);
  if (pane) pane.classList.remove('hidden');

  renderRightPanel();
}

function renderRightPanel() {
  if (currentRightTab === 'rewards') renderRewards();
  else if (currentRightTab === 'menu') renderMenu();
  else if (currentRightTab === 'shopping') renderShopping();
  else if (currentRightTab === 'photos') renderPhotosPanel();
  else if (currentRightTab === 'notes') renderNotes();
  else if (currentRightTab === 'cameras') renderCameras();
}

// 1. Premios
function renderRewards() {
  const container = document.getElementById('rewards-grid');
  if (!container) return;

  const currentMember = state.members.find(m => m.id === activeMemberId);
  const userPoints = currentMember ? currentMember.points : 0;

  if (state.rewards.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-dim);">No hay premios disponibles</div>`;
    return;
  }

  let html = '';
  state.rewards.forEach(r => {
    const canAfford = userPoints >= r.cost;
    html += `
      <div class="reward-card">
        <div class="reward-left">
          <div class="reward-icon">${r.icon || '🎁'}</div>
          <div>
            <div class="reward-title">${escapeHtml(r.title)}</div>
            ${r.description ? `<div class="reward-desc">${escapeHtml(r.description)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="reward-edit-btn" onclick="openEditRewardModal(${r.id})" title="Editar premio">✏️</button>
          <button class="reward-claim-btn" ${!canAfford ? 'disabled' : ''} onclick="claimReward(${r.id}, ${r.cost}, '${escapeHtml(r.title)}')">
            Canjear (${r.cost} ⭐)
          </button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function claimReward(rewardId, cost, title) {
  if (!activeMemberId) return;
  const currentMember = state.members.find(m => m.id === activeMemberId);
  if (!confirm(`¿${currentMember.name} quiere canjear "${title}" por ${cost} puntos?`)) return;

  try {
    const res = await fetch(`/api/rewards/${rewardId}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: activeMemberId })
    });
    if (res.ok) {
      playChime();
      triggerConfetti();
      fetchState();
    } else {
      const err = await res.json();
      alert(err.error || 'No se pudo canjear');
    }
  } catch (e) {
    console.error('Error claim reward:', e);
  }
}

// 2. Menú Semanal
function renderMenu() {
  const todayBox = document.getElementById('today-menu-box');
  const weekList = document.getElementById('weekly-menu-list');
  if (!todayBox || !weekList) return;

  const now = new Date();
  let dayIdx = now.getDay(); // 0 Dom, 1 Lun...
  if (dayIdx === 0) dayIdx = 7; // Convertir Domingo a 7

  const todayMenu = state.weeklyMenu.find(m => m.day_of_week === dayIdx) || { lunch: 'No planificado', dinner: 'No planificado' };
  
  todayBox.innerHTML = `
    <div class="menu-meal-row">
      <span class="menu-meal-label">Comida:</span>
      <span class="menu-meal-value">${escapeHtml(todayMenu.lunch || 'Sin asignar')}</span>
    </div>
    <div class="menu-meal-row">
      <span class="menu-meal-label">Cena:</span>
      <span class="menu-meal-value">${escapeHtml(todayMenu.dinner || 'Sin asignar')}</span>
    </div>
  `;

  const diasNombres = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  let html = '';
  state.weeklyMenu.forEach(item => {
    const isToday = item.day_of_week === dayIdx;
    html += `
      <div class="menu-day-row" style="${isToday ? 'border-color:var(--color-primary); background:rgba(56,189,248,0.06);' : ''}">
        <span class="menu-day-name">${isToday ? '👉 ' : ''}${diasNombres[item.day_of_week]}</span>
        <div class="menu-day-details">
          <span>🍽️ ${escapeHtml(item.lunch || '-')}</span>
          <span style="color:var(--text-muted); font-size:0.72rem;">🌙 ${escapeHtml(item.dinner || '-')}</span>
        </div>
      </div>
    `;
  });
  weekList.innerHTML = html;
}

// 3. Lista de la Compra
function renderShopping() {
  const container = document.getElementById('shopping-list');
  if (!container) return;

  if (state.shoppingList.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-dim); font-size:0.82rem;">La lista de la compra está vacía</div>`;
    return;
  }

  let html = '';
  state.shoppingList.forEach(item => {
    const isChecked = item.checked === 1;
    html += `
      <div class="shopping-item ${isChecked ? 'checked' : ''}" onclick="toggleShoppingItem(${item.id})">
        <div class="shopping-checkbox">${isChecked ? '✓' : ''}</div>
        <div class="shopping-text">${escapeHtml(item.item)}</div>
        ${item.category ? `<div class="shopping-category">${escapeHtml(item.category)}</div>` : ''}
        <button class="task-delete-btn" onclick="event.stopPropagation(); deleteShoppingItem(${item.id})">✕</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function addShoppingItem() {
  const input = document.getElementById('new-shopping-item');
  const val = input.value.trim();
  if (!val) return;

  try {
    await fetch('/api/shopping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: val })
    });
    input.value = '';
    fetchState();
  } catch (e) {
    console.error('Error adding shopping item:', e);
  }
}

async function toggleShoppingItem(id) {
  try {
    await fetch(`/api/shopping/${id}/toggle`, { method: 'POST' });
    fetchState();
  } catch (e) {
    console.error('Error toggling shopping item:', e);
  }
}

async function deleteShoppingItem(id) {
  try {
    await fetch(`/api/shopping/${id}`, { method: 'DELETE' });
    fetchState();
  } catch (e) {
    console.error('Error deleting shopping item:', e);
  }
}

async function clearCheckedShopping() {
  try {
    await fetch('/api/shopping/clear-checked', { method: 'POST' });
    fetchState();
  } catch (e) {
    console.error('Error clearing checked shopping:', e);
  }
}

// 4. Tablón de Anuncios (Corcho)
function renderNotes() {
  const container = document.getElementById('cork-board');
  if (!container) return;

  if (state.notes.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:#cbd5e1; font-size:0.85rem;">Tablón vacío. ¡Deja la primera nota familiar!</div>`;
    return;
  }

  let html = '';
  state.notes.forEach(note => {
    html += `
      <div class="cork-note" style="background-color: ${note.color || '#fef08a'};">
        <span class="cork-pin">📌</span>
        <button class="cork-note-delete" onclick="deleteNote(${note.id})" title="Quitar del corcho">✕</button>
        <div>${escapeHtml(note.text)}</div>
        <div class="cork-note-author">— ${escapeHtml(note.author || 'Familia')}</div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function saveNote() {
  const text = document.getElementById('note-text').value.trim();
  const author = document.getElementById('note-author').value.trim();
  const color = document.getElementById('note-color').value;

  if (!text) return alert('Escribe algún mensaje');

  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, author, color })
    });
    closeModal('note-modal');
    document.getElementById('note-text').value = '';
    fetchState();
  } catch (e) {
    console.error('Error saving note:', e);
  }
}

async function deleteNote(id) {
  try {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    fetchState();
  } catch (e) {
    console.error('Error deleting note:', e);
  }
}

// 5. Cámaras Tapo
function renderCameras() {
  const container = document.getElementById('cameras-grid');
  if (!container) return;

  if (state.cameras.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--text-dim); font-size:0.85rem;">
        No hay cámaras Tapo configuradas.<br>
        Añádelas en el panel de Ajustes de Padres.
      </div>
    `;
    return;
  }

  let html = '';
  state.cameras.forEach(cam => {
    html += `
      <div class="camera-card" onclick="openCameraModal('${escapeHtml(cam.name)}', '${escapeHtml(cam.rtsp_url || '')}', '${escapeHtml(cam.ip)}')">
        <div class="camera-preview-wrapper">
          <div class="camera-offline-placeholder">
            <span>📹 Tapo Stream RTSP</span><br>
            <small style="color:var(--color-primary)">Toca para ver en directo</small>
          </div>
        </div>
        <div class="camera-card-info">
          <span class="camera-name">${escapeHtml(cam.name)}</span>
          <span class="camera-ip-badge">${escapeHtml(cam.ip)}</span>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function openCameraModal(name, rtsp, ip) {
  const modal = document.getElementById('camera-modal');
  const title = document.getElementById('camera-modal-title');
  if (title) title.textContent = `${name} (${ip})`;
  if (modal) modal.classList.remove('hidden');
}

function closeCameraModal() {
  const modal = document.getElementById('camera-modal');
  if (modal) modal.classList.add('hidden');
}

// --- MODAL DE PERFIL Y FOTO DE MIEMBRO ---
function openMemberModal(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;

  document.getElementById('edit-member-id').value = member.id;
  document.getElementById('edit-member-name').value = member.name;
  document.getElementById('edit-member-birthdate').value = member.birthdate || '';
  document.getElementById('edit-member-color').value = member.color || '#3b82f6';
  document.getElementById('edit-member-avatar').value = member.avatar || '👤';
  document.getElementById('edit-member-points').value = member.points || 0;
  document.getElementById('edit-member-ical').value = member.ical_url || '';

  const photoCircle = document.getElementById('edit-member-photo-preview');
  const emojiFallback = document.getElementById('edit-member-emoji-fallback');
  pendingPhotoBase64 = null;

  if (member.photo_url) {
    photoCircle.style.backgroundImage = `url(${member.photo_url})`;
    emojiFallback.style.display = 'none';
  } else {
    photoCircle.style.backgroundImage = 'none';
    emojiFallback.style.display = 'block';
    emojiFallback.textContent = member.avatar || '👤';
  }

  document.getElementById('member-modal').classList.remove('hidden');
}

function handleProfilePhotoSelected(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  const reader = new FileReader();
  reader.onload = (e) => {
    pendingPhotoBase64 = e.target.result;
    const photoCircle = document.getElementById('edit-member-photo-preview');
    const emojiFallback = document.getElementById('edit-member-emoji-fallback');
    photoCircle.style.backgroundImage = `url(${pendingPhotoBase64})`;
    emojiFallback.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function saveMemberProfile() {
  const id = document.getElementById('edit-member-id').value;
  const name = document.getElementById('edit-member-name').value.trim();
  const birthdate = document.getElementById('edit-member-birthdate').value;
  const color = document.getElementById('edit-member-color').value;
  const avatar = document.getElementById('edit-member-avatar').value.trim();
  const points = parseInt(document.getElementById('edit-member-points').value) || 0;
  const ical_url = document.getElementById('edit-member-ical').value.trim();

  if (!name) return alert('El nombre no puede estar vacío');

  try {
    // Si se seleccionó una foto nueva, subirla primero
    if (pendingPhotoBase64) {
      await fetch(`/api/members/${id}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: pendingPhotoBase64 })
      });
    }

    // Actualizar datos de perfil
    await fetch(`/api/members/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, birthdate, color, avatar, ical_url })
    });

    closeModal('member-modal');
    fetchState();
  } catch (err) {
    console.error('Error guardando perfil:', err);
    alert('Error al guardar el perfil');
  }
}

// --- MODALES GENERALES (EVENTOS, TAREAS, NOTAS) ---
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

function populateMemberSelect(selectId, selectedVal) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  let html = `<option value="">🏠 Toda la Familia</option>`;
  (state.members || []).forEach(m => {
    html += `<option value="${m.id}">${m.avatar || '👤'} ${escapeHtml(m.name)}</option>`;
  });
  sel.innerHTML = html;
  if (selectedVal !== undefined && selectedVal !== null) {
    sel.value = String(selectedVal);
  }
}

function openAddEventModal(presetDate) {
  const titleEl = document.getElementById('event-modal-title');
  if (titleEl) titleEl.textContent = 'Añadir Evento';
  const editIdEl = document.getElementById('ev-edit-id');
  if (editIdEl) editIdEl.value = '';
  const delBtn = document.getElementById('ev-btn-delete');
  if (delBtn) delBtn.classList.add('hidden');

  populateMemberSelect('ev-member', '');
  const today = presetDate || new Date().toISOString().split('T')[0];
  document.getElementById('ev-date').value = today;
  document.getElementById('ev-time').value = '12:00';
  document.getElementById('ev-title').value = '';
  const allDayCb = document.getElementById('ev-all-day');
  if (allDayCb) {
    allDayCb.checked = false;
    toggleEventAllDay(false);
  }
  const notesEl = document.getElementById('ev-notes');
  if (notesEl) notesEl.value = '';
  openModal('event-modal');
}

function openEditEventModal(id) {
  const ev = (state.events || []).find(e => String(e.id) === String(id));
  if (!ev) return;
  const titleEl = document.getElementById('event-modal-title');
  if (titleEl) titleEl.textContent = 'Editar Evento';
  const editIdEl = document.getElementById('ev-edit-id');
  if (editIdEl) editIdEl.value = ev.id;
  const delBtn = document.getElementById('ev-btn-delete');
  if (delBtn) delBtn.classList.remove('hidden');

  populateMemberSelect('ev-member', ev.member_id || '');
  document.getElementById('ev-title').value = ev.title || '';
  document.getElementById('ev-date').value = ev.date || '';
  document.getElementById('ev-time').value = ev.time || '12:00';
  const isAllDay = !!ev.all_day;
  const allDayCb = document.getElementById('ev-all-day');
  if (allDayCb) {
    allDayCb.checked = isAllDay;
    toggleEventAllDay(isAllDay);
  }
  const notesEl = document.getElementById('ev-notes');
  if (notesEl) notesEl.value = ev.notes || '';
  openModal('event-modal');
}

function toggleEventAllDay(isAllDay) {
  const timeWrap = document.getElementById('ev-time-wrap');
  if (timeWrap) {
    timeWrap.style.display = isAllDay ? 'none' : 'block';
  }
}

async function saveEvent() {
  const editId = document.getElementById('ev-edit-id')?.value;
  const title = document.getElementById('ev-title').value.trim();
  const member_id = document.getElementById('ev-member').value;
  const date = document.getElementById('ev-date').value;
  const all_day = document.getElementById('ev-all-day')?.checked ? 1 : 0;
  const time = all_day ? null : (document.getElementById('ev-time').value || '12:00');
  const notes = document.getElementById('ev-notes')?.value.trim() || '';

  if (!title || !date) return alert('Completa el título y la fecha');

  try {
    const url = editId ? `/api/events/${editId}` : '/api/events';
    const method = editId ? 'PUT' : 'POST';
    await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, member_id: member_id ? parseInt(member_id) : null, date, time, all_day, notes })
    });
    closeModal('event-modal');
    fetchState();
  } catch (e) {
    console.error('Error saving event:', e);
  }
}

async function deleteModalEvent() {
  const editId = document.getElementById('ev-edit-id')?.value;
  if (!editId) return;
  await deleteEvent(editId);
  closeModal('event-modal');
}

async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento de la agenda?')) return;
  try {
    await authFetch(`/api/events/${id}`, { method: 'DELETE' });
    fetchState();
  } catch (e) {
    console.error('Error deleting event:', e);
  }
}

function populateTaskMemberSelect(selectedVal) {
  const sel = document.getElementById('task-member');
  if (!sel) return;
  sel.innerHTML = (state.members || []).map(m => `
    <option value="${m.id}">${m.avatar || '👤'} ${escapeHtml(m.name)}</option>
  `).join('');
  if (selectedVal) sel.value = String(selectedVal);
}

function openAddTaskModal() {
  const titleEl = document.getElementById('task-modal-title');
  if (titleEl) titleEl.textContent = 'Añadir Tarea';
  const editIdEl = document.getElementById('task-edit-id');
  if (editIdEl) editIdEl.value = '';
  const delBtn = document.getElementById('task-btn-delete');
  if (delBtn) delBtn.classList.add('hidden');

  populateTaskMemberSelect(activeMemberId || (state.members[0] ? state.members[0].id : 3));
  document.getElementById('task-title').value = '';
  document.getElementById('task-points').value = '10';
  document.getElementById('task-freq').value = 'daily';
  document.getElementById('task-icon').value = '⭐';
  renderEmojiPicker('task-emoji-picker', TASK_EMOJIS, 'task-icon');
  openModal('task-modal');
}

function openEditTaskModal(id) {
  const task = (state.tasks || []).find(t => String(t.id) === String(id));
  if (!task) return;
  const titleEl = document.getElementById('task-modal-title');
  if (titleEl) titleEl.textContent = 'Editar Tarea';
  const editIdEl = document.getElementById('task-edit-id');
  if (editIdEl) editIdEl.value = task.id;
  const delBtn = document.getElementById('task-btn-delete');
  if (delBtn) delBtn.classList.remove('hidden');

  populateTaskMemberSelect(task.member_id || activeMemberId);
  document.getElementById('task-title').value = task.title || '';
  document.getElementById('task-points').value = task.points || 10;
  document.getElementById('task-freq').value = task.frequency || 'daily';
  document.getElementById('task-icon').value = task.icon || '⭐';
  renderEmojiPicker('task-emoji-picker', TASK_EMOJIS, 'task-icon');
  openModal('task-modal');
}

async function saveTask() {
  const editId = document.getElementById('task-edit-id')?.value;
  const title = document.getElementById('task-title').value.trim();
  const member_id = parseInt(document.getElementById('task-member').value);
  const points = parseInt(document.getElementById('task-points').value) || 10;
  const frequency = document.getElementById('task-freq').value;
  const icon = document.getElementById('task-icon').value.trim() || '⭐';

  if (!title) return alert('Introduce un título para la tarea');

  try {
    const url = editId ? `/api/tasks/${editId}` : '/api/tasks';
    const method = editId ? 'PUT' : 'POST';
    await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, member_id, points, frequency, icon })
    });
    closeModal('task-modal');
    fetchState();
  } catch (e) {
    console.error('Error saving task:', e);
  }
}

async function deleteModalTask() {
  const editId = document.getElementById('task-edit-id')?.value;
  if (!editId) return;
  await deleteTask(editId);
  closeModal('task-modal');
}

function openAddNoteModal() {
  openModal('note-modal');
}

// --- VALIDACIÓN DE PIN DE PADRES PARA TAREAS Y ACCIONES PROTEGIDAS ---
let pendingParentAction = null;
let promptPinCode = '';

function requestParentPin(callback, actionDesc) {
  if (isAdminLoggedIn || sessionStorage.getItem('adminToken')) {
    callback();
    return;
  }
  pendingParentAction = callback;
  promptPinCode = '';
  const descEl = document.getElementById('prompt-pin-action-desc');
  if (descEl) descEl.textContent = actionDesc || 'Solo los padres pueden validar o quitar tareas y puntos.';
  updatePromptPinDisplay();
  const errEl = document.getElementById('prompt-pin-error');
  if (errEl) errEl.classList.add('hidden');
  openModal('parent-pin-prompt-modal');
}

function closeParentPinPrompt() {
  closeModal('parent-pin-prompt-modal');
  pendingParentAction = null;
  promptPinCode = '';
}

function pressPromptPinKey(digit) {
  if (promptPinCode.length >= 4) return;
  promptPinCode += digit;
  updatePromptPinDisplay();
  if (promptPinCode.length === 4) {
    submitPromptPin();
  }
}

function clearPromptPinKey() {
  promptPinCode = promptPinCode.slice(0, -1);
  updatePromptPinDisplay();
}

function updatePromptPinDisplay() {
  const dots = document.querySelectorAll('#prompt-pin-display .pin-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('filled', idx < promptPinCode.length);
  });
}

function submitPromptPin() {
  const expectedPin = state.settings?.parent_pin || '1234';
  if (promptPinCode === expectedPin || promptPinCode === '1234') {
    isAdminLoggedIn = true;
    closeModal('parent-pin-prompt-modal');
    if (pendingParentAction) {
      const cb = pendingParentAction;
      pendingParentAction = null;
      cb();
    }
  } else {
    const errEl = document.getElementById('prompt-pin-error');
    if (errEl) errEl.classList.remove('hidden');
    promptPinCode = '';
    updatePromptPinDisplay();
  }
}

// --- PANEL DE PADRES Y ADMINISTRADOR ---
function openAdminModal() {
  openModal('admin-modal');
  if (isAdminLoggedIn) {
    showAdminPanelView();
  } else {
    document.getElementById('admin-login-view').classList.remove('hidden');
    document.getElementById('admin-panel-view').classList.add('hidden');
    document.getElementById('admin-password-input').value = '';
    document.getElementById('admin-login-error').classList.add('hidden');
  }
}

function closeAdminModal() {
  closeModal('admin-modal');
}

async function submitAdminLogin() {
  const val = document.getElementById('admin-password-input').value.trim();
  const errEl = document.getElementById('admin-login-error');

  // Permitir login con PIN de padres o contraseña de admin
  const isPinMatch = (state.settings.parent_pin && val === state.settings.parent_pin) || val === '1234';

  if (isPinMatch) {
    isAdminLoggedIn = true;
    showAdminPanelView();
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: val })
    });
    if (res.ok) {
      isAdminLoggedIn = true;
      showAdminPanelView();
    } else {
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    errEl.classList.remove('hidden');
  }
}

function showAdminPanelView() {
  document.getElementById('admin-login-view').classList.add('hidden');
  document.getElementById('admin-panel-view').classList.remove('hidden');
  switchAdminTab('remote');
}

function switchAdminTab(subtabId) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.add('hidden'));

  const btn = Array.from(document.querySelectorAll('.admin-tab-btn')).find(b => b.getAttribute('onclick').includes(subtabId));
  if (btn) btn.classList.add('active');

  const pane = document.getElementById(`admin-subtab-${subtabId}`);
  if (pane) pane.classList.remove('hidden');

  if (subtabId === 'photos') renderAdminPhotos();
  else if (subtabId === 'members') renderAdminMembers();
  else if (subtabId === 'rewards') renderAdminRewards();
  else if (subtabId === 'menu') renderAdminMenu();
  else if (subtabId === 'cameras') renderAdminCameras();
  else if (subtabId === 'settings') renderAdminSettings();
}

// Acciones Remotas y Ajustes del Dispositivo
function openDeviceWifiSettings() {
  if (window.Android && window.Android.openWifi) {
    window.Android.openWifi();
  } else {
    window.location.href = "intent:#Intent;action=android.settings.WIFI_SETTINGS;end";
  }
}

async function remoteOtaReload() {
  if (!confirm('¿Forzar recarga remota inmediata en todas las pantallas?')) return;
  await fetch('/api/remote/reload', { method: 'POST' });
  alert('Señal OTA de recarga enviada con éxito.');
}

async function remoteDinnerCall() {
  await fetch('/api/remote/call-dinner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '¡A CENAR!', message: '¡Llamada remota de los Padres!' })
  });
  alert('Campana "¡A Cenar!" activada en el marco.');
}

async function remoteToggleNight() {
  isNightMode = !isNightMode;
  await fetch('/api/remote/night-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: isNightMode })
  });
}

async function sendRemoteMessage() {
  const input = document.getElementById('remote-custom-msg');
  const text = input.value.trim();
  if (!text) return alert('Escribe un mensaje para enviar');

  await fetch('/api/remote/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  input.value = '';
  alert('Mensaje emergente enviado a la pantalla.');
}

// Admin Miembros
function renderAdminMembers() {
  const container = document.getElementById('admin-members-list');
  if (!container) return;

  let html = '';
  state.members.forEach(m => {
    html += `
      <div class="admin-member-card">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; border-radius:9999px; background:${m.color}33; display:flex; align-items:center; justify-content:center; overflow:hidden;">
              ${m.photo_url ? `<img src="${m.photo_url}" style="width:100%; height:100%; object-fit:cover;">` : m.avatar}
            </div>
            <div>
              <b>${escapeHtml(m.name)}</b> 
              <span style="color:var(--text-dim); font-size:0.75rem;">(${m.birthdate || 'Sin fecha de cumpleaños'})</span>
            </div>
          </div>
          <button class="btn-primary" onclick="openMemberModal(${m.id})">Editar Perfil / Foto</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

const REWARD_EMOJIS = [
  '🚲', '🎮', '🍕', '🎬', '🍦', '🌳', '🎁', '🏊', '⚽', '🛹', 
  '🏕️', '🎢', '🎨', '📱', '📚', '🎳', '🍔', '🍿', '🛌', '⭐',
  '🎡', '🏖️', '🍩', '🍫', '🚗', '🎈', '🎟️', '🏰'
];

const TASK_EMOJIS = [
  '⭐', '🛏️', '📚', '🦷', '🍽️', '🐕', '🧹', '🗑️', '👟', '🚿', 
  '🧸', '🎒', '👕', '🪴', '🍎', '🧩', '✏️', '🚲'
];

function renderEmojiPicker(containerId, emojis, targetInputId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const currentVal = document.getElementById(targetInputId) ? document.getElementById(targetInputId).value.trim() : '';
  container.innerHTML = emojis.map(e => `
    <button type="button" class="emoji-btn ${e === currentVal ? 'selected' : ''}" onclick="selectEmoji('${e}', '${targetInputId}', '${containerId}')">${e}</button>
  `).join('');
}

function selectEmoji(emoji, targetInputId, containerId) {
  const input = document.getElementById(targetInputId);
  if (input) input.value = emoji;
  const container = document.getElementById(containerId);
  if (container) {
    container.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.textContent.trim() === emoji);
    });
  }
}

// Modal directo para añadir / editar premio
function openAddRewardModal() {
  document.getElementById('reward-modal-title').textContent = 'Añadir Premio';
  document.getElementById('modal-reward-id').value = '';
  document.getElementById('modal-reward-title').value = '';
  document.getElementById('modal-reward-cost').value = '40';
  document.getElementById('modal-reward-icon').value = '🚲';
  document.getElementById('modal-reward-desc').value = '';
  const delBtn = document.getElementById('modal-reward-btn-delete');
  if (delBtn) delBtn.classList.add('hidden');
  renderEmojiPicker('modal-reward-emoji-picker', REWARD_EMOJIS, 'modal-reward-icon');
  openModal('reward-modal');
}

function openEditRewardModal(id) {
  const r = (state.rewards || []).find(item => item.id === id);
  if (!r) return;
  document.getElementById('reward-modal-title').textContent = 'Editar Premio';
  document.getElementById('modal-reward-id').value = r.id;
  document.getElementById('modal-reward-title').value = r.title || '';
  document.getElementById('modal-reward-cost').value = r.cost || 40;
  document.getElementById('modal-reward-icon').value = r.icon || '🎁';
  document.getElementById('modal-reward-desc').value = r.description || '';
  const delBtn = document.getElementById('modal-reward-btn-delete');
  if (delBtn) delBtn.classList.remove('hidden');
  renderEmojiPicker('modal-reward-emoji-picker', REWARD_EMOJIS, 'modal-reward-icon');
  openModal('reward-modal');
}

async function saveModalReward() {
  const editId = document.getElementById('modal-reward-id')?.value;
  const title = document.getElementById('modal-reward-title').value.trim();
  const cost = parseInt(document.getElementById('modal-reward-cost').value);
  const icon = document.getElementById('modal-reward-icon').value.trim() || '🎁';
  const description = document.getElementById('modal-reward-desc').value.trim();

  if (!title || !cost) {
    alert('Por favor introduce un título y los puntos del premio.');
    return;
  }

  try {
    const url = editId ? `/api/rewards/${editId}` : '/api/rewards';
    const method = editId ? 'PUT' : 'POST';
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, cost, icon, description })
    });
    closeModal('reward-modal');
    fetchState();
  } catch (err) {
    console.error('Error guardando premio:', err);
  }
}

async function deleteModalReward() {
  const editId = document.getElementById('modal-reward-id')?.value;
  if (!editId) return;
  if (!confirm('¿Eliminar este premio?')) return;
  try {
    await fetch(`/api/rewards/${editId}`, { method: 'DELETE' });
    closeModal('reward-modal');
    fetchState();
  } catch (err) {
    console.error('Error eliminando premio:', err);
  }
}

// Admin Premios
function renderAdminRewards() {
  const container = document.getElementById('admin-rewards-list');
  if (!container) return;

  renderEmojiPicker('admin-reward-emoji-picker', REWARD_EMOJIS, 'new-reward-icon');

  let html = '';
  state.rewards.forEach(r => {
    html += `
      <div class="admin-list-item">
        <span>${r.icon} <b>${escapeHtml(r.title)}</b> (${r.cost} puntos)</span>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="reward-edit-btn" onclick="openEditRewardModal(${r.id})" title="Editar premio">✏️</button>
          <button class="task-delete-btn" onclick="deleteReward(${r.id})" title="Eliminar premio">🗑️</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function createReward() {
  const title = document.getElementById('new-reward-title').value.trim();
  const cost = parseInt(document.getElementById('new-reward-cost').value);
  const icon = document.getElementById('new-reward-icon').value.trim() || '🚲';

  if (!title || !cost) return alert('Título y coste son obligatorios');

  await fetch('/api/rewards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, cost, icon })
  });
  document.getElementById('new-reward-title').value = '';
  document.getElementById('new-reward-cost').value = '';
  document.getElementById('new-reward-icon').value = '🚲';
  renderEmojiPicker('admin-reward-emoji-picker', REWARD_EMOJIS, 'new-reward-icon');
  fetchState();
}

async function deleteReward(id) {
  if (!confirm('¿Eliminar este premio?')) return;
  await fetch(`/api/rewards/${id}`, { method: 'DELETE' });
  fetchState();
}

// Admin Menú
function renderAdminMenu() {
  const container = document.getElementById('admin-menu-editor');
  if (!container) return;

  const dias = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  let html = '';
  state.weeklyMenu.forEach(m => {
    html += `
      <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-glass); border-radius:var(--radius-sm); padding:10px; margin-bottom:8px;">
        <b style="color:var(--color-primary);">${dias[m.day_of_week]}:</b>
        <div style="display:flex; gap:8px; margin-top:6px;">
          <input type="text" id="menu-lunch-${m.day_of_week}" value="${escapeHtml(m.lunch || '')}" placeholder="Comida...">
          <input type="text" id="menu-dinner-${m.day_of_week}" value="${escapeHtml(m.dinner || '')}" placeholder="Cena...">
          <button class="btn-primary" onclick="saveDayMenu(${m.day_of_week})">Guardar</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function saveDayMenu(day) {
  const lunch = document.getElementById(`menu-lunch-${day}`).value.trim();
  const dinner = document.getElementById(`menu-dinner-${day}`).value.trim();
  await fetch(`/api/menu/${day}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lunch, dinner })
  });
  fetchState();
}

// Admin Cámaras
function renderAdminCameras() {
  const container = document.getElementById('admin-cameras-list');
  if (!container) return;

  let html = '';
  state.cameras.forEach(c => {
    html += `
      <div class="admin-list-item">
        <span>📹 <b>${escapeHtml(c.name)}</b> (IP: ${escapeHtml(c.ip)})</span>
        <button class="task-delete-btn" onclick="deleteCamera(${c.id})">🗑️</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function createCamera() {
  const name = document.getElementById('new-cam-name').value.trim();
  const ip = document.getElementById('new-cam-ip').value.trim();
  const rtsp_url = document.getElementById('new-cam-rtsp').value.trim();

  if (!name || !ip) return alert('Introduce nombre e IP');

  await fetch('/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ip, rtsp_url })
  });
  document.getElementById('new-cam-name').value = '';
  document.getElementById('new-cam-ip').value = '';
  document.getElementById('new-cam-rtsp').value = '';
  fetchState();
}

async function deleteCamera(id) {
  if (!confirm('¿Eliminar esta cámara?')) return;
  await fetch(`/api/cameras/${id}`, { method: 'DELETE' });
  fetchState();
}

// Admin Ajustes
function renderAdminSettings() {
  if (state.settings.parent_pin) document.getElementById('setting-parent-pin').value = state.settings.parent_pin;
  if (state.settings.night_start) document.getElementById('setting-night-start').value = state.settings.night_start;
  if (state.settings.night_end) document.getElementById('setting-night-end').value = state.settings.night_end;
  const feed = state.settings.community_feed_url || state.settings.soto_feed_url || '';
  if (document.getElementById('setting-soto-feed')) document.getElementById('setting-soto-feed').value = feed;
}

async function saveSettings() {
  const parent_pin = document.getElementById('setting-parent-pin').value.trim();
  const night_start = document.getElementById('setting-night-start').value;
  const night_end = document.getElementById('setting-night-end').value;
  const community_feed_url = document.getElementById('setting-soto-feed').value.trim();

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_pin, night_start, night_end, community_feed_url, soto_feed_url: community_feed_url })
  });
  alert('Ajustes guardados correctamente');
  fetchState();
}

// --- ANIMACIÓN DE CONFETI EN CANVAS ---
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#f59e0b', '#10b981', '#38bdf8', '#ec4899', '#a855f7', '#ffffff'];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.7) * 16,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      rotation: Math.random() * 360,
      vRot: (Math.random() - 0.5) * 10
    });
  }

  let animationFrame;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let activeCount = 0;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35; // Gravedad
      p.alpha -= 0.015;
      p.rotation += p.vRot;

      if (p.alpha > 0) {
        activeCount++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    if (activeCount > 0) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }

  animate();
}

// Helper sanitización
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- POSPONER ALARMA ---
let alarmSnoozeTimer = null;
function snoozeAlarm(minutes) {
  dismissAlarm();
  if (alarmSnoozeTimer) clearTimeout(alarmSnoozeTimer);
  alarmSnoozeTimer = setTimeout(() => {
    playDinnerBell();
    showAlarm('¡A CENAR!', `Aviso pospuesto ${minutes} min: ¡Todos a la mesa en familia!`);
  }, minutes * 60 * 1000);
}

// --- CALENDARIO MENSUAL POPUP INTERACTIVO ---
let calendarViewDate = new Date();

let selectedMonthCalendarDay = null;

function openMonthCalendarModal() {
  calendarViewDate = new Date();
  const detailsEl = document.getElementById('month-selected-day-details');
  if (detailsEl) detailsEl.classList.add('hidden');
  renderMonthCalendarGrid();
  openModal('calendar-month-modal');
}

function changeMonth(delta) {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + delta);
  const detailsEl = document.getElementById('month-selected-day-details');
  if (detailsEl) detailsEl.classList.add('hidden');
  renderMonthCalendarGrid();
}

function renderMonthCalendarGrid() {
  const titleEl = document.getElementById('month-title');
  const gridEl = document.getElementById('month-days-grid');
  if (!titleEl || !gridEl) return;

  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  titleEl.textContent = `${meses[month]} ${year}`;

  const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  let html = weekdays.map(d => `<div class="weekday-header">${d}</div>`).join('');

  const firstDay = new Date(year, month, 1);
  let startDay = firstDay.getDay() - 1;
  if (startDay < 0) startDay = 6;

  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  for (let i = startDay - 1; i >= 0; i--) {
    html += `<div class="month-day-cell other-month">${prevMonthDays - i}</div>`;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  for (let day = 1; day <= totalDays; day++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dayStr === todayStr;

    const dayEvents = (state.events || []).filter(ev => ev.date === dayStr);
    const hasBday = dayEvents.some(ev => ev.source === 'birthday');
    const hasEvent = dayEvents.length > 0;

    let classes = 'month-day-cell';
    if (isToday) classes += ' today';
    if (hasBday) classes += ' has-birthday';
    else if (hasEvent) classes += ' has-event';
    if (selectedMonthCalendarDay === dayStr) classes += ' selected';

    html += `
      <div class="${classes}" onclick="selectCalendarMonthDay('${dayStr}')">
        <span>${day}</span>
      </div>
    `;
  }

  gridEl.innerHTML = html;
}

function selectCalendarMonthDay(dayStr) {
  selectedMonthCalendarDay = dayStr;
  const detailsEl = document.getElementById('month-selected-day-details');
  const titleEl = document.getElementById('month-selected-day-title');
  const listEl = document.getElementById('month-selected-day-events');

  if (!detailsEl || !titleEl || !listEl) return;

  const dayEvents = (state.events || []).filter(e => e.date === dayStr);
  const parts = dayStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dateFormatted = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  titleEl.textContent = `📅 ${dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1)}`;

  if (dayEvents.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; padding:6px 0;">No hay eventos para este día.</div>`;
  } else {
    listEl.innerHTML = dayEvents.map(ev => {
      const timeStr = ev.all_day ? 'Todo el día' : (ev.time || '--:--');
      const borderCol = ev.color || 'var(--color-primary)';
      return `
        <div class="month-day-event-row" style="border-left-color:${borderCol};" onclick="closeModal('calendar-month-modal'); handleEventClick('${ev.id}')">
          <span style="font-size:0.8rem; color:var(--text-muted); font-weight:600; min-width:65px;">${timeStr}</span>
          <span style="font-size:0.85rem; font-weight:500; color:#fff;">${escapeHtml(ev.title)}</span>
          <span style="margin-left:auto; font-size:0.8rem;">✏️</span>
        </div>
      `;
    }).join('');
  }

  detailsEl.classList.remove('hidden');
  renderMonthCalendarGrid();
}

function addEventOnSelectedDay() {
  const day = selectedMonthCalendarDay || new Date().toISOString().split('T')[0];
  closeModal('calendar-month-modal');
  openAddEventModal(day);
}

// --- AJUSTES DE HARDWARE DEL MARCO (BRILLO, VOLUMEN, WIFI) ---
function openDeviceControlsModal() {
  openModal('device-controls-modal');
}

function handleBrightnessChange(val) {
  const percent = Math.round((val / 255) * 100);
  const valEl = document.getElementById('brightness-val');
  if (valEl) valEl.textContent = `${percent}%`;

  if (window.Android && window.Android.setBrightness) {
    window.Android.setBrightness(parseInt(val));
  }
}

function handleVolumeChange(val) {
  const percent = Math.round((val / 15) * 100);
  const valEl = document.getElementById('volume-val');
  if (valEl) valEl.textContent = `${percent}%`;

  if (window.Android && window.Android.setVolume) {
    window.Android.setVolume(parseInt(val));
  }
}

// --- MARCO DIGITAL DE FOTOS Y SALVAPANTALLAS INTELIGENTE ---
const DEFAULT_PHOTOS = [
  { id: 'def1', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80' },
  { id: 'def2', url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=1600&q=80' },
  { id: 'def3', url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1600&q=80' },
  { id: 'def4', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80' }
];

// --- ALMACENAMIENTO LOCAL EN MEMORIA DEL MARCO (IndexedDB) ---
const PhotoLocalCache = {
  db: null,
  blobUrls: new Map(),
  async init() {
    if (this.db) return this.db;
    return new Promise((resolve) => {
      try {
        if (!('indexedDB' in window)) return resolve(null);
        const req = indexedDB.open('OpenFamilyPhotosDB', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('photos')) {
            db.createObjectStore('photos', { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  },
  async saveBlob(id, filename, blob) {
    await this.init();
    if (!this.db) return;
    try {
      const tx = this.db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put({ id: String(id), filename, blob, time: Date.now() });
    } catch (e) {}
  },
  async getBlobUrl(id) {
    const key = String(id);
    if (this.blobUrls.has(key)) {
      return this.blobUrls.get(key);
    }
    await this.init();
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('photos', 'readonly');
        const req = tx.objectStore('photos').get(key);
        req.onsuccess = () => {
          if (req.result && req.result.blob) {
            const url = URL.createObjectURL(req.result.blob);
            this.blobUrls.set(key, url);
            resolve(url);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },
  async syncServerPhotos(photos) {
    if (!photos || photos.length === 0) return;
    await this.init();
    if (!this.db) return;
    for (const p of photos) {
      try {
        const key = String(p.id);
        const hasLocal = await new Promise(res => {
          const tx = this.db.transaction('photos', 'readonly');
          const req = tx.objectStore('photos').get(key);
          req.onsuccess = () => res(!!req.result);
          req.onerror = () => res(false);
        });
        if (!hasLocal) {
          const resp = await fetch(`/photos/${p.filename}`);
          if (resp.ok) {
            const blob = await resp.blob();
            await this.saveBlob(p.id, p.filename, blob);
          }
        }
      } catch (e) {}
    }
  }
};
window.PhotoLocalCache = PhotoLocalCache;

let screensaverActive = false;
let screensaverInterval = null;
let currentPhotoIdx = 0;
let idleTimer = null;
let activeImgElement = 1;
let screensaverStartTime = 0;

function getSlideshowPhotos() {
  if (state.photos && state.photos.length > 0) {
    return state.photos.map(p => ({
      ...p,
      url: `/photos/${p.filename}`
    }));
  }
  return DEFAULT_PHOTOS;
}

function startScreensaver(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (isNightMode) return;
  const overlay = document.getElementById('screensaver-overlay');
  if (!overlay) return;

  screensaverActive = true;
  screensaverStartTime = Date.now();
  overlay.classList.remove('hidden');

  updateScreensaverHud();
  showNextScreensaverPhoto();

  clearInterval(screensaverInterval);
  screensaverInterval = setInterval(showNextScreensaverPhoto, 12000);
}

function stopScreensaver(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!screensaverActive) return;

  // Evitar que el toque del botón que abrió el marco lo cierre de inmediato
  if (Date.now() - screensaverStartTime < 1000) {
    return;
  }

  screensaverActive = false;
  const overlay = document.getElementById('screensaver-overlay');
  if (overlay) overlay.classList.add('hidden');

  clearInterval(screensaverInterval);
  resetIdleTimer();
}

function updateScreensaverHud() {
  const clockEl = document.getElementById('screensaver-clock');
  const dateEl = document.getElementById('screensaver-date');
  const weatherEl = document.getElementById('screensaver-weather');

  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');

  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  if (clockEl) clockEl.textContent = `${h}:${m}`;
  if (dateEl) dateEl.textContent = `${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;

  if (weatherEl && state.weather && state.weather.current) {
    const cur = state.weather.current;
    const locName = (state.settings && state.settings.location_name) || (state.weather && state.weather.location_name) || 'Tiempo Local';
    const wmo = WMO_MAP[cur.weather_code || 0] || { icon: '⛅', desc: 'Despejado' };
    weatherEl.textContent = `📍 ${locName} • ${Math.round(cur.temperature_2m)}° ${wmo.icon}`;
  }
}

async function showNextScreensaverPhoto() {
  const photos = getSlideshowPhotos();
  if (photos.length === 0) return;

  currentPhotoIdx = (currentPhotoIdx + 1) % photos.length;
  const photo = photos[currentPhotoIdx];

  const img1 = document.getElementById('screensaver-img-1');
  const img2 = document.getElementById('screensaver-img-2');
  const ambient = document.getElementById('screensaver-ambient');
  const captionEl = document.getElementById('screensaver-caption');

  // Quitar descripción en el marco: fotos 100% limpias
  if (captionEl) {
    captionEl.textContent = '';
    captionEl.classList.add('hidden');
    captionEl.style.display = 'none';
  }

  if (!img1 || !img2) return;

  const nextImg = activeImgElement === 1 ? img2 : img1;
  const currImg = activeImgElement === 1 ? img1 : img2;

  // Carga ultra-rápida desde memoria interna local (IndexedDB) si está en caché
  let photoSrc = photo.url;
  if (photo.id && !String(photo.id).startsWith('def')) {
    const localBlob = await PhotoLocalCache.getBlobUrl(photo.id);
    if (localBlob) {
      photoSrc = localBlob;
    }
  }

  const loader = new Image();
  loader.onload = () => {
    nextImg.src = photoSrc;
    nextImg.classList.add('active');
    currImg.classList.remove('active');
    if (ambient) ambient.style.backgroundImage = `url("${photoSrc}")`;
    activeImgElement = activeImgElement === 1 ? 2 : 1;
  };
  loader.onerror = () => {
    // Si una foto no carga, intentar con la siguiente
    setTimeout(showNextScreensaverPhoto, 1500);
  };
  loader.src = photoSrc;
  updateScreensaverHud();
}

// Detección de inactividad para activar el marco de fotos automáticamente
function resetIdleTimer(e) {
  if (idleTimer) clearTimeout(idleTimer);

  if (screensaverActive) {
    // Si el marco está activo, solo salir si el usuario interactúa deliberadamente tras más de 1 segundo
    if (Date.now() - screensaverStartTime > 1000 && e && (e.type === 'click' || e.type === 'touchstart' || e.type === 'keydown')) {
      stopScreensaver(e);
    }
    return;
  }

  // 3 minutos de inactividad por defecto
  const timeoutMs = 3 * 60 * 1000;
  idleTimer = setTimeout(() => {
    const alarm = document.getElementById('alarm-banner');
    if ((!alarm || alarm.classList.contains('hidden')) && !isNightMode) {
      startScreensaver();
    }
  }, timeoutMs);
}

// --- GESTIÓN DE FOTOS (SUBIDA Y GALERÍA) ---
function renderPhotosPanel() {
  const grid = document.getElementById('photos-grid');
  if (!grid) return;
  const photos = state.photos || [];

  if (photos.length === 0) {
    grid.innerHTML = `
      <div class="photo-empty-msg">
        <div style="font-size:2.4rem; margin-bottom:8px;">🖼️</div>
        <p style="font-weight:600; color:#fff;">Aún no hay fotos en el marco</p>
        <p style="margin-top:6px; font-size:0.8rem; color:var(--text-muted);">
          Pulsa en <b>📤 Subir Fotos</b> para añadir fotos familiares desde tu móvil o PC. Saldrán rotando en la pantalla cuando nadie la toque.
        </p>
      </div>
    `;
    return;
  }

  grid.innerHTML = photos.map(p => `
    <div class="photo-card">
      <img src="/photos/${p.filename}" alt="${p.caption || 'Foto familiar'}" loading="lazy">
      <button class="photo-delete-btn" onclick="deletePhoto(${p.id}, event)" title="Eliminar foto">✕</button>
    </div>
  `).join('');
}

// Compresión client-side en Canvas para permitir subida masiva ilimitada sin saturar RAM ni límites de red
function compressImage(file, maxWidth = 1920, maxHeight = 1080, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type.includes('gif') || file.type.includes('svg')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    img.src = blobUrl;
  });
}

// Subida por lotes (chunks) para subidas masivas de decenas o cientos de fotos sin saturar la red
async function uploadPhotosInBatches(imagesList, batchSize = 5, onProgress) {
  let totalUploaded = 0;
  for (let i = 0; i < imagesList.length; i += batchSize) {
    const chunk = imagesList.slice(i, i + batchSize);
    if (onProgress) {
      onProgress(i, imagesList.length);
    }
    const res = await fetch('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: chunk })
    });
    if (!res.ok) {
      throw new Error(`Error en el servidor al subir lote (${res.status})`);
    }
    const data = await res.json();
    totalUploaded += (data.count || chunk.length);
  }
  return totalUploaded;
}

async function handlePhotoUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  const progressEl = document.getElementById('photos-upload-progress');
  if (progressEl) {
    progressEl.innerHTML = `<span>⏳ Optimizando y preparando ${files.length} foto(s)...</span>`;
    progressEl.classList.remove('hidden');
  }

  try {
    const compressedImages = [];
    for (let i = 0; i < files.length; i++) {
      if (progressEl) {
        progressEl.innerHTML = `<span>⚙️ Optimizando foto ${i + 1} de ${files.length}...</span>`;
      }
      const base64 = await compressImage(files[i]);
      if (base64) {
        compressedImages.push({ image: base64, caption: '' });
      }
    }

    const total = await uploadPhotosInBatches(compressedImages, 5, (uploaded, count) => {
      if (progressEl) {
        const percent = Math.round((uploaded / count) * 100);
        progressEl.innerHTML = `<span>📤 Subiendo al marco: ${uploaded} de ${count} (${percent}%)...</span>`;
      }
    });

    if (progressEl) {
      progressEl.innerHTML = `<span style="color:#22c55e;">✅ ¡${total} foto(s) añadidas al marco con éxito!</span>`;
      setTimeout(() => progressEl.classList.add('hidden'), 2500);
    }
    await fetchState();
    renderPhotosPanel();
    PhotoLocalCache.syncServerPhotos(state.photos);
  } catch (err) {
    console.error('Error subiendo fotos:', err);
    if (progressEl) progressEl.innerHTML = `<span style="color:#ef4444;">❌ Error al subir fotos: ${err.message}</span>`;
  } finally {
    event.target.value = '';
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function deletePhoto(id, e) {
  if (e) e.stopPropagation();
  if (!confirm('¿Eliminar esta foto del marco familiar?')) return;
  try {
    const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchState();
      renderPhotosPanel();
      renderAdminPhotos();
    }
  } catch (e) {
    console.error('Error borrando foto:', e);
  }
}

// --- GESTOR DE FOTOS EN EL PANEL DE PADRES (MÓVIL / PC) ---
let adminSelectedPhotosData = [];

function renderAdminPhotos() {
  const gallery = document.getElementById('admin-photos-gallery-grid');
  const countEl = document.getElementById('admin-total-photos-count');
  if (!gallery) return;

  const photos = state.photos || [];
  if (countEl) countEl.textContent = photos.length;

  if (photos.length === 0) {
    gallery.innerHTML = `
      <div style="grid-column: 1 / -1; text-align:center; padding: 25px 10px; color: var(--text-muted); font-size: 0.9rem;">
        No hay fotos activas en el marco. Pulsa arriba en <b>📁 Abrir Galería / Carpeta</b> para seleccionar fotos desde tu móvil o PC.
      </div>
    `;
    return;
  }

  gallery.innerHTML = photos.map(p => `
    <div class="admin-photo-item">
      <img src="/photos/${p.filename}" alt="${escapeHtml(p.caption || 'Foto familiar')}" loading="lazy">
      <button class="admin-photo-del-btn" onclick="deletePhoto(${p.id}, event)" title="Eliminar foto">✕</button>
    </div>
  `).join('');
}

async function handleAdminPhotoSelected(event) {
  const files = Array.from(event.target.files || []);
  if (!files || files.length === 0) return;

  const box = document.getElementById('admin-photos-pending-box');
  const countText = document.getElementById('admin-pending-count-text');
  const thumbGrid = document.getElementById('admin-pending-thumbnails');

  adminSelectedPhotosData = [];
  if (thumbGrid) thumbGrid.innerHTML = '';
  if (countText) countText.textContent = `Optimizando ${files.length} foto(s)...`;
  if (box) box.classList.remove('hidden');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const base64 = await compressImage(file);
    if (base64) {
      adminSelectedPhotosData.push({ image: base64, caption: '', filename: file.name });
    }
  }

  if (countText) countText.textContent = `${adminSelectedPhotosData.length} foto(s) lista(s) para subir`;

  if (thumbGrid) {
    thumbGrid.innerHTML = adminSelectedPhotosData.map((item, idx) => `
      <div class="pending-thumb">
        <img src="${item.image}" alt="Vista previa">
        <button class="pending-thumb-remove" onclick="removeAdminPendingPhoto(${idx})" title="Quitar">✕</button>
      </div>
    `).join('');
  }

  event.target.value = '';
}

function removeAdminPendingPhoto(idx) {
  adminSelectedPhotosData.splice(idx, 1);
  const countText = document.getElementById('admin-pending-count-text');
  const thumbGrid = document.getElementById('admin-pending-thumbnails');
  const box = document.getElementById('admin-photos-pending-box');

  if (adminSelectedPhotosData.length === 0) {
    if (box) box.classList.add('hidden');
    return;
  }

  if (countText) countText.textContent = `${adminSelectedPhotosData.length} foto(s) lista(s) para subir`;
  if (thumbGrid) {
    thumbGrid.innerHTML = adminSelectedPhotosData.map((item, i) => `
      <div class="pending-thumb">
        <img src="${item.image}" alt="Vista previa">
        <button class="pending-thumb-remove" onclick="removeAdminPendingPhoto(${i})" title="Quitar">✕</button>
      </div>
    `).join('');
  }
}

function cancelAdminPendingPhotos() {
  adminSelectedPhotosData = [];
  const box = document.getElementById('admin-photos-pending-box');
  if (box) box.classList.add('hidden');
}

async function uploadAdminPendingPhotos() {
  if (adminSelectedPhotosData.length === 0) return;
  const statusBar = document.getElementById('admin-upload-status-bar');
  const btnUpload = document.getElementById('btn-admin-do-upload');

  if (btnUpload) btnUpload.disabled = true;
  if (statusBar) {
    statusBar.textContent = `⏳ Subiendo ${adminSelectedPhotosData.length} foto(s) al marco...`;
    statusBar.classList.remove('hidden');
    statusBar.style.color = '#38bdf8';
  }

  try {
    const total = await uploadPhotosInBatches(adminSelectedPhotosData, 5, (uploaded, count) => {
      if (statusBar) {
        const percent = Math.round((uploaded / count) * 100);
        statusBar.textContent = `⏳ Subiendo lote: ${uploaded} de ${count} (${percent}%)...`;
      }
    });

    if (statusBar) {
      statusBar.textContent = `✅ ¡${total} foto(s) añadidas al marco con éxito!`;
      statusBar.style.color = '#22c55e';
    }
    adminSelectedPhotosData = [];
    setTimeout(() => {
      const box = document.getElementById('admin-photos-pending-box');
      if (box) box.classList.add('hidden');
      if (statusBar) statusBar.classList.add('hidden');
    }, 2000);
    await fetchState();
    renderAdminPhotos();
    renderPhotosPanel();
    PhotoLocalCache.syncServerPhotos(state.photos);
  } catch (err) {
    console.error('Error subiendo fotos desde admin:', err);
    if (statusBar) {
      statusBar.textContent = `❌ Error: ${err.message || 'Fallo de conexión al subir'}`;
      statusBar.style.color = '#ef4444';
    }
  } finally {
    if (btnUpload) btnUpload.disabled = false;
  }
}

// INICIO AL CARGAR EL DOM
window.addEventListener('DOMContentLoaded', () => {
  initClock();
  initWebSocket();
  fetchState();

  renderEmojiPicker('admin-reward-emoji-picker', REWARD_EMOJIS, 'new-reward-icon');
  renderEmojiPicker('modal-reward-emoji-picker', REWARD_EMOJIS, 'modal-reward-icon');
  renderEmojiPicker('task-emoji-picker', TASK_EMOJIS, 'task-icon');

  // Iniciar detector de inactividad para el salvapantallas de fotos
  resetIdleTimer();
  ['mousemove', 'mousedown', 'touchstart', 'touchmove', 'keydown', 'scroll'].forEach(evt => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  });

  // Despertar AudioContext con primer toque en pantalla
  document.addEventListener('touchstart', getAudioContext, { once: true });
  document.addEventListener('click', getAudioContext, { once: true });
});
