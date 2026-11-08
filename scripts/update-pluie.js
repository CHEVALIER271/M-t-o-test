// Récupère les pluies quotidiennes des pluviomètres Météo-France proches du lieu suivi
// et écrit pluie-stations.js (lu par la page, sans serveur ni problème d'accès entre sites).
// Source : « Données climatologiques de base - quotidiennes », Météo-France, Licence Ouverte (data.gouv.fr).
// Exécuté chaque jour par GitHub Actions (.github/workflows/update-pluie.yml) ; peut aussi se lancer à la main : node scripts/update-pluie.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- Réglages : lieu suivi et départements à consulter ---
const CENTER = { lat: 47.59249, lon: 0.0498, label: 'Genneteil (Maine-et-Loire)' };
const DEPARTMENTS = ['49', '72', '37']; // Genneteil est proche des limites de la Sarthe et de l'Indre-et-Loire
const RADIUS_KM = 40;     // stations gardées autour du lieu
const MAX_STATIONS = 6;
const KEEP_DAYS = 60;     // historique conservé dans le fichier
const BASE = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT';

const R = Math.PI / 180;
const distKm = (a, b) => {
  const h = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

async function loadDepartment(dep) {
  const url = `${BASE}/Q_${dep}_latest-2025-2026_RR-T-Vent.csv.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  const lines = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8').split('\n');
  const head = lines[0].split(';');
  const ix = n => head.indexOf(n);
  for (const col of ['NUM_POSTE', 'NOM_USUEL', 'LAT', 'LON', 'ALTI', 'AAAAMMJJ', 'RR']) {
    if (ix(col) < 0) throw new Error(`Colonne ${col} absente (format du fichier changé ?) : ${url}`);
  }
  const stations = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split(';');
    if (c.length < 8) continue;
    const id = c[ix('NUM_POSTE')];
    let s = stations.get(id);
    if (!s) {
      s = { id, name: c[ix('NOM_USUEL')], lat: Number(c[ix('LAT')]), lon: Number(c[ix('LON')]), alt: Number(c[ix('ALTI')]), days: {} };
      stations.set(id, s);
    }
    const rr = c[ix('RR')];
    if (rr !== '') s.days[c[ix('AAAAMMJJ')]] = Number(rr);
  }
  return [...stations.values()];
}

(async () => {
  const all = [];
  for (const dep of DEPARTMENTS) all.push(...await loadDepartment(dep));
  const near = all.map(s => ({ ...s, distKm: distKm(CENTER, s) }))
    .filter(s => s.distKm <= RADIUS_KM && Object.keys(s.days).length)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, MAX_STATIONS);
  if (!near.length) throw new Error('Aucune station trouvée : fichier non écrit.');

  const lastDay = near.map(s => Object.keys(s.days).sort().pop()).sort().pop();
  const cutoff = new Date(Date.UTC(+lastDay.slice(0, 4), +lastDay.slice(4, 6) - 1, +lastDay.slice(6, 8)));
  cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
  const cut = cutoff.toISOString().slice(0, 10).replace(/-/g, '');

  const out = {
    generated: new Date().toISOString(),
    source: 'Météo-France, Données climatologiques de base - quotidiennes (data.gouv.fr, Licence Ouverte)',
    center: CENTER,
    stations: near.map(s => ({
      id: s.id, name: s.name, lat: s.lat, lon: s.lon, alt: s.alt,
      days: Object.fromEntries(Object.entries(s.days).filter(([d]) => d >= cut))
    }))
  };
  const file = path.join(__dirname, '..', 'pluie-stations.js');
  fs.writeFileSync(file, '// Fichier généré par scripts/update-pluie.js : ne pas modifier à la main.\nwindow.PLUIE_STATIONS = ' + JSON.stringify(out) + ';\n');
  console.log(`OK : ${near.length} stations, dernier jour ${lastDay} -> ${file}`);
  near.forEach(s => console.log(` - ${s.name} (${s.distKm.toFixed(1)} km)`));
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
