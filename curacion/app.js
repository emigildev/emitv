// ================= Estado de la página =================
let categorias = [];          // [{ category_id, category_name }, ...]
let canales = [];             // [{ stream_id, name, stream_icon, category_id }, ...]
let categoriaElegida = null;  // id de la categoría que se está viendo

// Lo que se muestra en la columna del catálogo (para poder redibujarlo).
let vistaCanales = { lista: [], titulo: "Elegí una categoría" };

// Tus dos listas. Cada ítem: { tipo: "xtream", id: 1021, nombre: "Telefe", respaldos: [5512, 7781] }
let listas = { simple: [], completa: [] };
let listaActiva = "simple";

// Repetidos: "telefe" -> [canal, canal, ...]. Se calcula al cargar el catálogo.
let grupos = new Map();
// Paneles de respaldos abiertos en tu lista (no se guarda: es solo de la vista).
let panelesAbiertos = new Set();

const NOMBRES_LISTA = { simple: "Simple", completa: "Completa" };
const CLAVE_GUARDADO = "emitv-listas";
const CLAVE_CATALOGO = "emitv-catalogo";

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
      listas = { simple: [], completa: [], ...JSON.parse(texto) };
    }
  } catch (e) {
    console.warn("No se pudo leer lo guardado:", e);
  }
}

// Guarda una copia LIVIANA del catálogo: solo los campos que usamos.
function guardarCatalogo() {
  const liviano = {
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
  try {
    localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(liviano));
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
  if (estaEnLista(nombreLista, canal.stream_id)) return;
  listas[nombreLista].push({
    tipo: "xtream",
    id: Number(canal.stream_id),
    nombre: limpiar(canal.name),
    original: canal.name,
    respaldos: [],
  });
  actualizar();
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
  actualizar();
}

// Todas las versiones similares pasan a ser respaldos.
function usarTodosComoRespaldo(item) {
  item.respaldos = similares(item.id).map(c => Number(c.stream_id));
  actualizar();
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
  actualizar();
}

function alternarPanel(item) {
  const clave = `${listaActiva}:${item.id}`;
  if (panelesAbiertos.has(clave)) panelesAbiertos.delete(clave);
  else panelesAbiertos.add(clave);
  mostrarLista();
}

function quitar(indice) {
  listas[listaActiva].splice(indice, 1);  // borra 1 elemento en esa posición
  actualizar();
}

function mover(indice, paso) {
  const lista = listas[listaActiva];
  const destino = indice + paso;
  if (destino < 0 || destino >= lista.length) return;
  // Intercambio en una línea (desestructuración):
  [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
  actualizar();
}

function renombrar(indice, nuevoNombre) {
  const item = listas[listaActiva][indice];
  const limpio = nuevoNombre.trim();
  if (limpio) {
    item.nombre = limpio;
    guardarLocal();  // sin redibujar, para no sacarte el foco del campo
  } else {
    // Nombre vacío: volver al original del catálogo
    item.nombre = limpiar(buscarCanal(item.id)?.name ?? `Canal ${item.id}`);
    actualizar();
  }
}

function cambiarLista(nombreLista) {
  listaActiva = nombreLista;
  actualizar();
}

// Después de cualquier cambio: guardar y redibujar todo lo que depende de las listas.
function actualizar() {
  guardarLocal();
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
    document.getElementById("explorador").hidden = false;
    mostrarCategorias();
    actualizar();
  }
}

// ================= Dibujar categorías =================
function mostrarCategorias() {
  const ul = document.getElementById("lista-categorias");
  ul.innerHTML = "";

  for (const cat of categorias) {
    const cantidad = canales.filter(c => mismoId(c.category_id, cat.category_id)).length;

    const li = document.createElement("li");
    li.textContent = `${limpiar(cat.category_name)} (${cantidad})`;
    if (mismoId(cat.category_id, categoriaElegida)) li.classList.add("elegida");

    li.addEventListener("click", () => {
      categoriaElegida = cat.category_id;
      document.getElementById("buscador").value = "";
      mostrarCategorias();
      const deEsta = canales.filter(c => mismoId(c.category_id, cat.category_id));
      mostrarCanales(deEsta, limpiar(cat.category_name));
    });

    ul.appendChild(li);
  }
}

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

    const versiones = (grupos.get(claveBase(canal.name)) ?? []).length;
    const detalle = document.createElement("small");
    detalle.textContent =
      `#${canal.stream_id} · ${nombreCategoria(canal.category_id)}` +
      (versiones > 1 ? ` · ${versiones} versiones` : "");

    // Un botón por lista: "+ Simple" o "✓ Simple" si ya está.
    const acciones = document.createElement("div");
    acciones.className = "acciones";
    for (const nombreLista of ["simple", "completa"]) {
      const ya = estaEnLista(nombreLista, canal.stream_id);
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
    const original = buscarCanal(item.id);  // puede ser undefined si ya no existe
    const li = document.createElement("li");
    if (!original) li.classList.add("faltante");

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
      if (item.tipo !== "xtream") return;  // otros tipos (M3U, YouTube) se revisan en la 6D
      const donde = `${etiqueta} ${i + 1} "${item.nombre}"`;
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
  if (canales.length === 0) return;  // sin catálogo no tiene sentido revisar
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

async function importar(input) {
  try {
    const datos = await leerJson(input);
    if (!datos) return;

    // Validar antes de reemplazar nada
    if (!Array.isArray(datos.simple) || !Array.isArray(datos.completa)) {
      throw new Error("el archivo no tiene las listas \"simple\" y \"completa\".");
    }
    for (const item of [...datos.simple, ...datos.completa]) {
      if (!item.tipo || !item.nombre) {
        throw new Error(`hay un canal sin tipo o sin nombre: ${JSON.stringify(item)}`);
      }
    }

    const resumen = `Simple: ${datos.simple.length} · Completa: ${datos.completa.length}`;
    if (!confirm(`Se va a REEMPLAZAR tu lista actual por la del archivo (${resumen}). ¿Seguir?`)) return;

    listas = { simple: datos.simple, completa: datos.completa };
    panelesAbiertos.clear();
    actualizar();
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

// ================= Pestañas y buscador =================
document.getElementById("pestana-simple").addEventListener("click", () => cambiarLista("simple"));
document.getElementById("pestana-completa").addEventListener("click", () => cambiarLista("completa"));

document.getElementById("buscador").addEventListener("input", (evento) => {
  const texto = evento.target.value.trim().toLowerCase();
  if (texto.length < 2) return;

  categoriaElegida = null;
  mostrarCategorias();

  const resultado = canales.filter(c => limpiar(c.name).toLowerCase().includes(texto));
  mostrarCanales(resultado.slice(0, 300), `Resultados para "${evento.target.value}"`);
});

// ================= Al abrir la página =================
cargarLocal();
if (cargarCatalogoGuardado()) {
  document.getElementById("explorador").hidden = false;
  mostrarCategorias();
}
actualizar();