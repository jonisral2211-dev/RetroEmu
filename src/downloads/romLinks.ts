// Extensiones que el navegador intercepta y descarga dentro de la app en vez de abrirlas.
// Sin enlaces ni sitios preconfigurados: el usuario navega donde quiera y guarda sus marcadores.
export const ROM_EXTENSIONS = [
  '.zip',
  '.7z',
  '.gba',
  '.agb',
  '.z64',
  '.n64',
  '.v64',
  '.md',
  '.gen',
  '.smd',
  '.bin',
  '.cue',
  '.iso',
  '.chd',
];

export function hasRomExtension(name: string): boolean {
  const path = name.split(/[?#]/)[0].toLowerCase();
  return ROM_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function isRomUrl(url: string): boolean {
  return /^https?:/i.test(url) && hasRomExtension(url);
}
