# WeeklyTool

Web interna para leer, cada lunes, qué pasó la semana anterior (lunes a domingo) en los 15 países y en LATAM. La idea es que se lea como un cuento en la reunión weekly, no como una tabla de KPIs.

Estado al 2026-10-13: completa y probada en local sobre copias `.xlsx` (86 tests de la herramienta actual, todos pasan el 2026-10-13; los 146 del lector anterior no se tocaron ni se volvieron a correr ese día). La lectura y la primera versión de la página se probaron en Apps Script; **todo lo agregado después todavía no se probó en vivo** (ver "Qué falta verificar en vivo"). No hay trigger ni envíos automáticos. Desde el 2026-10-13 está decidido cómo se sumaría el texto con IA y está construida su compuerta, pero **ningún modelo está conectado** (ver "Plan: texto con IA").

## Qué muestra la web

| Capítulo | Contenido |
|---|---|
| 1 · LATAM | Titular y párrafo de la semana, los tres primeros KPIs líderes (hoy Orders - Total, Confirmed GMV - Total y Active Customers, con el nombre que tienen en la hoja) y **"Lo que más se movió"**: hasta cuatro KPIs del agregado regional, tomados de los dos lados (los que más empeoraron y los que más mejoraron respecto de su variación habitual). Cada tarjeta trae el dato y la posible causa. |
| 2 · País por país | Ficha por país con **botones de segmento**: "Todo el país" y uno por cada sección de la hoja (hoy Overall, Users, Affordability, Food, QC - Dmart, QC - AAAs, QC - Non AAAs, Seamless Experience y Payments), en el orden y con el nombre de la hoja. Cada segmento muestra hasta cuatro KPIs: primero los que más se movieron contra su propia variación habitual; el KPI que abre la sección en la hoja siempre tiene lugar, y si sobran lugares entran los que abren cada bloque. El número junto al botón cuenta los KPIs del segmento que se movieron por encima de lo habitual. El primero abre en el gráfico de 9 semanas (con el promedio previo) y los otros quedan como tarjetas; al elegir una tarjeta, ese KPI pasa al gráfico. A la izquierda, el dato y la posible causa son siempre los del KPI que está en el gráfico: cómo se compone el cambio (qué parte aporta cuánto, o cómo se movieron numerador y denominador) y qué otros KPIs del país se movieron a la vez. El segmento elegido se mantiene al cambiar de país. |
| 3 · Resumen | Qué pasó, qué hay detrás, qué mirar la semana que viene, y el estado de la información. |
| Desplegables | "Datos a revisar esta semana": lo que la herramienta detectó en la semana analizada (faltantes, ceros sospechosos, texto en lugar de número, saltos fuera de escala…), una línea por regla y KPI con sus mercados. "Datos a revisar semana pasada": lo mismo, leído de la corrida guardada en `Weekly_Tool_Registro`, diciendo si cada uno sigue o ya no aparece. "Cómo leer esta página": reglas, KPIs sin operación, filas no interpretadas y origen. |

Se sacaron de la página el capítulo "Qué mirar esta semana", el carrusel por sección y el detalle con filtros. El análisis sigue calculando todos los movimientos (se guardan en el registro); la página ya no los lista uno por uno.

Los textos de titular, resumen, dato y posible causa hoy se arman por reglas. La idea es que más adelante los escriba un agente; la página ya tiene el lugar para cada uno y no hay que cambiarla para eso.

Arriba de todo aparecen los avisos: datos sin actualizar, semana faltante, mercado cargado a medias, filas de la hoja que no se pudieron interpretar o diferencias contra la hoja.

## Hoja de ruta: pasos 1 a 3 (preparar los datos y asegurar la lectura)

Estado al 2026-10-07, sobre la copia `Weekly Performance Review.xlsx` bajada ese día. Lo que figura como hecho está hecho **en local sobre esa copia**; lo que depende del equipo está marcado como pendiente.

