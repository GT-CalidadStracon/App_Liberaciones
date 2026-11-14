"use strict";
/* Acceso por persona: registro (nombre completo + usuario + código + clave de invitación), ingreso, espera, baja,
 * roles (registro / editor / admin), Mi perfil, editar liberaciones y administración de usuarios.
 * Usa el servidor simulado (tests/helpers/cargarApp.js) con el contrato del Apps Script nuevo. */
const test = require("node:test");
const assert = require("node:assert");
const { cargarApp, crearServidorMock, crearRng } = require("./helpers/cargarApp");
const { llenarFormulario } = require("./helpers/llenar");

const texto = (app) => app.document.querySelector("#app").textContent;
const campo = (app, k) => app.document.querySelector('[data-fk="acc_' + k + '"]');
const hayBoton = (app, t) => app.botones(t).length > 0;
async function llenar(app, vals) {
  for (const k of Object.keys(vals)) await app.escribir(campo(app, k), vals[k]);
}
const sinSesion = (extra) => {
  const servidor = crearServidorMock();
  return cargarApp(Object.assign({ servidor, usuario: null }, extra || {})).then((app) => ({ app, servidor }));
};
const BETO = { nombre: "Beto Registro", usuario: "beto", codigo: "codigo-beto", rol: "registro", estado: "ACTIVO" };
const OTRA = { nombre: "Otra Persona", usuario: "opersona", codigo: "codigo-otra", rol: "registro", estado: "ACTIVO" };
const LUIS = { nombre: "Luis Admin", usuario: "luis", codigo: "codigo-luis", rol: "admin", estado: "ACTIVO" };

/* sube una liberación completa desde el formulario y deja la pantalla de inicio (sin tipo) para ver "Últimas liberaciones" */
async function subirUna(app, semilla) {
  await app.elegirFrente("pad2f");
  await app.elegirTipo("FUNDACION");
  app.run("prefs.supervisor = ''; resetForm(); render();");
  const r = await llenarFormulario(app, { rng: crearRng(semilla || 1), revisiones: 0 });
  await app.subir();
  app.run("state.tipo=''; resetForm(); render();");
  return r.texto;
}

test("sin servidor configurado la app funciona sola (sin pantalla de acceso)", async () => {
  const app = await cargarApp({});
  try {
    assert.strictEqual(app.get("usaServidor()"), false);
    assert.strictEqual(app.get("necesitaAcceso()"), false);
    assert.ok(hayBoton(app, "PAD 2F"));
  } finally { app.cerrar(); }
});

