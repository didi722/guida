# Guida Venezia — sito di prenotazione

Sito web per una guida turistica abilitata a Venezia: **tour a piccoli gruppi**, **guida privata** (con assistente, tour leader e meet & greet per le agenzie), **programmi di più giorni**, **area B2B per DMC e tour operator**, **buoni regalo**, **blog** e **Chi sono**, in **italiano, inglese, spagnolo e giapponese** (la guida è abilitata in tutte e quattro: lo dice subito la home), pensato prima di tutto per il telefono. Lo stile riprende [davidetomio.it](https://davidetomio.it) (Josefin Sans, oro e bronzo, header traslucido, dark mode).

> 📖 **Come si usa il sito** (tour, prezzi, blog, foto, partner, fatture, statistiche, backup…): [`docs/GUIDA.md`](docs/GUIDA.md), che trovi anche nel pannello in **Aiuto › Guida**.

> ⚠️ **Prima bozza.** Tour, prezzi, testi e illustrazioni sono **segnaposto** da rivedere (vedi la [checklist prima del lancio](#checklist-prima-del-lancio)). Le parti **fiscali e legali** (fatturazione elettronica, buoni regalo, privacy, condizioni) vanno **confermate dal commercialista**.

## Cosa fa

**Per i clienti (B2C)**
- La home propone **due strade**: la **guida privata** e i **tour di gruppo a posti liberi**, due schede pulite (senza elenchi di partenze né prezzi orari) che portano all'elenco dei tour. La pagina *Tour* è divisa nello stesso modo.
- Scelgono il tour, la **lingua del tour** (in un tour condiviso a posti, la lingua del primo che prenota vincola quella partenza: niente gruppi con lingue miste) e vedono un **calendario con le date libere** e gli orari, e il prezzo: è lo **standard di prenotazione dei privati**, da qualsiasi punto del sito (menu, pulsanti «Prenota», `/it/book`, `/it/hourly` rimandano all'elenco o al tour; la ricerca per data resta per le agenzie). Dove si sceglie una data (sito e pannello) c'è un **selettore di date proprio**, più curato di quello del browser (mese con frecce, «Oggi», giorni non disponibili in grigio, a tutta larghezza sul telefono; senza JavaScript resta il campo data standard).
- Nei tour con punto d'incontro «concordato» il cliente scrive al pagamento il suo hotel o un altro punto; se lascia vuoto vale **Campo San Luca** (riportato in pagina, email, voucher, calendario, wallet e avviso alla guida).
- Per la **guida privata** (pagina del tour) scelgono giorno, ora, ore e persone e vedono subito il totale, con festivo, notturno e auricolari (obbligatori da 9 persone) calcolati dal sito.
- Prenotano senza registrarsi e **pagano subito con carta** (Stripe). Il pagamento «il giorno del tour» è **spento di default** (vedi [Pagamento in contanti](#pagamento-in-contanti-il-giorno-del-tour)).
- Possono usare un **codice sconto** e/o un **buono regalo** al checkout, anche in più volte.
- Ricevono email di conferma con **voucher PDF**, punto d'incontro, file calendario (.ics) e link per gestire/annullare. Dalla pagina della prenotazione possono **aggiungerla al wallet del telefono** (Google Wallet e Apple Wallet, se configurati: vedi [Wallet](#wallet-del-telefono)).
- **Cancellazione gratuita fino a N ore prima** (default 48): oltre il termine il sito non la offre. Se avevano pagato con carta, il **rimborso parte da solo**.
- La **sera prima del tour** ricevono un promemoria (orario, punto d'incontro, mappa, come contattarti): meno assenze e meno «dove ci troviamo?».
- Il giorno dopo il tour ricevono **una sola email** con i link per recensire (Google, Tripadvisor) o per lasciare un feedback privato; i commenti che il cliente permette di citare puoi **mostrarli sul sito** (home e pagina del tour, solo con il nome di battesimo), con la media di tutti i voti, **tradotti automaticamente nella lingua di chi guarda** (con *Vedi originale*) se hai una chiave di traduzione.
- Possono **regalare un'esperienza** (`/it/gift`): buono da 20 a 1.000 € (configurabile) con PDF, messaggio e invio programmato al destinatario.
- Per i soggiorni lunghi compilano il **modulo programmi** (`/it/programs`): ricevono una proposta con giornate, prezzo e acconto, la accettano online e pagano l'acconto.

**Per agenzie, DMC e tour operator (B2B)**
- Pagina commerciale (`/it/b2b`) e **richiesta di accesso** con dati aziendali (P.IVA, SDI/PEC).
- Tu **approvi** dal pannello e puoi impostare per ogni partner: **sconto extra**, **finestra di cancellazione** (es. 7 giorni), pagamento **a fattura**.
- La pagina pubblica *Per agenzie* **non mostra le tariffe**: le tariffe a ore (guida, **assistente in loco**, **tour leader**, **meet & greet**) sono riservate e le vede solo l'agenzia approvata, **in cima alla home della sua area**: mezza giornata, giornata intera, ora supplementare, supplemento festivo e auricolari.
- **Login agenzie** (con **«Password dimenticata?»**: collegamento per email, valido un'ora e una volta sola) sempre visibile in alto, accanto a *Prenota*. Dopo il login l'**area riservata è pulita** (niente blog, tour o prezzi al pubblico): la prima pagina (*Panoramica*) ha le **tariffe e le condizioni** dell'agenzia; la pagina *Prenotazioni* ha il **riepilogo**, **elenco** (o **calendario** del mese) **delle prenotazioni** con schede, **ricerca** per cliente o pratica, **filtri per data di partenza e di prenotazione**, **voucher PDF senza prezzi**, **fatture** in PDF, **modifica del nominativo** e delle note, annullo, **CSV** per la contabilità, tariffe e condizioni, **Esci** verso la home pubblica.
- Il partner vede le **tariffe riservate** (lo sconto % si toglie dalle tariffe B2B, arrotondato ai 5 € successivi), cerca la disponibilità tra **tour privati** (predefinito) e **condivisi**, prenota in autonomia (anche gruppi fino a 25), inserisce il **riferimento pratica** e richiede **programmi di più giorni**.
- **Promemoria alle agenzie**: la sera prima del tour, **24 ore prima che finisca la cancellazione gratuita** (una sola volta) e, per le opzioni, prima della scadenza.
- **Date lontane**: se l'agenzia prenota direttamente un servizio fra più di 21 giorni, la cancellazione gratuita dura solo 48 ore (poi rimborso ridotto fino al termine normale): così conviene **opzionare**, che non impegna. Tutto regolabile in Impostazioni › Opzioni per le agenzie.
- **Pacchetti**: un'agenzia prenota **più servizi insieme** (guida, meet & greet, tour leader…) con **una sola opzione, una sola scadenza, un solo pagamento** (anche con carta, in una sessione Stripe sola) **e una sola fattura**. Tutti i servizi o nessuno; un'unica email con un voucher per servizio e un solo calendario; ogni servizio resta una prenotazione normale.
- **Pagamento chiaro delle fatture**: ogni fattura ha uno stato (da pagare entro…, scaduta, pagata) e una **pagina di pagamento** con importo, scadenza, **IBAN, causale** e **«Paga ora con carta»** (link riservato anche nelle email); la guida segna i bonifici arrivati, e le fatture scadute ricevono **solleciti automatici** (1 giorno dopo la scadenza, poi ogni 7, al massimo 3, regolabili).
- **Modifiche e proroghe**: l'agenzia **cambia da sola persone, data od ore** (prezzo ricalcolato; opzione libera, prenotazione a fattura libera nel periodo gratuito e solo in aumento dopo; spostare la data non allunga i termini di annullo) e **chiede una proroga** dell'opzione, che la guida approva (con i giorni che vuole) o rifiuta dal pannello.
- **Opzioni**: l'agenzia può **tenere una data senza pagare** mentre il suo cliente decide; la durata dipende da quanto manca al tour (tabella e limiti modificabili, anche per singolo partner), arriva un promemoria e, se non conferma, la data **si libera da sola**. Nessun addebito automatico: se paga a fattura il servizio si fattura dopo.

**Per te (pannello `/admin`, ottimizzato per telefono)** — quasi tutto si cambia da qui, senza toccare il codice ([guida](docs/GUIDA.md))
- **Agenda**: **calendario** del mese (predefinito) oppure elenco dei prossimi 14 giorni, con prenotazioni, **opzioni**, giornate dei programmi e i **tour presi fuori dal sito** (email, di persona: li aggiungi tu in agenda e quelle ore spariscono dalle disponibilità); elenco prenotazioni con ricerca e **annullamento/rimborso** (a percentuale, con penale per chi paga a fattura). **Esci** riporta alla home del sito.
- **Disponibilità**: orari di lavoro, chiusure, orari speciali, blocchi orari e **calendari collegati** (Google Calendar e simili): gli impegni segnati «Occupato» bloccano da soli gli slot, evitando sovrapposizioni.
- **Programmi**: richieste, costruttore della proposta (giornate, prezzi, acconto, date trattenute), avvisi se una giornata si sovrappone a qualcos'altro, accettazione, acconto, annullo con rimborso.
- **Sito**: **tour** (crea, modifica, nascondi, duplica; testi e domande frequenti in italiano, inglese, spagnolo e giapponese), **listino** con tutti i prezzi in una tabella, **tariffe a ore** (scaglioni, ora extra, supplementi, giorni festivi), **blog** (bozze, copertine, foto nel testo), **pagine** fisse, **testi dell'interfaccia** per lingua, **libreria immagini** (foto di tour, articoli, home, ritratto, anteprima social) e **impostazioni** (contatti, regole di prenotazione e **incassi dal** per la pre-apertura, **opzioni per le agenzie**, buoni regalo, dati fiscali). L'**ordine dei tour** si cambia **trascinandoli**.
- **Partner**: approvazione, **listino dedicato** per ciascuno, **sconto**, pagamento a fattura e **politica di annullo a scaglioni** per ciascuno (rimborsi parziali, penali).
- **Statistiche**: venduto, scontrino medio, incassato e da incassare, annulli, andamento, per tour/partner/canale/pagamento/lingua/giorno, portafoglio futuro, con confronto sul periodo precedente ed esportazione CSV.
- **Fatture**: voci da fatturare, bozze, **fattura elettronica XML (FatturaPA)** con numerazione progressiva, copia PDF, invio al cliente, trasmissione a SdI via PEC, note di credito, registro CSV.
- **Sconti e buoni**: codici sconto (percentuale o fisso, validità, tour, minimo, usi) e buoni regalo (saldo, movimenti, rettifiche, scadenza); **Invita un amico**: per i tour condivisi, ogni invito è un codice sconto univoco (una sola volta, solo per quella partenza).
- **Feedback** ricevuti, **feed calendario (.ics)**, **backup** scaricabile (database, foto, contenuti) e **ripristino dal pannello** (anteprima di ciò che cambia, solo contenuti oppure tutto, copia di sicurezza automatica con «torna indietro»), **guida** e registro delle **email**.
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
npm test                 # ~280 test: motore prenotazioni, pagamenti, Stripe, B2B, sconti e buoni, calendari, programmi, PDF, fatture, traduzioni, contenuti dal pannello, impostazioni, statistiche, backup, guida
```

I test sui contenuti dei PDF usano `pdftotext` (poppler) e si saltano da soli se non c'è; l'XML delle fatture è controllato contro lo schema FatturaPA con `xmllint-wasm` (dipendenza di sviluppo).

## Provare tutto senza rischi

`npm run sandbox` avvia un sito di prova con dati d'esempio (partner, prenotazioni, buoni, programma) su `http://localhost:3200`, separato dai dati veri; oppure un secondo servizio online con pagamenti simulati. Registrazione di un'azienda, approvazione, sconti e scadenze di rimborso dedicate, annulli e fatture, passo per passo: [`docs/SIMULAZIONI.md`](docs/SIMULAZIONI.md). Le email che il sito non può spedire (senza SMTP) si leggono in **Admin → Email**. `npm run sandbox -- --reset` ricomincia da zero **senza cancellare**: i dati di prima restano in `data-sandbox.copia-AAAAMMGG-HHMMSS/` (per tornare indietro basta rinominarla `data-sandbox`).

## Lingue

Il sito è in **italiano, inglese, spagnolo e giapponese** (`/it`, `/en`, `/es`, `/ja`); la lingua si sceglie dal menu in alto e, alla prima visita, dalla lingua del browser. La lingua della prenotazione decide anche lingua di email, voucher PDF e buoni regalo; le notifiche per te restano in italiano.

- Un tour manca di una traduzione spagnola o giapponese? Il sito mostra la versione inglese (il test `test/i18n.test.js` ti avvisa).
- **Giapponese**: nei PDF (voucher, buono regalo, proposta) si usa Noto Sans JP, incorporato solo quando un testo ha kana o ideogrammi (anche il nome di un cliente scritto in giapponese in un voucher inglese o italiano); il file è un sottoinsieme in `server/fonts/` con la sua licenza (OFL) e le istruzioni per rigenerarlo. Il sito usa i caratteri di sistema (nessun font di terzi). Le pagine legali giapponesi sono traduzioni delle bozze: vanno riviste insieme alle altre.
- Per **aggiungere una lingua**: una riga in `server/langs.js`, una colonna in `server/strings.json`, il blocco della lingua nei tour, i file `.xx.md` di blog e pagine, le voci nei dizionari di `server/emails.js` (e, se serve un alfabeto diverso, il font dei PDF in `server/pdf.js`); poi `npm test` indica cosa manca.
- Le **lingue offerte** per ogni tour sono nel campo `languages` di `content/tours/*.yml` (compaiono nella scheda del tour); l'abilitazione per ciascuna lingua va indicata in `GUIDE_LICENSE`.

## Dove si cambiano le cose

**Dal pannello `/admin`** (vale subito, senza pubblicare nulla; tutto spiegato in [`docs/GUIDA.md`](docs/GUIDA.md)):

| Cosa | Dove |
|---|---|
| **Tour e servizi** (testi, prezzi, durata, orari, capienza, lingue, copertina): due sezioni separate, i tour dei privati e quelli delle agenzie | Sito › Tour B2C · Sito › Tour B2B |
| **Prezzi** (tour B2C: prezzo al pubblico; tour B2B: tariffa agenzie) | Sito › Listino; prezzi per singolo partner: Clienti › Partner |
| **Tariffe a ore** (guida, assistente, tour leader, meet & greet; supplementi; giorni festivi) | Sito › Tariffe a ore |
| **Articoli del blog**, **pagine** (Chi sono, privacy, condizioni, cookie) | Sito › Blog, Sito › Pagine |
| **Testi dell'interfaccia** (home, pulsanti, domande frequenti…) | Sito › Testi |
| **Foto** (copertine, home, ritratto, anteprima social, foto negli articoli) | Sito › Immagini |
| **Dati dell'attività** (contatti, P.IVA, abilitazione), **regole** (cancellazione, preavviso, pause…), **buoni regalo e recensioni**, **dati fiscali** | Sito › Impostazioni |
| Orari di lavoro, chiusure, blocchi, calendari | Agenda › Disponibilità |
| Partner, sconti, programmi, fatture, statistiche, backup | Clienti, Agenda, Conti, Aiuto |

**Dalla configurazione del server** (variabili d'ambiente, vedi `.env.example`): password del pannello, chiavi di Stripe, posta in uscita (SMTP), PEC per SdI, indirizzo del sito, cartella dei dati. Le variabili che corrispondono ai campi di *Impostazioni* (contatti, regole, dati fiscali…) fanno da **valori predefiniti**: se un campo è cambiato dal pannello vince il pannello.

**Nel codice**: i colori e lo stile (`public/css/style.css`, variabili in cima), le illustrazioni di riserva (`server/art.js`), i testi delle email automatiche (`server/emails.js`) e tutto ciò che è «come funziona».

**I file di `content/`** (tour in `content/tours/*.yml`, articoli in `content/blog/`, pagine in `content/pages/`) sono solo il **contenuto iniziale**: vengono importati nel database **una volta**, la prima volta che il sito parte con un database vuoto. Dopo, si lavora dal pannello e modificarli non cambia più nulla. Il database (`data/guida.sqlite`) e le foto (`data/media/`) vanno quindi su un **disco persistente** e nel **backup**.

Nel contenuto iniziale di un tour: `model: person` = **a persona**, partenze fisse (`times: ["09:30", "14:30"]`); `model: group` = **privato**, prezzo per gruppo, con `flexible: true` il cliente sceglie l'orario ogni 30′. `price` è il prezzo, `audience: b2c|b2b` dice a chi è rivolto (un tour è dei privati **oppure** delle agenzie, con un solo prezzo; senza `audience`, un file con `b2bPrice` diventa un tour B2C più la copia B2B «…-agenzie» con quella tariffa), `cancelHours` (facoltativo) la cancellazione gratuita di quel tour. I servizi **a ore** hanno invece `pricing: hourly` e `service: guide|assistant|leader|meetgreet` (e niente `price`): il prezzo viene dalle tariffe a ore. `audience: b2b` li riserva alle agenzie (usano le tariffe «Agenzie»), `chooseHours: true` lascia scegliere la durata.

## Pagamento in contanti il giorno del tour

Di default **non è offerto**: per un tour prenotato online nel 2026 conviene incassare subito. Con una guida sola uno slot non pagato che salta (no show, prenotazione fasulla) è un'ora di lavoro persa; i turisti si aspettano di pagare con carta o telefono; e anche incassando in contanti serve comunque emettere il documento fiscale, mentre per le carte i professionisti hanno l'obbligo di accettare il POS. Se vuoi tenerlo (per esempio per i clienti locali), imposta `ALLOW_PAY_ON_SITE=true` e abilitalo solo sui tour dove ha senso con `payOnSite: true`. Per le agenzie resta il pagamento **a fattura** con bonifico.

## Prima della Partita IVA: prenotare senza incassare

Impostando **Incassi dal** (in **Sito › Impostazioni › Regole di prenotazione**, o con `PAYMENTS_FROM=2027-01-04`) il sito entra in **pre-apertura** fino a quel giorno: accetta prenotazioni **solo per le date da quel giorno in poi** e **non incassa online** (niente carta, buoni regalo e acconti sospesi). I privati prenotano e **pagano di persona il giorno del servizio**; le agenzie prenotano a **fattura** o con **opzione**. Quando la data arriva, i pagamenti online si accendono da soli e chi aveva prenotato può anche **pagare in anticipo** dalla pagina della sua prenotazione. È una funzione tecnica, non un parere fiscale: cosa si può fare prima dell'apertura va confermato dal commercialista.

## Calendario: una guida sola

Il motore di disponibilità ragiona su **una sola persona**: un servizio occupa la fascia e le pause, i blocchi e gli impegni del calendario collegato la tolgono a tutti. Va bene finché lavori da solo. Se un giorno arriveranno collaboratori servirà un «guida» per ogni prenotazione, orari e calendari per guida e un'assegnazione dei servizi: il modello (disponibilità, blocchi, calendari esterni) è già separato per farlo senza rifare il resto.

### Collegare Google Calendar
Nel pannello: **Disponibilità → Calendari collegati**. Su Google Calendar apri *Impostazioni → il tuo calendario → Integra calendario* e copia l'**«Indirizzo segreto in formato iCal»**. Il sito lo rilegge ogni 10 minuti (e prima di ogni conferma) e blocca gli orari degli eventi «Occupato»; ignora quelli segnati «Libero» e quelli annullati; gli eventi di tutta la giornata bloccano il giorno. Se la lettura fallisce a lungo, il pannello ti avvisa. In senso inverso (prenotazioni → Google) usa il **feed .ics** della home del pannello come calendario in abbonamento (si aggiorna con i tempi di Google, anche qualche ora).

## Fatturazione elettronica

I dati fiscali si inseriscono dal pannello (**Sito › Impostazioni › Fatturazione elettronica**; le variabili `INVOICE_*`, `FISCAL_CODE`, `VAT_NUMBER` valgono come valori predefiniti, le credenziali della PEC restano nella configurazione del server).

Dal pannello **Fatture**: tutte le prenotazioni pagate o già svolte, i buoni regalo venduti e i programmi conclusi finiscono in una lista «da fatturare» (con il termine consigliato di 12 giorni). Scegli le voci, rivedi l'intestatario e le righe, emetti: il sito assegna il **numero progressivo dell'anno** (`1/2027`…, senza buchi e in ordine di data) e genera il file **XML FatturaPA** (formato FPR12) più una **copia di cortesia PDF** da mandare al cliente. Gestisce clienti italiani (azienda, privato con codice fiscale), esteri, regime forfettario o ordinario, bollo virtuale, rivalsa INPS e ritenuta, note di credito e riemissione dopo uno scarto di SdI.

La trasmissione può essere:
- **manuale**: scarichi l'XML e lo carichi su «Fatture e Corrispettivi» dell'Agenzia delle Entrate (gratis); oppure
- **da qui via PEC**: imposta `PEC_SMTP_*` e il pulsante «Invia a SdI via PEC» manda il file a SdI. Gli esiti (consegnata, scartata…) arrivano alla tua casella PEC: li registri a mano nella scheda della fattura.

**Importante — da far confermare al commercialista prima della prima fattura:**
- regime, natura IVA, bollo, rivalsa INPS e ritenuta d'acconto;
- se per i **clienti privati** (in particolare i turisti stranieri) basta il documento commerciale o serve sempre la fattura, e come comportarsi con i clienti esteri senza codice fiscale (il sito usa `0000000` e il codice destinatario `XXXXXXX`);
- il trattamento dei **buoni regalo**: monouso (fattura alla vendita, predefinito) o multiuso (all'utilizzo);
- la **prima data fatturabile** (es. `2027-01-01`): senza, ogni prenotazione passata finisce in «Da fatturare»; con la data impostata si fattura solo da lì in poi;
- i prezzi del sito comprendono l'IVA? (impostazione per privati e per partner, conta solo se applichi l'IVA).

I limiti di questa versione: non legge in automatico le ricevute di SdI, non conserva a norma (conservazione sostitutiva: la offre gratuitamente l'Agenzia delle Entrate o il tuo intermediario) e non è stata provata su un account reale di SdI: l'XML è controllato contro lo schema ufficiale, ma i controlli di merito li fa solo SdI.

## Mettere online il sito

A differenza del blog (che è statico), qui serve un **server** perché le prenotazioni e i pagamenti devono essere sempre aggiornati. Una macchina piccola basta (un VPS da pochi euro al mese, oppure Fly.io / Render / Railway con un **disco persistente**: il database è un file).

1. Configura le variabili d'ambiente (vedi `.env.example`). In produzione sono **obbligatorie** `NODE_ENV=production`, `BASE_URL` (https), `SESSION_SECRET` e `ADMIN_PASSWORD`.
2. Metti il sito dietro **HTTPS** (Caddy, nginx o il proxy della piattaforma).
3. Avvio con Node (`npm ci --omit=dev && npm start`) oppure con Docker (`Dockerfile` incluso, volume su `/data`).
4. **Disco persistente e backup**: la cartella dei dati (`DATA_DIR`, nel Docker `/data`) contiene il database (prenotazioni, clienti, partner, fatture, **tour, articoli, pagine, testi, impostazioni**) e le **foto** (`media/`): deve sopravvivere ai riavvii e agli aggiornamenti. Dal pannello, **Aiuto › Backup** scarica uno zip con tutto e lo **ripristina** (con anteprima, conferma e copia di sicurezza automatica); a mano, le istruzioni sono nello zip e nella guida. Se davanti al sito c'è un proxy (nginx, Cloudflare…) controlla che accetti caricamenti grandi come lo zip, altrimenti il ripristino dal pannello non sale e resta quello a mano.

### Pagamenti con Stripe
1. Crea un account Stripe (modalità test per provare). Imposta `STRIPE_SECRET_KEY`.
2. In *Developers → Webhooks* aggiungi `https://tuodominio.it/api/stripe/webhook` con gli eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` e copia il segreto in `STRIPE_WEBHOOK_SECRET`.
3. Prova con le carte di test Stripe; poi passa alle chiavi live. Lo stesso meccanismo incassa prenotazioni, buoni regalo e acconti dei programmi.

#### Apple Pay, Google Pay, PayPal e altri metodi
Il sito manda il cliente sulla pagina di pagamento **ospitata da Stripe** e non fissa l'elenco dei metodi: **quelli che attivi nella dashboard Stripe compaiono da soli**, senza toccare il codice (il test `metodi di pagamento` in `test/http.test.js` impedisce di aggiungere per sbaglio un elenco fisso).
- **Apple Pay e Google Pay**: sulla pagina ospitata da Stripe funzionano senza configurazioni aggiuntive; compaiono ai clienti che hanno una carta nel portafoglio del telefono o del browser. Controlla in *Impostazioni → Metodi di pagamento* che siano attivi.
- **PayPal**: si attiva dalla stessa pagina della dashboard (*Impostazioni → Metodi di pagamento → PayPal*) e va collegato un conto PayPal. È disponibile per le attività con sede in Italia; verifica nella dashboard le condizioni e le commissioni aggiornate.
- **Altri** (Klarna, Link, bonifici istantanei…): stessa pagina. Scegli metodi **con conferma immediata**: quelli con conferma in giorni (addebito SEPA, bonifici) lasciano lo slot occupato in attesa del pagamento; il sito li gestisce (conferma all'arrivo dei soldi, rimborso se nel frattempo lo slot è andato) ma per i tour conviene evitarli.
- **Rimborsi**: partono sempre dal sito (annullo del cliente o dal pannello) e tornano sul metodo usato per pagare.
- Tutti gli importi sono in euro, come richiesto da PayPal e da molti altri metodi.

### Email
Imposta `SMTP_*` e `MAIL_FROM` con il tuo provider (Brevo, Resend, Mailgun, la casella del tuo hosting…). Usa un mittente del tuo dominio e verifica SPF/DKIM, altrimenti le conferme possono finire nello spam. **Posteo non permette di usare un dominio proprio** (solo indirizzi `@posteo.net` e simili): va bene come casella dove **ricevere le notifiche** (`NOTIFY_EMAIL`), ad esempio con l'inoltro gratuito di `tours@tuodominio.it` verso Posteo presso il registrar; per **inviare** con il tuo dominio come mittente serve un servizio di posta che lo supporti.

### Recensioni
Imposta il link «scrivi una recensione» del tuo Profilo dell'attività su Google (e, se vuoi, quello di Tripadvisor) in **Sito › Impostazioni › Buoni regalo, programmi e recensioni** (o con `REVIEW_URL` / `REVIEW_URL_TRIPADVISOR` come valori predefiniti). La richiesta parte da sola il giorno dopo il tour alle 10:00, una sola volta, e non filtra mai i clienti: tutti vedono i link pubblici (le regole di Google vietano di indirizzare solo chi è soddisfatto).

#### Traduzione automatica dei commenti
Con `TRANSLATE_PROVIDER=deepl` (o `google`) e `TRANSLATE_API_KEY`, i commenti che hai scelto di mostrare sul sito vengono tradotti **in background** nelle quattro lingue e salvati nel database (una traduzione per commento e lingua, che si rifà se il cliente cambia il testo): chi guarda il sito legge il commento nella sua lingua, con *Tradotto automaticamente* e il pulsante **Vedi originale**. Si traducono **solo** i commenti pubblici e scelti (mai il feedback privato). DeepL ha un piano gratuito (500.000 caratteri al mese); le chiavi `…:fx` usano l'indirizzo del piano gratuito. Se il servizio non risponde (o la quota è finita) il sito fa una pausa e intanto mostra l'originale. Senza chiave il modulo è spento. I testi dei commenti pubblici vengono inviati al servizio scelto: citalo nella privacy.

### Wallet del telefono
Nella pagina di una prenotazione **confermata** di un cliente **privato** compaiono **Aggiungi a Google Wallet** e **Aggiungi ad Apple Wallet** (solo per le piattaforme configurate). Nessun servizio esterno viene chiamato dal sito: il link di Google contiene il pass firmato (JWT RS256) con la chiave del tuo account di servizio; il file `.pkpass` di Apple lo costruisce il sito (zip con manifest e firma PKCS#7) con il tuo certificato Pass Type ID. Il pass è una fotografia della prenotazione (non si aggiorna se poi la annulli); il logo è quello del sito, disegnato dal codice.
- **Google Wallet** (gratuito): `GOOGLE_WALLET_ISSUER_ID` e `GOOGLE_WALLET_KEY_FILE` (il JSON del service account), oppure `GOOGLE_WALLET_SERVICE_ACCOUNT` + `GOOGLE_WALLET_PRIVATE_KEY`. In modalità prova solo i tester aggiunti nella Wallet Console possono salvare il pass; per aprirlo a tutti serve l'accesso alla pubblicazione.
- **Apple Wallet** (Apple Developer Program, 99 $/anno): `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_CERT_FILE`, `APPLE_WALLET_KEY_FILE` (PEM, con `APPLE_WALLET_KEY_PASSPHRASE` se protetta) e `APPLE_WALLET_WWDR_FILE` (certificato intermedio Apple). Il certificato dura un anno: alla scadenza il pulsante sparisce.
- I passaggi, con i comandi `openssl` per convertire i certificati, sono nella [guida](docs/GUIDA.md#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello). All'avvio il sito scrive nei log un `[wallet] … non attivo: …` se una piattaforma è configurata a metà.

## Come è fatto

Node 22 + Express, **SQLite** (`node:sqlite`, nessun database da installare), HTML generato dal server con escaping automatico, JavaScript solo dove serve. Dipendenze: `express`, `nodemailer`, `marked`, `yaml`, `ical.js` (calendari), `pdfkit` (PDF) e il font (`@fontsource/josefin-sans`). In sviluppo, `xmllint-wasm` per validare le fatture.

```
content/            contenuto iniziale (tour, blog, pagine): importato una volta nel database
docs/               guida d'uso (GUIDA.md, anche nel pannello) e simulazioni
public/             css, js, immagini
scripts/            sandbox con dati d'esempio
server/
  availability.js   motore delle disponibilità (puro, testato)
  bookings.js       prenotazioni, prezzi, cancellazioni a scaglioni (policy.js)
  pricing.js        codici sconto, buoni regalo, prezzi dedicati ai partner
  rates.js          tariffe a ore: scaglioni, ora extra, supplementi, giorni festivi (puro, testato)
  programs.js       programmi di più giorni
  calendars.js      calendari collegati (iCal)
  content.js        lettura e controllo di tour, articoli e pagine
  contentStore.js   contenuti nel database (modificabili dal pannello)
  media.js          libreria immagini; siteImages.js: foto delle pagine principali
  settings.js       impostazioni del pannello (sovrascrivono la configurazione)
  stats.js          statistiche e KPI (funzioni pure, testate)
  backup.js         copia di sicurezza (zip)
  restore.js        ripristino da una copia (controllo, anteprima, sostituzione dei dati in una transazione, copie di sicurezza)
  zipread.js        lettura sicura di uno zip caricato
  optionPolicy.js   opzioni delle agenzie: durata, limiti, promemoria (puro, testato)
  changes.js        modifiche dell'agenzia (persone, data, ore) e richieste di proroga: regole e database (testato)
  changeServices.js modifiche e proroghe: email e avvisi alla guida
  packages.js       pacchetti di più servizi: carrello, prenotazione «tutti o nessuno», opzione unica, conferma e rilascio (solo database, testato)
  packageServices.js pacchetti: pagamento con carta (un solo `PT-…`), email e avvisi alla guida
  opening.js        pre-apertura: «Incassi dal» (puro)
  partner.js        area agenzie: elenco con filtri, riepilogo, fatture dell'agenzia
  translate.js      traduzione automatica dei commenti (DeepL / Google), con cache nel database
  wallet.js         Google Wallet (JWT) e Apple Wallet (.pkpass con firma PKCS#7); png.js: il logo come PNG
  invoices.js       coda, bozze, emissione e note di credito
  invoicePayments.js pagamento delle fatture: stato, scadenza, IBAN e causale, incasso, solleciti (testato)
  invoiceServices.js fatture: invio, incasso, pagamento con carta (`IN-…`) e solleciti
  fatturapa.js      importi e XML FatturaPA (puro)
  pdf.js            voucher, buoni regalo, proposte (e pdf-invoice.js)
  payments.js       Stripe (HTTP diretto) + demo
  routes/           pagine pubbliche, API/webhook, admin
  views/            template HTML
test/               test automatici (node --test)
```

Sicurezza: password B2B con scrypt, cookie `HttpOnly` + `SameSite=Lax`, controllo dell'origine sui POST, Content-Security-Policy restrittiva (niente script né stili in linea), limitazione delle richieste, link riservati con token casuale, firma verificata sui webhook Stripe, nessun font o script di terzi.

## Checklist prima del lancio

Passo per passo, con i percorsi del pannello, nella [guida](docs/GUIDA.md#20-da-fare-prima-del-lancio-e-a-gennaio). In sintesi:

- [ ] **Dati d'impresa** (Sito › Impostazioni › Attività e contatti): Partita IVA, abilitazione, indirizzo, email e telefono veri (compaiono nel footer, nelle pagine legali, nelle email e sui PDF).
- [ ] **Dati fiscali per le fatture** (Sito › Impostazioni › Fatturazione) **confermati dal commercialista**; non emettere una fattura «di prova» su SdI (consumerebbe il numero 1/2027): chiedi al commercialista come verificare il file prima dell'avvio.
- [ ] **Tour e prezzi veri** (Sito › Tour B2C, Tour B2B e Listino): quelli iniziali sono esempi. Controlla anche lingue, punti d'incontro e durate.
- [ ] **Tariffe a ore** (Sito › Tariffe a ore): le cifre iniziali sono un punto di partenza; **confermale col commercialista** (regime forfettario, contributi, rivalsa).
- [ ] **Testi**: rileggi Chi sono, articoli del blog e domande frequenti (sono bozze da rivedere e firmare, soprattutto i dettagli storici).
- [ ] **Pagine legali** (privacy, condizioni, cookie): sono bozze, **falle rivedere da commercialista/consulente**. In particolare buoni regalo (validità, recesso), acconti dei programmi, recensioni, conservazione delle fatture.
- [ ] **Foto vere** (tour, ritratto, home, anteprima social) al posto delle illustrazioni (Sito › Immagini).
- [ ] **Stripe in modalità live**, webhook configurato, **SMTP** funzionante (fai una prenotazione di prova e un rimborso).
- [ ] **Google Business Profile** con link di recensione (Impostazioni › Buoni regalo, programmi e recensioni); calendario personale collegato (Agenda › Disponibilità).
- [ ] **Dominio + HTTPS**, `BASE_URL` corretto, **disco persistente** per `DATA_DIR`, primo **backup** (Aiuto › Backup).
- [ ] Orari di lavoro e giorni di chiusura inseriti dal pannello `/admin`.

## Idee per i prossimi passi

- Più guide/collaboratori (oggi il calendario è di una persona sola).
- Scrittura diretta su Google Calendar (oggi: lettura via indirizzo segreto iCal e feed .ics in abbonamento) con l'API di Google.
- Lettura automatica delle ricevute di SdI dalla PEC e invio a un intermediario/API (Aruba, Fatture in Cloud…).
- Verifica via email per eventuali prenotazioni «paga sul posto», contro le prenotazioni fasulle.
- Pagamento di un acconto anche sui servizi singoli.
