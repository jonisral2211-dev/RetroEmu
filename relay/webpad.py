"""Mando web para los Jugadores 2, 3 y 4 (sin instalar la app).

- La app (iPhone del Jugador 1) abre una conexión TCP al relay: "JLRL1 PADHOST\\n" -> "CODE ABC123\\n".
  Recibe "J <puerto>" (entra alguien), "L <puerto>" (sale), "P <puerto> <botones> <lx> <ly>" y PING.
  Envía "R <puerto> <fuerte> <débil>" (vibración del juego), "K <puerto>" (expulsar) y
  "T <máscara>" (puertos ocupados por mandos físicos, que no se asignan a navegadores).
- Cada navegador abre http://<relay>:8080/play?code=ABC123 y se conecta por WebSocket a
  /ws?code=ABC123[&seat=2..4]. Recibe "ok:<jugador>" con su asiento (2, 3 o 4) y "seats:<lista>";
  envía "botones,lx,ly" y puede pedir "seat:<jugador>" para cambiarse a uno libre.

Solo biblioteca estándar: WebSocket mínimo (RFC 6455, mensajes de texto cortos).
"""
import asyncio
import base64
import hashlib
import json
import secrets
import struct
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
PAGE = (Path(__file__).with_name("webpad.html")).read_bytes()
MANIFEST = json.dumps({
    "name": "JL Emulator · Mando",
    "short_name": "JL Mando",
    "start_url": "/play",
    "scope": "/",
    "display": "fullscreen",
    "orientation": "any",
    "background_color": "#000000",
    "theme_color": "#000000",
}).encode()
PORTS = (1, 2, 3)  # puertos de Libretro de los Jugadores 2, 3 y 4


class PadRoom:
    def __init__(self, writer):
        self.writer = writer
        self.lock = asyncio.Lock()
        self.seats: dict[int, asyncio.StreamWriter] = {}  # puerto -> navegador
        self.reserved = 0  # bits: puertos con mando físico en el iPhone

    def free_ports(self):
        return [p for p in PORTS if p not in self.seats and not (self.reserved >> p) & 1]


pads: dict[str, PadRoom] = {}


def new_code(taken) -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if code not in pads and code not in taken:
            return code


async def send_line(room: PadRoom, line: str) -> bool:
    try:
        async with room.lock:
            room.writer.write((line + "\n").encode())
            await room.writer.drain()
        return True
    except Exception:
        return False


def ws_frame(opcode: int, payload: bytes) -> bytes:
    n = len(payload)
    if n < 126:
        return bytes([0x80 | opcode, n]) + payload
    return bytes([0x80 | opcode, 126]) + struct.pack(">H", n) + payload


def ws_text(writer, text: str):
    try:
        writer.write(ws_frame(1, text.encode()))
    except Exception:
        pass


def broadcast_seats(room: PadRoom):
    """Avisa a todos los navegadores de qué asientos están ocupados (para el cambio de asiento)."""
    taken = sorted({p + 1 for p in room.seats} | {p + 1 for p in PORTS if (room.reserved >> p) & 1})
    for w in list(room.seats.values()):
        ws_text(w, "seats:" + ",".join(map(str, taken)))


async def pad_host(reader, writer, taken):
    """Conexión TCP de la app que recibe los mandos web."""
    code = new_code(taken)
    room = PadRoom(writer)
    pads[code] = room
    writer.write(f"CODE {code}\n".encode())
    await writer.drain()
    print(f"mando web {code} abierto", flush=True)
    try:
        while True:
            try:
                raw = await asyncio.wait_for(reader.readline(), timeout=20)
                if not raw:
                    break
            except asyncio.TimeoutError:
                if not await send_line(room, "PING"):
                    break
                continue
            parts = raw.decode("ascii", "ignore").split()
            if len(parts) == 4 and parts[0] == "R":
                # Vibración del juego para el jugador de ese puerto
                w = room.seats.get(int(parts[1]) if parts[1].isdigit() else -1)
                if w:
                    ws_text(w, f"rumble:{parts[2]},{parts[3]}")
            elif len(parts) == 2 and parts[0] == "K" and parts[1].isdigit():
                w = room.seats.get(int(parts[1]))
                if w:
                    ws_text(w, "err:El Jugador 1 te ha sacado de la partida")
                    try:
                        w.write(ws_frame(8, b""))
                        w.close()
                    except Exception:
                        pass
            elif len(parts) == 2 and parts[0] == "T" and parts[1].isdigit():
                room.reserved = int(parts[1])
                broadcast_seats(room)
    except Exception:
        pass
    finally:
        pads.pop(code, None)
        for w in list(room.seats.values()):
            ws_text(w, "err:El Jugador 1 cerró la sala")
            try:
                w.close()
            except Exception:
                pass
        writer.close()
        print(f"mando web {code} cerrado", flush=True)