test("con servidor y sin sesión se pide registrarse o ingresar; no se ve el formulario de liberaciones", async () => {
  const { app } = await sinSesion();
  try {
    assert.strictEqual(app.get("necesitaAcceso()"), true);
    assert.ok(hayBoton(app, "Registrarme") && hayBoton(app, "Ya tengo cuenta"));
    assert.ok(!hayBoton(app, "PAD 2F"));
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("registro: pide nombre completo, usuario, código y clave de invitación; valida antes de enviar", async () => {
  const { app, servidor } = await sinSesion();
  try {
    await app.clickTexto("Registrarme");
    for (const k of ["nombre", "usuario", "codigo", "codigo2", "clave"]) assert.ok(campo(app, k), "falta el campo " + k);
    const ok = { nombre: "Carla Pérez", usuario: "cperez", codigo: "mi-codigo-1", codigo2: "mi-codigo-1", clave: servidor.clave };
    await llenar(app, Object.assign({}, ok, { nombre: "Ca" }));
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /nombre completo/);
    await llenar(app, Object.assign({}, ok, { usuario: "Carla Pérez" }));
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /usuario debe tener de 4 a 20/);
    await llenar(app, Object.assign({}, ok, { codigo: "abc", codigo2: "abc" }));
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /al menos 6 caracteres/);
    await llenar(app, Object.assign({}, ok, { codigo2: "otro-codigo" }));
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /no coinciden/);
    assert.strictEqual(servidor.contarAcciones("registrar"), 0);
    await llenar(app, Object.assign({}, ok, { clave: "mala" }));
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /Clave de invitación incorrecta/);
    // usuario ya tomado
    servidor.usuarios.push(Object.assign({}, OTRA));
    await llenar(app, Object.assign({}, ok, { usuario: "OPersona" }));
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /usuario ya existe/);
    // todo bien: queda ACTIVO con rol registro y la clave de invitación no se guarda en el celular
    await llenar(app, ok);
    await app.clickTexto("Crear mi cuenta");
    assert.strictEqual(app.get("sesion.estado"), "ACTIVO");
    assert.strictEqual(app.get("sesion.rol"), "registro");
    assert.strictEqual(app.get("sesion.usuario"), "cperez");
    assert.strictEqual(app.get("activo()"), true);
    assert.strictEqual(app.get("esEditor()"), false);
    assert.ok(hayBoton(app, "PAD 2F"), "debe mostrar el formulario");
    assert.match(texto(app), /Carla Pérez/, "el nombre queda en la cabecera");
    assert.ok(!app.ls.getItem("genlib.user.v1").includes(servidor.clave));
    assert.strictEqual(app.document.querySelectorAll("button.borrar").length, 0);
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("registro con aprobación exigida: queda pendiente y al aprobarse entra con «Revisar»", async () => {
  const { app, servidor } = await sinSesion();
  servidor.exigirAprobacion = true;
  try {
    await app.clickTexto("Registrarme");
    await llenar(app, { nombre: "Carla Pérez", usuario: "cperez", codigo: "mi-codigo-1", codigo2: "mi-codigo-1", clave: servidor.clave });
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /Solicitud enviada/);
    assert.strictEqual(app.get("sesion.estado"), "PENDIENTE");
    assert.strictEqual(app.get("necesitaAcceso()"), true);
    await app.clickTexto("Revisar");
    assert.match(texto(app), /Todavía no te aprueban/);
    servidor.usuarios.find((u) => u.usuario === "cperez").estado = "ACTIVO";
    await app.clickTexto("Revisar");
    assert.strictEqual(app.get("activo()"), true);
    assert.ok(hayBoton(app, "PAD 2F"));
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("el enlace #invitar= deja la clave de invitación ya escrita; no se guarda en la sesión y tras registrarse se olvida", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, usuario: null, hash: "#invitar=" + servidor.clave });
  try {
    assert.ok(campo(app, "clave"), "el campo de la clave de invitación siempre se muestra");
    assert.strictEqual(campo(app, "clave").value, servidor.clave, "viene escrita desde el enlace");
    await llenar(app, { nombre: "Pedro Gómez", usuario: "pgomez", codigo: "codigo-pedro", codigo2: "codigo-pedro" });
    await app.clickTexto("Crear mi cuenta");
    assert.strictEqual(servidor.usuarios.some((u) => u.usuario === "pgomez" && u.estado === "ACTIVO"), true);
    assert.strictEqual(app.get("activo()"), true);
    assert.strictEqual(app.get("invitacion"), "");
    assert.strictEqual(app.ls.getItem("genlib.inv.v1"), "");
    assert.strictEqual(app.document.defaultView.location.hash, "");
  } finally { app.cerrar(); }
});

test("el registro siempre pide la clave de invitación; si la del enlace es incorrecta se puede corregir en el campo", async () => {
  const servidor = crearServidorMock();
  const sinEnlace = await cargarApp({ servidor, usuario: null });
  try {
    await sinEnlace.clickTexto("Registrarme");
    assert.ok(campo(sinEnlace, "clave"), "sin enlace también pide la clave de invitación");
    assert.strictEqual(campo(sinEnlace, "clave").value, "");
  } finally { sinEnlace.cerrar(); }
  const app = await cargarApp({ servidor, usuario: null, hash: "#invitar=clave-equivocada" });
  try {
    assert.strictEqual(campo(app, "clave").value, "clave-equivocada");
    await llenar(app, { nombre: "Pedro Gómez", usuario: "pgomez", codigo: "codigo-pedro", codigo2: "codigo-pedro" });
    await app.clickTexto("Crear mi cuenta");
    assert.match(texto(app), /Clave de invitación incorrecta/);
    assert.ok(campo(app, "clave"), "el campo sigue ahí para corregirla");
    await llenar(app, { clave: servidor.clave });
    await app.clickTexto("Crear mi cuenta");
    assert.strictEqual(app.get("sesion.estado"), "ACTIVO");
  } finally { app.cerrar(); }
});

