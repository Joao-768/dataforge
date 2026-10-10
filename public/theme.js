// Runs before first paint (loaded synchronously in <head>) so the page never
// flashes the wrong theme. A file rather than an inline script, so it works
// under a Content-Security-Policy that only allows same-origin scripts.
;(function () {
    var mode = null
    try {
        mode = localStorage.getItem('dataforge-theme')
    } catch (error) {
        mode = null
    }
    // Dark unless the visitor chose light, or chose to follow the system.
    var dark =
        mode === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
            : mode !== 'light'
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
})()
