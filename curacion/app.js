// ================= Estado de la página =================
let categorias = [];          // [{ category_id, category_name }, ...]
let canales = [];             // [{ stream_id, name, stream_icon, category_id }, ...]
let categoriaElegida = null;  // id de la categoría que se está viendo

// Lo que se muestra en la columna del catálogo (para poder redibujarlo).
let vistaCanales = { lista: [], titulo: "Elegí una categoría" };

// Tus dos listas. Cada ítem: { tipo: "xtream", id: 1021, nombre: "Telefe" }
let listas = { simple: [], completa: [] };
let listaActiva = "simple";

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

function estaEnLista(nombreLista, id) {
  return listas[nombreLista].some(item => item.tipo === "xtream" && mismoId(item.id, id));
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
  });
  actualizar();
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

    const detalle = document.createElement("small");
    detalle.textContent = `#${canal.stream_id} · ${nombreCategoria(canal.category_id)}`;

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

    const acciones = document.createElement("div");
    acciones.className = "acciones";
    acciones.append(
      crearBoton("↑", () => mover(i, -1), i === 0),
      crearBoton("↓", () => mover(i, +1), i === lista.length - 1),
      crearBoton("✕", () => quitar(i)),
    );

    // "?." (optional chaining): si original es undefined, no falla y da undefined.
    li.append(numero, crearLogo(original?.stream_icon), campo, acciones);
    ul.appendChild(li);
  });
}

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