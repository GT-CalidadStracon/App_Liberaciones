"use strict";
/* Simula a una persona llenando el formulario a través del DOM (clics en botones y escritura en inputs
 * con eventos "input" reales), siguiendo la lógica de visibilidad/validación de la app:
 *   visibilidad(schema,ctx) · validForm · setField · optsCtl · textCtl · progresivaCtl · numFilter.
 * Devuelve el texto que genera computeTexto() cuando el formulario queda completo.
 */
const assert = require("node:assert");

/* Foto de los campos del esquema actual, calculada dentro de la página (usa las funciones reales de la app). */
const JS_CAMPOS = `JSON.stringify((function(){
  var schema = SCHEMAS[state.tipo], ctx = buildCtx(), vis = visibilidad(schema,ctx), out = [];
  schema.fields.forEach(function(f,i){
    var o = {i:i,id:f.id,type:f.type,vis:!!vis[i]};
    if(vis[i]){
      o.info = f.type==="info" || !!(f.info && f.info(ctx));
      o.req = f.required ? !!f.required(ctx) : true;
      o.valid = (typeof campoValido==="function") ? !!campoValido(f,ctx) : (f.valid ? !!f.valid(ctx) : !!ctx.f[f.id]);
      if(f.type==="select"||f.type==="btns") o.options = (typeof f.options==="function"?f.options(ctx):(f.options||[])).slice();
      o.val = ctx.f[f.id]==null ? "" : ctx.f[f.id];
      o.manual = !!ctx.d.espesorManualNeeded; o.capaFija = !!ctx.d.capaFija;
    }
    out.push(o);
  });
  return out;
})())`;

function campos(app) { return JSON.parse(app.run(JS_CAMPOS)); }

/* primer campo visible, obligatorio e inválido (el que "bloquea" la generación del texto) */
function campoBloqueante(cs) { return cs.find((c) => c.vis && c.req && !c.valid) || null; }

/* la implementación de referencia de numFilter (independiente de la de la app) */
function numFilterRef(v) {
  v = String(v).replace(/[^0-9.]/g, "");
  const i = v.indexOf(".");
  return i === -1 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
}

function controlesDibujados(app) {
  const card = app.document.querySelector("#app > .card");
  return Array.from(card.querySelectorAll(":scope > .fld")).slice(2); // 0 = Frente, 1 = Tipo
}

function numeroAleatorio(rng) {
  const k = rng.int(0, 5);
  if (k === 0) return String(rng.int(1, 40));
  if (k === 1) return String(rng.int(1, 9999)) + "." + String(rng.int(0, 99)).padStart(2, "0");
  if (k === 2) return String(rng.int(1, 300)) + "." + String(rng.int(1, 999));
  if (k === 3) return "abc" + rng.int(1, 99) + ",5"; // ruido: el filtro lo limpia (→ "995" no, → "995"?) se verifica con numFilterRef
  if (k === 4) return rng.int(1, 99) + "." + rng.int(1, 9) + "." + rng.int(1, 9); // dos puntos
  return String(rng.int(1, 3000));
}
const PALABRAS = ["tramo norte", "zona de estribo", "hombro", "dm-001", "nivelante 01", "ñandú sur", "eje 3 / 4", "sector a", "0.3 m", "talud 2:1"];
function textoAleatorio(rng) { return rng.elegir(PALABRAS); }
function progAleatoria(rng) {
  const km = rng.int(0, 2), a = rng.int(0, 899), b = rng.int(a + 10, 990);
  const f = (m) => km + "+" + String(m) + "." + String(rng.int(0, 99)).padStart(2, "0");
  return [f(a), f(b)];
}

/** Escribe un valor en un <input> de la página; devuelve true si el nodo sigue en el DOM. */
async function escribir(app, selector, valor) {
  const inp = app.document.querySelector(selector);
  assert.ok(inp, "no se encontró el input " + selector);
  await app.escribir(inp, valor);
}

/**
 * Actúa sobre UN campo (índice dentro de cs). Devuelve una descripción para la traza.
 * revision=true → es un cambio de opinión sobre un campo ya lleno (evita desmarcar botones).
 */
