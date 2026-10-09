# Olivers Score – Mein Weg zu 85 kg

Persönlicher Tracker für Bewegung, Kalorien (MyFitnessPal) und Alkohol – mit Tages-Score,
Wochenziel, Gewichtstrend und Health-Connect-Sync aus Google Drive.

**Stack:** Cloudflare Pages (statisches Frontend, ES-Module ohne Build) · Pages Functions · D1 (SQLite).

## Seiten

| Seite | Inhalt |
|---|---|
| `/` Heute | Gewicht & Fortschritt zum Ziel, Score heute, Kacheln (Schritte, kcal, Bier, grüne Tage), Bewegung 14 Tage, „Noch ein Bier?“-Rechner |
| `/eintrag` | Tageseintrag mit Live-Score-Vorschau, Tag vor/zurück, letzte Einträge |
| `/woche` | Woche mit Ampel, Wochenziel, Streaks, Schnitte, Bierkonsum & Alkohol |
| `/gewicht` (Körper) | Gewicht (30 T / 90 T / alles), Trend, Prognose, Körperzusammensetzung (Fett, Muskel, Wasser, Grundumsatz), Messungen |
| `/gesundheit` | Blutdruck (ESC/ESH-Ampel), Ruhepuls, Schlaf (Phasen, Dauer), Blutwerte (frei benannt, Verlauf), Aktivitäten |
| `/verlauf` | 13-Wochen-Kalender, Ø Wochenscore, Ø Wochengewicht, Zusammenhänge (Tag nach Bier) |
| `/einstellungen` | Ziele, Health Sync, Theme, Abmelden, Score-Erklärung |

## Vorläufiger Score

Tage mit importierten Daten (Schritte, MyFitnessPal) bekommen automatisch einen **vorläufigen** Score
(Annahme: 0 Bier, kein Training). Auf der Startseite: „+ Daten ergänzen“ oder „Passt so ✓“ (bestätigt den Tag).
Vorläufige Tage sind in Woche/Verlauf gestrichelt markiert und zählen nicht als „alkoholfrei“.

## Score (0–10)

- **Bewegung (max. 4):** Schritte ≥ 100 % Ziel = 3, ≥ 75 % = 2, ≥ 50 % = 1; Training +1
- **Ernährung & Trinken (max. 3):** kcal ≤ Ziel +1, Protein ≥ Ziel +1, Wasser ≥ Ziel (Standard 2 l) +1
- **Alkohol (max. 3):** 0 Bier = 3, 1 = 2, 2 = 1, ab 3 = 0; Wochenbudget überschritten = 0
- **Ampel:** Grün ≥ 7, Orange ≥ 4, sonst Rot. Tage ohne Eintrag sind grau.

Die Logik steht in `public/assets/score.js` und wird von Browser **und** Server genutzt.

## Entwicklung

```bash
npm install
echo "APP_PASSWORD=test" > .dev.vars
npx wrangler d1 migrations apply score --local   # oder: Schema entsteht automatisch beim ersten API-Aufruf
npm run dev      # http://localhost:8788
npm test
```

## Deployment

```bash
npx wrangler pages project create olivers-score --production-branch main   # einmalig
npx wrangler pages secret put APP_PASSWORD --project-name olivers-score
npx wrangler pages secret put GOOGLE_SERVICE_ACCOUNT_JSON --project-name olivers-score
npm run deploy
```

Die D1-Bindung `DB` steht in `wrangler.toml`. Fehlende Tabellen/Spalten legt `lib/db.js` beim
ersten API-Aufruf an (nur additiv – bestehende Daten bleiben unverändert).

## Health Sync

Health Connect exportiert täglich CSVs nach Google Drive („Schritte JJJJ.MM.TT[-JJJJ.MM.TT] Health Connect.csv“,
„Gewicht … Health Connect.csv“). Der Service Account (Secret `GOOGLE_SERVICE_ACCOUNT_JSON`) muss Lesezugriff auf die
Ordner haben. Der Sync

- speichert Schritte als **Tagessumme** (`sync_steps_daily`, bei Überlappung gewinnt der größere/vollständigere Wert),
- überspringt 30-Tage-Exporte, deren Zeitraum schon in einem neueren Export steckt (spart CPU/Downloads),
- importiert Gewicht **und Körperfett**; als Tageswert zählt die erste Messung des Tages (morgens),
- verarbeitet max. 4 Downloads pro Aufruf; der Client ruft so lange nach, bis alles importiert ist.

## Anmeldung

- **PIN** über das Ziffernfeld (Secret `APP_PASSWORD`), Session-Cookie 30 Tage.
- **Fingerabdruck (Passkey/WebAuthn):** Nach der PIN-Anmeldung wird einmalig angeboten, den Fingerabdruck einzurichten
  (alternativ in den Einstellungen). Danach fragt die Login-Seite auf diesem Gerät direkt den Fingerabdruck ab.
  Gespeichert wird nur der öffentliche Schlüssel (`webauthn_credentials`); Prüfung in `lib/webauthn.js`
  (Origin, RP-ID, Nutzer-Verifikation, Signatur, Zähler, zeitlich begrenzte signierte Challenge).

## Gesundheitszentrale (ehemals Health Tracker)

Score hat den separaten Health Tracker (`okeszler/health-tracker`) übernommen:
- **Sync** liest zusätzlich Puls, Schlaf, Blutdruck (Samsung Health) und Aktivitäten (Ordner „Health Sync Aktivitäten“).
  Puls wird als Stundenwerte gespeichert (`sync_pulse_hourly`, ~24 statt ~750 Zeilen/Tag), Schlaf als Segmente,
  jede Datei mit **einem** Statement (`json_each`); unveränderte Zeilen kosten keine Schreibvorgänge (D1-Limit).
