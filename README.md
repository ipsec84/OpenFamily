# 🏡 OpenFamily

> **Smart Family Dashboard & Digital Photo Frame for Wall Tablets & Kiosks**  
> *Panel familiar inteligente y marco de fotos digital para tablets de pared, kioscos táctiles y dispositivos móviles.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)

---

## 🌟 ¿Qué es OpenFamily?

**OpenFamily** es una plataforma integral de organización familiar de código abierto diseñada para transformar cualquier tablet antigua o nueva (Android, iPad, Raspberry Pi Touchscreen o pantalla táctil en pared) en un **centro de mando inteligente para el hogar** y un **marco de fotos digital de alta definición**.

Funciona como aplicación web progresiva (**PWA**) y aplicación Kiosk autohospedada (**100% privada y local**), permitiendo a toda la familia coordinar tareas, calendarios, compras, comidas y recuerdos en tiempo real.

---

## ✨ Características Principales

### 📅 1. Agenda y Calendarios Familiares
- **Vistas por miembro:** Filtros rápidos con código de color y avatar individual para cada miembro de la familia.
- **Sincronización Externa iCal:** Conexión con calendarios de Google Calendar, Apple iCloud, Microsoft Outlook y feeds iCal locales/municipales.
- **Contador de Cumpleaños:** Seguimiento de cumpleaños familiares y aniversarios destacados automáticamente.
- **Filtrado Inteligente:** Muestra eventos de Hoy, Mañana y Próximos días sin saturar la pantalla.

### 🎯 2. Gamificación: Tareas y Premios (Modo Padres & Hijos)
- **Asignación de puntos:** Cada tarea completada suma puntos a la hucha individual del niño o miembro.
- **Frecuencia personalizable:** Tareas de 1 solo día (puntuales) o recurrentes de todos los días.
- **Seguridad y Control Parental:** Los niños pueden marcar sus tareas desde la tablet, pero **únicamente los padres con PIN de 4 dígitos** pueden aprobar los puntos, canjear premios o restar tareas.
- **Tienda de Premios:** Catálogo motivacional con emojis personalizables (tarde de cine, paseo en bicicleta, tiempo de consola, etc.).

### 🖼️ 3. Marco Digital de Fotos & Salvapantallas Inteligente
- **Fotos 100% Limpias:** Modo marco fotográfico sin textos, nombres de archivo ni marcas de agua sobre la imagen.
- **Efecto Ambiente Cinemático:** Fondo desenfocado que rellena pantallas panorámicas manteniendo la relación de aspecto original de cada foto.
- **Almacenamiento Local en Tablet (IndexedDB):** Las fotos se descargan automáticamente en la memoria interna de la tablet para máxima fluidez y funcionamiento **offline** sin depender de la conexión Wi-Fi.
- **Subida Masiva Ilimitada con Compresión HD:** Compresión automática en el navegador (HTML5 Canvas) que optimiza las fotos a Full HD (1080p) antes de enviarlas, permitiendo subir cientos de fotos desde móviles o PCs en segundos sin agotar la memoria.
- **Desplazamiento Táctil:** Galería de fotos con scroll vertical táctil fluido para navegar por colecciones de cientos de imágenes.

### 🌦️ 4. Meteorología en Tiempo Real (Open-Meteo)
- **Previsión de 7 días:** Temperatura actual, sensación térmica, humedad, viento y probabilidad de precipitaciones con iconos WMO oficiales.
- **Widget flotante:** Integrado elegantemente en la cabecera del panel y en el HUD del salvapantallas.

### 🍽️ 5. Menú Semanal y Lista de la Compra
- **Planificador de comidas:** Lunes a Domingo dividido en Almuerzo y Cena, editable desde cualquier móvil.
- **Lista de la compra interactiva:** Clasificación por categorías con tachado táctil instantáneo.
- **Notas Rápidas (Post-it):** Tablón de notas familiares fijadas con colores personalizables.

### 📹 6. Cámaras de Seguridad y Hogar Digital
- **Cámaras RTSP / Tapo:** Visualización directa de cámaras IP locales en la red doméstica con un toque.
- **Control Remoto OTA:** Los padres pueden desde su móvil recargar la pantalla del marco (OTA), hacer sonar una campana de aviso (*"¡A cenar!"*) o atenuar la pantalla en Modo Noche.

---

## 🏗️ Arquitectura y Tecnologías

```
┌────────────────────────────────────────────────────────┐
│                      OpenFamily                        │
├──────────────────────────┬─────────────────────────────┤
│ Frontend (Client)        │ Backend (Server)            │
│ • Vanilla JS (ES6+)      │ • Node.js 20 (Express)      │
│ • IndexedDB (PhotoCache) │ • SQLite3 (Modo WAL)        │
│ • HTML5 Canvas Compress  │ • WebSockets (Live Sync)    │
│ • PWA / CSS Glassmorphism│ • node-ical (Sync)          │
└──────────────────────────┴─────────────────────────────┘
```

