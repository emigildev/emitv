package com.emigildev.emitv.ui

// Sirve para cualquier dato que se descarga: categorías, canales, películas...
sealed interface Carga<out T> {
    data object Cargando : Carga<Nothing>
    data class Listo<T>(val datos: T) : Carga<T>
    data class Error(val mensaje: String) : Carga<Nothing>
}