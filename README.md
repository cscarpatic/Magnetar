# Magnetar

**Magnetar** è un duello 1 contro CPU basato su campi magnetici artificiali, giocabile direttamente nel browser.

- Il giocatore difende il lato destro; la CPU difende il lato sinistro.
- Entrambi possono avanzare fino a **2/3 del campo** partendo dal proprio lato.
- I generatori non hanno massa: la pallina e i campi possono attraversarne il centro senza collisione fisica.
- Ogni campo ha un **raggio finito** mostrato da cerchi concentrici.
- Vicino alle pareti gli anelli si comprimono, si accumulano lungo il bordo e il campo piega parte della propria azione parallelamente alla parete.
- La pallina rimbalza su alto e basso; se supera una parete verticale, il difensore di quel lato concede un punto.
- Primo a 7.

## Modalità

- **DUEL — Repulsore vs Repulsore**: modalità principale, rapida e diretta.
- **ORBIT — Attrattore vs Attrattore**: modalità tecnica basata sulla fionda. Un passaggio decentrato nella fascia orbitale riceve sia attrazione radiale sia una spinta tangenziale nello stesso verso del passaggio.
- **POLARITY — Attrattore vs Repulsore**: modalità asimmetrica sperimentale; il giocatore sceglie il proprio polo e la CPU usa quello opposto.

## Campi

Il **Repulsore** è più intenso vicino al nucleo e decade fino a zero al bordo del raggio attivo.

L'**Attrattore** ha un raggio leggermente maggiore e usa un profilo ad anello. Il centro resta quasi neutro, mentre la fascia luminosa intermedia è la zona di fionda. Se la pallina entra decentrata, il campo conserva il verso orbitale del passaggio e aggiunge accelerazione tangenziale: l'uscita può quindi essere molto più veloce dell'ingresso. Un passaggio perfettamente centrale non riceve questo bonus, così la fionda dipende dal posizionamento e non parte automaticamente.

Le pareti modificano soprattutto la **geometria** del campo: comprimono il raggio nella direzione normale e deviano parte dell'azione lungo il bordo, senza introdurre un grande bonus di potenza. Graficamente gli anelli si appiattiscono e si allungano lungo la parete; bande animate evidenziano la zona di pressione.

## Controlli

- Mouse / touch: trascina il generatore del giocatore.
- Tastiera: WASD oppure frecce.
- Spazio: pausa/riprendi.

## GitHub Pages

Il workflow in `.github/workflows/pages.yml` pubblica automaticamente il sito su GitHub Pages a ogni push su `main`.
