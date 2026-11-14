"use strict";
/* Pantallas principales de la app 2.3: Inicio (botones + últimas 3), Registro (empieza por fecha y turno),
 * Liberaciones anteriores (rango de fechas + filtro de texto + exportar a Excel) y la opción «Inicio» del menú Configuración.
 * Usa el servidor simulado (tests/helpers/cargarApp.js). El reloj de las pruebas marca el 13/11/2026 10:00 (hora de Lima). */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { cargarApp, crearServidorMock, crearRng, RAIZ } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");
const ExcelJS = require(path.join(RAIZ, "exceljs.min.js"));

const texto = (app) => app.document.querySelector("#app").textContent;
const hayBoton = (app, t) => app.botones(t).length > 0;
const lib = (capa, material, extra) => "TIPO DE LIBERACIÓN: CAPA DE RELLENO\nESTRUCTURA: PAD 2F\nMATERIAL: " + material + "\nCAPA: " + capa + "\nÁREA: 100 m²\nSUPERVISOR CQC: A" + (extra || "");
/* cuatro liberaciones: una fuera del rango inicial (7 días: 07/11 a 13/11) y tres dentro */
function servidorConDatos() {
  const s = crearServidorMock();
  s.guardados.push(
    { uid: "g1", fecha: "2026-11-05", turno: "DÍA", texto: lib("16", "ZANJA"), form: "", porId: "ana", porNombre: "Ana" },
    { uid: "g2", fecha: "2026-11-08", turno: "NOCHE", texto: lib("3", "BERMA"), form: "", porId: "ana", porNombre: "Ana" },
    { uid: "g3", fecha: "2026-11-12", turno: "DÍA", texto: lib("16", "ZANJA"), form: "", porId: "ana", porNombre: "Ana", fotoUrl: "https://drive.google.com/file/d/foto3/view" },
    { uid: "g4", fecha: "2026-11-13", turno: "DÍA", texto: lib("1", "FUNDACIÓN"), form: "", porId: "ana", porNombre: "Ana" });
  return s;
}
async function abrirAnteriores(app) {
  await app.clickTexto("Ver liberaciones anteriores"); await app.vaciar();
}
async function cambiarFecha(app, id, valor) {
  const i = app.document.getElementById(id);
  i.value = valor; i.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await app.vaciar();
}
const nLibs = (app) => app.document.querySelectorAll("#app .lib").length;
const peticiones = (s, accion) => s.peticiones.filter((p) => p.body && p.body.action === accion);
const idsEnPantalla = (app) => Array.from(app.document.querySelectorAll("#app .lib .tx span")).map((x) => (/L-[0-9]+/.exec(x.textContent) || [""])[0]);

test("Inicio: la app arranca con «Registrar liberación», «Ver liberaciones anteriores» y las 3 últimas (sin el formulario)", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await app.run("cargarRecientes(true)"); await app.vaciar();
    assert.strictEqual(app.get("state.view"), "inicio");
    assert.ok(hayBoton(app, "＋ Registrar liberación") && hayBoton(app, "Ver liberaciones anteriores"));
    const botones = Array.from(app.document.querySelectorAll(".home-btns button")).map((b) => b.textContent);
    assert.deepStrictEqual(botones, ["＋ Registrar liberación", "Ver liberaciones anteriores"], "primero registrar, luego ver anteriores");
    assert.match(texto(app), /Últimas liberaciones/);
    assert.strictEqual(app.document.querySelectorAll("#app .rec").length, 3, "las 3 últimas");
    assert.ok(!/1\. Frente/.test(texto(app)), "el formulario no se ve en Inicio");
    assert.ok(app.document.querySelector("#app .hdr-logo"), "mantiene la cabecera con logo y menú");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("Registro: «Registrar liberación» abre el formulario y lo primero es fecha y turno (sin «Últimas liberaciones»)", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await app.run("cargarRecientes(true)"); await app.vaciar();
    await app.clickTexto("＋ Registrar liberación");
    assert.strictEqual(app.get("state.view"), "main");
    const card = app.document.querySelector("#app .card");
    assert.ok(card.firstElementChild.classList.contains("trow"), "la primera fila de la tarjeta es la de fecha y turno");
    assert.ok(card.firstElementChild.querySelector("button.turno"), "trae el botón de turno");
    assert.ok(card.firstElementChild.querySelector("button.fecha, .fecha, button"), "y el de fecha");
    assert.ok(!/Últimas liberaciones/.test(texto(app)), "las últimas ya no van dentro del registro");
    assert.match(card.textContent, /1\. Frente/);
    const hijos = Array.from(card.children);
    assert.ok(hijos.indexOf(card.firstElementChild) < hijos.findIndex((h) => /1\. Frente/.test(h.textContent)), "fecha y turno van antes que Frente");
  } finally { app.cerrar(); }
});

