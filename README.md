# Guida Venezia — sito di prenotazione

Sito web per una guida turistica abilitata a Venezia: **tour a piccoli gruppi**, **servizi privati**, **programmi di più giorni**, **area B2B per DMC e tour operator**, **buoni regalo**, **blog** e **Chi sono**, in **italiano, inglese e spagnolo**, pensato prima di tutto per il telefono. Lo stile riprende [davidetomio.it](https://davidetomio.it) (Josefin Sans, oro e bronzo, header traslucido, dark mode).

> ⚠️ **Prima bozza.** Tour, prezzi, testi e illustrazioni sono **segnaposto** da rivedere (vedi la [checklist prima del lancio](#checklist-prima-del-lancio)). Le parti **fiscali e legali** (fatturazione elettronica, buoni regalo, privacy, condizioni) vanno **confermate dal commercialista**.

## Cosa fa

**Per i clienti (B2C)**
- Scelgono il tour e vedono un **calendario con le date libere** e gli orari, oppure partono dalla data (`/it/book`).
- Prenotano senza registrarsi e **pagano subito con carta** (Stripe). Il pagamento «il giorno del tour» è **spento di default** (vedi [Pagamento in contanti](#pagamento-in-contanti-il-giorno-del-tour)).
- Possono usare un **codice sconto** e/o un **buono regalo** al checkout, anche in più volte.
- Ricevono email di conferma con **voucher PDF**, punto d'incontro, file calendario (.ics) e link per gestire/annullare.
- **Cancellazione gratuita fino a N ore prima** (default 48): oltre il termine il sito non la offre. Se avevano pagato con carta, il **rimborso parte da solo**.
- Il giorno dopo il tour ricevono **una sola email** con i link per recensire (Google, Tripadvisor) o per lasciare un feedback privato.
- Possono **regalare un'esperienza** (`/it/gift`): buono da 20 a 1.000 € (configurabile) con PDF, messaggio e invio programmato al destinatario.
- Per i soggiorni lunghi compilano il **modulo programmi** (`/it/programs`): ricevono una proposta con giornate, prezzo e acconto, la accettano online e pagano l'acconto.

**Per agenzie, DMC e tour operator (B2B)**
- Pagina commerciale (`/it/b2b`) e **richiesta di accesso** con dati aziendali (P.IVA, SDI/PEC).
- Tu **approvi** dal pannello e puoi impostare per ogni partner: **sconto extra**, **finestra di cancellazione** (es. 7 giorni), pagamento **a fattura**.
- Il partner vede le **tariffe riservate**, prenota in autonomia (anche gruppi fino a 25), inserisce il **riferimento pratica**, scarica il **voucher PDF senza prezzi** (da girare al cliente finale) e richiede **programmi di più giorni**.

**Per te (pannello `/admin`, ottimizzato per telefono)**
- **Agenda** dei prossimi 14 giorni con prenotazioni **e giornate dei programmi**; elenco prenotazioni con ricerca e **annullamento/rimborso**.
- **Disponibilità**: orari di lavoro, chiusure, orari speciali, blocchi orari e **calendari collegati** (Google Calendar e simili): gli impegni segnati «Occupato» bloccano da soli gli slot, evitando sovrapposizioni.
- **Programmi**: richieste, costruttore della proposta (giornate, prezzi, acconto, date trattenute), avvisi se una giornata si sovrappone a qualcos'altro, accettazione, acconto, annullo con rimborso.
- **Fatture**: voci da fatturare, bozze, **fattura elettronica XML (FatturaPA)** con numerazione progressiva, copia PDF, invio al cliente, trasmissione a SdI via PEC, note di credito, registro CSV.
- **Sconti e buoni**: codici sconto (percentuale o fisso, validità, tour, minimo, usi) e buoni regalo (saldo, movimenti, rettifiche, scadenza).
- **Partner**, **Feedback** ricevuti, **feed calendario (.ics)** per vedere le prenotazioni accanto ai tuoi impegni.
- Email di avviso a ogni prenotazione, annullamento, richiesta partner o programma.

**Logica pensata per una guida sola**
- Un servizio occupa la fascia oraria **più una pausa** (default 30′): due servizi non si possono sovrapporre.
- I tour a persona con la **stessa partenza si sommano** fino al massimo; i servizi privati e le giornate dei programmi **bloccano** la fascia.
- Mentre un cliente paga con carta lo slot è **trattenuto 35 minuti**; se il pagamento arriva in ritardo e lo slot è stato preso, **viene rimborsato in automatico**.

## Avvio rapido

Serve **Node.js 22.13 o superiore**.

```bash
npm install
cp .env.example .env     # facoltativo in sviluppo
npm start                # http://localhost:3000
```

- Sito: <http://localhost:3000> · Pannello: <http://localhost:3000/admin> (password di sviluppo: `admin`)
- **Senza chiavi Stripe** il pagamento con carta è **simulato** (pagina «Modalità demo»): puoi provare tutto il flusso senza addebiti.
- **Senza SMTP** le email non partono: vengono salvate in `data/outbox/` e stampate in console.
- I dati stanno in `data/guida.sqlite`. Per ripartire da zero: ferma il server e cancella la cartella `data/`.

```bash
npm test                 # ~110 test: motore prenotazioni, pagamenti, Stripe, B2B, sconti e buoni, calendari, programmi, PDF, fatture, traduzioni
```

I test sui contenuti dei PDF usano `pdftotext` (poppler) e si saltano da soli se non c'è; l'XML delle fatture è controllato contro lo schema FatturaPA con `xmllint-wasm` (dipendenza di sviluppo).

## Lingue

Il sito è in **italiano, inglese e spagnolo** (`/it`, `/en`, `/es`); la lingua si sceglie dal menu in alto e, alla prima visita, dalla lingua del browser. La lingua della prenotazione decide anche lingua di email, voucher PDF e buoni regalo; le notifiche per te restano in italiano.

- Un tour manca di una traduzione spagnola? Il sito mostra la versione inglese (il test `test/i18n.test.js` ti avvisa).
- Per **aggiungere una lingua**: una riga in `server/langs.js`, una colonna in `server/strings.json`, il blocco della lingua nei tour, i file `.xx.md` di blog e pagine, le voci nei dizionari di `server/emails.js`; poi `npm test` indica cosa manca.
- Le **lingue offerte** per ogni tour sono nel campo `languages` di `content/tours/*.yml` (compaiono nella scheda del tour); l'abilitazione per ciascuna lingua va indicata in `GUIDE_LICENSE`.

## Dove si cambiano le cose

| Cosa | Dove |
|---|---|
| **Tour e servizi** (testi, prezzi, durata, orari, capienza, lingue) | `content/tours/*.yml` — un file per tour, con i blocchi `it:`, `en:` ed `es:` |
| **Articoli del blog** | `content/blog/<slug>.it.md`, `<slug>.en.md` e `<slug>.es.md` |
| **Chi sono, Privacy, Condizioni, Cookie** | `content/pages/<nome>.it.md`, `.en.md`, `.es.md` |
| **Testi dell'interfaccia** | `server/strings.json` (`"chiave": ["italiano", "inglese", "spagnolo"]`) |
| **Dati dell'attività** (P.IVA, abilitazione, contatti) | variabili in `.env` (vedi `.env.example`) |
| **Regole** (cancellazione, preavviso, pausa, validità buoni, acconti…) | variabili in `.env` |
| **Dati fiscali per le fatture** | variabili `INVOICE_*`, `FISCAL_CODE`, `PEC_*` in `.env` |
| **Colori e stile** | `public/css/style.css` (variabili in cima al file) |
| **Orari di lavoro, giorni chiusi, blocchi, calendari, partner, sconti, programmi, fatture** | pannello `/admin` |

Nel file di un tour: `model: person` = **a persona**, partenze fisse (`times: ["09:30", "14:30"]`); `model: group` = **privato**, prezzo per gruppo, con `flexible: true` il cliente sceglie l'orario ogni 30′. `price` è il prezzo pubblico, `b2bPrice` la tariffa per i partner. `cancelHours` (facoltativo) sovrascrive la cancellazione gratuita per quel tour. `payOnSite: true` consente il pagamento in loco **se** `ALLOW_PAY_ON_SITE=true`. `active: false` nasconde il tour senza perdere lo storico.

**Foto:** metti i file in `public/img/` e nel tour aggiungi `image: /img/nome.jpg`. Finché non c'è una foto il sito usa le illustrazioni SVG in `server/art.js`.

## Pagamento in contanti il giorno del tour

Di default **non è offerto**: per un tour prenotato online nel 2026 conviene incassare subito. Con una guida sola uno slot non pagato che salta (no show, prenotazione fasulla) è un'ora di lavoro persa; i turisti si aspettano di pagare con carta o telefono; e anche incassando in contanti serve comunque emettere il documento fiscale, mentre per le carte i professionisti hanno l'obbligo di accettare il POS. Se vuoi tenerlo (per esempio per i clienti locali), imposta `ALLOW_PAY_ON_SITE=true` e abilitalo solo sui tour dove ha senso con `payOnSite: true`. Per le agenzie resta il pagamento **a fattura** con bonifico.

## Calendario: una guida sola

Il motore di disponibilità ragiona su **una sola persona**: un servizio occupa la fascia e le pause, i blocchi e gli impegni del calendario collegato la tolgono a tutti. Va bene finché lavori da solo. Se un giorno arriveranno collaboratori servirà un «guida» per ogni prenotazione, orari e calendari per guida e un'assegnazione dei servizi: il modello (disponibilità, blocchi, calendari esterni) è già separato per farlo senza rifare il resto.

### Collegare Google Calendar
Nel pannello: **Disponibilità → Calendari collegati**. Su Google Calendar apri *Impostazioni → il tuo calendario → Integra calendario* e copia l'**«Indirizzo segreto in formato iCal»**. Il sito lo rilegge ogni 10 minuti (e prima di ogni conferma) e blocca gli orari degli eventi «Occupato»; ignora quelli segnati «Libero» e quelli annullati; gli eventi di tutta la giornata bloccano il giorno. Se la lettura fallisce a lungo, il pannello ti avvisa. In senso inverso (prenotazioni → Google) usa il **feed .ics** della home del pannello come calendario in abbonamento (si aggiorna con i tempi di Google, anche qualche ora).

## Fatturazione elettronica

Dal pannello **Fatture**: tutte le prenotazioni pagate o già svolte, i buoni regalo venduti e i programmi conclusi finiscono in una lista «da fatturare» (con il termine consigliato di 12 giorni). Scegli le voci, rivedi l'intestatario e le righe, emetti: il sito assegna il **numero progressivo dell'anno** (`1/2027`…, senza buchi e in ordine di data) e genera il file **XML FatturaPA** (formato FPR12) più una **copia di cortesia PDF** da mandare al cliente. Gestisce clienti italiani (azienda, privato con codice fiscale), esteri, regime forfettario o ordinario, bollo virtuale, rivalsa INPS e ritenuta, note di credito e riemissione dopo uno scarto di SdI.

La trasmissione può essere:
- **manuale**: scarichi l'XML e lo carichi su «Fatture e Corrispettivi» dell'Agenzia delle Entrate (gratis); oppure
- **da qui via PEC**: imposta `PEC_SMTP_*` e il pulsante «Invia a SdI via PEC» manda il file a SdI. Gli esiti (consegnata, scartata…) arrivano alla tua casella PEC: li registri a mano nella scheda della fattura.

**Importante — da far confermare al commercialista prima della prima fattura:**
- regime (`INVOICE_REGIME`), natura IVA, bollo, rivalsa INPS e ritenuta d'acconto;
- se per i **clienti privati** (in particolare i turisti stranieri) basta il documento commerciale o serve sempre la fattura, e come comportarsi con i clienti esteri senza codice fiscale (il sito usa `0000000` e il codice destinatario `XXXXXXX`);
- il trattamento dei **buoni regalo**: monouso (fattura alla vendita, default `INVOICE_GIFT_AT=sale`) o multiuso (all'utilizzo, `redemption`);
- la data di avvio `INVOICE_START_DATE` (es. `2027-01-01`): senza, ogni prenotazione passata finisce in «Da fatturare»; con la data impostata si fattura solo da lì in poi;
- i prezzi del sito comprendono l'IVA? (`INVOICE_PRICES_INCLUDE_VAT_*`, conta solo se applichi l'IVA).

I limiti di questa versione: non legge in automatico le ricevute di SdI, non conserva a norma (conservazione sostitutiva: la offre gratuitamente l'Agenzia delle Entrate o il tuo intermediario) e non è stata provata su un account reale di SdI: l'XML è controllato contro lo schema ufficiale, ma i controlli di merito li fa solo SdI.

## Mettere online il sito

A differenza del blog (che è statico), qui serve un **server** perché le prenotazioni e i pagamenti devono essere sempre aggiornati. Una macchina piccola basta (un VPS da pochi euro al mese, oppure Fly.io / Render / Railway con un **disco persistente**: il database è un file).

1. Configura le variabili d'ambiente (vedi `.env.example`). In produzione sono **obbligatorie** `NODE_ENV=production`, `BASE_URL` (https), `SESSION_SECRET` e `ADMIN_PASSWORD`.
2. Metti il sito dietro **HTTPS** (Caddy, nginx o il proxy della piattaforma).
3. Avvio con Node (`npm ci --omit=dev && npm start`) oppure con Docker (`Dockerfile` incluso, volume su `/data`).
4. **Backup**: copia periodicamente `data/guida.sqlite` (contiene prenotazioni, partner, fatture emesse e XML).

### Pagamenti con Stripe
1. Crea un account Stripe (modalità test per provare). Imposta `STRIPE_SECRET_KEY`.
2. In *Developers → Webhooks* aggiungi `https://tuodominio.it/api/stripe/webhook` con gli eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` e copia il segreto in `STRIPE_WEBHOOK_SECRET`.
3. Prova con le carte di test Stripe; poi passa alle chiavi live. I metodi di pagamento (Apple Pay, Google Pay, ecc.) si attivano dalla dashboard Stripe. Lo stesso meccanismo incassa prenotazioni, buoni regalo e acconti dei programmi.

### Email
Imposta `SMTP_*` e `MAIL_FROM` con il tuo provider (Brevo, Mailgun, Posteo, Gmail con password per app…). Usa un mittente del tuo dominio e verifica SPF/DKIM, altrimenti le conferme possono finire nello spam.

### Recensioni
Imposta `REVIEW_URL` con il link «scrivi una recensione» del tuo Profilo dell'attività su Google (e, se vuoi, `REVIEW_URL_TRIPADVISOR`). La richiesta parte da sola il giorno dopo il tour alle 10:00, una sola volta, e non filtra mai i clienti: tutti vedono i link pubblici (le regole di Google vietano di indirizzare solo chi è soddisfatto).

## Come è fatto

Node 22 + Express, **SQLite** (`node:sqlite`, nessun database da installare), HTML generato dal server con escaping automatico, JavaScript solo dove serve. Dipendenze: `express`, `nodemailer`, `marked`, `yaml`, `ical.js` (calendari), `pdfkit` (PDF) e il font (`@fontsource/josefin-sans`). In sviluppo, `xmllint-wasm` per validare le fatture.

```
content/            tour, blog, pagine (modificabili a mano)
public/             css, js, immagini
server/
  availability.js   motore delle disponibilità (puro, testato)
  bookings.js       prenotazioni, prezzi, cancellazioni
  pricing.js        codici sconto e buoni regalo
  programs.js       programmi di più giorni
  calendars.js      calendari collegati (iCal)
  invoices.js       coda, bozze, emissione e note di credito
  fatturapa.js      importi e XML FatturaPA (puro)
  pdf.js            voucher, buoni regalo, proposte (e pdf-invoice.js)
  payments.js       Stripe (HTTP diretto) + demo
  routes/           pagine pubbliche, API/webhook, admin
  views/            template HTML
test/               test automatici (node --test)
```

Sicurezza: password B2B con scrypt, cookie `HttpOnly` + `SameSite=Lax`, controllo dell'origine sui POST, Content-Security-Policy restrittiva (niente script né stili in linea), limitazione delle richieste, link riservati con token casuale, firma verificata sui webhook Stripe, nessun font o script di terzi.

## Checklist prima del lancio

- [ ] **Dati d'impresa**: `VAT_NUMBER`, `GUIDE_LICENSE`, `LEGAL_ADDRESS`, email e telefono veri (compaiono nel footer, nelle pagine legali, nelle email e sui PDF).
- [ ] **Dati fiscali per le fatture** (`FISCAL_CODE`, `INVOICE_*`) **confermati dal commercialista**; non emettere una fattura «di prova» su SdI (consumerebbe il numero 1/2027): chiedi al commercialista come verificare il file prima dell'avvio.
- [ ] **Prezzi e tour**: i valori in `content/tours/*.yml` sono esempi. Controlla anche lingue, punti d'incontro e durate.
- [ ] **Testi**: rileggi Chi sono, articoli del blog e FAQ (sono bozze da rivedere e firmare, soprattutto i dettagli storici).
- [ ] **Pagine legali** (privacy, condizioni, cookie): sono bozze, **fallo rivedere da commercialista/consulente**. In particolare buoni regalo (validità, recesso), acconti dei programmi, recensioni, conservazione delle fatture.
- [ ] **Foto vere** (tour, ritratto) al posto delle illustrazioni.
- [ ] **Stripe in modalità live**, webhook configurato, **SMTP** funzionante (fai una prenotazione di prova e un rimborso).
- [ ] **Google Business Profile** con link di recensione in `REVIEW_URL`; calendario personale collegato dal pannello.
- [ ] **Dominio + HTTPS**, `BASE_URL` corretto.
- [ ] Orari di lavoro e giorni di chiusura inseriti dal pannello `/admin`.

## Idee per i prossimi passi

- Più guide/collaboratori (oggi il calendario è di una persona sola).
- Scrittura diretta su Google Calendar (oggi: lettura via indirizzo segreto iCal e feed .ics in abbonamento) con l'API di Google.
- Lettura automatica delle ricevute di SdI dalla PEC e invio a un intermediario/API (Aruba, Fatture in Cloud…).
- Verifica via email per eventuali prenotazioni «paga sul posto», contro le prenotazioni fasulle.
- Pagamento di un acconto anche sui servizi singoli.
