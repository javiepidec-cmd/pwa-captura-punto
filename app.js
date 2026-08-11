// =========================================================================
//  PROTOTIPO PWA — CAPTURA DE PUNTOS  (v3)
//  Cambios vs v2:
//    - Login + registro con USUARIOS_APP
//    - Sesión persistente en localStorage
//    - Usuarios conocidos cacheados → login offline si ya ingresó antes
//    - Cada punto guarda opCorreo + opNombre del operario
// =========================================================================

// ---------- 1. POLÍGONOS DE EJEMPLO ----------
const POLIGONOS = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { depto: "CAPITAL", muni: "CORRIENTES" },
      geometry: { type: "Polygon", coordinates: [[
        [-58.92,-27.42],[-58.72,-27.42],[-58.72,-27.56],[-58.92,-27.56],[-58.92,-27.42]
      ]]}},
    { type: "Feature", properties: { depto: "SAN LUIS DEL PALMAR", muni: "SAN LUIS DEL PALMAR" },
      geometry: { type: "Polygon", coordinates: [[
        [-58.65,-27.45],[-58.45,-27.45],[-58.45,-27.60],[-58.65,-27.60],[-58.65,-27.45]
      ]]}},
    { type: "Feature", properties: { depto: "SAN COSME", muni: "PASO DE LA PATRIA" },
      geometry: { type: "Polygon", coordinates: [[
        [-58.65,-27.28],[-58.45,-27.28],[-58.45,-27.42],[-58.65,-27.42],[-58.65,-27.28]
      ]]}}
  ]
};

// ---------- 2. CONFIGURACIÓN ----------
const CONFIG = {
  endpointSync: "https://script.google.com/macros/s/AKfycbx4zfP3nZU3VjT2GIaLUwlVxFTFl3MUvQH3N7yl7IyTjzJO_ZmVlyDWXiDlU31Og-N6DA/exec",
  secret: "k7pR9xN2mLqW4vJ8sT3yA6bH5cF1eD0zGu",
  dbName: "capturaPuntosPWA",
  dbVersion: 1,
  storeName: "puntos",
  timeoutGps: 30000,
  cacheTiposKey: "cacheTiposCaptura",
  sesionKey: "sesionActiva",
  usuariosKey: "usuariosConocidos"
};

// ---------- 3. ESTADO ----------
let db = null;
let mapa = null;
let marcador = null;
let ultimoFix = null;
let sesion = null;  // { correo, nombre, estado, fechaLogin }

// ---------- 4. INICIALIZACIÓN ----------
document.addEventListener("DOMContentLoaded", async () => {
  await abrirDB();
  registrarSW();
  wireUI();
  actualizarEstadoConexion();

  // Chequear sesión activa
  sesion = leerSesion();
  if (sesion && sesion.estado === "APROBADO") {
    entrarAApp();
  } else {
    mostrarLogin();
  }

  window.addEventListener("online", () => {
    actualizarEstadoConexion();
    actualizarAvisoConexionLogin();
    if (sesion && sesion.estado === "APROBADO") {
      toast("Conexión recuperada — sincronizando...");
      sincronizar();
      cargarTipos();
    }
  });
  window.addEventListener("offline", () => {
    actualizarEstadoConexion();
    actualizarAvisoConexionLogin();
  });
});

// ==========================================================================
//                           GESTIÓN DE SESIÓN
// ==========================================================================

