// =========================================================================
//  PROTOTIPO PWA — CAPTURA DE PUNTOS  (v5)
//  Cambios vs v4:
//    - Botón "Colocar punto" activa modo colocación (tap en el mapa NO hace
//      nada hasta que el usuario lo activa explícitamente)
//    - N° de vivienda solo acepta números (validado)
//    - Puntos guardados aparecen en el mapa con marcador según estado
//      (amarillo pendiente, verde sincronizado, rojo error) y tooltip
//      flotante con N° de vivienda y tipo
// =========================================================================


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
  usuariosKey: "usuariosConocidos",
  mapaCentroDefault: [-28.5, -58.0],
  mapaZoomDefault: 8,
  mapaZoomGps: 17
};

// ---------- 3. ESTADO ----------
let db = null;
let mapa = null;
let marcadorOperario = null;
let circuloPrecision = null;
let marcadorPunto = null;           // punto por guardar (grande, azul institucional)
let grupoPuntosGuardados = null;    // LayerGroup con los puntos ya guardados
let ultimoFix = null;
let ubicacionOperario = null;
let sesion = null;
let modoColocacion = false;         // true cuando el operario activó "Colocar punto"

// ---------- 4. INICIALIZACIÓN ----------
document.addEventListener("DOMContentLoaded", async () => {
  await abrirDB();
  registrarSW();
  wireUI();
  actualizarEstadoConexion();

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
  try { return JSON.parse(localStorage.getItem(CONFIG.sesionKey) || "null"); }
  catch (e) { return null; }
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
  try { return JSON.parse(localStorage.getItem(CONFIG.usuariosKey) || "{}"); }
  catch (e) { return {}; }
}
function recordarUsuario(correo, nombre, estado) {
  const conocidos = leerUsuariosConocidos();
  conocidos[correo.toLowerCase()] = { nombre, estado, ultimoLogin: new Date().toISOString() };
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
  inicializarMapa();
  refrescarUbicacionGps();
  if (navigator.onLine) sincronizar();
}

async function intentarLogin() {
  const correoInput = document.getElementById("loginCorreo").value.trim().toLowerCase();
  if (!correoInput || !validarEmail(correoInput)) { toast("Ingresá un correo válido"); return; }

  const btn = document.getElementById("btnLogin");
  btn.disabled = true;
  btn.textContent = "Ingresando...";

  try {
    if (navigator.onLine && !CONFIG.endpointSync.includes("PEGAR_URL")) {
      const url = CONFIG.endpointSync + "?action=login&correo=" + encodeURIComponent(correoInput);
      const res = await fetch(url);
      const json = await res.json();

      if (json.ok && json.estado === "APROBADO") {
        recordarUsuario(correoInput, json.nombre, "APROBADO");
        guardarSesion({ correo: correoInput, nombre: json.nombre, estado: "APROBADO", fechaLogin: new Date().toISOString() });
        toast("Bienvenido/a " + json.nombre);
        entrarAApp();
        return;
      }
      if (json.estado === "PENDIENTE") { toast("Tu cuenta está pendiente de aprobación"); return; }
      if (json.estado === "RECHAZADO") { toast("Tu cuenta fue rechazada. Contactá al administrador"); return; }
      if (json.error === "no_encontrado") { toast("Ese correo no está registrado. Registrate primero."); return; }
      toast("Error: " + (json.error || "desconocido"));
      return;
    }

    const conocidos = leerUsuariosConocidos();
    const usr = conocidos[correoInput];
    if (usr && usr.estado === "APROBADO") {
      guardarSesion({ correo: correoInput, nombre: usr.nombre, estado: "APROBADO", fechaLogin: new Date().toISOString() });
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
  if (CONFIG.endpointSync.includes("PEGAR_URL")) { toast("⚠ Falta configurar la URL"); return; }

  const btn = document.getElementById("btnRegister");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  try {
    const res = await fetch(CONFIG.endpointSync, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "register_user", secret: CONFIG.secret, data: { correo, nombre } })
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
  if (mapa) { mapa.remove(); mapa = null; }
  marcadorOperario = null; circuloPrecision = null; marcadorPunto = null;
  grupoPuntosGuardados = null; ubicacionOperario = null; ultimoFix = null;
  modoColocacion = false;
  mostrarLogin();
  toast("Sesión cerrada");
}

function validarEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

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
function txStore(mode = "readonly") { return db.transaction(CONFIG.storeName, mode).objectStore(CONFIG.storeName); }
function guardarEnDB(punto) { return new Promise((res, rej) => { const r = txStore("readwrite").put(punto); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
function listarPuntos() { return new Promise((res, rej) => { const r = txStore().getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
function borrarPunto(uuid) { return new Promise((res, rej) => { const r = txStore("readwrite").delete(uuid); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }

// ==========================================================================
//                       CARGA DE TIPOS DESDE CEREBRO
// ==========================================================================

async function cargarTipos() {
  const cache = localStorage.getItem(CONFIG.cacheTiposKey);
  if (cache) { try { poblarSelectTipos(JSON.parse(cache)); } catch (e) {} }

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
  } catch (e) { console.warn("No se pudo refrescar tipos:", e); }
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
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// ==========================================================================
//                           MAPA
// ==========================================================================

function inicializarMapa() {
  if (mapa) return;

  mapa = L.map("mapa", { zoomControl: true }).setView(CONFIG.mapaCentroDefault, CONFIG.mapaZoomDefault);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OSM"
  }).addTo(mapa);

  // Contornos de referencia de polígonos
  L.geoJSON(POLIGONOS, {
    style: { color: "#1F4A8B", weight: 1.5, fillOpacity: 0.05, opacity: 0.6 }
  }).addTo(mapa);

  // Grupo para los puntos guardados (permite refrescar todos juntos)
  grupoPuntosGuardados = L.layerGroup().addTo(mapa);

  // Handler de click: solo funciona en modo colocación
  mapa.on("click", (e) => {
    if (!modoColocacion) return;
    colocarPuntoEnMapa(e.latlng.lat, e.latlng.lng, "mapa");
    desactivarModoColocacion();
  });

  setTimeout(() => mapa.invalidateSize(), 200);

  // Pintar puntos guardados iniciales
  pintarPuntosGuardados();
}

function activarModoColocacion() {
  modoColocacion = true;
  const btn = document.getElementById("btnColocarPunto");
  btn.classList.remove("btn-primary");
  btn.classList.add("btn-colocando");
  btn.innerHTML = "❌ Cancelar colocación";
  document.getElementById("mapa").classList.add("modo-colocando");
  toast("Ahora tocá el mapa donde va el punto");
}

function desactivarModoColocacion() {
  modoColocacion = false;
  const btn = document.getElementById("btnColocarPunto");
  btn.classList.remove("btn-colocando");
  btn.classList.add("btn-primary");
  btn.innerHTML = "📍 Colocar punto";
  document.getElementById("mapa").classList.remove("modo-colocando");
}

function toggleModoColocacion() {
  if (modoColocacion) desactivarModoColocacion();
  else                activarModoColocacion();
}

function refrescarUbicacionGps() {
  const btn = document.getElementById("btnRefrescarGps");

  if (!navigator.geolocation) { toast("Este dispositivo no soporta geolocalización"); return; }

  if (btn) { btn.disabled = true; btn.textContent = "🔄 Buscando..."; }
  toast("Buscando señal GPS...");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy: prec } = pos.coords;
      ubicacionOperario = { lat, lng, precision: prec };
      pintarUbicacionOperario();
      mapa.setView([lat, lng], CONFIG.mapaZoomGps);
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Refrescar"; }
      toast("Ubicación actualizada (precisión: " + prec.toFixed(0) + " m)");
    },
    (err) => {
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Refrescar"; }
      let msg = "Error de GPS: ";
      if (err.code === 1) msg += "permiso denegado";
      else if (err.code === 2) msg += "posición no disponible";
      else if (err.code === 3) msg += "tiempo de espera agotado";
      else msg += err.message;
      toast(msg);
    },
    { enableHighAccuracy: true, timeout: CONFIG.timeoutGps, maximumAge: 0 }
  );
}

function pintarUbicacionOperario() {
  if (!ubicacionOperario || !mapa) return;
  const { lat, lng, precision } = ubicacionOperario;

  if (marcadorOperario) mapa.removeLayer(marcadorOperario);
  if (circuloPrecision) mapa.removeLayer(circuloPrecision);

  circuloPrecision = L.circle([lat, lng], {
    radius: precision, color: "#4285F4", fillColor: "#4285F4", fillOpacity: 0.1, weight: 1
  }).addTo(mapa);

  const icon = L.divIcon({
    className: "",
    html: '<div class="marker-operario"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
  marcadorOperario = L.marker([lat, lng], { icon: icon, interactive: false }).addTo(mapa);
}

function usarUbicacionComoPunto() {
  if (!ubicacionOperario) {
    toast("Todavía no hay ubicación GPS. Tocá 'Refrescar' primero.");
    return;
  }
  const { lat, lng, precision } = ubicacionOperario;
  colocarPuntoEnMapa(lat, lng, "gps", precision);
}

function colocarPuntoEnMapa(lat, lng, fuente, precision) {
  if (marcadorPunto) mapa.removeLayer(marcadorPunto);

  marcadorPunto = L.circleMarker([lat, lng], {
    radius: 10, color: "#1F4A8B", fillColor: "#1F4A8B", fillOpacity: 0.85, weight: 3
  }).addTo(mapa);
  marcadorPunto.bindTooltip("Nuevo punto (sin guardar)", {
    direction: "top", offset: [0, -8], permanent: false
  });

  procesarFix(lat, lng, precision !== undefined ? precision : null, fuente);
}

function quitarPuntoDelMapa() {
  if (marcadorPunto && mapa) { mapa.removeLayer(marcadorPunto); marcadorPunto = null; }
}

// ==========================================================================
//              PINTAR PUNTOS GUARDADOS EN EL MAPA (con tooltip)
// ==========================================================================

async function pintarPuntosGuardados() {
  if (!mapa || !grupoPuntosGuardados) return;
  grupoPuntosGuardados.clearLayers();

  const puntos = await listarPuntos();
  puntos.forEach(p => {
    if (!p.lat || !p.lng) return;

    const color = p.estado === "sincronizado" ? "#719C29"
                : p.estado === "error"         ? "#F4492E"
                : "#FAAE05";  // pendiente

    const marker = L.circleMarker([p.lat, p.lng], {
      radius: 6,
      color: color,
      fillColor: color,
      fillOpacity: 0.75,
      weight: 2
    });

    const nvi = p.nroVivienda ? `N° ${escapeHtml(p.nroVivienda)}` : "Sin N°";
    const info = `<strong>${nvi}</strong><br>${escapeHtml(p.tipo || "")}`;
    marker.bindTooltip(info, {
      direction: "top",
      offset: [0, -6],
      permanent: false,
      opacity: 0.95
    });

    marker.addTo(grupoPuntosGuardados);
  });
}

// ==========================================================================
//                       PROCESAMIENTO DEL PUNTO
// ==========================================================================

function procesarFix(lat, lng, precision, fuente) {
  document.getElementById("coordBox").classList.remove("hidden");
  document.getElementById("txtLat").textContent = lat.toFixed(6);
  document.getElementById("txtLng").textContent = lng.toFixed(6);

  const precEl = document.getElementById("txtPrec");
  if (precision !== null && precision !== undefined) {
    precEl.textContent = precision.toFixed(1) + " m";
    precEl.className = precision < 10 ? "precision-ok" : precision < 30 ? "precision-warn" : "precision-mala";
  } else {
    precEl.textContent = "(marcado en el mapa)";
    precEl.className = "";
  }

  const detectado = detectarUbicacion(lat, lng);
  const detectBox = document.getElementById("ubicacionDetectada");
  detectBox.classList.remove("hidden", "fuera-corrientes");

  if (detectado) {
    detectBox.innerHTML = `<div><strong>Departamento:</strong> ${escapeHtml(detectado.depto)}</div>
                           <div><strong>Municipio:</strong> ${escapeHtml(detectado.muni)}</div>`;
    ultimoFix = { lat, lng, precision, fuente, ...detectado };
  } else {
    detectBox.classList.add("fuera-corrientes");
    detectBox.innerHTML = `<div><strong>⚠ Punto fuera de la cobertura de polígonos cargados.</strong></div>
                           <div style="font-size: 13px; margin-top: 4px;">Se guardará sin depto/municipio automático.</div>`;
    ultimoFix = { lat, lng, precision, fuente, depto: null, muni: null };
  }

  document.getElementById("formulario").classList.remove("hidden");
  // Focus en el primer campo del formulario para agilizar carga
  setTimeout(() => document.getElementById("tipoRegistro").focus(), 200);
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

// ==========================================================================
//                     GUARDAR + SINCRONIZAR
// ==========================================================================

async function guardarPunto() {
  if (!ultimoFix) { toast("Primero marcá un punto en el mapa"); return; }
  if (!sesion)    { toast("Sesión inválida — reingresá"); mostrarLogin(); return; }

  const tipo = document.getElementById("tipoRegistro").value.trim();
  if (!tipo) { toast("Elegí un tipo de registro"); return; }

  const nroVivienda = document.getElementById("nroVivienda").value.trim();
  if (nroVivienda && !/^\d+$/.test(nroVivienda)) {
    toast("El N° de vivienda debe ser solo números");
    return;
  }

  const punto = {
    uuid: crypto.randomUUID(),
    lat: ultimoFix.lat,
    lng: ultimoFix.lng,
    precision: ultimoFix.precision,
    fuente: ultimoFix.fuente,
    depto: ultimoFix.depto,
    muni: ultimoFix.muni,
    tipo: tipo,
    nroVivienda: nroVivienda,
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
  quitarPuntoDelMapa();
  ultimoFix = null;

  await renderizarLista();
  await pintarPuntosGuardados();  // refrescar el mapa con el nuevo punto
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
            uuid: p.uuid, fecha: p.fecha, tipo: p.tipo, nroVivienda: p.nroVivienda,
            depto: p.depto, muni: p.muni, lat: p.lat, lng: p.lng, precision: p.precision,
            descripcion: p.descripcion, observaciones: p.observaciones,
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
  await pintarPuntosGuardados();  // refrescar colores (amarillo → verde)
  toast("Sincronización completada");
}

// ==========================================================================
//                           LISTA DE PUNTOS
// ==========================================================================

async function renderizarLista() {
  const puntos = await listarPuntos();
  puntos.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  document.getElementById("contadorPuntos").textContent = puntos.length;
  const ul = document.getElementById("listaPendientes");
  const empty = document.getElementById("sinPuntos");

  if (puntos.length === 0) { ul.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";

  ul.innerHTML = puntos.map(p => {
    const dotClass = p.estado === "sincronizado" ? "status-sincronizado"
                   : p.estado === "error" ? "status-error" : "status-pendiente";
    const fecha = new Date(p.fecha).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
      </li>`;
  }).join("");
}

async function eliminarPunto(uuid) {
  if (!confirm("¿Eliminar este punto de la cola local?")) return;
  await borrarPunto(uuid);
  await renderizarLista();
  await pintarPuntosGuardados();
  toast("Punto eliminado");
}

// ==========================================================================
//                           UTILIDADES + WIRING
// ==========================================================================

function actualizarEstadoConexion() {
  const badge = document.getElementById("badgeConexion");
  if (navigator.onLine) { badge.textContent = "Online"; badge.className = "badge online"; }
  else                  { badge.textContent = "Offline"; badge.className = "badge offline"; }
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

  // App principal — botones de mapa
  document.getElementById("btnColocarPunto").addEventListener("click", toggleModoColocacion);
  document.getElementById("btnUsarUbicacion").addEventListener("click", usarUbicacionComoPunto);
  document.getElementById("btnRefrescarGps").addEventListener("click", refrescarUbicacionGps);
  document.getElementById("btnGuardar").addEventListener("click", guardarPunto);
  document.getElementById("btnSincronizar").addEventListener("click", sincronizar);

  // Validación en vivo del N° vivienda: solo permitir dígitos
  document.getElementById("nroVivienda").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^\d]/g, "");
  });

  document.getElementById("loginCorreo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") intentarLogin();
  });
}

window.eliminarPunto = eliminarPunto;
