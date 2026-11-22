package com.emigildev.emitv.data

import android.content.Context

// Los modos posibles. Un enum es una lista cerrada de valores: no puede haber otro.
enum class Modo { SIMPLE, COMPLETO }

data class Config(
    val url: String,
    val usuario: String,
    val clave: String,
    val modo: Modo,
)

// Guarda y lee la configuración en el espacio privado de la app.
class ConfigRepo(context: Context) {
    private val prefs = context.getSharedPreferences("config", Context.MODE_PRIVATE)

    fun leer(): Config? {
        val url = prefs.getString("url", null) ?: return null
        val usuario = prefs.getString("usuario", null) ?: return null
        val clave = prefs.getString("clave", null) ?: return null
        val modo = Modo.entries.firstOrNull { it.name == prefs.getString("modo", null) } ?: Modo.SIMPLE
        return Config(url, usuario, clave, modo)
    }

    fun guardar(config: Config) {
        prefs.edit()
            .putString("url", config.url)
            .putString("usuario", config.usuario)
            .putString("clave", config.clave)
            .putString("modo", config.modo.name)
            .apply()
    }

    fun borrar() {
        prefs.edit().clear().apply()
    }
}