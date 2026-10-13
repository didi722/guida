# Guida all'uso del sito

Questa guida è per te, che gestisci il sito: spiega **come fare ogni cosa dal pannello**, passo per passo, senza toccare il codice. È pensata per essere letta anche dal telefono: nel pannello la trovi in **Aiuto › Guida**.

Le indicazioni di percorso si leggono così: **Sito › Tour** vuol dire «tocca *Sito* nel menu in alto, poi la scheda *Tour*».

> **Fisco e testi legali.** Il sito non sostituisce il commercialista: regime, IVA, bollo, ritenuta, trattamento dei buoni regalo e testi di privacy e condizioni vanno **confermati da lui** prima di usarli (vedi [Fatture](#13-fatture) e [Pagine](#7-pagine-chi-sono-privacy-condizioni-cookie)).

## Indice

1. [Come funziona, in cinque righe](#1-come-funziona-in-cinque-righe)
2. [Entrare nel pannello](#2-entrare-nel-pannello)
3. [Voglio… → vado in…](#3-voglio-vado-in)
4. [Ogni giorno: cinque minuti](#4-ogni-giorno-cinque-minuti)
5. [Tour e servizi](#5-tour-e-servizi)
6. [Prezzi, tariffe a ore, sconti e buoni regalo](#6-prezzi-tariffe-a-ore-sconti-e-buoni-regalo)
7. [Pagine: Chi sono, privacy, condizioni, cookie](#7-pagine-chi-sono-privacy-condizioni-cookie)
8. [Blog](#8-blog)
9. [Testi del sito](#9-testi-del-sito)
10. [Immagini](#10-immagini)
11. [Disponibilità, chiusure e calendario](#11-disponibilità-chiusure-e-calendario)
12. [Prenotazioni, annulli e programmi di più giorni](#12-prenotazioni-annulli-e-programmi-di-più-giorni)
13. [Fatture](#13-fatture)
14. [Partner (agenzie, DMC, tour operator)](#14-partner-agenzie-dmc-tour-operator)
15. [Statistiche](#15-statistiche)
16. [Impostazioni](#16-impostazioni)
17. [Backup e ripristino](#17-backup-e-ripristino)
18. [Online, aggiornamenti e cosa non si cambia dal pannello](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)
19. [Quando qualcosa non va](#19-quando-qualcosa-non-va)
20. [Da fare prima del lancio e a gennaio](#20-da-fare-prima-del-lancio-e-a-gennaio)
21. [Appendice: formattare un testo](#21-appendice-formattare-un-testo)

---

## 1. Come funziona, in cinque righe

- **Quasi tutto si cambia dal pannello e vale subito**: tour, prezzi, articoli, pagine, testi, foto, impostazioni. Non c'è nulla da «pubblicare» né da caricare altrove.
- Questi contenuti stanno **nel database del sito, sul server** (la cartella dei dati). Per questo vanno salvati con una [copia di sicurezza](#17-backup-e-ripristino) e la cartella dei dati deve stare su un **disco persistente**.
- I file della cartella `content/` nel codice sono **solo il contenuto iniziale**: vengono importati **una volta**, la prima volta che il sito parte con un database vuoto. Dopo, modificarli non cambia più nulla: si lavora dal pannello.
- Il **codice** (come funziona il sito, per esempio un nuovo tipo di pagina) cambia solo con un aggiornamento fatto da te o da un programmatore: vedi [sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello). Un aggiornamento del codice **non tocca** i tuoi contenuti.
- Le prenotazioni già fatte **conservano le condizioni di quando sono state fatte**: se cambi un prezzo o una regola, valgono per le prenotazioni nuove.

## 2. Entrare nel pannello

1. Apri `https://tuodominio.it/admin` (dal telefono va benissimo: puoi aggiungerlo alla schermata Home).
2. Scrivi la **password del pannello** e tocca **Entra**. Se non riesci a entrare, vai a [Quando qualcosa non va](#19-quando-qualcosa-non-va).
3. Per uscire: **Esci**, in alto a destra.

**Il menu** ha cinque voci; ciascuna ha delle schede sotto il titolo:

| Voce | Schede |
|---|---|
| **Agenda** | Agenda · Prenotazioni · Programmi · Disponibilità |
| **Clienti** | Partner · Sconti · Feedback |
| **Conti** | Fatture · Statistiche |
| **Sito** | Tour · Listino · Tariffe a ore · Blog · Pagine · Testi · Immagini · Impostazioni |
| **Aiuto** | Guida · Backup · Email |

**Cambiare la password del pannello.** La password non si cambia dal pannello (per sicurezza): sta nella configurazione del server, nella variabile `ADMIN_PASSWORD`. Cambiala nel pannello del tuo hosting (sezione *Environment* / *Variables*), scrivila **senza virgolette** e riavvia il servizio. Usa una password lunga e unica.

## 3. Voglio… → vado in…

| Voglio… | Vado in… |
|---|---|
| **Cambiare il prezzo** di un tour a prezzo fisso | **Sito › Listino** |
| Cambiare le **tariffe a ore** (mezza giornata, giornata, ora extra), i **supplementi** (festivo, notturno, auricolari) o i **giorni festivi** | **Sito › Tariffe a ore** |
| Offrire alle agenzie **assistente, tour leader o meet & greet** | **Sito › Tariffe a ore** (le cifre) e **Sito › Tour** (i servizi) |
| **Aggiungere un tour** | **Sito › Tour › Nuovo tour** |
| Cambiare orari, durata, capienza o testi di un tour | **Sito › Tour** › tocca il tour |
| **Nascondere** un tour (pausa, stagione) | **Sito › Tour › Nascondi** |
| **Scrivere un articolo** | **Sito › Blog › Nuovo articolo** |
| Cambiare la **foto** di un tour o di un articolo | nel tour o nell'articolo: **Immagine di copertina** |
| Cambiare la foto della **home**, il **mio ritratto**, l'anteprima sui social | **Sito › Immagini › Immagini del sito** |
| Modificare **Chi sono**, privacy, condizioni, cookie | **Sito › Pagine** |
| Cambiare un **testo** del sito (titolo della home, pulsanti, domande frequenti…) | **Sito › Testi** |
| Cambiare **telefono, WhatsApp, Partita IVA**, indirizzo | **Sito › Impostazioni › Attività e contatti** |
| Cambiare **ore di cancellazione, preavviso**, pausa fra i servizi | **Sito › Impostazioni › Regole di prenotazione** |
| Inserire i **dati per fatturare** | **Sito › Impostazioni › Fatturazione elettronica** |
| **Approvare** un'agenzia, dare **sconti, prezzi e cancellazione** dedicati | **Clienti › Partner** › tocca l'agenzia |
| Creare un **codice sconto** o un **buono regalo** | **Clienti › Sconti** |
| **Chiudere un giorno**, ferie, orari speciali, collegare **Google Calendar** | **Agenda › Disponibilità** |
| **Annullare** una prenotazione, rimborsare, segnare un pagamento incassato | **Agenda › Prenotazioni** › tocca la prenotazione |
| Preparare la **proposta** di un programma di più giorni | **Agenda › Programmi** |
| **Emettere una fattura** | **Conti › Fatture** |
| Vedere **quanto ho incassato**, quale tour rende di più, lo scontrino medio | **Conti › Statistiche** |
| Scaricare una **copia di sicurezza** | **Aiuto › Backup** |
| **Rimettere il sito com'era** in una copia scaricata (o tornare indietro dopo un errore) | **Aiuto › Backup › Ripristina da una copia** |
| Leggere le **email** mandate dal sito | **Aiuto › Email** |

## 4. Ogni giorno: cinque minuti

1. **Agenda** (la prima schermata): in alto vedi quanti servizi hai oggi, i programmi da preparare, i partner da approvare, le **opzioni** aperte e i pagamenti in corso. Sotto c'è l'agenda: si apre come **Calendario** del mese (tocca un giorno per vederlo qui sotto; le opzioni delle agenzie sono tratteggiate) e con **Elenco, 14 giorni** passi all'elenco dei prossimi 14 giorni con tutte le prenotazioni e le giornate dei programmi; il pannello ricorda la tua scelta. Se c'è un avviso rosso (calendario che non si sincronizza, voci da fatturare oltre i 12 giorni) toccalo: ti porta dove risolvere.
2. **Partner da approvare**: se c'è un numero, apri **Clienti › Partner** e rispondi (vedi [sezione 14](#14-partner-agenzie-dmc-tour-operator)). Il partner è avvisato per email.
3. **Programmi da preparare**: richieste di più giorni in attesa di una tua proposta ([sezione 12](#12-prenotazioni-annulli-e-programmi-di-più-giorni)).
4. **Fatture** (una o due volte a settimana): le prenotazioni svolte o pagate finiscono in *Da fatturare*; il termine consigliato per emettere è **12 giorni** ([sezione 13](#13-fatture)).
5. I clienti privati ricevono da soli un **promemoria la sera prima del tour** (alle 18:00, con orario, punto d'incontro, mappa e come contattarti): non devi fare nulla, e si spegne o si sposta in **Sito › Impostazioni › Regole di prenotazione**.
6. Ogni nuova prenotazione, annullo o richiesta ti arriva **per email** all'indirizzo delle notifiche (si cambia in **Sito › Impostazioni › Attività e contatti**). Se le email non arrivano, guarda **Aiuto › Email**: lì il sito elenca quelle che ha tentato di inviare.

**Calendario sul telefono.** In fondo all'Agenda trovi un indirizzo privato da aggiungere come *calendario in abbonamento* a Google Calendar, Apple Calendar o Outlook: vedrai le prenotazioni confermate accanto ai tuoi impegni. Non condividerlo con nessuno.

## 5. Tour e servizi

**Sito › Tour** elenca tutti i tour con prezzo al pubblico, tariffa partner e stato (*visibile* / *nascosto*). Il sito mostra solo quelli visibili.

### Aggiungere un tour nuovo

1. **Sito › Tour › Nuovo tour**. (Per partire da un tour simile apri quello esistente e tocca **Duplica**: ottieni una copia da ritoccare.)
2. **Informazioni generali**
   - **Indirizzo web (slug)**: come compare nell'indirizzo, per esempio `gondola-al-tramonto` → `…/tours/gondola-al-tramonto`. Solo lettere minuscole, numeri e trattini; **dopo la creazione non si cambia**.
   - **Ordine nell'elenco**: numero più basso = più in alto.
   - **Visibile sul sito e prenotabile**: se lo togli il tour sparisce dal sito (le prenotazioni già fatte restano).
   - **In evidenza**: la home ha due schede, *Guida privata a ore* e *Tour di gruppo*; per ciascuna mostra la foto del tour «in evidenza» (se ce ne sono più d'uno, il primo; se nessuno, il primo dell'elenco).
   - **Tipo di servizio**:
     - *Partenze fisse, prezzo a persona*: tour in piccolo gruppo con orari stabiliti (per esempio 09:30 e 14:30). Più clienti possono prenotare la stessa partenza fino alla **capienza massima**.
     - *Servizio privato, prezzo a gruppo*: il cliente prenota tutta la fascia. Con **Orario libero** sceglie lui quando iniziare (ogni 30 minuti, nei tuoi orari di lavoro).
   - **Orari di partenza**: solo per le partenze fisse, separati da virgola: `09:30, 14:30`.
   - **Giorni in cui si svolge**: spunta i giorni della settimana.
   - **Durata** (ore e minuti) e **Persone al massimo**.
3. **Prezzi e regole**
   - **Prezzo**: *Prezzo fisso* (lo scrivi qui sotto) oppure **A ore**, per i servizi privati: il prezzo viene allora da **Sito › Tariffe a ore** ([sezione 6](#6-prezzi-tariffe-a-ore-sconti-e-buoni-regalo)) e non c'è nulla da scrivere in questa scheda.
   - **Prezzo al pubblico**: a persona o a gruppo, secondo il tipo. Scrivi `35` o `35,50`.
   - **Tariffa partner B2B**: quello che paga un'agenzia (vuoto = uguale al pubblico). I prezzi **dedicati a un singolo partner** si impostano nella sua scheda ([sezione 14](#14-partner-agenzie-dmc-tour-operator)).
   - **Cancellazione gratuita (ore prima)**: vale solo per questo tour; vuoto = la regola generale (**Sito › Impostazioni › Regole di prenotazione**).
   - **Si può pagare sul posto**: conta solo se il pagamento sul posto è consentito nelle Impostazioni (di default non lo è).
   - **Lingue in cui offri questo servizio**: compaiono nella scheda del tour.
4. **Immagine di copertina**: scegli una foto già caricata o caricane una ([sezione 10](#10-immagini)). Senza foto il sito usa un'illustrazione.
5. **Testi** (una scheda per lingua: Italiano, English, Español, 日本語)
   - **Titolo**, **Sottotitolo**, **Riassunto** (una o due frasi: compare negli elenchi e su Google), **Punto d'incontro**, **Link alla mappa** (indirizzo Google Maps).
   - **Descrizione**: testo lungo; puoi formattarlo con i pulsanti *Grassetto, Corsivo, Titolo, Elenco, Link, Foto* ([appendice](#21-appendice-formattare-un-testo)) e controllare il risultato con **Anteprima**.
   - **Punti salienti**, **Incluso**, **Non incluso**: **uno per riga**. **Note utili**: testo libero.
   - **Domande frequenti** (facoltative): compaiono sulla pagina del tour come domande a tendina. Scrivi **una domanda per blocco**: la prima riga è la domanda, le righe sotto sono la risposta (puoi usare il grassetto e i link), e **lascia una riga vuota** tra una domanda e la successiva. Esempio:

     ```
     Si entra nella Basilica?
     Il tour la vede dall'esterno: l'ingresso non è incluso, ti aiuto a prenotarlo.

     Quanto si cammina?
     Circa 3 km, a ritmo rilassato.
     ```

     Se per una lingua non scrivi nulla, il sito mostra quelle dell'inglese (per spagnolo e giapponese) o dell'italiano. Idee: cosa si visita dentro e fuori, quanto si cammina, accessibilità, cosa portare, cosa succede se piove, se si può prenotare per una persona sola.
   - L'**italiano** è obbligatorio. Se una traduzione manca, il sito mostra al suo posto l'inglese (per spagnolo e giapponese) oppure l'italiano: nell'elenco dei tour vedi un avviso con le lingue che mancano.
6. Tocca **Crea il tour**. Apri **Vedi sul sito** per controllare come appare.

### Modificare, nascondere, duplicare, eliminare

- **Modificare**: tocca il tour, cambia, **Salva le modifiche**. Cambiano subito il sito e le **nuove** prenotazioni; quelle già fatte non cambiano (prezzo, orario e regole restano quelli della prenotazione).
- **Nascondere / Mostrare**: pulsante nell'elenco dei tour. È il modo giusto di «mettere in pausa» un tour: lo storico e le statistiche restano.
- **Duplicare**: dal tour, **Duplica**.
- **Eliminare**: in fondo alla scheda del tour. **Non si può** se esistono prenotazioni o codici sconto che lo citano: in quel caso **nascondilo**.

> Se cambi **orari o giorni** di un tour, controlla in **Agenda** le prenotazioni dei giorni futuri: le prenotazioni già fatte restano dov'erano.

## 6. Prezzi, tariffe a ore, sconti e buoni regalo

### Il listino: tutti i prezzi in una pagina
**Sito › Listino** mostra ogni tour con due colonne modificabili: **Pubblico (€)** e **Partner B2B (€)**. Cambia gli importi e tocca **Salva i prezzi**. Vale per le **nuove** prenotazioni.

### Tariffe a ore: guida, assistente, tour leader, meet & greet

Il servizio privato **non ha un prezzo fisso**: il cliente (o l'agenzia) sceglie **data, orario, ore e numero di persone** e il sito calcola il totale dalle tue tariffe. Le cifre stanno in **Sito › Tariffe a ore** e valgono per le **nuove** prenotazioni: ogni prenotazione conserva il suo conto, riga per riga.

**I quattro servizi**

| Servizio | Chi lo vede all'inizio | Scaglioni |
|---|---|---|
| **Servizio guida** | pubblico e agenzie | 2 ore · mezza giornata (4 ore) · giornata intera (8 ore) |
| **Assistente in loco** | solo agenzie | 2 · 4 · 8 ore |
| **Tour leader** | solo agenzie | mezza giornata (4 ore) · giornata intera (8 ore) |
| **Meet & greet** | solo agenzie | fino a 1 ora |

Per ogni servizio scrivi, per il **Pubblico** e per le **Agenzie**, il prezzo di ogni scaglione e quanto costa **Ogni ora in più**: sono euro **per l'intero gruppo**. Se lasci vuota la colonna *Pubblico*, quel servizio non è offerto ai privati.

**Come si calcola.** Il prezzo di *N* ore è quello dello scaglione più grande che non supera *N*, più le ore in più × «Ogni ora in più», senza mai superare lo scaglione successivo. Si prenota a mezz'ore, fino a 12 ore. Con le cifre iniziali: 5 ore di guida per un'agenzia = 300 € (4 ore) + 70 € = **370 €**; 3 ore al pubblico = 200 € + 90 € = **290 €**.

**Supplementi.** Si sommano al prezzo base e li calcola il sito dalla data e dall'orario scelti:
- **Festivo** (+20%) per domeniche e festività; **Superfestivo** (+50%) lo sostituisce a Natale, Capodanno e Pasqua. I giorni si elencano in *Quali giorni sono festivi* (giorno e mese, per esempio `25-04 01-05`; «pasqua» e «pasquetta» si calcolano da sole).
- **Notturno** (+30%) solo per le ore che cadono nella fascia (all'inizio dalle 20:00 alle 07:00), in proporzione. Per offrire orari serali o all'alba allarga gli orari in **Agenda › Disponibilità**.
- **Auricolari** (4 € a persona, da 8 persone, solo servizio guida): il cliente li spunta al pagamento.

Le percentuali dei supplementi si calcolano sul prezzo base (già scontato, per un'agenzia con sconto) e si arrotondano all'euro. In fondo alla pagina, **Prova il calcolatore** apre quello che vedono i clienti.

**Le cifre iniziali** sono un punto di partenza, non una verità: guardano le tariffe di altre guide e associazioni di Venezia (singole guide intorno a 80–85 € l'ora; un'associazione 125 € l'ora, ora extra 150 €, festivi +20%, auricolari 4 € da 8 persone; un coordinatore: meet & greet 55 €, 4 ore 120 €, 8 ore 220 €, notturno +30%). Il listino per le agenzie sta un po' sotto le guide già avviate, quello al pubblico circa il 25% sopra.

| | Pubblico | Agenzie |
|---|---|---|
| **Guida**: 2 ore · 4 ore · 8 ore · ora extra | 200 · 380 · 700 · 90 € | 160 · 300 · 560 · 70 € |
| **Assistente**: 2 · 4 · 8 ore · ora extra | — | 80 · 110 · 200 · 32 € |
| **Tour leader**: 4 · 8 ore · ora extra | — | 140 · 250 · 36 € |
| **Meet & greet**: 1 ora · ora extra | — | 50 · 30 € |

**Chi vede cosa**
- Il pubblico vede **solo il servizio guida**, colonna *Pubblico*: nella pagina **Guida privata a ore** (voce *Guida a ore* del menu) con il calcolatore.
- Le agenzie vedono le tariffe **Agenzie** in cima alla pagina *Per agenzie* (se lasci spuntato il consenso in *Chi vede le tariffe*; altrimenti solo dopo l'approvazione) e nella loro area.
- Lo **sconto %** del partner (**Clienti › Partner**) si applica alla tariffa Agenzie e il prezzo scontato si **arrotonda sempre al multiplo di 5 € successivo** (per eccesso): con il 15%, 160 € diventano 136 € → **140 €**; 110 € diventano 93,50 € → **95 €**. Il prezzo non supera mai quello senza sconto (28 € a persona con il 10% di sconto resterebbe 28 €, perché 25,20 € arrotondato salirebbe a 30 €). Il [listino dedicato](#prezzi-dedicati-a-un-partner) per singolo tour non riguarda i servizi a ore.

**I servizi sono «tour» a ore.** In **Sito › Tour**, nel campo *Prezzo* scegli *Prezzo fisso* oppure *A ore*; per quelli a ore indichi il servizio (guida, assistente…), se *Il cliente sceglie quante ore* (altrimenti la durata è fissa, come per un itinerario di tre ore) e *Chi può prenotarlo* (tutti, oppure solo agenzie con account partner). Un itinerario a durata fissa usa le tariffe della guida per quella durata.

**Dopo la prenotazione.** Il calendario blocca la fascia (le ore più la pausa); email, voucher, fattura e scheda della prenotazione riportano ore e supplementi (per esempio «4 ore, festivo +20%, auricolari»). Per i servizi lunghi conviene una **politica di annullo** dedicata alle agenzie (**Clienti › Partner › Politica di annullo**): un blocco di otto ore è difficile da riempire all'ultimo minuto.

> **Quanto resta in tasca? (indicativo: lo confermi col commercialista).** Pensa ai prezzi *al netto* di imposte e contributi. Con la Partita IVA in **regime forfettario** da gennaio 2027:
> - **Imposta sostitutiva**: **5%** per i primi cinque anni di una nuova attività (se negli ultimi tre anni non hai avuto altre attività e i ricavi restano sotto gli 85.000 € l'anno), poi **15%**. L'età non dà altri vantaggi.
> - **Base di calcolo**: l'imposta si applica a una percentuale degli incassi (**coefficiente di redditività**). Per le guide è il **67%**, legato al vecchio codice ATECO 79.90.20; il nuovo codice è **79.90.01** e finché non esce la nuova tabella si usa il vecchio abbinamento (alcune guide online riportano il 78%: chiedi quale vale per te nel 2027). Le spese vere **non** si deducono.
> - **Contributi INPS (Gestione Separata)**: circa il **26%** del reddito imponibile (26,07% nel 2026). Se vuoi, in fattura puoi addebitare la **rivalsa del 4%** (Impostazioni › Fatturazione elettronica).
> - **Bollo** da 2 € sulle fatture sopra 77,47 €.
> - **Esempio**: su 100 € incassati restano circa **80 €** con l'imposta al 5% e circa **75 €** al 15% (con il 78%: circa 77 € e 71 €), prima delle spese che sostieni tu (auricolari, trasporti, assicurazione, telefono, quote). Quindi **85 € l'ora lordi sono circa 68 € netti** con il 5%.
> - Oltre gli 85.000 € l'anno si esce dal forfettario l'anno dopo (oltre 100.000 € subito). Se hai anche un lavoro dipendente c'è un limite sul reddito da lavoro dipendente: chiedi.

### Prezzi dedicati a un partner
**Clienti › Partner** › il partner › **Listino dedicato**: per ogni tour puoi scrivere il prezzo che **solo quel partner** paga. Lascia vuoto per applicare la tariffa B2B (con lo sconto percentuale del partner, se c'è). Puoi **copiare il listino da un altro partner**.

**Quale prezzo vale per un partner?** In quest'ordine: 1) il **prezzo dedicato** per quel tour (così com'è scritto); 2) altrimenti la **tariffa B2B** del tour meno lo **sconto %** del partner, arrotondato al multiplo di 5 € successivo. Nella colonna *Applicato* vedi sempre il prezzo che il partner vedrà.

### Codici sconto e buoni regalo
**Clienti › Sconti**:
- **Nuovo codice sconto**: percentuale o importo fisso, periodo di validità, tour a cui si applica, importo minimo, numero massimo di usi. Il cliente lo scrive al pagamento (*Hai un codice sconto o un buono regalo?*). Puoi anche mandare un link del tipo `…/book/checkout?…&promo=CODICE`.
- **Nuovo buono regalo**: per un buono venduto di persona o in omaggio. Quelli acquistati online compaiono da soli. Dalla scheda del buono: **PDF del buono**, **Reinvia** all'acquirente o al destinatario, **Rettifica il saldo**, **Cambia** la scadenza, **Annulla buono**, e l'elenco dei **Movimenti**.
- Durata dei buoni e importo minimo/massimo: **Sito › Impostazioni › Buoni regalo, programmi e recensioni**.

## 7. Pagine: Chi sono, privacy, condizioni, cookie

**Sito › Pagine** elenca le quattro pagine fisse. Tocca **Modifica**, scrivi per lingua (titolo, descrizione per Google, testo) e **Salva la pagina**.

- Nel testo puoi usare dei **segnaposto** tra doppie graffe, che il sito sostituisce con i tuoi dati: `{{name}}` (nome), `{{legalName}}`, `{{email}}`, `{{phone}}`, `{{vat}}` (Partita IVA), `{{address}}`, `{{license}}` (abilitazione), `{{giftMonths}}` (mesi di validità dei buoni), `{{payMethods}}`, `{{b2cHours}}` e `{{b2bHours}}` (ore di cancellazione gratuita). Così, se cambi un dato in **Impostazioni**, le pagine si aggiornano da sole.
- **Privacy, Condizioni e Cookie sono bozze**: fai rivedere il testo dal tuo commercialista o consulente prima del lancio (buoni regalo, acconti dei programmi, recensioni, conservazione delle fatture).
- **Chi sono**: sopra il testo compare il tuo **ritratto**, se lo scegli in **Sito › Immagini › Immagini del sito**.

## 8. Blog

**Sito › Blog** elenca gli articoli (con data, lingue e stato *pubblicato* / *bozza*).

### Scrivere un articolo
1. **Sito › Blog › Nuovo articolo**.
2. In alto: **Indirizzo web (slug)** (vuoto = lo ricava dal titolo), **Data di pubblicazione** (è quella che il sito mostra), **Pubblicato** (se lo togli diventa una **bozza**, invisibile sul sito) e, se vuoi, i **Tour collegati**, che compaiono in fondo all'articolo.
3. **Immagine di copertina**: una foto della libreria (o una nuova) oppure un'illustrazione. Compare nell'elenco, in cima all'articolo e come anteprima quando il link viene condiviso.
4. Per ogni lingua che vuoi offrire: **Titolo**, **Riassunto** (una o due frasi: elenco articoli e Google), **Etichette** (separate da virgola) e **Testo**.
5. Nel testo usa i pulsanti **Grassetto, Corsivo, Titolo, Elenco, Link, Foto** e **Anteprima** per vedere il risultato ([appendice](#21-appendice-formattare-un-testo)).
6. **Crea l'articolo**.

**Lingue.** Un articolo compare **solo nelle lingue in cui hai scritto il titolo**: se scrivi solo l'italiano, in inglese e spagnolo non si vede (e non è nemmeno nelle mappe del sito per quelle lingue).

**Foto dentro il testo.** Tocca **Foto** sopra il campo di testo, scegli una foto della libreria: nel testo compare una riga come `![Descrizione della foto](/media/…)`. **Sostituisci «Descrizione della foto»** con una frase che descriva l'immagine (serve a chi non la vede e a Google). Le foto nuove si caricano prima da **Sito › Immagini**.

**Modificare o togliere.** Tocca l'articolo, cambia e **Salva le modifiche**. Per toglierlo dal sito senza perderlo: togli la spunta da *Pubblicato*. **Elimina l'articolo** lo cancella per sempre.

## 9. Testi del sito

I testi dell'interfaccia — titolo e frasi della home, pulsanti, messaggi, domande frequenti, testi dei PDF, ecc. — si cambiano in **Sito › Testi**, **per ogni lingua**.

1. Trova il testo: cerca una parola (*Cerca*) oppure scegli la sezione (Home, Menu, Prenota, Domande frequenti…).
2. Cambia il testo nella lingua che vuoi (Italiano, English, Español, 日本語).
3. **Salva i testi di questa pagina**.

Regole:
- **Non toccare le parti tra graffe** (per esempio `{amount}` o `{date}`): sono dati che il sito inserisce da solo. Se le cancelli, il sito non salva e te lo dice.
- **Per tornare al testo originale**, svuota il campo e salva.
- I testi lunghi di **tour, articoli e pagine** non stanno qui: si modificano nelle loro sezioni.
- I testi delle **email automatiche** (conferme, promemoria, fatture) **non si cambiano dal pannello**: stanno nel codice; per modificarli serve un aggiornamento (vedi sezione 18).
- Una frase mancante in una lingua usa un'altra lingua al suo posto (spagnolo → inglese → italiano).

## 10. Immagini

**Sito › Immagini** è la libreria di tutte le foto del sito.

**Caricare.** Tocca **Carica una foto** e scegli una o più foto (dal rullino del telefono o dal computer). Il browser le **ridimensiona** (massimo 1600 pixel) e le **ottimizza** prima di inviarle, e i dati di posizione (GPS) **non vengono conservati**. Vanno bene le foto normali (JPEG, PNG, WebP); un file che pesa ancora più di 4 MB dopo il ridimensionamento viene rifiutato.

**Consigli per scegliere le foto**
- **Orizzontali** (paesaggio) per copertine e home; il sito le ritaglia a misura e sui telefoni mostra la parte centrale, quindi tieni il soggetto al centro.
- Per l'**anteprima sui social** (WhatsApp, Facebook…) meglio orizzontale, circa 1200×630.
- Foto tue o con diritti d'uso chiari.

**Dove si usano le foto**
- **Copertina di un tour o di un articolo**: nella scheda del tour o dell'articolo, *Immagine di copertina*.
- **Foto del sito**: in **Immagini › Immagini del sito** vedi i cinque posti fissi — **Home**, **Chi sono** (il tuo ritratto), **Pagina agenzie**, **Buono regalo**, **Anteprima social** (la foto che compare quando qualcuno condivide un link del sito; se la lasci vuota si usa quella della home). Per sceglierla: nella libreria, sulla foto che vuoi, scegli dove usarla dal menu e tocca **Usa qui**. **Togli la foto** riporta l'illustrazione.
- **Dentro un articolo o una pagina**: pulsante **Foto** sopra il testo.

**Eliminare.** Una foto **in uso** (copertina, foto del sito) non si può eliminare: toglila prima da dove la usi. Le altre hanno il pulsante **Elimina**.

## 11. Disponibilità, chiusure e calendario

**Agenda › Disponibilità**:

- **Orari di lavoro abituali**: per ogni giorno, aperto/chiuso e fascia oraria. Fuori da queste fasce il sito non offre orari. **Salva orari**.
- **Giorni di chiusura e orari speciali**: è un calendario del mese. **Tocca un giorno per chiuderlo** (ferie, festivi) e toccalo di nuovo per **riaprirlo**; con le frecce cambi mese. I colori ti dicono se il giorno è chiuso, non lavorativo, con orario speciale o con impegni dal calendario collegato; il numero piccolo è quante prenotazioni ci sono. Sotto, **Orario speciale per un giorno**: scegli la data e la fascia e tocca **Imposta**; in **Prossime eccezioni** vedi l'elenco.
- **Impegni esterni (blocchi orari)**: blocca una fascia in un giorno (visita medica, un altro lavoro). **Aggiungi** / **Elimina**.
- **Calendari collegati (Google Calendar e simili)**: il sito legge il tuo calendario personale e **blocca da solo** gli orari degli eventi segnati «Occupato». Su Google Calendar: *Impostazioni → il tuo calendario → Integra calendario → «Indirizzo segreto in formato iCal»*; copialo, **Collega un calendario** → **Collega**. Il sito lo rilegge ogni 10 minuti e subito prima di confermare una prenotazione. **Sincronizza ora** forza la lettura; **Disattiva** lo mette in pausa; **Scollega** lo toglie. Se la lettura fallisce per più di un'ora, l'Agenda ti avvisa.

**Come il sito evita le sovrapposizioni.** Sei una sola guida: un servizio occupa la sua fascia **più una pausa** (30 minuti, regolabile in Impostazioni); i tour a persona con la stessa partenza si **sommano** fino alla capienza; i servizi privati e le giornate dei programmi **bloccano** la fascia. Mentre un cliente paga con carta lo slot resta **trattenuto 35 minuti**.

## 12. Prenotazioni, annulli e programmi di più giorni

### Prenotazioni
**Agenda › Prenotazioni**: schede *Prossime*, *Passate*, *Annullate*, *Tutte* e ricerca per nome, email o codice. Tocca una prenotazione per vedere tutto:

- **Prenotazione**: tour, data, orario, persone, prezzo, **metodo e stato del pagamento**, politica di annullo e, per i privati, il **Promemoria al cliente** (parte da solo la sera prima; non serve se la prenotazione è stata fatta meno di 24 ore prima) e la **richiesta di recensione** (il giorno dopo il tour). Per entrambi puoi **Invia ora** o **Non inviare**.
- **Apri come la vede il cliente**: la pagina privata del cliente (da lì si prova anche l'annullo).
- **Voucher PDF**, dati del **Cliente** (telefono, WhatsApp), **Note del cliente**, riferimento pratica e dati fattura.
- **Note interne**: solo per te. **Salva note**.
- **Segna come incassata**: per le prenotazioni a fattura o con pagamento sul posto, quando i soldi arrivano.

### Annullare una prenotazione
Nella scheda: **Annulla prenotazione**. Scegli **Rimborso e penale**:
1. *Secondo la politica* (preselezionato): il sito calcola da solo rimborso e penale in base alla politica della prenotazione e a quanto manca all'inizio;
2. *Rimborsa tutto* (nessuna penale);
3. *Nessun rimborso* (si trattiene tutto) / *Penale totale*.

Aggiungi un motivo (facoltativo) e **Annulla e avvisa il cliente**: il cliente riceve un'email. I pagamenti con carta vengono **rimborsati in automatico** sulla carta; per chi paga a fattura, la **penale** finisce in **Conti › Fatture › Da fatturare**. I buoni regalo usati tornano disponibili solo con rimborso totale.

Il **cliente privato** può annullare da solo con il link nell'email **finché c'è un rimborso**; oltre il termine il sito non glielo offre.

### Feedback dei clienti e commenti sul sito
Il giorno dopo il tour i clienti privati ricevono **una sola email**: i link per recensire su Google e Tripadvisor (uguali per tutti, mai solo per chi è soddisfatto) e un link per lasciare **un voto e un commento privati**. Quelli privati li leggi in **Clienti › Feedback** (con voto medio, numero di feedback e richieste inviate).

**Mostrare un commento sul sito.** Un cliente può spuntare «Puoi citare le mie parole sul sito, con il mio nome di battesimo (senza cognome)». Solo per quei commenti, in **Clienti › Feedback**, trovi il pulsante **Mostra sul sito** (e **Togli**). Il commento compare **così com'è scritto**, con il solo nome di battesimo, il tour e il mese:
- in **home**, nella sezione *Cosa dicono i clienti* (gli ultimi tre scelti);
- nella **pagina del tour** a cui si riferisce (*Dicono di questo tour*).

Se non scegli nulla, la sezione non compare. Se hai almeno **5 feedback**, sotto i commenti compare anche la **media di tutti i voti** ricevuti (non solo di quelli mostrati): è una scelta di correttezza, tienila così. Non scegliere solo i commenti da cinque stelle: sono commenti veri di clienti veri, anche quelli sinceri e misurati. Se vuoi rimandare alle recensioni pubbliche, metti l'indirizzo del tuo profilo Google o Tripadvisor in **Sito › Impostazioni › Buoni regalo, programmi e recensioni › Pagina con tutte le recensioni**: compare come *Leggi tutte le recensioni*. In Europa chi mostra recensioni deve poter dire che vengono da clienti reali: il sito lo dichiara (*commenti di clienti che hanno fatto il tour, pubblicati con il loro permesso*); per il resto chiedi al tuo consulente.

### Programmi di più giorni
**Agenda › Programmi**: richieste di clienti e partner per soggiorni lunghi.
1. Apri la richiesta e tocca **Crea e prepara la proposta**.
2. Compila **Titolo del programma**, **Valida fino al**, **Presentazione** (la vede il cliente), le **giornate** (**+ Aggiungi una giornata**: data, orari, titolo, descrizione, prezzo), il **Totale concordato** (vuoto = somma delle righe), l'**Acconto (%)** (0 = nessun acconto) e il testo con cosa è incluso, condizioni e cancellazione. Con la spunta *Tieni occupate le date in calendario* le giornate bloccano il calendario finché la proposta è valida; il sito segnala le **sovrapposizioni** con altri impegni.
3. **Salva bozza** per tornarci dopo, oppure **Salva e invia al cliente**: il cliente riceve un'email con il link alla proposta e un **PDF**. (**Apri come la vede il cliente** e **PDF della proposta** per un controllo.)
4. Il cliente **accetta online** e paga l'acconto, oppure tu registri l'accettazione (**Il cliente ha accettato**, per telefono o email). Puoi anche **Annullare il programma**, **Segnare come rifiutata**, **Archiviare**, **Riaprire come bozza**.

## 13. Fatture

**Conti › Fatture** (la parte fiscale va concordata con il commercialista).

**Prima di cominciare** compila i dati fiscali in **Sito › Impostazioni › Fatturazione elettronica** (e la Partita IVA in *Attività e contatti*). Finché mancano dati, la pagina te lo dice e **non si può emettere**. Imposta anche la **Prima data fatturabile** (per esempio il giorno di apertura della Partita IVA): senza, ogni prenotazione passata finisce in *Da fatturare*.

**Il giro, da fare ogni settimana**
1. **Da fatturare**: elenco di servizi pagati o svolti, buoni regalo venduti, programmi conclusi e penali, raggruppati per cliente. La data *entro il* è il termine consigliato (**12 giorni**); in rosso quelle scadute.
2. Spunta le voci di uno stesso cliente → **Prepara la fattura con le voci scelte**.
3. **Bozze**: controlla intestatario (nome, codice fiscale o Partita IVA, indirizzo, codice destinatario o PEC), righe, importi e data. **Salva bozza** per tornarci, oppure **Emetti la fattura**: il sito assegna il **numero progressivo dell'anno** (`1/2027`, `2/2027`…, senza buchi) e genera il file **XML FatturaPA** più una **copia PDF** per il cliente. Una bozza si può **eliminare** (le voci tornano da fatturare).
4. **Invio a SdI**: o scarichi l'XML e lo carichi su **Fatture e Corrispettivi** (Agenzia delle Entrate, gratuito), oppure — se hai impostato la PEC sul server — **Invia a SdI via PEC**. Gli esiti (consegnata, scartata…) arrivano alla tua casella: **registrali a mano** nella scheda della fattura. Entro **12 giorni** dall'operazione.
5. **Emesse**: elenco per anno, con il pulsante **Registro CSV** per il commercialista.

**Errori.** Una fattura **emessa non si modifica**: se sbagli si emette una **nota di credito**. Una fattura **scartata** da SdI si corregge (**Correggi e riemetti**) e si riemette con lo stesso numero. Per fatture fuori dal sito (un servizio reso di persona) usa **Nuova fattura a mano**.

**Limiti da sapere.** Il sito non legge in automatico le ricevute di SdI, non fa la conservazione sostitutiva (la offre l'Agenzia delle Entrate o il tuo intermediario) e non è stato provato con un account reale di SdI: l'XML è controllato contro lo schema ufficiale, i controlli di merito li fa SdI. Il trattamento dei **clienti privati e stranieri**, dei **buoni regalo** (monouso o multiuso) e delle **penali di annullo** va deciso con il commercialista.

## 14. Partner (agenzie, DMC, tour operator)

**Clienti › Partner** elenca le aziende registrate (*Tutti* · *Da approvare* · *Approvati*). Le agenzie si registrano da `…/b2b` → *Richiedi accesso partner*.

### Approvare un partner
1. Apri la richiesta: vedi dati aziendali (Partita IVA, SDI/PEC), referente e messaggio.
2. In **Stato e pagamento** scegli **Stato**: *Approvato*, *Rifiutato* o *Sospeso*; imposta lo **Sconto su tutto il listino (%)** (vale per i tour senza prezzo dedicato) e se **può pagare a fattura / bonifico**; aggiungi **Note interne**. **Salva**.
3. Il partner riceve un'email e può entrare nella sua area: vede le **tariffe riservate** (anche quelle **a ore**, con il suo sconto), prenota in autonomia (anche gruppi fino a 25), inserisce un **riferimento pratica**, scarica il **voucher senza prezzi** da girare al cliente finale e richiede **programmi di più giorni**.

### Listino dedicato
Nella stessa pagina, **Listino dedicato**: scrivi il prezzo per ogni tour (vuoto = tariffa B2B con lo sconto %). **Salva il listino**. I servizi **a ore** non compaiono qui: il loro prezzo viene da **Sito › Tariffe a ore**, con lo sconto % del partner. *Copia il listino da…* parte da un altro partner.

### Politica di annullo per ogni partner
Sotto **Politica di annullo** decidi fino a **3 scaglioni**: «fino a *N giorni/ore* prima dell'inizio: rimborso *X*%». Esempio: *fino a 7 giorni prima 100%; fino a 3 giorni prima 50%*; dopo l'ultimo scaglione **non si rimborsa nulla**.
- Il rimborso **non può aumentare** avvicinandosi al servizio.
- Usa i **Modelli** per partire da uno schema pronto; **Svuota** torna alla regola predefinita del sito (**Sito › Impostazioni**: ore di cancellazione dei partner). In fondo vedi un **esempio con date vere** di cosa vedrà il partner.
- Chi paga a fattura riceve una **penale** pari alla parte non rimborsata: la trovi in **Fatture › Da fatturare**. Chi paga con carta riceve il **rimborso parziale** in automatico.
- La politica vale per le prenotazioni **fatte dopo** il salvataggio: ogni prenotazione conserva quella di quando è stata creata. *Copia la politica da…* la ricopia da un altro partner.

## 15. Statistiche

**Conti › Statistiche** è il cruscotto dell'attività.

**Filtri** (in alto, sul telefono sotto *Periodo personalizzato e altri filtri*): **periodo** (questo mese, mese scorso, 30 o 90 giorni, quest'anno, anno scorso, tutto, oppure *Dal–Al*), **base del periodo** (*data del servizio* oppure *data di prenotazione*), **canale** (privati / partner), **partner**, **tour**. Tutti i numeri della pagina seguono gli stessi filtri.

**Numeri del periodo** (con la variazione rispetto al periodo precedente di pari durata):
- **Venduto**: valore delle prenotazioni confermate, dopo gli sconti. **Prenotazioni**, **Persone**.
- **Scontrino medio** (anche separato privati/partner), **Valore medio per persona**, **Anticipo medio di prenotazione** (giorni tra prenotazione e servizio), **Quota partner** (peso delle agenzie sul venduto).
- **Incassato** (denaro ricevuto, al netto dei rimborsi), **Da incassare** (fatture e pagamenti sul posto in attesa), **Sconti concessi**, **Pagato con buoni regalo**.
- **Annullamenti**: prenotazioni annullate, **tasso di annullo**, **rimborsi**, **penali** (trattenute o da fatturare).
- **Fatturato emesso**: dal modulo Fatture (fatture meno note di credito), per data di emissione.

**Dettagli**: **andamento nel tempo** (per giorno, settimana, mese o anno secondo la lunghezza del periodo), **per prodotto**, **per partner**, **per canale**, **per metodo di pagamento**, **per lingua del cliente**, **per giorno della settimana**; **portafoglio futuro** (già prenotato nei prossimi 30/60/90 giorni); **buoni regalo** (venduti e saldo da onorare), **uso dei codici sconto**, **programmi di più giorni**.

**Esporta CSV**: una riga per prenotazione (di ogni stato) con gli stessi filtri, da aprire in Excel o Fogli Google.

**Come leggerle, qualche esempio**
- *Quale tour rende di più?* **Per prodotto**, periodo «Ultimi 90 giorni» o «Quest'anno».
- *Quanto pesano le agenzie?* **Quota partner** e **Per partner**.
- *In che giorni lavoro di più?* **Per giorno della settimana**.
- *Quanto devo ancora incassare dalle agenzie?* **Da incassare**.
- *Gli annulli sono troppi?* **Tasso di annullo**, poi filtra per partner o tour.

In fondo alla pagina, **Come sono calcolati i numeri** spiega ogni definizione.

## 16. Impostazioni

**Sito › Impostazioni** ha quattro sezioni, ciascuna con il suo pulsante **Salva questa sezione** (le modifiche valgono subito). Se un campo non è valido, nulla viene salvato e vedi quale correggere.

- **Attività e contatti**: nome del sito, nome per i documenti, email di contatto, **email che riceve le notifiche**, telefono, **WhatsApp** (solo cifre con prefisso, es. `393331234567`; vuoto = nascosto), Instagram, **Partita IVA**, abilitazione di guida turistica, indirizzo. Compaiono nel piè di pagina, nelle email, nei voucher e nei PDF.
- **Regole di prenotazione**: cancellazione gratuita per privati e partner (ore), preavviso minimo, anticipo massimo (giorni), pausa tra due servizi, passo degli orari liberi, blocco dell'orario durante il pagamento, **promemoria al cliente la sera prima** (sì/no e a che ora), **pagamento il giorno del servizio** (sì/no).
- **Buoni regalo, programmi e recensioni**: validità e importi dei buoni, acconto e validità dei preventivi dei programmi, richiesta di recensione dopo il tour (sì/no, link per recensire su Google e Tripadvisor, ora d'invio) e **Pagina con tutte le recensioni** (il link che compare accanto ai commenti sul sito).
- **Fatturazione elettronica**: dati del cedente (nome o denominazione, codice fiscale, indirizzo), regime, IVA, natura, bollo, rivalsa INPS, ritenuta, diciture, IBAN, scadenze, buoni regalo, prima data fatturabile.

Come funziona:
- Ogni campo mostra il valore in uso. Se è diverso da quello della configurazione del server, sotto leggi **Predefinito: …**.
- **Ripristina i valori predefiniti** (a fondo sezione) annulla le modifiche di quella sezione e torna ai valori del server.
- Cambiando l'**email di contatto** anche le notifiche la seguono, **se andavano già a quell'indirizzo**.

Quello che non è qui: password del pannello, chiavi di Stripe, posta in uscita (SMTP), PEC per SdI, indirizzo del sito ([sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)).

## 17. Backup e ripristino

Prenotazioni, clienti, fatture, tour, articoli, pagine, testi, impostazioni e foto stanno **solo sul server**. Una copia sul tuo computer ti protegge se il server si rompe o se cancelli qualcosa per errore.

**Scaricare la copia.** **Aiuto › Backup › Scarica la copia completa (.zip)**. Dentro trovi:
- `guida.sqlite`: il database con tutto, in una «fotografia» coerente;
- `media/`: le foto caricate;
- `contenuti.json`: tour, articoli, pagine e testi in formato leggibile (utile per consultarli o copiarli);
- `LEGGIMI.txt`: le istruzioni per il ripristino.

**Quando.** Dopo ogni grande modifica (nuovi tour, tante foto, cambio prezzi) e **almeno una volta al mese**. La pagina ti ricorda quando hai scaricato l'ultima. Conserva il file **al sicuro**: contiene **dati personali dei clienti** (non mandarlo per email, non lasciarlo su computer condivisi). Molti hosting fanno anche copie automatiche del disco: chiedi al tuo se sono attive, ma la tua copia resta l'assicurazione in più.

### Ripristinare una copia

**Aiuto › Backup › Ripristina da una copia**: scegli lo zip che avevi scaricato e premi **Carica e controlla**. Il sito controlla il file e ti mostra **cosa cambierebbe**: quanti tour, articoli, prenotazioni, fatture… ci sono adesso e quanti nella copia. **Finché non confermi, non cambia nulla.** Poi scegli che cosa ripristinare:

- **Solo i contenuti** (la scelta consigliata): tour e prezzi, articoli, pagine, testi del sito e foto tornano come nella copia. **Non tocca** prenotazioni, clienti, partner, buoni regalo, fatture, feedback, orari e impostazioni. È quella giusta per rimediare a una modifica sbagliata. Un tour che ha già delle prenotazioni non sparisce mai, anche se la copia non lo conosce; le foto che hai già restano in libreria.
- **Tutto**: sostituisce ogni dato con quello della copia. Serve per rimettere in piedi il sito dopo un guasto o su un server nuovo. **Quello che è successo dopo la data della copia sparisce dal pannello** (prenotazioni, buoni regalo, partner, fatture emesse…): la pagina ti dice quante cose sono, per esempio *«2 prenotazioni, 1 fattura emessa»*. I pagamenti restano comunque su Stripe e le fatture già mandate a SdI restano valide, ma il sito non le conoscerebbe più: dovresti rimetterle a mano e **non emettere nuove fatture finché non hai ricontrollato la numerazione** con il commercialista. Qualche cliente potrebbe anche ricevere di nuovo un'email automatica (promemoria, richiesta di recensione).

Per confermare scrivi **RIPRISTINA** nella casella e premi **Ripristina**. Il pulsante **Annulla, non cambiare niente** butta via il file caricato.

**Se hai ripristinato la copia sbagliata.** Prima di ogni ripristino il sito salva da solo com'era: le ultime tre copie compaiono in **Copie di sicurezza automatiche**. **Torna a questa versione** ti riporta com'era prima (con la stessa anteprima e la stessa conferma); **Scarica (.zip)** te la dà come file, uguale a una copia normale.

Qualche accortezza:
- Fallo **quando nessuno sta prenotando** (per esempio la sera): durante il ripristino, che dura pochi secondi, una prenotazione in corso potrebbe sbagliare.
- Il file caricato resta sul server **al massimo un'ora** e si cancella appena confermi o annulli. Il limite è 1 GB.
- Carica solo copie scaricate da **questo** sito. Il sito rifiuta file che non sono copie sue, danneggiati o fatti da una versione più recente (in quel caso aggiorna prima il sito). Le copie fatte da una versione più vecchia si aggiornano da sole.
- Se l'hosting limita la dimensione dei caricamenti e lo zip non sale, usa il ripristino a mano.

**Ripristino a mano** (con il sito **spento**, sul server; serve se il pannello non è raggiungibile): 1) sostituisci `guida.sqlite` nella cartella dei dati e cancella gli eventuali `guida.sqlite-wal` e `guida.sqlite-shm` accanto; 2) copia la cartella `media/` nella cartella dei dati; 3) riavvia il sito. Se non sei pratico, falla fare a un programmatore con questo zip alla mano.

## 18. Online, aggiornamenti e cosa non si cambia dal pannello

**Il sito ha bisogno di un server** (non è una pagina statica: prenotazioni e pagamenti devono essere sempre aggiornati). Requisiti: Node.js 22.13 o superiore, un **disco persistente** per la cartella dei dati (`DATA_DIR`, nel Docker è `/data`) e HTTPS.

**Cosa sta nella configurazione del server** (variabili d'ambiente, nel pannello del tuo hosting; dopo ogni modifica il servizio si riavvia). Sono **cose tecniche o segrete**, per questo non stanno nel pannello:

| Variabile | A cosa serve |
|---|---|
| `ADMIN_PASSWORD` | password del pannello (senza virgolette) |
| `SESSION_SECRET` | firma delle sessioni (lunga e casuale; non cambiarla senza motivo: scollega tutti) |
| `BASE_URL` | indirizzo pubblico del sito (`https://…`), usato nei link delle email |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | pagamenti con carta |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | spedizione delle email |
| `PEC_SMTP_*`, `SDI_PEC_ADDRESS` | invio delle fatture a SdI dalla tua PEC |
| `DATA_DIR`, `PORT`, `NODE_ENV`, `TRUST_PROXY` | dove stanno i dati e come gira il server |
| `UMAMI_WEBSITE_ID`, `UMAMI_SRC` | statistiche di visita anonime (facoltative) |

Le variabili che corrispondono ai campi di **Sito › Impostazioni** (contatti, regole, fatturazione…) restano valide come **valori predefiniti**: se un campo è stato cambiato dal pannello, vince il pannello. La sezione **Impostazioni** è l'unico posto da cui cambiarli.

**Pagamenti con carta, Apple Pay, Google Pay, PayPal.** Il cliente paga su una pagina ospitata da Stripe: i metodi che attivi nella **dashboard di Stripe** (*Impostazioni → Metodi di pagamento*) compaiono da soli, senza toccare il sito. Scegli metodi **a conferma immediata**: quelli che confermano in giorni (addebito SEPA, bonifici) lasciano lo slot occupato in attesa. Il webhook di Stripe (`https://tuodominio.it/api/stripe/webhook`) va configurato una volta.

**Aggiornare il sito (il codice).** I contenuti **non passano da qui**. Quando c'è una nuova versione del codice (nuove funzioni, correzioni):
- se l'hosting è collegato al repository GitHub, si aggiorna da solo quando cambia il ramo `main`, oppure con il pulsante *Deploy* / *Redeploy*;
- altrimenti, sul server: aggiorna il codice (`git pull`), `npm ci --omit=dev` e riavvia.
- Un aggiornamento **non cancella** né sovrascrive i contenuti: sono nella cartella dei dati, che deve restare sul disco persistente. Prima di un aggiornamento importante scarica un **backup**.
- Un **server nuovo con la cartella dei dati vuota** riparte con il contenuto iniziale (tour e testi d'esempio): ripristina prima il tuo backup.

**Quando serve un programmatore**: nuove funzioni (per esempio più guide con calendari separati, un nuovo tipo di prodotto), una nuova lingua, modifiche allo stile, collegamenti con altri servizi.

## 19. Quando qualcosa non va

**Non riesco a entrare nel pannello**
- La password è quella della variabile `ADMIN_PASSWORD`, **senza virgolette né spazi**. Dopo averla cambiata il servizio va riavviato.
- Se la variabile è vuota in produzione il pannello è **disattivato**: impostala e riavvia.
- Sul computer di prova (`npm run sandbox`) la password è `admin`.

**Ho cambiato qualcosa ma sul sito non lo vedo**
- Ricarica la pagina (sul telefono: chiudi e riapri il browser). Le modifiche dal pannello sono immediate; le **foto** hanno una copia in cache e il browser può mostrare la vecchia per qualche istante.
- Controlla di aver toccato **Salva** e di non aver ricevuto un messaggio rosso.
- Un tour **nascosto**, un articolo in **bozza** o scritto in un'altra lingua non compaiono.
- Hai modificato i file della cartella `content/` del codice? Dopo il primo avvio non vengono più letti: usa il pannello.

**Un prezzo o una regola non cambia per una prenotazione già fatta**: è voluto, ogni prenotazione conserva le condizioni di quando è stata creata.

**Le email non arrivano ai clienti / a me**
- **Aiuto › Email** mostra le email tentate. Se in alto c'è *«SMTP non configurato»* le email **non partono**: imposta le variabili `SMTP_*` e `MAIL_FROM` sul server.
- Usa un mittente del tuo dominio con SPF/DKIM, altrimenti finiscono nello spam. Chiedi ai clienti di controllare la cartella *Posta indesiderata*.

**Il cliente dice di non aver ricevuto il promemoria**: il promemoria parte solo per i clienti **privati** con prenotazione confermata fatta **almeno 24 ore prima** dell'inizio; per i partner non parte. Nella scheda della prenotazione leggi lo stato (*inviato il…*, *non verrà inviato*, *parte la sera prima*). Se le email non partono in generale, vedi sopra.

**Un cliente ha pagato ma non ha la conferma**: guarda **Agenda › Prenotazioni** (tab *Tutte*, ricerca per email). I pagamenti con carta si confermano quando arriva l'avviso di Stripe (webhook): se **mai** funziona, controlla il webhook nella dashboard di Stripe. Se lo slot è stato preso nel frattempo il cliente viene **rimborsato in automatico** e avvisato.

**Il calendario collegato non si aggiorna**: **Disponibilità › Calendari collegati › Sincronizza ora**. Se non va, ricopia l'indirizzo segreto iCal da Google Calendar.

**Ho cancellato per errore un tour, un articolo o una pagina**: non c'è un cestino. Rimedio: la **copia di sicurezza** più recente. Con **Aiuto › Backup › Ripristina da una copia › Solo i contenuti** rimetti tour, articoli, pagine, testi e foto com'erano, senza toccare le prenotazioni (vedi [sezione 17](#17-backup-e-ripristino)); `contenuti.json` dentro lo zip contiene gli stessi testi in forma leggibile, se ti serve solo ricopiare qualcosa. Per i tour con prenotazioni il sito non permette l'eliminazione: si nascondono.

**Il sito è lento o non risponde**: è un problema del server o dell'hosting; guarda i *log* nel pannello dell'hosting e chiedi aiuto con le ultime righe di errore.

## 20. Da fare prima del lancio e a gennaio

**Prima del lancio**
- [ ] **Tour e prezzi veri** (Sito › Tour e Listino): i tour d'esempio sono segnaposto. Controlla orari, durate, punti d'incontro, lingue.
- [ ] **Tariffe a ore** (Sito › Tariffe a ore): le cifre iniziali sono un punto di partenza. Rivedi prezzi, supplementi e giorni festivi, **confermali col commercialista** e fai una prova col calcolatore (*Prova il calcolatore*).
- [ ] **Foto vere**: copertine dei tour, foto della home, il tuo ritratto in *Chi sono*, anteprima social (Sito › Immagini).
- [ ] **Testi**: rileggi *Chi sono*, gli articoli, le domande frequenti (Sito › Pagine, Blog, Testi).
- [ ] **Pagine legali** riviste dal commercialista o da un consulente.
- [ ] **Contatti**: email, telefono, WhatsApp, Instagram in **Impostazioni › Attività e contatti**.
- [ ] **Stripe**: prima in modalità test (carte di prova), poi **in modalità reale** con il webhook configurato; **SMTP** funzionante. Fai una prenotazione di prova e un rimborso (in reale, con un importo piccolo).
- [ ] **Orari di lavoro**, giorni di chiusura e **calendario personale** collegato (Agenda › Disponibilità).
- [ ] **Dominio e HTTPS**, `BASE_URL` corretto, disco persistente, **primo backup**.

**Quando apri la Partita IVA (gennaio)**
- [ ] In **Impostazioni › Attività e contatti**: **Partita IVA**, **abilitazione**, **indirizzo**, nome per i documenti.
- [ ] In **Impostazioni › Fatturazione elettronica**: dati del cedente, **regime** (forfettario o ordinario), **IVA e natura**, bollo, ritenuta/rivalsa, **IBAN**, **Prima data fatturabile** = giorno di apertura. **Fatti confermare ogni voce dal commercialista.**
- [ ] Decidi con il commercialista come trattare **clienti privati e stranieri**, **buoni regalo** e **penali di annullo**.
- [ ] Non emettere una fattura «di prova» su SdI (consumerebbe il numero 1): chiedi al commercialista come verificare il file prima.
- [ ] Imposta la **PEC** sul server se vuoi inviare a SdI da qui; altrimenti caricherai l'XML su *Fatture e Corrispettivi*.

## 21. Appendice: formattare un testo

I testi lunghi (descrizione dei tour, articoli, pagine) usano un formato semplice. Sopra il campo trovi i pulsanti: **Grassetto**, **Corsivo**, **Titolo**, **Elenco**, **Link**, **Foto**; **Anteprima** mostra il risultato. Se preferisci scrivere a mano:

| Per ottenere… | Scrivi… |
|---|---|
| **grassetto** | `**grassetto**` |
| *corsivo* | `*corsivo*` |
| un titolo di paragrafo | `## Titolo` (su una riga a parte) |
| un titolo più piccolo | `### Titolo` |
| un elenco puntato | una riga per voce, ciascuna che inizia con `- ` |
| un elenco numerato | `1. prima`, `2. seconda`… |
| un link | `[testo del link](https://indirizzo)` |
| una foto | `![descrizione](/media/nome-del-file.jpg)` (meglio con il pulsante **Foto**) |
| una citazione | `> testo` |
| un nuovo paragrafo | lascia **una riga vuota** |

Non servono altre cose: niente codice, niente tabelle. Per **Punti salienti**, **Incluso** e **Non incluso** scrivi **una voce per riga**, senza simboli.
