import type { z } from "zod/v4";
import type { SapAdapter } from "../sap/adapter.ts";

export interface ContextoHerramienta {
  /** Raíz del proyecto: las herramientas resuelven rutas desde aquí. */
  directory: string;
  sessionId: string;
  /** Adaptador SAP a usar. Si se omite, las herramientas usan el SAP simulado sobre `out/sap/`. */
  sap?: SapAdapter;
}

/** Contrato PRD 6.2: description + args (zod) + execute que devuelve un string JSON y nunca lanza. */
export interface Herramienta<S extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: S;
  execute(args: z.infer<z.ZodObject<S>>, ctx: ContextoHerramienta): Promise<string>;
}

export const definir = <S extends z.ZodRawShape>(h: Herramienta<S>): Herramienta<S> => h;

export const ok = (data: unknown): string => JSON.stringify({ ok: true, data });
export const fail = (error: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ok: false, error, ...extra });

/** Garantiza "nunca lanza": cualquier excepción inesperada se convierte en { ok: false, error }. */
export async function seguro(fn: () => Promise<string> | string): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    return fail(`Error inesperado: ${(e as Error).message}`);
  }
}
