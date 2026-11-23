package com.emigildev.emitv.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.text.Normalizer

// ---------- Formato de lista.json (lo que publica la página de curación) ----------

@Serializable
data class ListaRemota(
    val version: Int = 1,
    val actualizado: String? = null,
    val fuentes: Map<String, String> = emptyMap(),   // listas M3U: nombre corto -> dirección
    val simple: List<ItemLista> = emptyList(),
    val completa: List<ItemLista> = emptyList(),
)

@Serializable
data class ItemLista(
    val tipo: String,                  // "xtream" o "m3u" (y "youtube" en la 6D-2)
    val nombre: String,
    // --- tipo "xtream" ---
    val id: Int? = null,
    val original: String? = null,      // nombre en el proveedor, para buscarlo si cambia el id
    val respaldos: List<Int> = emptyList(),
    // --- tipo "m3u" ---
    val fuente: String? = null,        // qué lista M3U (una de "fuentes")
    val clave: String? = null,         // tvg-id del canal, o su URL si no tiene
    val logo: String? = null,
)

@Serializable
data class ConfigRemota(
    val version: Int = 1,
    val servidor: String? = null,
)

val jsonLista = Json {
    ignoreUnknownKeys = true   // campos futuros no rompen versiones viejas de la app
    coerceInputValues = true
    isLenient = true
}

// ---------- De dónde sale el video de un canal ----------

sealed interface Senal {
    /** Un canal de tu proveedor IPTV: la URL se arma con servidor + usuario + clave + id. */
    data class DeXtream(val canal: Canal) : Senal

    /** Una URL directa (listas M3U), con cabeceras especiales si hacen falta. */
    data class Directa(val url: String, val cabeceras: Map<String, String> = emptyMap()) : Senal
}

// ---------- Un canal de tu lista, ya "resuelto" y listo para ver ----------

data class CanalEnLista(
    val numero: Int,            // el número que ve el usuario: fijo, aunque falten otros canales
    val nombre: String,         // el nombre que le pusiste en la curación
    val logo: String?,
    val principal: Senal,       // lo que se reproduce
    val respaldos: List<Senal>, // alternativas (se usan en la Fase 9)
)

// ---------- Repetidos: la misma lógica que claveBase() de la página de curación ----------

private val ETIQUETAS = Regex(
    "\\b(fhd|uhd|hd|sd|4k|8k|hevc|h ?265|h ?264|1080p?|720p?|480p?|backup|bkp|alt|op ?\\d|opcion ?\\d|latam|ar|arg|argentina)\\b"
)
private val PREFIJO_PAIS = Regex("^\\s*[a-z]{2,3}\\s*[|:]", RegexOption.IGNORE_CASE)
private val ACENTOS = Regex("\\p{Mn}+")
private val NO_ALFANUMERICO = Regex("[^a-z0-9]+")
private val ESPACIOS = Regex("\\s+")
private val NUMERO_VERSION = Regex("\\s[1-3]$")

/** "AR | Telefe FHD [Backup]" -> "telefe"  ·  "AR | A 24 2" -> "a24" */
fun claveBase(nombre: String): String {
    var texto = Normalizer.normalize(limpiar(nombre), Normalizer.Form.NFKD)
        .replace(ACENTOS, "")
        .lowercase()
        .replace(NO_ALFANUMERICO, " ")
        .replace(ETIQUETAS, " ")
        .replace(ESPACIOS, " ")
        .trim()
    if (PREFIJO_PAIS.containsMatchIn(nombre)) {
        texto = texto.replace(NUMERO_VERSION, "")
    }
    return texto.replace(" ", "")
}

// ---------- Resolver: tu lista + datos frescos -> canales listos para ver ----------

fun resolver(
    items: List<ItemLista>,
    catalogo: List<Canal>,                      // canales del proveedor IPTV
    listasM3u: Map<String, List<EntradaM3u>>,   // canales de cada lista M3U, por fuente
): List<CanalEnLista> {
    val porId = catalogo.associateBy { it.id }
    val porClave = catalogo.groupBy { claveBase(it.nombre) }

    fun buscarPorNombre(nombre: String?): Canal? {
        val clave = nombre?.let { claveBase(it) }
        if (clave.isNullOrEmpty()) return null
        return porClave[clave]?.firstOrNull()
    }

    return items.mapIndexedNotNull { i, item ->
        val numero = i + 1
        when (item.tipo) {
            "xtream" -> {
                val respaldos = item.respaldos.mapNotNull { porId[it] }
                val principal = item.id?.let { porId[it] }   // 1) por id
                    ?: buscarPorNombre(item.original)          // 2) por nombre original
                    ?: buscarPorNombre(item.nombre)            // 3) por el nombre que le pusiste
                    ?: respaldos.firstOrNull()                 // 4) el primer respaldo
                    ?: return@mapIndexedNotNull null           // 5) no hay forma: se omite
                CanalEnLista(
                    numero = numero,
                    nombre = item.nombre,
                    logo = principal.logo,
                    principal = Senal.DeXtream(principal),
                    respaldos = respaldos.filter { it.id != principal.id }.map { Senal.DeXtream(it) },
                )
            }

            "m3u" -> {
                val entradas = listasM3u[item.fuente].orEmpty()
                val claveNombre = claveBase(item.nombre)
                // 1) por clave (tvg-id o URL); 2) si no, por nombre
                val coincidencias = entradas.filter { it.clave == item.clave }.ifEmpty {
                    if (claveNombre.isEmpty()) emptyList()
                    else entradas.filter { claveBase(it.nombre) == claveNombre }
                }
                val senales = coincidencias.map { Senal.Directa(it.url, it.cabeceras) }.ifEmpty {
                    // 3) si la lista no se pudo leer pero la clave ES una URL, se usa directo
                    listOfNotNull(item.clave?.takeIf { it.startsWith("http") }?.let { Senal.Directa(it) })
                }
                if (senales.isEmpty()) return@mapIndexedNotNull null
                CanalEnLista(
                    numero = numero,
                    nombre = item.nombre,
                    logo = coincidencias.firstOrNull()?.logo ?: item.logo,
                    principal = senales.first(),
                    respaldos = senales.drop(1),   // mismo canal repetido en la lista = respaldo
                )
            }

            else -> null   // YouTube y otros tipos: más adelante
        }
    }
}