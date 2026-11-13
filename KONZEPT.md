# Trapanotto Kart 2 – Konzept

Stand: 13.11.2026. Neustart des Spiels, nichts wird aus dem alten Code übernommen. Die Tiere und ihre Item-Welt bleiben als Identität.

## Entscheidungen

| Thema | Entscheid |
|---|---|
| Plattform | Browser, Three.js mit WebGPU-Renderer, automatischer WebGL2-Rückfall |
| Welt | Flauschige Tiere, komplett neu gebaut und animiert |
| Gameplay | Klassischer Item-Party-Racer: viele Items, Chaos, leicht zugänglich |
| Geräte | Desktop und Handy (Touch, Grafikstufen) |
| Mehrspieler | Vorerst nur Einzelspieler; Splitscreen bleibt technisch vorbereitet |
| Assets | CC0-Texturen, Himmel und Sounds erlaubt; Figuren, Karts, Strecken bauen wir selbst |
| Repo | Das alte Spiel auf `main` wird überschrieben; der alte Stand wird vorher als Tag `v1-classic` markiert |
| Erster Meilenstein | Ein Cup mit 4 Strecken |

## Leitidee

**Keine Runde ist wie die vorige.** Jede Strecke ist eine inszenierte Fahrt mit drei Akten, und in jeder Runde passiert etwas, das die Strecke verändert. Dazu kommt Party-Chaos mit Items, das immer lesbar und fair bleibt.

## Säulen

### 1. Fahrgefühl

- Echte Physik: vier gefederte Räder, Gewicht, Kollisionen mit Strecke, Hindernissen und Gegnern. Fester Zeitschritt, damit Geister und Wiederholungen möglich sind.
- Drift mit drei Boost-Stufen, Tricks nach Sprüngen, Windschatten, Super-Start.
- Einsteigerhilfen: Auto-Gas und Lenkhilfe zuschaltbar, damit auch Kinder und Handyspieler mithalten.
- Kamera mit Tempo-Gefühl: Sichtfeld weitet sich beim Turbo, leichtes Nachziehen in Kurven, Wucht bei Treffern.

### 2. Items und Action

- Rund 12 Items aus der bestehenden Tierwelt (Eichel, Honig, Wollknäuel, Bienen, Seifenblase, Karotte und weitere), neu als physische Objekte mit grossen, klaren Effekten.
- Verteilung nach Platzierung: hinten starke Aufhol-Items, vorne Abwehr.
- Items lassen sich hinten halten und als Schutz einsetzen. Jeder Angriff hat eine Warnung und eine Abwehrmöglichkeit.
- Rempeln mit Gewicht, zerstörbare Streckenobjekte (Heuballen, Kisten, Eiszapfen), ein Rivale pro Rennen.
- Computer-Gegner mit Charakter (Angreifer, Verteidiger, Heisssporn, Konstant), die Fehler machen und Items taktisch einsetzen.

### 3. Strecken

Von Hand entworfene Splines mit wechselnder Breite, Steilkurven, echten Abzweigungen und riskanten Abkürzungen. Aus einer Streckendatei entstehen Fahrbahn, Kollision, Ideallinie für die Gegner und Platzierung der Kulisse.

Der erste Cup:

| Strecke | Charakter | Ereignisse pro Runde |
|---|---|---|
| Kleeblatt-Tal | Einstieg, breite Kurven, Bauernhof | Runde 2: Schafherde quert die Strasse. Runde 3: Scheunentor offen, Abkürzung durch die Scheune, Heuballen rollen |
| Bambus-Tempel | Technisch, eng, Höhenunterschiede | Runde 2: Regen setzt ein, Hängebrücke bricht stückweise. Runde 3: Tempeltor öffnet eine Route durch den Innenhof |
| Honigfabrik | Hindernisse, Förderbänder, Pressen | Die Honigflut steigt jede Runde und sperrt Spuren. Runde 3: Röhren-Kanone schiesst die Karts übers Dach |
| Gletscher-Gipfel | Schnelle Abfahrt, Eis, Finale | Runde 2: Eishöhle bricht auf. Runde 3: Lawine verschüttet die Hauptstrasse, Umleitung über den gefrorenen See |

