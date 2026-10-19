# Guida all'uso del sito

Questa guida è per te, che gestisci il sito: spiega **come fare ogni cosa dal pannello**, passo per passo, senza toccare il codice. È pensata per essere letta anche dal telefono: nel pannello la trovi in **Aiuto › Guida**.

Le indicazioni di percorso si leggono così: **Sito › Tour B2C** vuol dire «tocca *Sito* nel menu in alto, poi la scheda *Tour B2C*».

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
3. Per uscire: **Esci**, in alto a destra. Chiude la sessione e ti riporta alla **home del sito**.

**Il menu** ha cinque voci; ciascuna ha delle schede sotto il titolo:

| Voce | Schede |
|---|---|
| **Agenda** | Agenda · Prenotazioni · Programmi · Disponibilità |
| **Clienti** | Partner · Sconti · Feedback |
| **Conti** | Fatture · Statistiche |
| **Sito** | Tour B2C · Tour B2B · Listino · Tariffe a ore · Blog · Pagine · Testi · Immagini · Impostazioni |
| **Aiuto** | Guida · Backup · Sicurezza · Email |

**Cambiare la password del pannello.** La password non si cambia dal pannello (per sicurezza): sta nella configurazione del server, nella variabile `ADMIN_PASSWORD`. Cambiala nel pannello del tuo hosting (sezione *Environment* / *Variables*), scrivila **senza virgolette** e riavvia il servizio. Usa una password lunga e unica.

### Sicurezza del pannello: due passaggi e dispositivi
Il pannello contiene i dati dei clienti e le fatture: oltre alla password puoi chiedere un **codice a tempo** che solo il tuo telefono sa produrre (accesso a due passaggi). Si gestisce in **Aiuto › Sicurezza**.

