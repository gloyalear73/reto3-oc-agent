import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { definicionesParaModelo, ejecutarHerramienta, HERRAMIENTAS, type Contexto } from "../tools/oc.ts";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const MAX_ITERACIONES = 8;

export const SYSTEM_PROMPT = readFileSync(resolve("agent/prompt.md"), "utf8");

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Mensaje {
  role: "user" | "assistant";
  content: string | Bloque[];
}

/** Eventos que consume el frontend para mostrar el ciclo del agente. */
export type Evento =
  | { tipo: "texto"; texto: string }
  | { tipo: "herramienta"; nombre: string; entrada: unknown; resultado: unknown; requiereConfirmacion: boolean }
  | { tipo: "confirmacion"; token: string; decision: string; resumen: string; datosOC: unknown }
  | { tipo: "uso"; entrada: number; salida: number }
  | { tipo: "error"; mensaje: string };

export const llmDisponible = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * Ciclo del agente: modelo -> (tool_use -> ejecutar -> tool_result)* -> texto final.
 * Muta `historial` para mantener la conversación entre turnos.
 */
export async function turnoAgente(historial: Mensaje[], ctx: Contexto): Promise<Evento[]> {
  const eventos: Evento[] = [];
  if (!llmDisponible()) {
    return [{ tipo: "error", mensaje: "Falta ANTHROPIC_API_KEY. Usa el panel «Evaluar sin LLM» o configura la variable de entorno." }];
  }

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: definicionesParaModelo(),
        messages: historial,
      }),
    });

    if (!resp.ok) {
      eventos.push({ tipo: "error", mensaje: `API ${resp.status}: ${(await resp.text()).slice(0, 300)}` });
      return eventos;
    }

    const data = (await resp.json()) as { content: Bloque[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } };
    if (data.usage) eventos.push({ tipo: "uso", entrada: data.usage.input_tokens, salida: data.usage.output_tokens });
    historial.push({ role: "assistant", content: data.content });

    for (const b of data.content) if (b.type === "text" && b.text.trim()) eventos.push({ tipo: "texto", texto: b.text });

    const usos = data.content.filter((b): b is Extract<Bloque, { type: "tool_use" }> => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || usos.length === 0) return eventos;

    const resultados: Bloque[] = [];
    for (const u of usos) {
      const resultado = (await ejecutarHerramienta(u.name, u.input, ctx)) as any;
      const requiere = !!HERRAMIENTAS.find((h) => h.name === u.name)?.requiereConfirmacion;
      eventos.push({ tipo: "herramienta", nombre: u.name, entrada: u.input, resultado, requiereConfirmacion: requiere });
      if (resultado?.estado === "REQUIERE_CONFIRMACION") {
        eventos.push({ tipo: "confirmacion", token: resultado.token, decision: resultado.decision, resumen: resultado.resumen, datosOC: resultado.datosOC });
      }
      resultados.push({
        type: "tool_result",
        tool_use_id: u.id,
        content: JSON.stringify(resultado),
        is_error: !!resultado?.error,
      });
    }
    historial.push({ role: "user", content: resultados });
  }

  eventos.push({ tipo: "error", mensaje: "Se alcanzó el máximo de iteraciones del agente." });
  return eventos;
}
