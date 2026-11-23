package com.emigildev.emitv.ui

import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import com.emigildev.emitv.data.Senal
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

private val http = OkHttpClient.Builder()
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(8, TimeUnit.SECONDS)
    .build()

/** Arma lo que el reproductor necesita para una señal: dirección, tipo de stream y cabeceras. */
@androidx.annotation.OptIn(UnstableApi::class)
suspend fun crearMediaSource(senal: Senal): MediaSource {
    val url: String
    val tipo: String
    val cabeceras: Map<String, String>

    when (senal) {
        is Senal.DeXtream -> {
            url = Xtream.urlEnVivo(senal.canal)
            tipo = if (Xtream.FORMATO_EN_VIVO == "m3u8") MimeTypes.APPLICATION_M3U8 else MimeTypes.VIDEO_MP2T
            cabeceras = emptyMap()
        }
        is Senal.Directa -> {
            val (direccionFinal, tipoDetectado) = resolverDireccion(senal)
            url = direccionFinal
            tipo = tipoDetectado
            cabeceras = senal.cabeceras
        }
    }

    val fabrica = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setDefaultRequestProperties(cabeceras - "User-Agent")
    cabeceras["User-Agent"]?.let { fabrica.setUserAgent(it) }

    val item = MediaItem.Builder().setUri(url).setMimeType(tipo).build()
    return DefaultMediaSourceFactory(fabrica).createMediaSource(item)
}

/**
 * Sigue las redirecciones de una URL directa y averigua qué tipo de stream es.
 * Hace falta porque direcciones como ".../artvDI.php?id=…" no dicen si son HLS o TS,
 * y el reproductor elige cómo leer un stream mirando el final de la dirección.
 */
private suspend fun resolverDireccion(senal: Senal.Directa): Pair<String, String> =
    withContext(Dispatchers.IO) {
        try {
            val pedido = Request.Builder()
                .url(senal.url)
                .apply { senal.cabeceras.forEach { (nombre, valor) -> header(nombre, valor) } }
                .build()
            // execute() vuelve apenas llegan las cabeceras de la respuesta: no descarga el video
            http.newCall(pedido).execute().use { respuesta ->
                val direccionFinal = respuesta.request.url.toString()  // después de redirecciones
                val contenido = respuesta.header("Content-Type").orEmpty().lowercase()
                val ruta = direccionFinal.lowercase().substringBefore('?')
                val tipo = when {
                    ruta.endsWith(".m3u8") || "mpegurl" in contenido -> MimeTypes.APPLICATION_M3U8
                    ruta.endsWith(".ts") || "mp2t" in contenido -> MimeTypes.VIDEO_MP2T
                    ruta.endsWith(".mp4") || "video/mp4" in contenido -> MimeTypes.VIDEO_MP4
                    else -> MimeTypes.APPLICATION_M3U8   // lo más común en canales en vivo
                }
                direccionFinal to tipo
            }
        } catch (e: Exception) {
            // Si no se pudo averiguar, se intenta igual con la dirección original como HLS
            senal.url to MimeTypes.APPLICATION_M3U8
        }
    }