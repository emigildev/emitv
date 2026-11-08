package com.emigildev.emitv.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.emigildev.emitv.data.Canal
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.launch

class TvViewModel(app: Application) : AndroidViewModel(app) {

    // Pequeño "cuaderno" del dispositivo donde guardamos datos simples.
    private val prefs = app.getSharedPreferences("emitv", Context.MODE_PRIVATE)

    var canales by mutableStateOf<Carga<List<Canal>>>(Carga.Cargando)
        private set

    // Posición en la lista (empieza en 0). El número que ve el usuario es indice + 1.
    var indice by mutableIntStateOf(0)
        private set

    private val lista: List<Canal>
        get() = (canales as? Carga.Listo)?.datos.orEmpty()

    val canalActual: Canal?
        get() = lista.getOrNull(indice)

    init {
        cargar()
    }

    fun cargar() {
        canales = Carga.Cargando
        viewModelScope.launch {
            try {
                val nuevos = Xtream.canales(LISTA_PROVISORIA)
                // Buscamos el último canal visto. Guardamos su ID (no su posición)
                // porque si la lista cambia de orden, el ID sigue siendo el mismo.
                val ultimoId = prefs.getInt(CLAVE_ULTIMO_CANAL, -1)
                indice = nuevos.indexOfFirst { it.id == ultimoId }.coerceAtLeast(0)
                canales = Carga.Listo(nuevos)
            } catch (e: Exception) {
                canales = Carga.Error(e.message ?: e.toString())
            }
        }
    }

    fun siguiente() = mover(+1)
    fun anterior() = mover(-1)

    /** Va al canal con ese número. Devuelve false si no existe. */
    fun irANumero(numero: Int): Boolean {
        if (numero !in 1..lista.size) return false
        irA(numero - 1)
        return true
    }

    private fun mover(paso: Int) {
        val total = lista.size
        if (total == 0) return
        // El % hace que después del último vuelva al primero, y al revés.
        irA((indice + paso + total) % total)
    }

    private fun irA(nuevoIndice: Int) {
        indice = nuevoIndice
        canalActual?.let { canal ->
            prefs.edit().putInt(CLAVE_ULTIMO_CANAL, canal.id).apply()
        }
    }

    companion object {
        // Provisorio: categoría "Argentina". En la Fase 6 se reemplaza por tu lista.
        const val LISTA_PROVISORIA = "194"
        private const val CLAVE_ULTIMO_CANAL = "ultimo_canal"
    }
}