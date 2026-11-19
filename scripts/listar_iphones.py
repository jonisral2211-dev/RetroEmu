"""Lista los iPhone que ve el servicio de Apple (usbmuxd, 127.0.0.1:27015): USB y Wi-Fi.

Uso: python listar_iphones.py   -> imprime una línea por dispositivo: "<conexión> <UDID>"
Sale con código 0 si hay alguno por Wi-Fi, 1 si solo USB o ninguno, 2 si el servicio no responde.
"""
import plistlib
import socket
import struct
import sys


def main() -> int:
    try:
        s = socket.create_connection(('127.0.0.1', 27015), timeout=5)
    except OSError:
        print('SERVICIO-APPLE-NO-RESPONDE')
        return 2
    body = plistlib.dumps({
        'MessageType': 'ListDevices',
        'ClientVersionString': 'jl-autofirma',
        'ProgName': 'jl-autofirma',
    })
    # Cabecera usbmux: longitud total, versión 1, mensaje 8 (plist), etiqueta
    s.sendall(struct.pack('<IIII', 16 + len(body), 1, 8, 1) + body)
    head = b''
    while len(head) < 16:
        chunk = s.recv(16 - len(head))
        if not chunk:
            print('SERVICIO-APPLE-NO-RESPONDE')
            return 2
        head += chunk
    length = struct.unpack('<I', head[:4])[0]
    data = b''
    while len(data) < length - 16:
        chunk = s.recv(length - 16 - len(data))
        if not chunk:
            break
        data += chunk
    s.close()
    devices = plistlib.loads(data).get('DeviceList', [])
    wifi = False
    for d in devices:
        props = d.get('Properties', {})
        kind = props.get('ConnectionType', '?')
        udid = props.get('SerialNumber') or props.get('UDID') or '?'
        label = 'WiFi' if kind == 'Network' else kind
        wifi = wifi or kind == 'Network'
        print(f'{label} {udid}')
    if not devices:
        print('NINGUNO')
    return 0 if wifi else 1


if __name__ == '__main__':
    sys.exit(main())