### 4. Grafik

- PBR-Materialien mit echten Texturen, HDR-Himmel, Schattenkaskaden, Umgebungsverdeckung, Bloom, Bewegungsunschärfe, Nebelvolumen, GPU-Partikel, Wasser und Schnee mit eigenen Shadern.
- Stil: hochwertiges Spielzeug-Diorama. Figuren mit Skelett, Animationen und Gesichtsausdrücken, Fell als Shader.
- Drei Grafikstufen (Hoch, Mittel, Handy), automatisch gewählt und in den Optionen umstellbar. Ziel: 60 fps auf Mittelklasse-Grafikkarte, 30 bis 60 fps auf aktuellen Handys.
- Download-Budget für den ersten Cup: höchstens rund 30 MB, Strecken werden einzeln nachgeladen.

Ehrliche Einordnung: Ohne Art-Team wird das kein Fotorealismus. Erreichbar ist ein stilisierter Look auf dem Niveau eines sehr guten Indie-Titels. Weil das Spiel auch auf Handys laufen muss, sind die aufwendigsten Effekte der Stufe «Hoch» vorbehalten.

### 5. Audio

- Adaptive Musik pro Strecke, die mit Position und letzter Runde wächst.
- Geschichteter Motorsound, Tierstimmen, räumliche Effekte. Aufnahmen aus CC0-Quellen, Musik komponiert.

## Technik

- Vite, TypeScript, three.js (WebGPURenderer mit WebGL2-Rückfall), Rapier für Kollisionen und Physik.
- Simulation strikt getrennt von der Darstellung. Eingabe und Bildausschnitt pro Spieler gekapselt, damit Splitscreen später ohne Umbau dazukommt.
- Blender 5.2 ohne Oberfläche für Modelle, Animationen und Streckenkulisse; Export als glTF mit komprimierten Texturen.
- Automatische Prüfungen: Tests der Simulation, Streckenprüfung, ein Bot-Rennen pro Strecke (alle Gegner müssen drei Runden schaffen), Starttest im Browser.
- Alle Fremd-Assets mit Quelle und Lizenz in `LICENSES.md`.

## Umfang Meilenstein 1

- 4 Strecken, Grand Prix mit Punktewertung, Einzelrennen, Zeitfahren mit Geist.
- 8 Tiere (das Startfeld braucht 8 Karts), 3 Geschwindigkeitsklassen.
- Tastatur, Gamepad, Touch.
- Nicht enthalten: Splitscreen, Online, zweiter Cup, Spiegel-Modus.

## Umsetzung mit Opus-5.5-Subagenten

**Phase 0 – Fundament.** Repo aufsetzen, alten Stand markieren, Architektur, Schnittstellen und Streckenformat festlegen.

**Phase 1 – Kern, parallel.**

| Agent | Aufgabe |
|---|---|
| A | Fahrphysik, Steuerung, Kamera |
| B | Strecken-Pipeline und Strecke 1 (Kleeblatt-Tal) |
| C | Renderer, Licht, Nachbearbeitung, Grafikstufen |
| D | Tiere und Karts in Blender, Animationen |
| E | Items und Computer-Gegner |
| F | HUD, Menüs, Audio, Touch |

**Kontrollpunkt.** Strecke 1 ist spielbar. Du fährst sie und gibst Rückmeldung zum Fahrgefühl, bevor die übrigen Strecken entstehen. So bleibt ein Kurswechsel billig, obwohl der Meilenstein ein ganzer Cup ist.

**Phase 2 – Breite, parallel.** Strecken 2 bis 4, Grand Prix, Zeitfahren, Feinschliff, Leistung auf dem Handy.

**Phase 3 – Veröffentlichen.** Erst wenn der Cup spielbar ist, wird `main` überschrieben, mit deiner Freigabe. Bis dahin bleibt das alte Spiel unter dem bisherigen Link erreichbar.
