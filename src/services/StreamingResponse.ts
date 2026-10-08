export const normalizeStreamingCurrency = (text: string): string =>
  text
    .replace(
      /\$\s*([+-]?\d(?:[\d.,]*\d)?(?:\s*(?:mil|millones?|billones?))?)(\s+pesos?\b)?/gi,
      (_match, amount: string, pesos: string | undefined) =>
        `${amount}${pesos || ' pesos'}`,
    )
    .replace(/\$/g, 'pesos');
