import os
import shutil

renames = {
    'views': 'index.html',
    'scripts': 'ai_engine.py',
    'database': 'school.db',
    'data': 'ai_insights.json',
    'keys': 'STDRFIDPRO.pem',
    'docs': 'Coe Computer Hardware Laboratory.pdf'
}

for old, new in renames.items():
    if os.path.exists(old) and os.path.isfile(old):
        try:
            os.rename(old, new)
            print(f"Renamed {old} to {new}")
        except Exception as e:
            print(f"Error renaming {old}: {e}")

dirs = ['views', 'scripts', 'database', 'data', 'keys', 'docs', 'css']
for d in dirs:
    os.makedirs(d, exist_ok=True)

moves = [
    (lambda f: f.endswith('.html'), 'views'),
    (lambda f: f.endswith('.py') and f != 'move_files.py', 'scripts'),
    (lambda f: f.startswith('school.db'), 'database'),
    (lambda f: f.endswith('.json') and f not in ('package.json', 'package-lock.json'), 'data'),
    (lambda f: f.endswith('.csv'), 'data'),
    (lambda f: f.endswith('.pem') or f.endswith('.ppk'), 'keys'),
    (lambda f: f.endswith('.pdf'), 'docs'),
    (lambda f: f.endswith('.css'), 'css')
]

for file in os.listdir('.'):
    if os.path.isfile(file):
        for condition, dest in moves:
            if condition(file):
                try:
                    shutil.move(file, os.path.join(dest, file))
                    print(f"Moved {file} to {dest}")
                except Exception as e:
                    print(f"Error moving {file}: {e}")
                break