| Paso | Qué pide | Qué hay | Qué falta, y de quién |
|---|---|---|---|
| 1 · Revisar lo construido y acordar prioridades | Reutilizar lo que funciona y definir los KPIs de la primera versión. | Se reutiliza la hoja tal cual (KPIs, secciones, bloques, dirección y fórmulas) y el extract como fuente de valores; el lector anterior quedó archivado en `anterior/`. La primera versión toma **toda fila que la hoja deja leer**: en esta copia, 127 de 131. Los KPIs que abren cada bloque son los que cuenta la web. La lista sale en la sección 1 del diccionario. | Que el equipo confirme esa lista y el orden de los bloques. Las 4 filas que quedan fuera entran solas cuando alguien complete su clave técnica y su dirección en la hoja. |
| 2 · Identificar correctamente cada KPI | Documentar significado, unidad y contexto. | `herramientas/diccionario.cjs` genera el diccionario: por fila, identificador estable, sección y bloque, cómo se obtiene, unidad (% o pp), dirección favorable, cobertura por país y la descripción que trae `Weekly_Glossary`. Señala lo que puede confundir: nombres repetidos, claves que dependen del orden del glosario, unidades dudosas. | El significado lo pone el equipo: la herramienta no redacta definiciones y hay filas sin descripción en el glosario. Unidad y dirección son las que declara la hoja, sin validar. |
| 3 · Validar la lectura por país y semana | Distinguir cero, vacío y error. Evitar mezclar países o períodos. | `herramientas/validar.cjs` corre diez controles sobre la copia: integridad del extract (una fila por país y semana, semanas de lunes sin saltos, un identificador por país), estado de cada celda (número, cero, vacía, texto o error) y que se lea como tal, recálculo de todos los mercados y semanas con la regla de las fórmulas de la hoja, y comparación contra lo que la hoja muestra para el mercado del selector. | La comparación contra la hoja visible cubre un mercado por copia (el del selector). Para los otros hace falta una copia por mercado, o abrir la web con el selector en cada uno. Las capturas de pantalla contra la hoja las tiene que sacar una persona. |

Los dos informes se escriben en `salidas/` (fuera de git, porque llevan datos de la empresa): `diccionario-kpis.md` y `validacion-lectura.md`. El diccionario deja además `contexto-agente.md` y `.json`: lo mismo ordenado por columna de la tabla de BigQuery, con las reglas de lectura, para darle contexto a un agente de datos. No lleva cifras; no se probó con ningún agente.

## De dónde sale cada cosa

- **Qué KPIs existen y cómo se leen**: pestaña `2) Weekly por pais`. Filas, nombres, sección, bloque (la columna de agrupación: Orders, GMV, User Base…), dirección favorable (1 / −1), clave técnica y fórmulas de los derivados (proporción entre dos filas, producto, suma de un rango y resto de un 100 %). Si se cambia algo ahí, la web lo refleja en la siguiente lectura.
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
- El texto con IA, cuando exista, solo se escribe si `weeklyMotorCompuertaIa_` lo permite (carga completa, filas de KPIs interpretadas, sin ceros en bloque), y ninguna ruta que se pueda activar desde la página llama al modelo. Hoy la compuerta existe y nada la usa salvo `probarCompuertaIaWeekly`.
- La herramienta escribe en un solo lugar: su propia pestaña `Weekly_Tool_Registro`. Nunca toca la hoja de KPIs, el extract ni el selector.

## Archivos

| Archivo | Rol |
|---|---|
| `Web.gs` | Punto de entrada: `doGet` sirve la página `Resumen`. |
| `FuenteWeekly.gs` | Lectura (solo lectura) de las dos pestañas y control de coincidencia. `probarAnalisisWeekly` y `probarCompuertaIaWeekly` son los dos probadores para el editor de Apps Script. |
| `MotorWeekly.gs` | Funciones puras: catálogo, identidad de KPIs, estado de la carga, calidad de datos, performance, explicaciones y panorama por mercado (con los altos y bajos de LATAM). También `weeklyMotorCompuertaIa_`: decide si se puede generar el texto con IA. |
| `ResumenWeekly.gs` | Texto en español, modelo de vista y los tres capítulos (`weeklyResumenHistoria_`). |
| `RegistroWeekly.gs` | Endpoint `obtenerVistaWeekly` y guardado en la pestaña `Weekly_Tool_Registro`. Es el único archivo que escribe. |
| `Resumen.txt` | La página (en Apps Script, archivo HTML `Resumen`). |
| `herramientas/` | `analizar.cjs` y `vista-previa.cjs`: corren lo mismo en local sobre una copia `.xlsx`. `diccionario.cjs` y `validar.cjs`: el diccionario de KPIs y la validación de la lectura (pasos 2 y 3 de la hoja de ruta). |
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

