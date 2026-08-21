# Magnetar

**Magnetar** è un duello gravitazionale 1 contro CPU giocabile direttamente nel browser.

- Il giocatore difende il lato destro.
- La CPU difende il lato sinistro.
- Il giocatore sceglie **Attrattore** o **Repulsore**; la CPU assume automaticamente la polarità opposta.
- Entrambi possono avanzare fino a **2/3 del campo** partendo dal proprio lato.
- La pallina rimbalza su alto e basso; se supera una parete verticale, il difensore di quel lato concede un punto.
- Primo a 7.

## Controlli

- Mouse / touch: trascina il cerchio del giocatore.
- Tastiera: WASD oppure frecce.
- Spazio: pausa/riprendi.

## Fisica

La forza usa una legge tipo gravità con *softening* vicino al centro e un limite massimo di accelerazione/velocità. Questo conserva gli slingshot e le orbite senza creare singolarità numeriche o palline impossibili da vedere.

## GitHub Pages

Il workflow in `.github/workflows/pages.yml` pubblica automaticamente il sito su GitHub Pages a ogni push su `main`.
