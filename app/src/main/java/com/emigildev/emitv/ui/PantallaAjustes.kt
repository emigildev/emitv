package com.emigildev.emitv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.emigildev.emitv.data.Config
import com.emigildev.emitv.data.InfoCuenta
import com.emigildev.emitv.data.Modo
import com.emigildev.emitv.data.Xtream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import androidx.compose.ui.platform.LocalContext

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PantallaAjustes(
    config: Config,
    onCambiar: (Config) -> Unit,
    onCerrarSesion: () -> Unit,
    onVolver: () -> Unit,
) {
    // Atrás vuelve a la TV.
    BackHandler(onBack = onVolver)

    // Consultar la cuenta al abrir.
    var cuenta by remember { mutableStateOf<Carga<InfoCuenta>>(Carga.Cargando) }
    LaunchedEffect(Unit) {
        cuenta = try {
            Carga.Listo(Xtream.infoCuenta())
        } catch (e: Exception) {
            Carga.Error(e.message ?: e.toString())
        }
    }

    // Cerrar sesión pide confirmación: el primer OK solo "arma" el botón.
    var confirmarCierre by remember { mutableStateOf(false) }

    // Al abrir, el foco arranca en el modo actual.
    val focoInicial = remember { FocusRequester() }
    LaunchedEffect(Unit) { focoInicial.requestFocus() }

    Row(
        Modifier.fillMaxSize().padding(48.dp),
        horizontalArrangement = Arrangement.spacedBy(48.dp),
    ) {
        // ---------- Izquierda: opciones ----------
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val contexto = LocalContext.current
            val version = remember {
                runCatching { contexto.packageManager.getPackageInfo(contexto.packageName, 0).versionName }
                    .getOrNull() ?: "?"
            }
            Text("EmiTV $version", style = MaterialTheme.typography.titleMedium)
            OpcionActualizar()
            Spacer(Modifier.height(8.dp))
            Text("Ajustes", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(8.dp))

            Text("Modo de uso", style = MaterialTheme.typography.titleMedium)
            ListItem(
                selected = config.modo == Modo.SIMPLE,
                onClick = { onCambiar(config.copy(modo = Modo.SIMPLE)) },
                headlineContent = { Text("Simple") },
                supportingContent = { Text("Solo TV en vivo, como una tele de siempre") },
                modifier = if (config.modo == Modo.SIMPLE) Modifier.focusRequester(focoInicial) else Modifier,
            )
            ListItem(
                selected = config.modo == Modo.COMPLETO,
                onClick = { onCambiar(config.copy(modo = Modo.COMPLETO)) },
                headlineContent = { Text("Completo") },
                supportingContent = { Text("TV en vivo, películas y series") },
                modifier = if (config.modo == Modo.COMPLETO) Modifier.focusRequester(focoInicial) else Modifier,
            )

            Spacer(Modifier.height(8.dp))
            Text("Avanzado", style = MaterialTheme.typography.titleMedium)
            ListItem(
                selected = config.diagnostico,
                onClick = { onCambiar(config.copy(diagnostico = !config.diagnostico)) },
                headlineContent = { Text("Mostrar diagnóstico") },
                supportingContent = { Text(if (config.diagnostico) "Activado" else "Desactivado") },
            )
            ListItem(
                selected = false,
                onClick = { if (confirmarCierre) onCerrarSesion() else confirmarCierre = true },
                headlineContent = {
                    Text(if (confirmarCierre) "Presioná OK otra vez para confirmar" else "Cerrar sesión")
                },
                supportingContent = { Text("Borra los datos de acceso de este dispositivo") },
            )
            ListItem(
                selected = false,
                onClick = onVolver,
                headlineContent = { Text("Volver a la TV") },
            )
        }

        // ---------- Derecha: estado de la cuenta ----------
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Cuenta", style = MaterialTheme.typography.titleMedium)
            Text("Servidor: ${config.url}")
            Text("Usuario: ${config.usuario}")
            when (val c = cuenta) {
                Carga.Cargando -> Text("Consultando…")
                is Carga.Error -> Text("No se pudo consultar: ${c.mensaje}")
                is Carga.Listo -> {
                    val info = c.datos
                    Text("Estado: ${info.status ?: "?"}")
                    Text("Vence: ${fecha(info.vencimiento)}")
                    Text("Conexiones en uso: ${info.conexionesActivas ?: "?"} de ${info.maxConexiones ?: "?"}")
                }
            }
        }
    }
}

/** "1797702235" (segundos desde 1970) -> "18/12/2026" */
private fun fecha(segundos: String?): String {
    val s = segundos?.toLongOrNull() ?: return "?"
    return Instant.ofEpochSecond(s)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
}