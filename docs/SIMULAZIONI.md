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
La prova usa una cartella a parte (`data-sandbox/`), **pagamenti simulati**, email non spedite, password admin `admin` e dati fiscali finti: non usa nulla di ciò che hai in `.env`. Il terminale stampa gli indirizzi, i partner d'esempio (password `prova-prova-1`), un codice sconto (`PROVA10`) e un buono regalo.

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
   - **Listino dedicato**: per ogni tour puoi scrivere il **prezzo che paga questo partner**; se lo lasci vuoto vale la tariffa B2B meno lo sconto. La colonna «Applicato» mostra cosa vedrà il partner.
   - **Politica di annullo**: fino a 3 scaglioni «fino a N giorni/ore prima → rimborso X%» (per esempio 7 giorni 100%, 3 giorni 50%); dopo l'ultimo non si rimborsa nulla. I pulsanti «Modelli» compilano i casi più comuni e sotto vedi un esempio con le date. Vuoto = politica standard del sito (72 ore).
4. **Il partner prenota.** Accede da `/it/b2b/login` (la registrazione apre già la sessione), apre un tour: vede **«Tariffa partner»** con lo sconto applicato; nel riepilogo trova le **sue** condizioni di annullo (gli scaglioni, con le date). Sceglie fattura o carta; con la carta il pagamento è simulato.
5. **Controlli tu.** In **Admin → Prenotazioni** la prenotazione compare come «B2B», con la scadenza di cancellazione («scaduta» se è già passata).

## 3. Provare le scadenze di rimborso

Non si può far scorrere il tempo: le scadenze si provano scegliendo la **data del servizio** e le **ore** giuste. Il termine è «inizio del servizio meno N ore».

| Per provare… | Fai così |
|---|---|
| Annullo **con rimborso totale** | Partner con «7 giorni 100%» → prenota un tour fra 12 giorni → annulla subito: rimborso totale (se pagato con carta) o nessuna penale (se a fattura) |
| Annullo **in uno scaglione parziale** | Stesso partner con «3 giorni 50%» → prenota fra 5 giorni: la pagina della prenotazione dice «annullando ora ricevi il 50%»; annulla: rimborso parziale (carta) oppure **penale** del 50% (fattura) |
| Annullo **oltre l'ultimo scaglione** | Prenota fra 2 giorni: rimborso 0%; online non si può annullare (il cliente deve scriverti); dal pannello annulli tu e la **penale è l'intero importo** |
| La penale in fattura | **Admin → Fatture → Da fatturare**: la penale compare come «Penale di annullo» (da incassare se il partner pagava a fattura; già incassata se aveva pagato con carta) |
| Politica standard dei privati | Cliente privato (48 ore, `B2C_FREE_CANCEL_HOURS`) → prenota fra 6 giorni (rimborsabile) e fra 2 giorni (non rimborsabile) |
| Decidi tu | **Admin → Prenotazioni → la prenotazione → Annulla prenotazione**: *Secondo la politica* (con l'anteprima di rimborso/penale), *Nessuna penale / rimborso totale* oppure *Penale totale / nessun rimborso* |

Per annullare **come lo vede il cliente**: nella scheda della prenotazione, riga **«Pagina del cliente → Apri come la vede il cliente»**. Poi controlla lo stato in Admin: la prenotazione risulta *Annullata* e il pagamento *Rimborsato* oppure no. (Il preavviso minimo per prenotare è 24 ore per i privati e 12 per i partner.)

## 4. Altre simulazioni utili

- **Cliente privato in spagnolo/inglese**: cambia lingua dal menu in alto e prenota; email e voucher PDF escono nella lingua scelta.
- **Codice sconto e buono regalo**: nel checkout inserisci `PROVA10` e il codice del buono (stampato all'avvio di `npm run sandbox`); in **Admin → Sconti** li crei e li gestisci.
- **Programma di più giorni**: `/it/programs` → richiesta; in **Admin → Programmi** prepari la proposta (giornate, prezzi, acconto); il cliente la apre dal link nell'email (la vedi in Admin → Email), la accetta e paga l'acconto (simulato).
- **Richiesta di recensione**: parte il giorno dopo il tour alle 10:00; la sandbox ha già una prenotazione svolta, quindi la email compare subito in Admin → Email.
- **Fatture**: **Admin → Fatture → Da fatturare**: la sandbox ha già delle voci pronte (prenotazioni pagate o già svolte, il buono regalo; due servizi sono già passati, uno pagato con carta e uno a fattura). Scegli le voci, crei la bozza, emetti, scarichi XML e PDF, provi la nota di credito.

## 5. Cosa le prove non coprono

- **Pagamenti veri**: con le chiavi *test* di Stripe (`sk_test_…`) vedi la vera pagina di pagamento, con le carte di prova di Stripe, Apple Pay/Google Pay/PayPal se li attivi in modalità test.
- **Email vere**: per provarle imposta `SMTP_*` con un tuo indirizzo di prova.
- **SdI**: le fatture di prova non vanno mai inviate (hanno dati finti).