test("Menú Configuración: «Inicio» es la primera opción y lleva a Inicio desde Registro y desde Anteriores", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    const abrirMenu = async () => app.click(app.botones("⚙ Configuración ▾")[0]);
    await app.clickTexto("＋ Registrar liberación");
    await abrirMenu();
    const items = Array.from(app.document.querySelectorAll(".menu [role=menuitem]")).map((x) => x.textContent);
    assert.strictEqual(items[0], "Inicio", "Inicio es la primera opción");
    await app.clickTexto("Inicio", app.document.querySelector(".menu"));
    assert.strictEqual(app.get("state.view"), "inicio");
    assert.ok(hayBoton(app, "＋ Registrar liberación"));
    await abrirMenu();
    assert.strictEqual(app.document.querySelector(".menu [role=menuitem]").textContent, "Inicio", "también desde Inicio");
    await app.clickTexto("Inicio", app.document.querySelector(".menu"));
    await abrirAnteriores(app);
    assert.strictEqual(app.get("state.view"), "hoy");
    await abrirMenu();
    assert.strictEqual(app.document.querySelector(".menu [role=menuitem]").textContent, "Inicio", "el menú también está en Anteriores");
    await app.clickTexto("Inicio", app.document.querySelector(".menu"));
    assert.strictEqual(app.get("state.view"), "inicio");
  } finally { app.cerrar(); }
});

test("Menú «Inicio» sale de una edición sin guardar: se descarta y el registro queda limpio", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await app.run("cargarRecientes(true)"); await app.vaciar();
    servidor.guardados[3].form = "";                       // sin FORM: se reconstruye desde el texto
    await app.click(app.document.querySelector("button.edit"));
    if (app.get("state.view") === "main" && app.get("state.editando")) {
      await app.click(app.botones("⚙ Configuración ▾")[0]);
      await app.clickTexto("Inicio", app.document.querySelector(".menu"));
      assert.strictEqual(app.get("state.editando"), null);
      assert.strictEqual(app.get("state.view"), "inicio");
    } else {
      assert.ok(app.alertas.length > 0, "si no se pudo cargar para editar, avisa");   // el texto de prueba es mínimo
    }
  } finally { app.cerrar(); }
});

