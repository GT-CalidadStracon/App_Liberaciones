"use strict";
/* BUGS CONOCIDOS del reporte (NO corregidos aquí). Se ejecutan con:  npm run test:conocidos */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp } = require("./helpers/cargarApp");

test("CORREGIDO-5: el ÁREA de una «instalación de subdrenes» (opcional en el texto) se pierde en el reporte Excel: la columna «GRAVA Y GEOTEXTIL (m2)» sale con «-»", async () => {
  const app = await cargarApp();
  try {
    const texto = [
      "TIPO DE LIBERACIÓN: INSTALACIÓN DE SUBDRENES", "ESTRUCTURA: PAD DE LIXIVIACIÓN 2 FASE 2D SECTOR NORTE",
      "LONG. TUB (Ø100mm): 430.72 m", "ÁREA: 24 m²", "LÍNEA: TB-PD-P-100-02", "COTA: VARIABLE", "PROGRESIVA: 2+72.90 - 2+503.62",
      "ENSAYO: NO", "PROTOCOLO: NO", "SUPERVISOR CQC: GUSTAVO SÁNCHEZ"].join("\n");
    const r = app.json(`interpretarLib(${JSON.stringify({ id: "x", texto, hora: "10:00", turno: "DÍA", fecha: "2026-11-14" })})`);
    assert.strictEqual(r.cat, "SSUB");
    assert.strictEqual(r.grava, 24, "el área 24 m² del texto debería viajar a la columna de grava/área del reporte (hoy grava=" + r.grava + ")");
  } finally { app.cerrar(); }
});
