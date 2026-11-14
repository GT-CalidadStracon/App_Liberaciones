"use strict";
/* BUGS CONOCIDOS (detectados por el arnés; NO se corrigieron aquí).
 * Cada prueba describe el comportamiento correcto y hoy FALLA. Se ejecutan con:  npm run test:conocidos
 * Cuando se corrija un bug, mueve su prueba a tests/config.test.js. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp } = require("./helpers/cargarApp");

let app, W;
test.before(async () => { app = await cargarApp(); W = app.window; });
test.after(() => app.cerrar());

const sanear = (x) => JSON.parse(JSON.stringify(W.sanitizeCfg(W.JSON.parse(JSON.stringify(x)))));
const frente = (o) => Object.assign({ id: "f1", nombre: "F UNO", corto: "UNO", tipos: ["RELLENO", "EVALUACION"], materiales: [] }, o);

test("CORREGIDO-1: sanitizeCfg debe descartar/renombrar frentes con el mismo id (el 2.º frente queda inalcanzable en pantalla)", async () => {
  // Cómo llega: configuración importada o del servidor con dos frentes de igual id. La interfaz solo evita nombres repetidos al crear.
  const r = sanear({ frentes: [frente(), frente({ nombre: "F DOS", corto: "DOS" })] });
  const ids = r.frentes.map((f) => f.id);
  assert.strictEqual(new Set(ids).size, ids.length, "ids de frente repetidos tras sanitizeCfg: " + ids.join(", "));
});

test("CORREGIDO-2: sanitizeCfg debe quitar tipos de liberación repetidos de un frente (salen botones duplicados)", () => {
  const r = sanear({ frentes: [frente({ tipos: ["RELLENO", "RELLENO", "EVALUACION"] })] });
  assert.deepStrictEqual(r.frentes[0].tipos, ["RELLENO", "EVALUACION"]);
});

test("CORREGIDO-3: arrStr/sanitizeCfg convierte null u objetos de las listas en el texto «null» / «[object Object]» (p. ej. un supervisor llamado NULL que sale en el texto de la liberación)", () => {
  const r = sanear({ supervisores: [null, "Ana", {}], materialesEval: [undefined, "ROCA"], frentes: [frente()] });
  const basura = (a) => a.filter((x) => /^(null|undefined|\[object Object\])$/i.test(x));
  assert.deepStrictEqual(basura(r.supervisores), [], "supervisores: " + JSON.stringify(r.supervisores));
  assert.deepStrictEqual(basura(r.materialesEval), [], "materialesEval: " + JSON.stringify(r.materialesEval));
});

test("CORREGIDO-4: validateCfg debe avisar de dos frentes con el mismo nombre (hoy solo lo evita el botón Aplicar de la pantalla de frente; una importación lo deja pasar)", () => {
  const c = sanear({ frentes: [frente({ id: "a" }), frente({ id: "b" })] });
  const errs = Array.from(W.validateCfg(W.JSON.parse(JSON.stringify(c))));
  assert.ok(errs.some((e) => /repetid|ya existe|mismo nombre/i.test(e)), "validateCfg no detecta frentes con nombre repetido. Mensajes: " + JSON.stringify(errs));
});
