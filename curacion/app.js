// ================= Estado de la página =================
let categorias = [];          // [{ category_id, category_name }, ...]
let canales = [];             // [{ stream_id, name, stream_icon, category_id }, ...]
let categoriaElegida = null;  // id de la categoría que se está viendo

// Lo que se muestra en la columna del catálogo (para poder redibujarlo).
let vistaCanales = { lista: [], titulo: "Elegí una categoría" };

// Tus dos listas y las fuentes M3U. Cada ítem:
//   { tipo: "xtream", id: 1021, nombre: "Telefe", respaldos: [5512, 7781] }
//   { tipo: "m3u", fuente: "iptvorg", clave: "Encuentro.ar", nombre: "Encuentro", logo: "…" }
// listas.fuentes: { iptvorg: "https://…/ar.m3u", … } (se publica junto con las listas)
let listas = { simple: [], completa: [], fuentes: {} };

// Canales de las listas M3U ya leídos: [{ fuente, clave, nombre, logo, grupo, url }, ...]
// Viven solo en el navegador; la app de la TV descarga las M3U por su cuenta.
let entradasM3u = [];
let listaActiva = "simple";

// Repetidos: "telefe" -> [canal, canal, ...]. Se calcula al cargar el catálogo.
let grupos = new Map();
// Paneles de respaldos abiertos en tu lista (no se guarda: es solo de la vista).
let panelesAbiertos = new Set();

const NOMBRES_LISTA = { simple: "Simple", completa: "Completa" };
const CLAVE_GUARDADO = "emitv-listas";
const CLAVE_CATALOGO = "emitv-catalogo";
const CLAVE_PENDIENTE = "emitv-pendiente";

// ================= Utilidades =================

// Igual que limpiar() en la app: "✴️ Argentina ✴️" -> "Argentina"
function limpiar(texto) {
  return String(texto ?? "")
    .replace(/[^\p{L}\p{N} +\/.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Los IDs a veces vienen como texto ("194") y a veces como número (194).
function mismoId(a, b) {
  return String(a) === String(b);
}

function nombreCategoria(id) {
  const cat = categorias.find(c => mismoId(c.category_id, id));
  return cat ? limpiar(cat.category_name) : "Sin categoría";
}

function buscarCanal(id) {
  return canales.find(c => mismoId(c.stream_id, id));
}

// ================= Referencias a canales =================
// Un canal (principal o respaldo) se identifica con una "referencia":
//   - un número ............................ 130589  → canal del proveedor IPTV
//   - un objeto { tipo: "m3u", fuente, clave } ...... → canal de una lista M3U
// Los respaldos viejos (solo números) siguen funcionando tal cual.

function refDeItem(item) {
  if (item.tipo === "m3u") return { tipo: "m3u", fuente: item.fuente, clave: item.clave };
  if (item.tipo === "youtube") return refYoutube(item);
  return Number(item.id);
}

// Referencia de YouTube: { tipo: "youtube", canal: "UC…" } o { tipo: "youtube", video: "…" }.
// Lleva también el nombre, para poder mostrarla (comparar no lo usa).
function refYoutube({ canal, video, nombre }) {
  return { tipo: "youtube", ...(canal ? { canal } : { video }), nombre };
}

// Referencia de un canal tal como se muestra en el catálogo (del proveedor o de una M3U).
function refDeVista(canal) {
  if (canal.m3u) return { tipo: "m3u", fuente: canal.m3u.fuente, clave: canal.m3u.clave };
  if (canal.youtube) return refYoutube(canal.youtube);
  return Number(canal.stream_id);
}

function mismaRef(a, b) {
  const objetoA = typeof a === "object";
  const objetoB = typeof b === "object";
  if (objetoA && objetoB) {
    if (a.tipo !== b.tipo) return false;
    if (a.tipo === "youtube") return a.canal === b.canal && a.video === b.video;
    return a.fuente === b.fuente && a.clave === b.clave;
  }
  if (!objetoA && !objetoB) return mismoId(a, b);
  return false;  // uno del proveedor y otro de otra fuente: nunca son el mismo
}

// Texto único de una referencia (para usar como clave, por ejemplo de un panel abierto).
function textoRef(ref) {
  if (typeof ref !== "object") return `xtream:${ref}`;
  if (ref.tipo === "youtube") return `youtube:${ref.canal ?? ""}:${ref.video ?? ""}`;
  return `m3u:${ref.fuente}:${ref.clave}`;
}

function buscarEntrada(fuente, clave) {
  return entradasM3u.find(e => e.fuente === fuente && e.clave === clave);
}

// Lo necesario para mostrar una referencia: nombre, logo, detalle, y si falta en lo cargado.
function describirRef(ref) {
  if (typeof ref === "object" && ref.tipo === "youtube") {
    return {
      nombre: ref.nombre || "YouTube",
      logo: miniaturaYoutube(ref.video),
      detalle: ref.canal ? `▶ YouTube · vivo del canal ${ref.canal}` : `▶ YouTube · video ${ref.video}`,
      falta: false,
    };
  }
  if (typeof ref === "object") {
    const entrada = buscarEntrada(ref.fuente, ref.clave);
    const fuenteCargada = entradasM3u.some(e => e.fuente === ref.fuente);
    return {
      nombre: entrada?.nombre ?? ref.clave,
      logo: entrada?.logo,
      detalle: `📡 ${ref.fuente}` + (entrada?.grupo ? ` · ${entrada.grupo}` : ""),
      falta: fuenteCargada && !entrada,
    };
  }
  const canal = buscarCanal(ref);
  return {
    nombre: canal?.name ?? `Canal ${ref}`,
    logo: canal?.stream_icon,
    detalle: `#${ref} · ` + (canal ? nombreCategoria(canal.category_id) : "no está en el catálogo"),
    falta: canales.length > 0 && !canal,
  };
}

// ¿Está ese canal en la lista, como principal o como respaldo de algún canal?
function estaEnLista(nombreLista, ref) {
  return listas[nombreLista].some(item =>
    mismaRef(refDeItem(item), ref) || (item.respaldos ?? []).some(r => mismaRef(r, ref))
  );
}


// ================= Repetidos =================
// Palabras que NO cambian qué canal es: calidad, códecs, "backup", país...
const ETIQUETAS = /\b(fhd|uhd|hd|sd|4k|8k|hevc|h ?265|h ?264|1080p?|720p?|480p?|backup|bkp|alt|op ?\d|opc ?\d|opcion ?\d|latam|ar|arg|argentina)\b/g;

// Nombres con prefijo de país al principio: "AR | ...", "US: ..."
const PREFIJO_PAIS = /^\s*[a-z]{2,3}\s*[|:]/i;

// "AR | Telefe FHD [Backup]" -> "telefe"  ·  "AR | A 24 2" -> "a24"  ·  "ESPN 2 HD" -> "espn2"
function claveBase(nombre) {
  // Fuera lo que va entre paréntesis o corchetes: "(720p)", "[Not 24/7]", "[Geo-blocked]"…
  let texto = limpiar(String(nombre ?? "").replace(/[\[(][^\])]*[\])]/g, " "))
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")  // letras "con estilo" -> normales, y sin acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")                         // todo lo que no sea letra o número -> espacio
    .replace(ETIQUETAS, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Tu proveedor numera sus versiones al final: "AR | A24 1", "AR | A24 2".
  // Solo en nombres con prefijo de país, y solo del 1 al 3, para no romper "ESPN 2" o "Canal 9".
  if (PREFIJO_PAIS.test(nombre)) {
    texto = texto.replace(/\s[1-3]$/, "");
  }

  return texto.replace(/\s/g, "");  // sin espacios: "a 24" = "a24"
}

// ¿Dos claves son "el mismo canal"? Iguales, o una empieza con la otra:
// "argentinisima" y "argentinisimasatelital". Con un mínimo de 5 letras,
// para que "tn" no se confunda con "tnt".
function clavesParecidas(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  return corta.length >= 5 && larga.startsWith(corta);
}

// Clave base de un canal "de vista" (catálogo o M3U). Se recuerda para no recalcularla:
// un WeakMap guarda un dato extra por objeto, y se libera solo si el objeto desaparece.
const clavesCacheadas = new WeakMap();

function claveDeVista(canal) {
  const objeto = canal.m3u ?? canal;
  if (!clavesCacheadas.has(objeto)) {
    const nombre = canal.m3u ? canal.m3u.nombre : canal.name;
    clavesCacheadas.set(objeto, claveBase(nombreCorto(nombre)));
  }
  return clavesCacheadas.get(objeto);
}

// Agrupa todo el catálogo por clave base.
function calcularGrupos() {
  grupos = new Map();
  for (const canal of canales) {
    const clave = claveBase(canal.name);
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(canal);
  }
}

// Listas como "Radios Argentinas" agregan datos después de un guion:
// "Canal 22 - CTV - CABA TV Cable - …" -> "Canal 22"
function nombreCorto(nombre) {
  return String(nombre ?? "").split(" - ")[0];
}

// Las claves base con las que se puede reconocer el canal de un ítem de tu lista.
function clavesDeItem(item) {
  const nombres =
    item.tipo === "m3u" ? [buscarEntrada(item.fuente, item.clave)?.nombre, item.nombre] :
    item.tipo === "youtube" ? [item.nombre] :
    [buscarCanal(item.id)?.name, item.original, item.nombre];
  return [...new Set(nombres.filter(Boolean).map(n => claveBase(nombreCorto(n))).filter(Boolean))];
}

// Versiones parecidas del canal de un ítem, en TODAS las fuentes (sin incluir su principal).
// Devuelve canales "de vista", como los del catálogo.
function similaresDe(item) {
  const claves = clavesDeItem(item);
  if (claves.length === 0) return [];
  const principal = refDeItem(item);
  const vistos = new Set();
  return [...canales, ...entradasM3u.map(comoCanal)].filter(canal => {
    const clave = claveDeVista(canal);
    if (!claves.some(c => clavesParecidas(c, clave))) return false;
    const ref = refDeVista(canal);
    const texto = textoRef(ref);
    if (vistos.has(texto) || mismaRef(ref, principal)) return false;  // sin repetidos ni el principal
    vistos.add(texto);
    return true;
  });
}

function crearLogo(url) {
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    return img;
  }
  const hueco = document.createElement("div");
  hueco.className = "sin-logo";
  return hueco;
}

