[INSTRUCCIONES.md](https://github.com/user-attachments/files/31987210/INSTRUCCIONES.md)
# FinaTrack – Versión de Escritorio

Este proyecto convierte tu aplicación web en un programa de escritorio real usando
**Electron**. Ya no se abre como un archivo HTML suelto: se ejecuta como un programa
normal de Windows, y tus datos se guardan en un archivo en el disco, no en el
navegador. Por eso ya no se van a perder al reiniciar el equipo.

## ¿Dónde quedan guardados tus datos ahora?

En esta ruta (se crea automáticamente):

```
C:\Users\TU_USUARIO\AppData\Roaming\finatrack-desktop\finatrack_data.json
```

Cada vez que guardas algo, el programa primero hace una copia de respaldo del
archivo anterior (`finatrack_data.backup.json`) antes de escribir el nuevo. Así,
si el archivo principal llega a dañarse, el programa lo recupera automáticamente.

## Requisitos previos

Necesitas tener instalado **Node.js** (incluye `npm`). Se descarga gratis desde:
https://nodejs.org (elige la versión "LTS").

## Paso 1: Instalar las dependencias

Abre una terminal (CMD o PowerShell) dentro de la carpeta `finatrack-desktop` y
ejecuta:

```
npm install
```

Esto descarga Electron y la herramienta para generar el instalador. Solo se hace
una vez.

## Paso 2: Probar el programa

```
npm start
```

Esto abre la aplicación como un programa de escritorio, sin necesidad de generar
el ejecutable todavía. Úsalo para confirmar que todo funciona antes de empaquetar.

## Paso 3: Generar el ejecutable (.exe)

```
npm run dist
```

Al terminar, encontrarás el archivo `FinaTrack.exe` dentro de la carpeta `dist`.
Es un ejecutable portátil: lo puedes mover a cualquier carpeta, a un USB, o crear
un acceso directo en el escritorio, y funcionará igual.

## Notas importantes

- La primera vez que abras el `.exe`, tus datos empezarán en cero, ya que es un
  archivo nuevo en una ubicación distinta a donde estaban antes. Si quieres
  recuperar los datos que ya tenías, usa la opción **Exportar respaldo** de la
  app anterior (si llegaste a generar un backup en `.json`) y luego impórtalo
  desde el menú de Configuración de esta nueva versión.
- Si más adelante quieres agregar un ícono personalizado, coloca un archivo
  `icon.png` dentro de una carpeta `build/` en la raíz del proyecto.
- Puedes seguir editando `renderer/app.js`, `renderer/index.html` y
  `renderer/style.css` normalmente: son los mismos archivos de tu aplicación
  original, solo que ahora corren dentro de Electron en vez del navegador.
