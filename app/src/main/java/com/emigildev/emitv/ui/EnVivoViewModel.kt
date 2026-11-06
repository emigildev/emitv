package com.emigildev.emitv.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.emigildev.emitv.data.Canal
import com.emigildev.emitv.data.Categoria
import com.emigildev.emitv.data.Seleccion
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.launch

class EnVivoViewModel : ViewModel() {

    // Estado que la pantalla puede LEER, pero solo el ViewModel puede CAMBIAR (private set).
    var categorias by mutableStateOf<Carga<List<Categoria>>>(Carga.Cargando)
        private set

    var categoriaElegida by mutableStateOf<Categoria?>(null)
        private set

    var canales by mutableStateOf<Carga<List<Canal>>?>(null)
        private set

    // Canales ya descargados, por id de categoría.
    private val cache = mutableMapOf<String, List<Canal>>()

    init {
        cargarCategorias()
    }

    fun cargarCategorias() {
        categorias = Carga.Cargando
        viewModelScope.launch {
            categorias = try {
                Carga.Listo(Seleccion.filtrar(Xtream.categoriasEnVivo()))
            } catch (e: Exception) {
                Carga.Error(e.message ?: e.toString())
            }
        }
    }

    fun elegir(categoria: Categoria) {
        categoriaElegida = categoria

        // ¿Ya la descargamos antes? La usamos directo.
        cache[categoria.id]?.let {
            canales = Carga.Listo(it)
            return
        }

        canales = Carga.Cargando
        viewModelScope.launch {
            val resultado = try {
                val lista = Xtream.canales(categoria.id)
                cache[categoria.id] = lista
                Carga.Listo(lista)
            } catch (e: Exception) {
                Carga.Error(e.message ?: e.toString())
            }
            // Si mientras descargaba se eligió otra categoría, ignoramos esta respuesta.
            if (categoriaElegida?.id == categoria.id) {
                canales = resultado
            }
        }
    }
}