function crearBoton(texto, alHacerClic, deshabilitado = false) {
  const boton = document.createElement("button");
  boton.textContent = texto;
  boton.disabled = deshabilitado;
  boton.addEventListener("click", alHacerClic);
  return boton;
}

async function leerJson(input) {
  const archivo = input.files[0];
  if (!archivo) return null;
  const texto = await archivo.text();
  return JSON.parse(texto);
}

// ================= Guardado automático en el navegador =================
// localStorage guarda texto en ESTE navegador, aunque cierres la pestaña.
// (Es como SharedPreferences en Android.)
function guardarLocal() {
  localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(listas));
}

function cargarLocal() {
  try {
    const texto = localStorage.getItem(CLAVE_GUARDADO);
    if (texto) {
      // "..." copia las propiedades guardadas sobre las vacías por defecto,
      // así si falta alguna lista, queda como [] en vez de undefined.
      listas = { simple: [], completa: [], fuentes: {}, ...JSON.parse(texto) };
    }
  } catch (e) {
    console.warn("No se pudo leer lo guardado:", e);
  }
}

// ¿Hay cambios en tus listas que todavía no se publicaron en GitHub?
// Se guarda en el navegador, así el aviso sigue aunque cierres la pestaña.
function marcarPendiente(hay) {
  localStorage.setItem(CLAVE_PENDIENTE, hay ? "1" : "");
  document.getElementById("indicador-pendiente").hidden = !hay;
}

function hayPendiente() {
  return localStorage.getItem(CLAVE_PENDIENTE) === "1";
}

// Versión LIVIANA del catálogo: solo los campos que usamos.
// (La usan el guardado en el navegador y la publicación en GitHub.)
function catalogoLiviano() {
  return {
    fecha: new Date().toISOString(),
    categorias: categorias.map(c => ({
      category_id: c.category_id,
      category_name: c.category_name,
    })),
    canales: canales.map(c => ({
      stream_id: c.stream_id,
      name: c.name,
      stream_icon: c.stream_icon,
      category_id: c.category_id,
    })),
  };
}

// Guarda en el navegador la copia liviana del catálogo.
function guardarCatalogo() {
  try {
    localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(catalogoLiviano()));
    return true;
  } catch (e) {
    console.warn("No se pudo guardar el catálogo (¿demasiado grande?):", e);
    return false;
  }
}

// Si hay un catálogo guardado, lo usa. Devuelve true si lo encontró.
function cargarCatalogoGuardado() {
  try {
    const texto = localStorage.getItem(CLAVE_CATALOGO);
    if (!texto) return false;
    const guardado = JSON.parse(texto);
    categorias = guardado.categorias;
    canales = guardado.canales;
    calcularGrupos();
    const fecha = new Date(guardado.fecha).toLocaleString();
    estadoCarga.textContent =
      `Catálogo guardado del ${fecha} · Categorías: ${categorias.length} · Canales: ${canales.length}. ` +
      `Cargá archivos nuevos solo si querés actualizarlo.`;
    return true;
  } catch (e) {
    console.warn("No se pudo leer el catálogo guardado:", e);
    return false;
  }
}

// ================= Acciones sobre la lista =================
function agregar(nombreLista, canal) {
  if (estaEnLista(nombreLista, refDeVista(canal))) return;

  if (canal.youtube) {
    const { canal: idCanal, video, nombre } = canal.youtube;
    listas[nombreLista].push({
      tipo: "youtube",
      ...(idCanal ? { canal: idCanal } : { video }),
      nombre,
      ...(video ? { logo: miniaturaYoutube(video) } : {}),
      respaldos: [],
    });
    huboCambio();
    return;
  }

  if (canal.m3u) {
    // Canal de una lista M3U.
    // Sin lo que va entre paréntesis o corchetes: "Encuentro (720p) [Geo-blocked]" -> "Encuentro"
    const { fuente, clave, nombre, logo } = canal.m3u;
    const nombreLimpio = limpiar(nombreCorto(nombre).replace(/\s*[\[(][^\])]*[\])]/g, ""));
    listas[nombreLista].push({ tipo: "m3u", fuente, clave, nombre: nombreLimpio, logo, respaldos: [] });
  } else {
    // Canal del proveedor IPTV
    listas[nombreLista].push({
      tipo: "xtream",
      id: Number(canal.stream_id),
      nombre: limpiar(canal.name),
      original: canal.name,
      respaldos: [],
    });
  }
  huboCambio();
}

// ---------- Respaldos (de cualquier fuente) ----------
function agregarRespaldo(item, ref) {
  if (mismaRef(ref, refDeItem(item))) return;
  item.respaldos = item.respaldos ?? [];
  if (item.respaldos.some(r => mismaRef(r, ref))) return;
  item.respaldos.push(ref);
  huboCambio();
}

function quitarRespaldo(item, posicion) {
  item.respaldos.splice(posicion, 1);
  huboCambio();
}

function moverRespaldo(item, posicion, paso) {
  const respaldos = item.respaldos;
  const destino = posicion + paso;
  if (destino < 0 || destino >= respaldos.length) return;
  [respaldos[posicion], respaldos[destino]] = [respaldos[destino], respaldos[posicion]];
  huboCambio();
}

// Todos los sugeridos pasan a ser respaldos (después de los que ya había).
function agregarSugeridos(item) {
  item.respaldos = item.respaldos ?? [];
  for (const canal of similaresDe(item)) {
    const ref = refDeVista(canal);
    if (!item.respaldos.some(r => mismaRef(r, ref))) item.respaldos.push(ref);
  }
  huboCambio();
}

// Intercambia: un respaldo pasa a ser el principal y el principal, el primer respaldo.
// Si son de fuentes distintas, el canal cambia de tipo (por ejemplo, de "xtream" a "m3u").
function hacerPrincipal(item, ref) {
  const anterior = refDeItem(item);
  const panelAbierto = panelesAbiertos.delete(clavePanel(item));
  item.respaldos = [anterior, ...(item.respaldos ?? []).filter(r => !mismaRef(r, ref))];
  ponerPrincipal(item, ref);
  if (panelAbierto) panelesAbiertos.add(clavePanel(item));  // mantenerlo abierto
  huboCambio();
}

// Cambia la señal principal de un ítem (de cualquier fuente). Mantiene nombre, número y respaldos.
function ponerPrincipal(item, ref) {
  if (typeof ref === "object" && ref.tipo === "youtube") {
    item.tipo = "youtube";
    delete item.canal;
    delete item.video;
    if (ref.canal) item.canal = ref.canal; else item.video = ref.video;
    item.logo = miniaturaYoutube(ref.video);
    delete item.id;
    delete item.original;
    delete item.fuente;
    delete item.clave;
  } else if (typeof ref === "object") {
    item.tipo = "m3u";
    item.fuente = ref.fuente;
    item.clave = ref.clave;
    item.logo = buscarEntrada(ref.fuente, ref.clave)?.logo;
    delete item.id;
    delete item.original;
    delete item.canal;
    delete item.video;
  } else {
    item.tipo = "xtream";
    item.id = Number(ref);
    item.original = buscarCanal(ref)?.name;
    delete item.fuente;
    delete item.clave;
    delete item.canal;
    delete item.video;
    delete item.logo;
  }
  // Si la nueva principal estaba entre los respaldos, ya no hace falta ahí
  item.respaldos = (item.respaldos ?? []).filter(r => !mismaRef(r, ref));
}

function clavePanel(item) {
  return `${listaActiva}:${textoRef(refDeItem(item))}`;
}

function alternarPanel(item) {
  const clave = clavePanel(item);
  if (panelesAbiertos.has(clave)) panelesAbiertos.delete(clave);
  else panelesAbiertos.add(clave);
  mostrarLista();
}

