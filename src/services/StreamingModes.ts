export const STREAMING_MODES = {
  viaje: {label: 'Viaje', hint: 'Entorno y puntos de referencia', query: 'Describí el entorno y una referencia visible en una frase breve y completa, de hasta 20 palabras.'},
  facultad: {label: 'Facultad', hint: 'Textos, pizarras y aulas', query: 'Leé lo más importante del texto visible o describí una referencia del aula en una frase breve y completa, de hasta 20 palabras.'},
  supermercado: {label: 'Supermercado', hint: 'Productos, etiquetas y precios', query: 'Identificá el producto, su precio legible y su posición en una frase breve y completa, de hasta 20 palabras.'},
  deporte: {label: 'Deporte', hint: 'Caminata guiada por tramos', query: 'Indicá el siguiente punto visible y un obstáculo relevante del camino en una frase breve y completa, de hasta 20 palabras.'},
  seguro: {label: 'Seguro', hint: 'Obstáculos y posibles peligros', query: 'Indicá el peligro visible más próximo, su posición y una precaución en una frase breve y completa, de hasta 20 palabras.'},
} as const;

export type StreamingMode = keyof typeof STREAMING_MODES;

export function isStreamingMode(value: unknown): value is StreamingMode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STREAMING_MODES, value);
}

// Match explicit commands only: mentioning a mode in a question must not switch it.
export function parseStreamingModeCommand(text: string): StreamingMode | null {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(?:(?:hola )?(?:anny|any|ani|annie) )?(?:por favor )?(?:(?:(?:activa|activar|activame|habilita|habilitar|inicia|iniciar|pone|poneme|pon|poner)(?: el)?|(?:cambia|cambiar|cambiame|pasar|pasa)(?: a| al)|quiero(?: activar| usar)?(?: el)?) )?modo (?:de )?(facultad|facultas|universidad|supermercado|super mercado|compras|viaje|deporte|deportes|seguro|seguridad)(?: por favor)?$/);
  if (!match) return null;
  const aliases: Record<string, StreamingMode> = {
    facultad: 'facultad', facultas: 'facultad', universidad: 'facultad',
    supermercado: 'supermercado', 'super mercado': 'supermercado', compras: 'supermercado',
    viaje: 'viaje', deporte: 'deporte', deportes: 'deporte', seguro: 'seguro', seguridad: 'seguro',
  };
  return aliases[match[1]];
}
