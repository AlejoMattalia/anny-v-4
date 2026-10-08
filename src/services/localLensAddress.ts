/** Only send device credentials to an explicitly selected local endpoint. */
export function normalizeLocalLensAddress(value: string): string {
  const match = /^(?:http:\/\/)?([a-z0-9.-]+)(?::([0-9]{1,5}))?\/?$/i.exec(
    value.trim(),
  );
  if (!match)
    {throw new Error('Ingresá una IP local o un nombre terminado en .local.');}
  const host = match[1].toLowerCase();
  const octets = host.split('.').map(Number);
  const ipv4 =
    /^\d+\.\d+\.\d+\.\d+$/.test(host) && octets.every(n => n >= 0 && n <= 255);
  const privateIp =
    ipv4 &&
    (octets[0] === 10 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const localName = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.local$/.test(host);
  const port = match[2] ? Number(match[2]) : 80;
  if ((!privateIp && !localName) || port < 1 || port > 65535) {
    throw new Error('La dirección debe pertenecer a tu red local.');
  }
  const canonicalHost = ipv4 ? octets.join('.') : host;
  return `http://${canonicalHost}${port === 80 ? '' : `:${port}`}`;
}
