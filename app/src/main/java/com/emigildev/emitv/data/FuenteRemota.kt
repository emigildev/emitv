package com.emigildev.emitv.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** De dónde sale tu lista de canales. Hoy GitHub; mañana podría ser Firebase. */
interface FuenteRemota {
    suspend fun obtenerLista(): ListaRemota
}

class FuenteGitHub(context: Context) : FuenteRemota {

    // Copia de la última lista que se descargó BIEN, para cuando GitHub no responde.
    private val copiaLocal = File(context.filesDir, "lista.json")

    override suspend fun obtenerLista(): ListaRemota = withContext(Dispatchers.IO) {
        try {
            val texto = descargar()
            val lista = decodificar(texto)  // si el archivo vino roto, falla ACÁ...
            copiaLocal.writeText(texto)     // ...y no pisamos la copia buena
            lista
        } catch (e: Exception) {
            if (copiaLocal.exists()) decodificar(copiaLocal.readText()) else throw e
        }
    }

    private fun decodificar(texto: String): ListaRemota =
        jsonLista.decodeFromString(ListaRemota.serializer(), texto)

    private fun descargar(): String {
        val pedido = Request.Builder().url(URL_LISTA).build()
        http.newCall(pedido).execute().use { respuesta ->
            if (!respuesta.isSuccessful) {
                throw IOException("No se pudo descargar la lista (HTTP ${respuesta.code})")
            }
            return respuesta.body?.string() ?: throw IOException("La lista llegó vacía")
        }
    }

    companion object {
        const val URL_LISTA = "https://raw.githubusercontent.com/emigildev/emitv/main/datos/lista.json"

        private val http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .callTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}