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

// ¿Está ese canal en la lista, como principal o como respaldo?
function estaEnLista(nombreLista, id) {
  return listas[nombreLista].some(item =>
    item.tipo === "xtream" &&
    (mismoId(item.id, id) || (item.respaldos ?? []).some(r => mismoId(r, id)))
  );
}

// ¿Está ese canal M3U en la lista?
function estaEnListaM3u(nombreLista, fuente, clave) {
  return listas[nombreLista].some(item =>
    item.tipo === "m3u" && item.fuente === fuente && item.clave === clave
  );
}

function buscarEntrada(fuente, clave) {
  return entradasM3u.find(e => e.fuente === fuente && e.clave === clave);
}

// ================= Repetidos =================
// Palabras que NO cambian qué canal es: calidad, códecs, "backup", país...
const ETIQUETAS = /\b(fhd|uhd|hd|sd|4k|8k|hevc|h ?265|h ?264|1080p?|720p?|480p?|backup|bkp|alt|op ?\d|opcion ?\d|latam|ar|arg|argentina)\b/g;

// Nombres con prefijo de país al principio: "AR | ...", "US: ..."
const PREFIJO_PAIS = /^\s*[a-z]{2,3}\s*[|:]/i;

// "AR | Telefe FHD [Backup]" -> "telefe"  ·  "AR | A 24 2" -> "a24"  ·  "ESPN 2 HD" -> "espn2"
function claveBase(nombre) {
  let texto = limpiar(nombre)
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

// Las otras versiones del mismo canal (sin incluir el propio).
function similares(id) {
  const canal = buscarCanal(id);
  if (!canal) return [];
  return (grupos.get(claveBase(canal.name)) ?? []).filter(c => !mismoId(c.stream_id, id));
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
  // Canal de una lista M3U
  if (canal.m3u) {
    const { fuente, clave, nombre, logo } = canal.m3u;
    if (estaEnListaM3u(nombreLista, fuente, clave)) return;
    // Sin lo que va entre paréntesis o corchetes: "Encuentro (720p) [Geo-blocked]" -> "Encuentro"
    const nombreLimpio = limpiar(nombre.replace(/\s*[\[(][^\])]*[\])]/g, ""));
    listas[nombreLista].push({ tipo: "m3u", fuente, clave, nombre: nombreLimpio, logo });
    huboCambio();
    return;
  }

  // Canal del proveedor IPTV
  if (estaEnLista(nombreLista, canal.stream_id)) return;
  listas[nombreLista].push({
    tipo: "xtream",
    id: Number(canal.stream_id),
    nombre: limpiar(canal.name),
    original: canal.name,
    respaldos: [],
  });
  huboCambio();
}

// Marca o desmarca un canal como respaldo de un ítem.
function alternarRespaldo(item, id) {
  item.respaldos = item.respaldos ?? [];
  const posicion = item.respaldos.findIndex(r => mismoId(r, id));
  if (posicion >= 0) {
    item.respaldos.splice(posicion, 1);
  } else {
    item.respaldos.push(Number(id));
  }
  huboCambio();
}

// Todas las versiones similares pasan a ser respaldos.
function usarTodosComoRespaldo(item) {
  item.respaldos = similares(item.id).map(c => Number(c.stream_id));
  huboCambio();
}

// Intercambia: el respaldo pasa a ser el principal y el principal, el primer respaldo.
function hacerPrincipal(item, id) {
  const anterior = item.id;
  const claveAnterior = `${listaActiva}:${anterior}`;
  item.respaldos = (item.respaldos ?? []).filter(r => !mismoId(r, id));
  item.respaldos.unshift(anterior);  // unshift = agregar al principio
  item.id = Number(id);
  item.original = buscarCanal(id)?.name ?? item.original;
  // Mantener abierto el panel aunque cambió el id
  if (panelesAbiertos.delete(claveAnterior)) panelesAbiertos.add(`${listaActiva}:${item.id}`);
  huboCambio();
}

function alternarPanel(item) {
  const clave = `${listaActiva}:${item.id}`;
  if (panelesAbiertos.has(clave)) panelesAbiertos.delete(clave);
  else panelesAbiertos.add(clave);
  mostrarLista();
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
      ? limpiar(buscarEntrada(item.fuente, item.clave)?.nombre ?? item.clave)
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
      const ya = canal.m3u
        ? estaEnListaM3u(nombreLista, canal.m3u.fuente, canal.m3u.clave)
        : estaEnLista(nombreLista, canal.stream_id);
      acciones.append(
        crearBoton(
          `${ya ? "✓" : "+"} ${NOMBRES_LISTA[nombreLista]}`,
          () => agregar(nombreLista, canal),
          ya,
        ),
      );
    }

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
    if (item.tipo === "m3u") {
      ul.appendChild(filaM3u(item, i, lista.length));
      return;
    }
    const original = buscarCanal(item.id);  // puede ser undefined si ya no existe
    const li = document.createElement("li");
    if (canales.length > 0 && !original) li.classList.add("faltante");

    const numero = document.createElement("span");
    numero.className = "numero";
    numero.textContent = i + 1;

    // El nombre se edita ahí mismo. "change" se dispara al salir del campo o con Enter.
    const campo = document.createElement("input");
    campo.value = item.nombre;
    campo.title = original
      ? `Original: ${limpiar(original.name)} · #${item.id}`
      : `#${item.id} — no está en el catálogo actual`;
    campo.addEventListener("change", () => renombrar(i, campo.value));

    const otros = similares(item.id);
    const cantidadRespaldos = (item.respaldos ?? []).length;
    const abierto = panelesAbiertos.has(`${listaActiva}:${item.id}`);

    const acciones = document.createElement("div");
    acciones.className = "acciones";
    if (otros.length > 0 || cantidadRespaldos > 0) {
      const boton = crearBoton(
        `Respaldos ${cantidadRespaldos}/${otros.length} ${abierto ? "▴" : "▾"}`,
        () => alternarPanel(item),
      );
      if (cantidadRespaldos > 0) boton.classList.add("con-respaldos");
      acciones.append(boton);
    }
    acciones.append(
      crearBoton("↑", () => mover(i, -1), i === 0),
      crearBoton("↓", () => mover(i, +1), i === lista.length - 1),
      crearBoton("✕", () => quitar(i)),
    );

    // "?." (optional chaining): si original es undefined, no falla y da undefined.
    li.append(numero, crearLogo(original?.stream_icon), campo, acciones);
    ul.appendChild(li);

    if (abierto) ul.appendChild(crearPanelRespaldos(item, otros));
  });
}

