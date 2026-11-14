"use strict";
/* Lo que ve el equipo en «Últimas liberaciones» y en el reporte diario sale de interpretar el texto generado:
 * resumenLib() e interpretarLib() deben dar datos completos para TODA liberación que la app puede generar,
 * tanto con el formulario guardado (items nuevos) como solo con el texto (items antiguos). */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");
const { BASURA } = require("./helpers/textoEsperado");

const CORRIDAS = 5;
const CAT_ESPERADA = { RELLENO: /^(RELLENO|SBP|SOBRE)$/, SUBDRENES: /^(SSUB|FSUB)$/, SIST_SUBD: /^(SSUB|FSUB)$/, COLECCION: /^COL$/, FUNDACION: /^FUND$/, EVALUACION: /^EVAL$/, OVERLINER: /^SOBRE$/ };

let app;
test.before(async () => { app = await cargarApp({ semilla: 77 }); });
test.after(() => app.cerrar());

test("resumenLib e interpretarLib dan datos completos para toda liberación generada (con y sin formulario guardado)", async () => {
  const frentes = app.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
  const cats = {};
  for (const f of frentes) for (const tipo of f.tipos) for (let i = 0; i < CORRIDAS; i++) {
    await app.elegirFrente(f.id);
    if (app.json("state.tipo") !== tipo) await app.elegirTipo(tipo);
    app.run("prefs.supervisor = ''; resetForm(); render();");
    const { texto } = await llenarFormulario(app, { rng: crearRng(300 + i * 11 + f.id.length), revisiones: 1 });
    const form = app.run("JSON.stringify({v:1,estructura:state.estructura,tipo:state.tipo,form:state.form})");
    for (const conForm of [true, false]) {
      const it = { id: "L-0001", fecha: "2026-11-13", hora: "10:15", turno: "DÍA", texto };
      if (conForm) it.form = form;
      const donde = `${f.id}/${tipo} corrida ${i} ${conForm ? "con" : "sin"} formulario\n${texto}`;
      app.run("window.__it = " + JSON.stringify(it) + ";");
      let resumen, r;
      assert.doesNotThrow(() => { resumen = app.get("resumenLib(window.__it.texto)"); }, "resumenLib lanzó excepción: " + donde);
      assert.doesNotThrow(() => { r = app.json("interpretarLib(window.__it)"); }, "interpretarLib lanzó excepción: " + donde);
      assert.ok(resumen && resumen.length > 5, "resumen vacío: " + donde);
      assert.ok(!BASURA.test(resumen), `resumen con basura «${resumen}»: ` + donde);
      Object.keys(r).forEach((k) => {
        if (k === "texto") return;
        if (typeof r[k] === "string") assert.ok(!BASURA.test(r[k]), `interpretarLib.${k} con basura «${r[k]}»: ` + donde);
        if (typeof r[k] === "number") assert.ok(Number.isFinite(r[k]), `interpretarLib.${k} no es un número finito (${r[k]}): ` + donde);
      });
      assert.match(r.cat, CAT_ESPERADA[tipo], `categoría de reporte inesperada «${r.cat}»: ` + donde);
      assert.ok(r.frente && r.frente.id === f.id, "no reconoce el frente: " + donde);
      assert.match(r.desc, /^Liberación( parcial( \(.+\))?)? de \S/, `descripción mal formada «${r.desc}»: ` + donde);
      assert.strictEqual(r.turno, "Día");
      assert.ok(r.supervisor && r.supervisor.length > 3, "sin supervisor: " + donde);
      if (!/^(SSUB|FSUB)$/.test(r.cat) || /ÁREA|GRAVA|FUNDACIÓN/.test(texto)) {
        if (/ÁREA: /.test(texto) || /GRAVA Y GEOTEXTIL: /.test(texto)) assert.ok(typeof r.area === "number" && r.area > 0, `área no numérica en reporte (${r.area}): ` + donde);
      }
      if (r.cat === "SSUB") { assert.ok(r.longitud && r.diametro, "subdrenaje sin longitud/diámetro: " + donde); }
      if (/^RELLENO$|^SBP$/.test(r.cat) && /^CAPA: \d+/m.test(texto)) assert.match(r.capa, /^\d+$/, "capa: " + donde);
      cats[r.cat] = (cats[r.cat] || 0) + 1;
    }
  }
  ["RELLENO", "SBP", "SOBRE", "FUND", "EVAL", "COL", "SSUB", "FSUB"].forEach((c) => assert.ok(cats[c] > 0, "el fuzz no produjo ninguna liberación de la categoría de reporte " + c));
  assert.deepStrictEqual(app.errores.map(String), []);
});
