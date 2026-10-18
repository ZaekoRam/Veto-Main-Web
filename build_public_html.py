"""Genera public_html/ y public_html.zip listos para subir a Hostinger.

Uso (desde la carpeta del proyecto):  python build_public_html.py
Copia solo lo que necesita el sitio; README, .claude y este script se quedan fuera.
"""
import os
import shutil
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "public_html")
ZIP = os.path.join(ROOT, "public_html.zip")
FILES = ["index.html", "styles.css", "main.js", ".htaccess"]
DIRS = ["lib", "assets"]

shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
for f in FILES:
    shutil.copy2(os.path.join(ROOT, f), OUT)
for d in DIRS:
    shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d))

if os.path.exists(ZIP):
    os.remove(ZIP)
count = 0
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    for base, _, names in os.walk(OUT):
        for name in names:
            full = os.path.join(base, name)
            # rutas con "/" para que Hostinger (Linux) las extraiga bien
            arc = os.path.relpath(full, OUT).replace(os.sep, "/")
            # .glb y .webp ya vienen comprimidos
            z.write(full, arc, compress_type=zipfile.ZIP_STORED if name.endswith((".glb", ".webp")) else zipfile.ZIP_DEFLATED)
            count += 1

print("public_html/ y public_html.zip listos:", count, "archivos,", round(os.path.getsize(ZIP) / 1e6, 1), "MB")
