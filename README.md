# 🐾 Trapanotto Kart

Ein flauschiges Kart-Rennspiel mit süssen Tieren, das direkt im Browser läuft.

**▶ Spielen: https://trapanotto.github.io/kart/**

![Die 8 Fahrer](docs/karts.webp)

## Fahrer

| Tier | Name | Stärke |
|---|---|---|
| Faultier | Fauli | Bestes Handling |
| Schaf | Wolke | Beste Beschleunigung |
| Rotpanda | Rubi | Stärkster Drift-Boost |
| Igel | Stupsi | Kaum zu erschüttern |
| Pinguin | Pingo | Voller Grip auf Eis |
| Capybara | Kapi | Höchstgeschwindigkeit |
| Otter | Otti | Ausgeglichen |
| Axolotl | Axi | Schnell wieder auf den Beinen |

![Porträts](docs/portraits.webp)

## Inhalt

- **Modi:** Grand Prix (2 Cups mit je 4 Rennen, Punktewertung, Qualifikation ab Platz 4, Pokale), Einzelrennen, Versus (2–4 Spieler ohne Computer, Siegzählung), Zeitfahren mit Geist und Gold-/Silber-/Bronze-Zeiten
- **Freischaltbar:** Spiegel-Modus (Gold in allen Cups in Flott oder Turbo)
- **Splitscreen** für bis zu 4 Spieler (Tastatur + Gamepads)
- **8 Strecken:** Kleeblatt-Wiese, Bambuswald-Tempel, Pilzhöhlen, Honigfabrik, Gletscher-Gipfel (Eis), Korallenriff (Unterwasser), Wolkenschloss (Brücke), Dschungel-Vulkan
- **Fahren:** Drift mit 3 Boost-Stufen, Super-Start, Tricks nach Rampen, Boost-Felder
- **Strecken:** Brücken und Kreuzungen auf mehreren Ebenen, Steilkurven, Halfpipes, Loopings, Weggabelungen, grosse Schanzen über Abgründe, Gleiter-Abschnitte, einstürzende Brücken, rollende Fässer und Felsen, Unterwasser-Abschnitt
- **Items:** 🌰 Eichel-Wurf · 🌰🌰🌰 kreisende Eicheln · 🍯 Honigpfütze · 🎁 falsche Geschenkbox · 🧶 Wollknäuel · 🐝 Bienenschwarm · 🫧 Seifenblasen-Schild · 🥕 Karotten-Turbo (1× / 3×) · ✨ Goldene Karotte · 🍭 Regenbogen-Lolli · 🌧️ Gewitterwölkchen · 💤 Gähn-Welle – Eichel, Honig und Box lassen sich hinten festhalten
- **Fahrtaktik:** Windschatten-Turbo, ein Rivale unter den Computer-Gegnern, Tacho
- 3 Geschwindigkeitsklassen, Computer-Gegner, selbst erzeugte Musik und Soundeffekte, Touch-Steuerung für Handys

## Steuerung

| Aktion | Allein | Spieler 1 (geteilt) | Spieler 2 (geteilt) | Gamepad |
|---|---|---|---|---|
| Gas | W / ↑ | W | ↑ | A / RT |
| Bremsen | S / ↓ | S | ↓ | B / LT |
| Lenken | A D / ← → | A D | ← → | Stick / Steuerkreuz |
| Springen + Driften | Leertaste / Shift | Leertaste | Shift rechts | RB / X |
| Item | E / X | E | Enter | LB / Y |
| Pause | Esc / P | Esc | Esc | Start |

## Technik

- **Grafik:** [three.js](https://threejs.org) (über CDN geladen, kein Build-Schritt nötig)
- **Modelle:** komplett per Python-Skript in **Blender** erzeugt ([tools/blender/build_models.py](tools/blender/build_models.py)): Tiere, Karts und Streckendeko, exportiert als glTF mit Draco-Kompression
- **Fell:** Fellbüschel in Blender plus Shell-Fur-Shader im Spiel (abschaltbar unter Optionen)
- **Strecken:** werden aus mathematischen Formen erzeugt ([src/data.js](src/data.js))

### Modelle neu bauen

```bash
blender -b -P tools/blender/build_models.py -- assets render
```

Ohne `render` werden nur die Modelle exportiert. Einzelne Tiere: `-- assets sloth sheep`.

### Lokal starten

```bash
node tools/serve.mjs
```

Dann http://localhost:8080 öffnen. Mit `node tools/validate_tracks.mjs` werden alle Strecken geprüft.