test("ingreso con usuario y código: error genérico si falla; entra si es correcto (sin importar mayúsculas)", async () => {
  const { app } = await sinSesion();
  try {
    await app.clickTexto("Ya tengo cuenta");
    assert.ok(campo(app, "usuario") && campo(app, "codigo") && !campo(app, "nombre"), "ingreso: solo usuario y código");
    await llenar(app, { usuario: "ana", codigo: "mal-codigo" });
    await app.clickTexto("Ingresar");
    assert.match(texto(app), /Usuario o código incorrecto/);
    assert.strictEqual(app.get("sesion"), null);
    await llenar(app, { usuario: "ANA", codigo: "codigo-ana" });
    await app.clickTexto("Ingresar");
    assert.strictEqual(app.get("activo()"), true);
    assert.strictEqual(app.get("esEditor()"), true);
    assert.strictEqual(app.get("sesion.nombre"), "Ana");   // el nombre queda como lo guardó el servidor
    assert.strictEqual(app.get("sesion.usuario"), "ana");
  } finally { app.cerrar(); }
});

test("roles: solo editor/admin ven la ✕ de borrar; quien solo registra no, y solo edita (✎) lo suyo", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios.push(Object.assign({}, BETO));
  servidor.guardados.push(
    { uid: "u1", fecha: "2026-11-13", turno: "DÍA", texto: "TIPO DE LIBERACIÓN: X\nESTRUCTURA: PAD 2F\nSUPERVISOR CQC: A", form: "", porId: "ana", porNombre: "Ana" },
    { uid: "u2", fecha: "2026-11-13", turno: "DÍA", texto: "TIPO DE LIBERACIÓN: Y\nESTRUCTURA: PAD 2F\nSUPERVISOR CQC: A", form: "", porId: "beto", porNombre: "Beto Registro" });
  const editor = await cargarApp({ servidor });
  try {
    await editor.run("cargarRecientes(true)"); await editor.vaciar();
    assert.ok(editor.document.querySelectorAll("button.borrar").length >= 2, "el editor ve ✕ en todas");
    assert.ok(editor.document.querySelectorAll("button.edit").length >= 2, "el editor edita todas");
  } finally { editor.cerrar(); }
  const registro = await cargarApp({ servidor, usuario: BETO });
  try {
    await registro.run("cargarRecientes(true)"); await registro.vaciar();
    assert.strictEqual(registro.get("esEditor()"), false);
    assert.strictEqual(registro.get("activo()"), true);
    assert.strictEqual(registro.document.querySelectorAll("button.borrar").length, 0);
    assert.strictEqual(registro.document.querySelectorAll("button.edit").length, 1, "solo la que registró él");
  } finally { registro.cerrar(); }
});

test("si el servidor da de baja a la persona, la app muestra la baja y conserva la cola", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    app.run("cola.push({uid:'u-baja',texto:'TIPO DE LIBERACIÓN: X',campos:[],turno:'DÍA',fecha:'2026-11-13',creado:Date.now()}); guardarCola();");
    servidor.usuarios[0].estado = "BAJA";
    app.run("procesarCola()");
    await app.vaciar();
    assert.strictEqual(app.get("sesion.estado"), "BAJA");
    assert.match(texto(app), /dado de baja/);
    assert.strictEqual(app.cola.length, 1);
    assert.strictEqual(app.cola[0].error, undefined, "no se marca error: se reintenta al ingresar");
    assert.strictEqual(servidor.guardados.length, 0);
  } finally { app.cerrar(); }
});

test("si el código ya no vale (lo cambiaron) pide ingresar de nuevo con aviso", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    servidor.usuarios[0].codigo = "codigo-nuevo";
    await app.run("refrescarSesion()");
    await app.vaciar();
    assert.strictEqual(app.get("sesion"), null);
    assert.match(texto(app), /Tu código ya no es válido/);
  } finally { app.cerrar(); }
});

