# WeeklyTool

Web interna para leer, cada lunes, qué pasó la semana anterior (lunes a domingo) en los 15 países y en LATAM. La idea es que se lea como un cuento en la reunión weekly, no como una tabla de KPIs.

Estado al 2026-10-06: completa y probada en local sobre copias `.xlsx` (63 tests de la herramienta actual y 146 del lector anterior, todos pasan). La lectura y la primera versión de la página se probaron en Apps Script; **todo lo agregado después todavía no se probó en vivo** (ver "Qué falta verificar en vivo"). No hay trigger ni envíos automáticos.

## Qué muestra la web

| Capítulo | Contenido |
|---|---|
| 1 · LATAM | Titular y párrafo de la semana, los tres primeros KPIs líderes (hoy Órdenes, GMV confirmado, Clientes activos) y un **carrusel por sección**: cada lámina es una sección de la hoja contada con el KPI que abre cada bloque. Se pasa con flechas, teclado o arrastrando. |
| 2 · País por país | Ficha por país: resumen, gráfico de 9 semanas del KPI que más se movió, con el promedio previo, y tres KPIs. |
| 3 · Qué mirar esta semana | Los cinco movimientos más fuertes (marcados como nuevos o repetidos respecto de la semana anterior) y los cinco datos a revisar más repetidos. |
| 4 · Resumen | Qué pasó, qué hay detrás, qué mirar la semana que viene, y el estado de la información. |
| Detalle (plegado) | Todos los movimientos y datos a revisar, con filtros y los valores comparados. |

Arriba de todo aparecen los avisos: datos sin actualizar, semana faltante, mercado cargado a medias, filas de la hoja que no se pudieron interpretar o diferencias contra la hoja.

## De dónde sale cada cosa

- **Qué KPIs existen y cómo se leen**: pestaña `2) Weekly por pais`. Filas, nombres, sección, bloque (la columna de agrupación: Orders, GMV, User Base…), dirección favorable (1 / −1), clave técnica y fórmulas de los derivados. Si se cambia algo ahí, la web lo refleja en la siguiente lectura.
- **Los números**: pestaña `[Extract] Tabla Weekly`, la misma tabla que leen los SUMIFS de la hoja. Trae los 16 mercados en una lectura, toda la historia y distingue cero de faltante.
- **Control de coincidencia**: en cada lectura se comparan los valores del motor con los que la hoja muestra para el mercado elegido en su selector, sin tocarlo. El resultado aparece al pie de la web.
- **KPIs líderes**: el primer KPI analizable de cada bloque de la hoja, en el orden de la hoja. Nadie los lista en el código.
- **Estado de la carga**: antes de analizar se revisa si los datos ya se actualizaron este lunes, si traen la última semana cerrada y si algún mercado vino a medias (menos del 80 % de los campos que traía en las tres semanas anteriores; umbral propuesto, sin validar). En cualquiera de esos casos la web lo avisa arriba, no interpreta los mercados incompletos y no guarda la lectura, así la siguiente vez vuelve a leer.
- **Identidad de cada KPI (`uid`)**: no depende de la fila ni del nombre visible. Si la fila se lee del extract, es su clave técnica (`orders`); si es un cálculo sin clave, se nombra por sus componentes (`orders_food/orders`); si la misma clave aparece en otra fila, lleva su orden de aparición (`orders_dmarts~2`). El historial entre semanas (nuevo / continúa / resuelto) se compara por mercado y `uid`. El `id` por fila (`F9`) sigue existiendo solo para resolver las fórmulas de la hoja.
- **Nada se ubica por coordenada fija**: encabezado "KPI", columnas de fecha, "WoW", dirección, clave, bloque y selector se encuentran por contenido, porque la hoja cambia de estructura seguido.

## Reglas que el código respeta

- Un faltante nunca se convierte en cero ni un cero en faltante.
- Un KPI con un problema de calidad que impide interpretarlo no genera alerta de performance.
- Variación relativa (%) y puntos porcentuales (pp) no se mezclan; la unidad sale de la fórmula WoW de la hoja.
- Sin dirección favorable no se dice si un cambio es bueno o malo.
- LATAM es un agregado: no se cuenta como país ni se suma.
- Lo que la web llama "posible causa" es solo qué otros KPIs se movieron a la vez en los mismos datos. Es una pista a validar, nunca una causa demostrada.
- Los textos se arman por reglas a partir de valores calculados. No hay modelo de IA en el producto todavía.
- La herramienta escribe en un solo lugar: su propia pestaña `Weekly_Tool_Registro`. Nunca toca la hoja de KPIs, el extract ni el selector.

## Archivos

