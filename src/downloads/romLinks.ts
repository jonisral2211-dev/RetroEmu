// Extensiones que el navegador intercepta y descarga en vez de abrir.
const ROM_EXTENSIONS = ['.zip', '.gba', '.agb', '.z64', '.n64', '.v64', '.md', '.gen', '.smd', '.bin'];

export function isRomUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0].toLowerCase();
  return ROM_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// Accesos rápidos del navegador. Edita esta lista para añadir tus sitios.
export const QUICK_LINKS: { label: string; url: string }[] = [
  { label: 'Buscar', url: 'https://duckduckgo.com/' },
  { label: 'Internet Archive', url: 'https://archive.org/' },
];
