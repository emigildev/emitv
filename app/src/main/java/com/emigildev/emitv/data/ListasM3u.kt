package com.emigildev.emitv.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Un canal de una lista M3U. */
data class EntradaM3u(
    val nombre: String,
    val logo: String?,
    val tvgId: String?,
    val url: String,
    val cabeceras: Map<String, String>,   // por ejemplo Referer o User-Agent (#EXTVLCOPT)
) {
    /** La misma "clave" que usa la página de curación: el tvg-id si hay; si no, la URL. */
    val clave: String get() = tvgId ?: url
}

/**
 * Lee el texto de una lista M3U. Cada canal ocupa (al menos) dos líneas:
 *   #EXTINF:-1 tvg-id="Encuentro.ar" tvg-logo="…" group-title="Cultura",Encuentro
 *   https://…/playlist.m3u8
 */
fun parsearM3u(texto: String): List<EntradaM3u> {
    val entradas = mutableListOf<EntradaM3u>()
    var extinf: String? = null                      // la línea #EXTINF del canal en curso
    val cabeceras = mutableMapOf<String, String>()

    for (lineaCruda in texto.lineSequence()) {
        val linea = lineaCruda.trim()
        when {
            linea.startsWith("#EXTINF") -> {
                extinf = linea
                cabeceras.clear()
            }
            linea.startsWith("#EXTVLCOPT:") && extinf != null -> {
                val opcion = linea.removePrefix("#EXTVLCOPT:")
                val valor = opcion.substringAfter("=")
                when (opcion.substringBefore("=")) {
                    "http-referrer" -> cabeceras["Referer"] = valor
                    "http-user-agent" -> cabeceras["User-Agent"] = valor
                }
            }
            linea.isNotEmpty() && !linea.startsWith("#") && extinf != null -> {
                // El nombre va después de la coma que sigue a los atributos (puede tener comas)
                val coma = extinf.indexOf(',', extinf.lastIndexOf('"') + 1)
                entradas += EntradaM3u(
                    nombre = if (coma >= 0) extinf.substring(coma + 1).trim() else "",
                    logo = atributo(extinf, "tvg-logo"),
                    tvgId = atributo(extinf, "tvg-id"),
                    url = linea,
                    cabeceras = cabeceras.toMap(),
                )
                extinf = null
            }
        }
    }
    return entradas
}

/** El valor de un atributo como tvg-logo="…", o null si no está o está vacío. */
private fun atributo(linea: String, nombre: String): String? =
    Regex("$nombre=\"([^\"]*)\"").find(linea)?.groupValues?.get(1)?.takeIf { it.isNotBlank() }

/** Descarga listas M3U, con copia local por si el sitio no responde. */
class ListasM3u(context: Context) {

    private val carpeta = context.filesDir

    suspend fun obtener(fuente: String, url: String): List<EntradaM3u> = withContext(Dispatchers.IO) {
        val copiaLocal = File(carpeta, "m3u_$fuente.m3u")
        try {
            val texto = descargar(url)
            val entradas = parsearM3u(texto)
            if (entradas.isEmpty()) throw IOException("La lista $fuente llegó vacía")
            copiaLocal.writeText(texto)   // solo si se pudo leer: no pisar la copia buena
            entradas
        } catch (e: Exception) {
            if (copiaLocal.exists()) parsearM3u(copiaLocal.readText()) else throw e
        }
    }

    private fun descargar(url: String): String {
        val pedido = Request.Builder().url(url).build()
        http.newCall(pedido).execute().use { respuesta ->
            if (!respuesta.isSuccessful) throw IOException("HTTP ${respuesta.code} en $url")
            return respuesta.body?.string() ?: throw IOException("Respuesta vacía de $url")
        }
    }

    companion object {
        private val http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()
    }
}