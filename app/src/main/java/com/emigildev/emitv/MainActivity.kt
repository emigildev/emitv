package com.emigildev.emitv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.LocalContentColor
import com.emigildev.emitv.ui.App
import com.emigildev.emitv.ui.theme.EmiTVTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            // Siempre oscuro: es lo natural en una TV y los textos están pensados para eso.
            EmiTVTheme(isInDarkTheme = true) {
                // Un Box simple, sin fondo ni capas: el video de YouTube puede dibujarse DETRÁS
                // de la app y nada en el medio lo debe tapar. El fondo oscuro lo pone el tema
                // (themes.xml), y el color de los textos, LocalContentColor.
                CompositionLocalProvider(LocalContentColor provides Color.White) {
                    Box(Modifier.fillMaxSize()) {
                        App()
                    }
                }
            }
        }
    }
}