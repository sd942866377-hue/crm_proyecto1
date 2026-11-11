/**
 * Enmascara un contacto para respuestas que salen del bot (API del control
 * plane / app móvil): suficiente para reconocer al cliente, sin volcar el dato
 * entero. Compartido por /api/leads y el inbox móvil.
 */
export function maskContact(v: string | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const [u, dom] = s.split("@");
    return `${u.slice(0, 2)}***@${dom}`;
  }
  return s.length > 4 ? `***${s.slice(-4)}` : s;
}
