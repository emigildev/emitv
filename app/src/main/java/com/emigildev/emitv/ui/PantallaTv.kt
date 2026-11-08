package com.emigildev.emitv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.emigildev.emitv.data.Canal
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.delay
import android.view.LayoutInflater
import com.emigildev.emitv.R

@Composable
fun PantallaTv(vm: TvViewModel = viewModel()) {
    when (val c = vm.canales) {
        Carga.Cargando -> Mensaje("Cargando canales…")
        is Carga.Error -> Mensaje("No se pudo conectar:\n${c.mensaje}")
        is Carga.Listo -> {
            val canal = vm.canalActual
            if (canal == null) {
                Mensaje("No hay canales para mostrar")
            } else {
                Reproductor(
                    canal = canal,
                    numero = vm.indice + 1,
                    onArriba = vm::siguiente,
                    onAbajo = vm::anterior,
                )
            }
        }
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun Reproductor(canal: Canal, numero: Int, onArriba: () -> Unit, onAbajo: () -> Unit) {
    val context = LocalContext.current

    // 1. Crear el reproductor UNA vez y liberarlo al salir.
    val player = remember {
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build()
    }
    DisposableEffect(player) {
        onDispose { player.release() }
    }

    // 2. Pausar si la app pasa a segundo plano (botón Inicio) y seguir al volver.
    LifecycleStartEffect(player) {
        player.play()
        onStopOrDispose { player.pause() }
    }

    // 3. Escuchar errores de reproducción para mostrarlos en pantalla.
    var error by remember { mutableStateOf<String?>(null) }
    var estado by remember { mutableStateOf("") }
    DisposableEffect(player) {
        val escucha = object : Player.Listener {
            override fun onPlayerError(e: PlaybackException) {
                error = "${e.errorCodeName}\n${e.cause?.message ?: ""}"
            }
            override fun onPlaybackStateChanged(state: Int) {
                estado = when (state) {
                    Player.STATE_BUFFERING -> "Cargando…"
                    Player.STATE_READY -> "Reproduciendo"
                    Player.STATE_ENDED -> "Terminó"
                    else -> "Detenido"
                }
            }
        }
        player.addListener(escucha)
        onDispose { player.removeListener(escucha) }
    }

    // 4. Cada vez que cambia el canal: cargar su URL y reproducir.
    LaunchedEffect(canal.id) {
        error = null
        val item = MediaItem.Builder()
            .setUri(Xtream.urlEnVivo(canal))
            .setMimeType(
                if (Xtream.FORMATO_EN_VIVO == "m3u8") MimeTypes.APPLICATION_M3U8
                else MimeTypes.VIDEO_MP2T
            )
            .build()
        player.setMediaItem(item)
        player.prepare()
        player.playWhenReady = true
    }

    // 5. Mostrar el cartel 3 segundos después de cada cambio.
    var mostrarCartel by remember { mutableStateOf(true) }
    LaunchedEffect(canal.id) {
        mostrarCartel = true
        delay(3000)
        mostrarCartel = false
    }

    // 6. Pedir el foco para recibir las teclas del control.
    val foco = remember { FocusRequester() }
    LaunchedEffect(Unit) { foco.requestFocus() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onKeyEvent { evento ->
                if (evento.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (evento.key) {
                    Key.DirectionUp -> { onArriba(); true }
                    Key.DirectionDown -> { onAbajo(); true }
                    else -> false
                }
            }
            .focusRequester(foco)
            .focusable()
    ) {
        AndroidView(
            factory = { ctx ->
                val vista = LayoutInflater.from(ctx).inflate(R.layout.reproductor, null) as PlayerView
                vista.player = player
                vista
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (mostrarCartel) {
            Cartel(canal, numero, Modifier.align(Alignment.TopStart))
        }

        error?.let {
            Text(
                "No se pudo reproducir:\n$it",
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(Color.Black.copy(alpha = 0.7f))
                    .padding(24.dp),
            )
        }
        // Diagnóstico provisorio (lo sacamos más adelante)
        val video = player.videoFormat
        Text(
            "$estado · ${video?.sampleMimeType ?: "?"} · ${video?.height ?: "?"}p",
            color = Color.White,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .background(Color.Black.copy(alpha = 0.6f))
                .padding(8.dp),
        )
    }
}

@Composable
fun Cartel(canal: Canal, numero: Int, modifier: Modifier = Modifier) {
    Row(
        modifier
            .padding(32.dp)
            .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("$numero", style = MaterialTheme.typography.displaySmall, color = Color.White)
        AsyncImage(
            model = canal.logo?.takeIf { it.isNotBlank() },
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(56.dp),
        )
        Text(canal.nombreLimpio, style = MaterialTheme.typography.headlineSmall, color = Color.White)
    }
}

@Composable
fun Mensaje(texto: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(texto)
    }
}