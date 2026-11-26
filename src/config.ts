import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del proyecto: las rutas se resuelven siempre desde aquí, nunca absolutas. */
export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const entero = (valor: string | undefined, porDefecto: number): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : porDefecto;
};

/** Se lee en cada llamada para respetar el `.env` cargado al arrancar el servidor. */
export function config() {
  return {
    puerto: entero(process.env.PORT, 3000),
    proveedorLlm: (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase(),
    modelo: process.env.LLM_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    maxIteraciones: entero(process.env.MAX_ITERACIONES, 25),
    maxTokensSesion: entero(process.env.MAX_TOKENS_SESION, 200_000),
    maxTokensGlobal: entero(process.env.MAX_TOKENS_GLOBAL, 2_000_000),
    timeoutLlmMs: entero(process.env.LLM_TIMEOUT_MS, 60_000),
  };
}
