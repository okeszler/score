# Liest den Health Tracker (D1, nur lesend) und erzeugt SQL für die Score-Datenbank.
import json, subprocess, sys
A = 'e990cfeaae33194c0961789e92954504'
HT = '8564ad9c-5d8f-4813-9c01-bc885f185c2c'
out_path = sys.argv[1]

def q(sql):
    body = json.dumps({'sql': sql})
    r = subprocess.run(['curl', '-sS', '-X', 'POST', f'https://api.cloudflare.com/client/v4/accounts/{A}/d1/database/{HT}/query',
                        '-H', 'Content-Type: application/json', '--data', body], capture_output=True, text=True)
    d = json.loads(r.stdout)
    if not d.get('success'): raise SystemExit(d)
    return d['result'][0]['results']

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

stmts, counts = [], {}
def add(table, cols, rows, conflict):
    counts[table] = counts.get(table, 0) + len(rows)
    for i in range(0, len(rows), 200):
        vals = ',\n'.join('(' + ','.join(lit(r[c]) for c in cols) + ')' for r in rows[i:i+200])
        stmts.append(f"INSERT INTO {table} ({','.join(cols)}) VALUES\n{vals}\n{conflict};")

# 1) Manuelle Körperwerte: % -> kg; vorhandene Score-Werte haben Vorrang
m = q('SELECT * FROM metrics ORDER BY entry_date')
body = []
for r in m:
    if r['weight_kg'] is None and r['body_fat_pct'] is None and r['muscle_pct'] is None and r['body_water_pct'] is None: continue
    w = r['weight_kg']
    body.append({'entry_date': r['entry_date'], 'weight_kg': w, 'body_fat_pct': r['body_fat_pct'],
                 'muscle_kg': round(r['muscle_pct'] * w / 100, 1) if r['muscle_pct'] and w else None,
                 'body_water_kg': round(r['body_water_pct'] * w / 100, 1) if r['body_water_pct'] and w else None})
    if all(body[-1][k] is None for k in ('weight_kg', 'body_fat_pct', 'muscle_kg', 'body_water_kg')): body.pop()
add('weight', ['entry_date', 'weight_kg', 'body_fat_pct', 'muscle_kg', 'body_water_kg'], body,
    'ON CONFLICT(entry_date) DO UPDATE SET weight_kg = COALESCE(weight.weight_kg, excluded.weight_kg), body_fat_pct = COALESCE(weight.body_fat_pct, excluded.body_fat_pct), muscle_kg = COALESCE(weight.muscle_kg, excluded.muscle_kg), body_water_kg = COALESCE(weight.body_water_kg, excluded.body_water_kg)')

# 2) Blutdruck: manuell (metrics) + Samsung Health (sync_bp_readings)
bp = [{'entry_date': r['entry_date'], 'reading_time': '', 'systolic': r['bp_systolic'], 'diastolic': r['bp_diastolic'], 'pulse': r['pulse'], 'note': r['note'], 'source': 'manuell'}
      for r in m if r['bp_systolic'] and r['bp_diastolic']]
bp += [{'entry_date': r['entry_date'], 'reading_time': r['reading_time'] or '', 'systolic': round(r['systolic']), 'diastolic': round(r['diastolic']),
         'pulse': round(r['pulse']) if r['pulse'] else None, 'note': r['note'], 'source': 'sync'} for r in q('SELECT * FROM sync_bp_readings')]
add('blood_pressure', ['entry_date', 'reading_time', 'systolic', 'diastolic', 'pulse', 'note', 'source'], bp, 'ON CONFLICT DO NOTHING')

# 3) Blutwerte
labs = q('SELECT entry_date, test_name, value, unit, note, created_at FROM lab_results ORDER BY entry_date, id')
add('lab_results', ['entry_date', 'test_name', 'value', 'unit', 'note', 'created_at'], labs, '')

# 4) Puls: Einzelmessungen -> Stundenwerte
pulse = q("""SELECT entry_date, CAST(substr(reading_time, 1, 2) AS INTEGER) AS hour, COUNT(*) AS n,
  ROUND(AVG(bpm), 1) AS avg_bpm, MIN(bpm) AS min_bpm, MAX(bpm) AS max_bpm
  FROM sync_pulse_readings WHERE bpm BETWEEN 25 AND 240 GROUP BY entry_date, hour""")
add('sync_pulse_hourly', ['entry_date', 'hour', 'n', 'avg_bpm', 'min_bpm', 'max_bpm'], pulse,
    'ON CONFLICT(entry_date, hour) DO UPDATE SET n = excluded.n, avg_bpm = excluded.avg_bpm, min_bpm = excluded.min_bpm, max_bpm = excluded.max_bpm WHERE excluded.n > sync_pulse_hourly.n')

# 5) Schlaf-Segmente
sleep = q("SELECT entry_date || ' ' || reading_time AS start_ts, MAX(duration_seconds) AS seconds, stage FROM sync_sleep_readings GROUP BY start_ts")
add('sync_sleep_segments', ['start_ts', 'seconds', 'stage'], sleep, 'ON CONFLICT(start_ts) DO NOTHING')

# 6) Aktivitäten
acts = q('SELECT entry_date, start_time, activity_type, source_app, elapsed_seconds, active_seconds, distance_km, calories, steps, avg_hr, max_hr FROM sync_activities')
add('sync_activities', ['entry_date', 'start_time', 'activity_type', 'source_app', 'elapsed_seconds', 'active_seconds', 'distance_km', 'calories', 'steps', 'avg_hr', 'max_hr'], acts, 'ON CONFLICT DO NOTHING')

# 7) Bereits importierte Drive-Dateien übernehmen, damit Score sie nicht erneut herunterlädt
files = q("SELECT category, drive_file_id, file_name, modified_time FROM sync_files WHERE category IN ('puls','schlaf','aktivitaeten','blutdruck')")
add('sync_files', ['category', 'drive_file_id', 'file_name', 'modified_time'], files, 'ON CONFLICT(drive_file_id) DO NOTHING')

# Startgewicht des aktuellen Plans festhalten (sonst wäre die älteste Messung von 2018 der Start)
stmts.append("INSERT INTO goals (key, value) VALUES ('start_weight_kg', 94.3) ON CONFLICT(key) DO NOTHING;")
open(out_path, 'w').write('\n'.join(stmts) + '\n')
print(json.dumps(counts, ensure_ascii=False))
