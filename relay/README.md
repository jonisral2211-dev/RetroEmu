# JL Relay (salas de juego en línea)

Servidor mínimo (Python 3, sin dependencias) que empareja dos iPhone con un código de sala de
6 caracteres y reenvía el tráfico TCP entre ellos. Así se juega a distancia sin abrir puertos en
el router de los jugadores: los dos se conectan hacia fuera a este servidor.

- Puerto: 55436/TCP (configurable con `--port`).
- Tráfico: ~1,5 KB/s por partida (entradas de mando); la partida inicial (save state) se envía una vez.
- No guarda nada en disco ni interpreta los datos del juego.

## Ejecutar

```sh
docker build -t jl-relay relay/
docker run -d --restart unless-stopped -p 55436:55436 --name jl-relay jl-relay
```

o directamente `python3 relay/jl_relay.py --port 55436`.

Necesita una IP o dominio públicos (VPS, nube o un PC con el puerto 55436 abierto). En la app:
partida → engranaje → Jugar en línea → "Servidor de salas" = `tu-servidor:55436`.

`--delay-ms N` añade latencia artificial por sentido (solo para pruebas de rollback).