- [ ] La página rediseñada (2026-10-07) carga y se ven los tres capítulos. Para eso hay que volver a pegar `MotorWeekly`, `ResumenWeekly`, `RegistroWeekly` y `Resumen`: los cuatro cambiaron juntos y la página no acepta la respuesta del código anterior.
- [ ] En el capítulo 2, al elegir una tarjeta su KPI pasa al gráfico y el anterior baja a su lugar.
- [ ] En el capítulo 2 aparecen los botones de segmento (uno por sección de la hoja), cada uno cambia los KPIs del gráfico y las tarjetas, y el texto de la izquierda cambia con el KPI del gráfico.
- [ ] La corrida con segmentos se guarda en `Weekly_Tool_Registro` (ocupa más celdas que antes: 12 de las 20 disponibles en la copia del 2026-10-09).
- [ ] La primera apertura con el código nuevo vuelve a leer el Sheets aunque haya una corrida guardada de la semana (la guardada tiene el formato anterior) y la reemplaza.
- [ ] "Datos a revisar semana pasada" muestra la lista cuando el registro tiene guardada la semana anterior, y el aviso de que no hay corrida cuando no la tiene.
- [ ] Al pie, la línea "Control contra la hoja" dice que los valores coinciden.
- [ ] La primera apertura crea la pestaña `Weekly_Tool_Registro` y guarda una fila; la segunda apertura abre al instante ("Corrida guardada el…").
- [ ] "Volver a leer el Sheets" vuelve a leer y no duplica la fila de la semana.
- [ ] La pastilla de arriba muestra fecha y hora de actualización de los datos.
- [ ] Un lunes antes de que se actualicen los datos, aparece el aviso "Los datos todavía no se actualizaron" y la lectura no se guarda.
- [ ] `probarCompuertaIaWeekly` desde el editor (hay que volver a pegar `MotorWeekly` y `FuenteWeekly` juntos): con la columna de la semana nueva ya creada en la hoja pero el extract sin cargar, el registro tiene que mostrar `"puede":false` con `SEMANA_ESPERADA_AUSENTE` (o `ACTUALIZACION_PENDIENTE` si es lunes antes de la actualización); con la semana cargada y completa, `"puede":true` y `motivos` vacío. Corrida parcial reportada por Juani el 2026-10-13 15:49: con la semana ya cargada devolvió `{"puede":true,"semana":"2026-10-05","motivos":[]}`; falta ver el caso bloqueado.

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
node herramientas/analizar.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review.xlsx"
```

Diccionario de KPIs y validación de la lectura (dejan `diccionario-kpis.md`, `contexto-agente.md` y `validacion-lectura.md` en `salidas/`). La validación acepta varias copias, una por cada mercado puesto en el selector, y termina con código 1 si algún control no pasa:

```bash
node herramientas/diccionario.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review.xlsx"
```

```bash
node herramientas/validar.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review.xlsx"
```

Vista previa de la web en local:

```bash
node herramientas/vista-previa.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review.xlsx" --puerto=8125
```

Las dos herramientas aceptan `--hoy=AAAA-MM-DD` para simular otra fecha, por ejemplo el lunes siguiente con los datos todavía sin actualizar.

## Plan: texto con IA (2026-10-13)

Es un plan acordado con Juani, no algo desplegado. Lo único hecho hasta hoy es la compuerta en el motor (`weeklyMotorCompuertaIa_`) y su prueba en vivo (`probarCompuertaIaWeekly`), probadas solo en local sobre datos sintéticos.

Diseño:

- Un disparador por tiempo (no la página) genera el texto con IA una vez por semana y lo guarda. La web solo lee el texto guardado; nadie que abra la página consume el modelo, ni con `forzar`.
- El disparador corre con la cuenta que lo crea, así que el gasto va al proyecto de Google Cloud de esa cuenta y no a cada visitante. La web puede seguir en "usuario que accede".
- Antes de llamar al modelo, el disparador consulta la compuerta. Si no puede, no genera nada y la web sigue con el resumen por reglas. La compuerta bloquea cuando hay carga provisoria (`ACTUALIZACION_PENDIENTE`, `SEMANA_ESPERADA_AUSENTE`, `CARGA_PARCIAL`), catálogo degradado, o ceros en bloque (`CEROS_EN_BLOQUE`: un mercado con 25 % o más de sus KPIs leídos en `CERO_SOSPECHOSO`).
- El modelo (Gemini vía Vertex AI) solo redacta; las cifras salen del motor. El resumen por reglas es el piso si algo falla.

Qué no se sabe:

- Cómo escribe la carga real una semana sin cargar (ceros o vacío). La compuerta cubre ambos casos solo en parte: los ceros en bloque los detecta ella y la semana ausente la detecta el motor.
- Los umbrales de la compuerta (`iaCeroPorMercado`, `iaMercadosConCeroMax`) son una propuesta sin validar. Un caso de 5 KPIs en cero en un solo país pasa la compuerta a propósito.
- Nada se probó en Apps Script, con disparadores ni con Vertex AI.

Falta decidir con IT/legal/el equipo: si se puede crear un proyecto de Cloud con facturación y Vertex AI, si los datos pueden salir a ese servicio, y quién queda como dueño del proyecto y del disparador después de la pasantía. También si quienes abren la web tienen permiso de edición en la hoja (el registro escribe en `Weekly_Tool_Registro`).

## Pendientes conocidos

- **Columna de prioridad en la hoja** (propuesta de Juani, 2026-10-09; todavía no existe). Hoy, dentro de cada segmento, el orden es "lo que más se movió" y la única noción de importancia es la posición en la hoja (el KPI que abre la sección y los que abren cada bloque). Cuando la columna exista, el lector la tiene que ubicar por contenido, como al resto, y `weeklyMotorDeSeccion_` es el único lugar donde cambia el orden. Falta acordar con el equipo qué valores lleva.
- Los segmentos están solo en el capítulo 2 (países). LATAM sigue con "Lo que más se movió" del capítulo 1.

De producto, para decidir con el equipo:

- Umbrales de alerta y de carga parcial sin validar; dirección y unidad de cada KPI sin validar.
- Filas de la hoja que hoy no se analizan porque les falta clave técnica y dirección: aparecen al pie de la web en "Advertencias del catálogo de KPIs" y en la sección 1 del diccionario. Completando esas celdas en la hoja, entran solas. Mientras tanto se identifican por su etiqueta, así que renombrarlas les cambia el `uid`.
- Lo que el diccionario lista en "Qué hay que resolver con el equipo": claves técnicas que se buscan por un nombre repetido en `Weekly_Glossary`, filas con unidad dudosa y filas sin descripción.
- Filas de la hoja con fórmula en una sola de las columnas semanales: la validación las muestra como diferencia contra la hoja; se arreglan en la hoja.
- Los nombres de KPIs se muestran como están en la hoja (en inglés), salvo los tres del topline.
- El orden de las alertas es estadístico (cuánto se alejó cada KPI de su variación habitual); no pondera la importancia de negocio.

Para más adelante:

- Redacción editorial con un modelo de IA: diseñada en `DISENO_AGENTES.md` (ver su sección 10 y "Plan: texto con IA" arriba), sin proveedor aprobado. Por construir: el disparador semanal, la llamada a Vertex AI, el verificador de cifras y el guardado del texto.
- Agente de datos en Data Studio sobre la tabla de BigQuery (idea de Juani, 2026-10-07), para preguntas sueltas que la web no responde. Su contexto ya se genera (`salidas/contexto-agente.md`); falta elegir el agente, ver qué formato y tamaño de instrucciones acepta, y completar en `Weekly_Glossary` las columnas sin definición. No reemplaza a la web: el agente puede equivocarse en un cálculo sin avisar.
- Vistas de detalle por KPI o por país, notificaciones (Slack) y tablero en Looker Studio.
- `run_id`, versión de reglas y guardado del resultado completo de cada corrida.

El repositorio en GitHub es público: no subir `salidas/` ni cifras de negocio.