// ── Mi perfil ────────────────────────────────────────────────────
test("Menú «Configuración»: ofrece Mi perfil y Ajustes del generador; Ajustes muestra quién y cuándo cambió la configuración (sin versiones)", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios[0].rol = "admin";
  const app = await cargarApp({ servidor, usuario: servidor.usuarios[0] });
  try {
    servidor.config = app.json("defaultConfig()"); servidor.version = 2;   // el equipo ya publicó una configuración
    await app.window.syncConfig(true); await app.vaciar();
    assert.match(app.document.querySelector(".hdr .chip").textContent, /Ana · Administrador/, "el nombre queda como etiqueta simple");
    assert.strictEqual(app.document.querySelector("button.chip"), null, "el nombre ya no es un botón");
    assert.strictEqual(app.botones("Mi perfil").length, 0, "el menú está cerrado al inicio");
    const btn = app.botones("⚙ Configuración ▾")[0];
    assert.strictEqual(btn.getAttribute("aria-expanded"), "false");
    await app.click(btn);
    assert.strictEqual(btn.getAttribute("aria-expanded"), "true");
    assert.deepStrictEqual(Array.from(app.document.querySelectorAll(".menu [role=menuitem]")).map((x) => x.textContent), ["Mi perfil", "Ajustes del generador", "Cerrar sesión"]);
    // se cierra con Escape y al tocar fuera
    app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.strictEqual(app.document.querySelector(".menu"), null);
    await app.click(btn); assert.ok(app.document.querySelector(".menu"));
    await app.click(app.document.querySelector(".hdr .ttl")); assert.strictEqual(app.document.querySelector(".menu"), null, "tocar fuera lo cierra");
    // Ajustes del generador
    await app.click(btn);
    await app.clickTexto("Ajustes del generador");
    assert.strictEqual(app.get("state.view"), "config");
    await app.vaciar();
    assert.ok(!/PIN de editor/i.test(texto(app)));
    assert.match(texto(app), /Última modificación/);
    assert.match(texto(app), /Luis Editor/, "se muestra quién hizo el último cambio");
    assert.match(texto(app), /12\/11\/2026 10:30/, "y cuándo");
    assert.ok(!/versión|\bv\d+\b|configuración v/i.test(app.document.querySelector("#app .card").textContent), "sin números de versión");
    assert.ok(!hayBoton(app, "Cerrar sesión") && !hayBoton(app, "Mi perfil"), "Mi perfil y Cerrar sesión ya no viven dentro de Ajustes (están en el menú)");
    await app.run("salirConfig()"); await app.vaciar();
    // Mi perfil
    await app.click(app.botones("⚙ Configuración ▾")[0]);
    await app.clickTexto("Mi perfil");
    assert.strictEqual(app.get("state.view"), "perfil");
    for (const b of ["Gestionar usuarios ›", "Cerrar sesión"]) assert.ok(app.botones(b).every((x) => x.parentNode.classList.contains("btns")), b + " va dentro de .btns (con el estilo de la app)");
    await app.clickTexto("Cerrar sesión");
    assert.strictEqual(app.confirmaciones.length > 0, true);
    assert.strictEqual(app.get("sesion"), null);
    assert.strictEqual(app.get("necesitaAcceso()"), true);
  } finally { app.cerrar(); }
});

