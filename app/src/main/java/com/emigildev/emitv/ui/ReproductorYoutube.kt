package com.emigildev.emitv.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LifecycleStartEffect
import com.emigildev.emitv.data.Senal

/** La página del reproductor de YouTube, publicada en tu GitHub Pages. */
private const val URL_REPRODUCTOR_YOUTUBE = "https://emigildev.github.io/emitv/reproductor/youtube.html"

/**
 * Puente entre la página web y la app: la página llama a EmiTV.aviso(evento, dato)
 * y acá lo recibimos. Solo los métodos con @JavascriptInterface se pueden llamar desde JavaScript.
 */
class PuenteYoutube(private val alAviso: (evento: String, dato: String) -> Unit) {
    @JavascriptInterface
    fun aviso(evento: String, dato: String) = alAviso(evento, dato)
}

/** Muestra una señal de YouTube con el reproductor oficial, dentro de una WebView. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ReproductorYoutube(
    senal: Senal.DeYoutube,
    onEvento: (evento: String, dato: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Siempre la versión más nueva de onEvento, aunque la WebView se haya creado antes.
    val alEvento by rememberUpdatedState(onEvento)

    val url = remember(senal) {
        if (senal.canal != null) "$URL_REPRODUCTOR_YOUTUBE?canal=${Uri.encode(senal.canal)}"
        else "$URL_REPRODUCTOR_YOUTUBE?video=${Uri.encode(senal.video.orEmpty())}"
    }

    var webView by remember { mutableStateOf<WebView?>(null) }

    // Cargar la página al estar visible, y descargarla al pasar a segundo plano
    // (botón Inicio), para que YouTube no siga sonando de fondo.
    LifecycleStartEffect(webView, url) {
        webView?.loadUrl(url)
        onStopOrDispose { webView?.loadUrl("about:blank") }
    }

    AndroidView(
        factory = { contexto ->
            WebView(contexto).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false   // que arranque solo, con sonido
                setBackgroundColor(android.graphics.Color.BLACK)

                // El foco y las teclas del control los maneja la app, no la página.
                isFocusable = false
                isFocusableInTouchMode = false
                descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS

                webChromeClient = WebChromeClient()

                // Los avisos de JavaScript llegan en otro hilo: post { } los pasa al hilo principal.
                addJavascriptInterface(
                    PuenteYoutube { evento, dato -> post { alEvento(evento, dato) } },
                    "EmiTV",
                )
                webView = this
            }
        },
        onRelease = { it.destroy() },
        modifier = modifier,
    )
}