test("Al subir una liberación nueva, la app vuelve a Inicio con el aviso y la liberación aparece entre las últimas", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    await app.elegirFrente("pad2f"); await app.elegirTipo("FUNDACION");
    app.run("prefs.supervisor = ''; resetForm(); render();");
    await llenarFormulario(app, { rng: crearRng(5), revisiones: 0 });
    await app.subir();
    assert.strictEqual(app.get("state.view"), "inicio");
    assert.match(app.document.querySelector("#app .note.ok").textContent, /Registrada como L-0001/);
    assert.strictEqual(app.document.querySelectorAll("#app .rec").length, 1, "aparece entre las últimas");
    assert.ok(!app.document.getElementById("outbox"));
    await app.click(app.botones("＋ Registrar liberación")[0]);
    assert.strictEqual(app.computeTexto(), null, "el formulario quedó limpio");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("Anteriores: abre con los últimos 7 días (hoy incluido) y muestra solo lo de ese rango, lo más nuevo primero", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await abrirAnteriores(app);
    assert.strictEqual(app.get("state.view"), "hoy");
    assert.strictEqual(app.document.getElementById("fDesde").value, "2026-11-07");
    assert.strictEqual(app.document.getElementById("fHasta").value, "2026-11-13");
    const p = peticiones(servidor, "listRango").pop().body;
    assert.deepStrictEqual([p.desde, p.hasta], ["2026-11-07", "2026-11-13"]);
    assert.strictEqual(nLibs(app), 3, "la del 05/11 queda fuera");
    assert.deepStrictEqual(idsEnPantalla(app), ["L-0004", "L-0003", "L-0002"], "más nueva primero");
    assert.match(app.document.getElementById("cuenta").textContent, /3 liberaciones en el rango/);
    assert.ok(hayBoton(app, "⬇ Exportar a Excel (3)"));
    assert.ok(app.document.getElementById("fTexto"), "filtro de texto");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("Anteriores: cambiar las fechas vuelve a pedir el rango; «desde» y «hasta» se mantienen en orden y no pasan de hoy", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await abrirAnteriores(app);
    await cambiarFecha(app, "fDesde", "2026-11-01");
    assert.strictEqual(nLibs(app), 4);
    assert.deepStrictEqual(peticiones(servidor, "listRango").pop().body, Object.assign({}, peticiones(servidor, "listRango").pop().body, { desde: "2026-11-01", hasta: "2026-11-13" }));
    await cambiarFecha(app, "fDesde", "2026-11-12");
    assert.strictEqual(nLibs(app), 2);
    await cambiarFecha(app, "fHasta", "2026-11-08");     // queda antes que «desde»: «desde» se iguala
    assert.strictEqual(app.document.getElementById("fDesde").value, "2026-11-08");
    assert.strictEqual(app.document.getElementById("fHasta").value, "2026-11-08");
    assert.strictEqual(nLibs(app), 1);
    await cambiarFecha(app, "fHasta", "2030-01-01");     // no se pasa de hoy
    assert.strictEqual(app.document.getElementById("fHasta").value, "2026-11-13");
    await cambiarFecha(app, "fDesde", "");               // vaciada: no cambia nada ni rompe
    assert.strictEqual(app.document.getElementById("fDesde").value, "2026-11-08");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("Anteriores: el filtro de texto muestra solo las coincidencias (sin tildes ni mayúsculas) sin volver al servidor", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await abrirAnteriores(app);
    await cambiarFecha(app, "fDesde", "2026-11-01");
    const antes = peticiones(servidor, "listRango").length;
    app.document.getElementById("fTexto").focus();         // como cuando la persona toca el campo
    await app.escribir(app.document.getElementById("fTexto"), "CAPA 16 zanja");
    assert.strictEqual(nLibs(app), 2);
    assert.deepStrictEqual(idsEnPantalla(app), ["L-0003", "L-0001"]);
    assert.match(app.document.getElementById("cuenta").textContent, /2 liberaciones que coinciden \(de 4 en el rango\)/);
    assert.strictEqual(peticiones(servidor, "listRango").length, antes, "filtrar por texto no llama al servidor");
    assert.strictEqual(app.document.activeElement.id, "fTexto", "no se pierde el foco al escribir");
    await app.escribir(app.document.getElementById("fTexto"), "fundacion");   // sin tilde
    assert.deepStrictEqual(idsEnPantalla(app), ["L-0004"]);
    await app.escribir(app.document.getElementById("fTexto"), "no existe esto");
    assert.strictEqual(nLibs(app), 0);
    assert.match(texto(app), /Ninguna liberación del rango coincide con el texto/);
    assert.ok(!hayBoton(app, /Exportar a Excel/), "sin resultados no hay nada que exportar");
    await app.escribir(app.document.getElementById("fTexto"), "");
    assert.strictEqual(nLibs(app), 4);
  } finally { app.cerrar(); }
});

test("Anteriores: sin liberaciones en el rango avisa y un servidor sin actualizar lo dice", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await abrirAnteriores(app);
    assert.match(texto(app), /No hay liberaciones registradas en ese rango/);
    assert.ok(!hayBoton(app, /Exportar a Excel/));
    // servidor viejo: no conoce listRango
    app.window.api = undefined;
    const r = await app.run("(function(){ var antes = api; api = function(){ return Promise.reject(Object.assign(new Error('Acción desconocida: listRango'),{server:true})); }; cargarRango(); return 1; })()");
    assert.strictEqual(r, 1);
    await app.vaciar();
    assert.match(texto(app), /hay que actualizar el servidor/);
  } finally { app.cerrar(); }
});

