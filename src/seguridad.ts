import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Clave de acceso opcional del enlace público. Sin clave configurada, todo acceso es válido.
 * Se comparan los hashes con `timingSafeEqual` para no filtrar por tiempo cuántos caracteres coincidieron.
 */
export function claveValida(esperada: string, recibida: string | undefined): boolean {
  if (!esperada) return true;
  if (!recibida) return false;
  const a = createHash("sha256").update(esperada).digest();
  const b = createHash("sha256").update(recibida).digest();
  return timingSafeEqual(a, b);
}

export interface Limitador {
  /** true si la clave (p. ej. una IP) puede hacer otra petición ahora; en ese caso la cuenta. */
  permitir(clave: string): boolean;
}

/**
 * Ventana deslizante de 60 s por clave. En memoria: se reinicia con el servidor.
 * `maxClaves` acota la memoria ante muchas IPs distintas.
 */
export function crearLimitador(maxPorMinuto: number, ahora: () => number = Date.now, maxClaves = 5000): Limitador {
  const golpes = new Map<string, number[]>();
  const VENTANA_MS = 60_000;
  return {
    permitir(clave) {
      const t = ahora();
      const recientes = (golpes.get(clave) ?? []).filter((x) => t - x < VENTANA_MS);
      const permitido = recientes.length < maxPorMinuto;
      if (permitido) recientes.push(t);
      golpes.set(clave, recientes);

      if (golpes.size > maxClaves) {
        for (const [k, v] of golpes) if (!v.some((x) => t - x < VENTANA_MS)) golpes.delete(k);
        if (golpes.size > maxClaves) golpes.delete(golpes.keys().next().value as string);
      }
      return permitido;
    },
  };
}

/**
 * IP del cliente. `X-Forwarded-For` solo se usa si se confía en el proxy (TRUST_PROXY=1), y entonces se toma
 * el ÚLTIMO valor, que es el que añadió el proxy; los anteriores los puede escribir el propio cliente.
 */
export function ipCliente(xff: string | string[] | undefined, remota: string | undefined): string {
  const valor = Array.isArray(xff) ? xff.join(",") : xff;
  const ultimo = valor
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return ultimo || remota || "desconocida";
}

/**
 * En el despliegue público la clave de acceso es obligatoria (`REQUIRE_ACCESS_KEY=1`): sin ella el servidor no arranca,
 * para no dejar por descuido un enlace abierto que gasta la clave del modelo.
 */
export function errorDeArranque(cfg: { exigirClave: boolean; claveAcceso: string }): string | null {
  return cfg.exigirClave && !cfg.claveAcceso
    ? "REQUIRE_ACCESS_KEY=1 pero ACCESS_KEY está vacía: define ACCESS_KEY o quita REQUIRE_ACCESS_KEY."
    : null;
}
