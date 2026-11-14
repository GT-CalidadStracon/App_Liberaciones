"use strict";
/* Fuzz de configuración: materiales con modos de capa/espesor/cota al azar, estructuras, procedencias y líneas S/O/N.
 * Toda configuración que validateCfg() acepte debe poder llenarse hasta generar un texto correcto. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");
const { verificarTexto } = require("./helpers/textoEsperado");

const CONFIGS = 20;
const LLENADOS = 2;

function materialAleatorio(rng, matId, ests) {
  const capasModo = rng.elegir(["ILIM", "RANGO", "UNICA"]);
  const min = rng.int(1, 5);
  const espModo = rng.elegir(["FIJO", "MANUAL", "PATRON"]);
  const cotaModo = rng.elegir(["CALC", "MANUAL", "VARIABLE"]);
  const procsPool = ["PROPIO", "CA-01", "TAJO 5E", "CANTERA 6"];
  const procs = procsPool.filter(() => rng.prob(0.5));
  const x = {
    mat: matId, procs, parcial: rng.prob(0.3),
    capas: { modo: capasModo, min: String(min), max: String(min + rng.int(0, 4)) },
    esp: { modo: espModo, valor: espModo === "FIJO" ? rng.elegir(["0.5 m", "1 m", "0.3 m"]) : (espModo === "MANUAL" && rng.prob(0.5) ? "0.3 m" : ""),
           formula: espModo === "PATRON" ? rng.elegir(["(c-6)%3==2 ? 4 : 3", "c*0.1", "c>5 ? 1 : 0.5"]) : "" },
    cota: { modo: cotaModo, base: String(rng.int(2500, 2900)), capaBase: String(rng.int(1, 20)), paso: (espModo === "MANUAL" || rng.prob(0.5)) ? String(rng.elegir([0.5, 1])) : "",
            tabla: rng.prob(0.3) ? ["3 = 2700", "NIVELANTE 01: 2705.5"] : [] },
    ests: [],
  };
  if (rng.prob(0.5)) {
    ests.filter(() => rng.prob(0.6)).forEach((e) => {
      x.ests.push({ est: e.id, capas: { modo: rng.elegir(["ILIM", "RANGO", "UNICA"]), min: "1", max: String(rng.int(1, 4)) },
                    espModo: rng.elegir(["FIJO", "MANUAL"]), espesor: rng.elegir(["0.2 m", "0.3 m"]), prog: rng.prob(0.4) });
    });
  }
  return x;
}

test(`${CONFIGS} configuraciones aleatorias válidas: todo se puede llenar y el texto sale bien`, async (t) => {
  const app = await cargarApp({ semilla: 31 });
  let validas = 0, rechazadas = 0, llenados = 0;
  try {
    const base = app.json("sanitizeCfg(defaultConfig())");
    for (let n = 0; n < CONFIGS; n++) {
      const semilla = 9000 + n;
      const rng = crearRng(semilla);
      const c = JSON.parse(JSON.stringify(base));
      c.frentes.forEach((f) => {
        f.materiales = c.materiales.filter(() => rng.prob(0.6)).map((m) => materialAleatorio(rng, m.id, c.estructuras));
        if (!f.materiales.length) f.materiales = [materialAleatorio(rng, c.materiales[0].id, c.estructuras)];
        f.lineas = {};
        f.tipos.forEach((tp) => {
          const defs = app.json("LINEAS." + tp + ".map(function(d){return {k:d[0],e:d[2]};})");
          f.lineas[tp] = {};
          defs.forEach((d) => { if (rng.prob(0.5)) f.lineas[tp][d.k] = rng.elegir(d.e); });
        });
      });
      app.run(`window.__c = sanitizeCfg(${JSON.stringify(c)});`);
      const errs = app.json("validateCfg(window.__c)");
      if (errs.length) { rechazadas++; continue; }   // la propia app la rechazaría al guardar
      validas++;
      app.run("cfg = window.__c; state.estructura = ''; state.tipo = ''; resetForm(); render();");
      const frentes = app.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
      for (const f of frentes) {
        for (const tp of f.tipos) {
          for (let i = 0; i < LLENADOS; i++) {
            await app.elegirFrente(f.id);
            if (app.json("state.tipo") !== tp) await app.elegirTipo(tp);
            app.run("prefs.supervisor = ''; resetForm(); render();");
            const s = semilla * 100 + i;
            const r = await llenarFormulario(app, { rng: crearRng(s), revisiones: 1 });
            verificarTexto(app, r.texto, `config aleatoria #${n} (semilla ${semilla}) frente=${f.id} tipo=${tp} semilla de llenado=${s}\npasos: ${r.traza.join(" · ")}`);
            llenados++;
          }
        }
      }
      assert.deepStrictEqual(app.errores.map(String), [], `errores de JS con la config aleatoria #${n}`);
    }
    assert.ok(validas >= CONFIGS / 2, `muy pocas configuraciones válidas (${validas}/${CONFIGS}); el generador dejó de ser útil`);
    t.diagnostic(`válidas ${validas}, rechazadas por validateCfg ${rechazadas}, llenados ${llenados}`);
  } finally { app.cerrar(); }
});
