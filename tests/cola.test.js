"use strict";
/* Cola sin señal y reintentos, con un servidor simulado (dedupe por uid, ver tools/mock_server.py).
 * Invariantes que debe cumplir la app:
 *   - una liberación que no llega se guarda en el celular y se reenvía con el MISMO uid;
 *   - el servidor nunca guarda dos veces el mismo uid, aunque la respuesta se haya perdido;
 *   - un error del servidor ({ok:false}) deja el ítem en la cola marcado con error, sin martillar al servidor, y se puede reintentar. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearServidorMock, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");

async function prepararLiberacion(app, frente, tipo, semilla) {
  await app.elegirFrente(frente || "pad2f");
  if (app.json("state.tipo") !== (tipo || "FUNDACION")) await app.elegirTipo(tipo || "FUNDACION");
  app.run("prefs.supervisor = ''; resetForm(); render();");
  const r = await llenarFormulario(app, { rng: crearRng(semilla || 1), revisiones: 0 });
  assert.ok(r.texto);
  return r.texto;
}
async function escenario(modo, extra) {
  const servidor = crearServidorMock();
  const app = await cargarApp(Object.assign({ servidor }, extra || {})); // arranca con el servidor sano (getConfig al iniciar)
  servidor.modo = modo || "ok";
  return { app, servidor };
}
const addLibs = (s) => s.contarAcciones("addLib");
const textoNota = (app) => Array.from(app.document.querySelectorAll(".note")).map((n) => n.textContent).join(" | ");
const textoStat = (app) => Array.from(app.document.querySelectorAll(".stat")).map((n) => n.textContent).join(" | ");
const botonSubir = (app) => app.botones(/Subir liberación|Subiendo|Subida|En cola|Reintentar/, app.document.getElementById("outbox"))[0];

test("camino feliz: sube una vez, no queda nada en la cola y llega con todos los campos", async () => {
  const { app, servidor } = await escenario("ok");
  try {
    const texto = await prepararLiberacion(app);
    await app.subir();
    assert.strictEqual(servidor.recibidos.length, 1);
    assert.strictEqual(servidor.guardados.length, 1);
    const b = servidor.guardados[0];
    assert.ok(typeof b.uid === "string" && b.uid.length >= 6, "uid");
    assert.strictEqual(b.texto, texto);
    assert.ok(Array.isArray(b.campos) && b.campos.length >= 3);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(b.fecha), "fecha");
    assert.ok(b.turno === "DÍA" || b.turno === "NOCHE", "turno");
    const form = JSON.parse(b.form);
    assert.strictEqual(form.estructura, "pad2f");
    assert.strictEqual(form.tipo, "FUNDACION");
    assert.strictEqual(app.cola.length, 0);
    assert.deepStrictEqual(app.colaGuardada() || [], []);
    assert.match(botonSubir(app).textContent, /Subida/);
    assert.ok(botonSubir(app).disabled, "no se puede subir dos veces la misma liberación");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("sin señal: queda en cola (persistida) y al volver la señal se reenvía con el MISMO uid", async () => {
  const { app, servidor } = await escenario("caida");
  try {
    const texto = await prepararLiberacion(app);
    await app.subir();
    assert.strictEqual(servidor.guardados.length, 0);
    assert.strictEqual(app.cola.length, 1, "la liberación debe quedar en la cola");
    const uid = app.json("cola[0].uid");
    assert.strictEqual(app.json("cola[0].texto"), texto);
    assert.deepStrictEqual(app.colaGuardada().map((i) => i.uid), [uid], "la cola debe estar en localStorage");
    assert.match(botonSubir(app).textContent, /En cola/);
    assert.match(textoNota(app), /espera señal/);
    assert.match(textoStat(app), /Sin señal: se guardó en el celular/);

    servidor.modo = "ok";
    await app.disparar("online");
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(servidor.guardados[0].uid, uid, "el reenvío debe usar el mismo uid");
    assert.strictEqual(servidor.guardados[0].texto, texto);
    assert.strictEqual(app.cola.length, 0);
    assert.deepStrictEqual(app.colaGuardada(), []);
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("sin señal sostenida: reintenta cada minuto con el mismo uid y no duplica ni pierde nada", async () => {
  const { app, servidor } = await escenario("caida");
  try {
    await prepararLiberacion(app);
    await app.subir();
    const uid = app.json("cola[0].uid");
    const antes = addLibs(servidor);
    await app.avanzar(3 * 60000 + 1000);
    const intentos = servidor.peticiones.filter((p) => p.body.action === "addLib");
    assert.ok(intentos.length - antes >= 3, "debe reintentar al menos una vez por minuto (hubo " + (intentos.length - antes) + ")");
    intentos.forEach((p) => assert.strictEqual(p.body.uid, uid, "todos los reintentos con el mismo uid"));
    assert.strictEqual(app.cola.length, 1);
    servidor.modo = "ok";
    await app.avanzar(60000);
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(servidor.guardados[0].uid, uid);
    assert.strictEqual(app.cola.length, 0);
  } finally { app.cerrar(); }
});

test("respuesta perdida tras guardar: el reenvío usa el mismo uid y el servidor no guarda duplicados", async () => {
  const { app, servidor } = await escenario("perdida");
  try {
    await prepararLiberacion(app);
    await app.subir();
    assert.strictEqual(servidor.guardados.length, 1, "el servidor sí la guardó");
    assert.strictEqual(app.cola.length, 1, "la app no lo sabe: queda en cola");
    const uid = app.json("cola[0].uid");
    assert.strictEqual(servidor.guardados[0].uid, uid);

    servidor.modo = "ok";
    await app.disparar("online");
    assert.strictEqual(servidor.recibidos.length, 2, "se reenvió una vez");
    assert.deepStrictEqual(servidor.vecesPorUid(), { [uid]: 2 }, "las dos veces con el mismo uid");
    assert.strictEqual(servidor.guardados.length, 1, "el servidor no debe tener duplicados");
    assert.strictEqual(app.cola.length, 0, "la cola se vacía al confirmar");
  } finally { app.cerrar(); }
});

test("error de servidor en la cola: el ítem queda con error, no se martillea al servidor y «Reintentar» lo reenvía con el mismo uid", async () => {
  const { app, servidor } = await escenario("caida");
  try {
    await prepararLiberacion(app);
    await app.subir();
    const uid = app.json("cola[0].uid");
    servidor.modo = "error";
    await app.disparar("online");
    assert.strictEqual(app.cola.length, 1, "no se descarta");
    assert.ok(app.json("cola[0].error"), "debe quedar marcado con el error");
    assert.match(app.json("cola[0].error"), /Hoja bloqueada/);
    assert.ok(app.colaGuardada()[0].error, "el error también se guarda");
    assert.match(textoNota(app), /No se pudo subir: Hoja bloqueada/);
    assert.ok(app.document.querySelector(".note.err"), "aviso en rojo");
    const intentos = addLibs(servidor);
    await app.avanzar(5 * 60000);
    await app.disparar("online");
    assert.strictEqual(addLibs(servidor), intentos, "con error de servidor no se reintenta solo (solo con el botón)");
    assert.strictEqual(servidor.guardados.length, 0);

    servidor.modo = "ok";
    await app.clickTexto("Reintentar", app.document.querySelector(".note"));
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(servidor.guardados[0].uid, uid);
    assert.strictEqual(app.cola.length, 0);
    assert.ok(!app.document.querySelector(".note.err"));
  } finally { app.cerrar(); }
});

test("error de servidor en el primer envío: se muestra el error y el botón permite reintentar con el mismo uid", async () => {
  const { app, servidor } = await escenario("error");
  try {
    const texto = await prepararLiberacion(app);
    await app.subir();
    assert.strictEqual(app.cola.length, 0, "un error del servidor no se encola: el usuario decide reintentar");
    assert.match(textoStat(app), /No se pudo subir: Hoja bloqueada/);
    const b = botonSubir(app);
    assert.match(b.textContent, /Reintentar/);
    assert.ok(!b.disabled, "debe poder reintentar");
    servidor.modo = "ok";
    await app.subir();
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(servidor.guardados[0].texto, texto);
    const uids = servidor.recibidos.map((r) => r.uid);
    assert.strictEqual(uids.length, 2);
    assert.strictEqual(uids[0], uids[1], "el reintento debe conservar el uid del primer intento (si el servidor hubiera guardado y fallado después, no duplicaría)");
  } finally { app.cerrar(); }
});

test("HTTP 500 o servidor que no responde se tratan como falta de señal (se encola y se reintenta)", async () => {
  const { app, servidor } = await escenario("http500");
  try {
    await prepararLiberacion(app);
    await app.subir();
    assert.strictEqual(app.cola.length, 1);
    assert.ok(!app.json("cola[0].error"), "HTTP 500 no marca error permanente");
    servidor.modo = "ok";
    await app.avanzar(60000);
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(app.cola.length, 0);
  } finally { app.cerrar(); }
});

test("servidor que no responde: a los 90 s se aborta, se encola y luego se entrega", async () => {
  const { app, servidor } = await escenario("lenta");
  try {
    await prepararLiberacion(app);
    await app.subir();
    assert.match(botonSubir(app).textContent, /Subiendo/);
    assert.ok(botonSubir(app).disabled);
    await app.avanzar(80000);
    assert.strictEqual(app.cola.length, 0, "todavía esperando respuesta");
    await app.avanzar(11000);
    assert.strictEqual(servidor.abortados, 1, "la petición debe abortarse a los 90 s");
    assert.strictEqual(app.cola.length, 1);
    const uid = app.json("cola[0].uid");
    servidor.modo = "ok";
    await app.disparar("online");
    assert.strictEqual(servidor.guardados.length, 1);
    assert.strictEqual(servidor.guardados[0].uid, uid);
  } finally { app.cerrar(); }
});

test("varias liberaciones en cola: salen una a una, en orden, cada una con su uid; nunca dos envíos en paralelo", async () => {
  const { app, servidor } = await escenario("caida");
  try {
    const t1 = await prepararLiberacion(app, "pad2f", "FUNDACION", 1);
    await app.subir();
    const t2 = await prepararLiberacion(app, "pad2f", "EVALUACION", 2);
    await app.subir();
    assert.strictEqual(app.cola.length, 2);
    const uids = app.json("cola.map(function(i){return i.uid;})");
    assert.notStrictEqual(uids[0], uids[1], "uids distintos");
    assert.match(textoNota(app), /2 liberaciones esperan señal/);

    // paralelismo: con un servidor que tarda, varias llamadas seguidas a procesarCola() solo envían un ítem
    servidor.modo = "lenta";
    const antes = addLibs(servidor);
    app.run("procesarCola(); procesarCola(); procesarCola();");
    await app.vaciar();
    app.run("procesarCola();");
    await app.vaciar();
    assert.strictEqual(addLibs(servidor) - antes, 1, "nunca dos envíos de la cola en paralelo");

    // al volver la señal salen todas, en el orden de la cola
    await app.avanzar(91000);            // vence el envío colgado (queda en cola, sin error)
    assert.strictEqual(app.cola.length, 2);
    servidor.modo = "ok";
    await app.disparar("online");
    await app.avanzar(1000);
    assert.deepStrictEqual(servidor.guardados.map((g) => g.uid), uids, "orden de llegada = orden de la cola");
    assert.deepStrictEqual(servidor.guardados.map((g) => g.texto), [t1, t2]);
    assert.strictEqual(app.cola.length, 0);
  } finally { app.cerrar(); }
});

test("un ítem con error de servidor no bloquea a los demás; al reintentar, sale con su mismo uid y sin duplicados", async () => {
  const { app, servidor } = await escenario("caida");
  try {
    const t1 = await prepararLiberacion(app, "pad2f", "FUNDACION", 1);
    await app.subir();
    const t2 = await prepararLiberacion(app, "pad2f", "EVALUACION", 2);
    await app.subir();
    const [u1, u2] = app.json("cola.map(function(i){return i.uid;})");
    servidor.rechazarUids.add(u1);       // el servidor rechaza solo la primera
    servidor.modo = "ok";
    await app.disparar("online");
    await app.avanzar(60000);            // dos ciclos del temporizador de la cola
    await app.avanzar(60000);
    assert.deepStrictEqual(servidor.guardados.map((g) => g.uid), [u2], "la segunda no queda bloqueada por la primera");
    assert.strictEqual(app.cola.length, 1);
    assert.strictEqual(app.json("cola[0].uid"), u1);
    assert.ok(app.json("cola[0].error"), "la primera queda marcada con error");
    const vecesU1 = servidor.vecesPorUid()[u1];
    await app.avanzar(5 * 60000);
    assert.strictEqual(servidor.vecesPorUid()[u1], vecesU1, "un ítem con error no se reintenta solo");

    servidor.rechazarUids.clear();
    await app.clickTexto("Reintentar", app.document.querySelector(".note"));
    assert.deepStrictEqual(servidor.guardados.map((g) => g.uid), [u2, u1]);
    assert.deepStrictEqual(servidor.guardados.map((g) => g.texto), [t2, t1]);
    assert.strictEqual(app.cola.length, 0);
  } finally { app.cerrar(); }
});

test("cerrar y reabrir la app con la cola pendiente: al arrancar se reenvía con el mismo uid", async () => {
  for (const idb of ["ausente", "presente"]) {
    const { app, servidor } = await escenario("caida", { indexedDB: idb });
    let app2;
    try {
      const texto = await prepararLiberacion(app);
      await app.subir();
      const uid = app.json("cola[0].uid");
      assert.strictEqual(app.colaGuardada().length, 1);
      servidor.modo = "ok";
      app2 = await app.reabrir();
      await app2.vaciar();
      assert.strictEqual(servidor.guardados.length, 1, `[indexedDB ${idb}] tras reabrir debe enviarse sola`);
      assert.strictEqual(servidor.guardados[0].uid, uid);
      assert.strictEqual(servidor.guardados[0].texto, texto);
      assert.strictEqual(app2.cola.length, 0);
      assert.deepStrictEqual(app2.errores.map(String), []);
    } finally { app.cerrar(); if (app2) app2.cerrar(); }
  }
});

test("reabrir con la cola pendiente y el servidor aún caído: sigue en cola, sin duplicar uids", async () => {
  const { app, servidor } = await escenario("caida");
  let app2;
  try {
    await prepararLiberacion(app);
    await app.subir();
    const uid = app.json("cola[0].uid");
    app2 = await app.reabrir();
    assert.deepStrictEqual(app2.json("cola.map(function(i){return i.uid;})"), [uid]);
    assert.match(textoNota(app2), /espera señal/);
    await app2.avanzar(120000);
    assert.strictEqual(app2.cola.length, 1);
    assert.strictEqual(servidor.guardados.length, 0);
  } finally { app.cerrar(); if (app2) app2.cerrar(); }
});

test("sin espacio en el celular: no se pierde en silencio, avisa y no deja la cola a medias", async () => {
  const { app, servidor } = await escenario("caida");
  try {
    await prepararLiberacion(app);
    app.ls.fallarEscritura = (k) => k === "genlib.cola.v1";
    await app.subir();
    assert.strictEqual(app.cola.length, 0, "no debe quedar en memoria una cola que no se pudo guardar");
    assert.match(textoStat(app), /sin espacio/i);
    assert.strictEqual(servidor.guardados.length, 0);
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

/* espera (con el reloj falso quieto) a que se cumpla una condición asíncrona, p. ej. escrituras en IndexedDB */
async function esperar(app, cond, msg) {
  for (let i = 0; i < 200; i++) { if (cond()) return; await app.vaciar(); await new Promise((r) => setTimeout(r, 2)); }
  assert.fail("Tiempo agotado esperando: " + msg);
}

