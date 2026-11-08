package com.emigildev.emitv.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.emigildev.emitv.data.Canal
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.launch

class TvViewModel : ViewModel() {

    var canales by mutableStateOf<Carga<List<Canal>>>(Carga.Cargando)
        private set

    // Posición en la lista (empieza en 0). El número que ve el usuario es indice + 1.
    var indice by mutableIntStateOf(0)
        private set

    val canalActual: Canal?
        get() = (canales as? Carga.Listo)?.datos?.getOrNull(indice)

    init {
        cargar()
    }

    fun cargar() {
        canales = Carga.Cargando
        viewModelScope.launch {
            canales = try {
                Carga.Listo(Xtream.canales(LISTA_PROVISORIA))
            } catch (e: Exception) {
                Carga.Error(e.message ?: e.toString())
            }
        }
    }

    fun siguiente() = mover(+1)
    fun anterior() = mover(-1)

    private fun mover(paso: Int) {
        val total = (canales as? Carga.Listo)?.datos?.size ?: return
        if (total == 0) return
        // El % hace que después del último vuelva al primero, y al revés.
        indice = (indice + paso + total) % total
    }

    companion object {
        // Provisorio: categoría "Argentina". En la Fase 6 se reemplaza por tu lista.
        const val LISTA_PROVISORIA = "194"
    }
}