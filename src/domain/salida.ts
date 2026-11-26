import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CABECERA_CSV = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n";

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion" | "error";

export interface FilaControl {
  solicitud_id: string;
  resultado: ResultadoControl;
  numero_oc: string | null;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
}

/** "out/ se limpia al inicio" (PRD 8): deja el directorio de salida vacío y con la cabecera del CSV. */
export function reiniciarSalida(directory: string): void {
  const out = join(directory, "out");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "control.csv"), CABECERA_CSV);
}

const csv = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** HU-5: cada intento (exitoso, bloqueado o pendiente) agrega una fila a out/control.csv. */
export function registrarControl(directory: string, fila: FilaControl): void {
  const out = join(directory, "out");
  mkdirSync(out, { recursive: true });
  const archivo = join(out, "control.csv");
  if (!existsSync(archivo)) writeFileSync(archivo, CABECERA_CSV);
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString(),
  ]
    .map(csv)
    .join(",");
  appendFileSync(archivo, linea + "\n");
}

export function leerControl(directory: string): Array<Record<string, string>> {
  const archivo = join(directory, "out", "control.csv");
  if (!existsSync(archivo)) return [];
  const [cabecera, ...filas] = readFileSync(archivo, "utf8").split("\n").filter(Boolean);
  const columnas = (cabecera ?? "").split(",");
  return filas.map((f) => {
    const celdas = f.split(",");
    return Object.fromEntries(columnas.map((c, i) => [c, celdas[i] ?? ""]));
  });
}

/** CA4: toda llamada a herramienta queda en out/log.jsonl. Nunca se registran claves ni cabeceras. */
export function registrarLog(directory: string, evento: Record<string, unknown>): void {
  const out = join(directory, "out");
  mkdirSync(out, { recursive: true });
  appendFileSync(join(out, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...evento }) + "\n");
}
