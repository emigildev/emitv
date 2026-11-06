package com.emigildev.emitv.data

// Provisorio: en la Fase 6 esto vendrá de la página de curación.
object Seleccion {
    private val categoriasPermitidas = listOf(
        "194", // Argentina
        "11",  // Argentina Regional
        "326", // Liga Argentina
        "404", "154", "328", // Libertadores, Sudamericana, Ligas Latinas
        "345", "346", "250", // Zona ESPN, Fox, DSports
        "384", "55", "340", "379", // Deportes LAT, F1, Motor, Ciclismo-Tenis
        "112", "123", "383", "277", // Cine
        "10",  // Cultura y entretenimiento
        "159", // Infantiles
    )

    // Bloqueo fijo: nunca se muestra, aunque alguien la agregue arriba.
    private val bloqueadas = Regex("xxx|adult|porno", RegexOption.IGNORE_CASE)

    fun filtrar(todas: List<Categoria>): List<Categoria> =
        todas
            .filter { it.id in categoriasPermitidas && !bloqueadas.containsMatchIn(it.nombre) }
            .sortedBy { categoriasPermitidas.indexOf(it.id) }
}