// Mueve un canal a otra posición (las dos empiezan en 0). Los del medio se corren un lugar.
function moverA(desde, hasta) {
  const lista = listas[listaActiva];
  hasta = Math.max(0, Math.min(lista.length - 1, hasta));
  if (desde === hasta) return;
  const [item] = lista.splice(desde, 1);   // sacarlo...
  lista.splice(hasta, 0, item);            // ...y meterlo en el lugar nuevo
  huboCambio();
  notificar(`${item.nombre} ahora es el ${hasta + 1}`);
  // Mostrar el canal en su lugar nuevo, resaltado un momento
  const fila = document.querySelector(`#mi-lista > li:nth-child(${hasta + 1})`);
  if (fila) {
    fila.scrollIntoView({ block: "center", behavior: "smooth" });
    fila.classList.add("recien-movido");
    setTimeout(() => fila.classList.remove("recien-movido"), 1500);
  }
}

function quitar(indice) {
  listas[listaActiva].splice(indice, 1);  // borra 1 elemento en esa posición
  huboCambio();
}

function mover(indice, paso) {
  const lista = listas[listaActiva];
  const destino = indice + paso;
  if (destino < 0 || destino >= lista.length) return;
  // Intercambio en una línea (desestructuración):
  [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
  huboCambio();
}

function renombrar(indice, nuevoNombre) {
  const item = listas[listaActiva][indice];
  const limpio = nuevoNombre.trim();
  if (limpio) {
    item.nombre = limpio;
    guardarLocal();  // sin redibujar, para no sacarte el foco del campo
    marcarPendiente(true);
  } else {
    // Nombre vacío: volver al original del catálogo
    item.nombre = item.tipo === "m3u"
      ? limpiar(nombreCorto(buscarEntrada(item.fuente, item.clave)?.nombre ?? item.clave))
      : limpiar(buscarCanal(item.id)?.name ?? `Canal ${item.id}`);
    huboCambio();
  }
}

function cambiarLista(nombreLista) {
  listaActiva = nombreLista;
  actualizar();
}

// Después de un cambio TUYO en las listas: guardar, marcar "sin publicar" y redibujar.
function huboCambio() {
  guardarLocal();
  marcarPendiente(true);
  actualizar();
}

// Redibuja todo lo que depende de las listas (sin guardar nada).
function actualizar() {
  mostrarPestanas();
  mostrarLista();
  refrescarCanales();
  mostrarAvisos();
}

// ================= Carga de archivos =================
const inputCategorias = document.getElementById("archivo-categorias");
const inputCanales = document.getElementById("archivo-canales");
const estadoCarga = document.getElementById("estado-carga");

inputCategorias.addEventListener("change", cargar);
inputCanales.addEventListener("change", cargar);

async function cargar() {
  try {
    const cats = await leerJson(inputCategorias);
    const cans = await leerJson(inputCanales);
    if (cats) categorias = cats;
    if (cans) canales = cans;
    calcularGrupos();
  } catch (e) {
    estadoCarga.textContent = "No se pudo leer el archivo: " + e.message;
    return;
  }

  const guardado = guardarCatalogo();
  estadoCarga.textContent =
    `Categorías: ${categorias.length} · Canales: ${canales.length}` +
    (guardado ? " · guardado en este navegador" : " · (no se pudo guardar, ver consola)");

  if (categorias.length > 0 && canales.length > 0) {
    mostrarCategorias();
    actualizar();
    notificar("Catálogo cargado ✓");
  }
}

// ================= Dibujar categorías =================
// Muestra los canales de una categoría (la usan la lista lateral y el desplegable).
function elegirCategoria(id) {
  categoriaElegida = id;
  document.getElementById("buscador").value = "";
  mostrarCategorias();

  // Las fuentes M3U aparecen como categorías con id "m3u:<nombre>"
  if (String(id).startsWith("m3u:")) {
    const fuente = String(id).slice(4);
    const deEsta = entradasM3u.filter(e => e.fuente === fuente).map(comoCanal);
    mostrarCanales(deEsta, `📡 ${fuente}`);
    return;
  }

  const cat = categorias.find(c => mismoId(c.category_id, id));
  const deEsta = canales.filter(c => mismoId(c.category_id, id));
  mostrarCanales(deEsta, cat ? limpiar(cat.category_name) : "Categoría");
}

function mostrarCategorias() {
  const ul = document.getElementById("lista-categorias");
  const selector = document.getElementById("selector-categorias");
  ul.innerHTML = "";
  selector.innerHTML = '<option value="">Elegí una categoría…</option>';

  for (const cat of categorias) {
    const cantidad = canales.filter(c => mismoId(c.category_id, cat.category_id)).length;
    const texto = `${limpiar(cat.category_name)} (${cantidad})`;

    // Lista lateral (PC)
    const li = document.createElement("li");
    li.textContent = texto;
    if (mismoId(cat.category_id, categoriaElegida)) li.classList.add("elegida");
    li.addEventListener("click", () => elegirCategoria(cat.category_id));
    ul.appendChild(li);

    // Desplegable (celular)
    const opcion = document.createElement("option");
    opcion.value = cat.category_id;
    opcion.textContent = texto;
    opcion.selected = mismoId(cat.category_id, categoriaElegida);
    selector.appendChild(opcion);
  }

  // Fuentes M3U, al final
  for (const fuente of Object.keys(listas.fuentes)) {
    const id = `m3u:${fuente}`;
    const cantidad = entradasM3u.filter(e => e.fuente === fuente).length;
    const texto = `📡 ${fuente} (${cantidad})`;

    const li = document.createElement("li");
    li.textContent = texto;
    if (categoriaElegida === id) li.classList.add("elegida");
    li.addEventListener("click", () => elegirCategoria(id));
    ul.appendChild(li);

    const opcion = document.createElement("option");
    opcion.value = id;
    opcion.textContent = texto;
    opcion.selected = categoriaElegida === id;
    selector.appendChild(opcion);
  }
}

// Convierte una entrada M3U en un "canal" con la misma forma que los del proveedor,
// así el resto del código la puede mostrar igual. El original queda en .m3u
function comoCanal(entrada) {
  return { stream_id: entrada.clave, name: entrada.nombre, stream_icon: entrada.logo, m3u: entrada };
}

document.getElementById("selector-categorias").addEventListener("change", (evento) => {
  if (evento.target.value) elegirCategoria(evento.target.value);
});

// ================= Dibujar canales del catálogo =================
function mostrarCanales(lista, titulo) {
  vistaCanales = { lista, titulo };
  refrescarCanales();
}

function refrescarCanales() {
  const { lista, titulo } = vistaCanales;  // desestructuración: saca las dos propiedades
  document.getElementById("titulo-canales").textContent =
    lista.length ? `${titulo} (${lista.length})` : titulo;

  const ul = document.getElementById("lista-canales");
  ul.innerHTML = "";

  // Claves de los canales de la lista que estás viendo (para sugerir "+ Respaldo de…")
  const clavesLista = listas[listaActiva].map(item => ({ item, claves: clavesDeItem(item) }));

  for (const canal of lista) {
    const li = document.createElement("li");

    const nombre = document.createElement("span");
    nombre.textContent = limpiar(canal.name);

    const detalle = document.createElement("small");
    if (canal.m3u) {
      detalle.textContent = `📡 ${canal.m3u.fuente}` + (canal.m3u.grupo ? ` · ${canal.m3u.grupo}` : "");
    } else {
      const versiones = (grupos.get(claveBase(canal.name)) ?? []).length;
      detalle.textContent =
        `#${canal.stream_id} · ${nombreCategoria(canal.category_id)}` +
        (versiones > 1 ? ` · ${versiones} versiones` : "");
    }

    // Un botón por lista: "+ Simple" o "✓ Simple" si ya está.
    const acciones = document.createElement("div");
    acciones.className = "acciones";
    for (const nombreLista of ["simple", "completa"]) {
      const ya = estaEnLista(nombreLista, refDeVista(canal));
      acciones.append(
        crearBoton(
          `${ya ? "✓" : "+"} ${NOMBRES_LISTA[nombreLista]}`,
          () => agregar(nombreLista, canal),
          ya,
        ),
      );
    }

    // Si se parece a un canal de tu lista, ofrecer agregarlo como su respaldo
    const ref = refDeVista(canal);
    if (!estaEnLista(listaActiva, ref)) {
      const clave = claveDeVista(canal);
      const parecido = clavesLista.find(({ claves }) => claves.some(c => clavesParecidas(c, clave)));
      if (parecido) {
        acciones.append(crearBoton(`+ Respaldo de ${parecido.item.nombre}`, () => agregarRespaldo(parecido.item, ref)));
      }
    }
    // Y siempre: elegir vos de qué canal es respaldo (para nombres "disfrazados" como "ɛֆքռ")
    acciones.append(crearBoton("Respaldo de…", () => elegirDestinoRespaldo(canal)));

    li.append(crearLogo(canal.stream_icon), nombre, detalle, acciones);
    ul.appendChild(li);
  }
}

// ================= Dibujar tu lista =================
function mostrarPestanas() {
  for (const nombreLista of ["simple", "completa"]) {
    const boton = document.getElementById(`pestana-${nombreLista}`);
    boton.textContent = `${NOMBRES_LISTA[nombreLista]} (${listas[nombreLista].length})`;
    boton.classList.toggle("activa", nombreLista === listaActiva);
  }
}

function mostrarLista() {
  const ul = document.getElementById("mi-lista");
  ul.innerHTML = "";
  const lista = listas[listaActiva];

  if (lista.length === 0) {
    const li = document.createElement("li");
    li.className = "vacia";
    li.textContent = "Todavía no agregaste canales. Usá los botones “+” del catálogo.";
    ul.appendChild(li);
    return;
  }

  lista.forEach((item, i) => {
    const principal = describirRef(refDeItem(item));
    const li = document.createElement("li");
    if (principal.falta) li.classList.add("faltante");

    // El número se puede escribir: tocás el 57, escribís 12 y Enter -> pasa a ser el 12.
    const numero = document.createElement("input");
    numero.type = "number";
    numero.className = "numero";
    numero.min = 1;
    numero.max = lista.length;
    numero.value = i + 1;
    numero.title = "Escribí otro número para moverlo a esa posición";
    numero.addEventListener("change", () => {
      const nuevo = parseInt(numero.value, 10);
      if (Number.isInteger(nuevo)) moverA(i, nuevo - 1);
      else numero.value = i + 1;
    });

    // En la PC, también se puede arrastrar la fila (desde la manija ⠿) y soltarla en otro lugar.
    const manija = document.createElement("span");
    manija.className = "manija";
    manija.textContent = "⠿";
    manija.title = "Arrastrar para mover";
    // Solo la manija se arrastra (si fuera toda la fila, no se podría seleccionar texto del nombre).
    manija.draggable = true;
    manija.addEventListener("dragstart", (evento) => {
      evento.dataTransfer.setData("text/plain", String(i));
      evento.dataTransfer.setDragImage(li, 20, 20);   // que se "lleve" la fila entera
      li.classList.add("arrastrando");
    });
    manija.addEventListener("dragend", () => li.classList.remove("arrastrando"));
    li.addEventListener("dragover", (evento) => {
      evento.preventDefault();          // sin esto, el navegador no deja soltar acá
      li.classList.add("destino");
    });
    li.addEventListener("dragleave", () => li.classList.remove("destino"));
    li.addEventListener("drop", (evento) => {
      evento.preventDefault();
      li.classList.remove("destino");
      const desde = parseInt(evento.dataTransfer.getData("text/plain"), 10);
      if (Number.isInteger(desde)) moverA(desde, i);
    });

    // El nombre se edita ahí mismo. "change" se dispara al salir del campo o con Enter.
    const campo = document.createElement("input");
    campo.value = item.nombre;
    campo.title = `Original: ${principal.nombre} · ${principal.detalle}` +
      (principal.falta ? " — no está en lo cargado" : "");
    campo.addEventListener("change", () => renombrar(i, campo.value));

    const cantidad = (item.respaldos ?? []).length;
    const abierto = panelesAbiertos.has(clavePanel(item));

    const acciones = document.createElement("div");
    acciones.className = "acciones";
    if (item.tipo === "m3u" || item.tipo === "youtube") {
      const etiqueta = document.createElement("span");
      etiqueta.className = "etiqueta-fuente";
      etiqueta.textContent = item.tipo === "m3u" ? `📡 ${item.fuente}` : "▶ YouTube";
      acciones.append(etiqueta);
    }
    const botonRespaldos = crearBoton(
      `Respaldos ${cantidad} ${abierto ? "▴" : "▾"}`,
      () => alternarPanel(item),
    );
    if (cantidad > 0) botonRespaldos.classList.add("con-respaldos");
    acciones.append(
      botonRespaldos,
      crearBoton("↑", () => mover(i, -1), i === 0),
      crearBoton("↓", () => mover(i, +1), i === lista.length - 1),
      crearBoton("✎", () => abrirEdicion(i)),
      crearBoton("✕", () => quitar(i)),
    );

    li.append(manija, numero, crearLogo(principal.logo || item.logo), campo, acciones);
    ul.appendChild(li);

    if (abierto) ul.appendChild(crearPanelRespaldos(item));
  });
}

// Lo escrito en el buscador de respaldos de cada panel (para no perderlo al redibujar).
const busquedasRespaldo = new Map();

// Una fila con logo, nombre y detalle de una referencia, más los botones que se pasen.
function crearFilaRef(ref, ...botones) {
  const datos = describirRef(ref);
  const fila = document.createElement("div");
  fila.className = "fila-respaldo";
  if (datos.falta) fila.classList.add("faltante");

  const nombre = document.createElement("span");
  nombre.textContent = limpiar(datos.nombre);

  const detalle = document.createElement("small");
  detalle.textContent = datos.detalle + (datos.falta ? " · no está en lo cargado" : "");

  const acciones = document.createElement("div");
  acciones.className = "acciones";
  acciones.append(...botones);

  fila.append(crearLogo(datos.logo), nombre, detalle, acciones);
  return fila;
}

function crearSubtitulo(texto, ...botones) {
  const div = document.createElement("div");
  div.className = "encabezado-respaldos";
  const span = document.createElement("span");
  span.textContent = texto;
  div.append(span, ...botones);
  return div;
}

// Panel debajo de un canal: sus respaldos (de cualquier fuente), sugerencias y un buscador.
function crearPanelRespaldos(item) {
  const li = document.createElement("li");
  li.className = "panel-respaldos";
  const respaldos = item.respaldos ?? [];

  // 1) Respaldos elegidos, en orden
  li.append(crearSubtitulo("Respaldos — si el principal falla, se prueban de arriba hacia abajo"));
  if (respaldos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "ayuda";
    vacio.textContent = "Todavía no tiene respaldos. Agregalos desde las sugerencias o el buscador.";
    li.append(vacio);
  }
  respaldos.forEach((ref, i) => {
    li.append(crearFilaRef(ref,
      crearBoton("↑", () => moverRespaldo(item, i, -1), i === 0),
      crearBoton("↓", () => moverRespaldo(item, i, +1), i === respaldos.length - 1),
      crearBoton("Principal", () => hacerPrincipal(item, ref)),
      crearBoton("✕", () => quitarRespaldo(item, i)),
    ));
  });

  // 2) Sugeridos: versiones parecidas en todas las fuentes
  const sugeridos = similaresDe(item).filter(canal =>
    !respaldos.some(r => mismaRef(r, refDeVista(canal)))
  );
  if (sugeridos.length > 0) {
    li.append(crearSubtitulo(`Sugeridos (${sugeridos.length})`,
      crearBoton("Agregar todos", () => agregarSugeridos(item))));
    for (const canal of sugeridos) {
      const ref = refDeVista(canal);
      li.append(crearFilaRef(ref, crearBoton("+ Respaldo", () => agregarRespaldo(item, ref))));
    }
  }

  // 3) Buscador en todas las fuentes, para agregar a mano lo que no se detectó solo
  li.append(crearSubtitulo("Buscar en todas las fuentes"));
  const clave = clavePanel(item);
  const buscador = document.createElement("input");
  buscador.type = "search";
  buscador.className = "campo";
  buscador.placeholder = "Por ejemplo: TN";
  buscador.value = busquedasRespaldo.get(clave) ?? "";
  const resultados = document.createElement("div");

  function buscar() {
    busquedasRespaldo.set(clave, buscador.value);
    resultados.innerHTML = "";
    const texto = buscador.value.trim().toLowerCase();
    if (texto.length < 2) return;
    const coincide = nombre => limpiar(nombre).toLowerCase().includes(texto);
    const encontrados = [
      ...canales.filter(c => coincide(c.name)),
      ...entradasM3u.filter(e => coincide(e.nombre)).map(comoCanal),
    ]
      .map(refDeVista)
      .filter(ref => !mismaRef(ref, refDeItem(item)) && !respaldos.some(r => mismaRef(r, ref)))
      .slice(0, 30);
    if (encontrados.length === 0) {
      resultados.textContent = "Sin resultados.";
      return;
    }
    for (const ref of encontrados) {
      resultados.append(crearFilaRef(ref, crearBoton("+ Respaldo", () => agregarRespaldo(item, ref))));
    }
  }

  buscador.addEventListener("input", buscar);
  li.append(buscador, resultados);
  buscar();  // si había algo escrito, mostrar sus resultados
  return li;
}

// ================= Exportar / importar lista.json =================
// Versión del formato: si algún día lo cambiamos, la app sabe qué está leyendo.
const VERSION_FORMATO = 1;

// Revisa las listas y devuelve avisos (textos) sobre posibles problemas.
function revisarListas() {
  const avisos = [];
  for (const nombreLista of ["simple", "completa"]) {
    const lista = listas[nombreLista];
    const etiqueta = NOMBRES_LISTA[nombreLista];
    if (lista.length === 0) avisos.push(`La lista ${etiqueta} está vacía.`);

    lista.forEach((item, i) => {
      const donde = `${etiqueta} ${i + 1} "${item.nombre}"`;

      // Fuentes M3U que no están configuradas (principal o respaldos)
      const refs = [refDeItem(item), ...(item.respaldos ?? [])];
      for (const ref of refs) {
        if (typeof ref === "object" && ref.tipo === "m3u" && !listas.fuentes[ref.fuente]) {
          avisos.push(`${donde}: usa la fuente "${ref.fuente}", que no está en Ajustes → Fuentes M3U.`);
        }
      }

      if (describirRef(refDeItem(item)).falta) {
        avisos.push(`${donde}: el canal principal no está en lo cargado.`);
      }
      const perdidos = (item.respaldos ?? []).filter(r => describirRef(r).falta);
      if (perdidos.length > 0) {
        avisos.push(`${donde}: ${perdidos.length} respaldo(s) no están en lo cargado.`);
      }
    });
  }
  return avisos;
}

function mostrarAvisos() {
  const ul = document.getElementById("avisos");
  ul.innerHTML = "";
  if (canales.length === 0 && entradasM3u.length === 0) return;  // sin catálogos no tiene sentido revisar
  for (const aviso of revisarListas()) {
    const li = document.createElement("li");
    li.textContent = "⚠ " + aviso;
    ul.appendChild(li);
  }
}

// Arma el objeto que se va a guardar en lista.json.
function armarExportacion() {
  // Copia cada ítem tal cual, pero sin "respaldos" si está vacío (archivo más limpio).
  // "...resto" junta todas las demás propiedades (tipo, id, nombre y las que vengan en el futuro).
    const limpiarItem = ({ respaldos, ...resto }) => {
    // Listas armadas antes de tener "original": completarlo desde el catálogo.
    if (resto.tipo === "xtream" && !resto.original) {
      resto.original = buscarCanal(resto.id)?.name;
    }
    return respaldos && respaldos.length > 0 ? { ...resto, respaldos } : resto;
  };

  return {
    version: VERSION_FORMATO,
    actualizado: new Date().toISOString(),
    fuentes: listas.fuentes,
    simple: listas.simple.map(limpiarItem),
    completa: listas.completa.map(limpiarItem),
  };
}

function exportar() {
  const avisos = revisarListas();
  if (avisos.length > 0 && !confirm(`Hay ${avisos.length} aviso(s) (están debajo de las pestañas). ¿Exportar igual?`)) {
    return;
  }

  // JSON con sangría de 2 espacios: así se lee bien en GitHub y en los "diff" de Git.
  const texto = JSON.stringify(armarExportacion(), null, 2);

  // Truco clásico para descargar un archivo generado en la página:
  // 1) se crea un "archivo en memoria" (Blob), 2) un enlace que apunta a él, 3) se le hace clic.
  const archivo = new Blob([texto], { type: "application/json" });
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = "lista.json";
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);  // liberar la memoria después
}

