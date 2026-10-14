# WeeklyTool

Web interna para leer, cada lunes, qué pasó la semana anterior (lunes a domingo) en los 15 países y en LATAM. La idea es que se lea como un cuento en la reunión weekly, no como una tabla de KPIs.

Estado al 2026-10-14: completa y probada en local sobre copias `.xlsx` (111 tests de la herramienta actual, todos pasan el 2026-10-14; los 146 del lector anterior no se tocaron ni se volvieron a correr). La lectura y la primera versión de la página se probaron en Apps Script; **todo lo agregado después todavía no se probó en vivo** (ver "Qué falta verificar en vivo"). No hay envíos automáticos. El 2026-10-14 se escribió `IaWeekly.gs` (texto con IA por API key de Gemini, con un disparador semanal que hay que instalar a mano), probado **solo en local con los servicios simulados**: nunca se llamó a un modelo de verdad ni se corrió en Apps Script (ver "Texto con IA").

## Qué muestra la web

| Capítulo | Contenido |
|---|---|
| 1 · LATAM | Titular y párrafo de la semana, los tres primeros KPIs líderes (hoy Orders - Total, Confirmed GMV - Total y Active Customers, con el nombre que tienen en la hoja) con el gráfico de las últimas semanas de uno de ellos (abre con el primero; tocar otra tarjeta lo cambia, mismo gráfico que el de los países) y **"Lo que más se movió"**: hasta cuatro KPIs del agregado regional, tomados de los dos lados (los que más empeoraron y los que más mejoraron respecto de su variación habitual). Cada tarjeta trae el dato y la posible causa. |
| 2 · País por país | Ficha por país con **botones de segmento**: "Todo el país" y uno por cada sección de la hoja (hoy Overall, Users, Affordability, Food, QC - Dmart, QC - AAAs, QC - Non AAAs, Seamless Experience y Payments), en el orden y con el nombre de la hoja. Cada segmento muestra hasta cuatro KPIs: primero los que más se movieron contra su propia variación habitual; el KPI que abre la sección en la hoja siempre tiene lugar, y si sobran lugares entran los que abren cada bloque. El número junto al botón cuenta los KPIs del segmento que se movieron por encima de lo habitual. El primero abre en el gráfico de 9 semanas (con el promedio previo) y los otros quedan como tarjetas; al elegir una tarjeta, ese KPI pasa al gráfico. A la izquierda, el dato y la posible causa son siempre los del KPI que está en el gráfico: cómo se compone el cambio (qué parte aporta cuánto, o cómo se movieron numerador y denominador) y qué otros KPIs del país se movieron a la vez. El segmento elegido se mantiene al cambiar de país. |
| 3 · Resumen | Qué pasó, qué hay detrás, qué mirar la semana que viene, y el estado de la información. |
| Desplegable "KPIs a mirar esta semana" | El primero de los desplegables del pie. Lista todos los KPIs que se movieron fuera de lo habitual (primero los que más se movieron): mercado, KPI con el nombre de la hoja, semana anterior → esta, cuánto se alejó, fila, si es nuevo y el cambio. Adentro, el botón "Descargar documento" baja un documento (`KPIs-a-mirar-AAAA-MM-DD.doc`, que abren Word y Google Docs) con **todos** los KPIs que se movieron fuera de lo habitual en la semana, no solo los que entran en la página: el resumen de cierre, una tabla de mercados (LATAM primero, después los que más movimientos tienen), y por mercado cada KPI con el nombre de la hoja, su fila, el cambio, semana anterior → esta, si es favorable, cuánto se alejó de su variación habitual, si es nuevo o venía de la semana pasada y lo que se movió a la vez. Cierra con los datos a revisar y los criterios. Se arma en el navegador con lo que la página ya recibió: no hace otra llamada al servidor ni recalcula nada. Lleva cifras de la empresa: es para uso interno. |
| Desplegables | "KPIs a mirar esta semana" (ver arriba). "Datos a revisar esta semana": lo que la herramienta detectó en la semana analizada (faltantes, ceros sospechosos, texto en lugar de número, saltos fuera de escala…), una línea por regla y KPI con sus mercados. "Datos a revisar semana pasada": lo mismo, leído de la corrida guardada en `Weekly_Tool_Registro`, diciendo si cada uno sigue o ya no aparece. "Cómo leer esta página": reglas, KPIs sin operación, filas no interpretadas y origen. |

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
- Los textos se arman por reglas a partir de valores calculados. Si hay texto con IA guardado para la semana, reemplaza al de reglas solo en los mercados donde el verificador lo aprobó; sin eso, queda el de reglas.
- El texto con IA solo se escribe si `weeklyMotorCompuertaIa_` lo permite (carga completa, filas de KPIs interpretadas, sin ceros en bloque). Solo lo escribe el disparador semanal (`generarTextosIaWeekly`); la página (`obtenerVistaWeekly`, con o sin `forzar`) solo lee lo guardado y nunca llama al modelo.
- El modelo no escribe cifras: recibe referencias (`{{K3.cambio}}`) y el código pone el valor que calculó el motor. Un texto con un dígito propio, una referencia que no existe, lenguaje causal o una valoración sobre un KPI sin dirección se rechaza.
- La herramienta escribe en dos pestañas propias: `Weekly_Tool_Registro` (el resultado por reglas) y `Weekly_Tool_Textos_IA` (los textos de la IA). Nunca toca la hoja de KPIs, el extract ni el selector.