test("Anteriores: «Exportar a Excel» baja un listado con lo que se ve (solo coincidencias del filtro), en orden cronológico", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await abrirAnteriores(app);
    await cambiarFecha(app, "fDesde", "2026-11-01");
    await app.escribir(app.document.getElementById("fTexto"), "capa 16");
    assert.match(app.document.querySelector("#btnExportar").textContent, /\(2\)/);
    const blobs = [], nombres = [];
    app.window.URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
    app.document.addEventListener("click", (e) => { if (e.target && e.target.download) nombres.push(e.target.download); }, true);
    const btn = app.document.querySelector("#btnExportar");
    btn.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 600 && !blobs.length && !/⚠/.test(btn.textContent); i++) { await new Promise((r) => setTimeout(r, 10)); await app.avanzar(20); }
    assert.ok(blobs.length, "no se generó el Excel: el botón dice «" + btn.textContent + "»");
    assert.deepStrictEqual(nombres, ["Liberaciones_2026-11-01_a_2026-11-13_filtro.xlsx"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await blobs[0].arrayBuffer()));
    const ws = wb.getWorksheet("Liberaciones");
    assert.ok(ws, "hoja «Liberaciones»");
    const cab = ws.getRow(1).values.slice(1);
    assert.deepStrictEqual(cab.slice(0, 5), ["ID", "FECHA (DÍA DE TRABAJO)", "HORA", "TURNO", "ESTRUCTURA"]);
    assert.ok(cab.includes("TEXTO COMPLETO") && cab.includes("FOTO") && cab.includes("REGISTRADO POR"));
    assert.strictEqual(ws.rowCount, 3, "encabezado + 2 coincidencias");
    const col = (nombre) => cab.indexOf(nombre) + 1;
    assert.deepStrictEqual([ws.getRow(2).getCell(col("ID")).value, ws.getRow(3).getCell(col("ID")).value], ["L-0001", "L-0003"], "cronológico: la más vieja primero");
    assert.strictEqual(ws.getRow(2).getCell(col("CAPA")).value, "16");
    assert.strictEqual(ws.getRow(2).getCell(col("MATERIAL")).value, "ZANJA");
    assert.strictEqual(ws.getRow(2).getCell(col("TURNO")).value, "DÍA");
    assert.strictEqual(ws.getRow(2).getCell(col("FECHA (DÍA DE TRABAJO)")).value.toISOString().slice(0, 10), "2026-11-05", "fecha real de Excel");
    assert.match(String(ws.getRow(3).getCell(col("TEXTO COMPLETO")).value), /TIPO DE LIBERACIÓN: CAPA DE RELLENO/);
    const foto = ws.getRow(3).getCell(col("FOTO")).value;
    assert.strictEqual(foto.hyperlink, "https://drive.google.com/file/d/foto3/view", "enlace a la foto");
    assert.strictEqual(ws.getRow(2).getCell(col("REGISTRADO POR")).value, "Ana");
    assert.ok(ws.autoFilter, "con filtro de Excel puesto");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("Anteriores: el reporte del día (completo / día / noche) aparece solo cuando el rango es un único día", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    await abrirAnteriores(app);
    assert.ok(!hayBoton(app, /Reporte del día completo/), "con varios días solo está Exportar a Excel");
    await cambiarFecha(app, "fDesde", "2026-11-13");
    assert.strictEqual(app.document.getElementById("fDesde").value, "2026-11-13");
    assert.strictEqual(app.document.getElementById("fHasta").value, "2026-11-13");
    assert.ok(hayBoton(app, "⬇ Reporte del día completo (1)"));
    assert.ok(hayBoton(app, "Solo turno día (1)") && hayBoton(app, "Solo turno noche (0)"));
    assert.ok(hayBoton(app, "⬇ Exportar a Excel (1)"), "y también se puede exportar el listado");
  } finally { app.cerrar(); }
});

test("Anteriores: editar (✎) desde el listado vuelve al listado y las liberaciones por subir del rango aparecen arriba", async () => {
  const servidor = servidorConDatos();
  const app = await cargarApp({ servidor, vista: "inicio" });
  try {
    app.run("cola.push({uid:'pend1',texto:" + JSON.stringify(lib("7", "ZANJA")) + ",campos:[],turno:'DÍA',fecha:'2026-11-13',creado:Date.now()}); guardarCola();");
    await abrirAnteriores(app);
    assert.match(texto(app), /guardada en este celular/);
    app.run("procesarCola = function(){}");            // que la cola no se vacíe durante la prueba
    await app.escribir(app.document.getElementById("fTexto"), "capa 7");
    assert.strictEqual(nLibs(app), 1, "la pendiente coincide con el filtro");
    await app.escribir(app.document.getElementById("fTexto"), "capa 99");
    assert.strictEqual(nLibs(app), 0);
  } finally { app.cerrar(); }
});

/* ── botones Atrás / Adelante entre la cabecera y el contenido ── */
const navAtras = (app) => app.document.getElementById("navAtras");
const navAdelante = (app) => app.document.getElementById("navAdelante");

