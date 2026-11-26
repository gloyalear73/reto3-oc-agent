/**
 * Interfaz propia del proveedor LLM (PRD 6.1). El ciclo del agente solo conoce estos tipos;
 * cambiar de proveedor implica escribir otro archivo en src/llm/ y no tocar el ciclo.
 */
export type ContenidoAsistente =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; id: string; nombre: string; args: unknown };

export type MensajeLlm =
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; contenido: ContenidoAsistente[] }
  | { rol: "herramienta"; resultados: Array<{ id: string; nombre: string; contenido: string }> };

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  esquema: Record<string, unknown>;
}

export interface RespuestaLlm {
  contenido: ContenidoAsistente[];
  /** "herramientas": el modelo pide ejecutar herramientas · "fin": terminó · "limite": se cortó por longitud. */
  fin: "herramientas" | "fin" | "limite";
  uso: { entrada: number; salida: number };
}

export interface OpcionesLlm {
  system: string;
  /** false = el modelo debe responder en texto sin llamar herramientas (cierre al llegar al tope). */
  permitirHerramientas?: boolean;
}

export interface ProveedorLlm {
  readonly nombre: string;
  readonly modelo: string;
  /** true si hay credenciales configuradas; nunca expone la clave. */
  readonly configurado: boolean;
  enviar(mensajes: MensajeLlm[], herramientas: DefinicionHerramienta[], opciones: OpcionesLlm): Promise<RespuestaLlm>;
}

/** Error con mensaje apto para mostrar al usuario (nunca incluye claves ni cabeceras). */
export class ErrorLlm extends Error {}
