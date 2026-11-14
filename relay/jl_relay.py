#!/usr/bin/env python3
"""JL Relay: salas de juego en línea para JL Emulator con código de 6 caracteres.

Permite jugar a distancia sin abrir puertos en el router: los dos iPhone se conectan hacia
fuera a este servidor y él empalma ambas conexiones TCP (no interpreta los datos del juego).

Protocolo (líneas de texto; después, bytes en bruto en ambos sentidos):
  Anfitrión -> "JLRL1 HOST\\n"        servidor -> "CODE ABC123\\n"  (y "PING\\n" cada 20 s)
  Invitado  -> "JLRL1 JOIN ABC123\\n" servidor -> "PAIRED\\n" a los dos, o "ERR motivo\\n"

Mando web (Jugador 2 sin app): página /play en --http-port (8080), ver webpad.py.

Uso: python3 jl_relay.py [--port 55436] [--http-port 8080] [--delay-ms 0]
"""
import argparse
import asyncio
import secrets
import socket
import time

import webpad

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O ni 1/I: fácil de dictar
ROOM_TTL = 3600  # una sala espera al invitado como mucho 1 hora
MAX_ROOMS = 2000

rooms: dict[str, "Room"] = {}


class Room:
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.guest = asyncio.get_running_loop().create_future()
        self.created = time.monotonic()


def nodelay(writer):
    sock = writer.get_extra_info("socket")
    if sock is not None:
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass


def new_code() -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if code not in rooms:
            return code


async def pipe(reader, writer, delay):
    queue: asyncio.Queue = asyncio.Queue()

    async def delayed_writer():
        # Solo pruebas: cada bloque sale `delay` segundos después de llegar, sin frenar el caudal
        loop = asyncio.get_running_loop()
        while True:
            due, data = await queue.get()
            if data is None:
                break
            wait = due - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            writer.write(data)
            await writer.drain()

    writer_task = asyncio.ensure_future(delayed_writer()) if delay else None
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            if delay:
                queue.put_nowait((asyncio.get_running_loop().time() + delay, data))
            else:
                writer.write(data)
                await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        if writer_task:
            queue.put_nowait((0, None))
            try:
                await writer_task
            except Exception:
                pass
        try:
            writer.close()
        except Exception:
            pass


async def host_room(reader, writer, delay):
    if len(rooms) >= MAX_ROOMS:
        writer.write(b"ERR Servidor lleno, prueba en un momento\n")
        await writer.drain()
        writer.close()
        return
    code = new_code()
    room = Room(reader, writer)
    rooms[code] = room
    writer.write(f"CODE {code}\n".encode())
    await writer.drain()
    print(f"sala {code} creada", flush=True)
    try:
        # Mientras espera: PING periódico y detección de que el anfitrión se fue
        hangup = asyncio.ensure_future(reader.read(1))
        while not room.guest.done():
            done, _ = await asyncio.wait({room.guest, hangup}, timeout=20, return_when=asyncio.FIRST_COMPLETED)
            if hangup in done:
                raise ConnectionError("anfitrión desconectado")
            if time.monotonic() - room.created > ROOM_TTL:
                raise TimeoutError("sala caducada")
            if not done:
                writer.write(b"PING\n")
                await writer.drain()
        hangup.cancel()
        g_reader, g_writer = room.guest.result()
    except Exception as e:
        rooms.pop(code, None)
        if not room.guest.done():
            room.guest.cancel()
        print(f"sala {code} cerrada: {e}", flush=True)
        writer.close()
        return
    rooms.pop(code, None)
    for w in (writer, g_writer):
        w.write(b"PAIRED\n")
        await w.drain()
    print(f"sala {code} emparejada", flush=True)
    await asyncio.gather(pipe(reader, g_writer, delay), pipe(g_reader, writer, delay))
    print(f"sala {code} terminada", flush=True)


async def handle(reader, writer, delay):
    nodelay(writer)
    try:
        line = (await asyncio.wait_for(reader.readline(), 15)).decode("ascii", "replace").split()
    except Exception:
        writer.close()
        return
    if line[:2] == ["JLRL1", "HOST"]:
        await host_room(reader, writer, delay)
    elif line[:2] == ["JLRL1", "PADHOST"]:
        # Mando web: la app recibe aquí las pulsaciones del Jugador 2 desde el navegador
        await webpad.pad_host(reader, writer, rooms)
    elif line[:2] == ["JLRL1", "JOIN"] and len(line) == 3:
        room = rooms.pop(line[2].upper(), None)
        if room is None or room.guest.done():
            writer.write("ERR Código no encontrado o sala cerrada\n".encode())
            await writer.drain()
            writer.close()
            return
        room.guest.set_result((reader, writer))
        # El anfitrión hace el empalme; esta tarea solo mantiene viva la conexión
    else:
        writer.write(b"ERR Protocolo desconocido\n")
        writer.close()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=55436)
    ap.add_argument("--delay-ms", type=int, default=0, help="latencia artificial por sentido (pruebas)")
    ap.add_argument("--http-port", type=int, default=8080, help="página /play del mando web (0 = desactivada)")
    args = ap.parse_args()
    delay = args.delay_ms / 1000
    server = await asyncio.start_server(lambda r, w: handle(r, w, delay), "0.0.0.0", args.port)
    print(f"JL Relay escuchando en el puerto {args.port}", flush=True)
    servers = [server]
    if args.http_port:
        servers.append(await asyncio.start_server(webpad.http_handle, "0.0.0.0", args.http_port))
        print(f"Mando web en http://0.0.0.0:{args.http_port}/play", flush=True)
    await asyncio.gather(*(srv.serve_forever() for srv in servers))


if __name__ == "__main__":
    asyncio.run(main())
