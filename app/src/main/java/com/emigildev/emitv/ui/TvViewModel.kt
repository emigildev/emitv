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
import android.widget.Toast
import com.emigildev.emitv.data.ConfigRemota
import com.emigildev.emitv.data.ListasM3u

class TvViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences("emitv", Context.MODE_PRIVATE)

    // De dónde sale la lista. Para cambiar a otra fuente, se cambia SOLO esta línea.
    private val fuente: FuenteRemota = FuenteGitHub(app)

    private val listasM3u = ListasM3u(app)

    private val configRepo = ConfigRepo(app)

    // Simple -> lista "simple"; Completo -> lista "completa".
    private val modo = configRepo.leer()?.modo ?: Modo.SIMPLE

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
                // 1) En paralelo: tu lista y la configuración remota (las dos de GitHub).
                val (listaRemota, configRemota) = coroutineScope {
                    val pedidoLista = async { fuente.obtenerLista() }
                    // Si config.json no existe o falla, seguimos con el servidor que ya teníamos.
                    val pedidoConfig = async { runCatching { fuente.obtenerConfig() }.getOrNull() }
                    pedidoLista.await() to pedidoConfig.await()
                }

                // 2) Si cambió el servidor, aplicarlo ANTES de pedirle los canales.
                aplicarServidorRemoto(configRemota)

                val items = if (modo == Modo.SIMPLE) listaRemota.simple else listaRemota.completa

                // 3) En paralelo: el catálogo del proveedor y las listas M3U que usa tu lista.
                //    Si una falla, seguimos con las demás: un problema en una no deja sin TV.
                val fuentesUsadas = items.filter { it.tipo == "m3u" }.mapNotNull { it.fuente }.toSet()
                val (catalogo, m3u) = coroutineScope {
                    val pedidoCatalogo = async { runCatching { Xtream.todosLosCanales() } }
                    val pedidosM3u = fuentesUsadas.associateWith { nombreFuente ->
                        async {
                            val url = listaRemota.fuentes[nombreFuente]
                            if (url == null) emptyList()
                            else runCatching { listasM3u.obtener(nombreFuente, url) }.getOrDefault(emptyList())
                        }
                    }
                    pedidoCatalogo.await() to pedidosM3u.mapValues { it.value.await() }
                }

                val resueltos = resolver(items, catalogo.getOrDefault(emptyList()), m3u)
                // Si no quedó ningún canal y el proveedor falló, mostrar ese error
                if (resueltos.isEmpty()) catalogo.exceptionOrNull()?.let { throw it }

                val ultimo = prefs.getInt(claveUltimoCanal, -1)
                indice = resueltos.indexOfFirst { it.numero == ultimo }.coerceAtLeast(0)
                canales = Carga.Listo(resueltos)
            } catch (e: Exception) {
                canales = Carga.Error(e.message ?: e.toString())
            }
        }
    }

    // Si config.json trae un servidor distinto al guardado en esta TV, lo adopta y avisa.
    private fun aplicarServidorRemoto(remota: ConfigRemota?) {
        val nuevo = remota?.servidor
            ?.takeIf { it.isNotBlank() }
            ?.let { Xtream.normalizar(it) }
            ?: return
        val actual = configRepo.leer() ?: return
        if (Xtream.normalizar(actual.url) == nuevo) return

        val actualizada = actual.copy(url = nuevo)
        configRepo.guardar(actualizada)
        Xtream.configurar(actualizada)
        Toast.makeText(getApplication(), "Servidor actualizado: $nuevo", Toast.LENGTH_LONG).show()
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