# ---- HTTP + WebSocket ---------------------------------------------------------------------

async def ws_read(reader):
    """Lee un mensaje WebSocket. Devuelve (opcode, payload) o None si se cerró."""
    head = await reader.readexactly(2)
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    length = head[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", await reader.readexactly(8))[0]
    if length > 4096:
        return None
    mask = await reader.readexactly(4) if masked else b"\0\0\0\0"
    payload = bytearray(await reader.readexactly(length))
    for i in range(length):
        payload[i] ^= mask[i % 4]
    return opcode, bytes(payload)


async def websocket(reader, writer, code: str, wanted: int):
    room = pads.get(code)
    if room is None:
        ws_text(writer, "err:Código no encontrado o sala cerrada")
        writer.write(ws_frame(8, b""))
        await writer.drain()
        return
    free = room.free_ports()
    port = wanted - 1 if wanted - 1 in free else (free[0] if free else None)
    if port is None:
        ws_text(writer, "err:La sala está completa (J2, J3 y J4 ocupados)")
        writer.write(ws_frame(8, b""))
        await writer.drain()
        return
    room.seats[port] = writer
    await send_line(room, f"J {port}")
    ws_text(writer, f"ok:{port + 1}")
    broadcast_seats(room)
    await writer.drain()
    print(f"mando web {code}: J{port + 1} conectado", flush=True)
    try:
        while True:
            msg = await ws_read(reader)
            if msg is None:
                break
            opcode, payload = msg
            if opcode == 8:  # cierre
                break
            if opcode == 9:  # ping -> pong
                writer.write(ws_frame(10, payload))
                await writer.drain()
                continue
            if opcode != 1:
                continue
            text = payload.decode("ascii", "ignore")
            if text.startswith("seat:"):
                # Cambio de asiento a uno libre
                try:
                    target = int(text[5:]) - 1
                except ValueError:
                    continue
                if target in room.free_ports():
                    await send_line(room, f"P {port} 0 0 0")
                    await send_line(room, f"L {port}")
                    del room.seats[port]
                    port = target
                    room.seats[port] = writer
                    await send_line(room, f"J {port}")
                    ws_text(writer, f"ok:{port + 1}")
                    broadcast_seats(room)
                else:
                    ws_text(writer, "seatbusy")
                await writer.drain()
                continue
            parts = text.split(",")
            if len(parts) != 3:
                continue
            try:
                b, lx, ly = (int(p) for p in parts)
            except ValueError:
                continue
            b &= 0xFFFF
            lx = max(-32767, min(32767, lx))
            ly = max(-32767, min(32767, ly))
            if not await send_line(room, f"P {port} {b} {lx} {ly}"):
                ws_text(writer, "err:El Jugador 1 cerró la sala")
                await writer.drain()
                break
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        if room.seats.get(port) is writer:
            del room.seats[port]
            await send_line(room, f"P {port} 0 0 0")
            await send_line(room, f"L {port}")
            broadcast_seats(room)
        print(f"mando web {code}: J{port + 1} desconectado", flush=True)


async def http_handle(reader, writer):
    try:
        request = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    except Exception:
        writer.close()
        return
    lines = request.decode("latin-1").split("\r\n")
    try:
        method, target, _ = lines[0].split(" ", 2)
    except ValueError:
        writer.close()
        return
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    url = urlparse(target)
    try:
        if url.path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
            key = headers.get("sec-websocket-key", "")
            accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            writer.write(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
            )
            await writer.drain()
            sock = writer.get_extra_info("socket")
            if sock is not None:
                import socket as _s
                try:
                    sock.setsockopt(_s.IPPROTO_TCP, _s.TCP_NODELAY, 1)
                except OSError:
                    pass
            q = parse_qs(url.query)
            code = q.get("code", [""])[0].strip().upper()
            try:
                wanted = int(q.get("seat", ["0"])[0])
            except ValueError:
                wanted = 0
            await websocket(reader, writer, code, wanted)
        elif method == "GET" and url.path in ("/", "/play"):
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-cache\r\n"
                + f"Content-Length: {len(PAGE)}\r\nConnection: close\r\n\r\n".encode()
                + PAGE
            )
            await writer.drain()
        elif method == "GET" and url.path == "/manifest.json":
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/manifest+json\r\n"
                + f"Content-Length: {len(MANIFEST)}\r\nConnection: close\r\n\r\n".encode()
                + MANIFEST
            )
            await writer.drain()
        else:
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass
