import { normalizeVoiceText } from './VoiceCommands';

export function explicitlyEndsConversation(transcript: string) {
  const text = normalizeVoiceText(transcript).replace(/[¿?¡!.,]/g, '').trim();
  if (/^(anny )?(ya )?no quiero (seguir )?(hablar|conversar|hablando|conversando)( mas)?( con vos)?$/.test(text)) return true;
  if (!text || /\b(no|nunca|como|cuando|por que)\b/.test(text)) return false;
  if (/^(anny )?(por favor )?(quiero |podes |podrias )?(salir|sali|sal|salite|salirnos) (de |de la |de esta )?(conversacion|charla|llamada)( por favor)?$/.test(text)) return true;
  if (/^(anny )?(por favor )?(apaga|apagar|desactiva|desactivar)( la| el)? (ia|inteligencia artificial|conversacion|asistente)( por favor)?$/.test(text)) return true;
  if (/\b(viaje|ruta|streaming|escaneo|destino)\b/.test(text)) return false;
  if (/^(anny )?(colga|colgar|colguemos)( (la |esta )?llamada)?( (anny|por favor|ahora))?$/.test(text)) return true;
  if (/^(anny )?(cortala|cerrala|terminala|finalizala)( por favor)?$/.test(text)) return true;
  if (/^(anny )?(terminar|finalizar|cerrar|cortar|terminemos|finalicemos) (la |esta )?(llamada|conversacion|charla)( por favor)?$/.test(text)) return true;
  return /^(anny\s+)?(chau|adios|hasta luego|nos vemos)(\s+anny)?$/.test(text) ||
    /\b(deja|dejemos|para|paremos) de (hablar|conversar)\b/.test(text) ||
    /^(anny\s+)?(termina|finaliza|cerra|cierra|corta)(\s+(la |esta |nuestra )?(conversacion|charla|llamada|voz))?(\s+(anny|por favor|ahora))?$/.test(text) ||
    /\b(quiero|podes|podrias) (que )?(terminar|finalizar|cerrar|cortar|termines|finalices|cierres|cortes) (la |esta )?(conversacion|charla|llamada)\b/.test(text);
}

// A bare exit leaves the current function; on the conversation screen it hangs up.
export function explicitlyExitsFunction(transcript: string) {
  const text = normalizeVoiceText(transcript).replace(/^(anny|any|ani|annie) /, '')
    .replace(/^por favor /, '').replace(/ por favor$/, '');
  return /^(quiero |podes |podrias )?(salir|sali|sal|salite)( de aca| de aqui| de esto| al inicio| al menu| de(l)? (stream|streaming|escaneo)| de (la|esta) funcion)?$/.test(text) ||
    /^(quiero |podes |podrias )?(volver|volve) al (inicio|menu)$/.test(text) ||
    /^(cerra|cerrar|cierra|termina|terminar|finaliza|finalizar)( el)? (stream|streaming|escaneo)$/.test(text);
}