// Revisa que unos datos tengan el formato de lista.json. Si no, lanza un error.
function validarLista(datos) {
  if (!Array.isArray(datos?.simple) || !Array.isArray(datos?.completa)) {
    throw new Error("no tiene las listas \"simple\" y \"completa\".");
  }
  for (const item of [...datos.simple, ...datos.completa]) {
    if (!item.tipo || !item.nombre) {
      throw new Error(`hay un canal sin tipo o sin nombre: ${JSON.stringify(item)}`);
    }
  }
}

// Reemplaza tus listas por las de "datos", pidiendo confirmación.
function aplicarLista(datos, origen, preguntar = true) {
  const resumen = `Simple: ${datos.simple.length} · Completa: ${datos.completa.length}`;
  if (preguntar && !confirm(`Se va a REEMPLAZAR tu lista actual por la de ${origen} (${resumen}). ¿Seguir?`)) {
    return false;
  }
  listas = { simple: datos.simple, completa: datos.completa, fuentes: datos.fuentes ?? {} };
  panelesAbiertos.clear();
  guardarLocal();
  actualizar();
  mostrarFuentes();
  mostrarCategorias();
  return true;
}

async function importar(input) {
  try {
    const datos = await leerJson(input);
    if (!datos) return;
    validarLista(datos);
    if (aplicarLista(datos, "el archivo")) marcarPendiente(true);
  } catch (e) {
    alert("No se pudo importar: " + e.message);
  } finally {
    input.value = "";  // para poder volver a elegir el mismo archivo
  }
}

