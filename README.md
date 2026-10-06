# WeeklyTool

Web interna para leer, cada lunes, qué pasó la semana anterior (lunes a domingo) en los 15 países y en LATAM. La idea es que se lea como un cuento en la reunión weekly, no como una tabla de KPIs.

Estado al 2026-10-06: funciona en local sobre copias `.xlsx` (201 tests pasan). La lectura y la página anterior se probaron en Apps Script; el carrusel, el control contra la hoja y el guardado **todavía no se probaron en vivo**. No hay trigger ni envíos automáticos.

## Qué muestra la web

| Capítulo | Contenido |
|---|---|
| 1 · LATAM | Titular y párrafo de la semana, los tres primeros KPIs líderes (hoy Órdenes, GMV confirmado, Clientes activos) y un **carrusel por sección**: cada lámina es una sección de la hoja contada con el KPI que abre cada bloque. |
| 2 · País por país | Ficha por país: resumen, gráfico de 9 semanas del KPI que más se movió, con el promedio previo, y tres KPIs. |
| 3 · Qué mirar esta semana | Los cinco movimientos más fuertes y los cinco datos a revisar más repetidos. |
| 4 · Resumen | Qué pasó, qué hay detrás, qué mirar la semana que viene, y el estado de la información. |
| Detalle (plegado) | Todos los movimientos y datos a revisar, con filtros y los valores comparados. |

## De dónde sale cada cosa

- **Qué KPIs existen y cómo se leen**: pestaña `2) Weekly por pais`. Filas, nombres, sección, bloque (la columna de agrupación: Orders, GMV, User Base…), dirección favorable (1 / −1), clave técnica y fórmulas de los derivados. Si se cambia algo ahí, la web lo refleja en la siguiente lectura.
- **Los números**: pestaña `[Extract] Tabla Weekly`, la misma tabla que leen los SUMIFS de la hoja. Trae los 16 mercados en una lectura, toda la historia y distingue cero de faltante.
- **Control de coincidencia**: en cada lectura se comparan los valores del motor con los que la hoja muestra para el mercado elegido en su selector, sin tocarlo. El resultado aparece al pie de la web.
- **KPIs líderes**: el primer KPI analizable de cada bloque de la hoja, en el orden de la hoja. Nadie los lista en el código.
- **Nada se ubica por coordenada fija**: encabezado "KPI", columnas de fecha, "WoW", dirección, clave, bloque y selector se encuentran por contenido, porque la hoja cambia de estructura seguido.

## Reglas que el código respeta

- Un faltante nunca se convierte en cero ni un cero en faltante.
- Un KPI con un problema de calidad que impide interpretarlo no genera alerta de performance.
- Variación relativa (%) y puntos porcentuales (pp) no se mezclan; la unidad sale de la fórmula WoW de la hoja.
- Sin dirección favorable no se dice si un cambio es bueno o malo.
- LATAM es un agregado: no se cuenta como país ni se suma.
- Lo que la web llama "posible causa" es solo qué otros KPIs se movieron a la vez en los mismos datos. Es una pista a validar, nunca una causa demostrada.
- Los textos se arman por reglas a partir de valores calculados. No hay modelo de IA en el producto todavía.

## Archivos

| Archivo | Rol |
|---|---|
| `FuenteWeekly.gs` | Lectura (solo lectura) de las dos pestañas y control de coincidencia. |
| `MotorWeekly.gs` | Funciones puras: catálogo, calidad de datos, performance, explicaciones, panorama por mercado y recorrido por sección. |
| `ResumenWeekly.gs` | Texto en español, modelo de vista y los cuatro capítulos (`weeklyResumenHistoria_`). |
| `RegistroWeekly.gs` | Endpoint `obtenerVistaWeekly` y guardado en la pestaña `Weekly_Tool_Registro`. Es el único archivo que escribe. |
| `Resumen.txt` | La página (en Apps Script, archivo HTML `Resumen`). |
| `herramientas/` | `analizar.cjs` y `vista-previa.cjs`: corren lo mismo en local sobre una copia `.xlsx`. |
| `tests/` | `node --test tests/*.test.cjs`. |
| `DISENO_AGENTES.md` | Diseño propuesto para sumar un modelo de IA (no implementado). |
| `BITACORA.md` | Registro cronológico de lo ejecutado. |

Código anterior, que ya no usa la web: `LectorWeekly.gs`, `PruebaSelector.gs`, `OpcionesWeekly.gs`, `DiagnosticoSheets.gs`, `Index.txt`, `Web.gs.txt`, `ReportePaises.gs.txt` y sus documentos (`LECTOR_WEEKLY.md`, `CONSULTA_WEEKLY.md`, `PRUEBA_SELECTOR.md`, `DIAGNOSTICO_SHEETS.md`, `odd/tasks/`). Leían una pestaña `WebApp` cambiando el selector de país; esa pestaña ya no existe. Se conservan como historia.

## Cómo usarlo

Tests:

```bash
node --test tests/*.test.cjs
```

Análisis de una copia (deja el resumen en `salidas/`, que git ignora porque son datos de la empresa):

```bash
node herramientas/analizar.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review (3).xlsx"
```

Vista previa de la web en local:

```bash
node herramientas/vista-previa.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review (3).xlsx" --puerto=8125
```

En Apps Script: pegar `MotorWeekly.gs`, `ResumenWeekly.gs`, `FuenteWeekly.gs`, `RegistroWeekly.gs` y el HTML `Resumen`; el `doGet` debe servir `Resumen`. `probarAnalisisWeekly()` corre la lectura desde el editor.

## Pendientes conocidos

- Probar en Apps Script el carrusel, el control contra la hoja y el guardado en `Weekly_Tool_Registro`.
- El `doGet` del repo (`Web.gs.txt`) todavía sirve `Index`.
- No se distingue semana ausente de actualización pendiente, ni se detecta una carga parcial.
- El identificador interno de un KPI es su fila; cambia si se insertan filas.
- Umbrales de alerta sin validar por el equipo; dirección y unidad de cada KPI sin validar.
- Filas de la hoja que hoy no se analizan porque les falta clave técnica y dirección: aparecen al pie de la web en "Advertencias del catálogo de KPIs".
- Proveedor de IA sin aprobar (ver `DISENO_AGENTES.md`).
