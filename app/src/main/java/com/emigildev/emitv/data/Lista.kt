package com.emigildev.emitv.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
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
    // --- tipo "m3u" ---
    val fuente: String? = null,        // qué lista M3U (una de "fuentes")
    val clave: String? = null,         // tvg-id del canal, o su URL si no tiene
    val logo: String? = null,
    // --- cualquier tipo ---
    // Cada respaldo puede ser un número (canal del proveedor IPTV)
    // o un objeto { "tipo": "m3u", "fuente": "...", "clave": "..." }.
    // Por eso se leen como JsonElement: "cualquier valor JSON".
    val respaldos: List<JsonElement> = emptyList(),
)

/** Las fuentes M3U que usa una lista, como canal principal o como respaldo. */
fun fuentesUsadas(items: List<ItemLista>): Set<String> = buildSet {
    for (item in items) {
        if (item.tipo == "m3u") item.fuente?.let { add(it) }
        for (respaldo in item.respaldos) {
            (respaldo as? JsonObject)?.get("fuente")?.jsonPrimitive?.contentOrNull?.let { add(it) }
        }
    }
}

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

private val ENTRE_PARENTESIS = Regex("[\\[(][^\\])]*[\\])]")

/** "AR | Telefe FHD [Backup]" -> "telefe"  ·  "AR | A 24 2" -> "a24" */
fun claveBase(nombre: String): String {
    // Fuera lo que va entre paréntesis o corchetes: "(720p)", "[Not 24/7]", "[Geo-blocked]"…
    var texto = Normalizer.normalize(limpiar(nombre.replace(ENTRE_PARENTESIS, " ")), Normalizer.Form.NFKD)
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

    // Entradas de una M3U: por clave (tvg-id o URL) y, si no hay y se da un nombre, por nombre.
    fun entradasM3u(fuente: String?, clave: String?, nombre: String?): List<EntradaM3u> {
        val entradas = listasM3u[fuente].orEmpty()
        val porClaveM3u = entradas.filter { it.clave == clave }
        if (porClaveM3u.isNotEmpty() || nombre == null) return porClaveM3u
        val claveNombre = claveBase(nombre)
        return if (claveNombre.isEmpty()) emptyList()
        else entradas.filter { claveBase(it.nombre) == claveNombre }
    }

    fun senalesM3u(fuente: String?, clave: String?, nombre: String?): List<Senal> =
        entradasM3u(fuente, clave, nombre)
            .map { Senal.Directa(it.url, it.cabeceras) }
            .ifEmpty {
                // Si la lista no se pudo leer pero la clave ES una URL, se usa directo
                listOfNotNull(clave?.takeIf { it.startsWith("http") }?.let { Senal.Directa(it) })
            }

    // Un respaldo: número (proveedor IPTV) u objeto { tipo, fuente, clave } / { tipo, id }.
    fun senalesDe(respaldo: JsonElement): List<Senal> = when (respaldo) {
        is JsonPrimitive -> listOfNotNull(respaldo.intOrNull?.let { porId[it] }?.let { Senal.DeXtream(it) })
        is JsonObject -> {
            fun texto(campo: String) = respaldo[campo]?.jsonPrimitive?.contentOrNull
            when (texto("tipo")) {
                "m3u" -> senalesM3u(texto("fuente"), texto("clave"), nombre = null)
                "xtream" -> listOfNotNull(texto("id")?.toIntOrNull()?.let { porId[it] }?.let { Senal.DeXtream(it) })
                else -> emptyList()
            }
        }
        else -> emptyList()
    }

    fun logoDe(senal: Senal): String? = (senal as? Senal.DeXtream)?.canal?.logo

    return items.mapIndexedNotNull { i, item ->
        val numero = i + 1

        // 1) El canal principal, según su tipo
        val (principales, logo) = when (item.tipo) {
            "xtream" -> {
                val canal = item.id?.let { porId[it] }   // por id
                    ?: buscarPorNombre(item.original)      // por nombre original
                    ?: buscarPorNombre(item.nombre)        // por el nombre que le pusiste
                listOfNotNull(canal?.let { Senal.DeXtream(it) }) to canal?.logo
            }
            "m3u" -> {
                val entradas = entradasM3u(item.fuente, item.clave, item.nombre)
                senalesM3u(item.fuente, item.clave, item.nombre) to (entradas.firstOrNull()?.logo ?: item.logo)
            }
            else -> return@mapIndexedNotNull null   // YouTube y otros tipos: más adelante
        }

        // 2) Los respaldos, de cualquier fuente y en el orden que elegiste
        val respaldos = item.respaldos.flatMap { senalesDe(it) }

        // 3) Todo junto, sin repetidos. Si el principal no está, el primer respaldo toma su lugar.
        val todas = (principales + respaldos).distinct()
        if (todas.isEmpty()) return@mapIndexedNotNull null

        CanalEnLista(
            numero = numero,
            nombre = item.nombre,
            logo = logo ?: logoDe(todas.first()),
            principal = todas.first(),
            respaldos = todas.drop(1),
        )
    }
}
