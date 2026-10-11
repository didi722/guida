# Guida Venezia — sito di prenotazione

Sito web per una guida turistica abilitata a Venezia: **tour a piccoli gruppi**, **servizi privati**, **area B2B per DMC e tour operator**, **blog** e **Chi sono**, in **italiano e inglese**, pensato prima di tutto per il telefono. Lo stile riprende [davidetomio.it](https://davidetomio.it) (Josefin Sans, oro e bronzo, header traslucido, dark mode).

> ⚠️ **Prima bozza.** Tour, prezzi, testi e illustrazioni sono **segnaposto** da rivedere (vedi la [checklist prima del lancio](#checklist-prima-del-lancio)).

## Cosa fa

**Per i clienti (B2C)**
- Scelgono il tour e vedono un **calendario con le date libere** e gli orari, oppure partono dalla data e vedono tutto ciò che è disponibile quel giorno (`/it/book`).
- Prenotano senza registrarsi e scelgono se **pagare ora con carta** (Stripe) o **il giorno del tour**.
- Ricevono email di conferma con **punto d'incontro, file calendario (.ics) e link per gestire/annullare**; voucher stampabile.
- **Cancellazione gratuita fino a N ore prima** (default 48): oltre il termine il sito non la offre e invita a scriverti. Se avevano pagato con carta, il **rimborso parte da solo**.

**Per agenzie, DMC e tour operator (B2B)**
- Pagina commerciale (`/it/b2b`) e **richiesta di accesso** con dati aziendali (P.IVA, SDI/PEC).
- Tu **approvi** dal pannello e puoi impostare per ogni partner: **sconto extra**, **finestra di cancellazione** (es. 7 giorni) e se può **pagare a fattura**.
- Il partner vede le **tariffe riservate**, prenota gli slot in autonomia (anche per gruppi fino a 25), inserisce il **riferimento pratica**, scarica il **voucher** e vede lo storico.

**Per te (pannello `/admin`, ottimizzato per telefono)**
- **Agenda** dei prossimi 14 giorni, elenco prenotazioni con ricerca, dettaglio con **annullamento e rimborso** (automatico, totale o nessuno).
- **Disponibilità**: orari di lavoro per giorno della settimana, **chiusura di singoli giorni**, orari speciali, **blocchi orari** per impegni esterni.
- **Partner**: approva, rifiuta, sospendi, condizioni dedicate.
- **Feed calendario (.ics)** da aggiungere a Google/Apple Calendar: vedi le prenotazioni accanto ai tuoi impegni.
- Email di avviso a ogni nuova prenotazione, annullamento o richiesta partner.

**Logica pensata per una guida sola**
- Un servizio occupa la fascia oraria **più una pausa** (default 30′): due servizi non si possono sovrapporre.
- I tour a persona con la **stessa partenza si sommano** fino al massimo di partecipanti; i servizi privati **bloccano** la fascia.
- Mentre un cliente paga con carta lo slot è **trattenuto 35 minuti**; se il pagamento non arriva si libera da solo. Se il cliente paga in ritardo e lo slot è già stato preso, **viene rimborsato in automatico** e avvisato.

## Avvio rapido

Serve **Node.js 22.13 o superiore**.

```bash
npm install
cp .env.example .env     # facoltativo in sviluppo
npm start                # http://localhost:3000
```

- Sito: <http://localhost:3000> · Pannello: <http://localhost:3000/admin> (password di sviluppo: `admin`)
- **Senza chiavi Stripe** il pagamento con carta è **simulato** (pagina “Modalità demo”): puoi provare tutto il flusso senza addebiti.
- **Senza SMTP** le email non partono: vengono salvate in `data/outbox/` e stampate in console.
- I dati stanno in `data/guida.sqlite`. Per ripartire da zero: ferma il server e cancella la cartella `data/`.

```bash
npm test                 # 26 test: motore prenotazioni, pagamenti, webhook Stripe, B2B, admin, traduzioni
```

## Dove si cambiano le cose

| Cosa | Dove |
|---|---|
| **Tour e servizi** (testi, prezzi, durata, orari, capienza, lingue) | `content/tours/*.yml` — un file per tour, IT e EN insieme |
| **Articoli del blog** | `content/blog/<slug>.it.md` e `<slug>.en.md` (front matter: titolo, data, tag, tour collegati) |
| **Chi sono, Privacy, Condizioni, Cookie** | `content/pages/*.md` |
| **Testi dell'interfaccia** (bottoni, menu, FAQ…) | `server/strings.json` (`"chiave": ["italiano", "inglese"]`) |
| **Dati dell'attività** (P.IVA, abilitazione, contatti) | variabili in `.env` (vedi `.env.example`) |
| **Regole** (ore di cancellazione, preavviso, pausa tra servizi, pausa pagamento) | variabili in `.env` |
| **Colori e stile** | `public/css/style.css` (variabili in cima al file) |
| **Orari di lavoro, giorni chiusi, blocchi, partner** | pannello `/admin` |

Nel file di un tour: `model: person` = **a persona**, partenze fisse (`times: ["09:30", "14:30"]`); `model: group` = **privato**, prezzo per gruppo, con `flexible: true` il cliente sceglie l'orario ogni 30′. `price` è il prezzo pubblico, `b2bPrice` la tariffa agevolata per i partner. `cancelHours` (facoltativo) sovrascrive la cancellazione gratuita per quel tour. `active: false` nasconde il tour e blocca nuove prenotazioni senza perdere lo storico (non cancellare mai il file di un tour con prenotazioni future).

**Foto:** metti i file in `public/img/` e nel tour aggiungi `image: /img/nome.jpg`. Finché non c'è una foto il sito usa le illustrazioni SVG in `server/art.js`.

## Mettere online il sito

A differenza del blog (che è statico), qui serve un **server** perché le prenotazioni e i pagamenti devono essere sempre aggiornati. Una macchina piccola basta (un VPS da pochi euro al mese, oppure Fly.io / Render / Railway con un **disco persistente**: il database è un file).

1. Configura le variabili d'ambiente (vedi `.env.example`). In produzione sono **obbligatorie** `NODE_ENV=production`, `BASE_URL` (https), `SESSION_SECRET` e `ADMIN_PASSWORD`.
2. Metti il sito dietro **HTTPS** (Caddy, nginx o il proxy della piattaforma).
3. Avvio con Node (`npm ci --omit=dev && npm start`) oppure con Docker (`Dockerfile` incluso, volume su `/data`).
4. **Backup**: copia periodicamente `data/guida.sqlite` (contiene prenotazioni e partner).

### Pagamenti con Stripe
1. Crea un account Stripe (modalità test per provare). Imposta `STRIPE_SECRET_KEY`.
2. In *Developers → Webhooks* aggiungi `https://tuodominio.it/api/stripe/webhook` con gli eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` e copia il segreto in `STRIPE_WEBHOOK_SECRET`.
3. Prova con le carte di test Stripe; poi passa alle chiavi live. I metodi di pagamento (Apple Pay, Google Pay, ecc.) si attivano dalla dashboard Stripe.

### Email
Imposta `SMTP_*` e `MAIL_FROM` con il tuo provider (Brevo, Mailgun, Posteo, Gmail con password per app…). Usa un mittente del tuo dominio e verifica SPF/DKIM, altrimenti le conferme possono finire nello spam.

## Come è fatto

Node 22 + Express, **SQLite** (`node:sqlite`, nessun database da installare), HTML generato dal server con escaping automatico, JavaScript solo dove serve (calendario, menu, tema). Quattro dipendenze: `express`, `nodemailer`, `marked`, `yaml` (+ i font).

```
content/            tour, blog, pagine (modificabili a mano)
public/             css, js, immagini
server/
  availability.js   motore delle disponibilità (puro, testato)
  bookings.js       prenotazioni, prezzi, cancellazioni
  payments.js       Stripe (HTTP diretto) + demo
  services.js       collega DB, pagamenti ed email
  routes/           pagine pubbliche, API/webhook, admin
  views/            template HTML
test/               test automatici (node --test)
```

Sicurezza: password B2B con scrypt, cookie `HttpOnly` + `SameSite=Lax`, controllo dell'origine sui POST, Content-Security-Policy restrittiva, limitazione delle richieste, link prenotazione protetti da token casuale, firma verificata sui webhook Stripe, nessun font o script di terzi (niente Google Fonts).

## Checklist prima del lancio

- [ ] **Dati d'impresa**: `VAT_NUMBER`, `GUIDA_LICENSE`, `LEGAL_ADDRESS`, email e telefono veri (compaiono nel footer, nelle pagine legali e nelle email).
- [ ] **Prezzi e tour**: i valori in `content/tours/*.yml` sono esempi. Controlla anche **lingue offerte**, punti d'incontro e durate.
- [ ] **Testi**: rileggi Chi sono, articoli del blog e FAQ (sono bozze scritte da zero a partire da quanto dici sul blog; vanno riviste e firmate da te, soprattutto i dettagli storici).
- [ ] **Pagine legali** (privacy, condizioni, cookie): sono bozze generiche, **fallo rivedere da commercialista/consulente**. Verifica anche fatturazione e regime fiscale.
- [ ] **Foto vere** (tour, ritratto) al posto delle illustrazioni.
- [ ] **Stripe in modalità live**, webhook configurato, **SMTP** funzionante (fai una prenotazione di prova e un rimborso).
- [ ] **Dominio + HTTPS**, `BASE_URL` corretto.
- [ ] Orari di lavoro e giorni di chiusura inseriti dal pannello `/admin`.

## Idee per i prossimi passi

- Pagamento di un acconto invece dell'intero importo; codici sconto e gift card.
- Recensioni dopo il tour (email automatica il giorno dopo).
- Più guide/collaboratori (oggi il calendario è di una persona sola).
- Importare impegni da Google Calendar per bloccare gli orari in automatico.
- Preventivi per gruppi grandi / programmi di più giorni (modulo dedicato).
- Verifica via email per le prenotazioni “paga sul posto”, contro le prenotazioni fasulle.
- Generazione PDF del voucher e fatturazione elettronica integrata.
