package com.emigildev.emitv.ui

import android.view.KeyEvent
import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.input.key.KeyEventType
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
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.emigildev.emitv.R
import com.emigildev.emitv.data.CanalEnLista
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.delay

// Teclas que cuentan como "OK" según el control.
private val TECLAS_OK = setOf(
    KeyEvent.KEYCODE_DPAD_CENTER,
    KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_NUMPAD_ENTER,
)
// Cuánto hay que mantener OK apretado para abrir los ajustes.
private const val MS_OK_LARGO = 3000L

@Composable
fun PantallaTv(
    vm: TvViewModel = viewModel(),
    mostrarDiagnostico: Boolean = false,
    onAjustes: () -> Unit = {},
) {
    when (val c = vm.canales) {
        Carga.Cargando -> Mensaje("Cargando canales…")
        is Carga.Error -> Mensaje("No se pudo conectar:\n${c.mensaje}")
        is Carga.Listo -> {
            val canal = vm.canalActual
            if (canal == null) {
                Mensaje("Tu lista está vacía o ningún canal está disponible ahora.")
            } else {
                Reproductor(
                    canales = c.datos,                // NUEVO
                    canal = canal,
                    numero = canal.numero,
                    onSiguiente = vm::siguiente,
                    onAnterior = vm::anterior,
                    onNumero = vm::irANumero,
                    mostrarDiagnostico = mostrarDiagnostico,
                    onAjustes = onAjustes,
                )
            }
        }
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun Reproductor(
    canales: List<CanalEnLista>,
    canal: CanalEnLista,
    numero: Int,
    onSiguiente: () -> Unit,
    onAnterior: () -> Unit,
    onNumero: (Int) -> Boolean,
    mostrarDiagnostico: Boolean,
    onAjustes: () -> Unit,
) {
    val context = LocalContext.current

    // 1. Crear el reproductor UNA vez y liberarlo al salir.
    val player = remember {
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
        // Arrancar con ~1 segundo de video guardado en vez de 2,5 (zapping más rápido).
        val buffer = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                /* minBufferMs = */ 15_000,
                /* maxBufferMs = */ 50_000,
                /* bufferForPlaybackMs = */ 1_000,
                /* bufferForPlaybackAfterRebufferMs = */ 2_000,
            )
            .build()
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setLoadControl(buffer)
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

    // 3. Escuchar errores y estado de reproducción.
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
            .setUri(Xtream.urlEnVivo(canal.principal))
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

    // 6. Marcar número de canal: se juntan los dígitos y, tras una pausa, se cambia.
    var digitos by remember { mutableStateOf("") }
    LaunchedEffect(digitos) {
        if (digitos.isEmpty()) return@LaunchedEffect
        // Con 3 dígitos cambia ya; si no, espera 1,5 s por si viene otro.
        if (digitos.length < 3) delay(1500)
        onNumero(digitos.toInt())
        digitos = ""
    }

    // 7. Probador de teclas (diagnóstico): muestra el nombre del último botón recibido.
    var ultimaTecla by remember { mutableStateOf("") }

    // 8. NUEVO: lista de canales sobre el video.
    var listaAbierta by remember { mutableStateOf(false) }
    // Con la lista abierta, Atrás la cierra (en vez de salir de la app).
    BackHandler(enabled = listaAbierta) {
        listaAbierta = false
    }

    // OK mantenido 3 segundos -> ajustes (se abren al SOLTAR, igual que la lista).
    var okLargo by remember { mutableStateOf(false) }

    // 9. Foco: cuando la lista está cerrada, el foco vuelve al reproductor.
    val foco = remember { FocusRequester() }
    LaunchedEffect(listaAbierta) {                    // NUEVO (antes era LaunchedEffect(Unit))
        if (!listaAbierta) foco.requestFocus()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onKeyEvent { evento ->
                val codigo = evento.nativeKeyEvent.keyCode

                // OK: la lista se abre al SOLTAR el botón (KeyUp), no al hundirlo.
                // Si se abriera al hundirlo, el "soltar" llegaría a la lista recién
                // abierta y elegiría el canal actual, cerrándola al instante.
                if (codigo in TECLAS_OK) {
                    if (listaAbierta) return@onKeyEvent false   // con la lista abierta, OK es de la lista
                    val nativo = evento.nativeKeyEvent
                    if (evento.type == KeyEventType.KeyDown) {
                        // Mientras se mantiene OK llegan KeyDown repetidos. Medimos cuánto pasó
                        // desde que se hundió (downTime) hasta este evento (eventTime).
                        if (nativo.eventTime - nativo.downTime >= MS_OK_LARGO) okLargo = true
                    } else if (evento.type == KeyEventType.KeyUp) {
                        if (okLargo) {
                            okLargo = false
                            onAjustes()          // OK largo -> ajustes
                        } else {
                            listaAbierta = true  // OK corto -> lista
                        }
                    }
                    return@onKeyEvent true                      // consumimos tanto KeyDown como KeyUp
                }

                if (evento.type != KeyEventType.KeyDown) return@onKeyEvent false
                ultimaTecla = KeyEvent.keyCodeToString(codigo)

                val digito = when (codigo) {
                    in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> codigo - KeyEvent.KEYCODE_0
                    in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> codigo - KeyEvent.KEYCODE_NUMPAD_0
                    else -> null
                }

                when {
                    digito != null -> { digitos += digito; true }
                    // Con la lista abierta, las flechas son de la lista.
                    listaAbierta -> false
                    codigo == KeyEvent.KEYCODE_DPAD_UP || codigo == KeyEvent.KEYCODE_CHANNEL_UP -> {
                        onSiguiente(); true
                    }
                    codigo == KeyEvent.KEYCODE_DPAD_DOWN || codigo == KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                        onAnterior(); true
                    }
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

        // NUEVO: el cartel no se muestra mientras la lista está abierta.
        if (mostrarCartel && !listaAbierta) {
            Cartel(canal, numero, Modifier.align(Alignment.TopStart))
        }

        // NUEVO: la lista.
        if (listaAbierta) {
            ListaCanales(
                canales = canales,
                actual = canal,
                onElegir = { n ->
                    onNumero(n)
                    listaAbierta = false
                },
                modifier = Modifier.align(Alignment.CenterStart),
            )
        }

        // Número que se está marcando, grande arriba a la derecha.
        if (digitos.isNotEmpty()) {
            Text(
                digitos,
                style = MaterialTheme.typography.displayLarge,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(32.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 24.dp, vertical = 8.dp),
            )
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

        // Aviso mientras se mantiene OK.
        if (okLargo) {
            Text(
                "Soltá OK para abrir los ajustes",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(48.dp)
                    .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }

        // Diagnóstico: se activa desde los ajustes.
        if (mostrarDiagnostico) {
            val video = player.videoFormat
            Text(
                "$estado · ${video?.sampleMimeType ?: "?"} · ${video?.height ?: "?"}p · $ultimaTecla",
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp)
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(8.dp),
            )
        }
    }
}

@Composable
fun Cartel(canal: CanalEnLista, numero: Int, modifier: Modifier = Modifier) {
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
        Text(canal.nombre, style = MaterialTheme.typography.headlineSmall, color = Color.White)
    }
}

@Composable
fun Mensaje(texto: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(texto)
    }
}