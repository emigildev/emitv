package com.emigildev.emitv.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.GET
import retrofit2.http.Query
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

// Quita emojis y símbolos: "✴️ Argentina ✴️" -> "Argentina"
fun limpiar(texto: String): String =
    texto
        .replace(Regex("[^\\p{L}\\p{N} +/.-]"), "")
        .replace(Regex("\\s+"), " ")
        .trim()

// ---------- Moldes de datos ----------

@Serializable
data class Categoria(
    @SerialName("category_id") val id: String,
    @SerialName("category_name") val nombre: String,
) {
    val nombreLimpio: String
        get() = limpiar(nombre)
}

@Serializable
data class Canal(
    @SerialName("stream_id") val id: Int,
    @SerialName("name") val nombre: String,
    @SerialName("stream_icon") val logo: String? = null,
    @SerialName("epg_channel_id") val epgId: String? = null,
) {
    val nombreLimpio: String
        get() = limpiar(nombre)
}

// Datos de la cuenta (lo que viene en "user_info").
@Serializable
data class InfoCuenta(
    val auth: Int = 0,
    val status: String? = null,
    @SerialName("exp_date") val vencimiento: String? = null,
    @SerialName("max_connections") val maxConexiones: String? = null,
    @SerialName("active_cons") val conexionesActivas: String? = null,
)

@Serializable
data class RespuestaCuenta(
    @SerialName("user_info") val cuenta: InfoCuenta = InfoCuenta(),
)

// ---------- Pedidos al servidor ----------

interface XtreamApi {
    @GET("player_api.php")
    suspend fun cuenta(
        @Query("username") usuario: String,
        @Query("password") clave: String,
    ): RespuestaCuenta

    @GET("player_api.php")
    suspend fun categoriasEnVivo(
        @Query("username") usuario: String,
        @Query("password") clave: String,
        @Query("action") accion: String = "get_live_categories",
    ): List<Categoria>

    @GET("player_api.php")
    suspend fun canalesEnVivo(
        @Query("username") usuario: String,
        @Query("password") clave: String,
        @Query("category_id") categoriaId: String,
        @Query("action") accion: String = "get_live_streams",
    ): List<Canal>

    @GET("player_api.php")
    suspend fun todosLosCanalesEnVivo(
        @Query("username") usuario: String,
        @Query("password") clave: String,
        @Query("action") accion: String = "get_live_streams",
    ): List<Canal>
}

// ---------- Punto de acceso para el resto de la app ----------

object Xtream {
    // "ts" o "m3u8". Los paneles XUI suelen andar mejor con "ts".
    const val FORMATO_EN_VIVO = "ts"

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private var config: Config? = null
    private var api: XtreamApi? = null

    /** Se llama al arrancar (con la config guardada) o después del login. */
    fun configurar(nueva: Config) {
        config = nueva
        api = crearApi(nueva.url)
    }

    /** "miservidor.com/" -> "https://miservidor.com" */
    fun normalizar(url: String): String {
        val limpia = url.trim().trimEnd('/')
        return if (limpia.startsWith("http://") || limpia.startsWith("https://")) limpia
        else "https://$limpia"
    }

    // Límites de tiempo para no quedar esperando para siempre.
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS) // para establecer la conexión
        .readTimeout(15, TimeUnit.SECONDS)    // sin recibir ningún dato
        .callTimeout(20, TimeUnit.SECONDS)    // límite TOTAL del pedido, pase lo que pase
        .build()

    private fun crearApi(url: String): XtreamApi =
        Retrofit.Builder()
            .baseUrl(normalizar(url) + "/")
            .client(http)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(XtreamApi::class.java)

    private fun cfg(): Config = checkNotNull(config) { "La app todavía no está configurada" }
    private fun api(): XtreamApi = checkNotNull(api) { "La app todavía no está configurada" }

    /** Prueba datos de acceso SIN guardarlos. Se usa en la pantalla de configuración. */
    suspend fun probar(url: String, usuario: String, clave: String): InfoCuenta =
        crearApi(url).cuenta(usuario, clave).cuenta

    /** Datos de la cuenta configurada: estado, vencimiento, conexiones. */
    suspend fun infoCuenta(): InfoCuenta =
        api().cuenta(cfg().usuario, cfg().clave).cuenta

    suspend fun categoriasEnVivo(): List<Categoria> =
        api().categoriasEnVivo(cfg().usuario, cfg().clave)

    suspend fun canales(categoriaId: String): List<Canal> =
        api().canalesEnVivo(cfg().usuario, cfg().clave, categoriaId)

    suspend fun todosLosCanales(): List<Canal> =
        api().todosLosCanalesEnVivo(cfg().usuario, cfg().clave)

    fun urlEnVivo(canal: Canal): String {
        val c = cfg()
        return "${normalizar(c.url)}/live/${c.usuario}/${c.clave}/${canal.id}.$FORMATO_EN_VIVO"
    }
}