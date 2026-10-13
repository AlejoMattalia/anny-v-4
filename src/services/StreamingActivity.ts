/** Only an explicitly running Android lens service may analyze off screen. */
export function canRunStreaming(
  focused: boolean, foreground: boolean, source: 'glasses' | 'phone',
  android: boolean, backgroundReady: boolean,
) {
  return focused && (foreground || (android && source === 'glasses' && backgroundReady));
}