test("Mi perfil: se abre desde el menú Configuración, edita nombre y usuario y evita repetidos", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios.push(Object.assign({}, BETO), Object.assign({}, OTRA));
  const app = await cargarApp({ servidor, usuario: BETO });
  try {
    await app.click(app.botones("⚙ Configuración ▾")[0]);
    await app.clickTexto("Mi perfil");
    assert.strictEqual(app.get("state.view"), "perfil");
    assert.match(texto(app), /Mi perfil/);
    assert.strictEqual(campo(app, "pnombre").value, "Beto Registro");
    assert.strictEqual(campo(app, "pusuario").value, "beto");
    assert.match(texto(app), /Registra liberaciones y puede editar las que registró él mismo/);
    assert.ok(!hayBoton(app, "Gestionar usuarios ›"), "solo el admin ve la administración");
    // sin cambios
    await app.clickTexto("Guardar mis datos");
    assert.match(texto(app), /No hay cambios/);
    // usuario inválido y repetido
    await llenar(app, { pusuario: "b b" });
    await app.clickTexto("Guardar mis datos");
    assert.match(texto(app), /usuario debe tener de 4 a 20/);
    await llenar(app, { pusuario: "opersona" });
    await app.clickTexto("Guardar mis datos");
    assert.match(texto(app), /usuario ya existe/);
    assert.strictEqual(app.get("sesion.usuario"), "beto");
    // correcto: el nuevo usuario es el que se usa desde ahora
    await llenar(app, { pnombre: "Alberto Ríos", pusuario: "ARios" });
    await app.clickTexto("Guardar mis datos");
    assert.match(texto(app), /Datos guardados/);
    assert.deepStrictEqual(app.json("[sesion.nombre,sesion.usuario,sesion.acceso]"), ["Alberto Ríos", "arios", "arios"]);
    assert.strictEqual(servidor.usuarios.find((u) => u.codigo === "codigo-beto").usuario, "arios");
    await app.run("refrescarSesion()"); await app.vaciar();
    assert.strictEqual(app.get("activo()"), true, "la sesión sigue válida con el usuario nuevo");
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("Mi perfil: cambia el código (validando) y el código nuevo es el que usa la app", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    await app.run("abrirPerfil()"); await app.vaciar();
    await app.clickTexto("Cambiar mi código");
    await llenar(app, { nuevo: "abc", nuevo2: "abc" });
    await app.clickTexto("Guardar código nuevo");
    assert.match(texto(app), /al menos 6 caracteres/);
    await llenar(app, { nuevo: "codigo-nuevo-9", nuevo2: "otro" });
    await app.clickTexto("Guardar código nuevo");
    assert.match(texto(app), /no coinciden/);
    await llenar(app, { nuevo: "codigo-ana", nuevo2: "codigo-ana" });
    await app.clickTexto("Guardar código nuevo");
    assert.match(texto(app), /distinto al actual/);
    await llenar(app, { nuevo: "codigo-nuevo-9", nuevo2: "codigo-nuevo-9" });
    await app.clickTexto("Guardar código nuevo");
    assert.match(texto(app), /Código cambiado/);
    assert.strictEqual(servidor.usuarios[0].codigo, "codigo-nuevo-9");
    assert.strictEqual(app.get("sesion.codigo"), "codigo-nuevo-9");
    await app.run("refrescarSesion()"); await app.vaciar();
    assert.strictEqual(app.get("activo()"), true);
  } finally { app.cerrar(); }
});