const inputImportar = document.getElementById("archivo-importar");
document.getElementById("boton-exportar").addEventListener("click", exportar);
document.getElementById("boton-importar").addEventListener("click", () => inputImportar.click());
inputImportar.addEventListener("change", () => importar(inputImportar));

// ================= GitHub: traer y publicar la lista =================
const REPO = "emigildev/emitv";
const RUTA_LISTA = "datos/lista.json";
const CLAVE_TOKEN = "emitv-token";

const RUTA_CATALOGO = "datos/catalogo.json";
const CLAVE_SHA_LISTA = "emitv-sha-lista";
const CLAVE_SHA_CATALOGO = "emitv-sha-catalogo";

// "sha" = la huella de la versión del archivo en GitHub en la que se basa tu lista.
// GitHub la pide al publicar, para no pisar cambios hechos desde otro lado.
// Se guarda en el navegador: así podés publicar aunque hayas cerrado la pestaña.
let shaLista = localStorage.getItem(CLAVE_SHA_LISTA);

function guardarShaLista(sha) {
  shaLista = sha;
  localStorage.setItem(CLAVE_SHA_LISTA, sha);
}

const campoToken = document.getElementById("campo-token");
const estadoGitHub = document.getElementById("estado-github");

function token() {
  return localStorage.getItem(CLAVE_TOKEN) ?? "";
}

function mostrarEstadoGitHub(texto) {
  estadoGitHub.textContent = texto;
  if (texto) notificar(texto);  // también como mensaje flotante, por si estás en otra vista
}

function mostrarEstadoToken() {
  campoToken.value = "";
  campoToken.placeholder = token() ? "Token guardado en este navegador ✓" : "Pegá acá tu token de GitHub";
}

