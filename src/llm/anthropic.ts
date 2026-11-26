import { config } from "../config.ts";
import {
  ErrorLlm,
  type ContenidoAsistente,
  type DefinicionHerramienta,
  type MensajeLlm,
  type OpcionesLlm,
  type ProveedorLlm,
  type RespuestaLlm,
} from "./adapter.ts";

/** ANTHROPIC_BASE_URL permite apuntar a un proxy o a un servidor simulado en pruebas. */
const urlApi = () => `${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`;

type BloqueApi =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface RespuestaApi {
  content: BloqueApi[];
  stop_reason: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function aMensajesApi(mensajes: MensajeLlm[]) {
  return mensajes.map((m) => {
    if (m.rol === "usuario") return { role: "user", content: m.texto };
    if (m.rol === "asistente") {
      const content: BloqueApi[] = m.contenido.map((c) =>
        c.tipo === "texto"
          ? { type: "text", text: c.texto }
          : { type: "tool_use", id: c.id, name: c.nombre, input: c.args },
      );
      return { role: "assistant", content };
    }
    const content: BloqueApi[] = m.resultados.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: r.contenido,
    }));
    return { role: "user", content };
  });
}

function mensajeDeError(estado: number, cuerpo: string): string {
  let detalle = "";
  try {
    detalle = String((JSON.parse(cuerpo) as { error?: { message?: string } }).error?.message ?? "").slice(0, 200);
  } catch {
    /* cuerpo no JSON */
  }
  if (estado === 401 || estado === 403) return "La clave del modelo no es válida o no tiene permisos. Revisa ANTHROPIC_API_KEY en el servidor.";
  if (estado === 429) return "El proveedor del modelo está limitando las solicitudes. Intenta de nuevo en un momento.";
  if (/credit balance/i.test(detalle)) return "La cuenta del proveedor del modelo no tiene saldo disponible.";
  if (estado >= 500) return "El proveedor del modelo tuvo un error temporal. Intenta de nuevo.";
  return `El proveedor del modelo rechazó la solicitud (${estado}${detalle ? `: ${detalle}` : ""}).`;
}

export class ProveedorAnthropic implements ProveedorLlm {
  readonly nombre = "anthropic";
  readonly modelo: string;

  constructor(
    modelo = config().modelo,
    private readonly timeoutMs = config().timeoutLlmMs,
  ) {
    this.modelo = modelo;
  }

  get configurado(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async enviar(
    mensajes: MensajeLlm[],
    herramientas: DefinicionHerramienta[],
    opciones: OpcionesLlm,
  ): Promise<RespuestaLlm> {
    const clave = process.env.ANTHROPIC_API_KEY;
    if (!clave) throw new ErrorLlm("El servidor no tiene configurada la clave del modelo (ANTHROPIC_API_KEY).");

    const tools = herramientas.map((h, i) => ({
      name: h.nombre,
      description: h.descripcion,
      input_schema: h.esquema,
      // Caché del prefijo estático (herramientas + system): abarata cada vuelta del ciclo.
      ...(i === herramientas.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
    }));

    let respuesta: Response;
    try {
      respuesta = await fetch(urlApi(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.modelo,
          max_tokens: 2000,
          system: [{ type: "text", text: opciones.system, cache_control: { type: "ephemeral" } }],
          tools,
          ...(opciones.permitirHerramientas === false ? { tool_choice: { type: "none" } } : {}),
          messages: aMensajesApi(mensajes),
        }),
      });
    } catch (e) {
      const nombre = (e as Error).name;
      if (nombre === "TimeoutError" || nombre === "AbortError") {
        throw new ErrorLlm(`El modelo no respondió en ${Math.round(this.timeoutMs / 1000)} s. Intenta de nuevo.`);
      }
      throw new ErrorLlm("No se pudo conectar con el proveedor del modelo.");
    }

    if (!respuesta.ok) throw new ErrorLlm(mensajeDeError(respuesta.status, await respuesta.text()));

    const datos = (await respuesta.json()) as RespuestaApi;
    const contenido: ContenidoAsistente[] = [];
    for (const b of datos.content) {
      if (b.type === "text" && b.text.trim()) contenido.push({ tipo: "texto", texto: b.text });
      else if (b.type === "tool_use") contenido.push({ tipo: "llamada", id: b.id, nombre: b.name, args: b.input });
    }
    const u = datos.usage ?? {};
    return {
      contenido,
      fin: datos.stop_reason === "tool_use" ? "herramientas" : datos.stop_reason === "max_tokens" ? "limite" : "fin",
      uso: {
        entrada: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        salida: u.output_tokens ?? 0,
      },
    };
  }
}