test("foto adjunta (sin IndexedDB): viaja dentro del ítem de la cola y llega completa al servidor", async () => {
  const { app, servidor } = await escenario("caida", { indexedDB: "ausente" });
  try {
    await prepararLiberacion(app);
    await app.adjuntarFoto();
    assert.ok(app.json("state.foto"), "la foto debe quedar adjunta");
    await app.subir();
    assert.strictEqual(app.cola.length, 1);
    assert.strictEqual(app.json("cola[0].foto.mime"), "image/jpeg");
    assert.strictEqual(app.colaGuardada()[0].foto.data, "AAAABBBBCCCCDDDD", "sin IndexedDB la foto queda en el propio ítem");
    servidor.modo = "ok";
    await app.disparar("online");
    await esperar(app, () => servidor.guardados.length === 1, "el envío de la cola");
    assert.strictEqual(servidor.guardados[0].foto.data, "AAAABBBBCCCCDDDD");
    assert.ok(servidor.guardados[0].nombreFoto && servidor.guardados[0].nombreFoto.length > 3, "nombreFoto");
    assert.deepStrictEqual(app.errores.map(String), []);
  } finally { app.cerrar(); }
});

test("foto adjunta (con IndexedDB): se guarda en IndexedDB, sobrevive a reabrir la app y llega completa", async () => {
  const { app, servidor } = await escenario("caida", { indexedDB: "presente" });
  let app2;
  try {
    await prepararLiberacion(app);
    await app.adjuntarFoto();
    await app.subir();
    const uid = app.json("cola[0].uid");
    const guardada = () => { const q = app.colaGuardada(); return q && q[0] && q[0].foto; };
    await esperar(app, () => guardada() && guardada().idb === true, "que la foto pase a IndexedDB");
    assert.ok(!guardada().data, "localStorage no debe cargar con la foto cuando está en IndexedDB");
    app2 = await app.reabrir({ indexedDB: "presente" });
    assert.strictEqual(app2.json("cola.length"), 1);
    assert.strictEqual(app2.json("cola[0].uid"), uid);
    servidor.modo = "ok";
    await app2.disparar("online");
    await esperar(app2, () => servidor.guardados.length === 1, "el envío de la cola reabierta");
    assert.strictEqual(servidor.guardados[0].uid, uid);
    assert.strictEqual(servidor.guardados[0].foto.data, "AAAABBBBCCCCDDDD", "la foto debe leerse de IndexedDB y viajar completa");
    await esperar(app2, () => app2.cola.length === 0, "que la cola se vacíe");
    assert.deepStrictEqual(app2.errores.map(String), []);
  } finally { app.cerrar(); if (app2) app2.cerrar(); }
});

