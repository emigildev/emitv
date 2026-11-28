package com.emigildev.emitv.ui

import android.app.Activity
import android.view.KeyEvent
import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.mutableIntStateOf
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
import com.emigildev.emitv.data.Senal
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException

// Teclas que cuentan como "OK" según el control.
private val TECLAS_OK = setOf(
    KeyEvent.KEYCODE_DPAD_CENTER,
    KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_NUMPAD_ENTER,
)
// Cuánto hay que mantener OK apretado para abrir los ajustes.
private const val MS_OK_LARGO = 3000L

// Respaldo automático: cuánto esperar a que una señal arranque antes de probar la siguiente,
// y cuánto esperar para reintentar cuando fallaron todas.
private const val MS_ESPERA_SENAL = 12_000L
private const val MS_REINTENTO = 30_000L

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
                    permitirLista = !vm.modoSimple,          // en modo Simple, OK no abre la lista
                    onTodasFallaron = vm::alFallarTodas,
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
    permitirLista: Boolean,           // false en modo Simple: OK muestra el cartel en grande
    onTodasFallaron: () -> Unit,      // avisa al ViewModel: quizás cambiaron las direcciones
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

    // 3. Escuchar el estado del reproductor y sus errores.
    var error by remember { mutableStateOf<String?>(null) }   // el último error (para el diagnóstico)
    var estado by remember { mutableStateOf("") }
    var estadoReproductor by remember { mutableIntStateOf(Player.STATE_IDLE) }
    var fallos by remember { mutableIntStateOf(0) }            // sube con cada error del reproductor
    // Mientras se ve YouTube, el reproductor de siempre está apagado y no debe "informar" nada.
    var usandoYoutube by remember { mutableStateOf(false) }
    DisposableEffect(player) {
        val escucha = object : Player.Listener {
            override fun onPlayerError(e: PlaybackException) {
                error = "${e.errorCodeName}\n${e.cause?.message ?: ""}"
                fallos++
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (usandoYoutube) return   // el estado lo informa YouTube
                estadoReproductor = state
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

    // 4. RESPALDO AUTOMÁTICO
    // Las señales del canal: la principal y sus respaldos, en orden.
    // Si una falla (da error, se corta o se queda cargando), se pasa sola a la siguiente.
    val senales = remember(canal) { listOf(canal.principal) + canal.respaldos }

    // Qué señal anduvo en cada canal (en esta sesión): la próxima vez se arranca directo por ahí.
    val senalQueAnduvo = remember { mutableMapOf<Int, Int>() }

    // remember(canal): al cambiar de canal, estos estados vuelven a empezar.
    var intento by remember(canal) {
        mutableIntStateOf(senalQueAnduvo[canal.numero]?.takeIf { it < senales.size } ?: 0)
    }
    var ronda by remember(canal) { mutableIntStateOf(0) }            // cada vuelta completa
    var fallaronTodas by remember(canal) { mutableStateOf(false) }

    fun probarSiguiente() {
        if (fallaronTodas) return
        if (intento + 1 < senales.size) intento++ else fallaronTodas = true
    }

    // 4a. Reproducir la señal que toca.
    LaunchedEffect(canal, intento, ronda) {
        if (fallaronTodas) return@LaunchedEffect
        usandoYoutube = senales[intento] is Senal.DeYoutube
        if (usandoYoutube) {
            // YouTube se ve en su propia pantalla (YoutubeActivity, más abajo): se apaga el de siempre.
            // Esa pantalla tiene su propio vigilante; acá no hay que vigilar nada.
            player.stop()
            estadoReproductor = Player.STATE_IDLE
            return@LaunchedEffect
        }
        try {
            player.setMediaSource(crearMediaSource(senales[intento]))
            player.prepare()
            player.playWhenReady = true
        } catch (e: CancellationException) {
            throw e  // se cambió de canal o de señal mientras se preparaba: no es un error
        } catch (e: Exception) {
            error = e.message ?: e.toString()
            probarSiguiente()
        }
    }

    // 4b. Si el reproductor da un error, probar la siguiente señal.
    LaunchedEffect(fallos) {
        if (fallos > 0) probarSiguiente()
    }

    // 4c. Vigilante: si se queda "Cargando…" demasiado o el stream termina, probar la siguiente.
    //     Si el estado cambia antes (por ejemplo, empieza a reproducir), este efecto se cancela solo.
    LaunchedEffect(canal, intento, ronda, estadoReproductor) {
        when (estadoReproductor) {
            Player.STATE_BUFFERING -> {
                delay(MS_ESPERA_SENAL)
                probarSiguiente()
            }
            Player.STATE_ENDED -> probarSiguiente()   // un canal en vivo no debería "terminar"
            Player.STATE_READY -> senalQueAnduvo[canal.numero] = intento   // ¡anduvo! recordarla
        }
    }

    // 4d. Si fallaron todas: avisar, esperar y volver a empezar desde la principal.
    LaunchedEffect(fallaronTodas) {
        if (fallaronTodas) {
            onTodasFallaron()   // que la app revise si hay direcciones nuevas
            player.stop()
            senalQueAnduvo.remove(canal.numero)
            delay(MS_REINTENTO)
            intento = 0
            ronda++
            fallaronTodas = false
        }
    }

    // 4e. Aviso de unos segundos cuando se está usando una señal alternativa.
    var avisoAlternativa by remember { mutableStateOf(false) }
    LaunchedEffect(canal, intento) {
        avisoAlternativa = intento > 0
        if (avisoAlternativa) {
            delay(4000)
            avisoAlternativa = false
        }
    }

    // 5. Mostrar el cartel unos segundos después de cada cambio (y cada vez que se pide con OK).
    var mostrarCartel by remember { mutableStateOf(true) }
    var pedidoCartel by remember { mutableIntStateOf(0) }
    LaunchedEffect(canal, pedidoCartel) {
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

    // 10. YOUTUBE en su propia pantalla (YoutubeActivity).
    //     Al volver, esa pantalla nos dice qué hizo el usuario (o si falló), y actuamos.
    val senalActual = senales.getOrNull(intento)
    var youtubeAbierto by remember { mutableStateOf(false) }
    val lanzadorYoutube = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { resultado ->
        youtubeAbierto = false
        val accion = resultado.data?.getStringExtra(YoutubeActivity.EXTRA_ACCION) ?: YoutubeActivity.SALIR
        when {
            accion == YoutubeActivity.SIGUIENTE -> onSiguiente()
            accion == YoutubeActivity.ANTERIOR -> onAnterior()
            accion == YoutubeActivity.LISTA -> if (permitirLista) listaAbierta = true
            accion == YoutubeActivity.ERROR -> {
                error = "YouTube: " + resultado.data?.getStringExtra(YoutubeActivity.EXTRA_DETALLE).orEmpty()
                fallos++   // -> respaldo automático
            }
            accion.startsWith(YoutubeActivity.NUMERO) ->
                accion.removePrefix(YoutubeActivity.NUMERO).toIntOrNull()?.let { onNumero(it) }
            accion == YoutubeActivity.SALIR -> (context as? Activity)?.finish()   // Atrás: salir, como en la TV
            // PAUSA (botón Inicio): no se hace nada; al volver a EmiTV se reabre sola.
        }
    }
    // Abrir la pantalla de YouTube cuando la señal actual es de YouTube
    // (y no está ya abierta, ni la lista de canales encima).
    LaunchedEffect(senalActual, ronda, fallaronTodas, listaAbierta, youtubeAbierto) {
        if (senalActual is Senal.DeYoutube && !fallaronTodas && !listaAbierta && !youtubeAbierto) {
            youtubeAbierto = true
            lanzadorYoutube.launch(YoutubeActivity.intent(context, senalActual, canal.nombre, numero, permitirLista))
        }
    }

    // 9. Foco: cuando la lista está cerrada, el foco vuelve al reproductor.
    val foco = remember { FocusRequester() }
    LaunchedEffect(listaAbierta) {                    // NUEVO (antes era LaunchedEffect(Unit))
        if (!listaAbierta) foco.requestFocus()
    }

    Box(
        Modifier
            .fillMaxSize()
            // Con YouTube, fondo transparente: su video puede dibujarse DETRÁS de la app
            .background(if (usandoYoutube) Color.Transparent else Color.Black)
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
                            // OK corto -> la lista; en modo Simple, el cartel en grande
                            if (permitirLista) listaAbierta = true else pedidoCartel++
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
        val esYoutube = senalActual is Senal.DeYoutube && !fallaronTodas

        // El reproductor de siempre: solo cuando NO es YouTube. Si quedara debajo,
        // en algunas TVs tapa el video de YouTube (se escucha pero no se ve).
        if (!esYoutube) {
            AndroidView(
                factory = { ctx ->
                    val vista = LayoutInflater.from(ctx).inflate(R.layout.reproductor, null) as PlayerView
                    vista.player = player
                    vista
                },
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Si la señal actual es de YouTube, se ve en su propia pantalla. Acá, un aviso.
        if (esYoutube) {
            Text(
                "▶ ${canal.nombre} se ve con YouTube",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        // El cartel no se muestra mientras la lista está abierta.
        if (mostrarCartel && !listaAbierta) {
            Cartel(canal, numero, grande = !permitirLista, modifier = Modifier.align(Alignment.TopStart))
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

        // Fallaron todas las señales del canal
        if (fallaronTodas) {
            Text(
                "${canal.nombre} no está disponible en este momento.\nSe vuelve a intentar en unos segundos…",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(12.dp))
                    .padding(24.dp),
            )
        }

        // Se está usando una señal alternativa
        if (avisoAlternativa) {
            Text(
                "Señal alternativa ${intento} de ${senales.size - 1}",
                color = Color.White,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(32.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
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
                "$estado · señal ${intento + 1}/${senales.size} · ${video?.sampleMimeType ?: "?"} · " +
                    "${video?.height ?: "?"}p · $ultimaTecla" +
                    (error?.let { "\n" + it.lineSequence().first() } ?: ""),
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
fun Cartel(canal: CanalEnLista, numero: Int, grande: Boolean = false, modifier: Modifier = Modifier) {
    // "grande": para modo Simple, pensado para leer de lejos y con poca visión.
    Row(
        modifier
            .padding(32.dp)
            .background(Color.Black.copy(alpha = if (grande) 0.85f else 0.6f), RoundedCornerShape(16.dp))
            .padding(horizontal = if (grande) 40.dp else 24.dp, vertical = if (grande) 24.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (grande) 28.dp else 16.dp),
    ) {
        Text(
            "$numero",
            style = if (grande) MaterialTheme.typography.displayLarge else MaterialTheme.typography.displaySmall,
            color = Color.White,
        )
        AsyncImage(
            model = canal.logo?.takeIf { it.isNotBlank() },
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(if (grande) 120.dp else 56.dp),
        )
        Text(
            canal.nombre,
            style = if (grande) MaterialTheme.typography.displayMedium else MaterialTheme.typography.headlineSmall,
            color = Color.White,
        )
    }
}

@Composable
fun Mensaje(texto: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(texto)
    }
}