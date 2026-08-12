// =========================================================================
//  POLIGONOS.JS — municipios de Corrientes para detección offline
//
//  Pipeline:
//    MUNI_B64 (base64) → decodeB64() → texto KML XML
//                     → parseMunisKMLtoGeoJSON() → constante POLIGONOS
//
//  La constante POLIGONOS queda disponible globalmente para app.js.
// =========================================================================

// --- 1) PEGAR ACÁ EL STRING BASE64 DEL KML DE MUNICIPIOS -----------------
//     Copiá el contenido de MUNI_B64 del mapa_editor_v20.html y pegalo
//     entre las comillas de abajo. Es un string largo, todo en una sola
//     línea. NO borres las comillas.

const MUNI_B64 = "PEGAR_ACA_EL_STRING_BASE64_COMPLETO";

// -------------------------------------------------------------------------


// --- 2) decodeB64: base64 → texto UTF-8 (misma que mapa_editor_v20) ------
function decodeB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// --- 3) Parser KML → GeoJSON (adaptado del parseMunisKML de v20) ---------
//     Cambios vs original: coords en [lng, lat] (formato GeoJSON) y
//     devuelve FeatureCollection con properties {muni, depto} listas
//     para Turf.booleanPointInPolygon().
function parseMunisKMLtoGeoJSON(kmlText) {
  const features = [];
  const xml = new DOMParser().parseFromString(kmlText, 'text/xml');

  xml.querySelectorAll('Placemark').forEach(pm => {
    let nombre = '', deptName = '';
    pm.querySelectorAll('SimpleData').forEach(sd => {
      const f = sd.getAttribute('name');
      if (f === 'NOMB_MUNI') nombre = sd.textContent.trim();
      else if (f === 'NOMB_DEPT') deptName = sd.textContent.trim();
    });

    pm.querySelectorAll('coordinates').forEach(ce => {
      const raw = ce.textContent.trim();
      const coords = raw.split(/\s+/).filter(Boolean).map(p => {
        const parts = p.split(',');
        return [parseFloat(parts[0]), parseFloat(parts[1])]; // [lng, lat]
      }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));

      if (coords.length < 3) return;

      features.push({
        type: "Feature",
        properties: { muni: nombre, depto: deptName },
        geometry: { type: "Polygon", coordinates: [coords] }
      });
    });
  });

  return { type: "FeatureCollection", features };
}

// --- 4) Ejecutar el pipeline y exponer POLIGONOS globalmente -------------
let POLIGONOS;
try {
  if (MUNI_B64.startsWith("PEGAR_ACA")) {
    console.warn("⚠ poligonos.js: falta pegar el MUNI_B64 real. Usando FeatureCollection vacío.");
    POLIGONOS = { type: "FeatureCollection", features: [] };
  } else {
    const kmlText = decodeB64(MUNI_B64);
    POLIGONOS = parseMunisKMLtoGeoJSON(kmlText);
    console.log(`✓ poligonos.js: ${POLIGONOS.features.length} polígonos de municipios cargados`);
  }
} catch (e) {
  console.error("Error cargando polígonos:", e);
  POLIGONOS = { type: "FeatureCollection", features: [] };
}
