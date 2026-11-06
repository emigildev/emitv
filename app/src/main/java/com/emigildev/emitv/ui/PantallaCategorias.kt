package com.emigildev.emitv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.emigildev.emitv.data.Categoria
import com.emigildev.emitv.data.Seleccion
import com.emigildev.emitv.data.Xtream

// Los tres estados posibles de la pantalla.
sealed interface EstadoCategorias {
    data object Cargando : EstadoCategorias
    data class Listo(val categorias: List<Categoria>) : EstadoCategorias
    data class Error(val mensaje: String) : EstadoCategorias
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PantallaCategorias() {
    var estado by remember { mutableStateOf<EstadoCategorias>(EstadoCategorias.Cargando) }

    // Se ejecuta una sola vez, cuando aparece la pantalla.
    LaunchedEffect(Unit) {
        estado = try {
            EstadoCategorias.Listo(Seleccion.filtrar(Xtream.categoriasEnVivo()))
        } catch (e: Exception) {
            EstadoCategorias.Error(e.message ?: e.toString())
        }
    }

    Box(Modifier.fillMaxSize().padding(48.dp)) {
        when (val e = estado) {
            EstadoCategorias.Cargando -> Text("Cargando categorías…")

            is EstadoCategorias.Error -> Text("No se pudo conectar:\n${e.mensaje}")

            is EstadoCategorias.Listo -> Column {
                Text("En vivo", style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.height(16.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(e.categorias, key = { it.id }) { categoria ->
                        ListItem(
                            selected = false,
                            onClick = { /* Fase 4: abrir los canales */ },
                            headlineContent = { Text(categoria.nombreLimpio) },
                        )
                    }
                }
            }
        }
    }
}