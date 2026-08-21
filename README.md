# Magnetar

**Magnetar** è un duello 1 contro CPU basato su campi magnetici artificiali, giocabile direttamente nel browser.

- Il giocatore difende il lato destro; la CPU difende il lato sinistro.
- Entrambi possono avanzare fino a **2/3 del campo** partendo dal proprio lato.
- I generatori non hanno massa: la pallina e i campi possono attraversarne il centro senza collisione fisica.
- Ogni campo ha un **raggio finito** mostrato da cerchi concentrici.
- Vicino alle pareti gli anelli si deformano e il campo piega parte della propria azione lungo il bordo.
- La pallina rimbalza su alto e basso; se supera una parete verticale, il difensore di quel lato concede un punto.
- Primo a 7.

## Modalità

- **DUEL — Repulsore vs Repulsore**: modalità principale, rapida e diretta.
- **ORBIT — Attrattore vs Attrattore**: modalità tecnica. L'attrazione è massima su una fascia intermedia e quasi neutra nel nucleo, così la pallina può attraversare il generatore e creare slingshot.
- **POLARITY — Attrattore vs Repulsore**: modalità asimmetrica sperimentale; il giocatore sceglie il proprio polo e la CPU usa quello opposto.

## Campi

Il **Repulsore** è più intenso vicino al nucleo e decade fino a zero al bordo del raggio attivo.

L'**Attrattore** usa invece un profilo ad anello: l'azione cresce entrando nel campo, raggiunge il massimo su una fascia intermedia e diminuisce verso un centro quasi neutro. Non esistono collisioni tra pallina e generatore.

Le pareti modificano soprattutto la **geometria** del campo: comprimono il raggio nella direzione normale e deviano parte dell'azione lungo il bordo, senza introdurre un grande bonus di potenza.

## Controlli

- Mouse / touch: trascina il generatore del giocatore.
- Tastiera: WASD oppure frecce.
- Spazio: pausa/riprendi.

## GitHub Pages

Il workflow in `.github/workflows/pages.yml` pubblica automaticamente il sito su GitHub Pages a ogni push su `main`.
