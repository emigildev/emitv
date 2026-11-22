// ================= Estado de la página =================
// (Como las variables de estado de un ViewModel)
let categorias = [];          // [{ category_id, category_name }, ...]
let canales = [];             // [{ stream_id, name, stream_icon, category_id }, ...]
let categoriaElegida = null;  // id de la categoría que se está viendo

// ================= Utilidades =================

// Igual que limpiar() en la app: "✴️ Argentina ✴️" -> "Argentina"
function limpiar(texto) {
  return String(texto ?? "")
    .replace(/[^\p{L}\p{N} +\/.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Los IDs a veces vienen como texto ("194") y a veces como número (194).
// Los pasamos siempre a texto para compararlos sin sorpresas.
function mismoId(a, b) {
  return String(a) === String(b);
}

function nombreCategoria(id) {
  const cat = categorias.find(c => mismoId(c.category_id, id));
  return cat ? limpiar(cat.category_name) : "Sin categoría";
}

// Lee un archivo elegido en un <input type="file"> y lo convierte de JSON a datos.
async function leerJson(input) {
  const archivo = input.files[0];
  if (!archivo) return null;
  const texto = await archivo.text();
  return JSON.parse(texto);
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

  estadoCarga.textContent = `Categorías: ${categorias.length} · Canales: ${canales.length}`;

  if (categorias.length > 0 && canales.length > 0) {
    document.getElementById("explorador").hidden = false;
    mostrarCategorias();
  }
}

// ================= Dibujar categorías =================
function mostrarCategorias() {
  const ul = document.getElementById("lista-categorias");
  ul.innerHTML = "";  // vaciar antes de volver a dibujar

  for (const cat of categorias) {
    const cantidad = canales.filter(c => mismoId(c.category_id, cat.category_id)).length;

    const li = document.createElement("li");
    li.textContent = `${limpiar(cat.category_name)} (${cantidad})`;
    if (mismoId(cat.category_id, categoriaElegida)) li.classList.add("elegida");

    li.addEventListener("click", () => {
      categoriaElegida = cat.category_id;
      document.getElementById("buscador").value = "";
      mostrarCategorias();  // para marcar la elegida
      const deEsta = canales.filter(c => mismoId(c.category_id, cat.category_id));
      mostrarCanales(deEsta, limpiar(cat.category_name));
    });

    ul.appendChild(li);
  }
}

// ================= Dibujar canales =================
function mostrarCanales(lista, titulo) {
  document.getElementById("titulo-canales").textContent = `${titulo} (${lista.length})`;
  const ul = document.getElementById("lista-canales");
  ul.innerHTML = "";

  for (const canal of lista) {
    const li = document.createElement("li");

    // Logo (o un hueco del mismo tamaño si no tiene)
    let logo;
    if (canal.stream_icon) {
      logo = document.createElement("img");
      logo.src = canal.stream_icon;
      logo.alt = "";
      logo.loading = "lazy";  // cargar la imagen recién cuando se ve (como LazyColumn)
    } else {
      logo = document.createElement("div");
      logo.className = "sin-logo";
    }

    const nombre = document.createElement("span");
    nombre.textContent = limpiar(canal.name);

    const detalle = document.createElement("small");
    detalle.textContent = `#${canal.stream_id} · ${nombreCategoria(canal.category_id)}`;

    li.append(logo, nombre, detalle);
    ul.appendChild(li);
  }
}

// ================= Buscador =================
document.getElementById("buscador").addEventListener("input", (evento) => {
  const texto = evento.target.value.trim().toLowerCase();
  if (texto.length < 2) return;  // con 1 letra saldría medio catálogo

  categoriaElegida = null;
  mostrarCategorias();  // desmarcar la categoría elegida

  const resultado = canales.filter(c => limpiar(c.name).toLowerCase().includes(texto));
  // Mostramos hasta 300 para no trabar la página
  mostrarCanales(resultado.slice(0, 300), `Resultados para "${evento.target.value}"`);
});