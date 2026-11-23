package com.emigildev.emitv.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.text.Normalizer

// ---------- Formato de lista.json (lo que exporta la página de curación) ----------

@Serializable
data class ListaRemota(
    val version: Int = 1,
    val actualizado: String? = null,
    val simple: List<ItemLista> = emptyList(),
    val completa: List<ItemLista> = emptyList(),
)

@Serializable
data class ItemLista(
    val tipo: String,
    val nombre: String,
    val id: Int? = null,             // para tipo "xtream"
    val original: String? = null,    // nombre en el proveedor, para buscarlo si cambia el id
    val respaldos: List<Int> = emptyList(),
)

val jsonLista = Json {
    ignoreUnknownKeys = true   // campos futuros (M3U, YouTube) no rompen versiones viejas de la app
    coerceInputValues = true
    isLenient = true
}

// ---------- Un canal de tu lista, ya "resuelto" contra los datos del proveedor ----------

data class CanalEnLista(
    val numero: Int,           // el número que ve el usuario: fijo, aunque falten otros canales
    val nombre: String,        // el nombre que le pusiste en la curación
    val principal: Canal,      // el canal del proveedor que se va a reproducir
    val respaldos: List<Canal>,
) {
    val id: Int get() = principal.id
    val logo: String? get() = principal.logo
}

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

// ---------- Resolver: tu lista + catálogo del proveedor -> canales listos para ver ----------

fun resolver(items: List<ItemLista>, catalogo: List<Canal>): List<CanalEnLista> {
    val porId = catalogo.associateBy { it.id }
    val porClave = catalogo.groupBy { claveBase(it.nombre) }

    fun buscarPorNombre(nombre: String?): Canal? {
        val clave = nombre?.let { claveBase(it) }
        if (clave.isNullOrEmpty()) return null
        return porClave[clave]?.firstOrNull()
    }

    return items.mapIndexedNotNull { i, item ->
        // Por ahora solo canales del proveedor. M3U y YouTube llegan en la 6D.
        if (item.tipo != "xtream") return@mapIndexedNotNull null

        val respaldos = item.respaldos.mapNotNull { porId[it] }
        val principal = item.id?.let { porId[it] }   // 1) por id
            ?: buscarPorNombre(item.original)          // 2) por nombre original
            ?: buscarPorNombre(item.nombre)            // 3) por el nombre que le pusiste
            ?: respaldos.firstOrNull()                 // 4) el primer respaldo
            ?: return@mapIndexedNotNull null           // 5) no hay forma: se omite

        CanalEnLista(
            numero = i + 1,
            nombre = item.nombre,
            principal = principal,
            respaldos = respaldos.filter { it.id != principal.id },
        )
    }
}