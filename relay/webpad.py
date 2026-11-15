"""Mando web para el Jugador 2 (sin instalar la app).

- La app (iPhone del Jugador 1) abre una conexión TCP al relay: "JLRL1 PADHOST\\n" -> "CODE ABC123\\n".
  Después recibe líneas "J" (se unió alguien), "L" (se fue) y "P <botones> <lx> <ly>" con el
  estado del mando web, y las inyecta en el puerto 1 de Libretro.
- El navegador del Jugador 2 abre http://<relay>:8080/play?code=ABC123 y se conecta por WebSocket
  a /ws?code=ABC123; cada cambio de botones se envía como texto "botones,lx,ly".

Solo biblioteca estándar: WebSocket mínimo (RFC 6455, mensajes de texto cortos).
"""
import asyncio
import base64
import hashlib
import secrets
import struct
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
PAGE = (Path(__file__).with_name("webpad.html")).read_bytes()

# código -> (writer de la app, asyncio.Lock para escribir líneas sin mezclarlas)
pads: dict[str, tuple[asyncio.StreamWriter, asyncio.Lock]] = {}
# código -> navegadores conectados (para reenviarles la vibración del juego)
viewers: dict[str, set] = {}


def new_code(taken) -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if code not in pads and code not in taken:
            return code


async def send_line(code: str, line: str) -> bool:
    entry = pads.get(code)
    if not entry:
        return False
    writer, lock = entry
    try:
        async with lock:
            writer.write((line + "\n").encode())
            await writer.drain()
        return True
    except Exception:
        return False


async def pad_host(reader, writer, taken):
    """Conexión TCP de la app que recibe el mando web."""
    code = new_code(taken)
    pads[code] = (writer, asyncio.Lock())
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
                if not await send_line(code, "PING"):
                    break
                continue
            # "R fuerte débil" (0-100): vibración del Jugador 2 que manda el juego
            parts = raw.decode("ascii", "ignore").split()
            if len(parts) == 3 and parts[0] == "R":
                frame = ws_frame(1, f"rumble:{parts[1]},{parts[2]}".encode())
                for w in list(viewers.get(code, ())):
                    try:
                        w.write(frame)
                    except Exception:
                        viewers.get(code, set()).discard(w)
    except Exception:
        pass
    finally:
        pads.pop(code, None)
        viewers.pop(code, None)
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


def ws_frame(opcode: int, payload: bytes) -> bytes:
    n = len(payload)
    if n < 126:
        return bytes([0x80 | opcode, n]) + payload
    return bytes([0x80 | opcode, 126]) + struct.pack(">H", n) + payload


async def websocket(reader, writer, code: str):
    if code not in pads:
        writer.write(ws_frame(1, "err:Código no encontrado o sala cerrada".encode()))
        writer.write(ws_frame(8, b""))
        await writer.drain()
        return
    await send_line(code, "J")
    viewers.setdefault(code, set()).add(writer)
    writer.write(ws_frame(1, b"ok"))
    await writer.drain()
    print(f"mando web {code}: jugador conectado", flush=True)
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
            parts = payload.decode("ascii", "ignore").split(",")
            if len(parts) != 3:
                continue
            try:
                b, lx, ly = (int(p) for p in parts)
            except ValueError:
                continue
            b &= 0xFFFF
            lx = max(-32767, min(32767, lx))
            ly = max(-32767, min(32767, ly))
            if not await send_line(code, f"P {b} {lx} {ly}"):
                writer.write(ws_frame(1, "err:El Jugador 1 cerró la sala".encode()))
                await writer.drain()
                break
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        viewers.get(code, set()).discard(writer)
        await send_line(code, "P 0 0 0")
        await send_line(code, "L")
        print(f"mando web {code}: jugador desconectado", flush=True)


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
            code = parse_qs(url.query).get("code", [""])[0].strip().upper()
            await websocket(reader, writer, code)
        elif method == "GET" and url.path in ("/", "/play"):
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-cache\r\n"
                + f"Content-Length: {len(PAGE)}\r\nConnection: close\r\n\r\n".encode()
                + PAGE
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
