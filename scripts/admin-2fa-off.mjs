// Spegne l'accesso a due passaggi del pannello dal terminale del server: serve solo se si perdono il telefono E i codici di emergenza.
//
//   npm run admin:2fa-off                          (sul server, nella cartella del sito)
//   docker exec <contenitore> npm run admin:2fa-off  (con Docker)
//
// Usa gli stessi dati del sito (DATA_DIR, SESSION_SECRET…). Chiude anche tutte le sessioni aperte del pannello:
// dopo si entra con la sola password e si riattivano i due passaggi da Aiuto › Sicurezza.
import { createAdminSecurity } from '../server/adminSecurity.js';
import { createConfig } from '../server/config.js';
import { openDb } from '../server/db.js';

const cfg = createConfig();
const db = openDb(cfg.dbFile);
try {
  const security = createAdminSecurity({ cfg, db });
  if (!security.enabled()) {
    console.log('I due passaggi non erano attivi: non ho cambiato nulla.');
  } else {
    security.reset();
    console.log('Fatto: i due passaggi sono spenti e le sessioni del pannello sono chiuse. Entra con la sola password e riattivali da Aiuto › Sicurezza.');
  }
} finally {
  db.close();
}
