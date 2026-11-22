package com.emigildev.emitv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.emigildev.emitv.data.ConfigRepo
import com.emigildev.emitv.data.Xtream

@Composable
fun App() {
    val context = LocalContext.current
    val repo = remember { ConfigRepo(context.applicationContext) }

    // Al arrancar: leer la configuración guardada y, si hay, aplicarla.
    var config by remember { mutableStateOf(repo.leer()?.also { Xtream.configurar(it) }) }

    if (config == null) {
        PantallaConfiguracion(
            onListo = { nueva ->
                repo.guardar(nueva)
                Xtream.configurar(nueva)
                config = nueva
            }
        )
    } else {
        PantallaTv()
    }
}