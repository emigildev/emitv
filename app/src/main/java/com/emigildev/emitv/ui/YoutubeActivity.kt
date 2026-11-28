package com.emigildev.emitv.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.emigildev.emitv.data.Senal

/**
 * Puente entre la página web y la app: la página llama a EmiTV.aviso(evento, dato)
 * y acá lo recibimos. Solo los métodos con @JavascriptInterface se pueden llamar desde JavaScript.
 */
class PuenteYoutube(private val alAviso: (evento: String, dato: String) -> Unit) {
    @JavascriptInterface
    fun aviso(evento: String, dato: String) = alAviso(evento, dato)
}

/**
 * Pantalla propia para ver YouTube: SOLO una WebView, sin Compose de por medio
 * (dentro de la pantalla de Compose el video de YouTube se veía negro).
 *
 * El control remoto sigue mandando: ⬆️⬇️ y los números cambian de canal, OK abre la lista
 * y Atrás sale. Para eso, esta pantalla se cierra y le cuenta a la principal qué pasó.
 */
class YoutubeActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var cartel: TextView
    private val manejador = Handler(Looper.getMainLooper())

    private var yaReprodujo = false    // ¿ya empezó el canal en sí (no la publicidad)?
    private var permitirLista = true   // en modo Simple, OK no abre la lista: muestra el cartel
    private var textoCartel = ""
    private var terminada = false
    private var digitos = ""

    // Vigilante: si pasa el tiempo programado sin que el canal arranque (o vuelva), se avisa
    // un error y EmiTV pasa al siguiente respaldo. El motivo cambia según la etapa.
    private var motivoVigilante = ""
    private val vigilante = Runnable { terminar(ERROR, motivoVigilante) }

    private fun vigilar(milisegundos: Long, motivo: String) {
        motivoVigilante = motivo
        manejador.removeCallbacks(vigilante)
        manejador.postDelayed(vigilante, milisegundos)
    }
    private val ocultarCartel = Runnable { cartel.visibility = View.GONE }
    private val marcarNumero = Runnable { if (digitos.isNotEmpty()) terminar(NUMERO + digitos) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)  // que la TV no se apague

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false   // que arranque solo, con sonido
            setBackgroundColor(Color.BLACK)
            // El foco y las teclas los maneja esta pantalla, no la página
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
            webChromeClient = WebChromeClient()
            // Los avisos de JavaScript llegan en otro hilo: runOnUiThread los pasa al principal
            addJavascriptInterface(PuenteYoutube { evento, dato -> runOnUiThread { alAviso(evento, dato) } }, "EmiTV")
        }

        permitirLista = intent.getBooleanExtra(EXTRA_PERMITIR_LISTA, true)

        cartel = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = if (permitirLista) 28f else 48f   // más grande en modo Simple
            setBackgroundColor(Color.argb(160, 0, 0, 0))
            setPadding(32, 16, 32, 16)
        }

        val contenedor = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(webView, FrameLayout.LayoutParams(MATCH, MATCH))
            addView(cartel, FrameLayout.LayoutParams(WRAP, WRAP).apply {
                gravity = Gravity.TOP or Gravity.START
                setMargins(48, 48, 0, 0)
            })
        }
        setContentView(contenedor)

        val numero = intent.getIntExtra(EXTRA_NUMERO, 0)
        textoCartel = "$numero  ${intent.getStringExtra(EXTRA_NOMBRE).orEmpty()}"
        mostrarCartel(textoCartel)

        val canal = intent.getStringExtra(EXTRA_CANAL)
        val video = intent.getStringExtra(EXTRA_VIDEO)
        val url = if (canal != null) {
            "$URL_REPRODUCTOR?canal=${Uri.encode(canal)}"
        } else {
            "$URL_REPRODUCTOR?video=${Uri.encode(video.orEmpty())}"
        }
        webView.loadUrl(url)
        // Etapa 1: que cargue la página y el reproductor de YouTube
        vigilar(MS_CARGA, "el reproductor de YouTube no cargó")
    }

    // Lo que avisa la página de YouTube.
    // Ojo: durante la PUBLICIDAD, YouTube no avisa "reproduciendo" (1): ese aviso llega recién
    // cuando empieza el canal. Por eso, antes de eso, se espera mucho más (MS_INICIO).
    private fun alAviso(evento: String, dato: String) {
        when (evento) {
            "listo" ->                         // Etapa 2: publicidad (si hay) y arranque del canal
                if (!yaReprodujo) vigilar(MS_INICIO, "el canal no arrancó (¿no está en vivo?)")
            "error" -> terminar(ERROR, "error $dato")
            "estado" -> when (dato) {
                "1" -> {                       // el canal se está viendo: nada que vigilar
                    yaReprodujo = true
                    manejador.removeCallbacks(vigilante)
                }
                "3" ->                         // cargando: si el canal ya venía andando, se cortó
                    if (yaReprodujo) vigilar(MS_CORTE, "la señal se cortó")
                "0" -> terminar(ERROR, "la transmisión terminó")
            }
        }
    }

    // Las teclas del control
    override fun dispatchKeyEvent(evento: KeyEvent): Boolean {
        val codigo = evento.keyCode
        val esOk = codigo == KeyEvent.KEYCODE_DPAD_CENTER ||
            codigo == KeyEvent.KEYCODE_ENTER || codigo == KeyEvent.KEYCODE_NUMPAD_ENTER

        // OK y Atrás actúan al SOLTAR (igual que en la pantalla principal)
        if (esOk || codigo == KeyEvent.KEYCODE_BACK) {
            if (evento.action == KeyEvent.ACTION_UP) {
                when {
                    !esOk -> terminar(SALIR)
                    permitirLista -> terminar(LISTA)
                    else -> mostrarCartel(textoCartel)   // modo Simple: solo recordar qué canal es
                }
            }
            return true
        }
        if (evento.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(evento)

        val digito = when (codigo) {
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> codigo - KeyEvent.KEYCODE_0
            in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> codigo - KeyEvent.KEYCODE_NUMPAD_0
            else -> null
        }
        return when {
            digito != null -> {
                digitos += digito
                mostrarCartel(digitos)
                manejador.removeCallbacks(marcarNumero)
                manejador.postDelayed(marcarNumero, if (digitos.length >= 3) 0L else 1500L)
                true
            }
            codigo == KeyEvent.KEYCODE_DPAD_UP || codigo == KeyEvent.KEYCODE_CHANNEL_UP -> {
                terminar(SIGUIENTE); true
            }
            codigo == KeyEvent.KEYCODE_DPAD_DOWN || codigo == KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                terminar(ANTERIOR); true
            }
            else -> super.dispatchKeyEvent(evento)
        }
    }

    private fun mostrarCartel(texto: String) {
        cartel.text = texto
        cartel.visibility = View.VISIBLE
        manejador.removeCallbacks(ocultarCartel)
        manejador.postDelayed(ocultarCartel, 3000)
    }

    /** Cierra esta pantalla y le cuenta a la principal qué pasó. Solo la primera vez cuenta. */
    private fun terminar(accion: String, detalle: String? = null) {
        if (terminada) return
        terminada = true
        setResult(RESULT_OK, Intent().putExtra(EXTRA_ACCION, accion).putExtra(EXTRA_DETALLE, detalle))
        finish()
    }

    override fun onStop() {
        super.onStop()
        terminar(PAUSA)   // botón Inicio: se cierra (y deja de sonar); al volver a EmiTV se reabre sola
    }

    override fun onDestroy() {
        manejador.removeCallbacksAndMessages(null)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val URL_REPRODUCTOR = "https://emigildev.github.io/emitv/reproductor/youtube.html"
        // Tiempos del vigilante
        private const val MS_CARGA = 15_000L     // para que cargue el reproductor de YouTube
        private const val MS_INICIO = 75_000L    // para que arranque el canal (publicidad incluida)
        private const val MS_CORTE = 15_000L     // si el canal se corta después de haber arrancado
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

        // Lo que le mandamos al abrirla
        private const val EXTRA_CANAL = "canal"
        private const val EXTRA_VIDEO = "video"
        private const val EXTRA_NOMBRE = "nombre"
        private const val EXTRA_NUMERO = "numero"
        private const val EXTRA_PERMITIR_LISTA = "permitirLista"

        // Lo que devuelve al cerrarse
        const val EXTRA_ACCION = "accion"
        const val EXTRA_DETALLE = "detalle"
        const val SIGUIENTE = "siguiente"
        const val ANTERIOR = "anterior"
        const val LISTA = "lista"
        const val SALIR = "salir"
        const val PAUSA = "pausa"
        const val ERROR = "error"
        const val NUMERO = "numero:"

        fun intent(context: Context, senal: Senal.DeYoutube, nombre: String, numero: Int, permitirLista: Boolean): Intent =
            Intent(context, YoutubeActivity::class.java)
                .putExtra(EXTRA_CANAL, senal.canal)
                .putExtra(EXTRA_VIDEO, senal.video)
                .putExtra(EXTRA_NOMBRE, nombre)
                .putExtra(EXTRA_NUMERO, numero)
                .putExtra(EXTRA_PERMITIR_LISTA, permitirLista)
    }
}