async function actuar(app, rng, cs, campo, revision) {
  const dibujados = controlesDibujados(app);
  const visiblesConControl = cs.filter((c) => c.vis && !c.info);
  const k = visiblesConControl.findIndex((c) => c.id === campo.id);
  assert.ok(k >= 0, `El campo "${campo.id}" está visible pero no tiene control (¿info?)`);
  const fld = dibujados[k];
  assert.ok(fld, `Falta el control dibujado del campo "${campo.id}" (se esperaban ${visiblesConControl.length} controles y hay ${dibujados.length})`);
  const ctl = fld.children[1];
  const A = app;
  const tipo = campo.type;

  if (tipo === "select" || tipo === "btns" || tipo === "toggle") {
    const opciones = tipo === "toggle" ? ["SÍ", "NO"] : campo.options;
    assert.ok(opciones && opciones.length, `El campo "${campo.id}" bloquea el formulario pero no ofrece opciones`);
    const botones = Array.from(ctl.querySelectorAll("button"));
    assert.strictEqual(botones.length, opciones.length, `Campo "${campo.id}": botones dibujados ≠ opciones`);
    let cand = opciones.map((o, i) => i);
    if (campo.val !== "" && (revision || tipo === "btns" || tipo === "select")) cand = cand.filter((i) => opciones[i] !== campo.val);
    if (!cand.length) return `${campo.id}: sin alternativa`;
    const i = rng.elegir(cand);
    await A.click(botones[i]);
    return `${campo.id}=${opciones[i]}`;
  }
  if (tipo === "progresiva") {
    const [d, h] = progAleatoria(rng);
    await escribir(app, `[data-fk="${campo.id}__d"]`, d);
    await escribir(app, `[data-fk="${campo.id}__h"]`, h);
    const esperado = d + " - " + h;
    assert.strictEqual(app.json("state.form[" + JSON.stringify(campo.id) + "]"), esperado, `Progresiva "${campo.id}" mal guardada`);
    return `${campo.id}=${esperado}`;
  }
  if (tipo === "detalleOpc") {
    const sin = ctl.querySelector("button.sinbtn");
    if (rng.prob(0.4)) { await A.click(sin); return `${campo.id}=SIN DETALLE`; }
    const t = textoAleatorio(rng);
    await escribir(app, `[data-fk="${campo.id}"]`, t);
    assert.strictEqual(app.json("state.form[" + JSON.stringify(campo.id) + "]"), t.toUpperCase());
    return `${campo.id}=${t}`;
  }
  if (tipo === "capa") {
    const boton = ctl.querySelector("button.sinbtn");
    if (!campo.capaFija && rng.prob(0.12)) {
      if (boton.textContent.trim() === "OTRO") await A.click(boton);
      await escribir(app, `[data-fk="${campo.id}"]`, "nivelante 0" + rng.int(1, 9));
      return `${campo.id}=OTRO(texto)`;
    }
    if (boton.textContent.trim() === "N°") await A.click(boton); // volver a número
    const v = String(rng.int(1, 40));
    await escribir(app, `[data-fk="${campo.id}"]`, v);
    return `${campo.id}=${v}`;
  }
  if (tipo === "espesor") {
    const boton = ctl.querySelector("button.sinbtn");
    const inp = ctl.querySelector("input");
    if (!inp || rng.prob(0.15)) {
      if (!(ctl.querySelector(".fijo") && ctl.querySelector(".fijo").textContent === "VARIABLE")) await A.click(boton);
      return `${campo.id}=VARIABLE`;
    }
    const v = rng.elegir(["0.3 m", "0.5 m", "1 m", "0.25 m"]);
    await escribir(app, `[data-fk="${campo.id}"]`, v);
    return `${campo.id}=${v}`;
  }
  // text / number
  const esNum = tipo === "number";
  const crudo = esNum ? numeroAleatorio(rng) : textoAleatorio(rng);
  await escribir(app, `[data-fk="${campo.id}"]`, crudo);
  const guardado = app.json("state.form[" + JSON.stringify(campo.id) + "]");
  const esperado = esNum ? numFilterRef(crudo) : crudo.toUpperCase();
  assert.strictEqual(guardado, esperado, `Campo "${campo.id}": se escribió "${crudo}" y se guardó "${guardado}" (se esperaba "${esperado}")`);
  const inp = app.document.querySelector(`[data-fk="${campo.id}"]`);
  if (inp && esNum) assert.strictEqual(inp.value, esperado, `Campo "${campo.id}": el input no muestra el valor filtrado`);
  return `${campo.id}=${crudo}`;
}

/**
 * Llena el formulario actual hasta que computeTexto() devuelve texto.
 * opciones: {rng, revisiones (máx. cambios de opinión extra), maxPasos, alCambiar(texto|null, traza)}
 */
async function llenarFormulario(app, opc) {
  const { rng } = opc;
  const maxPasos = opc.maxPasos || 120;
  const traza = [];
  const descr = () => `[${app.json("state.estructura")}/${app.json("state.tipo")}] pasos: ${traza.join(" · ")}`;
  let revisionesRestantes = opc.revisiones == null ? rng.int(0, 2) : opc.revisiones;
  let texto = null;
  for (let paso = 0; paso < maxPasos; paso++) {
    const cs = campos(app);
    const bloq = campoBloqueante(cs);
    texto = app.computeTexto();
    if (opc.alCambiar) opc.alCambiar(texto, traza);
    if (!bloq) {
      assert.ok(texto, "El formulario está completo (ningún campo bloquea) pero computeTexto() devolvió null. " + descr());
      if (revisionesRestantes > 0) {
        revisionesRestantes--;
        const candidatos = cs.filter((c) => c.vis && !c.info);
        const c = rng.elegir(candidatos);
        traza.push("↺" + (await actuar(app, rng, cs, c, true)));
        continue;
      }
      return { texto, traza };
    }
    assert.strictEqual(texto, null, "Hay un campo bloqueante (" + bloq.id + ") y aun así computeTexto() devolvió texto. " + descr());
    let objetivo = bloq;
    if (revisionesRestantes > 0 && rng.prob(0.15)) {
      const llenos = cs.filter((c) => c.vis && !c.info && c.i < bloq.i);
      if (llenos.length) { objetivo = rng.elegir(llenos); revisionesRestantes--; }
    }
    try {
      traza.push(await actuar(app, rng, cs, objetivo, objetivo !== bloq));
    } catch (e) {
      e.message += "\n  " + descr();
      throw e;
    }
  }
  assert.fail("El formulario no se completó en " + maxPasos + " pasos. " + descr());
}

module.exports = { llenarFormulario, campos, campoBloqueante, numFilterRef, controlesDibujados };