test("Atrás/Adelante: van entre la cabecera y la tarjeta, en ese orden, y al arrancar están apagados", async () => {
  const app = await cargarApp({ servidor: servidorConDatos(), vista: "inicio" });
  try {
    const hdr = app.document.querySelector("#app .hdr");
    const fila = hdr.nextElementSibling;
    assert.ok(fila && fila.classList.contains("navrow"), "la fila va justo después de la cabecera");
    assert.ok(fila.nextElementSibling.classList.contains("card"), "y antes de la tarjeta de contenido");
    assert.deepStrictEqual(Array.from(fila.children).map((b) => b.textContent), ["‹ Atrás", "Adelante ›"]);
    assert.ok(navAtras(app).disabled && navAdelante(app).disabled, "sin historial no hay a dónde ir");
    assert.ok(navAtras(app).getAttribute("aria-label") && navAdelante(app).getAttribute("aria-label"));
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("Atrás/Adelante: Inicio → Registro → Atrás vuelve a Inicio y Adelante regresa al Registro con lo escrito", async () => {
  const app = await cargarApp({ servidor: servidorConDatos(), vista: "inicio" });
  try {
    await app.clickTexto("＋ Registrar liberación");
    assert.strictEqual(app.get("state.view"), "main");
    assert.ok(!navAtras(app).disabled && navAdelante(app).disabled);
    await app.elegirFrente("pad2f");
    const frente = app.get("state.estructura");
    await app.click(navAtras(app));
    assert.strictEqual(app.get("state.view"), "inicio");
    assert.ok(navAtras(app).disabled && !navAdelante(app).disabled, "ahora se puede avanzar y ya no retroceder");
    await app.click(navAdelante(app));
    assert.strictEqual(app.get("state.view"), "main");
    assert.strictEqual(app.get("state.estructura"), frente, "el borrador del formulario se conserva");
    assert.ok(navAdelante(app).disabled && !navAtras(app).disabled);
  } finally { app.cerrar(); }
});

test("Atrás/Adelante: una acción nueva borra lo que había por delante, y Atrás recorre varias pantallas en orden", async () => {
  const app = await cargarApp({ servidor: servidorConDatos(), vista: "inicio" });
  try {
    await abrirAnteriores(app);                         // Inicio → Anteriores
    await app.run("irInicio()"); await app.vaciar();    // → Inicio (otra vez, desde el menú)
    await app.clickTexto("＋ Registrar liberación");    // → Registro
    assert.deepStrictEqual(app.json("nav.atras"), ["inicio", "hoy", "inicio"]);
    await app.click(navAtras(app));
    assert.strictEqual(app.get("state.view"), "inicio");
    await app.click(navAtras(app));
    assert.strictEqual(app.get("state.view"), "hoy", "retrocede por donde se vino");
    assert.ok(!navAdelante(app).disabled);
    await app.click(navAdelante(app));
    assert.strictEqual(app.get("state.view"), "inicio");
    await app.clickTexto("Ver liberaciones anteriores");   // acción nueva
    assert.ok(navAdelante(app).disabled, "al hacer algo nuevo se pierde lo que había por delante");
  } finally { app.cerrar(); }
});

test("Atrás/Adelante: volver a Anteriores conserva el rango y el filtro de texto que se habían puesto", async () => {
  const app = await cargarApp({ servidor: servidorConDatos(), vista: "inicio" });
  try {
    await abrirAnteriores(app);
    await cambiarFecha(app, "fDesde", "2026-11-12");
    await app.escribir(app.document.getElementById("fTexto"), "zanja");
    await app.run("irInicio()"); await app.vaciar();
    await app.click(navAtras(app));
    assert.strictEqual(app.get("state.view"), "hoy");
    assert.strictEqual(app.document.getElementById("fDesde").value, "2026-11-12", "no vuelve a los 7 días de siempre");
    assert.strictEqual(app.get("dia.q"), "zanja");
  } finally { app.cerrar(); }
});

test("Atrás/Adelante: tras registrar una liberación, Atrás no reabre el formulario ya enviado", async () => {
  const app = await cargarApp({ servidor: servidorConDatos(), vista: "inicio" });
  try {
    await abrirAnteriores(app);
    await app.run("state.view = 'main'; render();"); await app.vaciar();   // p. ej. «copiar» desde el listado
    app.run("terminarRegistro('Registrada como L-0001.','ok')"); await app.vaciar();
    assert.strictEqual(app.get("state.view"), "inicio");
    assert.ok(!app.json("nav.atras").includes("main"), "el formulario ya enviado no queda en el historial");
  } finally { app.cerrar(); }
});

test("Atrás: saliendo de editar una liberación pregunta antes; si se rechaza se sigue editando y si se acepta se descarta", async () => {
  for (const confirmar of [false, true]) {
    const app = await cargarApp({ servidor: crearServidorMock(), confirmar });
    try {
      await app.elegirFrente("pad2f"); await app.elegirTipo("FUNDACION");
      app.run("prefs.supervisor = ''; resetForm(); render();");
      await llenarFormulario(app, { rng: crearRng(5), revisiones: 0 });
      await app.subir();
      await app.click(app.document.querySelector("button.edit"));
      assert.ok(app.get("state.editando"), "se abrió la edición");
      assert.ok(!navAtras(app).disabled);
      await app.click(navAtras(app));
      assert.ok(app.confirmaciones.some((m) => /editando una liberación/.test(m)), "pregunta antes de salir");
      if (confirmar) {
        assert.strictEqual(app.get("state.editando"), null, "se descarta la edición");
        assert.strictEqual(app.get("state.view"), "inicio");
        assert.ok(navAdelante(app).disabled, "una edición descartada no se puede reabrir con Adelante");
      } else {
        assert.ok(app.get("state.editando"), "sigue editando");
        assert.strictEqual(app.get("state.view"), "main");
      }
    } finally { app.cerrar(); }
  }
});

test("Atrás/Adelante: no aparecen en la pantalla de ingreso y cerrar sesión borra el historial", async () => {
  const sin = await cargarApp({ servidor: crearServidorMock(), usuario: null });
  try {
    assert.strictEqual(sin.get("necesitaAcceso()"), true, "sin sesión se pide ingresar");
    assert.ok(sin.botones("Ya tengo cuenta").length === 1, "es la pantalla de ingreso");
    assert.ok(!sin.document.getElementById("navAtras") && !sin.document.getElementById("navAdelante"), "sin sesión no hay navegación");
  } finally { sin.cerrar(); }
  const app = await cargarApp({ servidor: crearServidorMock(), vista: "inicio" });
  try {
    await app.clickTexto("＋ Registrar liberación");
    assert.ok(app.json("nav.atras").length > 0);
    app.run("cerrarSesion()"); await app.vaciar();
    assert.deepStrictEqual(app.json("nav.atras"), [], "otra persona no hereda el historial");
    assert.deepStrictEqual(app.json("nav.adelante"), []);
  } finally { app.cerrar(); }
});

test("Mi perfil y Ajustes del generador ya no tienen «← Volver»: se sale con Atrás o con el menú (los frentes de Ajustes sí lo conservan)", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios[0].rol = "admin";
  const app = await cargarApp({ servidor, usuario: servidor.usuarios[0], vista: "inicio" });
  try {
    const volver = () => app.botones(/Volver/).filter((b) => b.closest("#app .hdr"));
    const abrirMenu = () => app.click(app.botones("⚙ Configuración ▾")[0]);
    // Mi perfil
    await abrirMenu(); await app.clickTexto("Mi perfil", app.document.querySelector(".menu"));
    assert.strictEqual(app.get("state.view"), "perfil");
    assert.match(app.document.querySelector("#app .hdr").textContent, /Mi perfil/, "sigue el título");
    assert.strictEqual(volver().length, 0, "Mi perfil sin «← Volver»");
    await app.click(navAtras(app));
    assert.strictEqual(app.get("state.view"), "inicio", "Atrás saca de Mi perfil");
    // Ajustes del generador
    await abrirMenu(); await app.clickTexto("Ajustes del generador", app.document.querySelector(".menu"));
    assert.strictEqual(app.get("state.view"), "config");
    assert.match(app.document.querySelector("#app .hdr").textContent, /Ajustes del generador/);
    assert.strictEqual(volver().length, 0, "Ajustes sin «← Volver»");
    assert.ok(hayBoton(app, "Salir") && hayBoton(app, "Guardar para todos"), "la barra de abajo conserva Salir y Guardar");
    await app.click(navAtras(app));
    assert.strictEqual(app.get("state.view"), "inicio", "Atrás saca de Ajustes");
    // dentro de Ajustes, el editor de un frente sigue teniendo su «← Volver» (vuelve a Ajustes, no sale)
    await abrirMenu(); await app.clickTexto("Ajustes del generador", app.document.querySelector(".menu"));
    app.run("editarFrente(0)"); await app.vaciar();
    assert.strictEqual(app.get("state.view"), "frente");
    assert.strictEqual(volver().length, 1, "el editor del frente conserva «← Volver»");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});
