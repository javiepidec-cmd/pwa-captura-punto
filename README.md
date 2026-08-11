# Prototipo PWA — Captura de Puntos

App instalable para captura offline de puntos GPS en operativos de campo,
con detección automática de departamento y municipio.

## Estructura

```
prototipo-pwa/
├── index.html      # UI y estilos
├── app.js          # Lógica (GPS, Turf.js, IndexedDB, sync)
├── sw.js           # Service Worker (cache offline)
├── manifest.json   # Metadatos para instalación PWA
└── icon.svg        # Ícono de la app
```

## Cómo probarlo

### Opción 1: GitHub Pages (recomendado)
1. Subí la carpeta completa a tu repo `javiepidec-cmd.github.io`
2. Andá desde el celular a la URL correspondiente
3. Chrome/Android: aparece "Agregar a pantalla de inicio"
4. Safari/iOS: botón compartir → "Agregar a pantalla de inicio"

### Opción 2: Local para desarrollo
```bash
cd prototipo-pwa
python3 -m http.server 8000
# Abrir http://localhost:8000
```
Los Service Workers **requieren HTTPS** salvo en `localhost`.

## Qué hace hoy

1. **Captura GPS** con `navigator.geolocation` (funciona sin internet).
2. **Detecta depto/municipio** con Turf.js contra polígonos incluidos
   (Capital, San Luis del Palmar y Paso de la Patria como demo).
3. **Guarda cada punto en IndexedDB** con un UUID único (evita duplicados
   en el servidor si hay reintentos).
4. **Muestra mapa Leaflet** cuando hay señal (opcional — captura funciona igual sin mapa).
5. **Cola de pendientes** con indicador de estado
   (🟡 pendiente / 🟢 sincronizado / 🔴 error).
6. **Sincronización automática** al recuperar conexión (evento `online`).
7. **Instalable** como app en el escritorio del celular.

## Qué hay que cambiar antes de producción

### 1. Polígonos reales de Corrientes
En `app.js`, la constante `POLIGONOS` tiene 3 rectángulos simplificados.
Reemplazá por tus KMLs reales:

```javascript
// En vez del FeatureCollection hardcoded:
const POLIGONOS = parseMunisKML(MUNI_B64); // función que ya usás en mapa_editor_v20
```

Asegurate de que cada feature tenga `properties.depto` y `properties.muni`
para que la detección devuelva los nombres correctos.

### 2. Endpoint de Apps Script
En `app.js`, línea 66-67, `CONFIG.endpointSync` y `CONFIG.secret` son placeholders.
Actualmente el sync está en **modo demo** (simula éxito tras 500ms) —
buscá el bloque comentado en la función `sincronizar()` y descomentalo cuando
el endpoint esté listo.

Endpoint sugerido en Apps Script:

```javascript
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return json({ ok: false, error: "auth" });

  if (body.action === "insert_punto") {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("PUNTOS");
    // Verificar duplicado por UUID antes de insertar
    const uuids = sheet.getRange("A2:A").getValues().flat();
    if (uuids.includes(body.data.uuid)) return json({ ok: true, dup: true });

    sheet.appendRow([
      body.data.uuid, body.data.fecha, body.data.tipo,
      body.data.lat, body.data.lng, body.data.precision,
      body.data.depto, body.data.muni,
      body.data.descripcion, body.data.observaciones
    ]);
    return json({ ok: true });
  }
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o))
  .setMimeType(ContentService.MimeType.JSON); }
```

### 3. Íconos de mejor calidad
El SVG actual sirve para el prototipo. Para producción conviene generar PNG
en 192x192 y 512x512 con [pwabuilder.com](https://www.pwabuilder.com/imageGenerator)
y actualizar `manifest.json`.

### 4. Datos del operario
Falta agregar login o al menos captura del nombre/establecimiento del operario
(como en `mapa_rendicion`, que los saca de la hoja USUARIOS). Se podría
guardar en `localStorage` la primera vez.

## Arquitectura offline — cómo funciona

**Al primer ingreso con conexión:**
- Service Worker cachea HTML, JS, CSS, Leaflet, Turf.js y la tipografía.
- Los polígonos ya están en el JS bundleado → disponibles sin red.

**Sin conexión:**
- La app se abre desde el ícono del escritorio (SW sirve todo desde cache).
- GPS funciona (es hardware del teléfono, no depende de red).
- Cada punto se guarda en IndexedDB con estado `pendiente`.
- Los tiles del mapa que ya fueron cargados están cacheados; el resto queda gris.

**Al volver a tener conexión:**
- Evento `online` dispara `sincronizar()` automáticamente.
- Cada punto pendiente se envía al Apps Script con su UUID.
- El servidor verifica UUID antes de insertar (evita duplicados si el
  operario dispara sync varias veces).
- El estado local pasa a `sincronizado`.

## Limitaciones conocidas

- **iOS Safari**: no soporta Background Sync API — la sync corre solo cuando
  la app está abierta. Para producción, considerar mostrar un indicador
  claro de "N pendientes" para que el operario abra la app al recuperar señal.
- **Cache de tiles OSM**: solo funciona offline para zonas que el operario
  ya visitó con conexión. Para cobertura offline total, considerar bundlear
  tiles precomputados o usar una capa vectorial ligera.
- **IndexedDB no tiene límite formal** pero navegadores pueden limpiar
  storage si el usuario no ha abierto la PWA en mucho tiempo. Mitigación:
  llamar a `navigator.storage.persist()` en el primer uso.

## Siguientes pasos sugeridos

1. Probarlo en un celular real, con GPS + modo avión, en cielo abierto y bajo techo.
2. Cargar los KMLs reales de Corrientes.
3. Diseñar el Apps Script + hoja destino con esquema definitivo de columnas.
4. Definir campos del formulario según el operativo real (¿es solo dengue?
   ¿va a servir para vacunas también? — quizás un selector de operativo).
5. Agregar login mínimo (operario/establecimiento).
6. Publicar y hacer prueba piloto con 1-2 operarios.