function leerSesion() {
  try {
    const raw = localStorage.getItem(CONFIG.sesionKey);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function guardarSesion(s) {
  localStorage.setItem(CONFIG.sesionKey, JSON.stringify(s));
  sesion = s;
}

function borrarSesion() {
  localStorage.removeItem(CONFIG.sesionKey);
  sesion = null;
}

function leerUsuariosConocidos() {
  try {
    const raw = localStorage.getItem(CONFIG.usuariosKey);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function recordarUsuario(correo, nombre, estado) {
  const conocidos = leerUsuariosConocidos();
  conocidos[correo.toLowerCase()] = {
    nombre, estado, ultimoLogin: new Date().toISOString()
  };
  localStorage.setItem(CONFIG.usuariosKey, JSON.stringify(conocidos));
}

// ==========================================================================
//                           LOGIN / REGISTRO
// ==========================================================================

function mostrarLogin() {
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("userBar").classList.add("hidden");
  document.getElementById("mainApp").classList.add("hidden");
  document.getElementById("formLogin").classList.remove("hidden");
  document.getElementById("formRegister").classList.add("hidden");
  document.getElementById("authTitulo").textContent = "Ingreso al sistema";
  actualizarAvisoConexionLogin();
}

function mostrarRegistro() {
  document.getElementById("formLogin").classList.add("hidden");
  document.getElementById("formRegister").classList.remove("hidden");
  document.getElementById("authTitulo").textContent = "Solicitud de registro";
}

function actualizarAvisoConexionLogin() {
  const div = document.getElementById("authConexionMsg");
  if (!div) return;
  if (!navigator.onLine) {
    div.className = "auth-warn";
    div.innerHTML = "⚠ Sin conexión. Sólo podés ingresar con un correo que ya haya iniciado sesión antes en este dispositivo.";
  } else {
    div.className = "";
    div.innerHTML = "";
  }
}

function entrarAApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("userBar").classList.remove("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
  document.getElementById("userName").textContent = sesion.nombre || sesion.correo;
  renderizarLista();
  cargarTipos();
  if (navigator.onLine) sincronizar();
}

async function intentarLogin() {
  const correoInput = document.getElementById("loginCorreo").value.trim().toLowerCase();
  if (!correoInput || !validarEmail(correoInput)) {
    toast("Ingresá un correo válido");
    return;
  }

  const btn = document.getElementById("btnLogin");
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  try {
    if (navigator.onLine && !CONFIG.endpointSync.includes("PEGAR_URL")) {
      // ONLINE: consultar al servidor
      const url = CONFIG.endpointSync + "?action=login&correo=" + encodeURIComponent(correoInput);
      const res = await fetch(url);
      const json = await res.json();

      if (json.ok && json.estado === "APROBADO") {
        recordarUsuario(correoInput, json.nombre, "APROBADO");
        guardarSesion({
          correo: correoInput,
          nombre: json.nombre,
          estado: "APROBADO",
          fechaLogin: new Date().toISOString()
        });
        toast("Bienvenido/a " + json.nombre);
        entrarAApp();
        return;
      }

      if (json.estado === "PENDIENTE") {
        toast("Tu cuenta está pendiente de aprobación");
        return;
      }
      if (json.estado === "RECHAZADO") {
        toast("Tu cuenta fue rechazada. Contactá al administrador");
        return;
      }
      if (json.error === "no_encontrado") {
        toast("Ese correo no está registrado. Registrate primero.");
        return;
      }
      toast("Error: " + (json.error || "desconocido"));
      return;
    }

    // OFFLINE: buscar en usuarios conocidos
    const conocidos = leerUsuariosConocidos();
    const usr = conocidos[correoInput];
    if (usr && usr.estado === "APROBADO") {
      guardarSesion({
        correo: correoInput,
        nombre: usr.nombre,
        estado: "APROBADO",
        fechaLogin: new Date().toISOString()
      });
      toast("Bienvenido/a " + usr.nombre + " (modo offline)");
      entrarAApp();
    } else {
      toast("Sin conexión: no se puede validar este correo");
    }
  } catch (e) {
    toast("Error de red: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Ingresar";
  }
}

async function intentarRegistro() {
  const correo = document.getElementById("regCorreo").value.trim().toLowerCase();
  const nombre = document.getElementById("regNombre").value.trim();

  if (!validarEmail(correo)) { toast("Ingresá un correo válido"); return; }
  if (nombre.length < 3)     { toast("Ingresá tu nombre completo"); return; }
  if (!navigator.onLine)     { toast("Necesitás conexión para registrarte"); return; }
  if (CONFIG.endpointSync.includes("PEGAR_URL")) {
    toast("⚠ Falta configurar la URL del Apps Script");
    return;
  }

  const btn = document.getElementById("btnRegister");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  try {
    const res = await fetch(CONFIG.endpointSync, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "register_user",
        secret: CONFIG.secret,
        data: { correo, nombre }
      })
    });
    const json = await res.json();

    if (json.ok) {
      toast("Solicitud enviada. Te avisamos cuando esté aprobada.");
      document.getElementById("regCorreo").value = "";
      document.getElementById("regNombre").value = "";
      setTimeout(() => {
        document.getElementById("formRegister").classList.add("hidden");
        document.getElementById("formLogin").classList.remove("hidden");
        document.getElementById("authTitulo").textContent = "Ingreso al sistema";
        document.getElementById("loginCorreo").value = correo;
      }, 1500);
    } else if (json.error === "ya_registrado") {
      toast("Ese correo ya está registrado. Intentá ingresar.");
    } else {
      toast("Error: " + (json.error || "desconocido"));
    }
  } catch (e) {
    toast("Error de red: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar solicitud";
  }
}

function cerrarSesion() {
  if (!confirm("¿Cerrar sesión? Los puntos pendientes quedan guardados hasta el próximo ingreso.")) return;
  borrarSesion();
  document.getElementById("loginCorreo").value = "";
  mostrarLogin();
  toast("Sesión cerrada");
}

function validarEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ==========================================================================
//                           INDEXED DB
// ==========================================================================

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(CONFIG.storeName)) {
        const store = d.createObjectStore(CONFIG.storeName, { keyPath: "uuid" });
        store.createIndex("estado", "estado");
        store.createIndex("fecha", "fecha");
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode = "readonly") {
  return db.transaction(CONFIG.storeName, mode).objectStore(CONFIG.storeName);
}

function guardarEnDB(punto) {
  return new Promise((resolve, reject) => {
    const req = txStore("readwrite").put(punto);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function listarPuntos() {
  return new Promise((resolve, reject) => {
    const req = txStore().getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function borrarPunto(uuid) {
  return new Promise((resolve, reject) => {
    const req = txStore("readwrite").delete(uuid);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ==========================================================================
//                       CARGA DE TIPOS DESDE CEREBRO
// ==========================================================================

async function cargarTipos() {
  const cache = localStorage.getItem(CONFIG.cacheTiposKey);
  if (cache) {
    try { poblarSelectTipos(JSON.parse(cache)); } catch (e) {}
  }

  if (!navigator.onLine) return;
  if (CONFIG.endpointSync.includes("PEGAR_URL")) return;

  try {
    const url = CONFIG.endpointSync + "?action=list_tipos";
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok && Array.isArray(json.tipos)) {
      localStorage.setItem(CONFIG.cacheTiposKey, JSON.stringify(json.tipos));
      poblarSelectTipos(json.tipos);
    }
  } catch (e) {
    console.warn("No se pudo refrescar tipos:", e);
  }
}

function poblarSelectTipos(tipos) {
  const sel = document.getElementById("tipoRegistro");
  const actual = sel.value;
  if (!tipos || tipos.length === 0) {
    sel.innerHTML = '<option value="">-- Sin tipos cargados (conectate a internet) --</option>';
    return;
  }
  sel.innerHTML = '<option value="">-- Elegir tipo --</option>' +
    tipos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  if (actual && tipos.includes(actual)) sel.value = actual;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

// ==========================================================================
//                           CAPTURA DE UBICACIÓN
// ==========================================================================

function capturarUbicacion() {
  const btn = document.getElementById("btnUbicacion");
  const estadoBox = document.getElementById("estadoGps");
  const txtEstado = document.getElementById("txtEstado");

  if (!navigator.geolocation) {
    toast("Este dispositivo no soporta geolocalización");
    return;
  }

  btn.disabled = true;
  btn.textContent = "📡 Buscando...";
  estadoBox.classList.remove("hidden");
  txtEstado.textContent = "Buscando señal GPS (puede tardar hasta 30s la primera vez)...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy: prec } = pos.coords;
      procesarFix(lat, lng, prec, "gps");
      btn.disabled = false;
      btn.textContent = "📡 Usar mi GPS";
    },
    (err) => {
      btn.disabled = false;
      btn.textContent = "📡 Usar mi GPS";
      let msg = "Error de GPS: ";
      if (err.code === 1) msg += "permiso denegado";
      else if (err.code === 2) msg += "posición no disponible";
      else if (err.code === 3) msg += "tiempo de espera agotado";
      else msg += err.message;
      toast(msg);
      txtEstado.textContent = msg;
    },
    { enableHighAccuracy: true, timeout: CONFIG.timeoutGps, maximumAge: 0 }
  );
}

function abrirModalManual() {
  document.getElementById("modalManual").classList.remove("hidden");
  document.getElementById("manualLat").value = "";
  document.getElementById("manualLng").value = "";
  setTimeout(() => document.getElementById("manualLat").focus(), 100);
}

function cerrarModalManual() {
  document.getElementById("modalManual").classList.add("hidden");
}

function confirmarManual() {
  const latStr = document.getElementById("manualLat").value.trim().replace(",", ".");
  const lngStr = document.getElementById("manualLng").value.trim().replace(",", ".");
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (isNaN(lat) || isNaN(lng)) { toast("Ingresá números válidos (usar punto decimal)"); return; }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { toast("Coordenadas fuera de rango"); return; }

  cerrarModalManual();
  procesarFix(lat, lng, null, "manual");
}

function procesarFix(lat, lng, precision, fuente) {
  const coordBox = document.getElementById("coordBox");
  coordBox.classList.remove("hidden");
  document.getElementById("txtLat").textContent = lat.toFixed(6);
  document.getElementById("txtLng").textContent = lng.toFixed(6);

  const precEl = document.getElementById("txtPrec");
  if (precision !== null && precision !== undefined) {
    precEl.textContent = precision.toFixed(1) + " m";
    precEl.className = precision < 10 ? "precision-ok"
                      : precision < 30 ? "precision-warn"
                      : "precision-mala";
  } else {
    precEl.textContent = "(carga manual)";
    precEl.className = "";
  }

  const detectado = detectarUbicacion(lat, lng);
  const detectBox = document.getElementById("ubicacionDetectada");
  detectBox.classList.remove("hidden", "fuera-corrientes");

  if (detectado) {
    detectBox.innerHTML = `
      <div><strong>Departamento:</strong> ${escapeHtml(detectado.depto)}</div>
      <div><strong>Municipio:</strong> ${escapeHtml(detectado.muni)}</div>
    `;
    ultimoFix = { lat, lng, precision, fuente, ...detectado };
  } else {
    detectBox.classList.add("fuera-corrientes");
    detectBox.innerHTML = `
      <div><strong>⚠ Punto fuera de la cobertura de polígonos cargados.</strong></div>
      <div style="font-size: 13px; margin-top: 4px;">
        Se guardará sin depto/municipio automático.
      </div>
    `;
    ultimoFix = { lat, lng, precision, fuente, depto: null, muni: null };
  }

  document.getElementById("estadoGps").classList.add("hidden");
  document.getElementById("formulario").classList.remove("hidden");
  mostrarMapa(lat, lng);
}

function detectarUbicacion(lat, lng) {
  const punto = turf.point([lng, lat]);
  for (const feat of POLIGONOS.features) {
    if (turf.booleanPointInPolygon(punto, feat)) {
      return { depto: feat.properties.depto, muni: feat.properties.muni };
    }
  }
  return null;
}

function mostrarMapa(lat, lng) {
  const div = document.getElementById("mapa");
  div.classList.remove("hidden");

  if (!mapa) {
    mapa = L.map("mapa", { zoomControl: true }).setView([lat, lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OSM"
    }).addTo(mapa);
  } else {
    mapa.setView([lat, lng], 17);
  }

  if (marcador) mapa.removeLayer(marcador);
  marcador = L.circleMarker([lat, lng], {
    radius: 9, color: "#1F4A8B", fillColor: "#1F4A8B", fillOpacity: 0.8, weight: 2
  }).addTo(mapa);
  setTimeout(() => mapa.invalidateSize(), 100);
}

// ==========================================================================
//                     GUARDAR + SINCRONIZAR
// ==========================================================================

async function guardarPunto() {
  if (!ultimoFix) { toast("Primero cargá una ubicación"); return; }
  if (!sesion)    { toast("Sesión inválida — reingresá"); mostrarLogin(); return; }

  const tipo = document.getElementById("tipoRegistro").value.trim();
  if (!tipo) { toast("Elegí un tipo de registro"); return; }

  const punto = {
    uuid: crypto.randomUUID(),
    lat: ultimoFix.lat,
    lng: ultimoFix.lng,
    precision: ultimoFix.precision,
    fuente: ultimoFix.fuente,
    depto: ultimoFix.depto,
    muni: ultimoFix.muni,
    tipo: tipo,
    nroVivienda: document.getElementById("nroVivienda").value.trim(),
    descripcion: document.getElementById("descripcion").value.trim(),
    observaciones: document.getElementById("observaciones").value.trim(),
    opCorreo: sesion.correo,
    opNombre: sesion.nombre,
    fecha: new Date().toISOString(),
    estado: "pendiente"
  };

  await guardarEnDB(punto);
  toast("Punto guardado localmente ✓");

  document.getElementById("tipoRegistro").value = "";
  document.getElementById("nroVivienda").value = "";
  document.getElementById("descripcion").value = "";
  document.getElementById("observaciones").value = "";
  document.getElementById("formulario").classList.add("hidden");
  document.getElementById("coordBox").classList.add("hidden");
  document.getElementById("ubicacionDetectada").classList.add("hidden");
  document.getElementById("mapa").classList.add("hidden");
  ultimoFix = null;

  await renderizarLista();
  if (navigator.onLine) sincronizar();
}

async function sincronizar() {
  if (!navigator.onLine) { toast("Sin conexión — se sincroniza cuando haya red"); return; }
  if (CONFIG.endpointSync.includes("PEGAR_URL")) { toast("⚠ Falta configurar la URL"); return; }

  const puntos = await listarPuntos();
  const pendientes = puntos.filter(p => p.estado === "pendiente" || p.estado === "error");
  if (pendientes.length === 0) { toast("Nada para sincronizar"); return; }

  toast(`Sincronizando ${pendientes.length} punto(s)...`);

  for (const p of pendientes) {
    try {
      const res = await fetch(CONFIG.endpointSync, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "insert_punto",
          secret: CONFIG.secret,
          data: {
            uuid: p.uuid,
            fecha: p.fecha,
            tipo: p.tipo,
            nroVivienda: p.nroVivienda,
            depto: p.depto,
            muni: p.muni,
            lat: p.lat,
            lng: p.lng,
            precision: p.precision,
            descripcion: p.descripcion,
            observaciones: p.observaciones,
            opCorreo: p.opCorreo || (sesion && sesion.correo) || "",
            opNombre: p.opNombre || (sesion && sesion.nombre) || ""
          }
        })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error del servidor");
      p.estado = "sincronizado";
      p.fechaSync = new Date().toISOString();
      await guardarEnDB(p);
    } catch (e) {
      p.estado = "error";
      p.errorMsg = e.message;
      await guardarEnDB(p);
    }
  }

  await renderizarLista();
  toast("Sincronización completada");
}

// ==========================================================================
//                           UI: LISTA DE PUNTOS
// ==========================================================================

async function renderizarLista() {
  const puntos = await listarPuntos();
  puntos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  document.getElementById("contadorPuntos").textContent = puntos.length;
  const ul = document.getElementById("listaPendientes");
  const empty = document.getElementById("sinPuntos");

  if (puntos.length === 0) {
    ul.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  ul.innerHTML = puntos.map(p => {
    const dotClass = p.estado === "sincronizado" ? "status-sincronizado"
                   : p.estado === "error" ? "status-error"
                   : "status-pendiente";
    const fecha = new Date(p.fecha).toLocaleString("es-AR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    const ubi = p.muni ? p.muni : "sin ubicación";
    const nvi = p.nroVivienda ? ` · N°${escapeHtml(p.nroVivienda)}` : "";
    return `
      <li>
        <div>
          <span class="status-dot ${dotClass}"></span>
          <strong>${escapeHtml(p.tipo)}</strong> — ${escapeHtml(ubi)}${nvi}<br>
          <small style="color:#666;">${fecha} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</small>
        </div>
        <button style="width:auto;padding:6px 10px;font-size:12px;background:#eee;color:#666;"
                onclick="eliminarPunto('${p.uuid}')">✕</button>
      </li>
    `;
  }).join("");
}

async function eliminarPunto(uuid) {
  if (!confirm("¿Eliminar este punto de la cola local?")) return;
  await borrarPunto(uuid);
  await renderizarLista();
  toast("Punto eliminado");
}

// ==========================================================================
//                           UTILIDADES
// ==========================================================================

function actualizarEstadoConexion() {
  const badge = document.getElementById("badgeConexion");
  if (navigator.onLine) {
    badge.textContent = "Online";
    badge.className = "badge online";
  } else {
    badge.textContent = "Offline";
    badge.className = "badge offline";
  }
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function registrarSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js")
      .then(() => console.log("SW registrado"))
      .catch(e => console.warn("SW error:", e));
  }
}

function wireUI() {
  // Login/registro
  document.getElementById("btnLogin").addEventListener("click", intentarLogin);
  document.getElementById("btnRegister").addEventListener("click", intentarRegistro);
  document.getElementById("linkRegister").addEventListener("click", mostrarRegistro);
  document.getElementById("linkLogin").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("formRegister").classList.add("hidden");
    document.getElementById("formLogin").classList.remove("hidden");
    document.getElementById("authTitulo").textContent = "Ingreso al sistema";
  });
  document.getElementById("btnLogout").addEventListener("click", cerrarSesion);

  // App principal
  document.getElementById("btnUbicacion").addEventListener("click", capturarUbicacion);
  document.getElementById("btnManual").addEventListener("click", abrirModalManual);
  document.getElementById("btnManualOk").addEventListener("click", confirmarManual);
  document.getElementById("btnManualCancel").addEventListener("click", cerrarModalManual);
  document.getElementById("btnGuardar").addEventListener("click", guardarPunto);
  document.getElementById("btnSincronizar").addEventListener("click", sincronizar);

  // Enter para submit en login
  document.getElementById("loginCorreo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") intentarLogin();
  });
}

window.eliminarPunto = eliminarPunto;
