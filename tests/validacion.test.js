"use strict";
/* Validación del formato de lo que se escribe: un valor mal escrito NO debe generar texto. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");

let app;
test.before(async () => { app = await cargarApp({ semilla: 5 }); });
test.after(() => app.cerrar());

async function listo(frente, tipo, semilla) {
  await app.elegirFrente(frente);
  if (app.json("state.tipo") !== tipo) await app.elegirTipo(tipo);
  app.run("prefs.supervisor = ''; resetForm(); render();");
  return (await llenarFormulario(app, { rng: crearRng(semilla || 3), revisiones: 0 })).texto;
}
const fk = (id) => app.document.querySelector(`[data-fk="${id}"]`);

test("números: 0, vacío, un punto suelto o con punto final no generan texto; los válidos sí", async () => {
  const base = await listo("pad2d", "EVALUACION");
  assert.ok(base);
  for (const malo of ["0", "0.0", ".", "5.", "00", ""]) {
    await app.escribir(fk("areaEval"), malo);
    assert.strictEqual(app.computeTexto(), null, `área «${malo}» no debería generar texto`);
  }
  for (const bueno of ["0.5", "25", "25.5", "1500.125"]) {
    await app.escribir(fk("areaEval"), bueno);
    const t = app.computeTexto();
    assert.ok(t, `área «${bueno}» debería ser válida`);
    assert.match(t, new RegExp("ÁREA: " + bueno.replace(".", "\.") + " m²"));
  }
  assert.deepStrictEqual(app.errores.map(String), []);
});

test("progresivas: formato km+metros, metros < 1000, extremos distintos; final menor que inicial se acepta con aviso", async () => {
  await listo("pad2d", "EVALUACION");
  const poner = async (d, h) => { await app.escribir(fk("progEval__d"), d); await app.escribir(fk("progEval__h"), h); };
  const invalidas = [["0+100", "0+100"], ["0+1234", "0+1500"], ["+5", "+9"], ["0+100.1234", "0+200"], ["0+100", "0+"], ["0+", "0+"], ["1234+100", "1235+100"]];
  for (const [d, h] of invalidas) {
    await poner(d, h);
    assert.strictEqual(app.computeTexto(), null, `progresiva «${d} - ${h}» no debería generar texto`);
  }
  await poner("0+100", "0+250.5");
  assert.match(app.computeTexto(), /PROGRESIVA: 0\+100 - 0\+250\.5/);
  await poner("0+500", "0+100");       // invertida: válida, pero con aviso
  assert.match(app.computeTexto(), /PROGRESIVA: 0\+500 - 0\+100/);
  assert.match(app.document.getElementById("app").textContent, /final es menor que la inicial/);
  await poner("1+000", "1+999.999");
  assert.ok(app.computeTexto());
});

test("capa: entero mayor que 0 (sin ceros a la izquierda); con «OTRO» admite texto libre", async () => {
  await listo("pad2f", "RELLENO", 8);
  const capa = () => fk("capa");
  for (const malo of ["0", "007", "1.5", ""]) {
    await app.escribir(capa(), malo);
    assert.strictEqual(app.computeTexto(), null, `capa «${malo}» no debería generar texto`);
  }
  for (const bueno of ["1", "9", "26", "120"]) {
    await app.escribir(capa(), bueno);
    assert.ok(app.computeTexto(), `capa «${bueno}» debería ser válida`);
  }
  // «OTRO»: capa de texto libre (p. ej. NIVELANTE 01)
  await app.clickTexto("OTRO", app.document.querySelector("#app .card"));
  await app.escribir(capa(), "nivelante 01");
  assert.ok(app.computeTexto(), "capa de texto libre debería ser válida");
  assert.match(app.computeTexto(), /CAPA: NIVELANTE 01/);
  assert.deepStrictEqual(app.errores.map(String), []);
});
