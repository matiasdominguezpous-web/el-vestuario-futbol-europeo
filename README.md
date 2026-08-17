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

La aplicación incluye plantillas, edad, nacionalidad, dorsal, posición específica, valor de mercado, estadísticas acumuladas de carrera y palmarés de jugadores y clubes.

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
│   ├── futbol-europeo.html        # Aplicación completa
│   └── data.js                    # Base de datos integrada
└── work/
    ├── fetch-data.mjs             # Descarga equipos y plantillas
    ├── enrich-data.mjs            # Añade valores, posiciones y títulos
    └── career-stats.mjs           # Calcula estadísticas de carrera
```

## Actualización de datos

Los scripts requieren Node.js 20 o posterior:

```bash
node work/fetch-data.mjs
node work/enrich-data.mjs
node work/career-stats.mjs
```

Ejecuta los scripts en ese orden. Dorsales, edades, nacionalidades, posiciones, valores, estadísticas y palmarés de jugadores y clubes provienen de datos públicos de Transfermarkt. ESPN se utiliza únicamente como referencia inicial para el listado de competiciones y equipos antes del cruce con Transfermarkt.

## Tecnologías

HTML, CSS y JavaScript nativos. El sitio no necesita dependencias en producción.

## Aviso

Los datos deportivos pueden cambiar. Transfermarkt y ESPN pertenecen a sus respectivos propietarios; este proyecto no está afiliado con esas plataformas.
