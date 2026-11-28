package com.emigildev.emitv.ui

import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.emigildev.emitv.data.Actualizacion
import com.emigildev.emitv.data.Config
import com.emigildev.emitv.data.ConfigRepo
import com.emigildev.emitv.data.Modo
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.delay

@Composable
fun App() {
    val context = LocalContext.current
    val repo = remember { ConfigRepo(context.applicationContext) }

    // Al arrancar: leer la configuración guardada y, si hay, aplicarla.
    var config by remember { mutableStateOf(repo.leer()?.also { Xtream.configurar(it) }) }
    var enAjustes by remember { mutableStateOf(false) }

    // Un solo lugar para cambiar la configuración: guarda, aplica y actualiza la pantalla.
    fun actualizar(nueva: Config?) {
        if (nueva == null) {
            repo.borrar()
        } else {
            repo.guardar(nueva)
            Xtream.configurar(nueva)
        }
        config = nueva
    }

    // Aviso de versión nueva: SOLO en modo Completo (en Simple no aparece nada que confunda).
    // Se fija al abrir la app y después cada 6 horas; avisa una sola vez por versión.
    val modoActual by rememberUpdatedState(config?.modo)
    LaunchedEffect(Unit) {
        var yaAvisada = 0
        while (true) {
            if (modoActual == Modo.COMPLETO) {
                val nueva = runCatching { Actualizacion.buscar(context) }.getOrNull()
                if (nueva != null && nueva.numero != yaAvisada) {
                    yaAvisada = nueva.numero
                    Toast.makeText(
                        context,
                        "Hay una versión nueva de EmiTV (${nueva.nombre}). " +
                            "Para instalarla: mantené OK 3 segundos y entrá a Ajustes.",
                        Toast.LENGTH_LONG,
                    ).show()
                }
            }
            delay(6 * 60 * 60_000L)
        }
    }

    val actual = config
    when {
        actual == null -> PantallaConfiguracion(
            onListo = { actualizar(it) },
        )
        enAjustes -> PantallaAjustes(
            config = actual,
            onCambiar = { actualizar(it) },
            onCerrarSesion = {
                actualizar(null)
                enAjustes = false
            },
            onVolver = { enAjustes = false },
        )
        else -> PantallaTv(
            // Un ViewModel por cuenta: si cerrás sesión y entrás con otra, no quedan sus canales viejos.
            vm = viewModel(key = "${actual.url}|${actual.usuario}|${actual.modo}"),
            mostrarDiagnostico = actual.diagnostico,
            onAjustes = {
                config = repo.leer()   // por si la TV adoptó un servidor remoto nuevo
                enAjustes = true
            },
        )
    }
}