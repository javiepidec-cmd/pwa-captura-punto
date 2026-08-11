// =========================================================================
//  PROTOTIPO PWA — CAPTURA DE PUNTOS
//  - Vanilla JS + Leaflet + Turf.js
//  - IndexedDB para persistencia offline
//  - Service Worker para cache de assets
// =========================================================================

// ---------- 1. POLÍGONOS DE EJEMPLO ----------
// SIMPLIFICADO — reemplazar con parseDeptsKML(DEPT_B64) y parseMunisKML(MUNI_B64)
// que ya usás en mapa_editor_v20.html. Cada feature debe tener properties.depto
// y properties.muni para que la detección devuelva los nombres correctos.
const POLIGONOS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { depto: "CAPITAL", muni: "CORRIENTES" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-58.92, -27.42], [-58.72, -27.42],
          [-58.72, -27.56], [-58.92, -27.56],
          [-58.92, -27.42]
        ]]
      }
    },
    {
      type: "Feature",
      properties: { depto: "SAN LUIS DEL PALMAR", muni: "SAN LUIS DEL PALMAR" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-58.65, -27.45], [-58.45, -27.45],
          [-58.45, -27.60], [-58.65, -27.60],
          [-58.65, -27.45]
        ]]
      }
    },
    {
      type: "Feature",
      properties: { depto: "SAN COSME", muni: "PASO DE LA PATRIA" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-58.65, -27.28], [-58.45, -27.28],
          [-58.45, -27.42], [-58.65, -27.42],
          [-58.65, -27.28]
        ]]
      }
    }
  ]
};

// ---------- 2. CONFIGURACIÓN ----------
const CONFIG = {
  // TODO: cambiar por tu endpoint real de Apps Script cuando exista una BD dedicada
  endpointSync: "https://script.google.com/macros/s/COLOCAR_TU_ENDPOINT_AQUI/exec",
  secret: "COLOCAR_TU_SECRETO_AQUI",
  dbName: "capturaPuntosPWA",
  dbVersion: 1,
  storeName: "puntos",
  timeoutGps: 30000
};

// ---------- 3. ESTADO ----------
let db = null;
let mapa = null;
let marcador = null;
let ultimoFix = null; // { lat, lng, precision, depto, muni }

// ---------- 4. INICIALIZACIÓN ----------
document.addEventListener("DOMContentLoaded", async () => {
  await abrirDB();
  registrarSW();
  wireUI();
  actualizarEstadoConexion();
  await renderizarLista();

  // Sincronización automática al recuperar conexión
  window.addEventListener("online", () => {
    actualizarEstadoConexion();
    toast("Conexión recuperada — sincronizando...");
    sincronizar();
  });
  window.addEventListener("offline", actualizarEstadoConexion);
});

// ---------- 5. INDEXED DB ----------
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

// ---------- 6. CAPTURA DE GPS ----------
function capturarUbicacion() {
  const btn = document.getElementById("btnUbicacion");
  const estadoBox = document.getElementById("estadoGps");
  const txtEstado = document.getElementById("txtEstado");

  if (!navigator.geolocation) {
    toast("Este dispositivo no soporta geolocalización");
    return;
  }

  btn.disabled = true;
  btn.textContent = "📡 Buscando satélites...";
  estadoBox.classList.remove("hidden");
  txtEstado.textContent = "Buscando señal GPS (puede tardar hasta 30s la primera vez)...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy: prec } = pos.coords;
      procesarFix(lat, lng, prec);
      btn.disabled = false;
      btn.textContent = "📡 Capturar de nuevo";
    },
    (err) => {
      btn.disabled = false;
      btn.textContent = "📡 Capturar mi ubicación";
      let msg = "Error de GPS: ";
      if (err.code === 1) msg += "permiso denegado";
      else if (err.code === 2) msg += "posición no disponible";
      else if (err.code === 3) msg += "tiempo de espera agotado";
      else msg += err.message;
      toast(msg);
      txtEstado.textContent = msg;
    },
    {
      enableHighAccuracy: true,
      timeout: CONFIG.timeoutGps,
      maximumAge: 0
    }
  );
}