- **Ruhepuls** = Ø Puls während der Hauptnacht, **Nächte** werden aus Schlafsegmenten gebildet (`public/assets/health.js`).
- **Blutwerte** (`lab_results`) und **Blutdruck** (`blood_pressure`, manuell + Samsung Health) mit Erfassung in der App.
- **CSV-Export** unter Einstellungen: Tage, Körper, Blutdruck, Blutwerte.
- Datenübernahme: `scripts/migrate_health_tracker.py` (liest den Health Tracker nur, erzeugt SQL für Score).

## Ernährung (MyFitnessPal)

MyFitnessPal schreibt Mahlzeiten nach Health Connect, Health Sync exportiert sie als
„Ernährung … Health Connect.csv“ in den Drive-Ordner „Health Sync Ernährung“ (muss mit dem Service Account geteilt sein).
Der Sync bildet Tagessummen für kcal und Protein (`sync_nutrition_daily`, neuester Export gewinnt).
Manuell eingetragene Werte haben Vorrang. Wasser wird nicht exportiert und wird in Score erfasst (+250/+500 ml auf der Startseite).

## Automatischer Sync (Cron)

Der Worker `olivers-score-cron` (`cron/`) ruft **alle 30 Minuten von 06:29 bis 23:59 Uhr (Berlin)** `POST /api/sync` auf.
Trigger `29,59 * * * *` (ein einziger Trigger, Free-Plan-Limit: 5 pro Account); die Nachtpause und Sommer-/Winterzeit
prüft der Worker selbst. Aufwand: ca. 36 Läufe/Tag, ~1–2 Tsd. D1-Schreibvorgänge (Limit 100 Tsd./Tag für das Konto).
Authentifizierung über das Secret `CRON_SECRET` (identisch im Pages-Projekt und im Worker), nur für `/api/sync`.

```bash
npx wrangler deploy --config cron/wrangler.toml
npx wrangler secret put CRON_SECRET --config cron/wrangler.toml
```

## Review der alten App (score-83w.pages.dev)

Gefundene Fehler und Logikprobleme, die in dieser Version behoben sind:

1. **Fehlende Tage = Rot.** Die 90-Tage-Ansicht färbte jeden Tag ohne Eintrag rot; die Statistik war dadurch
   verfälscht. Jetzt: grau „kein Eintrag“, gezählt wird nur Eingetragenes.
2. **Heute „0 / Rot“ ohne Eintrag.** Der Tag wurde bewertet, bevor etwas eingetragen war. Jetzt: „noch kein Eintrag“.
3. **„Kalorien getrackt“ widersprüchlich.** z. B. 11.09.: 1.900 kcal eingetragen, aber `calories_tracked = 0`.
   Jetzt folgt „getrackt“ automatisch aus dem kcal-Wert.
4. **Dual-Achsen-Diagramm „Korrelation“.** Score und Gewicht auf zwei Skalen suggerierten Zusammenhänge, die die
   Skalierung erzeugt. Jetzt zwei getrennte Diagramme über dieselben Wochen + echte Kennzahlen.
5. **Gewichtsdiagramm ohne Zeitachse.** 03.08., 08.08., 13.08., 14.08. hatten gleiche Abstände. Jetzt echte Datumsachse.
6. **Rundungsartefakte.** Sync-Werte wie 94,00021 kg. Jetzt auf 0,1 kg gerundet.
7. **Körperfett aus dem Sync ignoriert.** Die Waage liefert ihn mit; jetzt wird er importiert.
8. **Sync seit 09.09. ohne neue Daten.** Letzter Schritte-Import war der 09.09., obwohl Drive täglich neue Exporte
   enthält (neues Namensformat „2026.09.06-2026.10.06“, ca. 460 KB, ~13.000 Zeilen). Ursache ließ sich ohne den alten
   Code nicht sicher klären; der neue Import speichert Tagessummen und überspringt redundante Exporte.
9. **Doppelte Wahrheit bei Schritten.** Manuell vs. Sync war unklar. Jetzt: manuell > Sync > Walk-km × 1.300,
   im Formular sichtbar („Leer lassen = Sync-Wert nutzen“).
10. **Alkoholfreie Tage rot am Wochenanfang.** „0 von min. 2“ war montags schon rot. Jetzt orange „noch möglich“.
11. **Mobile Tab-Leiste abgeschnitten** („eute“, „Korre“). Jetzt Bottom-Navigation bzw. Sidebar.
12. **Session/Sicherheit.** HMAC-signiertes HttpOnly-Cookie, konstante Vergleichszeit, Login-Bremse,
    kein Open Redirect, Server-Validierung aller Eingaben (Bereiche, Datum, Länge).

## Verbesserungsvorschläge (noch offen)

- **Wiegen-Routine:** Die letzte Messung ist vom 15.08. Ohne 2–3 Messungen pro Woche gibt es keinen Trend und
  keine Prognose. Health-Connect-Export für Gewicht wieder aktivieren (aktuell nur bis 14.08. in Drive).
- **MyFitnessPal-Import:** MFP bietet keine offene API; ein CSV-Export (Premium) ließe sich wie Health Connect
  importieren und würde kcal/Protein automatisch füllen.
- **Erinnerung abends** (z. B. 21 Uhr), falls für heute noch kein Eintrag existiert – als Web-Push oder E-Mail.
- **Bier-Budget adaptiv:** z. B. Budget −1 für die Folgewoche, wenn es überschritten wurde.
- **Kalorienziel aus Gewichtstrend ableiten:** Ist der Trend flach trotz „im Ziel“, ist das kcal-Ziel zu hoch
  oder das Tracking unvollständig.