## Archivos

| Archivo | Rol |
|---|---|
| `Web.gs` | Punto de entrada: `doGet` sirve la página `Resumen`. |
| `FuenteWeekly.gs` | Lectura (solo lectura) de las dos pestañas y control de coincidencia. `probarAnalisisWeekly` y `probarCompuertaIaWeekly` son los dos probadores para el editor de Apps Script. |
| `MotorWeekly.gs` | Funciones puras: catálogo, identidad de KPIs, estado de la carga, calidad de datos, performance, explicaciones y panorama por mercado (con los altos y bajos de LATAM). También `weeklyMotorCompuertaIa_`: decide si se puede generar el texto con IA. |
| `ResumenWeekly.gs` | Texto en español, modelo de vista y los tres capítulos (`weeklyResumenHistoria_`). |
| `RegistroWeekly.gs` | Endpoint `obtenerVistaWeekly` y guardado en la pestaña `Weekly_Tool_Registro`. Al servir la página suma el texto con IA guardado, solo en lectura. |
| `IaWeekly.gs` | Texto con IA: paquete de referencias por mercado, verificador, lectura de la respuesta de Gemini, guardado en `Weekly_Tool_Textos_IA` y el disparador semanal. Es el único archivo que llama a un servicio externo (`UrlFetchApp`) y el único, además de `RegistroWeekly.gs`, que escribe. Opcional: sin este archivo la página funciona igual con los textos por reglas. |
| `Resumen.txt` | La página (en Apps Script, archivo HTML `Resumen`). |
| `herramientas/` | `analizar.cjs` y `vista-previa.cjs`: corren lo mismo en local sobre una copia `.xlsx`. `diccionario.cjs` y `validar.cjs`: el diccionario de KPIs y la validación de la lectura (pasos 2 y 3 de la hoja de ruta). |
| `tests/` | Tests de la herramienta actual. |
| `DISENO_AGENTES.md` | Diseño original para sumar un modelo de IA. La variante A (una llamada por mercado + verificador en código) es lo que implementa `IaWeekly.gs`; la variante B (tres roles) no se construyó. |
| `BITACORA.md` | Registro cronológico de lo ejecutado. |
| `anterior/` | El lector anterior, que cambiaba el selector de país de una pestaña `WebApp` que ya no existe, con sus tests y documentos. La web no lo usa; se conserva como historia. |

## Cómo ponerla en Apps Script

1. En el proyecto de Apps Script, crear (o reemplazar el contenido de) estos archivos de script con el mismo nombre que en el repo: `Web`, `FuenteWeekly`, `MotorWeekly`, `ResumenWeekly`, `RegistroWeekly`.
2. Crear (o reemplazar) un archivo **HTML** llamado `Resumen` con el contenido de `Resumen.txt`.
3. Asegurarse de que haya **un solo `doGet`** en todo el proyecto: el de `Web`. Si quedó otro de antes (por ejemplo uno que servía `Index`), borrarlo o renombrarlo. Los archivos del lector anterior pueden quedar en el proyecto: no comparten nombres con los nuevos, pero ya no hacen falta.
4. Ejecutar `probarAnalisisWeekly` desde el editor y revisar el registro de ejecución: tiene que decir `estado: ok` y la semana analizada.
5. (Opcional, texto con IA) Ver "Texto con IA" más abajo: agregar el archivo `IaWeekly`, cargar la clave y el modelo en las propiedades del script y probar antes de instalar el disparador.
6. Implementar → Nueva implementación → Aplicación web. Dos decisiones:
   - **Ejecutar como**: "yo" hace que la web lea y guarde con tus permisos, y a quien la abre le alcanza con el enlace; "usuario que accede" exige que cada persona tenga permiso de edición sobre el Sheets, porque la web guarda en `Weekly_Tool_Registro`.
   - **Quién tiene acceso**: restringirlo a la organización. La página muestra datos de performance por país.
7. Cada vez que se pega código nuevo hay que crear una **nueva versión** de la implementación; si no, el enlace sigue mostrando la anterior.

