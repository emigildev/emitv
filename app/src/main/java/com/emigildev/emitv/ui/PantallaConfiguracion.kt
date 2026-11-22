package com.emigildev.emitv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.emigildev.emitv.data.Config
import com.emigildev.emitv.data.Modo
import com.emigildev.emitv.data.Xtream
import kotlinx.coroutines.launch
import androidx.compose.material3.Text as TextoM3
import androidx.tv.material3.OutlinedButton

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PantallaConfiguracion(onListo: (Config) -> Unit) {
    var url by remember { mutableStateOf("") }
    var usuario by remember { mutableStateOf("") }
    var clave by remember { mutableStateOf("") }
    var verClave by remember { mutableStateOf(false) }
    var modo by remember { mutableStateOf(Modo.SIMPLE) }
    var probando by remember { mutableStateOf(false) }
    var mensaje by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val completo = url.isNotBlank() && usuario.isNotBlank() && clave.isNotBlank()

    fun conectar() {
        if (probando) return   // ya está conectando: ignorar clics repetidos
        probando = true
        mensaje = null
        scope.launch {
            try {
                val cuenta = Xtream.probar(url, usuario.trim(), clave)
                if (cuenta.auth == 1) {
                    onListo(Config(Xtream.normalizar(url), usuario.trim(), clave, modo))
                } else {
                    mensaje = "Usuario o contraseña incorrectos"
                }
            } catch (e: java.net.UnknownHostException) {
                mensaje = "No se encontró el servidor. Revisá que esté bien escrito."
            } catch (e: java.io.InterruptedIOException) {
                mensaje = "El servidor no responde. Probá de nuevo en un rato."
            } catch (e: kotlinx.serialization.SerializationException) {
                mensaje = "Esa dirección no parece ser un servicio IPTV. Revisá el servidor."
            } catch (e: retrofit2.HttpException) {
                mensaje = when (e.code()) {
                    401, 403, 404 -> "No se pudo iniciar sesión. Revisá el usuario y la contraseña."
                    else -> "El servidor respondió con un error (${e.code()}). Probá de nuevo."
                }
            } catch (e: Exception) {
                mensaje = "No se pudo conectar: ${e.message?.take(120) ?: e}"
            } finally {
                probando = false   // ← siempre, salga bien o mal
            }
        }
    }

    Row(
        Modifier.fillMaxSize().padding(48.dp),
        horizontalArrangement = Arrangement.spacedBy(48.dp),
    ) {
        // ---------- Izquierda: bienvenida y modo ----------
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Bienvenido a EmiTV", style = MaterialTheme.typography.headlineMedium)
            Text("Configurá este dispositivo una sola vez.", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(16.dp))
            Text("Modo de uso", style = MaterialTheme.typography.titleMedium)
            ListItem(
                selected = modo == Modo.SIMPLE,
                onClick = { modo = Modo.SIMPLE },
                headlineContent = { Text("Simple") },
                supportingContent = { Text("Solo TV en vivo, como una tele de siempre") },
            )
            ListItem(
                selected = modo == Modo.COMPLETO,
                onClick = { modo = Modo.COMPLETO },
                headlineContent = { Text("Completo") },
                supportingContent = { Text("TV en vivo, películas y series") },
            )
        }

        // ---------- Derecha: datos del servicio ----------
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Datos del servicio", style = MaterialTheme.typography.titleMedium)
            Campo("Servidor (ej: miservidor.com)", url, { url = it }, KeyboardType.Uri)
            Campo("Usuario", usuario, { usuario = it }, KeyboardType.Text)
            Campo("Contraseña", clave, { clave = it }, KeyboardType.Password, oculto = !verClave)
            OutlinedButton(onClick = { verClave = !verClave }) {
                Text(if (verClave) "Ocultar contraseña" else "Mostrar contraseña")
            }
            Button(onClick = { conectar() }, enabled = completo && !probando) {
                Text(if (probando) "Conectando…" else "Conectar")
            }
            mensaje?.let { Text(it, color = Color(0xFFFF8A80)) }
        }
    }
}

@Composable
private fun Campo(
    etiqueta: String,
    valor: String,
    alCambiar: (String) -> Unit,
    tipo: KeyboardType,
    oculto: Boolean = false,
) {
    OutlinedTextField(
        value = valor,
        onValueChange = alCambiar,
        label = { TextoM3(etiqueta) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = tipo, imeAction = ImeAction.Next),
        visualTransformation = if (oculto) PasswordVisualTransformation() else VisualTransformation.None,
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = Color.White,
            unfocusedTextColor = Color.White,
            focusedBorderColor = Color.White,
            unfocusedBorderColor = Color.Gray,
            focusedLabelColor = Color.White,
            unfocusedLabelColor = Color.Gray,
            cursorColor = Color.White,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}