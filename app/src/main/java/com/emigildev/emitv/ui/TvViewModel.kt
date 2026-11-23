package com.emigildev.emitv.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.emigildev.emitv.data.CanalEnLista
import com.emigildev.emitv.data.ConfigRepo
import com.emigildev.emitv.data.FuenteGitHub
import com.emigildev.emitv.data.FuenteRemota
import com.emigildev.emitv.data.Modo
import com.emigildev.emitv.data.Xtream
import com.emigildev.emitv.data.resolver
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

class TvViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences("emitv", Context.MODE_PRIVATE)

    // De dónde sale la lista. Para cambiar a otra fuente, se cambia SOLO esta línea.
    private val fuente: FuenteRemota = FuenteGitHub(app)

    // Simple -> lista "simple"; Completo -> lista "completa".
    private val modo = ConfigRepo(app).leer()?.modo ?: Modo.SIMPLE

    // Último canal visto, por número y por modo (las dos listas tienen números distintos).
    private val claveUltimoCanal = "ultimo_numero_${modo.name.lowercase()}"

    var canales by mutableStateOf<Carga<List<CanalEnLista>>>(Carga.Cargando)
        private set

    // Posición en la lista resuelta (empieza en 0).
    var indice by mutableIntStateOf(0)
        private set

    private val lista: List<CanalEnLista>
        get() = (canales as? Carga.Listo)?.datos.orEmpty()

    val canalActual: CanalEnLista?
        get() = lista.getOrNull(indice)

    init {
        cargar()
    }

    fun cargar() {
        canales = Carga.Cargando
        viewModelScope.launch {
            try {
                // Las dos descargas EN PARALELO: tu lista (GitHub) y el catálogo del proveedor.
                // coroutineScope hace que, si una falla, el error llegue a nuestro catch.
                val (listaRemota, catalogo) = coroutineScope {
                    val pedidoLista = async { fuente.obtenerLista() }
                    val pedidoCatalogo = async { Xtream.todosLosCanales() }
                    pedidoLista.await() to pedidoCatalogo.await()
                }

                val items = if (modo == Modo.SIMPLE) listaRemota.simple else listaRemota.completa
                val resueltos = resolver(items, catalogo)

                val ultimo = prefs.getInt(claveUltimoCanal, -1)
                indice = resueltos.indexOfFirst { it.numero == ultimo }.coerceAtLeast(0)
                canales = Carga.Listo(resueltos)
            } catch (e: Exception) {
                canales = Carga.Error(e.message ?: e.toString())
            }
        }
    }

    fun siguiente() = mover(+1)
    fun anterior() = mover(-1)

    /** Va al canal con ese número (el de TU lista). Devuelve false si no existe. */
    fun irANumero(numero: Int): Boolean {
        val posicion = lista.indexOfFirst { it.numero == numero }
        if (posicion < 0) return false
        irA(posicion)
        return true
    }

    private fun mover(paso: Int) {
        val total = lista.size
        if (total == 0) return
        irA((indice + paso + total) % total)
    }

    private fun irA(nuevoIndice: Int) {
        indice = nuevoIndice
        canalActual?.let { canal ->
            prefs.edit().putInt(claveUltimoCanal, canal.numero).apply()
        }
    }
}