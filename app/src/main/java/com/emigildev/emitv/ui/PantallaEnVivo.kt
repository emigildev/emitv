package com.emigildev.emitv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.emigildev.emitv.data.Canal

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PantallaEnVivo(vm: EnVivoViewModel = viewModel()) {
    Row(Modifier.fillMaxSize().padding(32.dp)) {

        // ---------- Izquierda: categorías ----------
        Column(Modifier.width(320.dp).fillMaxHeight()) {
            Text("En vivo", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(16.dp))

            when (val c = vm.categorias) {
                Carga.Cargando -> Text("Cargando categorías…")
                is Carga.Error -> Text("No se pudo conectar:\n${c.mensaje}")
                is Carga.Listo -> LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(c.datos, key = { it.id }) { categoria ->
                        ListItem(
                            selected = categoria.id == vm.categoriaElegida?.id,
                            onClick = { vm.elegir(categoria) },
                            headlineContent = { Text(categoria.nombreLimpio) },
                        )
                    }
                }
            }
        }

        Spacer(Modifier.width(32.dp))

        // ---------- Derecha: canales ----------
        Box(Modifier.weight(1f).fillMaxHeight()) {
            when (val c = vm.canales) {
                null -> Text("Elegí una categoría")
                Carga.Cargando -> Text("Cargando canales…")
                is Carga.Error -> Text("No se pudieron cargar los canales:\n${c.mensaje}")
                is Carga.Listo ->
                    if (c.datos.isEmpty()) {
                        Text("Esta categoría no tiene canales")
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            items(c.datos, key = { it.id }) { canal ->
                                FilaCanal(canal, onClick = { /* Fase 4B: reproducir */ })
                            }
                        }
                    }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun FilaCanal(canal: Canal, onClick: () -> Unit) {
    ListItem(
        selected = false,
        onClick = onClick,
        headlineContent = { Text(canal.nombreLimpio) },
        leadingContent = {
            AsyncImage(
                model = canal.logo?.takeIf { it.isNotBlank() },
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(48.dp),
            )
        },
    )
}