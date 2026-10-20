# Provare il sito senza rischi

Qui trovi come simulare i casi veri (un'azienda che si registra, tu che la approvi e le dai condizioni dedicate, prenotazioni, annulli e rimborsi) **senza toccare i dati veri**.

## 1. Dove fare le prove

Non fare le prove sul sito vero: prenotazioni e partner di prova resterebbero nel database vero (non c'è un tasto per cancellarli). Hai due strade.

### A. Sul tuo computer (la più rapida)
```bash
npm install            # solo la prima volta
npm run sandbox        # sito di prova su http://localhost:3200, con dati d'esempio
npm run sandbox -- --reset   # cancella tutto e ricomincia
```
La prova usa una cartella a parte (`data-sandbox/`), **pagamenti simulati**, email non spedite, password admin `admin` e dati fiscali finti: non usa nulla di ciò che hai in `.env`. Il terminale stampa gli indirizzi, i partner d'esempio (password `prova-prova-1`), un codice sconto (`PROVA10`) e un buono regalo. La prova include anche uno **storico di circa 65 prenotazioni dei mesi scorsi** (tra privati e partner, con qualche annullo, rimborso e penale): serve a dare dati alle **Statistiche**.

### B. Online, come servizio di prova
Crea sulla tua piattaforma **un secondo servizio** dallo stesso repository (branch `main`) con le sue variabili:

| Variabile | Valore |
|---|---|
| `NODE_ENV` | `production` |
| `BASE_URL` | l'indirizzo https del servizio di prova |
| `SESSION_SECRET` | una stringa lunga a caso (diversa da quella vera) |
| `ADMIN_PASSWORD` | la password che vuoi per il pannello di prova |
| `ALLOW_DEMO_PAYMENTS` | `true` |
| `SITE_NAME` (facoltativa) | ad es. `Davide Tomio (prova)` |

**Non** impostare `STRIPE_SECRET_KEY` né `SMTP_*`: i pagamenti restano simulati e le email non partono. Il sito mostra una fascia «Sito di prova», non si fa indicizzare e le email si leggono in **Admin → Email**.
Per provare anche le **fatture** aggiungi dati fiscali finti: `VAT_NUMBER=IT12345678903`, `FISCAL_CODE=RSSMRA80A01H501U`, `INVOICE_FIRST_NAME=Mario`, `INVOICE_LAST_NAME=Rossi`, `INVOICE_ADDRESS=Calle del Test 1`, `INVOICE_ZIP=30100`, `INVOICE_CITY=Venezia`, `INVOICE_PROVINCE=VE`.

## 2. Simulare un'azienda partner, passo per passo

1. **L'azienda si registra.** Apri `/it/b2b/register` (da «Per agenzie»), compila il modulo con dati inventati (per un'azienda italiana servono P.IVA e codice SDI o PEC) e scegli una password di almeno 10 caratteri.
2. **Tu ricevi la richiesta.** In **Admin → Email** compaiono «Nuova richiesta partner» (per te) e «Richiesta di accesso partner ricevuta» (per l'azienda). In **Admin → Partner** l'azienda è «Da approvare».
3. **Approvi e imposti le condizioni dedicate.** Apri l'azienda; la scheda ha tre blocchi:
   - **Stato e pagamento**: *Approvato*; **sconto su tutto il listino (%)**; se può pagare a fattura/bonifico o solo con carta. Salva: all'azienda parte «Il tuo account partner è attivo» (la leggi in Admin → Email).
   - **Listino dedicato**: per ogni **tour B2B** puoi scrivere il **prezzo che paga questo partner**; se lo lasci vuoto vale la tariffa del tour, meno lo sconto del partner se c'è. La colonna «Applicato» mostra cosa vedrà il partner.
   - **Politica di annullo**: fino a 3 scaglioni «fino a N giorni/ore prima → rimborso X%» (per esempio 7 giorni 100%, 3 giorni 50%); dopo l'ultimo non si rimborsa nulla. I pulsanti «Modelli» compilano i casi più comuni e sotto vedi un esempio con le date. Vuoto = politica standard del sito (72 ore).
4. **Il partner prenota.** Accede da `/it/b2b/login` (la registrazione apre già la sessione), apre un tour B2B (le agenzie vedono solo quelli): vede **«Tariffa partner»** con lo sconto applicato; nel riepilogo trova le **sue** condizioni di annullo (gli scaglioni, con le date). Sceglie fattura o carta; con la carta il pagamento è simulato.
5. **Controlli tu.** In **Admin → Prenotazioni** la prenotazione compare come «B2B», con la scadenza di cancellazione («scaduta» se è già passata).

## 3. Provare le scadenze di rimborso

Non si può far scorrere il tempo: le scadenze si provano scegliendo la **data del servizio** e le **ore** giuste. Il termine è «inizio del servizio meno N ore».

| Per provare… | Fai così |
|---|---|
| Annullo **con rimborso totale** | Partner con «7 giorni 100%» → prenota un tour fra 12 giorni → annulla subito: rimborso totale (se pagato con carta) o nessuna penale (se a fattura) |
| Annullo **in uno scaglione parziale** | Stesso partner con «3 giorni 50%» → prenota fra 5 giorni: la pagina della prenotazione dice «annullando ora ricevi il 50%»; annulla: rimborso parziale (carta) oppure **penale** del 50% (fattura) |
| Annullo **oltre l'ultimo scaglione** | Prenota fra 2 giorni: rimborso 0%; online non si può annullare (il cliente deve scriverti); dal pannello annulli tu e la **penale è l'intero importo** |
| La penale in fattura | **Admin → Fatture → Da fatturare**: la penale compare come «Penale di annullo» (da incassare se il partner pagava a fattura; già incassata se aveva pagato con carta) |
| Politica standard dei privati | Cliente privato (48 ore: si cambia in **Sito › Impostazioni › Regole di prenotazione**) → prenota fra 6 giorni (rimborsabile) e fra 2 giorni (non rimborsabile) |
| Decidi tu | **Admin → Prenotazioni → la prenotazione → Annulla prenotazione**: *Secondo la politica* (con l'anteprima di rimborso/penale), *Nessuna penale / rimborso totale* oppure *Penale totale / nessun rimborso* |

Per annullare **come lo vede il cliente**: nella scheda della prenotazione, riga **«Pagina del cliente → Apri come la vede il cliente»**. Poi controlla lo stato in Admin: la prenotazione risulta *Annullata* e il pagamento *Rimborsato* oppure no. (Il preavviso minimo per prenotare è 24 ore per i privati e 12 per i partner.)

## 4. Provare le opzioni e l'area dell'agenzia

La prova ha già tre agenzie (`giulia@lagoon-dmc.example` con fattura e sconto del 15%, `luca@bluesail.example` solo carta, e `elena@serenissima-travel.example`, appena iscritta e **al suo primo accesso**; password di tutte `prova-prova-1`); le prime due hanno prenotazioni e **due opzioni aperte**.

1. **L'area pulita.** Entra con **Login agenzie** (in alto, accanto a *Prenota*): vedi riepilogo, schede, ricerca e filtri per data, e solo le voci di lavoro nella barra. **Esci** riporta alla home del sito. Prova la ricerca per un nome di pratica (*Gruppo Rossi*) o per codice, le schede *Opzioni* e *Passate*, **Scarica l'elenco (CSV)**, **Tariffe e condizioni** e **Fatture** (le fatture compaiono dopo che le emetti da **Admin → Fatture**).
2. **Cambiare il nominativo.** Apri una pratica → **Nominativo e note** → cambia il nome e **Salva**: in **Admin → Email** vedi l'avviso alla guida («Prenotazione modificata»).
3. **Opzionare.** Da agenzia: *Nuova prenotazione* → scegli un tour **fra più di 3 giorni** → al pagamento tocca **Opziona senza pagare**. Nell'**Agenda** (Calendario) compare tratteggiata; in **Agenda › Prenotazioni › Opzioni** la trovi con la scadenza (10 giorni per un tour fra 40 giorni, 3 per uno fra 8). In **Admin → Email**: l'email all'agenzia («Opzione registrata») e l'avviso alla guida.
4. **Confermare o rilasciare.** Dalla pratica dell'agenzia: **Conferma la prenotazione** (scegli *Fattura / bonifico*: subito confermata, arrivano voucher e riepilogo) oppure **Rilascia la data** (la data torna libera, nessuna penale). Dal pannello: **Prolunga la scadenza** e **Rilascia la data**.
5. **La scadenza.** Il sito controlla ogni minuto: per vedere una scadenza vera scegli un'opzione che scade presto (in **Impostazioni › Opzioni per le agenzie** metti una riga come *tour fra 3 giorni → opzione di 1 giorno*) e riprova il giorno dopo; l'agenzia riceve il promemoria 24 ore prima e, a scadenza, l'email «Opzione scaduta»; la data torna prenotabile da chiunque.
6. **Opzioni diverse per un'agenzia.** **Clienti › Partner › Opzioni**: durata fissa (7 giorni), numero massimo di opzioni, oppure spente per quell'agenzia (nel checkout non compare più il pulsante).
7. **Prima della Partita IVA.** **Sito › Impostazioni › Regole di prenotazione › Incassi dal** → una data futura (per esempio fra 30 giorni): il sito diventa «pre-apertura». Da privato: si prenotano solo date da quel giorno, il pagamento è *di persona*; da agenzia: *fattura* o opzione; l'Agenda mostra l'avviso azzurro. Svuota il campo per tornare come prima.

## 5. Altre simulazioni utili

- **Il primo accesso di un'agenzia (tutorial e FAQ)**: entra come `elena@serenissima-travel.example` (*Serenissima Travel*): è approvata e **non ha ancora visto il giro**, quindi sulla prima pagina si apre da sola la finestra di benvenuto. Premi *Inizia il giro* e clicca dove il riquadro indica (*Nuova prenotazione* → una data e *Vedi disponibilità* → un orario → prova i numeri di adulti e bambini → *Avanti* nei passi informativi → *Fatture*): il giro è interattivo e non crea prenotazioni. Prova anche *Esci dal giro* (o Esc) a metà strada, poi ricarica: non torna. Se la tua sandbox è di prima di questa funzione, l'agenzia viene aggiunta al riavvio. Rivedilo da **Guida e FAQ** (pulsante nella *Panoramica*, voce nel piè di pagina) e leggi le domande frequenti; cambia lingua dal menu per vederle in inglese, spagnolo e giapponese. Con Lagoon DMC o Blue Sail Tours la finestra non compare (l'hanno già visto). Per ricominciare: `npm run sandbox -- --reset`.
- **Bambini e infanti**: la prova ha già due famiglie (*Marco Esposito*, privato, e *Famiglia Conti* di Lagoon DMC): in **Admin → Prenotazioni** guarda «5 persone (2 adulti, 2 bambini, 1 infante)» e il conto (bambini a metà prezzo, infante gratis). Dal sito, su un tour condiviso, scegli 2 adulti, 1 bambino e 1 infante: nel pagamento il conto si divide per età e la conferma lo scrive. In **Agenda › Scheda del giorno** compare la composizione.
- **Riordinare la lista d'attesa**: accedi come Blue Sail Tours e come Serenissima Travel (due finestre private), apri **Date libere**, scegli Cannaregio fra 40 giorni (tenuta in opzione da Lagoon DMC) e premi **Avvisami se si libera** con tutte e due; in **Admin → Agenda › Lista d'attesa** trascina la seconda sopra la prima (o usa le frecce ▲ ▼); poi in **Prenotazioni › Opzioni** rilascia l'opzione di Lagoon: l'email *Si è liberata* (in **Admin → Email**) arriva per prima a quella che hai fatto avanzare.
- **Condizioni di annullo di un periodo**: in **Sito › Periodi** scrivi un periodo (per esempio le prossime due settimane) con una riga di annullo per i privati e una per le agenzie; apri il pagamento di un tour di quelle date e guarda le righe e la nota.
- **Telefono e paese**: nel modulo di registrazione del partner prova a cercare *Giappone* o *Germania* nell'elenco dei paesi e nel prefisso del telefono, e a incollare un numero con `+81…` o `0039…`: sceglie da solo il prefisso.

- **Cliente privato in spagnolo/inglese**: cambia lingua dal menu in alto e prenota; email e voucher PDF escono nella lingua scelta.
- **Codice sconto e buono regalo**: nel checkout inserisci `PROVA10` e il codice del buono (stampato all'avvio di `npm run sandbox`); in **Admin → Sconti** li crei e li gestisci.
- **Traduzione dei commenti**: senza chiave non fa nulla. Per provarla senza spendere imposta una chiave DeepL gratuita (`TRANSLATE_PROVIDER=deepl`, `TRANSLATE_API_KEY=…:fx`), scegli un commento in **Clienti › Feedback › Mostra sul sito** e, dopo un minuto, guarda la home in un'altra lingua: compare la traduzione con **Vedi originale**.
- **Wallet**: i pulsanti compaiono sulla pagina di una prenotazione confermata di un cliente privato solo se hai configurato Google o Apple Wallet (vedi la [guida](GUIDA.md#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)); con credenziali di prova vedi i link e scarichi il file `.pkpass`, ma per **aprirlo davvero** servono quelle vere.
- **Programma di più giorni**: `/it/programs` → richiesta; in **Admin → Programmi** prepari la proposta (giornate, prezzi, acconto); il cliente la apre dal link nell'email (la vedi in Admin → Email), la accetta e paga l'acconto (simulato).
- **Richiesta di recensione**: parte il giorno dopo il tour alle 10:00; la sandbox ha già una prenotazione svolta, quindi la email compare subito in Admin → Email.
- **Fatture**: **Admin → Fatture → Da fatturare**: la sandbox ha già delle voci pronte (prenotazioni pagate o già svolte, il buono regalo; due servizi sono già passati, uno pagato con carta e uno a fattura). Scegli le voci, crei la bozza, emetti, scarichi XML e PDF, provi la nota di credito.

## 6. Provare la gestione del sito dal pannello

Tutto questo è nel pannello della prova (`/admin`, password `admin`) e, come sul sito vero, **vale subito**:

- **Tour e prezzi**: **Sito › Tour B2C** → *Duplica* un tour, cambia titolo e prezzo, salva e guarda `/it/tours`; in **Sito › Tour B2B** ci sono i tour delle agenzie (*Duplica come tour B2B* ne crea uno a partire da un tour B2C); **Sito › Listino** per cambiare più prezzi insieme (vale per le nuove prenotazioni).
- **Un'agenzia con prezzi suoi**: la scheda del partner → *Listino dedicato* (vedi la sezione 2).
- **Foto**: **Sito › Immagini** → carica una foto dal telefono o dal computer, poi usala come copertina di un tour o come foto della home (*Usa qui*); l'anteprima social si controlla guardando il sorgente della pagina (`og:image`).
- **Blog**: **Sito › Blog › Nuovo articolo**, prova i pulsanti *Grassetto / Titolo / Foto* e *Anteprima*; lascia *Pubblicato* spento per vedere una bozza.
- **Impostazioni**: **Sito › Impostazioni** → cambia il WhatsApp o il telefono e guarda la pagina **Contatti** e il piè di pagina; prova a scrivere un valore sbagliato (un'email non valida) per vedere la validazione; *Ripristina i valori predefiniti* annulla.
- **Statistiche**: **Conti › Statistiche**, con lo storico della prova: cambia periodo, filtra un partner o un tour, scarica il CSV.
- **Backup**: **Aiuto › Backup** → scarica lo zip e aprilo (dentro: database, foto, `contenuti.json`, istruzioni).
- La guida completa è in **Aiuto › Guida** (la stessa di [`docs/GUIDA.md`](GUIDA.md)).

## 7. Cosa le prove non coprono

- **Pagamenti veri**: con le chiavi *test* di Stripe (`sk_test_…`) vedi la vera pagina di pagamento, con le carte di prova di Stripe, Apple Pay/Google Pay/PayPal se li attivi in modalità test.
- **Email vere**: per provarle imposta `SMTP_*` con un tuo indirizzo di prova.
- **SdI**: le fatture di prova non vanno mai inviate (hanno dati finti).
