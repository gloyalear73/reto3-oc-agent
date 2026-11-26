import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Paquete } from "../types.ts";

export interface Evidencia {
  ruta: string;
  sha256: string;
  ruta_pdf?: string;
}

export const sha256 = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex");

export function contenidoEvidencia(a: NonNullable<Paquete["aprobacion"]>): string {
  return [
    "EVIDENCIA DE APROBACIÓN",
    `De: ${a.de}`,
    `Para: ${a.para}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.texto,
  ].join("\n");
}

/** Divide el texto en líneas que caben en el ancho de página. */
function ajustar(texto: string, ancho: (t: string) => number, max: number): string[] {
  const salida: string[] = [];
  for (const linea of texto.split("\n")) {
    let actual = "";
    for (const palabra of linea.split(" ")) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (ancho(prueba) > max && actual) {
        salida.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    salida.push(actual);
  }
  return salida;
}

/** P1: mismo contenido en PDF. Si pdf-lib falla, el .txt (P0) sigue siendo válido. */
async function escribirPdf(ruta: string, texto: string): Promise<boolean> {
  try {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const fuente = await doc.embedFont(StandardFonts.Courier);
    const tam = 9;
    const margen = 50;
    const alto = 14;
    let pagina = doc.addPage([595, 842]);
    let y = 842 - margen;
    const seguro = texto.replace(/[^ -ÿ\n]/g, "?");
    for (const linea of ajustar(seguro, (t) => fuente.widthOfTextAtSize(t, tam), 595 - margen * 2)) {
      if (y < margen) {
        pagina = doc.addPage([595, 842]);
        y = 842 - margen;
      }
      pagina.drawText(linea, { x: margen, y, size: tam, font: fuente });
      y -= alto;
    }
    writeFileSync(ruta, await doc.save());
    return true;
  } catch {
    return false;
  }
}

/** HU-4: `out/<caso>/aprobacion.txt` (+ pdf). El sha256 cubre todo lo que precede a su propia línea. */
export async function generarEvidencia(
  directory: string,
  caso: string,
  aprobacion: NonNullable<Paquete["aprobacion"]>,
): Promise<Evidencia> {
  const dir = join(directory, "out", caso);
  mkdirSync(dir, { recursive: true });
  const contenido = contenidoEvidencia(aprobacion);
  const hash = sha256(contenido);
  const completo = `${contenido}\n\n-----\nsha256 (del contenido anterior a esta línea): ${hash}\n`;
  writeFileSync(join(dir, "aprobacion.txt"), completo, "utf8");
  const evidencia: Evidencia = { ruta: `out/${caso}/aprobacion.txt`, sha256: hash };
  if (await escribirPdf(join(dir, "aprobacion.pdf"), completo)) evidencia.ruta_pdf = `out/${caso}/aprobacion.pdf`;
  return evidencia;
}