// Fila de "Mi lista" para un canal de una lista M3U (sin respaldos, por ahora).
function filaM3u(item, i, total) {
  const entrada = buscarEntrada(item.fuente, item.clave);
  const fuenteCargada = entradasM3u.some(e => e.fuente === item.fuente);
  const li = document.createElement("li");
  if (fuenteCargada && !entrada) li.classList.add("faltante");

  const numero = document.createElement("span");
  numero.className = "numero";
  numero.textContent = i + 1;

  const campo = document.createElement("input");
  campo.value = item.nombre;
  campo.title = `📡 ${item.fuente} · ${item.clave}` + (fuenteCargada && !entrada ? " — no está en la lista M3U" : "");
  campo.addEventListener("change", () => renombrar(i, campo.value));

  const acciones = document.createElement("div");
  acciones.className = "acciones";
  const etiqueta = document.createElement("span");
  etiqueta.className = "etiqueta-fuente";
  etiqueta.textContent = `📡 ${item.fuente}`;
  acciones.append(
    etiqueta,
    crearBoton("↑", () => mover(i, -1), i === 0),
    crearBoton("↓", () => mover(i, +1), i === total - 1),
    crearBoton("✕", () => quitar(i)),
  );

  li.append(numero, crearLogo(entrada?.logo || item.logo), campo, acciones);
  return li;
}

// Panel debajo de un canal: sus otras versiones, para elegir respaldos o cambiar el principal.
function crearPanelRespaldos(item, otros) {
  const li = document.createElement("li");
  li.className = "panel-respaldos";

  const encabezado = document.createElement("div");
  encabezado.className = "encabezado-respaldos";
  encabezado.textContent = "Si el principal falla, la app prueba los respaldos en este orden.";
  encabezado.append(crearBoton("Usar todos", () => usarTodosComoRespaldo(item)));
  li.append(encabezado);

  // Primero los respaldos elegidos (en su orden), después el resto.
  const elegidos = (item.respaldos ?? []).map(r => buscarCanal(r) ?? { stream_id: r, name: `Canal ${r}` });
  const resto = otros.filter(c => !(item.respaldos ?? []).some(r => mismoId(r, c.stream_id)));

  for (const canal of [...elegidos, ...resto]) {
    const fila = document.createElement("div");
    fila.className = "fila-respaldo";

    const marca = document.createElement("input");
    marca.type = "checkbox";
    marca.checked = (item.respaldos ?? []).some(r => mismoId(r, canal.stream_id));
    marca.addEventListener("change", () => alternarRespaldo(item, canal.stream_id));

    const nombre = document.createElement("span");
    nombre.textContent = limpiar(canal.name);

    const detalle = document.createElement("small");
    detalle.textContent = `#${canal.stream_id} · ${nombreCategoria(canal.category_id)}`;

    fila.append(
      marca,
      crearLogo(canal.stream_icon),
      nombre,
      detalle,
      crearBoton("Hacer principal", () => hacerPrincipal(item, canal.stream_id)),
    );
    li.append(fila);
  }
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
      if (item.tipo === "m3u") {
        if (!listas.fuentes[item.fuente]) {
          avisos.push(`${donde}: la fuente "${item.fuente}" no está en Ajustes → Fuentes M3U.`);
        } else if (entradasM3u.some(e => e.fuente === item.fuente) && !buscarEntrada(item.fuente, item.clave)) {
          avisos.push(`${donde}: ya no aparece en la lista M3U "${item.fuente}".`);
        }
        return;
      }
      if (item.tipo !== "xtream") return;
      if (!buscarCanal(item.id)) {
        avisos.push(`${donde}: el canal #${item.id} no está en el catálogo.`);
      }
      const perdidos = (item.respaldos ?? []).filter(r => !buscarCanal(r));
      if (perdidos.length > 0) {
        avisos.push(`${donde}: ${perdidos.length} respaldo(s) no están en el catálogo.`);
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
  const enUso = ["simple", "completa"].some(l => listas[l].some(i => i.tipo === "m3u" && i.fuente === fuente));
  if (enUso && !confirm(`Hay canales de "${fuente}" en tus listas. Si la quitás, la app no va a poder reproducirlos. ¿Quitarla igual?`)) {
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
