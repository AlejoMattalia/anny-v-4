import { explicitlyEndsConversation, explicitlyExitsFunction } from '../../src/services/ConversationEnd';

it.each(['Salir de la conversación', 'Quiero salir de esta conversación', 'Apagá la IA', 'Desactivar el asistente', 'Anny, terminá la conversación.', 'Cerrá la charla por favor', 'Dejemos de hablar', 'Chau Anny', 'Quiero terminar esta conversación', 'Quiero que termines la conversación', 'Ya no quiero seguir hablando', 'Colgá', 'Anny colgá la llamada', 'Finalizar llamada', 'Cortar la llamada', 'Terminemos la llamada', 'Cortala por favor'])('accepts an explicit request: %s', text => {
  expect(explicitlyEndsConversation(text)).toBe(true);
});
it.each(['Quiero ir a la plaza caminando', 'Terminá el viaje', 'Finalizá el streaming', 'No cierres la conversación', '¿Cómo cierro la conversación?', 'Listo', 'Empezá el viaje', 'No cuelgues', '¿Cómo hago para colgar la llamada?', 'Finalizar viaje'])('keeps the conversation for other requests: %s', text => {
  expect(explicitlyEndsConversation(text)).toBe(false);
});

it.each(['Salir', 'Anny, salí por favor', 'Quiero salir del streaming', 'Volvé al inicio', 'Cerrar el streaming'])('recognizes a function exit: %s', text => {
  expect(explicitlyExitsFunction(text)).toBe(true);
});
it.each(['No quiero salir', '¿Cómo salir?', 'Quiero salir a caminar', 'Salir de la conversación', '¿Dónde estoy?'])('does not exit a function for unrelated speech: %s', text => {
  expect(explicitlyExitsFunction(text)).toBe(false);
});
