package com.emigildev.emitv.data

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Lo que nos interesa de una Release de GitHub. */
@Serializable
private data class Release(
    @SerialName("tag_name") val etiqueta: String,
    val assets: List<Adjunto> = emptyList(),
)

@Serializable
private data class Adjunto(
    val name: String,
    @SerialName("browser_download_url") val url: String,
    val size: Long = 0,
)

/** Una versión más nueva que la instalada, lista para descargar. */
data class VersionNueva(val numero: Int, val nombre: String, val url: String, val tamano: Long)

/**
 * Actualizar la app sin salir de ella, desde las Releases de GitHub
 * (las que publica GitHub Actions cada vez que cambia la app).
 *
 * Android NUNCA deja instalar en silencio: siempre aparece la pantalla del sistema
 * "¿Querés actualizar esta app?" y hay que aceptar. La primera vez, además,
 * hay que darle a EmiTV el permiso de "instalar apps desconocidas".
 */
object Actualizacion {

    private const val URL_ULTIMA = "https://api.github.com/repos/emigildev/emitv/releases/latest"
    private const val NOMBRE_APK = "app-release.apk"

    private val json = Json { ignoreUnknownKeys = true }

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** La versión de prueba (la de Android Studio) no se actualiza desde GitHub: es otra app. */
    fun esVersionDePrueba(context: Context) = context.packageName.endsWith(".debug")

    /** El número de la versión instalada (el "1.0.N" -> N). */
    fun numeroInstalado(context: Context): Long =
        context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode

    /** Pregunta a GitHub cuál es la última versión. Devuelve null si ya tenés la última. */
    suspend fun buscar(context: Context): VersionNueva? = withContext(Dispatchers.IO) {
        if (esVersionDePrueba(context)) return@withContext null
        val pedido = Request.Builder()
            .url(URL_ULTIMA)
            .header("Accept", "application/vnd.github+json")
            .header("Cache-Control", "no-cache")
            .build()
        val texto = http.newCall(pedido).execute().use { respuesta ->
            if (!respuesta.isSuccessful) throw IOException("GitHub respondió ${respuesta.code}")
            respuesta.body?.string() ?: throw IOException("Respuesta vacía de GitHub")
        }
        val release = json.decodeFromString(Release.serializer(), texto)

        // La etiqueta es "v1.0.N": el último número es el de la compilación (= versionCode)
        val numero = release.etiqueta.substringAfterLast('.').toIntOrNull()
            ?: throw IOException("No entiendo la versión \"${release.etiqueta}\"")
        val apk = release.assets.firstOrNull { it.name == NOMBRE_APK }
            ?: throw IOException("La versión ${release.etiqueta} no tiene el APK")

        if (numero <= numeroInstalado(context)) null
        else VersionNueva(numero, release.etiqueta.removePrefix("v"), apk.url, apk.size)
    }

    /** Descarga el APK, avisando el avance (de 0 a 1). Devuelve el archivo descargado. */
    suspend fun descargar(
        context: Context,
        version: VersionNueva,
        alAvanzar: (Float) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val carpeta = File(context.cacheDir, "actualizacion").apply { mkdirs() }
        carpeta.listFiles()?.forEach { it.delete() }   // borrar descargas viejas
        val archivo = File(carpeta, "EmiTV-${version.nombre}.apk")

        val pedido = Request.Builder().url(version.url).build()
        http.newCall(pedido).execute().use { respuesta ->
            if (!respuesta.isSuccessful) throw IOException("La descarga falló (${respuesta.code})")
            val cuerpo = respuesta.body ?: throw IOException("Descarga vacía")
            val total = cuerpo.contentLength().takeIf { it > 0 } ?: version.tamano
            cuerpo.byteStream().use { entrada ->
                archivo.outputStream().use { salida ->
                    val bufer = ByteArray(64 * 1024)
                    var llevamos = 0L
                    var ultimoPorcentaje = -1L
                    while (true) {
                        val leidos = entrada.read(bufer)
                        if (leidos < 0) break
                        salida.write(bufer, 0, leidos)
                        llevamos += leidos
                        // Avisar solo cuando cambia el porcentaje (no miles de veces)
                        val porcentaje = if (total > 0) llevamos * 100 / total else -1
                        if (porcentaje != ultimoPorcentaje) {
                            ultimoPorcentaje = porcentaje
                            alAvanzar(porcentaje / 100f)
                        }
                    }
                }
            }
        }
        // Si se cortó a la mitad, mejor no intentar instalar un archivo roto
        if (version.tamano > 0 && archivo.length() != version.tamano) {
            archivo.delete()
            throw IOException("La descarga quedó incompleta")
        }
        archivo
    }

    /** ¿EmiTV ya tiene permiso para instalar apps? (se da una sola vez por dispositivo) */
    fun tienePermiso(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Abre el ajuste del sistema donde se activa ese permiso para EmiTV. */
    fun abrirAjustePermiso(context: Context): Boolean {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            "package:${context.packageName}".toUri(),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false   // algunas TVs no tienen esa pantalla directa: hay que ir a mano
        }
    }

    /** Abre la pantalla de Android "¿Querés actualizar esta app?". Al terminar ofrece "Abrir". */
    fun instalar(context: Context, archivo: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.archivos", archivo)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