**Attivarlo** (due minuti, serve il telefono):
1. **Aiuto › Sicurezza › Attiva i due passaggi**.
2. Installa sul telefono un'**app di autenticazione** (Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden…), tocca *+* e **inquadra il codice QR**. Se non riesci, scrivi a mano la chiave sotto il codice (tipo *basata sul tempo*) oppure, **dal telefono stesso**, tocca *apri direttamente nell'app*.
3. Scrivi il **codice di 6 cifre** che l'app mostra e tocca **Conferma e attiva**.
4. Il sito ti mostra **10 codici di emergenza**: **scrivili o stampali subito** (c'è il pulsante *Stampa*) e conservali in un posto sicuro, non solo nel telefono. Non si possono rivedere.

**Entrare dopo l'attivazione.** Scrivi la password, poi il **codice di 6 cifre** dell'app: cambia ogni 30 secondi e ognuno vale **una volta sola**. Se non viene accettato, controlla che l'**ora del telefono sia impostata in automatico**. Se non hai il telefono, apri *Non hai il telefono?* e scrivi un **codice di emergenza** (vale una volta; ti avvisiamo per email).

**Cosa fa il sito per proteggerti**
- Dopo **5 codici sbagliati di fila** il secondo passaggio si **blocca** per 15 minuti (poi 30, 60… fino a 6 ore) e **nemmeno il codice giusto passa** finché dura il blocco: così chi conosce la password non può indovinare i numeri. Un codice scritto a metà (meno di 6 cifre) non conta come tentativo.
- All'indirizzo che riceve le notifiche arriva una **email** quando i due passaggi vengono accesi o spenti, quando si generano nuovi codici di emergenza, quando se ne usa uno e quando scatta un blocco.
- La chiave **resta sul server**: non c'è nelle **copie di sicurezza** che scarichi e un **ripristino** non la tocca (e non spegne la protezione).

**Dispositivi collegati.** Dopo l'accesso il pannello resta aperto **7 giorni** su quel browser. **Esci da tutti gli altri dispositivi** (stessa pagina) chiude le sessioni altrove e lascia aperta questa. Succede lo stesso quando **attivi** i due passaggi (gli altri devono rientrare con il codice) e quando **cambi la password** del pannello: in quel caso devono rientrare tutti, anche questo browser.

**Nuovi codici di emergenza e spegnimento.** Nella stessa pagina: **Genera nuovi codici** (i vecchi smettono di valere) e **Disattiva**. In entrambi i casi devi scrivere un codice valido (dell'app o di emergenza): così una sessione lasciata aperta non basta a togliere la protezione.

**Se perdi il telefono e anche i codici di emergenza.** Serve il server: dal terminale, nella cartella del sito, `npm run admin:2fa-off` (con Docker: `docker exec <contenitore> npm run admin:2fa-off`). Spegne i due passaggi e chiude tutte le sessioni; poi entri con la sola password e li riattivi con il telefono nuovo. Chi non ha accesso al server non può farlo: per questo i codici di emergenza vanno conservati.

## 3. Voglio… → vado in…

| Voglio… | Vado in… |
|---|---|
| **Cambiare il prezzo** di un tour a prezzo fisso | **Sito › Listino** (tutti insieme) oppure il tour in **Sito › Tour B2C** / **Sito › Tour B2B** |
| Cambiare le **tariffe a ore** (mezza giornata, giornata, ora extra), i **supplementi** (festivo, notturno, auricolari) o i **giorni festivi** | **Sito › Tariffe a ore** |
| Offrire alle agenzie **assistente, tour leader o meet & greet** | **Sito › Tariffe a ore** (le cifre) e **Sito › Tour B2B** (i servizi) |
| **Aggiungere un tour** per i privati o per le agenzie | **Sito › Tour B2C › Nuovo tour B2C** oppure **Sito › Tour B2B › Nuovo tour B2B** |
| Cambiare orari, durata, capienza, prezzo o testi di un tour | **Sito › Tour B2C** o **Sito › Tour B2B** › tocca il tour |
| **Nascondere** un tour (pausa, stagione) | **Sito › Tour B2C** o **Tour B2B** › **Nascondi** |
| **Scrivere un articolo** | **Sito › Blog › Nuovo articolo** |
| Cambiare la **foto** di un tour o di un articolo | nel tour o nell'articolo: **Immagine di copertina** |
| Cambiare la foto della **home**, il **mio ritratto**, l'anteprima sui social | **Sito › Immagini › Immagini del sito** |
| Modificare **Chi sono**, privacy, condizioni, cookie | **Sito › Pagine** |
| Cambiare un **testo** del sito (titolo della home, pulsanti, domande frequenti…) | **Sito › Testi** |
| Cambiare **telefono, WhatsApp, Partita IVA**, indirizzo | **Sito › Impostazioni › Attività e contatti** |
| Cambiare **ore di cancellazione, preavviso**, pausa fra i servizi | **Sito › Impostazioni › Regole di prenotazione** |
| Inserire i **dati per fatturare** | **Sito › Impostazioni › Fatturazione elettronica** |
| **Approvare** un'agenzia, dare **sconti, prezzi e cancellazione** dedicati | **Clienti › Partner** › tocca l'agenzia |
| **Riordinare** i tour nell'elenco del sito (o dell'area agenzie) | **Sito › Tour B2C** (o **Tour B2B**): trascina le righe dalla maniglia ⠿ |
| Decidere **quanto dura un'opzione** per le agenzie (e quante ne possono tenere) | **Sito › Impostazioni › Opzioni per le agenzie**; per una sola agenzia **Clienti › Partner › Opzioni** |
| **Prolungare o rilasciare** l'opzione di un'agenzia | **Agenda › Prenotazioni › Opzioni** › tocca l'opzione |
| Rispondere a una **richiesta di proroga** di un'opzione | **Agenda** (avviso in alto) › **Prenotazioni › Opzioni** › tocca l'opzione: **Approva** o **Non concedere**; vedi [Cambiare persone, data o ore](#cambiare-persone-data-o-ore-da-soli-e-chiedere-una-proroga) |
| Capire un **pacchetto** (più servizi di un'agenzia insieme) | **Agenda › Prenotazioni** › tocca un servizio: il riquadro **Pacchetto** elenca gli altri e ha **Segna incassato tutto il pacchetto**; vedi [Pacchetti](#pacchetti-più-servizi-nella-stessa-pratica) |
| Vedere **cosa aspetta me** oggi (proroghe, fatture, partner, incassi…) | **Agenda › Da fare** |
| Preparare **il giorno dopo**: orari, punti d'incontro, contatti, cosa incassare | **Agenda › Scheda del giorno** (arriva anche per email la sera prima) |
| Vedere **quali agenzie aspettano una data occupata** e chi la tiene | **Agenda › Lista d'attesa** ([come funziona](#date-libere-e-lista-dattesa)) |
| **Prendere prenotazioni prima di aprire la Partita IVA**, senza incassare | **Sito › Impostazioni › Regole di prenotazione › Incassi dal** ([sezione 20](#20-da-fare-prima-del-lancio-e-a-gennaio)) |
| Creare un **codice sconto** o un **buono regalo** | **Clienti › Sconti** |
| **Chiudere un giorno**, ferie, orari speciali, collegare **Google Calendar** | **Agenda › Disponibilità** |
| **Annullare** una prenotazione, rimborsare, segnare un pagamento incassato | **Agenda › Prenotazioni** › tocca la prenotazione |
| Segnare che un **bonifico di un'agenzia è arrivato**, **sollecitare** una fattura scaduta | **Conti › Fatture › Emesse** › la fattura › **Incasso e solleciti** ([come funziona](#pagamento-delle-fatture-iban-carta-e-solleciti)) |
| Segnare **tanti bonifici insieme**, caricando l'estratto conto della banca | **Conti › Fatture › Incassi dalla banca** ([come funziona](#incassi-dalla-banca-lestratto-conto-in-csv)) |
| Preparare la **proposta** di un programma di più giorni | **Agenda › Programmi** |
| **Emettere una fattura** | **Conti › Fatture** |
| Vedere **quanto ho incassato**, quale tour rende di più, lo scontrino medio | **Conti › Statistiche** |
| Chiedere anche il **codice del telefono** per entrare nel pannello, o **chiudere le sessioni** aperte su altri dispositivi | **Aiuto › Sicurezza** ([come funziona](#sicurezza-del-pannello-due-passaggi-e-dispositivi)) |
| Scaricare una **copia di sicurezza** | **Aiuto › Backup** |
| **Rimettere il sito com'era** in una copia scaricata (o tornare indietro dopo un errore) | **Aiuto › Backup › Ripristina da una copia** |
| Leggere le **email** mandate dal sito | **Aiuto › Email** |
| Far **tradurre i commenti** dei clienti nella lingua di chi guarda, o offrire **«Aggiungi al wallet»** | chiavi sul server: [sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello) |

## 4. Ogni giorno: cinque minuti

0. **Un tour preso fuori dal sito?** In fondo all'**Agenda**, *Un tour preso fuori dal sito?*: scrivi cosa è (per esempio «Tour privato, famiglia Rossi»), il giorno (o da—a se dura più giorni), *tutto il giorno* oppure le ore, e le note (contatto, punto d'incontro). Quelle ore **spariscono subito dalle disponibilità del sito**. Compare in agenda (calendario ed elenco) con la scritta *Non prenotabile*; se si sovrappone a una prenotazione già presente il sito te lo dice. Per toglierlo, **Elimina** (quel giorno) o **Elimina tutti i giorni**.
0. **Una prenotazione presa da un'agenzia fuori dal sito?** In fondo all'**Agenda**, sotto *Un tour preso fuori dal sito?*, premi **Registra una prenotazione di un'agenzia**. Scegli l'**agenzia** (c'è una barra di ricerca nell'elenco; se non è registrata scegli **＋ Nuova agenzia** e scrivi nome, referente ed email: il sito crea il suo account e ti mostra **una sola volta** una **password provvisoria** da comunicarle (l'agenzia può poi cambiarla da sola con **Password dimenticata?** nella pagina di accesso, che le manda un collegamento per email valido un'ora)), il **servizio**, data, ora, persone (e le ore, nei servizi a ore a scelta) e il **prezzo di vendita concordato** (se lo lasci vuoto vale la sua tariffa). Puoi segnarla **già pagata** e inviarle la **conferma con il voucher**. La prenotazione compare nell'agenda, nella sezione **Prenotazioni dell'agenzia** (con la pratica che scrivi) e tra le fatture da emettere, come se l'avesse fatta online. **Non controlla le disponibilità**: se per quelle ore avevi già messo un impegno in agenda, toglilo.
1. **Da fare** (in **Agenda › Da fare**, il numero accanto al nome conta le cose urgenti): una pagina sola con tutto ciò che aspetta te, per sezione e con il collegamento alla pagina giusta. *Da decidere*: richieste di proroga, partner da approvare, programmi da preparare. *Soldi e fatture*: rimborsi non riusciti, fatture scadute e non incassate, voci da fatturare oltre i 12 giorni, fatture emesse da trasmettere a SdI, fatture scartate, servizi svolti con pagamento sul posto ancora da incassare, bozze. *Da controllare*: calendari collegati che non si aggiornano. *In arrivo* (non contano nel numero): i servizi di oggi e di domani (con cosa incassare sul posto), le opzioni che scadono entro 48 ore, le agenzie in lista d'attesa. Se non c'è nulla, la pagina dice *Tutto a posto*.
2. **Scheda del giorno** (**Agenda › Scheda del giorno**; senza una data apre *domani*): per ogni servizio, in ordine d'orario, tutto ciò che serve per farlo: persone e lingua, **punto d'incontro** (con la mappa), tema scelto, **contatti** del cliente o — per le agenzie — dell'agenzia e del suo referente, note del cliente, **le tue note**, come ha pagato e **quanto incassare sul posto**; più le giornate dei programmi di più giorni e gli impegni fuori dal sito, e in alto il riepilogo (servizi, persone, da incassare). In cima ci sono *giorno prima/dopo*, *Oggi*, *Domani*, **Stampa**, **PDF** (da tenere sul telefono) e **Invia a me**. La **sera prima** (alle 18, regolabile in **Sito › Impostazioni › Regole di prenotazione › Ora della scheda del giorno dopo**) la scheda di domani **arriva da sola per email** all'indirizzo delle notifiche, con il PDF in allegato; non parte se domani non c'è nessun servizio, e si spegne con *Scheda del giorno dopo, per te*.
3. **Agenda** (la prima schermata): in alto vedi quanti servizi hai oggi, i programmi da preparare, i partner da approvare, le **opzioni** aperte e i pagamenti in corso. Sotto c'è l'agenda: si apre come **Calendario** del mese (tocca un giorno per vederlo qui sotto; le opzioni delle agenzie sono tratteggiate) e con **Elenco, 14 giorni** passi all'elenco dei prossimi 14 giorni con tutte le prenotazioni e le giornate dei programmi; il pannello ricorda la tua scelta. Se c'è un avviso rosso (calendario che non si sincronizza, voci da fatturare oltre i 12 giorni) toccalo: ti porta dove risolvere.
4. **Partner da approvare**: se c'è un numero, apri **Clienti › Partner** e rispondi (vedi [sezione 14](#14-partner-agenzie-dmc-tour-operator)). Il partner è avvisato per email.
5. **Programmi da preparare**: richieste di più giorni in attesa di una tua proposta ([sezione 12](#12-prenotazioni-annulli-e-programmi-di-più-giorni)).
6. **Fatture** (una o due volte a settimana): le prenotazioni svolte o pagate finiscono in *Da fatturare*; il termine consigliato per emettere è **12 giorni** ([sezione 13](#13-fatture)).
7. I clienti privati **e le agenzie** ricevono da soli un **promemoria la sera prima del tour** (alle 18:00, con orario, punto d'incontro, mappa e come contattarti): non devi fare nulla. Alle **agenzie** arriva anche, una sola volta, il promemoria **«tra poco la cancellazione non è più gratuita»** (24 ore prima della fine del periodo gratuito, solo se la prenotazione esisteva già a quel momento) e, per le opzioni, quello di **scadenza dell'opzione**; e si spegne o si sposta in **Sito › Impostazioni › Regole di prenotazione**.
8. Ogni nuova prenotazione, annullo o richiesta ti arriva **per email** all'indirizzo delle notifiche (si cambia in **Sito › Impostazioni › Attività e contatti**). Se le email non arrivano, guarda **Aiuto › Email**: lì il sito elenca quelle che ha tentato di inviare.

**Calendario sul telefono.** In fondo all'Agenda trovi un indirizzo privato da aggiungere come *calendario in abbonamento* a Google Calendar, Apple Calendar o Outlook: vedrai le prenotazioni confermate accanto ai tuoi impegni. Non condividerlo con nessuno.

## 5. Tour e servizi

Ogni tour è **dei clienti privati (B2C)** oppure **delle agenzie (B2B)**, mai dei due insieme, con **un solo prezzo**. Per questo il pannello ha due sezioni separate, così vedi subito quali sono gli uni e quali gli altri:

- **Sito › Tour B2C**: i tour che vede e prenota il pubblico, con il **prezzo al pubblico**. Le agenzie non li vedono.
- **Sito › Tour B2B**: i tour che vedono e prenotano solo le **agenzie approvate** (nella loro area riservata), con la **tariffa agenzie**. I privati non li vedono. Lo **sconto %** di un partner si toglie da questa tariffa.

Ogni elenco mostra il prezzo (o il rimando alle tariffe a ore) e lo stato (*visibile* / *nascosto*). Il sito mostra solo i tour visibili. Se vuoi offrire lo stesso servizio ai due pubblici, apri il tour e tocca **Duplica come tour B2B** (o **Duplica come tour B2C**): ottieni una copia nell'altra sezione, da ritoccare (soprattutto il prezzo).

**Dopo l'aggiornamento.** I tour che avevi con due tariffe sono diventati tour B2C (con il prezzo al pubblico) e per ciascuno è nata la copia **B2B «…-agenzie»** con la vecchia tariffa partner: le agenzie trovano gli stessi servizi agli stessi prezzi. Assistente, tour leader e meet & greet, nati solo per le agenzie, sono tour B2B. Il listino dedicato di un partner è passato alle copie B2B. Cancella le copie che non ti servono.

### Aggiungere un tour nuovo

1. **Sito › Tour B2C › Nuovo tour B2C** (o **Sito › Tour B2B › Nuovo tour B2B**). (Per partire da un tour simile apri quello esistente e tocca **Duplica**, oppure **Duplica come tour B2B/B2C**: ottieni una copia da ritoccare.)
2. **Informazioni generali**
   - **Indirizzo web (slug)**: come compare nell'indirizzo, per esempio `gondola-al-tramonto` → `…/tours/gondola-al-tramonto`. Solo lettere minuscole, numeri e trattini; **dopo la creazione non si cambia**.
   - **Ordine nell'elenco**: non c'è nessun numero da scrivere. Un tour nuovo va **in fondo**; per spostarlo apri la sua sezione (**Sito › Tour B2C** o **Tour B2B**) e **trascinalo** dalla maniglia ⠿ a sinistra (con il dito o il mouse; con la tastiera o le frecce ▲ ▼ se preferisci). L'ordine si salva da solo e vale subito anche sul sito.
   - **A chi è rivolto**: *Clienti privati (B2C)* oppure *Agenzie (B2B)*. Un tour è dell'uno o dell'altro, con un solo prezzo; cambiarlo lo sposta nell'altra sezione.
   - **Visibile sul sito e prenotabile**: se lo togli il tour sparisce dal sito (per un tour B2B: dall'area delle agenzie); le prenotazioni già fatte restano.
   - **In evidenza**: la home ha due schede, *Guida privata* e *Tour di gruppo*; per ciascuna mostra la foto del tour «in evidenza» (se ce ne sono più d'uno, il primo; se nessuno, il primo dell'elenco).
   - **Tipo di servizio**:
     - *Partenze fisse, prezzo a persona*: tour in piccolo gruppo con orari stabiliti (per esempio 09:30 e 14:30). Più clienti possono prenotare la stessa partenza fino alla **capienza massima**. **La lingua del primo che prenota vincola la partenza**: se il primo sceglie *English*, quella partenza si può prenotare solo in inglese (nell'elenco si legge «in English»), così nel gruppo non finiscono persone che parlano lingue diverse. Se tutti annullano, la partenza torna libera per qualunque lingua. Una partenza diversa dello stesso tour può avere un'altra lingua.
     - *Servizio privato, prezzo a gruppo*: il cliente prenota tutta la fascia. Con **Orario libero** sceglie lui quando iniziare (ogni 30 minuti, nei tuoi orari di lavoro).
   - **Orari di partenza**: solo per le partenze fisse, separati da virgola: `09:30, 14:30`.
   - **Giorni in cui si svolge**: spunta i giorni della settimana.
   - **Durata** (ore e minuti) e **Persone al massimo**.
3. **Prezzi e regole**
   - **Prezzo**: *Prezzo fisso* (lo scrivi qui sotto) oppure **A ore**, per i servizi privati: il prezzo viene allora da **Sito › Tariffe a ore** ([sezione 6](#6-prezzi-tariffe-a-ore-sconti-e-buoni-regalo)) e non c'è nulla da scrivere in questa scheda.
   - **Prezzo al pubblico** (tour B2C) o **Tariffa agenzie** (tour B2B): a persona o a gruppo, secondo il tipo. Scrivi `35` o `35,50`. Il prezzo è **uno solo**. Per un tour B2B, i prezzi **dedicati a un singolo partner** si impostano nella sua scheda ([sezione 14](#14-partner-agenzie-dmc-tour-operator)).
   - **Cancellazione gratuita (ore prima)**: vale solo per questo tour; vuoto = la regola generale (**Sito › Impostazioni › Regole di prenotazione**).
   - **Si può pagare sul posto**: conta solo se il pagamento sul posto è consentito nelle Impostazioni (di default non lo è).
   - **Lingue in cui offri questo servizio**: compaiono nella scheda del tour e sono quelle tra cui il cliente sceglie la **lingua del tour** (nel calendario del tour e al pagamento, per i privati come per le agenzie). La *lingua della conferma* (quella delle email) è un'altra scelta: si può prenotare un tour in inglese e ricevere le email in italiano.
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
**Sito › Listino** mostra tutti i tour a prezzo fisso in due tabelle, **Tour B2C** (prezzo al pubblico) e **Tour B2B** (tariffa agenzie), con un solo importo modificabile per tour. Cambia gli importi e tocca **Salva i prezzi**. Vale per le **nuove** prenotazioni.

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

**Come si calcola.** Il prezzo di *N* ore è quello dello scaglione più grande che non supera *N*, più le ore in più × «Ogni ora in più», senza mai superare lo scaglione successivo. Si prenota a mezz'ore, fino a 8 ore (una giornata). Con le cifre iniziali: 5 ore di guida per un'agenzia = 300 € (4 ore) + 70 € = **370 €**; 3 ore al pubblico = 200 € + 90 € = **290 €**.

**Supplementi.** Si sommano al prezzo base e li calcola il sito dalla data e dall'orario scelti:
- **Festivo** (+20%) per domeniche e festività; **Superfestivo** (+50%) lo sostituisce a Natale, Capodanno e Pasqua. I giorni si elencano in *Quali giorni sono festivi* (giorno e mese, per esempio `25-04 01-05`; «pasqua» e «pasquetta» si calcolano da sole).
- **Notturno** (+30%) solo per le ore che cadono nella fascia (all'inizio dalle 20:00 alle 07:00), in proporzione. Per offrire orari serali o all'alba allarga gli orari in **Agenda › Disponibilità**.
- **Ore extra per le agenzie**: su un servizio a durata fissa l'agenzia può aggiungere ore extra, pagate alla tariffa «ora in più» e sempre sotto lo scaglione successivo: da 2 ore si può aggiungere **1** ora; da 4 ore **1, 2 o 3**; da 8 ore **nessuna**. Si sceglie nel preventivo e al pagamento (*Ore extra*); gli orari liberi e il totale seguono la durata scelta. I privati non le hanno.
- **Auricolari** (4 € a persona, solo servizio guida): sono **obbligatori da 9 persone in su** (fino a 8 non si pagano) e si sommano da soli al totale: non è una scelta del cliente. Il numero da cui scattano si cambia in *Tariffe a ore* (*Auricolari obbligatori: da quante persone*; le cifre già salvate restano quelle che hai impostato).

Le percentuali dei supplementi si calcolano sul prezzo base (già scontato, per un'agenzia con sconto) e si arrotondano all'euro. In fondo alla pagina, **Prova il calcolatore** apre quello che vedono i clienti.

**Le cifre iniziali** sono un punto di partenza, non una verità: guardano le tariffe di altre guide e associazioni di Venezia (singole guide intorno a 80–85 € l'ora; un'associazione 125 € l'ora, ora extra 150 €, festivi +20%, auricolari 4 € da 8 persone; un coordinatore: meet & greet 55 €, 4 ore 120 €, 8 ore 220 €, notturno +30%). Il listino per le agenzie sta un po' sotto le guide già avviate, quello al pubblico circa il 25% sopra.

| | Pubblico | Agenzie |
|---|---|---|
| **Guida**: 2 ore · 4 ore · 8 ore · ora extra | 200 · 380 · 700 · 90 € | 160 · 300 · 560 · 70 € |
| **Assistente**: 2 · 4 · 8 ore · ora extra | — | 80 · 110 · 200 · 32 € |
| **Tour leader**: 4 · 8 ore · ora extra | — | 140 · 250 · 36 € |
| **Meet & greet**: 1 ora · ora extra | — | 50 · 30 € |

**Chi vede cosa**
- Il pubblico vede i **tour B2C**: per i servizi a ore, solo il servizio guida con la colonna *Pubblico*, nella pagina **guida privata** (voce *Guida a ore* del menu) con il calcolatore.
- Le tariffe **Agenzie** non sono mai pubbliche: la pagina *Per agenzie* non le mostra (la vedono tutti, anche i clienti privati). Le agenzie le vedono **solo nella loro area riservata, dopo l'approvazione**: sono la **prima cosa** che compare nella home dell'area (vedi la [sezione 14](#14-partner-agenzie-dmc-tour-operator)), e prenotano solo i **tour B2B**.
- Lo **sconto %** del partner (**Clienti › Partner**) si toglie dalle **tariffe Agenzie** (le tariffe a ore e i tour B2B) e il prezzo scontato si **arrotonda sempre al multiplo di 5 € successivo** (per eccesso), senza mai superare la tariffa senza sconto. Esempi con il 15%: guida 2 ore 160 € → 136 € → **140 €**; 4 ore 300 € → **255 €**; 8 ore 560 € → 476 € → **480 €**. Lo sconto non si applica ai privati. Il [listino dedicato](#prezzi-dedicati-a-un-partner) per singolo tour non riguarda i servizi a ore.

**Come lo vede il cliente.** Dalla home, le due schede *guida privata* e *Tour di gruppo* aprono **l'elenco dei tour** di quel tipo (solo i privati, oppure solo i condivisi). Il cliente sceglie un tour e nella sua pagina trova il calendario: indica le **persone** (e, nei tour a ore, le **ore**), sceglie il giorno e vede gli **orari liberi con il prezzo** (festivo e notturno già compresi). Per offrire più tour tematici basta creare più tour (per esempio «Venezia classica» e «Angoli nascosti», ciascuno a ore con la sua durata, oppure con la durata a scelta).

**Un tour su misura per i privati** (il cliente sceglie giorno, ora di inizio e quante ore; il prezzo si calcola da solo). Si fa con gli strumenti che hai: **Sito › Tour B2C › Nuovo tour B2C** (o *Duplica* la «Guida privata»), *Servizio privato*, **A ore**, servizio *Servizio guida*, e spunta **Il cliente sceglie quante ore**. Poi:
- **Si paga a ore intere**: con questa spunta 2,5 ore costano come 3 (4,5 come 5); il servizio dura comunque 2,5 ore nel calendario. Senza la spunta le mezze ore sono proporzionali.
- **Festivi e notturno** scattano da soli dalla data e dall'orario (*Sito › Tariffe a ore*); non c'è nulla da impostare nel tour.
- **Scelta tematica**: nei testi di ogni lingua, *Scelta tematica del cliente*, una voce per riga (per esempio *Classici imperdibili (must-see)* e *Angoli nascosti (hidden gems)*; stesso numero e stesso ordine in ogni lingua). Spunta **Tra le scelte tematiche c'è anche «Altro»** per dare al cliente un campo di testo libero. Il cliente la sceglie al pagamento (è obbligatoria) e tu la leggi nell'email di avviso, nella scheda della prenotazione e sul voucher. La «Guida privata» iniziale ha già tutto questo.
- **Punto d'incontro scelto dal cliente**: spunta *Il cliente indica il punto d'incontro* (di base è già attiva nei tour il cui punto d'incontro dice «Concordato con te…»). Al pagamento il cliente scrive il nome del suo hotel o un altro punto; se lascia vuoto vale il punto standard, **Campo San Luca**. Lo vedi nell'email di avviso e nella scheda della prenotazione; il cliente lo trova nella pagina della prenotazione, nell'email, nel voucher e nel calendario.
- Il cliente indica la durata e l'orario di inizio (la fine si vede nel riepilogo: inizio + durata).

**Tariffe e tour sono la stessa cosa.** Ogni tour *A ore* prende il prezzo **dalla tabella**, sempre: se cambi la guida di 2 ore da 200 a 180 €, il tour di 2 ore (e il preventivo, e il prezzo che vede il cliente) passa a 180 € da solo. Per questo conviene creare i servizi privati come tour *A ore*: con **durata fissa** (per esempio 2 ore, o 3 per un itinerario) è un «pacchetto» a prezzo sempre allineato; con **«Il cliente sceglie quante ore»** è il calcolatore, con ore in più e supplementi. Il pannello ti fa vedere il prezzo di oggi accanto a ogni tour a ore (elenco e scheda) e, in **Sito › Tariffe a ore**, sotto ogni servizio, *quali tour lo usano*. Un servizio privato a **prezzo fisso** invece non segue la tabella: il pannello lo segnala (nell'elenco, nella scheda e in cima alle tariffe) perché è l'unico modo di avere due prezzi diversi per lo stesso servizio.

**I servizi sono «tour» a ore.** In **Sito › Tour B2C** o **Tour B2B**, nel campo *Prezzo* scegli *Prezzo fisso* oppure *A ore*; per quelli a ore indichi il servizio (guida, assistente…), se *Il cliente sceglie quante ore* (altrimenti la durata è fissa, come per un itinerario di tre ore) e *A chi è rivolto* (B2C: i privati con le tariffe *Pubblico*; B2B: le agenzie con le tariffe *Agenzie*). Un servizio a ore per i privati e uno per le agenzie sono due tour distinti: usa **Duplica come tour B2B**. Un itinerario a durata fissa usa le tariffe della guida per quella durata.

**Dopo la prenotazione.** Il calendario blocca la fascia (le ore più la pausa); email, voucher, fattura e scheda della prenotazione riportano ore e supplementi (per esempio «4 ore, festivo +20%, auricolari»). Per i servizi lunghi conviene una **politica di annullo** dedicata alle agenzie (**Clienti › Partner › Politica di annullo**): un blocco di otto ore è difficile da riempire all'ultimo minuto.

> **Quanto resta in tasca? (indicativo: lo confermi col commercialista).** Pensa ai prezzi *al netto* di imposte e contributi. Con la Partita IVA in **regime forfettario** da gennaio 2027:
> - **Imposta sostitutiva**: **5%** per i primi cinque anni di una nuova attività (se negli ultimi tre anni non hai avuto altre attività e i ricavi restano sotto gli 85.000 € l'anno), poi **15%**. L'età non dà altri vantaggi.
> - **Base di calcolo**: l'imposta si applica a una percentuale degli incassi (**coefficiente di redditività**). Per le guide è il **67%**, legato al vecchio codice ATECO 79.90.20; il nuovo codice è **79.90.01** e finché non esce la nuova tabella si usa il vecchio abbinamento (alcune guide online riportano il 78%: chiedi quale vale per te nel 2027). Le spese vere **non** si deducono.
> - **Contributi INPS (Gestione Separata)**: circa il **26%** del reddito imponibile (26,07% nel 2026). Se vuoi, in fattura puoi addebitare la **rivalsa del 4%** (Impostazioni › Fatturazione elettronica).
> - **Bollo** da 2 € sulle fatture sopra 77,47 €.
> - **Esempio**: su 100 € incassati restano circa **80 €** con l'imposta al 5% e circa **75 €** al 15% (con il 78%: circa 77 € e 71 €), prima delle spese che sostieni tu (auricolari, trasporti, assicurazione, telefono, quote). Quindi **85 € l'ora lordi sono circa 68 € netti** con il 5%.
> - Oltre gli 85.000 € l'anno si esce dal forfettario l'anno dopo (oltre 100.000 € subito). Se hai anche un lavoro dipendente c'è un limite sul reddito da lavoro dipendente: chiedi.

### Prezzi dedicati a un partner
**Clienti › Partner** › il partner › **Listino dedicato**: per ogni tour puoi scrivere il prezzo che **solo quel partner** paga. Lascia vuoto per applicare la tariffa del tour meno lo sconto percentuale del partner, se c'è. Qui compaiono solo i **tour B2B**. Puoi **copiare il listino da un altro partner**.

**Quale prezzo vale per un partner?** In quest'ordine: 1) il **prezzo dedicato** per quel tour B2B (così com'è scritto); 2) altrimenti la **tariffa** del tour B2B meno lo **sconto %** del partner (se c'è), arrotondato al multiplo di 5 € successivo e mai oltre la tariffa. Nella colonna *Applicato* vedi sempre il prezzo che il partner vedrà.

### Codici sconto e buoni regalo
**Clienti › Sconti**:
- **Invita un amico** (si decide **per ogni tour condiviso**, nella scheda del tour: la spunta *Chi prenota può invitare un amico* e lo *Sconto per l'amico (%)*; vuoto = lo sconto generale di **Sito › Impostazioni › Invita un amico**): i clienti privati che hanno prenotato un **tour condiviso a posti** vedono, nella pagina della prenotazione (e in un invito nell'email di conferma), il riquadro *Invita un amico*, finché la partenza non è iniziata e c'è ancora posto. Ogni invito è un **codice sconto tutto suo** (tipo `AMICO-7K2XQ9`), valido **una sola volta**, solo per **quel tour e quel giorno**, e non vale per chi lo ha mandato. Se il cliente scrive l'email dell'amico, la spedisce il sito (nella lingua del tour, con il collegamento che porta dritto a quella partenza con il codice già inserito); altrimenti copia il collegamento o lo manda su WhatsApp. L'amico si unisce nella stessa lingua del gruppo. Lo sconto, il numero di inviti per prenotazione e l'interruttore sono in **Sito › Impostazioni › Invita un amico**; i codici sono automatici e in questo elenco compare solo il conteggio. **Contro gli abusi** (invitare sé stessi e poi annullare il posto a prezzo pieno): se chi ha invitato annulla dopo che un amico ha già prenotato col suo invito, dal suo rimborso si trattiene **lo sconto dell'amico** (se non ha ancora pagato, quella somma resta dovuta come penale). Lo vede prima di annullare. Gli inviti non ancora usati si spengono con l'annullo. Se vuoi essere gentile, dall'admin puoi annullare con *rimborso completo*.
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
**Agenda › Prenotazioni**: schede *Prossime*, *Opzioni*, *Passate*, *Annullate*, *Tutte* e ricerca per nome, email o codice. Tocca una prenotazione per vedere tutto:

- **Prenotazione**: tour, data, orario, persone, prezzo, **metodo e stato del pagamento**, politica di annullo e, per i privati, il **Promemoria al cliente** (parte da solo la sera prima; non serve se la prenotazione è stata fatta meno di 24 ore prima) e la **richiesta di recensione** (il giorno dopo il tour). Per entrambi puoi **Invia ora** o **Non inviare**.
- **Apri come la vede il cliente**: la pagina privata del cliente (da lì si prova anche l'annullo).
- **Voucher PDF**, dati del **Cliente** (telefono, WhatsApp), **Note del cliente**, riferimento pratica e dati fattura.
- **Note interne**: solo per te. **Salva note**.
- **Segna come incassata**: per le prenotazioni a fattura o con pagamento sul posto, quando i soldi arrivano.
- **Modifica persone, data, ore o prezzo**: cambia la prenotazione come decidi tu, con anteprima, email al cliente e storico ([sotto](#modificare-una-prenotazione-persone-data-orario-ore-prezzo)).
- **Opzione** (solo per le agenzie): la scheda ha **Prolunga la scadenza** e **Rilascia la data**: vedi [Opzioni](#opzioni-tenere-una-data-senza-pagare).

### Modificare una prenotazione (persone, data, orario, ore, prezzo)
Un cliente chiama: «siamo in sei invece di quattro», «possiamo spostare al pomeriggio?». Nella scheda di una prenotazione confermata o di un'opzione tocca **Modifica persone, data, ore o prezzo**. Qui **decidi tu**: non valgono il preavviso minimo né i limiti delle modifiche che l'agenzia fa da sola (vedi [sotto](#cambiare-persone-data-o-ore-da-soli-e-chiedere-una-proroga)).

- **Cosa puoi cambiare**: **persone**, **data**, **orario**, **durata** (servizi a ore) e **prezzo**. Cambia solo ciò che ti serve: il resto resta com'è.
- **Anteprima, poi applica**: **Anteprima** non scrive nulla e mostra prima e dopo (persone, data, orario, totale), la differenza e cosa succede ai soldi; se qualcosa non va dice perché. **Applica la modifica** la fa.
- **Il prezzo**: *Dal listino* lo ricalcola con le stesse tariffe di una prenotazione nuova quando cambiano persone, ore o orario (se non cambia nulla che conti, resta quello di adesso). Con *Prezzo concordato* scrivi tu l'importo: da quel momento **non si ricalcola più da solo** (anche cambiando le persone) finché non scegli di nuovo *Dal listino*. Le righe del preventivo di un servizio a ore (ore, festivo, notturno) restano. Con un **codice sconto** il prezzo non si ricalcola da solo: scrivi tu il nuovo importo.
- **La disponibilità**: se sposti o aggiungi persone, il sito controlla che ci sia posto (senza contare il gruppo stesso). Spuntando **Non controllare la disponibilità** salti il controllo, per quando hai già deciso tu (come per le prenotazioni registrate a mano).
- **Le scadenze di annullo**: spostando la data **ripartono dalla nuova data** (le stesse condizioni, contate dal nuovo giorno), così un cliente che sposti tu non perde la cancellazione gratuita. Con **mantieni le scadenze di annullo di prima** restano quelle di prima. In un'**opzione** la scadenza non si allunga mai spostando la data (per allungarla c'è *Prolunga*); in un pacchetto in opzione scadono tutti i servizi insieme.
- **I soldi**: a **fattura** o **sul posto** (non ancora incassata) si aggiorna l'importo e basta. **Pagata con carta**: se costa **meno** la differenza **torna in automatico sulla carta**; se costerebbe **di più** non si può (la differenza non si incassa da qui: lascia il prezzo o abbassalo, e incassa il resto a parte). Se il rimborso sulla carta non parte, la modifica resta e compare **Rimborso da fare** in *Da fare* e nella scheda: rimborsa da Stripe e premi *Fatto, l'ho rimborsato*. **Già incassata** in altro modo, o pagata con **buoni regalo**: il prezzo non si cambia (data e orario sì).
- **Cosa non si può cambiare**: una prenotazione **già in una fattura** (anche solo in bozza: prima elimina la bozza, oppure emetti una nota di credito), annullata, scaduta o in attesa di pagamento. A **servizio iniziato** puoi ancora **correggere persone, ore e prezzo** (per fatturare il vero), non la data.
- **L'email**: con la spunta **Avvisa il cliente / l'agenzia** (accesa di base) parte un'email con i dati nuovi, il **voucher** e il **calendario** aggiornati, il tuo messaggio facoltativo e, se c'è, la riga sul rimborso. Il calendario in abbonamento dell'agenzia e la sua area si aggiornano da soli; se la data torna libera, la lista d'attesa fa il suo lavoro.
- **Lo storico**: in fondo alla scheda, *Storico modifiche* elenca ogni cambiamento (dalla guida o dall'agenzia) con ora, ciò che è cambiato e il tuo messaggio.

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

Se non scegli nulla, la sezione non compare. Se hai almeno **5 feedback**, sotto i commenti compare anche la **media di tutti i voti** ricevuti (non solo di quelli mostrati): è una scelta di correttezza, tienila così. Non scegliere solo i commenti da cinque stelle: sono commenti veri di clienti veri, anche quelli sinceri e misurati. Se vuoi rimandare alle recensioni pubbliche, metti l'indirizzo del tuo profilo Google o Tripadvisor in **Sito › Impostazioni › Buoni regalo, programmi e recensioni › Pagina con tutte le recensioni**: compare come *Leggi tutte le recensioni*. **Tradotti nella lingua di chi guarda.** Se hai attivato la traduzione automatica ([sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)), chi guarda il sito in inglese, spagnolo, giapponese o italiano legge ogni commento **nella sua lingua**, con la dicitura *Tradotto automaticamente* e il pulsante **Vedi originale**, che mostra il testo come l'ha scritto il cliente. La traduzione parte da sola, una volta per commento, **solo per i commenti che hai scelto di mostrare** (il feedback privato non esce mai dal sito); se il cliente cambia il commento, si rifà. In **Clienti › Feedback** una riga ti dice se la traduzione è attiva e l'eventuale ultimo errore. Senza chiave il sito mostra i commenti com'erano.

In Europa chi mostra recensioni deve poter dire che vengono da clienti reali: il sito lo dichiara (*commenti di clienti che hanno fatto il tour, pubblicati con il loro permesso*); per il resto chiedi al tuo consulente.

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

### Incassi dalla banca: l'estratto conto in CSV
Invece di segnare i bonifici uno a uno, **Conti › Fatture › Incassi dalla banca** legge l'estratto conto e ti propone quali fatture risultano pagate. Il sito **non è collegato alla banca**: tu scarichi il file, quando vuoi, e lo carichi qui.

1. Dal sito o dall'app della tua banca scarica i **movimenti in CSV** (bastano quelli dall'ultima volta). Si riconoscono i formati più comuni: separatore `;`, `,` o tabulazione; colonne *Data / Importo / Descrizione* (anche più colonne di testo, come *Operazione* e *Dettagli*) oppure *Dare / Avere*; importi all'italiana (`1.234,56`) o all'inglese (`1,234.56`); file con le lettere accentate di Windows. Se non riconosce le colonne te lo dice, e puoi incollare il testo a mano.
2. **Scegli il file** (si legge nel tuo browser) oppure **incolla il contenuto**, poi **Controlla i bonifici**. Il file **non viene conservato** e **nulla cambia finché non confermi**.
3. Il sito guarda solo gli **accrediti** (le uscite sono ignorate), cerca nella descrizione il **numero di una fattura** («Fattura 12/2027», la causale che l'agenzia trova nella pagina di pagamento e sul PDF) e confronta l'importo con ciò che **resta da pagare**. I bonifici sono raggruppati in ordine di sicurezza:
   - **Da segnare come incassate** (già spuntate): numero e importo coincidono, anche quando **un solo bonifico paga più fatture** (la somma torna).
   - **Probabili**: manca il numero, ma l'importo coincide con **una sola** fattura e nel testo c'è il nome dell'agenzia. Spunti tu.
   - **Da controllare**: il numero c'è ma l'importo è diverso (un acconto, una differenza, commissioni): segnala incassata solo se è saldata davvero.
   - **Solo l'importo**: nessun numero né nome, coincide soltanto la cifra: guarda chi ha pagato prima di spuntare.
   - **Più fatture con lo stesso importo**: scegli, con il pulsante, a quale appartiene il bonifico.
   - **Già incassate**: la fattura citata è già a posto, non serve fare nulla. In fondo, chiusi, gli **accrediti senza fattura** (incassi con carta di Stripe, rimborsi, altro).
4. Controlla le spunte, lascia o togli **Avvisa le agenzie che il pagamento è arrivato** (è la stessa ricevuta per email di quando segni un incasso a mano) e tocca **Segna come incassate le fatture selezionate**. Ogni fattura risulta *Incassata* con bonifico **alla data in cui il denaro è arrivato** (mai nel futuro), le sue prenotazioni risultano pagate e l'estratto conto dell'agenzia lo vede. Una fattura già incassata, stornata o non trovata viene saltata, e il messaggio finale ti dice quante. Se ti sei sbagliato: **Annulla l'incasso registrato** nella scheda della fattura.

Il sito non spunta mai da solo un caso dubbio, e una stessa fattura non si incassa due volte, nemmeno ricaricando lo stesso estratto. Il file può avere al massimo circa **due milioni di caratteri**, più che sufficienti per un anno di movimenti.

## 14. Partner (agenzie, DMC, tour operator)

**Clienti › Partner** elenca le aziende registrate (*Tutti* · *Da approvare* · *Approvati*). Le agenzie si registrano da `…/b2b` → *Richiedi accesso partner*.

### Approvare un partner
1. Apri la richiesta: vedi dati aziendali (Partita IVA, SDI/PEC), referente e messaggio.
2. In **Stato e pagamento** scegli **Stato**: *Approvato*, *Rifiutato* o *Sospeso*; imposta lo **Sconto su tutto il listino (%)** (vale per i tour senza prezzo dedicato) e se **può pagare a fattura / bonifico**; aggiungi **Note interne**. **Salva**.
3. Il partner riceve un'email e può entrare nella sua area (vedi sotto). Se scegli **Sconto %**, lo sconto si toglie dalle **tariffe agenzie** (tour B2B e tariffe a ore) e il prezzo scontato si **arrotonda sempre al multiplo di 5 € successivo** (mai oltre la tariffa).

### L'area riservata dell'agenzia
L'agenzia entra da **Login agenzie** (il pulsante in alto, accanto a *Prenota*; sul telefono è l'icona della persona): da lì può anche **chiedere la registrazione**. Una volta dentro trova un'area **pulita**, pensata per lavorare in fretta: niente blog, *Chi sono*, tour o prezzi al pubblico.

- **Il tariffario, per primo**: la home dell'area apre con le **sue tariffe a ore** (con il suo sconto già applicato): mezza giornata e giornata intera per guida, assistente, tour leader e meet & greet, **ore supplementari**, **supplemento festivo** e **auricolari**. Sono solo i prezzi delle disponibilità orarie, in evidenza; sotto, le sue condizioni (sconto, annullo, opzioni).
- **Poi**: i pulsanti **Nuova prenotazione**, **Date libere** (il calendario dei giorni liberi, [sotto](#date-libere-e-lista-dattesa)), **Logo e documenti** ([sotto](#documenti-per-il-cliente-finale-logo-voucher-e-preventivo)) e **Calcola un preventivo** (i servizi a ore), e un **riepilogo**: prossime partenze (con le persone), opzioni aperte (e quando scade la prima), partenze del mese con il loro importo, e **quanto resta da saldare**.
- **Pacchetto**: per prenotare **più servizi insieme** (una sola opzione, un solo pagamento, una sola fattura) c'è **Aggiungi al pacchetto** nel riepilogo di ogni servizio; vedi [Pacchetti](#pacchetti-più-servizi-nella-stessa-pratica).
- **Elenco o Calendario**: sopra le prenotazioni due pulsanti, *Elenco* (predefinito) e *Calendario*: il calendario mostra il mese con le pratiche di ogni giorno (le opzioni tratteggiate; si tocca un giorno per vederlo sotto) e la scelta si ricorda.
- **Estratto conto**: in **Fatture › Estratto conto** l'agenzia vede mese per mese saldo, fatture, note di credito, incassi, ciò che resta da pagare e i servizi, con PDF e CSV; può riceverlo anche per email a inizio mese ([sotto](#estratto-conto-mensile)).
- **Calendario sul telefono**: in fondo alla pagina *Prenotazioni* c'è un **indirizzo privato** da aggiungere come *calendario in abbonamento*: le opzioni (con la scadenza) e le prenotazioni confermate dell'agenzia compaiono accanto ai suoi impegni e si aggiornano da sole ([sotto](#calendario-sul-telefono-per-le-agenzie)).
- **L'elenco delle prenotazioni** (*In arrivo · Opzioni · Passate · Annullate · Tutte*): per ogni pratica il **nome della pratica** (il riferimento che l'agenzia ha scritto), il nominativo, il tour, la data di partenza e quella in cui è stata prenotata, lo stato e il totale. C'è la **ricerca** per nome del cliente, pratica o codice, e il filtro **per data di partenza e per data di prenotazione** (*Filtra per data*). Ogni riga ha **Apri**, **Voucher**, **Fattura** (quando è stata emessa) e, per le opzioni, **Conferma** e **Rilascia**. **Scarica l'elenco (CSV)** esporta quello che si vede, per la contabilità dell'agenzia.
- **La scheda della pratica**: voucher **senza prezzi** (PDF) da girare al cliente finale, **con il logo dell'agenzia** ([sotto](#documenti-per-il-cliente-finale-logo-voucher-e-preventivo)), un **preventivo PDF** per il suo cliente, fattura, annullo e, finché il servizio non è iniziato, la possibilità di **cambiare nominativo, riferimento pratica, telefono e note**: l'agenzia spesso prenota prima di conoscere il nome del cliente finale. Se su una prenotazione già confermata cambia nominativo, telefono o note **ricevi un'email** (se cambia solo il riferimento pratica, no).
- **Tariffe e condizioni**: soltanto le **sue** tariffe (mai quelle al pubblico), lo sconto, le condizioni di annullo e le regole delle opzioni. **Fatture**: le fatture e le note di credito emesse al suo account, in PDF, con l'importo ancora da saldare.
- **Esci**: chiude la sessione e porta alla **home del sito**. Anche mentre prenota (ricerca, preventivo, pagamento) l'agenzia resta in questa barra semplice.
- Nella **ricerca di disponibilità** l'agenzia ha due spunte: **Tour privati** (accesa) e **Tour condivisi** (spenta).

### Opzioni: tenere una data senza pagare
Un tour operator prima **quota il pacchetto al suo cliente finale**, che lo approva e paga, e solo dopo conferma i servizi. Per questo, oltre a prenotare, l'agenzia può **opzionare**: la data resta **trattenuta**, senza pagare e senza impegno, fino a una **scadenza**. Se l'agenzia non conferma, la data **si libera da sola** (e prima le arriva un promemoria): non resti con una data bloccata da un preventivo rifiutato.

- **Quanto dura** dipende da quanto manca al tour (più è lontano, più l'opzione dura). La tabella iniziale: tour fra almeno **60 giorni** → 14 giorni di opzione; **30** → 10; **14** → 5; **7** → 3; **3** → 1. Per un tour più vicino di 3 giorni non si opziona: si prenota direttamente. La tabella si cambia in **Sito › Impostazioni › Opzioni per le agenzie**.
- **Mai troppo tardi**: l'opzione scade sempre almeno **48 ore prima** del servizio (regolabile), così hai ancora il tempo di rivendere la data. Per esempio, con una durata fissa di 7 giorni e un tour fra 5 giorni, l'opzione dura 3 giorni (scade 48 ore prima).
- **Limite**: ogni agenzia può tenere aperte al massimo **5** opzioni insieme (regolabile; 0 = nessun limite), per non bloccarti l'agenda.
- **Per una sola agenzia** (**Clienti › Partner › Opzioni**): una **durata fissa** (per esempio 7 giorni per tutti i tour), un numero massimo diverso, oppure **togliere le opzioni**. Lasciando vuoto valgono le regole del sito.
- **Cosa fa l'agenzia**: al momento di pagare sceglie **Opziona senza pagare**. La pratica compare nell'elenco come *Opzione*, con la scadenza; da lì può **Confermare** (a fattura o bonifico → subito confermata; con carta → passa dal pagamento) o **Rilasciare**. Riceve un'email quando la data è trattenuta, un **promemoria** (di default 24 ore prima della scadenza, non per le opzioni brevissime) e un'email alla scadenza.
- **Cosa vedi tu**: l'opzione blocca lo slot (nessun altro lo può prenotare) e nell'**Agenda** è **tratteggiata** (nel calendario sul telefono compare come *OPZIONE*). **Agenda › Prenotazioni › Opzioni** le elenca. Nella scheda puoi **Prolungare** (da 1 a 14 giorni, mai oltre un'ora prima del servizio; l'agenzia è avvisata) o **Rilasciare la data**. Una opzione scaduta o rilasciata **non è un annullo**: nessuna penale e non entra nelle statistiche degli annulli. Ricevi un'email quando un'opzione nasce, scade o viene rilasciata.

> **Perché l'opzione e non «si paga quando non è più rimborsabile»?** Far pagare l'agenzia solo quando il tour diventa non rimborsabile significherebbe **addebitare la sua carta giorni dopo**, quando non c'è e non può rimediare: se la carta è scaduta o senza fondi ti ritroveresti con una data venduta e non pagata. L'opzione invece **non muove denaro** (niente rimborsi né storni) e non può fallire. Per chi paga a fattura non c'è nessun addebito automatico: la fattura parte dopo il servizio.

### Pacchetti: più servizi nella stessa pratica
Un tour operator di rado compra un servizio solo: per un gruppo servono, per esempio, una **guida** al mattino, un **meet & greet** all'arrivo e un **tour leader** per il resto. Con il **pacchetto** li prenota **insieme**, con **una sola opzione, una sola scadenza, un solo pagamento e una sola fattura**.
- **Come si fa (l'agenzia)**: nel riepilogo prima di prenotare, accanto a *Conferma prenotazione*, c'è **Aggiungi al pacchetto**. Il servizio entra nel pacchetto (**non blocca ancora nulla**) e l'agenzia torna alla pagina **Pacchetto** (in alto, accanto a *Nuova prenotazione*, compare un tasto con il numero dei servizi). Da lì aggiunge altri servizi (**Aggiungi un altro servizio**), toglie quelli che non servono e, quando è pronta, scrive i dati della pratica (referente, riferimento pratica, note, lingua) e sceglie: **Opziona il pacchetto senza pagare**, oppure **prenota** (a fattura o con carta). Un pacchetto può avere fino a **12 servizi**.
- **Tutti o nessuno**: i servizi si prenotano in un colpo solo. Se uno non è più libero, **non resta nulla a metà** e l'agenzia vede quale togliere. Due servizi dello stesso giorno non si possono sovrapporre (la guida è una sola, con la sua pausa tra l'uno e l'altro).
- **Un'opzione sola**: tutti i servizi scadono **insieme**, alla scadenza **più vicina** tra le loro (per esempio un servizio fra 47 giorni e uno fra 16: l'opzione dura 5 giorni). Il pacchetto conta come **una sola opzione** nel limite delle opzioni aperte. Si **conferma** o si **rilascia** dalla pagina del pacchetto (tutto insieme); se il cliente rinuncia a una sola data, quella si può **rilasciare da sola** dalla scheda del servizio, e le altre restano.
- **Un solo pagamento**: con la carta l'agenzia paga **una volta** la somma di tutti i servizi (una sola pagina di Stripe); se uno dei servizi non è più disponibile quando il pagamento arriva in ritardo, il pacchetto **non si conferma a metà** e si rimborsa l'intero importo. A fattura i servizi sono subito confermati.
- **Una sola email e un solo avviso**: l'agenzia riceve **un'unica email** con l'elenco dei servizi, **un voucher PDF per ciascuno** e **un solo file** per il calendario con tutti gli appuntamenti; anche promemoria di scadenza, scadenza, proroga e annullo sono **un solo messaggio per pacchetto**. Anche **tu** ricevi un solo avviso (*Nuovo pacchetto*, *Pacchetto in opzione scaduto*…).
- **Annullare**: dalla pagina del pacchetto l'agenzia annulla in una volta i servizi ancora rimborsabili (ognuno con la **sua** politica di annullo: rimborso, penale); quelli oltre il termine restano e si scrive a te. Il riepilogo arriva in un'unica email.
- **Cosa vedi tu**: ogni servizio resta una **prenotazione normale** (agenda, voucher, fattura, annullo funzionano come sempre), con il codice del pacchetto (*PT-…*) nella scheda, nell'elenco e in **Fatture › Da fatturare**: scegli le voci dello stesso pacchetto e **una sola fattura** le raccoglie. La proroga dell'opzione (**Prolunga la scadenza**) vale per **tutti i servizi del pacchetto**. Quando arriva un bonifico per un pacchetto, nella scheda di un servizio c'è **Segna incassato tutto il pacchetto**.

### Cambiare persone, data o ore (da soli) e chiedere una proroga
Il gruppo di un'agenzia cambia: due persone in più, un altro giorno, mezza giornata che diventa giornata. Per non farti scrivere ogni volta, l'agenzia può **cambiare da sola** persone, data od ore dalla scheda della sua pratica (**Cambia persone, data o ore**): sceglie, vede **gli orari liberi con il prezzo di ciascuno e la differenza**, conferma, e il **prezzo si ricalcola da solo** (stesse tariffe e stesso sconto di una prenotazione nuova). Riceve un'email con il riepilogo (e, se confermata, il **nuovo voucher** e il calendario aggiornato); tu ricevi un avviso con **prima e dopo**.
- **Un'opzione** si cambia liberamente, ma **spostare la data non allunga mai la scadenza** (se la nuova data è più vicina, la scadenza si accorcia; se è troppo vicina per un'opzione, non si può).
- **Una prenotazione a fattura** (non ancora incassata né fatturata) si cambia liberamente **fino alla fine del periodo gratuito**. Dopo si può solo **aumentare** (più persone o più ore) **sullo stesso orario**, se c'è posto: ridurre o spostare lo si chiede a te. Così non si aggira il termine di annullo con una riduzione all'ultimo momento.
- **Spostare la data non regala tempo di annullo**: le scadenze restano quelle assolute di quando si è prenotato (più avanti non si allungano; più vicino si avvicinano), e nell'elenco degli orari l'agenzia vede se con quella data l'annullo gratuito non varrebbe più.
- **Non si cambia da soli** (si scrive a te): prenotazioni **pagate con carta** (cambiare l'importo vuol dire rimborsare o incassare), **già pagate** a bonifico, con **fattura già preparata** (anche in bozza), con **prezzo concordato a mano** (quelle che registri tu dall'agenda con un prezzo) e servizi **già iniziati**. L'agenzia vede il motivo nella scheda.
- Ogni modifica resta registrata (prima/dopo) e i **promemoria** (la sera prima, fine annullo gratuito) **ripartono** per la nuova data.

**Proroga dell'opzione.** Se il cliente dell'agenzia ha bisogno di più tempo, nell'opzione (e nel pacchetto) c'è **Ti serve più tempo?**: l'agenzia sceglie quanti giorni (1–7) e può scrivere perché. **Tu** ricevi un'email e, nell'**Agenda**, un avviso (*N richieste di proroga da decidere*); nella scheda dell'opzione scegli **Approva** (anche con **giorni diversi** da quelli chiesti: l'agenzia riceve l'email *Opzione prorogata*) oppure **Non concedere** (l'agenzia riceve un'email e la scadenza resta quella). Una richiesta alla volta per opzione o pacchetto; se prolunghi di tua iniziativa, la richiesta aperta si chiude da sola. Per un pacchetto la proroga vale per **tutte** le sue date.

### Date libere e lista d'attesa
Prima l'agenzia doveva provare una data alla volta. Ora in **Nuova prenotazione** ci sono due schede: **Cerca per data** (come prima) e **Date libere**; il pulsante *Date libere* sta anche nella panoramica e nel menu sul telefono.

- **Il calendario del mese**: l'agenzia sceglie il **servizio**, le **persone** (e, dove serve, la **durata** per i servizi a ore e la **lingua** per i tour condivisi) e vede il mese giorno per giorno: **libero** (con quanti orari), **in opzione** (la data è tenuta da un altro operatore, o c'è un pagamento in corso), **completo**, **tua pratica** (la occupa una sua prenotazione). I giorni senza servizio (chiusi, passati, troppo vicini per il preavviso) restano spenti. Toccando un giorno compaiono gli **orari liberi**, che portano direttamente al pagamento (o all'opzione), e il numero di persone scelto viene portato avanti. Il calendario usa le stesse regole delle prenotazioni: orari di lavoro, chiusure, impegni privati e calendari collegati, pause tra un servizio e l'altro, posti rimasti e lingua della partenza. **Non rivela mai chi tiene una data.**
- **«Avvisami se si libera»**: se il giorno è *in opzione* o *completo*, l'agenzia lo segue: per **qualsiasi orario** o per **una partenza precisa**, per il suo numero di persone. Al massimo **10 avvisi attivi** per agenzia, senza doppioni. Ogni minuto il sito controlla: appena la data torna prenotabile per il suo gruppo (l'opzione di un altro è scaduta o rilasciata, una prenotazione è stata annullata…) l'agenzia riceve **un'email** con gli orari liberi e il collegamento per prenotare. **Nessuno la tiene da parte**: la ottiene chi prenota per primo (anche chi non è in lista). Se qualcun altro è più veloce, dalla sua lista può premere **Avvisami ancora**: torna **in fondo alla coda**.
- **La coda: chi è prima in lista è avvisata per prima.** Se più agenzie aspettano lo stesso servizio nello stesso giorno (e orari compatibili: un orario preciso e «qualsiasi orario» si contendono la stessa partenza), vengono avvisate **nell'ordine in cui si sono iscritte**: la prima riceve l'email con un **vantaggio di 24 ore** (*Sei stata avvisata per prima: hai tempo fino al…*), poi tocca alla successiva, e così via. La data **non viene bloccata** per nessuno: serve solo a non far partire la corsa di tutte nello stesso minuto, premiando chi ha chiesto per prima. Il vantaggio si salta (le agenzie partono insieme) quando: il **posto basta per più agenzie** (per i tour a posti: due gruppi da 2 e 3 persone in 10 posti), il **servizio è vicino** (meno di 72 ore: non c'è tempo di aspettare il proprio turno), oppure l'agenzia davanti **toglie l'avviso o prenota** (il turno passa subito alla successiva). Un servizio privato lo può prendere una sola agenzia alla volta: lì la coda è sempre in fila. Si regola in **Sito › Impostazioni › Lista d'attesa delle agenzie**: *Vantaggio per chi è prima in lista* (ore; **0 = gli avvisi partono a tutte insieme**, come prima) e *Servizio vicino: avviso a tutte insieme* (ore). Ogni agenzia vede in lista se è la prima (*Sei la prima in lista: sarai avvisata per prima*) o quante ne ha davanti, e fino a quando dura il suo vantaggio; tu in **Agenda › Lista d'attesa** vedi l'ordine (*prima in lista*, *dopo Lagoon DMC*) e chi ha il vantaggio in corso.
- **La sua lista d'attesa** (in fondo alla pagina *Date libere*): ogni avviso con il suo stato (*In attesa*, *Si è liberata il…*) e i pulsanti **Togli**, **Avvisami ancora** e **Vedi gli orari**. Un avviso sparisce da solo quando la data passa o quando l'agenzia prenota quel servizio in quel giorno. Un'agenzia sospesa non riceve avvisi.
- **Cosa vedi tu**: quando un'agenzia si mette in lista ricevi **un'email** con il servizio, il giorno, le persone e **chi tiene la data adesso** (con la scadenza dell'opzione): se ti serve puoi sentire chi ha l'opzione. In **Agenda › Lista d'attesa** trovi tutti gli avvisi attivi con chi li ha chiesti e **chi occupa la data**, e tre numeri (*In attesa*, *Avvisi inviati*, *Date recuperate*: prenotate dopo l'avviso, negli ultimi 90 giorni). Nell'**Agenda** compare un avviso (*N agenzie aspettano una data libera*) finché qualcuno aspetta.
- **A cosa serve a te**: una data tenuta in opzione che poi non si conferma non resta vuota. La parte tecnica non richiede nulla: le opzioni scadono da sole (vedi sopra) e la lista le rimette sul mercato nel giro di un minuto.
- **Limiti da sapere**: l'avviso dice che la data è *prenotabile*, non la riserva. Il calendario non mostra i prezzi (si vedono al pagamento) e per i servizi a orario libero indica solo *libero*, perché gli orari possibili sono tanti: si vedono toccando il giorno.

### Documenti per il cliente finale: logo, voucher e preventivo
Un tour operator non gira al suo cliente i documenti di un altro: li vuole **con il proprio marchio**. Per questo l'agenzia ha **Logo e documenti** (pulsante nella panoramica e nel menu sul telefono).

- **Cosa imposta l'agenzia**: il **logo** (PNG o JPEG, anche con sfondo trasparente; lo ridimensiona il browser e il sito lo ricontrolla: massimo 500 KB, forma ragionevole, leggibile), il **nome sui documenti** (se vuoto, la ragione sociale), i **recapiti** (email, telefono, sito), una **nota in fondo ai preventivi** (condizioni di annullo, IVA, validità…), il **ricarico predefinito** sui preventivi e come **arrotondare** i prezzi al cliente (all'euro, ai 5 € o ai 10 € successivi), e se mostrare il **logo sui voucher**.
- **Il voucher**: resta **senza prezzi** e senza i recapiti di chi ha prenotato, ma in alto a destra compare il **logo dell'agenzia** (l'intestazione resta quella della guida: è lei che svolge il servizio) e nella riga *Agenzia* il suo nome e i suoi recapiti. Vale anche per il voucher allegato all'email di conferma. Un voucher di un privato non porta mai il marchio di un'agenzia.
- **Il preventivo PDF**: nella scheda di ogni **pratica** o **pacchetto** (opzione o confermata) c'è il riquadro **Documenti per il tuo cliente**. L'agenzia scrive a chi è intestato (di partenza il riferimento pratica), il **ricarico** (%), come arrotondare, fino a quando è **valido** (di partenza la scadenza dell'opzione: la data è trattenuta fino ad allora), la **lingua** del documento (italiano, inglese, spagnolo o giapponese) e le **note per il cliente**; poi **Scarica il preventivo (PDF)**. L'intestazione è **dell'agenzia** (logo, nome, recapiti); per ogni servizio ci sono data, orario, persone, punto d'incontro e cosa è incluso, con il **prezzo al cliente**; in fondo il **totale**, le note, la nota fissa dell'agenzia e la riga *Servizi svolti da…* con il tuo nome.
- **Come si calcola il prezzo**: tariffa dell'agenzia (quella che paga a te, già con il suo sconto) **più il ricarico**, arrotondata per eccesso, **servizio per servizio** (così le righe sommano al totale). Con ricarico **0** il prezzo è la tariffa. **La tariffa dell'agenzia non compare mai** nel documento.
- **Cosa non fa**: non invia nulla al cliente (l'agenzia scarica il PDF e lo manda dalla sua posta), non registra i preventivi (non hanno un numero: si rifanno quando serve) e non dice nulla di fiscale sui prezzi dell'agenzia: l'IVA o altre note le scrive lei nella nota in fondo. I preventivi si fanno per pratiche **non annullate** (opzioni o confermate) e solo per le proprie.

### Calendario sul telefono per le agenzie
Un'agenzia con venti pratiche aperte non vuole ricordarsi a mente quando scade ogni opzione. In fondo alla pagina **Prenotazioni** trova il riquadro **Calendario sul telefono**: un indirizzo da incollare in **Google Calendar** (*Altri calendari › Da URL*), **Apple Calendar** (*File › Nuovo calendario in abbonamento*) o **Outlook** (*Aggiungi calendario › Da Internet*). Da quel momento il calendario si aggiorna da solo (di norma ogni ora; l'ultima parola sui tempi ce l'ha l'app).

- **Cosa contiene**: ogni **prenotazione confermata** e ogni **opzione ancora aperta**, da 30 giorni fa in avanti, con orario del servizio, tour, persone e riferimento pratica nel titolo; nella descrizione il codice della pratica, nome e telefono del cliente finale, lo stato e le note; come luogo il punto d'incontro; e un collegamento alla scheda della pratica. Le **opzioni** hanno il prefisso *OPZIONE* e risultano *provvisorie*.
- **La scadenza delle opzioni**: per ogni opzione c'è anche un **promemoria di un quarto d'ora all'ora esatta della scadenza** (*⏰ Scade l'opzione*): conferma o rilascia prima, poi la data si libera da sola. Un **pacchetto** ha **una sola scadenza**, con i servizi elencati una volta ciascuno.
- **Cosa non contiene**: opzioni scadute o rilasciate, pratiche annullate, prenotazioni di altre agenzie, prezzi. Le prenotazioni che l'agenzia ha spostato (persone, data, ore) cambiano da sole alla prossima lettura.
- **È privato, come un indirizzo segreto**: contiene una chiave lunga e casuale, perché le app calendario non sanno fare il login. Chi conosce l'indirizzo vede i clienti e le date di quell'agenzia, quindi non va condiviso. Se l'agenzia lo ha mandato a chi non doveva, o ha cambiato collega, tocca **Genera un nuovo indirizzo**: il vecchio **smette subito di funzionare** (l'app calendario mostrerà un errore finché non si aggiunge il nuovo).
- **Quando smette di funzionare**: se sospendi o rifiuti un partner, il suo indirizzo risponde *non trovato*. Il file è nella lingua dell'agenzia (quella con cui si è registrata) e ha un limite di richieste al minuto, perché non diventi un modo di indovinare gli indirizzi.
- **Nel pannello non c'è nulla da impostare**: la chiave nasce la prima volta che l'agenzia apre la pagina.

### Come pagano le agenzie
Per ogni partner decidi in **Clienti › Partner › Stato e pagamento** se **può pagare a fattura / bonifico**. Le agenzie hanno quindi:
- **Carta online** (sempre): su Stripe, rimborso automatico se annullano nei termini. Compare anche *Apple Pay*, *Google Pay*, *PayPal* o altro se li hai attivati in Stripe ([sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)).
- **Fattura / bonifico** (solo se lo consenti): la prenotazione è **confermata subito, senza pagare nulla**. Dopo il servizio la pratica compare in **Conti › Fatture › Da fatturare** e tu emetti la **fattura elettronica** (entro 12 giorni); l'agenzia paga con **bonifico entro la scadenza scritta in fattura** (**30 giorni** di default: **Sito › Impostazioni › Fatturazione elettronica › Scadenza delle fatture ai partner**). Quando arriva il bonifico tocca **Segna come incassata** nella scheda della fattura ([sotto](#pagamento-delle-fatture-iban-carta-e-solleciti)). Nella sua area l'agenzia vede l'importo ancora non saldato come **Da saldare** (e quanto è già scaduto).
- Se un'agenzia annulla oltre il termine gratuito, la **penale** (la parte non rimborsata) si fattura allo stesso modo.

### Pagamento delle fatture: IBAN, carta e solleciti
L'agenzia sa sempre **quanto, entro quando e come** pagare, senza scriverti.

- **Nella sua area › Fatture** ogni fattura ha lo **stato**: *Da pagare entro il…*, *Scaduta il…*, *Pagata il… con bonifico / con carta*. In alto compaiono l'importo ancora da saldare e, se ce ne sono, le fatture scadute. Il pulsante **Paga ora** (o **Come pagare**, se i pagamenti online non sono attivi) apre la **pagina di pagamento della fattura**: importo, scadenza, **intestatario, IBAN e banca** (con il pulsante **Copia**), la **causale** da scrivere (*Fattura 12/2027*), **Paga ora con carta** e il **PDF**.
- **La stessa pagina arriva per email**, con un link riservato che non richiede l'accesso: nella **copia di cortesia** della fattura, nell'**email di conferma** della prenotazione a fattura (una riga che dice come e quando si paga) e nei **solleciti**. Nella scheda di ogni prenotazione a fattura c'è un riquadro **Pagamento a fattura** (e, a fattura emessa, il link alla pagina di pagamento); la pagina del pacchetto offre **Paga ora con carta** per le sue date a fattura.
- **IBAN, banca e intestatario** si compilano in **Sito › Impostazioni › Fatturazione elettronica** (*IBAN per i bonifici*, *Banca*); l'intestatario è il nome dell'emittente. Senza IBAN la pagina dice di scriverti per le coordinate. La **causale** e l'IBAN stanno anche sul PDF della fattura.
- **Chi vuole saldare subito** paga con carta: dalla pagina della fattura, oppure — **prima ancora che la fattura esista** — dal pulsante **Paga ora online** nella scheda della prenotazione (o del pacchetto). La prenotazione risulta pagata con carta e, quando la fattura viene preparata, è già saldata. Se paga con carta una fattura già emessa, la fattura e le sue prenotazioni risultano **pagate** da sole, l'agenzia riceve la ricevuta e tu un avviso. Un secondo pagamento per lo stesso importo (due schede aperte) viene **rimborsato da solo**. Finché i pagamenti non sono attivi (*Incassi dal*, [sezione 20](#20-da-fare-prima-del-lancio-e-a-gennaio)) la carta non si offre: resta il bonifico.
- **Segnare un bonifico arrivato**: **Conti › Fatture › Emesse** › la fattura › **Incasso e solleciti**: scegli il giorno in cui è arrivato e *Bonifico* o *Altro*, poi **Segna come incassata**. Le prenotazioni della fattura risultano pagate e l'agenzia riceve una ricevuta; nell'elenco la fattura passa a *Incassata*. Se sbagli, **Annulla l'incasso registrato** (non per i pagamenti con carta: lì serve un rimborso da Stripe e una nota di credito).
- **Solleciti automatici**: se la fattura è scaduta e non risulta incassata, l'agenzia riceve un'email con importo, IBAN, causale e il link per pagare con carta. Il **primo** parte **1 giorno dopo la scadenza**, poi **uno ogni 7 giorni, al massimo 3**; ogni invio arriva anche a te. Si regolano (o si spengono) in **Sito › Impostazioni › Fatturazione elettronica › Pagamenti e tempi** (*Solleciti automatici delle fatture scadute*, *Primo sollecito dopo la scadenza*, *Poi un sollecito ogni*, *Al massimo*). Nella scheda della fattura **Invia ora un sollecito** lo manda subito, anche prima della scadenza (un promemoria gentile). Nell'**Agenda** un avviso rosso ricorda *N fatture scadute e non incassate*.
- **Limite da sapere**: il sito non vede i bonifici sul conto: **li segni tu**, uno a uno dalla scheda della fattura o in blocco **caricando l'estratto conto** ([Incassi dalla banca](#incassi-dalla-banca-lestratto-conto-in-csv)). Se l'agenzia ha già pagato ma tu non l'hai ancora registrato, il sollecito la invita a ignorarlo e a rispondere con la data.

### Estratto conto mensile
Chi lavora con più fatture al mese vuole sapere, a colpo d'occhio, **quanto deve ancora** e a cosa si riferisce. Nella sua area, in **Fatture › Estratto conto**, l'agenzia sceglie un mese (frecce *Mese precedente / successivo*, *Mese in corso*) e vede:

- **Il riepilogo**: *saldo iniziale* (all'inizio del mese), **fatture emesse**, **note di credito**, **incassi** e *saldo finale* (a fine mese, o a oggi per il mese in corso), e — in rosso — quanto di quel saldo è **già scaduto**. Un saldo negativo è un **credito dell'agenzia** (ha pagato più del dovuto, o la nota di credito è arrivata dopo l'incasso): lo dice.
- **I movimenti del mese**, uno per riga e in ordine di data, con il saldo che cresce o cala: la fattura (con la scadenza), la nota di credito (e la fattura che storna), l'incasso (bonifico, carta, altro). Il numero della fattura apre il PDF.
- **Le fatture ancora da pagare** a fine mese, con scadenza e giorni di ritardo, il pulsante **Come pagare** (la pagina di pagamento, anche con carta) e le coordinate del bonifico con la causale.
- **I servizi del mese**, per data di servizio, con lo stato: *Fattura N/AAAA* (e se è incassata), *Pagato con carta*, *Da fatturare*, *In programma*, *Penale di annullo*. In calce un promemoria: **quanti servizi già svolti non sono ancora in una fattura**, e per quanto, così l'agenzia sa cosa le arriverà.
- **Scarica il PDF** (nella lingua dell'agenzia: italiano, inglese, spagnolo o giapponese, con intestazione e dati della guida) e **Scarica per il foglio di calcolo (CSV)** con saldo iniziale, movimenti e saldo finale, per la contabilità dell'agenzia.

**Come si calcola il saldo.** È la somma dei movimenti, e conta solo ciò che l'agenzia deve pagare *a te*: di una fattura entra **la parte ancora da pagare** (bonifico o contanti; ciò che aveva già pagato con la carta al momento della prenotazione no). Una **nota di credito** toglie fino a quanto restava da pagare su quella fattura (la parte pagata con carta si rimborsa sulla carta, non tocca il saldo); se storna la fattura per intero e non era ancora pagata, la fattura non è più da pagare nemmeno per il bollo. Un **incasso** toglie quanto era da pagare (con il bonifico, al netto delle note di credito già ricevute; con la carta, per l'intero). Le **bozze** e le fatture **scartate da SdI** non contano finché non sono emesse. Il sito non vede i bonifici sul tuo conto: **fino a quando non segni una fattura come incassata** (dalla sua scheda, o da **Incassi dalla banca**) per l'agenzia risulta ancora aperta.

**Email mensile (spenta di base).** In **Sito › Impostazioni › Regole di prenotazione** accendi **Estratto conto mensile alle agenzie** e scegli il **giorno** (da 1 a 28; di base il 3). Da quel giorno, alle 9 (Venezia), ogni agenzia approvata riceve l'**estratto conto del mese scorso** per email, nella sua lingua, con il PDF in allegato, il saldo, l'eventuale scaduto e il link alla pagina. Se lo accendi a metà mese, il mese scorso parte **subito** (alla prima occasione dopo le 9). Parte **una volta sola per agenzia e per mese**, e **solo se c'è qualcosa da dire** (movimenti nel mese o un saldo ancora aperto, anche a credito); se la posta non funziona riprova dopo mezz'ora. Ogni agenzia può **non riceverlo** con la spunta in fondo alla pagina *Estratto conto* (compare solo quando l'invio è acceso).

**Per te.** Nella scheda di un partner approvato (**Clienti › Partner**) il pulsante **Estratto conto** apre quello che vede l'agenzia, mese per mese, con PDF e CSV; in fondo **Manda ora** lo spedisce all'agenzia (utile per sollecitare un pagamento senza aspettare il mese dopo) e ti dice quando è stato mandato l'ultima volta.

### Listino dedicato
Nella stessa pagina, **Listino dedicato**: scrivi il prezzo per ogni **tour B2B** (vuoto = la tariffa del tour, meno lo sconto % se c'è). **Salva il listino**. I servizi **a ore** non compaiono qui: il loro prezzo viene da **Sito › Tariffe a ore**, con lo sconto % del partner. *Copia il listino da…* parte da un altro partner.

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

**Sito › Impostazioni** ha cinque sezioni, ciascuna con il suo pulsante **Salva questa sezione** (le modifiche valgono subito). Se un campo non è valido, nulla viene salvato e vedi quale correggere.

- **Attività e contatti**: nome del sito, nome per i documenti, email di contatto, **email che riceve le notifiche**, telefono, **WhatsApp** (solo cifre con prefisso, es. `393331234567`; vuoto = nascosto), Instagram, **Partita IVA**, abilitazione di guida turistica, indirizzo. Compaiono nel piè di pagina, nelle email, nei voucher e nei PDF.
- **Regole di prenotazione**: cancellazione gratuita per privati e partner (ore), preavviso minimo, anticipo massimo (giorni), pausa tra due servizi, passo degli orari liberi, blocco dell'orario durante il pagamento, **promemoria al cliente la sera prima** (sì/no e a che ora), **pagamento il giorno del servizio** (sì/no) e **Incassi dal** (la data di partenza degli incassi online: vedi [sezione 20](#20-da-fare-prima-del-lancio-e-a-gennaio)).
- **Opzioni per le agenzie**: se le agenzie possono opzionare, la **tabella** «tour fra almeno N giorni → opzione di D giorni» (fino a 5 righe), la scadenza al più tardi (ore prima del servizio), il numero massimo di opzioni aperte per agenzia e quanto prima della scadenza parte il promemoria. Vedi [Opzioni](#opzioni-tenere-una-data-senza-pagare).
- **Prenotazione ferma per le date lontane** (stessa sezione, *Opzioni per le agenzie*): per spingere le agenzie a **opzionare** invece di prenotare e poi dimenticarsi di annullare (liberandoti la data all'ultimo), se il servizio è fra più di **21 giorni** la prenotazione diretta è cancellabile gratis solo per **48 ore** dalla prenotazione; poi si rimborsa il **50%** fino al normale termine gratuito (per esempio 3 giorni prima), e dopo valgono gli scaglioni di sempre. Vale anche quando l'agenzia **conferma un'opzione** (le 48 ore ripartono da quel momento). Nel pagamento l'agenzia vede un avviso con le date e l'**opzione in evidenza** («Consigliato per le date lontane»). Giorni, ore e percentuale si cambiano lì; con l'interruttore spento torna il normale termine di cancellazione gratuita. Non vale per le prenotazioni che registri tu dall'agenda.
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

La copia **non contiene** la chiave dell'accesso a due passaggi né i codici di emergenza ([sezione 2](#sicurezza-del-pannello-due-passaggi-e-dispositivi)): restano solo sul server, e un ripristino non li cambia.

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
| `TRANSLATE_PROVIDER`, `TRANSLATE_API_KEY` | traduzione automatica dei commenti (`deepl` o `google`): vedi sotto |
| `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_KEY_FILE` | «Aggiungi a Google Wallet»: vedi sotto |
| `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_CERT_FILE`, `APPLE_WALLET_KEY_FILE`, `APPLE_WALLET_WWDR_FILE` | «Aggiungi ad Apple Wallet»: vedi sotto |

Le variabili che corrispondono ai campi di **Sito › Impostazioni** (contatti, regole, fatturazione…) restano valide come **valori predefiniti**: se un campo è stato cambiato dal pannello, vince il pannello. La sezione **Impostazioni** è l'unico posto da cui cambiarli.

**Pagamenti con carta, Apple Pay, Google Pay, PayPal.** Il pulsante dice *Paga ora online* perché il cliente paga su una pagina ospitata da **Stripe** e non solo con la carta: i metodi che attivi nella **dashboard di Stripe** (*Impostazioni → Metodi di pagamento*: carte, Apple Pay, Google Pay, PayPal, Klarna, bonifici online…) compaiono da soli, secondo il Paese e il dispositivo del cliente, senza toccare il sito. Scegli metodi **a conferma immediata**: quelli che confermano in giorni (addebito SEPA, bonifici) lasciano lo slot occupato in attesa. Il webhook di Stripe (`https://tuodominio.it/api/stripe/webhook`) va configurato una volta.

**Email sul tuo dominio (per esempio `tours@davidetomio.it`).** Un account **Posteo non permette di usare un dominio proprio**: gli indirizzi sono solo quelli di Posteo (`@posteo.net`, `.de`, `.eu`…; controlla sul loro sito se è cambiato). Non serve però cambiare provider per avere le notifiche (nuova prenotazione, richiesta di registrazione di un'agenzia, opzioni…): vanno **a qualsiasi indirizzo**, anche il tuo Posteo, impostato in **Sito › Impostazioni › Attività e contatti › Email che riceve le notifiche**. Per avere un indirizzo del tuo dominio:
- **per ricevere**: quasi tutti i registrar offrono l'**inoltro gratuito** (`tours@davidetomio.it` → il tuo indirizzo Posteo), così i clienti scrivono a un indirizzo professionale e leggi tutto in Posteo;
- **per inviare** le email del sito (conferme, voucher, fatture) con il tuo dominio come mittente serve un servizio di posta che lo permetta: una casella del dominio presso il tuo hosting/registrar, oppure un servizio di invio email (per esempio Brevo, Resend o Mailgun, con piani gratuiti per volumi piccoli). Inserisci i dati SMTP nelle variabili `SMTP_*` e il mittente in `MAIL_FROM=Davide Tomio <tours@davidetomio.it>`, e attiva **SPF e DKIM** del dominio (il servizio ti dice come) altrimenti le email finiscono nello spam.
Con Posteo come mittente (`MAIL_FROM` con un indirizzo `@posteo.net`) il sito funziona, ma i clienti vedono un indirizzo che non è il tuo dominio.

**Traduzione automatica dei commenti** (facoltativa). Serve una chiave di **DeepL** (piano gratuito: 500.000 caratteri al mese, di solito più che sufficienti) o di **Google Traduttore**: imposta `TRANSLATE_PROVIDER=deepl` (oppure `google`) e `TRANSLATE_API_KEY=…`. Il sito traduce in background **solo i commenti che hai scelto di mostrare** e conserva le traduzioni; se il servizio non risponde riprova dopo un po' e nel frattempo mostra l'originale. I testi dei commenti pubblici vengono inviati al servizio di traduzione che scegli: citalo nella privacy.

**Wallet del telefono: «Aggiungi a Google Wallet» e «Aggiungi ad Apple Wallet»** (facoltativi, solo per i clienti **privati** con prenotazione confermata e servizio non ancora finito). Nella pagina della prenotazione compaiono i pulsanti per salvare un **pass** con tour, data, orario, punto d'incontro e un codice; si apre anche senza connessione e sul telefono compare al momento giusto. **Ogni piattaforma si accende da sola quando ha tutti i dati; senza, il pulsante non compare.** Il pass è una fotografia della prenotazione: se poi viene annullata, quello già salvato sul telefono non si aggiorna da solo.
- **Google Wallet** (gratuito): 1) crea l'**account emittente** nella *Google Pay & Wallet Console* (`pay.google.com/business/console`) e annota l'**Issuer ID**; 2) in *Google Cloud* crea un progetto, abilita la **Google Wallet API**, crea un **account di servizio** e scarica la sua chiave in formato **JSON**; 3) nella Wallet Console, in *Utenti*, aggiungi l'indirizzo dell'account di servizio; 4) metti il file JSON sul server (fuori dalla cartella pubblica) e imposta `GOOGLE_WALLET_ISSUER_ID` e `GOOGLE_WALLET_KEY_FILE=/percorso/chiave.json`. All'inizio Google lavora in **modalità prova**: solo gli account che aggiungi come *tester* nella Console possono salvare il pass; per aprirlo a tutti chiedi l'**accesso alla pubblicazione** dalla Console (Google controlla i dati dell'attività, in genere pochi giorni).
- **Apple Wallet** (richiede l'**Apple Developer Program**, 99 $ l'anno): 1) in *Certificates, Identifiers & Profiles* crea un **Pass Type ID** (per esempio `pass.it.davidetomio.prenotazione`) e genera il suo **certificato**; 2) scarica anche il certificato intermedio **Apple WWDR** (G4); 3) convertili in PEM sul tuo computer: `openssl x509 -inform DER -in pass.cer -out pass.pem`, `openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem` e, se hai la chiave in un file `.p12`, `openssl pkcs12 -in Certificati.p12 -nocerts -out pass.key` (se la chiave è protetta da una frase, indicala in `APPLE_WALLET_KEY_PASSPHRASE`); 4) metti i tre file sul server e imposta `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID` (lo trovi nel tuo account Apple), `APPLE_WALLET_CERT_FILE`, `APPLE_WALLET_KEY_FILE`, `APPLE_WALLET_WWDR_FILE`. **Il certificato scade dopo un anno**: allora il pulsante sparisce e va rinnovato dal tuo account Apple.
- Se un pulsante non compare, guarda i **log** del sito all'avvio: una riga `[wallet] … non attivo: …` dice che cosa manca o non va.

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
- **Con i due passaggi attivi il codice non viene accettato**: controlla che l'**ora del telefono sia in automatico** (un orologio sfasato di più di mezzo minuto non va), scrivi il codice che l'app mostra **adesso** (ognuno vale una sola volta: se lo hai appena usato aspetta il successivo) e che sia quello del pannello giusto se l'app ne ha più d'uno. Dopo **5 errori** il secondo passaggio si blocca per un po' (15 minuti la prima volta, fino a 6 ore): la pagina dice fino a che ora, e **durante il blocco non passa nulla**, nemmeno un codice di emergenza. Se non puoi aspettare e non hai né telefono né codici: `npm run admin:2fa-off` sul server ([sezione 2](#sicurezza-del-pannello-due-passaggi-e-dispositivi)).
- **Dopo un aggiornamento mi chiede di nuovo la password**: può capitare una volta quando cambia il modo in cui il sito riconosce le sessioni, o dopo aver cambiato `ADMIN_PASSWORD` o attivato i due passaggi. È normale.

**Ho cambiato qualcosa ma sul sito non lo vedo**
- Ricarica la pagina (sul telefono: chiudi e riapri il browser). Le modifiche dal pannello sono immediate; le **foto** hanno una copia in cache e il browser può mostrare la vecchia per qualche istante.
- Controlla di aver toccato **Salva** e di non aver ricevuto un messaggio rosso.
- Un tour **nascosto**, un articolo in **bozza** o scritto in un'altra lingua non compaiono.
- Hai modificato i file della cartella `content/` del codice? Dopo il primo avvio non vengono più letti: usa il pannello.

**Da computer non vedo il menu laterale (☰)**: è normale. Su uno schermo largo le voci stanno nella barra in alto; il menu laterale compare solo su schermi stretti (telefono, tablet o finestra ristretta) e contiene le stesse voci. Quando un'agenzia è dentro, la barra in alto mostra solo le sue voci di lavoro.

**Un'agenzia non riesce a cambiare persone, data o ore da sola**: la prenotazione è **pagata con carta**, **già incassata**, ha una **fattura già preparata**, ha un **prezzo concordato** da te, il servizio è **già iniziato**, oppure il **periodo di annullo gratuito è finito** (allora può solo aumentare persone od ore, sullo stesso orario). Nella scheda vede il motivo e può scriverti; se vuoi accontentarla tu, annulla la prenotazione scegliendo **senza penale** (*Rimborsa tutto*) e registrala di nuovo dall'agenda con le nuove persone o la nuova data.

**Un'agenzia non riesce a prenotare o opzionare il pacchetto**: un servizio non è più libero (lo vede segnato in rosso: lo toglie e riprova), due servizi si sovrappongono nello stesso giorno, oppure uno dei servizi è **troppo vicino** per l'opzione (si prenota direttamente) o ha superato il **limite** di opzioni aperte. Il pacchetto non si prenota a metà: se non riesce, nessun servizio viene bloccato.

**Un'agenzia non riesce a opzionare**: l'opzione non c'è se il tour è **troppo vicino** (meno di 3 giorni con la tabella iniziale), se l'agenzia ha già il **numero massimo** di opzioni aperte, se è **spenta per quell'agenzia** (**Clienti › Partner › Opzioni**) o per tutto il sito (**Impostazioni › Opzioni per le agenzie**). In tutti i casi l'agenzia vede il motivo e può prenotare direttamente.

**I pulsanti del wallet non compaiono**: sono solo per i clienti **privati**, con prenotazione **confermata** e servizio **non ancora finito**, e solo se hai configurato la piattaforma ([sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)).

**I commenti non vengono tradotti**: la traduzione è facoltativa e serve una chiave ([sezione 18](#18-online-aggiornamenti-e-cosa-non-si-cambia-dal-pannello)); riguarda solo i commenti che hai scelto di mostrare sul sito. Se il servizio dà errore, **Clienti › Feedback** mostra l'ultimo errore e il sito riprova da solo.

**Un prezzo o una regola non cambia per una prenotazione già fatta**: è voluto, ogni prenotazione conserva le condizioni di quando è stata creata.

**Le email non arrivano ai clienti / a me**
- **Aiuto › Email** mostra le email tentate. Se in alto c'è *«SMTP non configurato»* le email **non partono**: imposta le variabili `SMTP_*` e `MAIL_FROM` sul server.
- Usa un mittente del tuo dominio con SPF/DKIM, altrimenti finiscono nello spam. Chiedi ai clienti di controllare la cartella *Posta indesiderata*.

**Il cliente dice di non aver ricevuto il promemoria**: il promemoria parte solo per prenotazioni confermate fatte **almeno 24 ore prima** dell'inizio (clienti privati e agenzie). Nella scheda della prenotazione leggi lo stato (*inviato il…*, *non verrà inviato*, *parte la sera prima*). Se le email non partono in generale, vedi sopra.

**Un cliente ha pagato ma non ha la conferma**: guarda **Agenda › Prenotazioni** (tab *Tutte*, ricerca per email). I pagamenti con carta si confermano quando arriva l'avviso di Stripe (webhook): se **mai** funziona, controlla il webhook nella dashboard di Stripe. Se lo slot è stato preso nel frattempo il cliente viene **rimborsato in automatico** e avvisato.

**Il calendario collegato non si aggiorna**: **Disponibilità › Calendari collegati › Sincronizza ora**. Se non va, ricopia l'indirizzo segreto iCal da Google Calendar.

**Ho cancellato per errore un tour, un articolo o una pagina**: non c'è un cestino. Rimedio: la **copia di sicurezza** più recente. Con **Aiuto › Backup › Ripristina da una copia › Solo i contenuti** rimetti tour, articoli, pagine, testi e foto com'erano, senza toccare le prenotazioni (vedi [sezione 17](#17-backup-e-ripristino)); `contenuti.json` dentro lo zip contiene gli stessi testi in forma leggibile, se ti serve solo ricopiare qualcosa. Per i tour con prenotazioni il sito non permette l'eliminazione: si nascondono.

**Il sito è lento o non risponde**: è un problema del server o dell'hosting; guarda i *log* nel pannello dell'hosting e chiedi aiuto con le ultime righe di errore.

## 20. Da fare prima del lancio e a gennaio

### Prima di aprire la Partita IVA: riempire l'agenda senza incassare
Finché non hai la Partita IVA non puoi incassare, ma puoi già prendere **appuntamenti** per le date in cui lavorerai. È la modalità **pre-apertura**: la accendi scrivendo la data di apertura in **Sito › Impostazioni › Regole di prenotazione › Incassi dal** (per esempio il giorno in cui apri la Partita IVA) e **Salva questa sezione**. Finché quella data non arriva:

- il sito accetta prenotazioni **solo per le date da quel giorno in poi** (prima non lavori), e la home, la pagina *Prenota* e il pagamento lo spiegano con un avviso;
- **non si paga online**: niente carta, e **buoni regalo** e **acconti dei programmi** restano sospesi;
- i **clienti privati** prenotano **senza pagare** e saldano **di persona il giorno del servizio** (contanti o carta al punto d'incontro): la prenotazione è confermata subito, con voucher ed email;
- le **agenzie** prenotano **a fattura** (nessun pagamento) oppure **opzionano** la data ([Opzioni](#opzioni-tenere-una-data-senza-pagare));
- nell'**Agenda** un avviso azzurro ti ricorda che gli incassi non sono ancora attivi.

**Quando arriva la data degli incassi, il pagamento online si accende da solo**: i clienti che avevano prenotato per pagare di persona trovano nella pagina della loro prenotazione il pulsante **Paga ora online** (finché il servizio non è iniziato) e possono pagare in anticipo con il rimborso automatico, come tutti. Per riattivare subito gli incassi basta **svuotare** il campo *Incassi dal*.

> Questa è una funzione tecnica, **non un parere fiscale**: cosa si può fare prima dell'apertura (per esempio prendere prenotazioni per le date successive, senza anticipi) va **confermato dal commercialista**. Per le prenotazioni già prese prima dell'apertura, le fatture si emettono **dopo** la data di apertura: imposta anche **Prima data fatturabile** in *Fatturazione elettronica*.

**Prima del lancio**
- [ ] **Tour e prezzi veri** (Sito › Tour B2C, Tour B2B e Listino): i tour d'esempio sono segnaposto. Controlla orari, durate, punti d'incontro, lingue.
- [ ] **Tariffe a ore** (Sito › Tariffe a ore): le cifre iniziali sono un punto di partenza. Rivedi prezzi, supplementi e giorni festivi, **confermali col commercialista** e fai una prova col calcolatore (*Prova il calcolatore*).
- [ ] **Foto vere**: copertine dei tour, foto della home, il tuo ritratto in *Chi sono*, anteprima social (Sito › Immagini).
- [ ] **Testi**: rileggi *Chi sono*, gli articoli, le domande frequenti (Sito › Pagine, Blog, Testi).
- [ ] **Pagine legali** riviste dal commercialista o da un consulente.
- [ ] **Contatti**: email, telefono, WhatsApp, Instagram in **Impostazioni › Attività e contatti**.
- [ ] **Stripe**: prima in modalità test (carte di prova), poi **in modalità reale** con il webhook configurato; **SMTP** funzionante. Fai una prenotazione di prova e un rimborso (in reale, con un importo piccolo).
- [ ] **Orari di lavoro**, giorni di chiusura e **calendario personale** collegato (Agenda › Disponibilità).
- [ ] **Dominio e HTTPS**, `BASE_URL` corretto, disco persistente, **primo backup**.
- [ ] **Accesso a due passaggi** (Aiuto › Sicurezza): attivalo, **stampa i codici di emergenza** e conservali; scegli una password del pannello lunga e unica.
- [ ] Se parti **prima della Partita IVA**: scrivi la data in **Incassi dal** e fai una prenotazione di prova da privato (deve proporre solo il pagamento di persona) e da agenzia (fattura o opzione).
- [ ] Opzioni per le agenzie: guarda la tabella in **Impostazioni › Opzioni per le agenzie** e decidi se ti vanno bene i giorni e il limite.

**Quando apri la Partita IVA (gennaio)**
- [ ] In **Impostazioni › Attività e contatti**: **Partita IVA**, **abilitazione**, **indirizzo**, nome per i documenti.
- [ ] In **Impostazioni › Fatturazione elettronica**: dati del cedente, **regime** (forfettario o ordinario), **IVA e natura**, bollo, ritenuta/rivalsa, **IBAN**, **Prima data fatturabile** = giorno di apertura. **Fatti confermare ogni voce dal commercialista.**
- [ ] Decidi con il commercialista come trattare **clienti privati e stranieri**, **buoni regalo** e **penali di annullo**.
- [ ] Non emettere una fattura «di prova» su SdI (consumerebbe il numero 1): chiedi al commercialista come verificare il file prima.
- [ ] Imposta la **PEC** sul server se vuoi inviare a SdI da qui; altrimenti caricherai l'XML su *Fatture e Corrispettivi*.
- [ ] Se avevi usato *Incassi dal*: la data è passata (o il campo è vuoto), quindi controlla che nel pagamento compaia di nuovo **Paga ora online** e fai una prova con Stripe.

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