- **Sin dependencias pesadas:** Carga ultra-rápida optimizada para tablets con procesadores modestos (Allwinner, MediaTek, Raspberry Pi).
- **Persistencia en SQLite:** Toda la información reside en un único archivo de base de datos (`data/family.db`) fácilmente respaldable.

---

## 🚀 Despliegue con Docker y Docker Compose

### 1. Requisitos Previos
- Docker Engine y Docker Compose instalados.

### 2. Clonar el Repositorio
```bash
git clone https://github.com/ipsec84/OpenFamily.git
cd OpenFamily
```

### 3. Configurar Variables de Entorno
Copia el archivo de plantilla `.env.example` a `.env`:
```bash
cp .env.example .env
```

Edita `.env` con tus preferencias:
```env
# Puerto del servicio
PORT=3000

# Zona horaria
TZ=Europe/Madrid

# Ubicación para el Widget del Clima
CITY_NAME=Madrid
LATITUDE=40.4168
LONGITUDE=-3.7038

# Seguridad y Acceso
PARENT_PIN=1234
ADMIN_PASSWORD=TuPasswordAdminSeguro123.
AUTH_SECRET=GeneraUnaClaveSecretaMuyLarga2026!
KIOSK_TOKEN=clave_de_acceso_directo_kiosk_pantalla

# Feed iCal opcional de eventos municipales o culturales
ICAL_URL=
```

### 4. Iniciar con Docker Compose
```bash
docker compose up -d
```
El panel estará disponible de inmediato en: **`http://localhost:3000`** (o `http://IP-DE-TU-SERVIDOR:3000`).

---

## 📦 Tutoriales de Despliegue por Plataforma

### 🍏 Despliegue en Synology NAS (Container Manager)
1. Abre **Container Manager** en tu Synology DSM.
2. Ve a la pestaña **Proyecto** y haz clic en **Crear**.
3. Asigna el nombre `openfamily`.
4. En **Ruta**, selecciona una carpeta en tu NAS (por ejemplo: `/volume1/docker/openfamily`).
5. Copia el contenido de `docker-compose.yml` en el editor del asistente.
6. Crea la subcarpeta `data` dentro de `/volume1/docker/openfamily`.
7. Haz clic en **Siguiente** y luego en **Finalizar**. Container Manager construirá la imagen y arrancará el contenedor automáticamente.

---

### 🐧 Despliegue en Proxmox VE (LXC Container con Debian/Ubuntu)
1. En Proxmox VE, crea un contenedor LXC con **Ubuntu 22.04** o **Debian 12** (1 vCPU, 512MB RAM, 8GB Disco).
2. Asegúrate de habilitar **Nesting** en `Opciones > Características`.
3. Inicia el contenedor e instala Docker:
   ```bash
   apt update && apt install -y curl git
   curl -fsSL https://get.docker.com | sh
   ```
4. Clona e inicia OpenFamily:
   ```bash
   git clone https://github.com/ipsec84/OpenFamily.git /opt/openfamily
   cd /opt/openfamily
   cp .env.example .env
   docker compose up -d
   ```

---

### 🍓 Despliegue en Raspberry Pi (Raspberry Pi OS)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose git
sudo usermod -aG docker $USER
# Reinicia sesión o reinicia la Pi
git clone https://github.com/ipsec84/OpenFamily.git ~/openfamily
cd ~/openfamily
cp .env.example .env
docker-compose up -d
```

---

## 📱 Configuración en la Tablet de Pared (Modo Kiosco)

Para lograr una experiencia perfecta de marco digital permanente:

1. **Navegador recomendado en Android:** Instala **Fully Kiosk Browser** desde Google Play o mediante APK.
2. **URL de inicio:** Configura la URL de tu servidor: `http://IP-DE-TU-SERVIDOR:3000`.
3. **Ajustes recomendados en Fully Kiosk:**
   - *Kiosk Mode*: Activado (bloquea la barra de navegación del sistema y botones físicos).
   - *Screen Off/On*: Configurar detector de movimiento por cámara frontal o sensor táctil.
   - *Keep Screen On*: Activado mientras haya alimentación eléctrica.
4. **Modo Noche Automático:** OpenFamily oscurecerá la pantalla a un reloj digital tenue durante las horas configuradas en Ajustes (ej. de 23:00 a 07:30).

---

## 🔒 Privacidad y Seguridad

- **100% Autohospedado:** Ningún dato personal, foto familiar, evento o lista sale de tu red local salvo que utilices un túnel inverso seguro (como Cloudflare Tunnel o Tailscale).
- **Protección de PIN:** Las funciones críticas de gestión parental y canje de puntos están protegidas contra manipulaciones de los niños.
- **Contraseñas Hasheadas:** Protección de credenciales administrativas mediante algoritmos criptográficos seguros (SHA-256 / Bcrypt) y limitación de intentos de acceso.

---

## 📄 Licencia

Este proyecto está bajo la licencia **MIT**. Puedes usarlo, modificarlo y desplegarlo libremente en tu hogar.
