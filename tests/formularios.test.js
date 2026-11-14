"use strict";
/* Fuzz de formularios: para cada frente de la configuración de fábrica y cada tipo de liberación de ese frente,
 * simula el llenado (clics y escritura reales en el DOM, semilla fija) hasta que computeTexto() devuelve texto. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");
const { verificarTexto } = require("./helpers/textoEsperado");

const CORRIDAS = 20;          // por combinación frente × tipo (con la configuración de fábrica)
const CORRIDAS_LINEAS = 8;    // por combinación, con estados S/O/N de líneas al azar

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

async function prepararCombinacion(app, frenteId, tipo) {
  const actual = app.json("[state.estructura,state.tipo]");
  if (actual[0] !== frenteId) await app.elegirFrente(frenteId);
  if (app.json("state.tipo") !== tipo) await app.elegirTipo(tipo);
  assert.strictEqual(app.json("state.estructura"), frenteId);
  assert.strictEqual(app.json("state.tipo"), tipo);
}

/** Una corrida completa; devuelve {texto, traza}. */
async function corrida(app, frenteId, tipo, semilla) {
  await prepararCombinacion(app, frenteId, tipo);
  app.run("prefs.supervisor = ''; resetForm(); render();");
  const rng = crearRng(semilla);
  const r = await llenarFormulario(app, { rng });
  const ctx = `semilla=${semilla} frente=${frenteId} tipo=${tipo}\npasos: ${r.traza.join(" · ")}`;
  verificarTexto(app, r.texto, ctx);
  // determinista: pedirlo otra vez da exactamente lo mismo y es lo que se ve en pantalla
  assert.strictEqual(app.computeTexto(), r.texto, "computeTexto() no es determinista\n" + ctx);
  assert.strictEqual(app.textoPantalla(), r.texto, "Lo que se muestra en pantalla no coincide con computeTexto()\n" + ctx);
  return r;
}

let appBase;
test.before(async () => { appBase = await cargarApp({ semilla: 7 }); });
test.after(() => { appBase.cerrar(); });

test("contrato: la configuración inicial es la de fábrica y el arnés encuentra las globales", () => {
  assert.deepStrictEqual(appBase.problemasContrato(), [], "Cambió el contrato de nombres globales del script (ver GLOBALES_CONTRATO en tests/helpers/cargarApp.js)");
  assert.deepStrictEqual(appBase.json("cfg"), appBase.json("defaultConfig()"), "La app debería arrancar con defaultConfig() cuando no hay nada guardado");
  assert.deepStrictEqual(appBase.errores.map(String), []);
});


test("fuzz de formularios (configuración de fábrica): todos los frentes × tipos", async (t) => {
  const frentes = appBase.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
  assert.ok(frentes.length >= 1);
  let total = 0, tiposVistos = new Set();
  for (const fr of frentes) {
    for (const tipo of fr.tipos) {
      tiposVistos.add(tipo);
      await t.test(`${fr.id} / ${tipo} (${CORRIDAS} corridas)`, async () => {
        const textos = new Set();
        for (let n = 0; n < CORRIDAS; n++) {
          const semilla = hash(fr.id + "/" + tipo) + n;
          const r = await corrida(appBase, fr.id, tipo, semilla);
          textos.add(r.texto);
          total++;
          if (n < 2) { // reproducibilidad: misma semilla → misma traza y mismo texto
            const r2 = await corrida(appBase, fr.id, tipo, semilla);
            assert.strictEqual(r2.texto, r.texto, "Misma semilla pero distinto texto (no determinista)");
            assert.deepStrictEqual(r2.traza, r.traza);
          }
        }
        assert.ok(textos.size >= 2 || CORRIDAS < 3, "Las corridas aleatorias no produjeron variedad de textos (¿el fuzz dejó de variar?)");
        assert.deepStrictEqual(appBase.errores.map(String), [], "Errores de JS durante el llenado");
      });
    }
  }
  assert.ok(total >= frentes.length * CORRIDAS);
  assert.deepStrictEqual([...tiposVistos].sort(), ["COLECCION", "EVALUACION", "FUNDACION", "OVERLINER", "RELLENO", "SIST_SUBD", "SUBDRENES"].sort(),
    "La configuración de fábrica ya no cubre los 7 tipos de liberación (el fuzz debe cubrirlos todos)");
});

/* Variante: estados S/O/N de las líneas al azar por frente y tipo (ramas que la configuración de fábrica casi no usa). */
test("fuzz con estados de línea (Siempre/Opcional/Nunca) al azar", async (t) => {
  const app = await cargarApp({ semilla: 99 });
  try {
    const frentes = app.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
    for (const fr of frentes) {
      for (const tipo of fr.tipos) {
        await t.test(`${fr.id} / ${tipo}`, async () => {
          for (let n = 0; n < CORRIDAS_LINEAS; n++) {
            const semilla = hash("L:" + fr.id + "/" + tipo) + n;
            const rng = crearRng(semilla);
            // configuración con líneas al azar, pasada por sanitizeCfg como haría la app al guardar/importar
            const lineas = app.json("LINEAS[" + JSON.stringify(tipo) + "].map(function(d){return {k:d[0],estados:d[2]};})");
            const elegidas = {};
            lineas.forEach((l) => { if (rng.prob(0.8)) elegidas[l.k] = rng.elegir(l.estados); });
            app.run(`(function(){
              var c = clone(cfg), f = findBy(c.frentes,"id",${JSON.stringify(fr.id)});
              f.lineas = f.lineas || {}; f.lineas[${JSON.stringify(tipo)}] = ${JSON.stringify(elegidas)};
              cfg = sanitizeCfg(c);
            })()`);
            assert.deepStrictEqual(app.json(`getFrente(${JSON.stringify(fr.id)}).lineas[${JSON.stringify(tipo)}] || {}`), elegidas,
              "sanitizeCfg descartó estados de línea válidos");
            const r = await corrida(app, fr.id, tipo, semilla);
            assert.ok(r.texto);
          }
        });
      }
    }
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});