test("IndexedDB bloqueado o ausente al encolar con foto: la foto no se pierde (queda en el ítem)", async () => {
  for (const idb of ["bloqueado", "ausente"]) {
    const { app, servidor } = await escenario("caida", { indexedDB: idb });
    try {
      await prepararLiberacion(app);
      await app.adjuntarFoto();
      await app.subir();
      assert.strictEqual(app.cola.length, 1, `[indexedDB ${idb}] debe quedar en cola`);
      servidor.modo = "ok";
      await app.disparar("online");
      await esperar(app, () => servidor.guardados.length === 1, `[indexedDB ${idb}] el envío`);
      assert.strictEqual(servidor.guardados[0].foto.data, "AAAABBBBCCCCDDDD", `[indexedDB ${idb}] la foto debe llegar`);
      assert.deepStrictEqual(app.errores.map(String), [], `[indexedDB ${idb}]`);
    } finally { app.cerrar(); }
  }
});

test("sin conexión configurada: no se envía nada y se avisa", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, conectar: false });
  try {
    await prepararLiberacion(app);
    assert.strictEqual(app.get("conectado()"), false);
    await app.subir();
    assert.strictEqual(servidor.peticiones.length, 0);
    assert.match(textoStat(app), /conecta la app/i);
    assert.strictEqual(app.cola.length, 0);
  } finally { app.cerrar(); }
});

test("acceso rechazado por el servidor (baja): la liberación se conserva en la cola y no se marca como error", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    await prepararLiberacion(app);
    servidor.usuarios[0].estado = "BAJA";
    await app.subir();
    assert.strictEqual(servidor.guardados.length, 0);
    assert.strictEqual(app.cola.length, 1);
    assert.strictEqual(app.cola[0].error, undefined);
  } finally { app.cerrar(); }
});

test.todo("(no probado) Background Sync / Service Worker: jsdom no implementa service workers; la cola solo se prueba con el reintento por temporizador y el evento online");
