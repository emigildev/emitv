package com.emigildev.emitv.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** De dónde salen tu lista y la configuración remota. Hoy GitHub; mañana podría ser otra cosa. */
interface FuenteRemota {
    suspend fun obtenerLista(): ListaRemota
    suspend fun obtenerConfig(): ConfigRemota

    /** Una "huella" por archivo: si alguna cambia, hay algo nuevo para descargar. */
    suspend fun huellas(): Map<String, String>
}

class FuenteGitHub(context: Context) : FuenteRemota {

    private val carpeta = context.filesDir

    override suspend fun obtenerLista(): ListaRemota =
        obtener("datos/lista.json", ListaRemota.serializer())

    override suspend fun obtenerConfig(): ConfigRemota =
        obtener("datos/config.json", ConfigRemota.serializer())

    // Las huellas (sha) de los archivos de datos/, SIN descargar su contenido: un pedido chiquito.
    override suspend fun huellas(): Map<String, String> = withContext(Dispatchers.IO) {
        val texto = pedir("$API/datos", aceptar = "application/vnd.github+json")
        jsonLista.parseToJsonElement(texto).jsonArray.associate { archivo ->
            val datos = archivo.jsonObject
            datos.getValue("path").jsonPrimitive.content to datos.getValue("sha").jsonPrimitive.content
        }
    }

    // Descarga un archivo del repo y lo convierte con "molde".
    // Si no se puede, usa la última copia buena guardada en el dispositivo.
    private suspend fun <T> obtener(ruta: String, molde: KSerializer<T>): T =
        withContext(Dispatchers.IO) {
            val copiaLocal = File(carpeta, ruta.substringAfterLast('/'))
            try {
                val texto = descargar(ruta)
                val datos = jsonLista.decodeFromString(molde, texto)  // si vino roto, falla ACÁ...
                copiaLocal.writeText(texto)                            // ... Y no pisamos la copia buena
                datos
            } catch (e: Exception) {
                if (copiaLocal.exists()) jsonLista.decodeFromString(molde, copiaLocal.readText())
                else throw e
            }
        }

    // 1º la API de GitHub (cambios casi al instante).
    // Si falla (por ejemplo, por límite de pedidos), raw.githubusercontent (puede demorar unos minutos).
    private fun descargar(ruta: String): String =
        try {
            pedir("$API/$ruta", aceptar = "application/vnd.github.raw+json")
        } catch (e: Exception) {
            pedir("$RAW/$ruta", aceptar = null)
        }

    private fun pedir(url: String, aceptar: String?): String {
        val pedido = Request.Builder()
            .url(url)
            .header("Cache-Control", "no-cache")
            .apply { if (aceptar != null) header("Accept", aceptar) }
            .build()
        http.newCall(pedido).execute().use { respuesta ->
            if (!respuesta.isSuccessful) throw IOException("HTTP ${respuesta.code} en $url")
            return respuesta.body?.string() ?: throw IOException("Respuesta vacía de $url")
        }
    }

    companion object {
        private const val API = "https://api.github.com/repos/emigildev/emitv/contents"
        private const val RAW = "https://raw.githubusercontent.com/emigildev/emitv/main"

        private val http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .callTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}