// Llama a la API de GitHub para un archivo (o carpeta) del repo. Lanza un error con .estado si falla.
// Con crudo = true devuelve el contenido del archivo como texto, tal cual
// (sirve también para archivos grandes, de más de 1 MB).
async function github(ruta, opciones = {}, crudo = false) {
  const respuesta = await fetch(`https://api.github.com/repos/${REPO}/contents/${ruta}`, {
    ...opciones,
    cache: "no-store",  // siempre la versión más nueva, nada de copias viejas
    headers: {
      "Accept": crudo ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      ...(token() ? { "Authorization": `Bearer ${token()}` } : {}),
    },
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.json().catch(() => ({}));
    const error = new Error(`GitHub respondió ${respuesta.status}: ${detalle.message ?? "error"}`);
    error.estado = respuesta.status;
    throw error;
  }
  return crudo ? respuesta.text() : respuesta.json();
}

// Las huellas (sha) de los archivos de datos/, SIN descargar su contenido.
// Sirve para saber rápido qué cambió en GitHub: { "datos/lista.json": "a1b2…", ... }
async function shasRemotos() {
  const archivos = await github("datos");
  return Object.fromEntries(archivos.map(a => [a.path, a.sha]));
}

// GitHub guarda el contenido en Base64. Estas dos funciones convierten
// respetando acentos y eñes (btoa/atob solos se rompen con "Pública").
function aBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function desdeBase64(base64) {
  const binario = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binario, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function traerDeGitHub({ preguntar = true } = {}) {
  mostrarEstadoGitHub("Trayendo la lista de GitHub…");
  try {
    const archivo = await github(RUTA_LISTA);
    const datos = JSON.parse(desdeBase64(archivo.content));
    validarLista(datos);
    if (aplicarLista(datos, "GitHub", preguntar)) {
      guardarShaLista(archivo.sha);
      marcarPendiente(false);
      const fecha = datos.actualizado ? new Date(datos.actualizado).toLocaleString() : "fecha desconocida";
      mostrarEstadoGitHub(`Lista traída de GitHub ✓ (publicada el ${fecha})`);
    } else {
      mostrarEstadoGitHub("");
    }
  } catch (e) {
    mostrarEstadoGitHub("No se pudo traer: " + e.message);
  }
}

async function publicarEnGitHub() {
  if (!token()) {
    alert("Primero guardá tu token de GitHub.");
    return;
  }
  if (!shaLista) {
    alert("Antes de publicar, usá \"Traer de GitHub\" para partir de la última versión.");
    return;
  }
  const avisos = revisarListas();
  if (avisos.length > 0 && !confirm(`Hay ${avisos.length} aviso(s). ¿Publicar igual?`)) return;

  mostrarEstadoGitHub("Publicando…");
  try {
    const texto = JSON.stringify(armarExportacion(), null, 2) + "\n";
    const resultado = await github(RUTA_LISTA, {
      method: "PUT",
      body: JSON.stringify({
        message: "Lista actualizada desde la página de curación",
        content: aBase64(texto),
        sha: shaLista,
      }),
    });
    guardarShaLista(resultado.content.sha);
    marcarPendiente(false);
    mostrarEstadoGitHub(`Publicada ✓ ${new Date().toLocaleTimeString()} — las TVs la toman la próxima vez que se abra la app.`);
  } catch (e) {
    if (e.estado === 409) {
      mostrarEstadoGitHub("La lista en GitHub cambió desde otro lado. Usá \"Traer de GitHub\" antes de publicar.");
    } else if (e.estado === 401 || e.estado === 403) {
      mostrarEstadoGitHub("GitHub rechazó el token (¿venció o le faltan permisos?).");
    } else {
      mostrarEstadoGitHub("No se pudo publicar: " + e.message);
    }
  }
}

document.getElementById("boton-guardar-token").addEventListener("click", () => {
  const nuevo = campoToken.value.trim();
  if (!nuevo) return;
  localStorage.setItem(CLAVE_TOKEN, nuevo);
  mostrarEstadoToken();
  mostrarEstadoGitHub("Token guardado en este navegador.");
});
document.getElementById("boton-olvidar-token").addEventListener("click", () => {
  localStorage.removeItem(CLAVE_TOKEN);
  mostrarEstadoToken();
  mostrarEstadoGitHub("Token borrado de este navegador.");
});
document.getElementById("boton-traer").addEventListener("click", () => traerDeGitHub());
document.getElementById("boton-publicar").addEventListener("click", publicarEnGitHub);
mostrarEstadoToken();

// ================= Servidor (config.json) =================
const RUTA_CONFIG = "datos/config.json";
let shaConfig = null;        // huella de config.json en GitHub (null = todavía no existe)
let configTraida = false;    // para no publicar sin haber traído antes

const campoServidor = document.getElementById("campo-servidor");
const estadoServidor = document.getElementById("estado-servidor");

async function traerConfig() {
  estadoServidor.textContent = "Trayendo…";
  try {
    const archivo = await github(RUTA_CONFIG);
    const datos = JSON.parse(desdeBase64(archivo.content));
    campoServidor.value = datos.servidor ?? "";
    shaConfig = archivo.sha;
    configTraida = true;
    estadoServidor.textContent = "Servidor actual traído de GitHub ✓";
  } catch (e) {
    if (e.estado === 404) {
      // Todavía no existe: se crea la primera vez que publiques.
      shaConfig = null;
      configTraida = true;
      estadoServidor.textContent = "Todavía no hay config.json: se va a crear al publicar.";
    } else {
      estadoServidor.textContent = "No se pudo traer: " + e.message;
    }
  }
}

async function publicarConfig() {
  if (!token()) {
    alert("Primero guardá tu token de GitHub.");
    return;
  }
  if (!configTraida) {
    alert("Antes de publicar, usá \"Traer servidor\".");
    return;
  }

  // Validar la dirección antes de mandarla a todas las TVs
  const servidor = campoServidor.value.trim().replace(/\/+$/, "");
  let direccion;
  try {
    direccion = new URL(servidor);
  } catch {
    alert("La dirección no es válida. Ejemplo: https://miservidor.com");
    return;
  }
  if (direccion.protocol !== "https:" && direccion.protocol !== "http:") {
    alert("La dirección tiene que empezar con https:// o http://");
    return;
  }
  if (!confirm(`TODAS las TVs van a usar este servidor la próxima vez que abran la app:\n\n${servidor}\n\n¿Seguro?`)) {
    return;
  }

  estadoServidor.textContent = "Publicando…";
  try {
    const texto = JSON.stringify({ version: 1, servidor }, null, 2) + "\n";
    const cuerpo = { message: `Servidor: ${servidor}`, content: aBase64(texto) };
    if (shaConfig) cuerpo.sha = shaConfig;  // sin sha = crear el archivo
    const resultado = await github(RUTA_CONFIG, { method: "PUT", body: JSON.stringify(cuerpo) });
    shaConfig = resultado.content.sha;
    estadoServidor.textContent = `Publicado ✓ ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    if (e.estado === 409 || e.estado === 422) {
      estadoServidor.textContent = "config.json cambió desde otro lado. Usá \"Traer servidor\" y volvé a intentar.";
    } else {
      estadoServidor.textContent = "No se pudo publicar: " + e.message;
    }
  }
}

document.getElementById("boton-traer-servidor").addEventListener("click", traerConfig);
document.getElementById("boton-publicar-servidor").addEventListener("click", publicarConfig);

// ================= Catálogo en GitHub =================
function mostrarEstadoCatalogo(texto) {
  estadoCarga.textContent = texto;
  if (texto) notificar(texto);
}

// Sube la versión liviana del catálogo a datos/catalogo.json (desde la PC).
async function publicarCatalogo() {
  if (!token()) {
    alert("Primero guardá tu token de GitHub.");
    return;
  }
  if (canales.length === 0) {
    alert("Primero cargá los archivos del catálogo.");
    return;
  }
  if (!confirm(`Se va a publicar el catálogo (${canales.length} canales) en GitHub. ¿Seguir?`)) return;

  mostrarEstadoCatalogo("Publicando el catálogo…");
  try {
    const shas = await shasRemotos();
    const cuerpo = {
      message: `Catálogo actualizado (${canales.length} canales)`,
      content: aBase64(JSON.stringify(catalogoLiviano())),
    };
    if (shas[RUTA_CATALOGO]) cuerpo.sha = shas[RUTA_CATALOGO];  // si ya existe, se reemplaza
    const resultado = await github(RUTA_CATALOGO, { method: "PUT", body: JSON.stringify(cuerpo) });
    localStorage.setItem(CLAVE_SHA_CATALOGO, resultado.content.sha);
    mostrarEstadoCatalogo(`Catálogo publicado ✓ (${canales.length} canales)`);
  } catch (e) {
    mostrarEstadoCatalogo("No se pudo publicar el catálogo: " + e.message);
  }
}

// Trae datos/catalogo.json y lo usa como catálogo de esta página.
async function traerCatalogo(sha) {
  mostrarEstadoCatalogo("Trayendo el catálogo de GitHub…");
  const texto = await github(RUTA_CATALOGO, {}, true);
  const datos = JSON.parse(texto);
  categorias = datos.categorias;
  canales = datos.canales;
  calcularGrupos();
  try {
    localStorage.setItem(CLAVE_CATALOGO, texto);
    if (sha) localStorage.setItem(CLAVE_SHA_CATALOGO, sha);
  } catch (e) {
    console.warn("No se pudo guardar el catálogo en el navegador:", e);
  }
  mostrarCategorias();
  actualizar();
  const fecha = datos.fecha ? new Date(datos.fecha).toLocaleString() : "fecha desconocida";
  mostrarEstadoCatalogo(`Catálogo de GitHub ✓ (${canales.length} canales, del ${fecha})`);
}

document.getElementById("boton-publicar-catalogo").addEventListener("click", publicarCatalogo);
document.getElementById("boton-traer-catalogo").addEventListener("click", async () => {
  try {
    const shas = await shasRemotos();
    await traerCatalogo(shas[RUTA_CATALOGO]);
  } catch (e) {
    mostrarEstadoCatalogo(e.estado === 404
      ? "Todavía no hay un catálogo publicado en GitHub."
      : "No se pudo traer el catálogo: " + e.message);
  }
});

// ================= Sincronización al abrir la página =================
// Trae de GitHub lo que haya cambiado, sin pisar cambios tuyos sin publicar.
async function sincronizarAlAbrir() {
  let shas;
  try {
    shas = await shasRemotos();
  } catch (e) {
    notificar("Sin conexión con GitHub: se usa lo guardado en este navegador.");
    return;
  }

  // 1) Catálogo: si en GitHub hay uno distinto al que tenemos, traerlo.
  const shaCatalogo = shas[RUTA_CATALOGO];
  if (shaCatalogo && shaCatalogo !== localStorage.getItem(CLAVE_SHA_CATALOGO)) {
    try {
      await traerCatalogo(shaCatalogo);
    } catch (e) {
      console.warn("No se pudo traer el catálogo:", e);
    }
  }

  // 2) Lista: si cambió en GitHub, traerla… salvo que tengas cambios sin publicar.
  const shaListaRemota = shas[RUTA_LISTA];
  if (shaListaRemota && shaListaRemota !== shaLista) {
    if (hayPendiente()) {
      notificar("⚠ Tenés cambios sin publicar y la lista en GitHub también cambió.");
    } else {
      await traerDeGitHub({ preguntar: false });
    }
  }

  // 3) Servidor: completar el campo de Ajustes.
  await traerConfig();

  // 4) Fuentes M3U que este navegador todavía no leyó.
  for (const fuente of Object.keys(listas.fuentes)) {
    if (!entradasM3u.some(e => e.fuente === fuente)) await actualizarFuente(fuente);
  }
}

// ================= Fuentes M3U =================
const CLAVE_M3U = "emitv-m3u";  // entradas leídas, por fuente: { iptvorg: { fecha, entradas }, ... }

// Lee el texto de una lista M3U. Cada canal ocupa (al menos) dos líneas:
//   #EXTINF:-1 tvg-id="Encuentro.ar" tvg-logo="…" group-title="Cultura",Encuentro
//   https://…/playlist.m3u8
function parsearM3u(texto, fuente) {
  const entradas = [];
  let actual = null;

  for (const lineaCruda of texto.split(/\r?\n/)) {
    const linea = lineaCruda.trim();

    if (linea.startsWith("#EXTINF")) {
      const atributo = nombre => linea.match(new RegExp(`${nombre}="([^"]*)"`))?.[1] ?? "";
      // El nombre va después de la coma que sigue a los atributos (puede tener comas adentro)
      const coma = linea.indexOf(",", linea.lastIndexOf('"') + 1);
      actual = {
        fuente,
        nombre: coma >= 0 ? linea.slice(coma + 1).trim() : "",
        tvgId: atributo("tvg-id"),
        logo: atributo("tvg-logo"),
        grupo: atributo("group-title"),
        cabeceras: {},
      };
    } else if (linea.startsWith("#EXTVLCOPT:") && actual) {
      // Opciones extra para reproducir (las que VLC entiende solo)
      const [opcion, ...resto] = linea.slice("#EXTVLCOPT:".length).split("=");
      const valor = resto.join("=");
      if (opcion === "http-referrer") actual.cabeceras["Referer"] = valor;
      if (opcion === "http-user-agent") actual.cabeceras["User-Agent"] = valor;
    } else if (linea && !linea.startsWith("#") && actual) {
      // La línea con la dirección del canal
      actual.url = linea;
      // Clave estable para encontrarlo después: el tvg-id si hay; si no, la propia URL
      actual.clave = actual.tvgId || linea;
      entradas.push(actual);
      actual = null;
    }
  }
  return entradas;
}

