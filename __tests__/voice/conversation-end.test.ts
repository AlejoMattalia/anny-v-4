import { explicitlyEndsConversation } from '../../src/services/ConversationEnd';

it.each(['Anny, terminá la conversación.', 'Cerrá la charla por favor', 'Dejemos de hablar', 'Chau Anny', 'Quiero terminar esta conversación', 'Quiero que termines la conversación', 'Ya no quiero seguir hablando', 'Colgá', 'Anny colgá la llamada', 'Finalizar llamada', 'Cortar la llamada', 'Terminemos la llamada', 'Cortala por favor'])('accepts an explicit request: %s', text => {
  expect(explicitlyEndsConversation(text)).toBe(true);
});
it.each(['Quiero ir a la plaza caminando', 'Terminá el viaje', 'Finalizá el streaming', 'No cierres la conversación', '¿Cómo cierro la conversación?', 'Listo', 'Empezá el viaje', 'No cuelgues', '¿Cómo hago para colgar la llamada?', 'Finalizar viaje'])('keeps the conversation for other requests: %s', text => {
  expect(explicitlyEndsConversation(text)).toBe(false);
});
