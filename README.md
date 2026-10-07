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
| `/gewicht` | Verlauf (30 T / 90 T / alles), Trend, Prognose, Szenarien, Körperfett, Messungen |
| `/verlauf` | 13-Wochen-Kalender, Ø Wochenscore, Ø Wochengewicht, Zusammenhänge (Tag nach Bier) |
| `/einstellungen` | Ziele, Health Sync, Theme, Abmelden, Score-Erklärung |

## Score (0–10)

- **Bewegung (max. 4):** Schritte ≥ 100 % Ziel = 3, ≥ 75 % = 2, ≥ 50 % = 1; Training +1
- **Ernährung (max. 3):** getrackt +1, kcal ≤ Ziel +1, Protein ≥ Ziel +1
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
- **Automatischer Sync per Cron:** ein kleiner Worker mit Cron-Trigger (wie bei `dagoberts-geldspeicher-cron`)
  ruft den Import täglich auf, dann entfällt der Knopfdruck.
- **MyFitnessPal-Import:** MFP bietet keine offene API; ein CSV-Export (Premium) ließe sich wie Health Connect
  importieren und würde kcal/Protein automatisch füllen.
- **Erinnerung abends** (z. B. 21 Uhr), falls für heute noch kein Eintrag existiert – als Web-Push oder E-Mail.
- **Bier-Budget adaptiv:** z. B. Budget −1 für die Folgewoche, wenn es überschritten wurde.
- **Kalorienziel aus Gewichtstrend ableiten:** Ist der Trend flach trotz „im Ziel“, ist das kcal-Ziel zu hoch
  oder das Tracking unvollständig.
