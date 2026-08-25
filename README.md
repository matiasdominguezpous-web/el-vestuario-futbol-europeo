# El Vestuario — Fútbol Europeo

Directorio interactivo de los equipos y jugadores de diez grandes ligas europeas:

- Premier League
- LaLiga
- Serie A
- Bundesliga
- Ligue 1
- Liga Portugal
- Eredivisie
- Belgian Pro League
- Süper Lig
- Scottish Premiership

La aplicación incluye plantillas, edad, nacionalidad, dorsal, posición específica, valor de mercado, estadísticas acumuladas de carrera, palmarés de jugadores y clubes, las tablas actuales de las diez ligas y el top 5 de goleadores de cada competición.

## Uso local

No requiere instalación ni compilación. Abre `index.html` en un navegador moderno o inicia un servidor estático:

```bash
python3 -m http.server 8080
```

Después visita `http://localhost:8080`.

## Estructura

```text
.
├── index.html                     # Entrada para hosting estático
├── outputs/
│   ├── futbol-europeo.html        # Página de plantillas
│   ├── posiciones.html            # Página de clasificaciones
│   ├── data.js                    # Base de datos de plantillas
│   └── standings-data.js          # Base de datos de posiciones
└── work/
    ├── fetch-data.mjs             # Descarga la lista base de equipos
    ├── enrich-data.mjs            # Valida planteles y añade datos Transfermarkt
    ├── club-titles.mjs            # Permite refrescar palmarés de clubes
    ├── career-stats.mjs           # Calcula estadísticas de carrera
    └── fetch-standings.mjs        # Actualiza clasificaciones y goleadores
```

## Actualización de datos

Los scripts requieren Node.js 20 o posterior:

```bash
node work/fetch-data.mjs
node work/enrich-data.mjs
node work/career-stats.mjs
node work/fetch-standings.mjs
```

Ejecuta los scripts en ese orden. Dorsales, edades, nacionalidades, posiciones, valores, estadísticas y palmarés de jugadores y clubes provienen de datos públicos de Transfermarkt. ESPN se utiliza únicamente como referencia inicial para el listado de competiciones y equipos antes del cruce con Transfermarkt.

`enrich-data.mjs` contrasta cada club con el identificador actual de Transfermarkt y comprueba que todos los integrantes del plantel tengan un perfil válido antes de guardar los datos. `fetch-standings.mjs` actualiza en la misma ejecución las clasificaciones y los cinco máximos goleadores disponibles de la temporada actual.

## Tecnologías

HTML, CSS y JavaScript nativos. El sitio no necesita dependencias en producción.

## Aviso

Los datos deportivos pueden cambiar. Transfermarkt y ESPN pertenecen a sus respectivos propietarios; este proyecto no está afiliado con esas plataformas.
