import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { descartarPendientes, esRechazo, excepcionesPendientes, pendientesDe, registrarMensajeUsuario, type Excepcion } from "../domain/confirmaciones.ts";
import { ErrorLlm, type MensajeLlm, type ProveedorLlm } from "../llm/adapter.ts";
import type { SapAdapter } from "../sap/adapter.ts";
import { definicionesParaModelo, ejecutarHerramienta, resumir } from "../tools/index.ts";

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  /** Resultado completo (recortado) para el detalle desplegable del chat. */
  resultado: string;
}

export type EntradaTranscripcion =
  | { tipo: "usuario"; texto: string }
  | { tipo: "asistente"; texto: string }
  | ({ tipo: "herramienta" } & LlamadaHerramienta)
  | { tipo: "error"; texto: string };

export interface Sesion {
  id: string;
  mensajes: MensajeLlm[];
  transcripcion: EntradaTranscripcion[];
  tokens: number;
  ocupada: boolean;
  creada: string;
}

export interface ResultadoTurno {
  reply: string;
  toolCalls: LlamadaHerramienta[];
  needsConfirmation: boolean;
  pendientes: string[];
  /** Excepciones por caso, generadas por el servidor (no por el modelo), con los valores que se muestran. */
  excepciones: Array<{ caso: string; items: Excepcion[] }>;
  tokensSesion: number;
  error?: string;
}

export interface DependenciasCiclo {
  llm: ProveedorLlm;
  directory: string;
  /** Adaptador SAP a inyectar en las herramientas. Por defecto, el SAP simulado. */
  sap?: SapAdapter;
  /** Devuelve el system prompt (se evalúa en cada turno para que editar el prompt no exija reiniciar). */
  system: () => string;
}

let tokensGlobales = 0;
export const tokensUsadosGlobal = () => tokensGlobales;

export function nuevaSesion(id: string): Sesion {
  return { id, mensajes: [], transcripcion: [], tokens: 0, ocupada: false, creada: new Date().toISOString() };
}

/** Comportamiento (agent/prompt.md) + conocimiento (src/knowledge/) forman el system prompt. */
export function cargarSystem(raiz: string): string {
  const prompt = readFileSync(join(raiz, "agent", "prompt.md"), "utf8");
  const conocimiento = readFileSync(join(raiz, "src", "knowledge", "ordenes-compra.md"), "utf8");
  return `${prompt.trim()}\n\n---\n\n# Conocimiento del proceso (consúltalo, no lo repitas)\n\n${conocimiento.trim()}\n`;
}

const recortar = (t: string, max = 6000) => (t.length > max ? `${t.slice(0, max)}… [recortado]` : t);

/**
 * Ciclo del agente (CA1–CA5): modelo → herramientas → modelo… con tope de iteraciones y de tokens.
 * Un error del proveedor o de una herramienta se muestra en el chat y la sesión sigue viva.
 */
export async function turno(sesion: Sesion, texto: string, deps: DependenciasCiclo): Promise<ResultadoTurno> {
  const cfg = config();
  const toolCalls: LlamadaHerramienta[] = [];
  const respuestas: string[] = [];
  let error: string | undefined;

  sesion.mensajes.push({ rol: "usuario", texto });
  sesion.transcripcion.push({ tipo: "usuario", texto });
  registrarMensajeUsuario(sesion.id);
  if (esRechazo(texto)) descartarPendientes(sesion.id);

  const ctx = { directory: deps.directory, sessionId: sesion.id, sap: deps.sap };
  const herramientas = definicionesParaModelo();

  try {
    for (let i = 0; ; i++) {
      if (sesion.tokens >= cfg.maxTokensSesion || tokensGlobales >= cfg.maxTokensGlobal) {
        throw new ErrorLlm(
          sesion.tokens >= cfg.maxTokensSesion
            ? "Esta sesión alcanzó su límite de tokens. Abre una sesión nueva para continuar."
            : "El servicio alcanzó su límite global de uso para esta demo.",
        );
      }
      const ultimaVuelta = i >= cfg.maxIteraciones;
      const system = ultimaVuelta
        ? `${deps.system()}\n\nHas alcanzado el tope de pasos por turno. Responde ahora SIN llamar herramientas: resume lo que lograste y lo que falta.`
        : deps.system();

      const r = await deps.llm.enviar(sesion.mensajes, herramientas, { system, permitirHerramientas: !ultimaVuelta });
      sesion.tokens += r.uso.entrada + r.uso.salida;
      tokensGlobales += r.uso.entrada + r.uso.salida;
      sesion.mensajes.push({ rol: "asistente", contenido: r.contenido });

      for (const c of r.contenido) {
        if (c.tipo === "texto") {
          respuestas.push(c.texto);
          sesion.transcripcion.push({ tipo: "asistente", texto: c.texto });
        }
      }

      const llamadas = r.contenido.flatMap((c) => (c.tipo === "llamada" ? [c] : []));
      if (r.fin !== "herramientas" || llamadas.length === 0 || ultimaVuelta) break;

      const resultados: Array<{ id: string; nombre: string; contenido: string }> = [];
      for (const l of llamadas) {
        const salida = await ejecutarHerramienta(l.nombre, l.args, ctx);
        let ok = false;
        try {
          ok = (JSON.parse(salida) as { ok?: boolean }).ok === true;
        } catch {
          /* salida no JSON: se considera fallida */
        }
        const llamada: LlamadaHerramienta = {
          id: l.id,
          nombre: l.nombre,
          args: l.args,
          ok,
          resumen: resumir(l.nombre, salida),
          resultado: recortar(salida),
        };
        toolCalls.push(llamada);
        sesion.transcripcion.push({ tipo: "herramienta", ...llamada });
        resultados.push({ id: l.id, nombre: l.nombre, contenido: salida });
      }
      sesion.mensajes.push({ rol: "herramienta", resultados });
    }
  } catch (e) {
    error = e instanceof ErrorLlm ? e.message : `Error inesperado en el agente: ${(e as Error).message}`;
    sesion.transcripcion.push({ tipo: "error", texto: error });
    // Mantiene la alternancia de roles para que la sesión pueda continuar en el siguiente mensaje.
    const ultimo = sesion.mensajes[sesion.mensajes.length - 1];
    if (ultimo && ultimo.rol !== "asistente") {
      sesion.mensajes.push({ rol: "asistente", contenido: [{ tipo: "texto", texto: `[Error técnico] ${error}` }] });
    }
  }

  const pendientes = pendientesDe(sesion.id);
  return {
    reply: respuestas.join("\n\n") || (error ? "" : "(sin respuesta)"),
    toolCalls,
    needsConfirmation: pendientes.length > 0,
    pendientes,
    excepciones: excepcionesPendientes(sesion.id),
    tokensSesion: sesion.tokens,
    ...(error ? { error } : {}),
  };
}
