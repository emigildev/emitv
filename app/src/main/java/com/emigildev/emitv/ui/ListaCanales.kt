package com.emigildev.emitv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.emigildev.emitv.data.CanalEnLista

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ListaCanales(
    canales: List<CanalEnLista>,
    actual: CanalEnLista,
    onElegir: (numero: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val indiceActual = canales.indexOfFirst { it.numero == actual.numero }.coerceAtLeast(0)

    // La lista arranca mostrando el canal actual (con 3 canales de margen arriba).
    val estadoLista = rememberLazyListState(
        initialFirstVisibleItemIndex = (indiceActual - 3).coerceAtLeast(0)
    )
    val focoActual = remember { FocusRequester() }
    var focoInicialHecho by remember { mutableStateOf(false) }

    Column(
        modifier
            .fillMaxHeight()
            .width(460.dp)
            .background(Color.Black.copy(alpha = 0.75f))
            .padding(vertical = 24.dp, horizontal = 16.dp)
    ) {
        Text(
            "Canales",
            style = MaterialTheme.typography.titleLarge,
            color = Color.White,
            modifier = Modifier.padding(start = 12.dp, bottom = 12.dp),
        )
        LazyColumn(state = estadoLista, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            itemsIndexed(canales, key = { _, canal -> canal.numero }) { i, canal ->
                val esActual = i == indiceActual
                ListItem(
                    selected = esActual,
                    onClick = { onElegir(canal.numero) },
                    headlineContent = { Text(canal.nombre, maxLines = 1) },
                    leadingContent = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text("${canal.numero}", modifier = Modifier.width(40.dp))
                            AsyncImage(
                                model = canal.logo?.takeIf { it.isNotBlank() },
                                contentDescription = null,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.size(40.dp),
                            )
                        }
                    },
                    modifier = if (esActual) Modifier.focusRequester(focoActual) else Modifier,
                )
                // Al abrir la lista, poner el foco en el canal actual (una sola vez).
                if (esActual) {
                    LaunchedEffect(Unit) {
                        if (!focoInicialHecho) {
                            focoActual.requestFocus()
                            focoInicialHecho = true
                        }
                    }
                }
            }
        }
    }
}