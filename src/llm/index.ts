import { config } from "../config.ts";
import type { ProveedorLlm } from "./adapter.ts";
import { ProveedorAnthropic } from "./anthropic.ts";

/** Fábrica: para otro proveedor, agregar su archivo en src/llm/ y un caso aquí. */
export function crearProveedor(): ProveedorLlm {
  const { proveedorLlm } = config();
  switch (proveedorLlm) {
    case "anthropic":
      return new ProveedorAnthropic();
    default:
      throw new Error(`Proveedor LLM no soportado: "${proveedorLlm}". Disponible: anthropic.`);
  }
}