## Qué falta verificar en vivo

Todo esto funciona en local y no se pudo comprobar en Apps Script desde acá:

- [ ] La página rediseñada (2026-10-07) carga y se ven los tres capítulos. Para eso hay que volver a pegar `MotorWeekly`, `ResumenWeekly`, `RegistroWeekly` y `Resumen`: los cuatro cambiaron juntos y la página no acepta la respuesta del código anterior.
- [ ] En el capítulo 1 se ve el gráfico de los topline KPIs de LATAM y tocar cada tarjeta cambia el KPI graficado (agregado 2026-10-14; hay que volver a pegar `ResumenWeekly` y `Resumen` juntos: el formato pasó a 5, así que la corrida guardada se vuelve a leer una vez).
- [ ] El desplegable "KPIs a mirar esta semana" lista los KPIs y su botón "Descargar documento" baja el archivo desde la web publicada (agregado 2026-10-14; solo hay que volver a pegar `Resumen`). En local funciona; no sé si el marco en el que Apps Script muestra la página deja descargar archivos. Si no baja nada, avisar: la alternativa es armar el documento del lado del servidor o abrirlo para imprimir.
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
- [ ] Texto con IA (nada probado en vivo): `probarClaveIaWeekly` devuelve `ok`; `probarPaquetesIaWeekly` arma los 16 paquetes con tamaños razonables; `generarTextosIaWeekly` a mano escribe una fila por mercado en `Weekly_Tool_Textos_IA` y la marca `_COMPLETA`; la web muestra los textos y la línea "redactada con IA" en "Cómo leer esta página"; cuántas llamadas y cuánto tiempo toma una semana completa; qué mercados rechaza el verificador y por qué.
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

## Texto con IA (API key de Gemini)

Escrito y probado **en local con los servicios de Google simulados** (2026-10-14). Nunca se llamó a un modelo real, ni se corrió en Apps Script, ni se instaló el disparador. El camino anterior (Vertex AI con facturación en el proyecto de Cloud, y después `=AI()` en una hoja buzón) se descartó: Vertex no se pudo usar sin cuenta de facturación y a Juani no le gustó `=AI()`.

### Qué hace

```
Disparador por tiempo (cada hora, con la cuenta de quien lo instala)
  ¿Ya hay texto completo guardado para la semana?  → sí: no hace nada (ni lee la hoja grande)
  Lee la hoja y consulta weeklyMotorCompuertaIa_    → no puede: no escribe nada, la web sigue con reglas
  Arma un paquete por mercado (15 países + LATAM) con referencias en lugar de números
  Una llamada a Gemini por mercado (JSON)
  Verificador en código: JSON válido, sin dígitos propios, solo referencias que existen,
                         sin lenguaje causal, sin valorar KPIs sin dirección
     └ si rechaza: una segunda llamada diciéndole qué reglas falló (sin repetirle su texto)
  Reemplaza las referencias por las cifras del motor y guarda una fila por mercado en
  `Weekly_Tool_Textos_IA` (texto ya resuelto, como valor, nunca como fórmula)
  Cuando están todos, guarda la marca `_COMPLETA` de la semana
La página (obtenerVistaWeekly) lee esa pestaña y reemplaza el texto de reglas de cada mercado aprobado.
```

Qué texto escribe la IA (el resto sigue por reglas): LATAM (titular, texto, dato e hipótesis de cada "movida", y el resumen de cierre con sus tres pasos) y, por país, el texto de la ficha y el dato y la hipótesis de cada KPI que muestran sus segmentos. Cuando hay texto con IA, `vista.limites` agrega una línea que lo dice, para que quien lee sepa qué fue redactado por un modelo. El resultado guardado en `Weekly_Tool_Registro` nunca lleva texto de IA: se suma al servir.

### Qué hay que pedir y cargar

1. Una **API key de la Gemini Developer API** (la que se usa contra `generativelanguage.googleapis.com`, de Google AI Studio o la que entregue la empresa), con facturación o cuota suficiente para unas 20 llamadas por semana. No sirve una clave de Vertex AI ni una cuenta de servicio: usan otra dirección y otra forma de autenticar, y habría que cambiar `weeklyIaPedido_`.
2. El **nombre exacto del modelo** que autorice la empresa (por ejemplo uno de la familia Flash para empezar). El código no trae uno por defecto a propósito: los nombres cambian y no se pudieron verificar contra la documentación oficial al escribirlo.
3. En Apps Script → Configuración del proyecto → Propiedades del script: `GEMINI_API_KEY` y `GEMINI_MODEL`. La clave no va en el código, ni en la página, ni en el repositorio.
4. Que la cuenta que instala el disparador pueda hacer llamadas externas: la primera vez Apps Script pide autorizar `UrlFetchApp` (permiso para conectarse a un servicio externo). Si la organización lo bloquea, hay que pedirlo a IT.