function guardarEntradasM3u(fuente, entradas) {
  entradasM3u = [...entradasM3u.filter(e => e.fuente !== fuente), ...entradas];
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_M3U) || "{}");
    guardado[fuente] = { fecha: new Date().toISOString(), entradas };
    localStorage.setItem(CLAVE_M3U, JSON.stringify(guardado));
  } catch (e) {
    console.warn("No se pudo guardar la lista M3U en el navegador:", e);
  }
  mostrarCategorias();
  mostrarFuentes();
  actualizar();
}

function cargarM3uGuardadas() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_M3U) || "{}");
    entradasM3u = Object.values(guardado).flatMap(g => g.entradas);
  } catch (e) {
    console.warn("No se pudieron leer las listas M3U guardadas:", e);
  }
}

// Descarga la M3U desde su dirección. Algunos sitios no lo permiten desde el navegador
// (CORS): en ese caso hay que descargarla a mano y usar "Archivo".
async function actualizarFuente(fuente) {
  const estado = document.getElementById("estado-fuentes");
  estado.textContent = `Descargando ${fuente}…`;
  try {
    const respuesta = await fetch(listas.fuentes[fuente], { cache: "no-store" });
    if (!respuesta.ok) throw new Error(`el sitio respondió ${respuesta.status}`);
    const entradas = parsearM3u(await respuesta.text(), fuente);
    if (entradas.length === 0) throw new Error("no se encontraron canales en la lista");
    guardarEntradasM3u(fuente, entradas);
    notificar(`📡 ${fuente}: ${entradas.length} canales ✓`);
    estado.textContent = "";
  } catch (e) {
    estado.textContent =
      `No se pudo descargar ${fuente} (${e.message}). Si el sitio no lo permite desde el navegador, ` +
      `descargá el archivo .m3u y cargalo con "Archivo".`;
  }
}

async function cargarArchivoFuente(fuente, input) {
  const archivo = input.files[0];
  if (!archivo) return;
  const entradas = parsearM3u(await archivo.text(), fuente);
  input.value = "";
  if (entradas.length === 0) {
    alert("Ese archivo no parece una lista M3U.");
    return;
  }
  guardarEntradasM3u(fuente, entradas);
  notificar(`📡 ${fuente}: ${entradas.length} canales ✓`);
}

function agregarFuente() {
  const campoNombre = document.getElementById("campo-fuente-nombre");
  const campoUrl = document.getElementById("campo-fuente-url");
  // Nombre corto: solo minúsculas, números y guiones (se usa como identificador)
  const nombre = campoNombre.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const url = campoUrl.value.trim();
  if (!nombre || !url) {
    alert("Completá un nombre corto (ej: iptvorg) y la dirección de la lista.");
    return;
  }
  listas.fuentes = { ...listas.fuentes, [nombre]: url };
  campoNombre.value = "";
  campoUrl.value = "";
  huboCambio();
  mostrarFuentes();
  mostrarCategorias();
  actualizarFuente(nombre);
}

function quitarFuente(fuente) {
  const usaFuente = ref => typeof ref === "object" && ref.fuente === fuente;
  const enUso = ["simple", "completa"].some(l =>
    listas[l].some(i => usaFuente(refDeItem(i)) || (i.respaldos ?? []).some(usaFuente))
  );
  if (enUso && !confirm(`Hay canales o respaldos de "${fuente}" en tus listas. Si la quitás, la app no va a poder reproducirlos. ¿Quitarla igual?`)) {
    return;
  }
  const { [fuente]: _, ...resto } = listas.fuentes;  // copia sin esa fuente
  listas.fuentes = resto;
  entradasM3u = entradasM3u.filter(e => e.fuente !== fuente);
  huboCambio();
  mostrarFuentes();
  mostrarCategorias();
}

function mostrarFuentes() {
  const ul = document.getElementById("lista-fuentes");
  ul.innerHTML = "";
  for (const [fuente, url] of Object.entries(listas.fuentes)) {
    const cantidad = entradasM3u.filter(e => e.fuente === fuente).length;
    const li = document.createElement("li");

    const texto = document.createElement("div");
    texto.className = "fuente-texto";
    texto.innerHTML = `<strong></strong><small></small>`;
    texto.querySelector("strong").textContent = `📡 ${fuente} · ${cantidad} canales`;
    texto.querySelector("small").textContent = url;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".m3u,.m3u8,.txt";
    input.hidden = true;
    input.addEventListener("change", () => cargarArchivoFuente(fuente, input));

    const acciones = document.createElement("div");
    acciones.className = "fila";
    acciones.append(
      crearBoton("⟳ Actualizar", () => actualizarFuente(fuente)),
      crearBoton("Archivo", () => input.click()),
      crearBoton("✕", () => quitarFuente(fuente)),
      input,
    );
    li.append(texto, acciones);
    ul.appendChild(li);
  }
}

document.getElementById("boton-agregar-fuente").addEventListener("click", agregarFuente);

