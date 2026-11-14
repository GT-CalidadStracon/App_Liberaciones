"use strict";
/* Arnés de pruebas: carga index.html en jsdom con
 *   - localStorage persistente en memoria (se puede reutilizar para simular "cerrar y abrir la app"),
 *   - reloj falso (Date, setTimeout, setInterval) que solo avanza cuando la prueba lo manda,
 *   - fetch controlable (servidor simulado con el contrato del Apps Script, ver tools/mock_server.py),
 *   - indexedDB ausente / presente / bloqueado,
 *   - stubs de canvas, Image, URL.createObjectURL, alert/confirm, scrollTo.
 * Las variables globales del <script> inline (state, cfg, SCHEMAS, cola…) se leen con app.get()/app.json()/app.run().
 */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole, requestInterceptor } = require("jsdom");

const RAIZ = path.resolve(__dirname, "..", "..");
const URL_BASE = "http://localhost/index.html";

/* ───────────── generador pseudoaleatorio con semilla (mulberry32) ───────────── */
function crearRng(semilla) {
  let a = (semilla >>> 0) || 1;
  const rng = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => min + Math.floor(rng() * (max - min + 1)); // ambos incluidos
  rng.elegir = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.prob = (p) => rng() < p;
  return rng;
}

/* ───────────── almacenamiento en memoria (API de Storage) ───────────── */
class MemoriaStorage {
  constructor(inicial) {
    this._m = new Map(Object.entries(inicial || {}));
    this.fallarEscritura = null; // (clave, valor) => true para simular "sin espacio"
  }
  get length() { return this._m.size; }
  key(i) { return Array.from(this._m.keys())[i] ?? null; }
  getItem(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
  setItem(k, v) {
    if (this.fallarEscritura && this.fallarEscritura(String(k), String(v))) {
      const e = new Error("The quota has been exceeded.");
      e.name = "QuotaExceededError";
      throw e;
    }
    this._m.set(String(k), String(v));
  }
  removeItem(k) { this._m.delete(String(k)); }
  clear() { this._m.clear(); }
  /* ayuda de pruebas */
  json(k, def) { const v = this.getItem(k); try { return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
}

/** Todo lo que sobrevive a "cerrar y volver a abrir" la app. */
function nuevaPersistencia(inicial) {
  let idb = null;
  return {
    ls: new MemoriaStorage(inicial),
    get idb() {
      if (!idb) { const { IDBFactory } = require("fake-indexeddb"); idb = new IDBFactory(); }
      return idb;
    },
  };
}

/* ───────────── reloj falso ───────────── */
function crearReloj(inicioMs, errores) {
  let ahora = inicioMs;
  let seq = 1;
  const timers = new Map();
  const vaciar = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
  const reloj = {
    get ahora() { return ahora; },
    fijar(ms) { ahora = typeof ms === "string" ? Date.parse(ms) : ms; },
    setTimeout(fn, ms, ...args) { const id = seq++; timers.set(id, { id, at: ahora + Math.max(0, +ms || 0), fn, args, cada: 0 }); return id; },
    setInterval(fn, ms, ...args) { const id = seq++; const c = Math.max(1, +ms || 1); timers.set(id, { id, at: ahora + c, fn, args, cada: c }); return id; },
    clear(id) { timers.delete(id); },
    pendientes() { return Array.from(timers.values()).map((t) => ({ id: t.id, en: t.at - ahora, cada: t.cada })); },
    vaciar,
    /** Avanza el tiempo ms milisegundos ejecutando los temporizadores que venzan, en orden. */
    async avanzar(ms) {
      const meta = ahora + ms;
      for (let guarda = 0; guarda < 10000; guarda++) {
        let sig = null;
        for (const t of timers.values()) if (t.at <= meta && (!sig || t.at < sig.at || (t.at === sig.at && t.id < sig.id))) sig = t;
        if (!sig) break;
        ahora = Math.max(ahora, sig.at);
        if (sig.cada) sig.at += sig.cada; else timers.delete(sig.id);
        try { sig.fn(...sig.args); } catch (e) { errores.push(e); }
        await vaciar();
      }
      ahora = meta;
      await vaciar();
    },
  };
  return reloj;
}

/* ───────────── servidor simulado (contrato del Apps Script) ─────────────
 * modos:
 *   ok       responde bien; addLib deduplica por uid
 *   error    responde {ok:false,error:"Hoja bloqueada"} (error de servidor; no guarda)
 *   caida    fetch rechaza (sin red)
 *   perdida  guarda la liberación pero la respuesta se pierde (equivale a perder la señal tras guardar)
 *   lenta    nunca responde (solo termina cuando la app aborta por timeout)
 *   http500  responde HTTP 500
 */
function crearServidorMock(opciones) {
  const o = Object.assign({ url: "https://mock.test/exec", clave: "KEY-TEST" }, opciones || {});   // clave = clave de invitación
  const s = {
    url: o.url, clave: o.clave, modo: "ok", version: 3, config: null,
    rechazarUids: new Set(), // addLib con estos uid responde {ok:false} (error de servidor) aunque el modo sea ok
    usuarios: [{ nombre: "Ana", usuario: "ana", codigo: "codigo-ana", rol: "editor", estado: "ACTIVO" }],
    peticiones: [],   // todas las peticiones (cualquier acción)
    recibidos: [],    // cada addLib recibido (incluye repetidos): {uid,modo,body}
    guardados: [],    // liberaciones guardadas (únicas por uid)
    abortados: 0,
    ediciones: [],    // cada editLib recibido
    contarAcciones(a) { return s.peticiones.filter((p) => p.body.action === a).length; },
    /** uid → cuántas veces llegó */
    vecesPorUid() { const m = {}; s.recibidos.forEach((r) => { m[r.uid] = (m[r.uid] || 0) + 1; }); return m; },
  };
  const pad = (n) => ("000" + n).slice(-4);
  s.fetch = function (url, init) {
    return new Promise((resolve, reject) => {
      let body;
      try { body = JSON.parse(init && init.body); } catch (e) { return reject(new TypeError("cuerpo no es JSON")); }
      s.peticiones.push({ url, body, init });
      const responder = (obj, status) => resolve({
        ok: (status || 200) < 400, status: status || 200,
        json: () => Promise.resolve(JSON.parse(JSON.stringify(obj))),
      });
      const modo = s.modo;
      if (modo === "caida") return reject(new TypeError("Failed to fetch"));
      if (modo === "lenta") {
        const sig = init && init.signal;
        if (sig) {
          const abortar = () => { if (body.action === "addLib") s.abortados++; const e = new Error("The operation was aborted."); e.name = "AbortError"; reject(e); };
          if (sig.aborted) abortar(); else sig.addEventListener("abort", abortar);
        }
        return; // nunca responde
      }
      if (modo === "http500") return responder({ ok: false }, 500);
      // sesión: ping / registrar / login son públicos; lo demás exige un usuario ACTIVO
      const idDe = (x) => x.usuario || x.nombre;
      const norm = (t) => String(t == null ? "" : t).trim().toLowerCase();
      const u = s.usuarios.find((x) => norm(idDe(x)) === norm(body.usuario) && x.codigo === String(body.codigo || "").trim());
      if (body.action === "registrar") {
        if (body.key !== s.clave) return responder({ ok: false, error: "Clave de invitación incorrecta" });
        if (s.usuarios.some((x) => norm(idDe(x)) === norm(body.usuario))) return responder({ ok: false, error: "Ese usuario ya existe. Elige otro." });
        if (s.usuarios.some((x) => norm(x.nombre) === norm(body.nombre))) return responder({ ok: false, error: "Ya existe una persona con ese nombre. Agrega tu segundo nombre o apellido." });
        const estado = s.exigirAprobacion ? "PENDIENTE" : "ACTIVO";   // con la clave de invitación entra de inmediato
        const nu = { nombre: String(body.nombre).trim(), usuario: norm(body.usuario), codigo: String(body.codigo).trim(), rol: "registro", estado };
        s.usuarios.push(nu);
        return responder({ ok: true, nombre: nu.nombre, usuario: nu.usuario, estado, rol: "registro" });
      }
      const ROL = { registro: 1, editor: 2, admin: 3 };
      const minimo = { delLib: 2, saveConfig: 2, listUsuarios: 3, setUsuario: 3, delUsuario: 3, resetCodigo: 3 };
      if (body.action !== "ping") {
        if (!u) return responder({ ok: false, error: "Usuario o código incorrecto", acceso: "invalido" });
        if (body.action === "login") return responder({ ok: true, nombre: u.nombre, usuario: u.usuario || "", estado: u.estado, rol: u.rol, cambiar: !!u.cambiar });
        if (u.estado === "PENDIENTE") return responder({ ok: false, error: "Tu solicitud todavía no fue aprobada.", acceso: "pendiente" });
        if (u.estado === "BAJA") return responder({ ok: false, error: "Tu acceso fue dado de baja.", acceso: "baja" });
        if (u.cambiar && body.action !== "cambiarCodigo") return responder({ ok: false, error: "Debes elegir un código nuevo antes de continuar.", acceso: "cambiar" });
        if ((minimo[body.action] || 1) > ROL[u.rol]) return responder({ ok: false, error: "No tienes permiso para esta acción", acceso: "permiso" });
      }
      const idLib = (g) => "L-" + pad(s.guardados.indexOf(g) + 1);
      const itemDe = (g) => {
        const o = { id: idLib(g), fecha: g.fecha, hora: "10:00", texto: g.texto, turno: g.turno, form: g.form, foto: g.fotoUrl || "",
          por: g.porNombre || "", porUsuario: g.porId || "", propia: !!(u && g.porId === idDe(u)), editadoPor: g.editadoPor || "" };
        return o;
      };
      switch (body.action) {
        case "ping": return responder({ ok: true });
        case "getConfig": return responder(s.config ? { ok: true, config: s.config, version: s.version, fecha: "2026-11-12T10:30:00-05:00", por: "Luis Editor" } : { ok: true });
        case "addLib": {
          s.recibidos.push({ uid: body.uid, modo, body });
          if (modo === "error" || s.rechazarUids.has(body.uid)) return responder({ ok: false, error: "Hoja bloqueada" });
          let i = s.guardados.findIndex((g) => g.uid === body.uid);
          if (i < 0) { body.porNombre = u.nombre; body.porId = idDe(u); if (body.foto) body.fotoUrl = "https://drive.google.com/file/d/foto" + (s.guardados.length + 1) + "/view"; s.guardados.push(body); i = s.guardados.length - 1; }
          if (modo === "perdida") return reject(new TypeError("Failed to fetch"));
          return responder({ ok: true, id: "L-" + pad(i + 1), foto: s.guardados[i].fotoUrl || "" });
        }
        case "listLibs": return responder({ ok: true, hoja: "", items: s.guardados.filter((g) => !body.fecha || g.fecha === body.fecha).map((g) => {
          const o = itemDe(g);
          if (body.fotos && g.foto) o.fotoData = g.foto.data;
          return o;
        }) });
        case "ultimasLibs": return responder({ ok: true, items: s.guardados.slice(-(body.n || 3)).reverse().map(itemDe) });
        case "searchLibs": return responder({ ok: true, items: [] });
        case "editLib": {
          const g = s.guardados.find((x) => idLib(x) === body.id);
          if (!g) return responder({ ok: false, error: "Esa liberación ya no existe (alguien la borró)." });
          if (ROL[u.rol] < 2 && g.porId !== idDe(u)) return responder({ ok: false, error: "Solo puedes editar las liberaciones que registraste tú.", acceso: "permiso" });
          s.ediciones.push(body);
          g.texto = body.texto; if (body.form != null) g.form = body.form;
          if (body.turno) g.turno = body.turno; if (body.fecha) g.fecha = body.fecha;
          if (body.foto) { g.foto = body.foto; g.fotoUrl = "https://drive.google.com/file/d/nueva" + s.ediciones.length + "/view"; }
          else if (body.quitarFoto) { g.foto = null; g.fotoUrl = ""; }
          g.editadoPor = u.nombre;
          return responder({ ok: true, id: body.id, item: itemDe(g) });
        }
        case "cambiarCodigo": {
          const n = String(body.nuevoCodigo || "").trim();
          if (n.length < 6) return responder({ ok: false, error: "El código debe tener entre 6 y 40 caracteres." });
          if (n === u.codigo) return responder({ ok: false, error: "Elige un código distinto al actual." });
          u.codigo = n; u.cambiar = false;
          return responder({ ok: true });
        }
        case "actualizarPerfil": {
          const nombre = body.nombre ? String(body.nombre).trim() : u.nombre, nuevoU = body.nuevoUsuario ? norm(body.nuevoUsuario) : (u.usuario || "");
          if (nuevoU && s.usuarios.some((x) => x !== u && norm(idDe(x)) === nuevoU)) return responder({ ok: false, error: "Ese usuario ya existe. Elige otro." });
          if (s.usuarios.some((x) => x !== u && norm(x.nombre) === norm(nombre))) return responder({ ok: false, error: "Ya existe una persona con ese nombre." });
          const antes = idDe(u); u.nombre = nombre; u.usuario = nuevoU;
          s.guardados.forEach((g) => { if (g.porId === antes) { g.porId = idDe(u); g.porNombre = u.nombre; } });
          return responder({ ok: true, nombre: u.nombre, usuario: u.usuario });
        }
        case "listUsuarios": return responder({ ok: true, items: s.usuarios.map((x) => ({ nombre: x.nombre, usuario: x.usuario || "", id: idDe(x), estado: x.estado, rol: x.rol, alta: "2026-11-01T08:00:00-05:00", cambiar: !!x.cambiar })) });
        case "setUsuario": {
          const t = s.usuarios.find((x) => norm(idDe(x)) === norm(body.objetivo));
          if (!t) return responder({ ok: false, error: "No se encontró a esa persona." });
          if (t === u) return responder({ ok: false, error: "No puedes cambiar tu propio rol ni darte de baja.", acceso: "permiso" });
          if (body.rol) t.rol = body.rol; if (body.estado) t.estado = body.estado;
          return responder({ ok: true, usuario: idDe(t), estado: t.estado, rol: t.rol });
        }
        case "delUsuario": {
          const t = s.usuarios.find((x) => norm(idDe(x)) === norm(body.objetivo));
          if (!t) return responder({ ok: true, yaNoExistia: true });
          if (t === u) return responder({ ok: false, error: "No puedes borrar tu propia cuenta.", acceso: "permiso" });
          s.usuarios.splice(s.usuarios.indexOf(t), 1);
          return responder({ ok: true });
        }
        case "resetCodigo": {
          const t = s.usuarios.find((x) => norm(idDe(x)) === norm(body.objetivo));
          if (!t) return responder({ ok: false, error: "No se encontró a esa persona." });
          t.codigo = "TEMP2345"; t.cambiar = true;
          return responder({ ok: true, temporal: "TEMP2345", nombre: t.nombre, usuario: idDe(t) });
        }
        default: return responder({ ok: false, error: "acción desconocida" });
      }
    });
  };
  return s;
}

/* ───────────── carga de la app ───────────── */
const TIPOS_MIME = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
/* Sirve los archivos del repo (turno.js, etc.) para http://localhost/…; todo lo demás se bloquea (404). */
const interceptorLocal = requestInterceptor((request) => {
  const u = new URL(request.url);
  if (u.hostname === "localhost") {
    // servidor.js trae la URL real: en las pruebas la app arranca sin servidor salvo que la prueba lo pida
    if (u.pathname.endsWith("/servidor.js")) return new Response("", { headers: { "Content-Type": "application/javascript" } });
    const f = path.join(RAIZ, decodeURIComponent(u.pathname));
    if (f.startsWith(RAIZ) && fs.existsSync(f) && fs.statSync(f).isFile())
      return new Response(fs.readFileSync(f), { headers: { "Content-Type": TIPOS_MIME[path.extname(f)] || "application/octet-stream" } });
  }
  return new Response("bloqueado en pruebas", { status: 404 });
});

const GLOBALES_CONTRATO = {
  // nombre → tipo esperado (el arnés y las pruebas dependen de estos nombres del script inline)
  state: "object", cfg: "object", SCHEMAS: "object", cola: "object", prefs: "object", progUI: "object",
  defaultConfig: "function", sanitizeCfg: "function", validateCfg: "function",
  computeTexto: "function", buildCtx: "function", derive: "function", visibilidad: "function", validForm: "function",
  setField: "function", resetForm: "function", render: "function", getFrente: "function", getMat: "function", matsFrente: "function",
  cotaParaCapa: "function", espesorDeCapa: "function", progLongitud: "function", evalFormula: "function", numFilter: "function",
  newId: "function", procesarCola: "function", reintentarCola: "function", guardarCola: "function", enviarItem: "function",
  subirLiberacion: "function", conectado: "function", api: "function", syncConfig: "function",
  TIPO_KEYS: "object", LINEAS: "object", INITIAL_FORM: "object",
};

/**
 * opciones:
 *   persistencia   objeto de nuevaPersistencia() (para "reabrir" la app); por defecto uno nuevo
 *   storage        {clave: valor} iniciales de localStorage (si no se pasa persistencia)
 *   servidor       objeto de crearServidorMock(); si se da, fetch lo usa y la app se conecta sola
 *   conectar       false para NO pre-conectar aunque haya servidor
 *   ahora          instante inicial (ms, ISO con zona, o Date). Por defecto 2026-11-13 10:00 Lima (15:00 UTC)
 *   indexedDB      "ausente" (por defecto) | "presente" (fake-indexeddb) | "bloqueado" (lanza SecurityError)
 *   hash           "#conectar=..." u otro hash inicial
 *   semilla        semilla de Math.random de la página (determinismo de newId)
 *   confirmar      valor que devuelve window.confirm (true por defecto)
 */
async function cargarApp(opciones) {
  const op = Object.assign({ indexedDB: "ausente", semilla: 12345, confirmar: true }, opciones || {});
  const persistencia = op.persistencia || nuevaPersistencia(op.storage);
  const ls = persistencia.ls;
  const servidor = op.servidor || null;
  if (servidor && op.conectar !== false && ls.getItem("genlib.conn.v1") == null)
    { ls.setItem("genlib.conn.v1", JSON.stringify({ url: servidor.url }));
      const us = op.usuario === undefined ? servidor.usuarios[0] : op.usuario;   // op.usuario:null = sin sesión
      if (us) ls.setItem("genlib.user.v1", JSON.stringify({ nombre: us.nombre, usuario: us.usuario || "", acceso: us.usuario || us.nombre, codigo: us.codigo, rol: us.rol, estado: us.estado, cambiar: !!us.cambiar })); }

  const errores = [];   // errores reales de JS de la página
  const avisos = [];    // "Not implemented" de jsdom y similares
  const consola = { log: [], warn: [], error: [] };
  const alertas = [];
  const confirmaciones = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { (e && /^(not[ -]implemented|css-parsing)$/.test(e.type) ? avisos : errores).push(e); });
  vc.on("error", (...a) => consola.error.push(a.join(" ")));
  vc.on("warn", (...a) => consola.warn.push(a.join(" ")));
  vc.on("log", (...a) => consola.log.push(a.join(" ")));

  let inicio = op.ahora == null ? Date.parse("2026-11-13T10:00:00-05:00") : (op.ahora instanceof Date ? op.ahora.getTime() : (typeof op.ahora === "string" ? Date.parse(op.ahora) : op.ahora));
  if (!Number.isFinite(inicio)) throw new Error("cargarApp: 'ahora' inválido");
  const reloj = crearReloj(inicio, errores);
  const rng = crearRng(op.semilla);

  const html = fs.readFileSync(path.join(RAIZ, op.html || process.env.APP_HTML || "index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: URL_BASE + (op.hash || ""),
    runScripts: "dangerously",
    resources: { interceptors: [interceptorLocal] },
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // reloj
      window.eval(`(function(getNow){
        var RD = Date;
        function FD(){
          if(!(this instanceof FD)) return new RD(getNow()).toString();
          var a = [].slice.call(arguments);
          if(!a.length) return new RD(getNow());
          return new (Function.prototype.bind.apply(RD,[null].concat(a)))();
        }
        FD.prototype = RD.prototype; FD.now = function(){ return getNow(); };
        FD.UTC = RD.UTC; FD.parse = RD.parse;
        window.Date = FD;
      })`)(() => reloj.ahora);
      window.setTimeout = (fn, ms, ...a) => reloj.setTimeout(fn, ms, ...a);
      window.setInterval = (fn, ms, ...a) => reloj.setInterval(fn, ms, ...a);
      window.clearTimeout = (id) => reloj.clear(id);
      window.clearInterval = (id) => reloj.clear(id);
      window.Math.random = () => rng();
      // almacenamiento
      Object.defineProperty(window, "localStorage", { configurable: true, get: () => ls });
      // indexedDB
      if (op.indexedDB === "presente") {
        const f = require("fake-indexeddb");
        window.indexedDB = persistencia.idb;
        ["IDBKeyRange", "IDBRequest", "IDBOpenDBRequest", "IDBDatabase", "IDBTransaction", "IDBObjectStore", "IDBIndex", "IDBCursor", "IDBCursorWithValue", "IDBFactory", "IDBVersionChangeEvent"]
          .forEach((k) => { window[k] = f[k]; });
      } else if (op.indexedDB === "bloqueado") {
        Object.defineProperty(window, "indexedDB", { configurable: true, get() { const e = new Error("The operation is insecure."); e.name = "SecurityError"; throw e; } });
      } else if ("indexedDB" in window) {
        try { delete window.indexedDB; } catch (e) { /* ya ausente */ }
      }
      // red
      window.fetch = servidor ? (u, i) => servidor.fetch(u, i) : () => Promise.reject(new TypeError("Failed to fetch"));
      // diálogos y utilidades que jsdom no implementa
      window.alert = (m) => { alertas.push(String(m)); };
      window.confirm = (m) => { confirmaciones.push(String(m)); return !!op.confirmar; };
      window.prompt = () => null;
      window.scrollTo = () => {};
      window.HTMLCanvasElement.prototype.getContext = function () { return { drawImage() {} }; };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/jpeg;base64,AAAABBBBCCCCDDDD"; };
      window.URL.createObjectURL = () => "blob:prueba/1";
      window.URL.revokeObjectURL = () => {};
      window.Image = class { set src(v) { this._s = v; setImmediate(() => { this.naturalWidth = 800; this.naturalHeight = 600; this.onload && this.onload(); }); } get src() { return this._s; } };
      window.document.execCommand = () => true;
    },
  });
  const { window } = dom;
  const { document } = window;
  await new Promise((res) => { if (document.readyState === "complete") res(); else window.addEventListener("load", () => res()); });
  await reloj.vaciar();

  const app = {
    window, document, reloj, servidor, persistencia, ls, errores, avisos, consola, alertas, confirmaciones, rng,
    /** Ejecuta código en el contexto de la página (acceso a las variables globales del script). */
    run(codigo) { return window.eval(codigo); },
    /** Valor de una expresión de la página (objetos del "realm" de la página). */
    get(expr) { return window.eval(expr); },
    /** Valor de una expresión como objeto plano de Node (apto para assert.deepStrictEqual). */
    json(expr) { const v = window.eval("JSON.stringify((" + expr + "))"); return v === undefined ? undefined : JSON.parse(v); },
    get state() { return window.eval("state"); },
    get cfg() { return window.eval("cfg"); },
    get SCHEMAS() { return window.eval("SCHEMAS"); },
    get cola() { return window.eval("cola"); },
    computeTexto() { return window.eval("computeTexto()"); },
    /** Lo que ve el usuario en la caja "Texto Generado" (null si no hay). */
    textoPantalla() { const p = document.querySelector("#outbox pre"); return p ? p.textContent : null; },
    colaGuardada() { return ls.json("genlib.cola.v1", null); },
    vaciar: () => reloj.vaciar(),
    avanzar: (ms) => reloj.avanzar(ms),
    /* DOM */
    botones(texto, raiz) {
      const r = raiz || document;
      return Array.from(r.querySelectorAll("button")).filter((b) => (texto instanceof RegExp ? texto.test(b.textContent.trim()) : b.textContent.trim() === texto));
    },
    async click(nodo) { nodo.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); await reloj.vaciar(); },
    async clickTexto(texto, raiz) {
      const b = app.botones(texto, raiz)[0];
      if (!b) throw new Error("No hay botón con texto " + texto + ". Botones: " + app.botones(/./).map((x) => x.textContent.trim()).join(" | "));
      await app.click(b);
    },
    async escribir(input, valor) {
      input.value = valor;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await reloj.vaciar();
    },
    async elegirFrente(id) {
      const fr = app.json("getFrente(" + JSON.stringify(id) + ")");
      if (!fr) throw new Error("No existe el frente " + id);
      await app.clickTexto(fr.corto || fr.nombre);
    },
    async elegirTipo(clave) {
      const corto = app.get("cfg.tipos[" + JSON.stringify(clave) + "].corto");
      await app.clickTexto(corto, document.querySelector("#app .card"));
    },
    /** Nueva liberación en el mismo frente/tipo (equivale a resetForm + render). */
    nuevaLiberacion() { window.eval("resetForm(); render();"); },
    /** Dispara un evento del window (p.ej. "online"). */
    async disparar(tipo) { window.dispatchEvent(new window.Event(tipo)); await reloj.vaciar(); },
    /** Pulsa "Subir liberación"/"Reintentar" y, si aparece, confirma el cuadro de turno ("Sí, registrar"). */
    async subir() {
      const b = app.botones(/Subir liberación|Reintentar/, document.getElementById("outbox"))[0];
      if (!b) throw new Error("No hay botón de subir en pantalla");
      await app.click(b);
      const ov = document.getElementById("ovTurno");
      if (ov) await app.clickTexto(/^Sí, registrar$/, ov);
      await reloj.vaciar();
    },
    /** Adjunta una foto simulada por la entrada de galería. */
    async adjuntarFoto() {
      window.eval('abrirFoto("inGal")');
      const inp = document.getElementById("inGal");
      Object.defineProperty(inp, "files", { configurable: true, value: [new window.File([new Uint8Array([1, 2, 3])], "f.jpg", { type: "image/jpeg" })] });
      inp.dispatchEvent(new window.Event("change", { bubbles: true }));
      await reloj.vaciar();
      await reloj.vaciar();
    },
    /** Verifica que existan las globales que el arnés necesita; devuelve la lista de problemas. */
    problemasContrato() {
      const malos = [];
      Object.keys(GLOBALES_CONTRATO).forEach((n) => {
        let t;
        try { t = window.eval("typeof " + n); } catch (e) { t = "error"; }
        if (t !== GLOBALES_CONTRATO[n]) malos.push(`${n}: se esperaba ${GLOBALES_CONTRATO[n]} y es ${t}`);
      });
      return malos;
    },
    cerrar() { try { window.close(); } catch (e) { /* nada */ } },
    /** Cierra esta instancia y abre otra con la misma persistencia (y mismo servidor/reloj). */
    async reabrir(extra) {
      app.cerrar();
      return cargarApp(Object.assign({}, op, { persistencia, servidor, ahora: reloj.ahora, semilla: op.semilla + 1 }, extra || {}));
    },
  };
  return app;
}

module.exports = { cargarApp, crearServidorMock, nuevaPersistencia, crearRng, MemoriaStorage, RAIZ, GLOBALES_CONTRATO };
