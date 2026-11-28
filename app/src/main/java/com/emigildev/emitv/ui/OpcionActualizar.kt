package com.emigildev.emitv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.ListItem
import androidx.tv.material3.Text
import com.emigildev.emitv.data.Actualizacion
import com.emigildev.emitv.data.VersionNueva
import kotlinx.coroutines.launch
import java.io.File

/** Los pasos de una actualización, de principio a fin. */
private sealed interface Paso {
    data object Buscando : Paso
    data object AlDia : Paso
    data object VersionDePrueba : Paso
    data class Disponible(val version: VersionNueva) : Paso
    data class FaltaPermiso(val version: VersionNueva) : Paso
    data class Descargando(val version: VersionNueva, val avance: Float) : Paso
    data class Descargada(val version: VersionNueva, val archivo: File) : Paso
    data class Fallo(val mensaje: String) : Paso
}

/** La opción "Actualizar EmiTV" de Ajustes: busca, descarga y abre el instalador de Android. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun OpcionActualizar(modifier: Modifier = Modifier) {
    val contexto = LocalContext.current
    val alcance = rememberCoroutineScope()
    var paso by remember { mutableStateOf<Paso>(Paso.Buscando) }

    fun buscar() {
        if (Actualizacion.esVersionDePrueba(contexto)) {
            paso = Paso.VersionDePrueba
            return
        }
        paso = Paso.Buscando
        alcance.launch {
            paso = try {
                Actualizacion.buscar(contexto)?.let { Paso.Disponible(it) } ?: Paso.AlDia
            } catch (e: Exception) {
                Paso.Fallo("No se pudo consultar: ${e.message}")
            }
        }
    }

    fun descargarEInstalar(version: VersionNueva) {
        // Sin permiso: llevar al ajuste del sistema. Al volver, se sigue solo (ver abajo).
        if (!Actualizacion.tienePermiso(contexto)) {
            paso = Paso.FaltaPermiso(version)
            Actualizacion.abrirAjustePermiso(contexto)
            return
        }
        paso = Paso.Descargando(version, 0f)
        alcance.launch {
            paso = try {
                val archivo = Actualizacion.descargar(contexto, version) { avance ->
                    paso = Paso.Descargando(version, avance)
                }
                Actualizacion.instalar(contexto, archivo)
                Paso.Descargada(version, archivo)
            } catch (e: Exception) {
                Paso.Fallo("No se pudo descargar: ${e.message}")
            }
        }
    }

    // Al abrir Ajustes, fijarse si hay versión nueva
    LaunchedEffect(Unit) { buscar() }

    // Al volver del ajuste del permiso: si ya lo diste, seguir con la descarga sin pedir otro OK
    LifecycleResumeEffect(paso) {
        val actual = paso
        if (actual is Paso.FaltaPermiso && Actualizacion.tienePermiso(contexto)) {
            descargarEInstalar(actual.version)
        }
        onPauseOrDispose { }
    }

    val (titulo, detalle) = when (val p = paso) {
        Paso.Buscando -> "Buscando actualizaciones…" to null
        Paso.AlDia -> "EmiTV está al día" to "OK para volver a buscar"
        Paso.VersionDePrueba -> "Versión de prueba" to "Esta se actualiza desde Android Studio"
        is Paso.Disponible -> "Actualizar a la versión ${p.version.nombre}" to
            "OK para descargarla e instalarla"
        is Paso.FaltaPermiso -> "Falta un permiso (una sola vez)" to
            "Activá \"Permitir de esta fuente\" para EmiTV y volvé con Atrás. Si no se abrió solo: " +
            "Ajustes de la TV → Apps → Seguridad → Fuentes desconocidas → EmiTV"
        is Paso.Descargando -> "Descargando ${p.version.nombre}… ${(p.avance.coerceIn(0f, 1f) * 100).toInt()} %" to null
        is Paso.Descargada -> "Instalando ${p.version.nombre}" to
            "Aceptá en la pantalla de Android. Si la cerraste, OK para abrirla otra vez"
        is Paso.Fallo -> p.mensaje to "OK para reintentar"
    }

    ListItem(
        selected = paso is Paso.Disponible,
        onClick = {
            when (val p = paso) {
                Paso.AlDia, is Paso.Fallo -> buscar()
                is Paso.Disponible -> descargarEInstalar(p.version)
                is Paso.FaltaPermiso -> descargarEInstalar(p.version)
                is Paso.Descargada -> runCatching { Actualizacion.instalar(contexto, p.archivo) }
                    .onFailure { paso = Paso.Fallo("No se pudo abrir el instalador: ${it.message}") }
                else -> Unit   // buscando o descargando: esperar
            }
        },
        headlineContent = { Text(titulo) },
        supportingContent = { if (detalle != null) Text(detalle) },
        modifier = modifier,
    )
}
