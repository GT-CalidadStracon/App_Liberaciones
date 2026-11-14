"use strict";
/* «Copiar datos» (imán) de una liberación anterior: el formulario resultante debe regenerar exactamente el mismo texto.
 *  - con el formulario guardado (items nuevos) → ida y vuelta exacta;
 *  - solo con el texto (items antiguos) → se reconstruye leyendo el texto; lo que el texto no trae se vuelve a pedir. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");

const CORRIDAS = 6;
let app;
test.before(async () => { app = await cargarApp({ semilla: 21 }); });
test.after(() => app.cerrar());

async function hacer(frente, tipo, semilla) {
  await app.elegirFrente(frente);
  if (app.json("state.tipo") !== tipo) await app.elegirTipo(tipo);
  app.run("prefs.supervisor = ''; resetForm(); render();");
  const r = await llenarFormulario(app, { rng: crearRng(semilla), revisiones: 1 });
  const form = app.run("JSON.stringify({v:1,estructura:state.estructura,tipo:state.tipo,form:state.form})");
  return { texto: r.texto, form };
}
const copiar = (it) => app.run("duplicar(" + JSON.stringify(it) + ")");

test("copiar con el formulario guardado regenera exactamente el mismo texto (todos los frentes y tipos)", async () => {
  const frentes = app.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
  let n = 0;
  for (const f of frentes) for (const t of f.tipos) for (let i = 0; i < CORRIDAS; i++) {
    const { texto, form } = await hacer(f.id, t, 100 + i * 13 + f.id.length);
    app.run("resetForm(); render();");
    copiar({ id: "L-0001", texto, form });
    assert.strictEqual(app.computeTexto(), texto, `${f.id}/${t} corrida ${i}: el texto copiado no coincide`);
    assert.strictEqual(app.json("state.estructura"), f.id);
    assert.strictEqual(app.json("state.tipo"), t);
    n++;
  }
  assert.ok(n >= 24 * CORRIDAS);
  assert.deepStrictEqual(app.errores.map(String), []);
  assert.deepStrictEqual(app.alertas, []);
});

test("copiar solo con el texto (items antiguos) reconstruye el formulario; lo que el texto no trae se vuelve a pedir", async () => {
  const frentes = app.json("cfg.frentes.map(function(f){return {id:f.id,tipos:f.tipos};})");
  let completadosAMano = 0;
  for (const f of frentes) for (const t of f.tipos) for (let i = 0; i < CORRIDAS; i++) {
    const { texto } = await hacer(f.id, t, 500 + i * 7 + f.id.length);
    app.run("resetForm(); render();");
    copiar({ id: "L-0002", texto });
    let nuevo = app.computeTexto();
    if (nuevo === null) {
      // el texto no guarda algún dato obligatorio (p. ej. el diámetro en «solo fundación»): se completa a mano y debe quedar igual
      const r = await llenarFormulario(app, { rng: crearRng(i + 1), revisiones: 0 });
      nuevo = r.texto; completadosAMano++;
    }
    assert.strictEqual(nuevo, texto, `${f.id}/${t} corrida ${i}: reconstruido desde el texto no coincide`);
  }
  assert.ok(completadosAMano <= 12, "demasiados casos donde el texto no alcanza para reconstruir (" + completadosAMano + ")");
  assert.deepStrictEqual(app.errores.map(String), []);
});

test("copiar una liberación de un frente/tipo que ya no existe avisa y no rompe nada", async () => {
  const antes = app.json("[state.estructura,state.tipo]");
  copiar({ id: "L-9", texto: "TIPO DE LIBERACIÓN: ALGO RARO\nESTRUCTURA: FRENTE QUE NO EXISTE\nÁREA: 5 m²" });
  assert.strictEqual(app.alertas.length, 1);
  assert.match(app.alertas[0], /ya no está en los ajustes/);
  assert.deepStrictEqual(app.json("[state.estructura,state.tipo]"), antes);
  copiar({ id: "L-10", texto: "", form: "{no es json" });
  assert.deepStrictEqual(app.errores.map(String), []);
});
