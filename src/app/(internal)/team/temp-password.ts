/** Easy-to-read temporary passwords an owner can read out on the phone, e.g. "Marigold-4821". */
const WORDS = ["Marigold", "Lotus", "Mango", "Peacock", "Saffron", "Jasmine", "Banyan", "Monsoon", "Lantern", "Henna", "Tabla", "Rangoli"];

export function suggestTemporaryPassword(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const word = WORDS[buf[0] % WORDS.length];
  const digits = String(buf[1] % 10000).padStart(4, "0");
  return `${word}-${digits}`;
}
