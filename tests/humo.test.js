"use strict";
/* Pruebas de humo: la app carga sin errores de JS y dibuja la pantalla principal y las demás pantallas. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearServidorMock } = require("./helpers/cargarApp");

test("contrato del arnés: existen las variables y funciones globales que las pruebas necesitan", async () => {
  const app = await cargarApp();
  try {
    assert.deepStrictEqual(app.problemasContrato(), [],
      "Cambió algún nombre global del <script> inline. Actualiza GLOBALES_CONTRATO en tests/helpers/cargarApp.js o devuelve el nombre.");
  } finally { app.cerrar(); }
});

for (const idb of ["ausente", "presente", "bloqueado"]) {
  test(`carga sin errores y dibuja la pantalla principal (indexedDB ${idb})`, async () => {
    const app = await cargarApp({ indexedDB: idb, vista: "inicio" });
    try {
      assert.deepStrictEqual(app.errores.map((e) => String(e && e.cause ? e.cause.stack || e.cause : e)), [], "errores de JS al cargar");
      assert.deepStrictEqual(app.consola.error, [], "console.error durante la carga");
      const d = app.document;
      assert.match(d.title, /Liberaciones/);
      assert.ok(d.querySelector("#app .hdr"), "falta el encabezado");
      assert.match(d.querySelector("#app .hdr").textContent, /Generador de Liberación/);
      assert.ok(app.botones("⚙ Configuración ▾").length === 1, "falta el botón «Configuración»");
      assert.strictEqual(app.json("state.view"), "inicio", "la app arranca en Inicio");
      assert.ok(app.botones("＋ Registrar liberación").length === 1 && app.botones("Ver liberaciones anteriores").length === 1, "Inicio ofrece Registrar y Ver anteriores");
      assert.match(d.getElementById("app").textContent, /no está conectado al sistema del equipo/, "sin conexión configurada se avisa en Inicio");
      await app.clickTexto("＋ Registrar liberación");
      assert.strictEqual(app.json("state.view"), "main");
      const frentes = app.json("cfg.frentes");
      assert.strictEqual(frentes.length, 7, "la configuración de fábrica trae 7 frentes");
      // "1. Frente" con un botón por frente, y todavía sin tipo de liberación
      const cuerpo = d.querySelector("#app .card").textContent;
      assert.match(cuerpo, /1\. Frente/);
      assert.doesNotMatch(cuerpo, /2\. Tipo de Liberación/);
      frentes.forEach((f) => assert.ok(app.botones(f.corto || f.nombre, d.querySelector("#app .card")).length >= 1, "falta el botón del frente " + f.id));
      assert.ok(d.getElementById("inCam") && d.getElementById("inGal"), "faltan las entradas de foto");
      assert.strictEqual(d.getElementById("outbox"), null, "no debe haber texto generado al inicio");
    } finally { app.cerrar(); }
  });
}

test("cada frente muestra sus tipos de liberación y cada tipo dibuja su formulario sin errores", async () => {
  const app = await cargarApp();
  try {
    const frentes = app.json("cfg.frentes.map(function(f){return {id:f.id,corto:f.corto,tipos:f.tipos};})");
    for (const f of frentes) {
      await app.elegirFrente(f.id);
      assert.match(app.document.querySelector("#app .card").textContent, /2\. Tipo de Liberación/, "frente " + f.id);
      for (const t of f.tipos) {
        const corto = app.get(`cfg.tipos.${t}.corto`);
        assert.ok(app.botones(corto, app.document.querySelector("#app .card")).length >= 1, `frente ${f.id}: falta el botón del tipo ${t}`);
        await app.elegirTipo(t);
        assert.strictEqual(app.json("state.tipo"), t);
        assert.ok(app.document.querySelector("#app .card").querySelectorAll(".fld").length >= 3, `${f.id}/${t}: el formulario no dibujó campos`);
        assert.strictEqual(app.computeTexto(), null, "un formulario vacío no debe generar texto");
        assert.ok(app.document.getElementById("hintbox"), "debe indicar que falta completar");
      }
    }
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("pantallas de ajustes (config, frente, líneas, material) y del día se dibujan sin errores", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    await app.clickTexto("⚙ Configuración ▾");
    await app.clickTexto("Ajustes del generador");
    assert.strictEqual(app.json("state.view"), "config");
    assert.ok(app.document.getElementById("app").textContent.length > 200);
    const n = app.json("ed.cfg.frentes.length");
    for (let i = 0; i < n; i++) {
      app.run(`editarFrente(${i})`);
      assert.strictEqual(app.json("state.view"), "frente");
      const tipos = app.json("ed.fr.tipos");
      for (const k of tipos) {
        app.run(`ed.lt = ${JSON.stringify(k)}; ed.copiaSel = []; state.view = "lineas"; render();`);
        assert.strictEqual(app.json("state.view"), "lineas");
        app.run('state.view = "frente"; render();');
      }
      app.run("cancelarFrente()");
      assert.strictEqual(app.json("state.view"), "config");
    }
    app.run("editarFrente(-1)"); assert.strictEqual(app.json("state.view"), "frente"); app.run("cancelarFrente()");
    const m = app.json("ed.cfg.materiales.length");
    for (let i = 0; i < m; i++) { app.run(`editarMaterial(${i})`); assert.strictEqual(app.json("state.view"), "material"); app.run("cancelarMaterial()"); }
    app.run("editarMaterial(-1)"); app.run("cancelarMaterial()");
    app.run("salirConfig()");
    assert.strictEqual(app.json("state.view"), "inicio");
    app.run("abrirDia()");
    await app.vaciar();
    assert.strictEqual(app.json("state.view"), "hoy");
    assert.ok(servidor.contarAcciones("listRango") >= 1, "abrir Liberaciones anteriores debe pedir las del rango");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("sin red: la app arranca igual, no lanza errores y no reintenta en bucle", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    servidor.modo = "caida";
    await app.avanzar(10 * 60000);
    assert.deepStrictEqual(app.errores.map(String), []);
    assert.ok(servidor.peticiones.length < 40, "demasiadas peticiones sin red en 10 min: " + servidor.peticiones.length);
  } finally { app.cerrar(); }
});
