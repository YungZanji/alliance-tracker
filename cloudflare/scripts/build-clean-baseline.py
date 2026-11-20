"""Extract schema only from legacy migrations; never execute their data repairs."""
import re
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for file in sorted((root / 'migrations').glob('*.sql')):
    sql = re.sub(r'--[^\n]*', '', file.read_text())
    statement = ''
    for char in sql:
        statement += char
        if char == ';' and sqlite3.complete_statement(statement):
            if re.match(r'^\s*(CREATE|ALTER|DROP)\b', statement, re.I):
                db.execute(statement)
            statement = ''
    if statement.strip():
        raise RuntimeError(f'Unterminated SQL in {file}')
# Temporary repair tables must not survive in the baseline.
rows = db.execute("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").fetchall()
assert not any(name.startswith('_') for _,name,_ in rows)
baseline = '-- Clean 36C baseline: schema only, no WDZ history or credentials.\nPRAGMA foreign_keys=ON;\n\n'
baseline += '\n\n'.join(sql + ';' for _,_,sql in rows) + '\n'
target = root / 'deployments/36c/migrations/0001_clean_schema.sql'
target.write_text(baseline)
fresh = sqlite3.connect(':memory:')
fresh.executescript(baseline)
for kind,name,_ in rows:
    if kind == 'table':
        assert fresh.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] == 0
assert fresh.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print(f'Validated {sum(kind=="table" for kind,_,_ in rows)} empty tables; no data statements executed.')