| Archivo | Rol |
|---|---|
| `Web.gs` | Punto de entrada: `doGet` sirve la página `Resumen`. |
| `FuenteWeekly.gs` | Lectura (solo lectura) de las dos pestañas y control de coincidencia. |
| `MotorWeekly.gs` | Funciones puras: catálogo, identidad de KPIs, estado de la carga, calidad de datos, performance, explicaciones, panorama por mercado y recorrido por sección. |
| `ResumenWeekly.gs` | Texto en español, modelo de vista y los cuatro capítulos (`weeklyResumenHistoria_`). |
| `RegistroWeekly.gs` | Endpoint `obtenerVistaWeekly` y guardado en la pestaña `Weekly_Tool_Registro`. Es el único archivo que escribe. |
| `Resumen.txt` | La página (en Apps Script, archivo HTML `Resumen`). |
| `herramientas/` | `analizar.cjs` y `vista-previa.cjs`: corren lo mismo en local sobre una copia `.xlsx`. |
| `tests/` | Tests de la herramienta actual. |
| `DISENO_AGENTES.md` | Diseño propuesto para sumar un modelo de IA (no implementado). |
| `BITACORA.md` | Registro cronológico de lo ejecutado. |
| `anterior/` | El lector anterior, que cambiaba el selector de país de una pestaña `WebApp` que ya no existe, con sus tests y documentos. La web no lo usa; se conserva como historia. |

## Cómo ponerla en Apps Script

1. En el proyecto de Apps Script, crear (o reemplazar el contenido de) estos archivos de script con el mismo nombre que en el repo: `Web`, `FuenteWeekly`, `MotorWeekly`, `ResumenWeekly`, `RegistroWeekly`.
2. Crear (o reemplazar) un archivo **HTML** llamado `Resumen` con el contenido de `Resumen.txt`.
3. Asegurarse de que haya **un solo `doGet`** en todo el proyecto: el de `Web`. Si quedó otro de antes (por ejemplo uno que servía `Index`), borrarlo o renombrarlo. Los archivos del lector anterior pueden quedar en el proyecto: no comparten nombres con los nuevos, pero ya no hacen falta.
4. Ejecutar `probarAnalisisWeekly` desde el editor y revisar el registro de ejecución: tiene que decir `estado: ok` y la semana analizada.
5. Implementar → Nueva implementación → Aplicación web. Dos decisiones:
   - **Ejecutar como**: "yo" hace que la web lea y guarde con tus permisos, y a quien la abre le alcanza con el enlace; "usuario que accede" exige que cada persona tenga permiso de edición sobre el Sheets, porque la web guarda en `Weekly_Tool_Registro`.
   - **Quién tiene acceso**: restringirlo a la organización. La página muestra datos de performance por país.
6. Cada vez que se pega código nuevo hay que crear una **nueva versión** de la implementación; si no, el enlace sigue mostrando la anterior.

## Qué falta verificar en vivo

Todo esto funciona en local y no se pudo comprobar en Apps Script desde acá:

- [ ] La página nueva carga y se ven los cuatro capítulos.
- [ ] El carrusel del capítulo 1 se desliza con flechas, teclado y arrastre.
- [ ] Al pie, la línea "Control contra la hoja" dice que los valores coinciden.
- [ ] La primera apertura crea la pestaña `Weekly_Tool_Registro` y guarda una fila; la segunda apertura abre al instante ("Corrida guardada el…").
- [ ] "Volver a leer el Sheets" vuelve a leer y no duplica la fila de la semana.
- [ ] La pastilla de arriba muestra fecha y hora de actualización de los datos.
- [ ] Un lunes antes de que se actualicen los datos, aparece el aviso "Los datos todavía no se actualizaron" y la lectura no se guarda.

## Cómo usarlo en local

Tests de la herramienta actual y del lector anterior:

```bash
node --test tests/*.test.cjs
```

```bash
node --test anterior/tests/*.test.cjs
```

Análisis de una copia (deja el resumen en `salidas/`, que git ignora porque son datos de la empresa):

```bash
node herramientas/analizar.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review (3).xlsx"
```

Vista previa de la web en local:

```bash
node herramientas/vista-previa.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review (3).xlsx" --puerto=8125
```

Las dos herramientas aceptan `--hoy=AAAA-MM-DD` para simular otra fecha, por ejemplo el lunes siguiente con los datos todavía sin actualizar.

## Pendientes conocidos

De producto, para decidir con el equipo:

- Umbrales de alerta y de carga parcial sin validar; dirección y unidad de cada KPI sin validar.
- Filas de la hoja que hoy no se analizan porque les falta clave técnica y dirección: aparecen al pie de la web en "Advertencias del catálogo de KPIs". Completando esas celdas en la hoja, entran solas. Mientras tanto se identifican por su etiqueta, así que renombrarlas les cambia el `uid`.
- Los nombres de KPIs se muestran como están en la hoja (en inglés), salvo los tres del topline.
- El orden de las alertas es estadístico (cuánto se alejó cada KPI de su variación habitual); no pondera la importancia de negocio.

Para más adelante:

- Redacción editorial con un modelo de IA: diseñada en `DISENO_AGENTES.md`, sin proveedor aprobado.
- Vistas de detalle por KPI o por país, notificaciones (Slack) y tablero en Looker Studio.
- `run_id`, versión de reglas y guardado del resultado completo de cada corrida.

El repositorio en GitHub es público: no subir `salidas/` ni cifras de negocio.