// ================= YouTube =================
// Entiende lo que pegues: enlace de un video o vivo, enlace del canal, o un ID.
//   https://www.youtube.com/watch?v=tInHlI4KdmQ  → { video: "tInHlI4KdmQ" }
//   https://youtu.be/tInHlI4KdmQ · /live/… · /embed/… → { video: … }
//   https://www.youtube.com/channel/UC…  o  UC…    → { canal: "UC…" }
function leerYoutube(texto) {
  const t = texto.trim();
  let m = t.match(/(UC[\w-]{22})/);
  if (m) return { canal: m[1] };
  m = t.match(/(?:[?&]v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([\w-]{11})/);
  if (m) return { video: m[1] };
  if (/^[\w-]{11}$/.test(t)) return { video: t };
  return null;
}

function miniaturaYoutube(video) {
  return video ? `https://i.ytimg.com/vi/${video}/hqdefault.jpg` : undefined;
}

// Arma un canal "de vista" con lo que hay en el formulario (o avisa qué falta).
function canalDelFormularioYoutube() {
  const estado = document.getElementById("estado-yt");
  const texto = document.getElementById("campo-yt-enlace").value;
  if (/@[\w.-]+/.test(texto) && !leerYoutube(texto)) {
    estado.textContent = "Los enlaces con @nombre no sirven: pegá el enlace del vivo, o el ID del canal (empieza con UC).";
    return null;
  }
  const datos = leerYoutube(texto);
  if (!datos) {
    estado.textContent = "No reconozco ese enlace. Pegá el enlace del video en vivo, o el ID del canal (empieza con UC).";
    return null;
  }
  const nombre = document.getElementById("campo-yt-nombre").value.trim();
  if (!nombre) {
    estado.textContent = "Poné un nombre para el canal (por ejemplo: El Destape).";
    return null;
  }
  estado.textContent = "";
  return {
    stream_id: textoRef(refYoutube({ ...datos, nombre })),
    name: nombre,
    stream_icon: miniaturaYoutube(datos.video),
    youtube: { ...datos, nombre },
  };
}

function limpiarFormularioYoutube(mensaje) {
  document.getElementById("campo-yt-enlace").value = "";
  document.getElementById("campo-yt-nombre").value = "";
  notificar(mensaje);
}

for (const nombreLista of ["simple", "completa"]) {
  document.getElementById(`boton-yt-${nombreLista}`).addEventListener("click", () => {
    const canal = canalDelFormularioYoutube();
    if (!canal) return;
    if (estaEnLista(nombreLista, refDeVista(canal))) {
      notificar(`Ya está en la lista ${NOMBRES_LISTA[nombreLista]}.`);
      return;
    }
    agregar(nombreLista, canal);
    limpiarFormularioYoutube(`▶ ${canal.name} agregado a ${NOMBRES_LISTA[nombreLista]} ✓`);
  });
}

document.getElementById("boton-yt-respaldo").addEventListener("click", () => {
  const canal = canalDelFormularioYoutube();
  if (canal) elegirDestinoRespaldo(canal);
});

// ================= Editar un canal =================
// Para cambiarle la señal (por ejemplo, el enlace nuevo de un vivo de YouTube)
// SIN perder su número, su nombre ni sus respaldos.
const dialogoEditar = document.getElementById("dialogo-editar");
let edicion = null;   // { indice, refNueva }: lo que se está editando

function abrirEdicion(indice) {
  const item = listas[listaActiva][indice];
  edicion = { indice, refNueva: null };
  document.getElementById("editar-nombre").value = item.nombre;
  document.getElementById("editar-posicion").value = indice + 1;
  document.getElementById("editar-posicion").max = listas[listaActiva].length;
  document.getElementById("editar-youtube").value = "";
  document.getElementById("editar-buscador").value = "";
  document.getElementById("editar-resultados").innerHTML = "";
  document.getElementById("editar-conservar").checked = false;
  document.getElementById("editar-estado").textContent = "";
  dibujarSenalEdicion();
  dialogoEditar.showModal();
}

// Muestra la señal actual, o la nueva elegida (todavía sin guardar).
function dibujarSenalEdicion() {
  const item = listas[listaActiva][edicion.indice];
  const contenedor = document.getElementById("editar-senal");
  contenedor.innerHTML = "";
  const titulo = document.createElement("p");
  titulo.className = "ayuda";
  titulo.textContent = edicion.refNueva ? "Señal nueva (se aplica al guardar):" : "Señal actual:";
  contenedor.append(titulo, crearFilaRef(edicion.refNueva ?? refDeItem(item)));
}

// Buscador: cualquier canal de cualquier fuente puede ser la nueva señal
document.getElementById("editar-buscador").addEventListener("input", (evento) => {
  const resultados = document.getElementById("editar-resultados");
  resultados.innerHTML = "";
  const texto = evento.target.value.trim().toLowerCase();
  if (texto.length < 2) return;
  const coincide = nombre => limpiar(nombre).toLowerCase().includes(texto);
  const encontrados = [
    ...canales.filter(c => coincide(c.name)),
    ...entradasM3u.filter(e => coincide(e.nombre)).map(comoCanal),
  ].slice(0, 25);
  if (encontrados.length === 0) {
    resultados.textContent = "Sin resultados.";
    return;
  }
  for (const canal of encontrados) {
    const ref = refDeVista(canal);
    const boton = crearBoton("Usar este", () => {
      edicion.refNueva = ref;
      dibujarSenalEdicion();
    });
    boton.type = "button";
    resultados.append(crearFilaRef(ref, boton));
  }
});

// Enlace nuevo de YouTube (lo más común: el canal empezó otro vivo)
document.getElementById("editar-youtube").addEventListener("input", (evento) => {
  const estado = document.getElementById("editar-estado");
  const texto = evento.target.value.trim();
  if (!texto) return;
  const datos = leerYoutube(texto);
  if (!datos) {
    estado.textContent = "No reconozco ese enlace de YouTube.";
    return;
  }
  estado.textContent = "";
  const item = listas[listaActiva][edicion.indice];
  edicion.refNueva = refYoutube({ ...datos, nombre: item.nombre });
  dibujarSenalEdicion();
});

function guardarEdicion() {
  const lista = listas[listaActiva];
  const item = lista[edicion.indice];

  // 1) Nombre
  const nombre = document.getElementById("editar-nombre").value.trim();
  if (nombre) item.nombre = nombre;

  // 2) Señal nueva (si se eligió)
  if (edicion.refNueva && !mismaRef(edicion.refNueva, refDeItem(item))) {
    const anterior = refDeItem(item);
    ponerPrincipal(item, edicion.refNueva);
    if (document.getElementById("editar-conservar").checked) {
      item.respaldos = [anterior, ...(item.respaldos ?? [])];
    }
  }

  // 3) Posición (al final, porque cambia los índices)
  const posicion = parseInt(document.getElementById("editar-posicion").value, 10);
  dialogoEditar.close();
  if (Number.isInteger(posicion) && posicion - 1 !== edicion.indice) {
    moverA(edicion.indice, posicion - 1);   // moverA ya guarda y redibuja
  } else {
    huboCambio();
    notificar(`${item.nombre} actualizado ✓`);
  }
}

document.getElementById("editar-guardar").addEventListener("click", guardarEdicion);

// ================= Elegir de qué canal es respaldo =================
// Para cuando la página no puede adivinarlo (por ejemplo, "ɛֆքռ" es ESPN):
// desde el catálogo, elegís vos a qué canal de tu lista se agrega como respaldo.
const dialogoRespaldo = document.getElementById("dialogo-respaldo");
let refEnEleccion = null;    // el canal del catálogo que se va a agregar como respaldo
let listaDialogo = "simple"; // en qué lista se está eligiendo

function elegirDestinoRespaldo(canal) {
  refEnEleccion = refDeVista(canal);
  listaDialogo = listaActiva;
  const datos = describirRef(refEnEleccion);
  document.getElementById("dialogo-canal").textContent = `${limpiar(datos.nombre)} · ${datos.detalle}`;
  document.getElementById("dialogo-buscador").value = "";
  dibujarDialogo();
  dialogoRespaldo.showModal();  // <dialog> nativo: se abre encima de todo y Esc lo cierra
}

function dibujarDialogo() {
  for (const boton of document.querySelectorAll("#dialogo-pestanas .pestana")) {
    boton.classList.toggle("activa", boton.dataset.lista === listaDialogo);
  }

  const filtro = document.getElementById("dialogo-buscador").value.trim().toLowerCase();
  const ul = document.getElementById("dialogo-lista");
  ul.innerHTML = "";

  listas[listaDialogo].forEach((item, i) => {
    if (filtro && !item.nombre.toLowerCase().includes(filtro)) return;

    const esPrincipal = mismaRef(refDeItem(item), refEnEleccion);
    const yaEsRespaldo = (item.respaldos ?? []).some(r => mismaRef(r, refEnEleccion));

    const li = document.createElement("li");
    const boton = crearBoton("", () => {
      agregarRespaldo(item, refEnEleccion);
      dialogoRespaldo.close();
      notificar(`Agregado como respaldo de ${item.nombre} ✓`);
    }, esPrincipal || yaEsRespaldo);
    boton.type = "button";  // dentro de un <form>, un botón sin type lo enviaría (y cerraría el diálogo)
    boton.className = "opcion-dialogo";

    const numero = document.createElement("span");
    numero.className = "numero";
    numero.textContent = i + 1;
    const nombre = document.createElement("span");
    nombre.textContent = item.nombre;
    const estado = document.createElement("small");
    estado.textContent = esPrincipal ? "es este mismo canal" : yaEsRespaldo ? "✓ ya es respaldo" : "";

    boton.append(numero, crearLogo(describirRef(refDeItem(item)).logo || item.logo), nombre, estado);
    li.append(boton);
    ul.append(li);
  });

  if (!ul.children.length) {
    const vacio = document.createElement("li");
    vacio.className = "ayuda";
    vacio.textContent = "No hay canales que coincidan.";
    ul.append(vacio);
  }
}

for (const boton of document.querySelectorAll("#dialogo-pestanas .pestana")) {
  boton.addEventListener("click", () => {
    listaDialogo = boton.dataset.lista;
    dibujarDialogo();
  });
}
document.getElementById("dialogo-buscador").addEventListener("input", dibujarDialogo);

// ================= Pestañas y buscador =================
document.getElementById("pestana-simple").addEventListener("click", () => cambiarLista("simple"));
document.getElementById("pestana-completa").addEventListener("click", () => cambiarLista("completa"));

document.getElementById("buscador").addEventListener("input", (evento) => {
  const texto = evento.target.value.trim().toLowerCase();
  if (texto.length < 2) return;

  categoriaElegida = null;  // también vacía el desplegable al redibujar
  mostrarCategorias();

  const resultado = [
    ...canales.filter(c => limpiar(c.name).toLowerCase().includes(texto)),
    ...entradasM3u.filter(e => limpiar(e.nombre).toLowerCase().includes(texto)).map(comoCanal),
  ];
  mostrarCanales(resultado.slice(0, 300), `Resultados para "${evento.target.value}"`);
});

// ================= Vistas (Mi lista / Catálogo / Ajustes) =================
const CLAVE_VISTA = "emitv-vista";

function mostrarVista(vista) {
  document.body.dataset.vista = vista;  // el CSS decide qué se ve según este atributo
  for (const boton of document.querySelectorAll(".nav-boton")) {
    boton.classList.toggle("activo", boton.dataset.ir === vista);
  }
  localStorage.setItem(CLAVE_VISTA, vista);
  window.scrollTo(0, 0);
}

for (const boton of document.querySelectorAll(".nav-boton")) {
  boton.addEventListener("click", () => mostrarVista(boton.dataset.ir));
}

// ================= Mensaje flotante =================
let temporizadorNotificacion = null;

function notificar(texto) {
  const caja = document.getElementById("notificacion");
  caja.textContent = texto;
  caja.hidden = false;
  clearTimeout(temporizadorNotificacion);  // si había otro mensaje, se reemplaza
  temporizadorNotificacion = setTimeout(() => { caja.hidden = true; }, 4000);
}

// ================= Al abrir la página =================
cargarLocal();
cargarM3uGuardadas();
cargarCatalogoGuardado();
mostrarCategorias();
mostrarFuentes();
marcarPendiente(hayPendiente());
mostrarVista(localStorage.getItem(CLAVE_VISTA) || "lista");
actualizar();
sincronizarAlAbrir();
