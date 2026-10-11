# Schemi FatturaPA per i test

`Schema_FatturaPA_1.2.xsd` e `xmldsig-core-schema.xsd` servono solo ai test (`test/fatturapa.test.js`) per controllare che i file XML generati rispettino la struttura (ordine degli elementi, tipi, valori ammessi).

- Origine: schema FatturaPA 1.2.1 dell'Agenzia delle Entrate, copiato dal pacchetto npm `fatturapa`.
- Le uniche modifiche (elencate nell'intestazione del file) sono i valori `Natura` e `TipoDocumento` aggiunti dalle specifiche 1.2.2, necessari per il regime forfettario (`N2.2`).
- **Il controllo con lo schema non sostituisce quello del Sistema di Interscambio**, che applica anche regole di merito (coerenza degli importi, partite IVA, codici destinatario…).