// ── editar una liberación ────────────────────────────────────────
test("editar: ✎ carga la liberación en el formulario, «Guardar cambios» la actualiza (mismo ID) y no crea otra", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    const original = await subirUna(app);
    assert.strictEqual(servidor.guardados.length, 1);
    const idOriginal = "L-0001";
    const ed = app.document.querySelector("button.edit");
    assert.ok(ed, "la liberación recién subida se puede editar");
    await app.click(ed);
    assert.strictEqual(app.get("state.editando.id"), idOriginal);
    assert.match(texto(app), /Editando la liberación L-0001/);
    assert.strictEqual(app.computeTexto(), original, "el formulario trae lo mismo que se subió");
    assert.ok(hayBoton(app, "💾 Guardar cambios") && hayBoton(app, "Cancelar edición"));
    assert.ok(!hayBoton(app, "⬆ Subir liberación"), "no se puede subir como nueva");
    // se corrige el supervisor
    const otro = app.get("cfg.supervisores.filter(function(x){ return x!==state.form.supervisor; })[0]");
    app.run("state.form.supervisor = " + JSON.stringify(otro) + "; render();");
    const nuevoTexto = app.computeTexto();
    assert.notStrictEqual(nuevoTexto, original);
    await app.clickTexto("💾 Guardar cambios");
    assert.strictEqual(servidor.ediciones.length, 1);
    assert.strictEqual(servidor.ediciones[0].id, idOriginal);
    assert.strictEqual(servidor.ediciones[0].texto, nuevoTexto);
    assert.ok(Array.isArray(servidor.ediciones[0].campos) && servidor.ediciones[0].campos.length >= 3);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(servidor.ediciones[0].fecha) && /^(DÍA|NOCHE)$/.test(servidor.ediciones[0].turno));
    assert.strictEqual(servidor.guardados.length, 1, "no se creó otra liberación");
    assert.strictEqual(servidor.contarAcciones("addLib"), 1);
    assert.strictEqual(app.get("state.editando"), null);
    assert.match(texto(app), /Liberación L-0001 actualizada/);
    assert.strictEqual(app.get("recientes.items[0].texto"), nuevoTexto, "la lista de recientes muestra lo corregido");
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("editar: se puede cambiar el turno y el día, cancelar sin guardar, y un error del servidor no pierde lo escrito", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });
  try {
    await subirUna(app);
    await app.click(app.document.querySelector("button.edit"));
    const t0 = app.get("state.editando.turno"), f0 = app.get("state.editando.fecha");
    await app.click(app.document.querySelector("button.turno"));
    assert.notStrictEqual(app.get("state.editando.turno"), t0);
    assert.strictEqual(app.get("state.editando.fecha"), f0, "cambiar el turno no mueve el día al editar");
    // sin señal: avisa y conserva el formulario
    servidor.modo = "caida";
    await app.clickTexto("💾 Guardar cambios");
    assert.match(texto(app), /No se pudo guardar/);
    assert.ok(app.get("state.editando"), "sigue editando");
    assert.ok(app.computeTexto());
    // vuelve la señal y se guarda
    servidor.modo = "ok";
    await app.clickTexto("💾 Guardar cambios");
    assert.strictEqual(servidor.ediciones.length, 1);
    assert.notStrictEqual(servidor.ediciones[0].turno, t0);
    assert.strictEqual(servidor.guardados[0].turno, servidor.ediciones[0].turno);
    // cancelar no envía nada
    app.run("state.tipo=''; render();");
    await app.click(app.document.querySelector("button.edit"));
    await app.clickTexto("Cancelar edición");
    assert.strictEqual(app.get("state.editando"), null);
    assert.strictEqual(servidor.ediciones.length, 1);
    assert.ok(hayBoton(app, "PAD 2F"));
  } finally { app.cerrar(); }
});

test("editar: quien solo registra no puede editar lo de otra persona (el servidor responde «permiso» y la app lo refleja)", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios.push(Object.assign({}, BETO));
  servidor.guardados.push({ uid: "u1", fecha: "2026-11-13", turno: "DÍA", texto: "TIPO DE LIBERACIÓN: X\nESTRUCTURA: PAD 2F\nSUPERVISOR CQC: A", form: "", porId: "ana", porNombre: "Ana" });
  const app = await cargarApp({ servidor, usuario: BETO });
  try {
    const r = await app.run("api('editLib',{id:'L-0001',texto:'X'}).then(function(){return 'ok';},function(e){return e.acceso;})");
    await app.vaciar();
    assert.strictEqual(servidor.ediciones.length, 0);
    assert.ok(r);
  } finally { app.cerrar(); }
});

