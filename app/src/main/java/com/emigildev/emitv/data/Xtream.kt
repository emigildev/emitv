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

// 1. El "molde" de una categoría, tal como viene en el JSON de tu servidor.
@Serializable
data class Categoria(
    @SerialName("category_id") val id: String,
    @SerialName("category_name") val nombre: String,
) {
    // Nombre sin emojis ni símbolos: "✴️ Argentina ✴️" -> "Argentina"
    val nombreLimpio: String
        get() = nombre
            .replace(Regex("[^\\p{L}\\p{N} +/.-]"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
}

// 2. Qué pedidos le podemos hacer al servidor.
interface XtreamApi {
    @GET("player_api.php")
    suspend fun categoriasEnVivo(
        @Query("username") usuario: String,
        @Query("password") clave: String,
        @Query("action") accion: String = "get_live_categories",
    ): List<Categoria>
}

// 3. El punto de acceso que usa el resto de la app.
object Xtream {
    private val json = Json { ignoreUnknownKeys = true }

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
}