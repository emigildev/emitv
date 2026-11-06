package com.emigildev.emitv.data

import com.emigildev.emitv.BuildConfig
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.GET
import retrofit2.http.Query

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

// ---------- Pedidos al servidor ----------

interface XtreamApi {
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
}   // <- acá termina la interface: todo lo de arriba va ADENTRO

// ---------- Punto de acceso para el resto de la app ----------

object Xtream {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val api: XtreamApi by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.XTREAM_URL.trimEnd('/') + "/")
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(XtreamApi::class.java)
    }

    suspend fun categoriasEnVivo(): List<Categoria> {
        require(BuildConfig.XTREAM_URL.isNotBlank()) { "Falta xtream.url en local.properties" }
        return api.categoriasEnVivo(BuildConfig.XTREAM_USER, BuildConfig.XTREAM_PASS)
    }

    suspend fun canales(categoriaId: String): List<Canal> =
        api.canalesEnVivo(BuildConfig.XTREAM_USER, BuildConfig.XTREAM_PASS, categoriaId)
}