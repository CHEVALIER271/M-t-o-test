// Service worker minimal : permet l'installation de l'appli. Pas de cache hors ligne,
// les prévisions doivent toujours être récupérées en direct.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* le navigateur gère la requête normalement */ });