### Cómo ponerlo en marcha (en este orden)

1. Pegar `IaWeekly.gs` junto con los otros archivos (hay que volver a pegar `ResumenWeekly` y `RegistroWeekly` y subir una nueva versión de la implementación: el formato de la página pasó a 6 y las tarjetas llevan `uid`).
2. Cargar `GEMINI_API_KEY` y `GEMINI_MODEL`.
3. Ejecutar `probarClaveIaWeekly`: manda una palabra, sin datos de la empresa, y registra `{"ok":true,...}` o el código del fallo (`IA_PERMISO`, `IA_PEDIDO_O_CLAVE`, `IA_CUOTA`, `IA_SIN_CLAVE`, `IA_SIN_MODELO`).
4. Ejecutar `probarPaquetesIaWeekly`: arma los paquetes con la hoja real, **sin llamar al modelo**, y registra cuántos KPIs, referencias y caracteres tiene cada uno, y qué dice la compuerta.
5. Ejecutar `generarTextosIaWeekly` una vez a mano y mirar el registro (`generadas`, `fallidas`, `pendientes`) y la pestaña `Weekly_Tool_Textos_IA`. Abrir la web y leer los textos antes de instalar nada.
6. Recién entonces, `instalarDisparadorIaWeekly` (`quitarDisparadorIaWeekly` lo saca). El disparador corre cada hora; cuando la semana está completa solo consulta la pestaña y termina.

### Topes y qué pasa si algo falla

- Hasta 3 intentos por mercado y por semana, y 60 llamadas por semana en total (`weeklyIaConfig_`). Una corrida deja de empezar llamadas a los 4,5 minutos (Apps Script corta a los 6); lo que quedó pendiente lo toma la siguiente hora.
- Un error de permiso o de clave no se reintenta. Un mercado que falla queda con su texto por reglas y una fila `fallido` con el motivo.
- Si el modelo se apaga o la clave se vence, la página sigue con el resumen por reglas: nada depende de la IA.

### Qué no se sabe

- Nada de esto se probó con Gemini ni en Apps Script. No sé si `generateContent` con `responseMimeType: application/json` responde como lo espera `weeklyIaRespuesta_` con el modelo que elijan, ni cuánto tarda cada llamada (si 16 llamadas no entran en una corrida, se completan en las siguientes horas).
- Los modelos con razonamiento cuentan sus tokens de razonamiento dentro de `maxSalidaTokens` (16384); si una respuesta se corta aparece `IA_CORTADA_MAX_TOKENS`.
- El verificador atrapa lo evidente (dígitos, referencias, listas de palabras). No sabe si una frase afirma más de lo que muestran los datos: alguien tiene que leer los textos antes de compartirlos. Que el código no deje pasar una cifra inventada no garantiza que el texto sea un buen análisis.
- El texto se guarda con las cifras del momento en que se generó. Si después se corrigen los datos del extract y se vuelve a leer, los números del resumen por reglas cambian y el texto de IA de esa semana queda con los viejos hasta que se borre su fila de `Weekly_Tool_Textos_IA`.
- Las cifras de la semana (valores, cambios, nombres de KPIs y de países) salen de la hoja hacia Gemini en cada llamada; no hay aprobación de IT o de seguridad para ese envío. Está pendiente decidirlo con el equipo, igual que quién queda como dueño de la clave, del disparador y del proyecto de Cloud al terminar la pasantía.
- Quienes abren la web leen la pestaña `Weekly_Tool_Textos_IA` con sus propios permisos si la implementación corre como "usuario que accede". La escribe solo quien instala el disparador.

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

- Redacción editorial con IA: escrita en `IaWeekly.gs` (ver "Texto con IA"), falta la clave, probarla en vivo y la aprobación del equipo para enviar las cifras a Gemini. La variante de tres roles de `DISENO_AGENTES.md` no se construyó: solo tendría sentido si la de una llamada por mercado deja a la vista omisiones o afirmaciones sin respaldo.
- Agente de datos en Data Studio sobre la tabla de BigQuery (idea de Juani, 2026-10-07), para preguntas sueltas que la web no responde. Su contexto ya se genera (`salidas/contexto-agente.md`); falta elegir el agente, ver qué formato y tamaño de instrucciones acepta, y completar en `Weekly_Glossary` las columnas sin definición. No reemplaza a la web: el agente puede equivocarse en un cálculo sin avisar.
- Vistas de detalle por KPI o por país, notificaciones (Slack) y tablero en Looker Studio.
- `run_id`, versión de reglas y guardado del resultado completo de cada corrida.

El repositorio en GitHub es público: no subir `salidas/` ni cifras de negocio.
