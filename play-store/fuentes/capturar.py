"""Captura la app instalada en un emulador Android, sin modificar su interfaz.

Uso: python3 play-store/fuentes/capturar.py --serial emulator-5554
Requiere adb y Pillow. El emulador debe tener instalada la compilación de Anny.
No inicia sesión, no solicita asistencia y no utiliza datos de cuentas reales.
"""
import argparse
import io
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--serial', required=True)
args = parser.parse_args()
if not args.serial.startswith('emulator-'):
    parser.error('Usá un emulador aislado; este script cambia su resolución y densidad.')

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'com.anonymous.annyv4'
records = []

def adb(*command):
    return subprocess.check_output(['adb', '-s', args.serial, *command], timeout=45)

def shell(*command):
    return adb('shell', *command)

def capture(folder, filename, route, size, density, scroll=False):
    shell('am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d',
          'annyv4:///' + route, PACKAGE)
    time.sleep(7 if filename == '01-ayuda.png' else 3)
    if filename == '01-ayuda.png':
        shell('uiautomator', 'dump', '/sdcard/anny-captura-ui.xml')
        root = ET.fromstring(shell('cat', '/sdcard/anny-captura-ui.xml'))
        for node in root.iter('node'):
            if node.get('text') == 'Cerrar' or node.get('content-desc') == 'Cerrar':
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
                shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
                time.sleep(1)
                break
    if scroll:
        w, h = size
        shell('input', 'swipe', str(w//2), str(int(h*.8)),
              str(w//2), str(int(h*.3)), '500')
        time.sleep(1)
    image = Image.open(io.BytesIO(adb('exec-out', 'screencap', '-p')))
    if image.size != size:
        raise RuntimeError(f'Resolución inesperada: {image.size}, esperada {size}')
    output = ROOT / 'es-AR' / folder / filename
    output.parent.mkdir(parents=True, exist_ok=True)
    image.convert('RGB').save(output, optimize=True)
    records.append({'archivo': str(output.relative_to(ROOT)), 'ruta': route,
                    'ancho': size[0], 'alto': size[1], 'densidad_android': density,
                    'desplazamiento': scroll, 'origen': 'adb exec-out screencap -p'})
    print(output.relative_to(ROOT), flush=True)

profiles = [
    ('telefono', (1080, 1920), 420),
    ('tablet-7', (1080, 1920), 288),
    ('tablet-10', (1440, 2560), 288),
]

try:
    for folder, size, density in profiles:
        shell('am', 'force-stop', PACKAGE)
        shell('wm', 'size', f'{size[0]}x{size[1]}')
        shell('wm', 'density', str(density))
        time.sleep(3)
        capture(folder, '01-ayuda.png', 'help', size, density)
        if folder == 'telefono':
            capture(folder, '02-escaner-y-streaming.png', 'help', size, density, True)
            capture(folder, '03-viajar.png', 'travel', size, density)
            capture(folder, '04-explorar.png', 'explore', size, density)
            capture(folder, '05-configuracion.png', 'settings', size, density)
            capture(folder, '06-inicio.png', 'home', size, density)
        else:
            capture(folder, '02-viajar.png', 'travel', size, density)
            capture(folder, '03-explorar.png', 'explore', size, density)
            capture(folder, '04-configuracion.png', 'settings', size, density)
finally:
    shell('wm', 'size', 'reset')
    shell('wm', 'density', 'reset')

(ROOT / 'fuentes' / 'capturas.json').write_text(
    json.dumps({'paquete': PACKAGE, 'capturas': records,
                'notas': 'Render Android nativo en perfiles de teléfono y tablet. '
                         'Conversión PNG RGB sin recorte, escalado ni cambios en el contenido.'},
               ensure_ascii=False, indent=2) + '\n')