function procesarFix(lat, lng, precision) {
  // Mostrar coordenadas
  const coordBox = document.getElementById("coordBox");
  coordBox.classList.remove("hidden");
  document.getElementById("txtLat").textContent = lat.toFixed(6);
  document.getElementById("txtLng").textContent = lng.toFixed(6);

  const precTxt = precision.toFixed(1) + " m";
  const precEl = document.getElementById("txtPrec");
  precEl.textContent = precTxt;
  precEl.className = precision < 10 ? "precision-ok"
                    : precision < 30 ? "precision-warn"
                    : "precision-mala";

  // Detectar depto/muni
  const detectado = detectarUbicacion(lat, lng);
  const detectBox = document.getElementById("ubicacionDetectada");
  detectBox.classList.remove("hidden", "fuera-corrientes");

  if (detectado) {
    detectBox.innerHTML = `
      <div><strong>Departamento:</strong> ${detectado.depto}</div>
      <div><strong>Municipio:</strong> ${detectado.muni}</div>
    `;
    ultimoFix = { lat, lng, precision, ...detectado };
    document.getElementById("formulario").classList.remove("hidden");
  } else {
    detectBox.classList.add("fuera-corrientes");
    detectBox.innerHTML = `
      <div><strong>⚠ Punto fuera de la cobertura de polígonos cargados.</strong></div>
      <div style="font-size: 13px; margin-top: 4px;">
        Se guardará sin depto/municipio automático.
      </div>
    `;
    ultimoFix = { lat, lng, precision, depto: null, muni: null };
    document.getElementById("formulario").classList.remove("hidden");
  }

  document.getElementById("estadoGps").classList.add("hidden");
  mostrarMapa(lat, lng);
}

function detectarUbicacion(lat, lng) {
  const punto = turf.point([lng, lat]); // OJO: Turf usa [lng, lat]
  for (const feat of POLIGONOS.features) {
    if (turf.booleanPointInPolygon(punto, feat)) {
      return { depto: feat.properties.depto, muni: feat.properties.muni };
    }
  }
  return null;
}

// ---------- 7. MAPA (opcional, solo si hay conexión o tiles cacheados) ----------
function mostrarMapa(lat, lng) {
  const div = document.getElementById("mapa");
  div.classList.remove("hidden");

  if (!mapa) {
    mapa = L.map("mapa", { zoomControl: false }).setView([lat, lng], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OSM"
    }).addTo(mapa);
  } else {
    mapa.setView([lat, lng], 16);
  }

  if (marcador) mapa.removeLayer(marcador);
  marcador = L.circleMarker([lat, lng], {
    radius: 8, color: "#1F4A8B", fillColor: "#1F4A8B", fillOpacity: 0.8
  }).addTo(mapa);
  setTimeout(() => mapa.invalidateSize(), 100);
}

// ---------- 8. GUARDAR EN COLA ----------
async function guardarPunto() {
  if (!ultimoFix) { toast("Primero capturá una ubicación"); return; }

  const punto = {
    uuid: crypto.randomUUID(), // Evita duplicados en el servidor
    lat: ultimoFix.lat,
    lng: ultimoFix.lng,
    precision: ultimoFix.precision,
    depto: ultimoFix.depto,
    muni: ultimoFix.muni,
    tipo: document.getElementById("tipoRegistro").value,
    descripcion: document.getElementById("descripcion").value.trim(),
    observaciones: document.getElementById("observaciones").value.trim(),
    fecha: new Date().toISOString(),
    estado: "pendiente" // pendiente | sincronizado | error
  };

  await guardarEnDB(punto);
  toast("Punto guardado localmente ✓");

  // Limpiar formulario
  document.getElementById("descripcion").value = "";
  document.getElementById("observaciones").value = "";
  document.getElementById("formulario").classList.add("hidden");
  document.getElementById("coordBox").classList.add("hidden");
  document.getElementById("ubicacionDetectada").classList.add("hidden");
  document.getElementById("mapa").classList.add("hidden");
  ultimoFix = null;

  await renderizarLista();

  // Intento inmediato de sincronizar si hay conexión
  if (navigator.onLine) sincronizar();
}

// ---------- 9. SINCRONIZACIÓN ----------
async function sincronizar() {
  if (!navigator.onLine) {
    toast("Sin conexión — se sincroniza cuando haya red");
    return;
  }

  const puntos = await listarPuntos();
  const pendientes = puntos.filter(p => p.estado === "pendiente" || p.estado === "error");

  if (pendientes.length === 0) {
    toast("Nada para sincronizar");
    return;
  }

  toast(`Sincronizando ${pendientes.length} punto(s)...`);

  for (const p of pendientes) {
    try {
      // Simulación de envío — descomentar el fetch real cuando esté el endpoint
      /*
      const res = await fetch(CONFIG.endpointSync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "insert_punto",
          secret: CONFIG.secret,
          data: p
        })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error del servidor");
      */

      // === MODO DEMO: simula éxito tras 500ms ===
      await new Promise(r => setTimeout(r, 500));

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

// ---------- 10. UI: LISTA DE PUNTOS ----------
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
    const ubi = p.muni ? `${p.muni}` : "sin ubicación";
    return `
      <li>
        <div>
          <span class="status-dot ${dotClass}"></span>
          <strong>${p.tipo}</strong> — ${ubi}<br>
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

// ---------- 11. UTILIDADES ----------
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
  document.getElementById("btnUbicacion").addEventListener("click", capturarUbicacion);
  document.getElementById("btnGuardar").addEventListener("click", guardarPunto);
  document.getElementById("btnSincronizar").addEventListener("click", sincronizar);
}

// Expuesto globalmente para el onclick inline de eliminar
window.eliminarPunto = eliminarPunto;
