/** NIT sin puntos ni dígito de verificación: "900.555.111-2" -> "900555111". */
export function normalizarNit(nit: string): string {
  const base = nit.trim().split("-")[0] ?? "";
  return base.replace(/\D/g, "");
}

/** Nombre comparable: sin tildes, minúsculas y sin sufijos societarios (S.A.S., Ltda., S.A.). */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(s a s|sas|s a|sa|ltda|ltd|e u|eu)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Formato colombiano: el punto separa miles y la coma decimales. */
export function parseMonto(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (!limpio) return null;
  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function sumarDias(fechaIso: string, dias: number): string {
  const [a, m, d] = fechaIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function diasEntre(desde: string, hasta: string): number {
  const t = (f: string) => {
    const [a, m, d] = f.split("-").map(Number) as [number, number, number];
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((t(hasta) - t(desde)) / 86_400_000);
}

export const cop = (n: number): string => `$${Math.round(n).toLocaleString("es-CO")}`;

/** JSON con claves ordenadas: permite comparar objetos sin depender del orden de las claves. */
export function canonico(valor: unknown): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, ordenar(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(ordenar(valor));
}

/** Corta en el límite de palabra para no dejar términos a medias ("corporati"). */
export function acortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  if (limpio[max] === " ") return corte.trimEnd();
  const ultimoEspacio = corte.lastIndexOf(" ");
  return (ultimoEspacio > 0 ? corte.slice(0, ultimoEspacio) : corte).trimEnd();
}