// ── administración de usuarios (solo admin) ──────────────────────
test("admin: Mi perfil muestra «Gestionar usuarios»; lista a todos; cambia roles y da de baja o reactiva", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios[0].rol = "admin";
  servidor.usuarios.push(Object.assign({}, BETO));
  const app = await cargarApp({ servidor, usuario: servidor.usuarios[0] });
  try {
    await app.run("abrirPerfil()"); await app.vaciar();
    await app.clickTexto("Gestionar usuarios ›");
    assert.strictEqual(app.get("state.view"), "usuarios");
    assert.match(texto(app), /2 personas/);
    assert.match(texto(app), /Beto Registro/);
    assert.match(texto(app), /Ana \(tú\)/);
    const tarjetas = Array.from(app.document.querySelectorAll(".uc"));
    assert.strictEqual(tarjetas.length, 2);
    assert.strictEqual(tarjetas[0].querySelectorAll("button, select").length, 0, "sobre sí mismo no hay acciones");
    // rol
    const sel = tarjetas[1].querySelector("select");
    sel.value = "editor";
    sel.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    await app.vaciar();
    assert.strictEqual(servidor.usuarios[1].rol, "editor");
    assert.match(texto(app), /Rol de Beto Registro: Editor/);
    // baja y reactivar
    await app.clickTexto("Dar de baja");
    assert.strictEqual(servidor.usuarios[1].estado, "BAJA");
    assert.match(texto(app), /De baja/);
    await app.clickTexto("Reactivar");
    assert.strictEqual(servidor.usuarios[1].estado, "ACTIVO");
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("admin: restablecer código muestra el código temporal; la persona debe elegir uno nuevo antes de entrar", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios[0].rol = "admin";
  servidor.usuarios.push(Object.assign({}, BETO));
  const admin = await cargarApp({ servidor, usuario: servidor.usuarios[0] });
  try {
    await admin.run("abrirUsuarios()"); await admin.vaciar();
    await admin.clickTexto("Restablecer código");
    assert.match(texto(admin), /Código temporal de Beto Registro/);
    assert.match(texto(admin), /TEMP2345/);
    assert.strictEqual(servidor.usuarios[1].cambiar, true);
  } finally { admin.cerrar(); }
  const beto = await sinSesion({ servidor });
  try {
    await beto.app.clickTexto("Ya tengo cuenta");
    await llenar(beto.app, { usuario: "beto", codigo: "TEMP2345" });
    await beto.app.clickTexto("Ingresar");
    assert.strictEqual(beto.app.get("sesion.cambiar"), true);
    assert.strictEqual(beto.app.get("activo()"), false, "no entra hasta elegir su código");
    assert.match(texto(beto.app), /Elige tu código nuevo/);
    assert.ok(!hayBoton(beto.app, "PAD 2F"));
    await llenar(beto.app, { nuevo: "mi-propio-codigo", nuevo2: "mi-propio-codigo" });
    await beto.app.clickTexto("Guardar y entrar");
    assert.strictEqual(beto.app.get("activo()"), true);
    assert.strictEqual(beto.app.get("sesion.cambiar"), false);
    assert.strictEqual(servidor.usuarios[1].codigo, "mi-propio-codigo");
    assert.ok(hayBoton(beto.app, "PAD 2F"));
    assert.deepStrictEqual(beto.app.errores, []);
  } finally { beto.app.cerrar(); }
});

test("admin: borrar una cuenta pide confirmación y la quita; si cancela no hace nada", async () => {
  const servidor = crearServidorMock();
  servidor.usuarios[0].rol = "admin";
  servidor.usuarios.push(Object.assign({}, BETO));
  const app = await cargarApp({ servidor, usuario: servidor.usuarios[0], confirmar: false });
  try {
    await app.run("abrirUsuarios()"); await app.vaciar();
    await app.clickTexto("Borrar");
    assert.ok(app.confirmaciones.some((c) => /Borrar la cuenta de Beto Registro/.test(c)));
    assert.strictEqual(servidor.usuarios.length, 2, "al cancelar no se borra");
    app.run("window.confirm = function(){ return true; };");
    await app.clickTexto("Borrar");
    assert.strictEqual(servidor.usuarios.length, 1);
    assert.match(texto(app), /Cuenta de Beto Registro borrada/);
    assert.match(texto(app), /1 persona\b/);
  } finally { app.cerrar(); }
});

test("quien no es admin no ve la administración, y si el servidor niega el permiso la app no se rompe", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor });   // Ana: editor
  try {
    await app.run("abrirPerfil()"); await app.vaciar();
    assert.ok(!hayBoton(app, "Gestionar usuarios ›"));
    await app.run("abrirUsuarios()"); await app.vaciar();
    assert.match(texto(app), /No tienes permiso/);
    assert.deepStrictEqual(app.errores, []);
  } finally { app.cerrar(); }
});

test("Menú «Configuración» › Cerrar sesión: pide confirmar y vuelve a la pantalla de ingreso", async () => {
  const servidor = crearServidorMock();
  const app = await cargarApp({ servidor, usuario: servidor.usuarios[0] });
  try {
    await app.click(app.botones("⚙ Configuración ▾")[0]);
    await app.clickTexto("Cerrar sesión");
    assert.ok(app.confirmaciones.length > 0, "pide confirmación");
    assert.strictEqual(app.get("sesion"), null);
    assert.strictEqual(app.get("necesitaAcceso()"), true);
  } finally { app.cerrar(); }
});
